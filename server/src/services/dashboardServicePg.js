/**
 * Dashboard Service (PostgreSQL Version)
 * 
 * Handles dashboard CRUD operations using PostgreSQL.
 * Dashboard configurations, credentials, and sharing are now stored in PostgreSQL.
 */

import { query, transaction } from '../db/postgres.js';
import { getGroupsForUser, isUserInGroup } from './groupService.js';

/**
 * Get all dashboards accessible by a user
 * 
 * Access model:
 * - Dashboard owner: Full control
 * - Private dashboards: User must be in a group with access, permission based on app role
 * - Public dashboards: Any user can access, permission based on app role
 */
export async function getDashboardsForUser(userId, userAppRole) {
  // Get user's groups
  const userGroups = await getGroupsForUser(userId);
  const groupIds = userGroups.map(g => g.id);

  // Determine effective permission based on user's app role
  // (owner, admin, editor can edit; viewer can only view)
  const effectiveLevel = ['owner', 'admin', 'editor'].includes(userAppRole) ? 'edit' : 'view';

  // Owners and admins can see ALL dashboards
  // Everyone else can only see:
  // - Dashboards they own
  // - Dashboards they have direct user access to
  // - Dashboards where they're in a group with access
  const isAdminOrOwner = ['owner', 'admin'].includes(userAppRole);

  let result;
  
  if (isAdminOrOwner) {
    // Owners and admins see all dashboards
    result = await query(`
      SELECT DISTINCT
        d.id, d.name, d.description, d.warehouse, d.role,
        d.visibility, d.is_published, d.created_at, d.updated_at,
        d.owner_id, d.folder_id,
        owner.username as owner_username,
        c.username as snowflake_username,
        c.name as connection_name,
        f.name as folder_name,
        CASE 
          WHEN d.owner_id = $1 THEN 'owner'
          ELSE $2
        END as access_level
      FROM dashboards d
      JOIN users owner ON d.owner_id = owner.id
      LEFT JOIN snowflake_connections c ON d.connection_id = c.id
      LEFT JOIN dashboard_folders f ON d.folder_id = f.id
      ORDER BY d.updated_at DESC
    `, [userId, effectiveLevel]);
  } else {
    // Regular users see:
    // - Dashboards they own
    // - Dashboards they have direct user access to
    // - Dashboards where they're in a group with access
    // - Public published dashboards (visible to everyone)
    result = await query(`
      SELECT DISTINCT
        d.id, d.name, d.description, d.warehouse, d.role,
        d.visibility, d.is_published, d.created_at, d.updated_at,
        d.owner_id, d.folder_id,
        owner.username as owner_username,
        c.username as snowflake_username,
        c.name as connection_name,
        f.name as folder_name,
        CASE 
          WHEN d.owner_id = $1 THEN 'owner'
          ELSE $3
        END as access_level
      FROM dashboards d
      JOIN users owner ON d.owner_id = owner.id
      LEFT JOIN snowflake_connections c ON d.connection_id = c.id
      LEFT JOIN dashboard_folders f ON d.folder_id = f.id
      LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
      LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id = ANY($2::uuid[])
      WHERE 
        d.owner_id = $1
        OR dua.user_id = $1
        OR dga.group_id = ANY($2::uuid[])
        OR (d.visibility = 'public' AND d.is_published = true)
      ORDER BY d.updated_at DESC
    `, [userId, groupIds.length > 0 ? groupIds : [null], effectiveLevel]);
  }

  return result.rows;
}

/**
 * Get a specific dashboard by ID
 */
export async function getDashboardById(dashboardId) {
  const result = await query(`
    SELECT 
      d.id, d.name, d.description, d.warehouse, d.role,
      d.yaml_definition, d.visibility, d.is_published,
      d.created_at, d.updated_at, d.owner_id, d.connection_id, d.folder_id,
      owner.username as owner_username,
      c.name as connection_name, c.account as connection_account,
      c.username as snowflake_username,
      f.name as folder_name
    FROM dashboards d
    JOIN users owner ON d.owner_id = owner.id
    LEFT JOIN dashboard_folders f ON d.folder_id = f.id
    LEFT JOIN snowflake_connections c ON d.connection_id = c.id
    WHERE d.id = $1
  `, [dashboardId]);

  return result.rows[0] || null;
}

/**
 * Check if user has access to a dashboard
 * 
 * Access model:
 * - Dashboard owner: Full control
 * - Private dashboards: User must be in a group with access
 * - Public dashboards: Any user can access
 * 
 * Permissions are determined by user's APP ROLE, not group:
 * - owner/admin: Can edit
 * - editor: Can edit  
 * - viewer: Can only view
 */
export async function checkDashboardAccess(dashboardId, userId, requiredLevel = 'view', userAppRole = null) {
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard) {
    return { hasAccess: false, accessLevel: null, exists: false };
  }

  // Dashboard owner has full access
  if (dashboard.owner_id === userId) {
    return { hasAccess: true, accessLevel: 'owner', exists: true };
  }

  // Determine user's effective permission based on their app role
  // (owner, admin, editor can edit; viewer can only view)
  const getEffectiveLevel = (appRole) => {
    switch (appRole) {
      case 'owner':
      case 'admin':
      case 'editor':
        return 'edit';
      case 'viewer':
      default:
        return 'view';
    }
  };

  const effectiveLevel = userAppRole ? getEffectiveLevel(userAppRole) : 'view';

  // Check direct user access (for backwards compatibility)
  const userAccess = await query(
    'SELECT access_level FROM dashboard_user_access WHERE dashboard_id = $1 AND user_id = $2',
    [dashboardId, userId]
  );

  if (userAccess.rows.length > 0) {
    // User has direct access - their permission is based on their app role
    return { hasAccess: meetsAccessLevel(effectiveLevel, requiredLevel), accessLevel: effectiveLevel, exists: true };
  }

  // For private dashboards, check group access
  if (dashboard.visibility === 'private') {
    const userGroups = await getGroupsForUser(userId);
    for (const group of userGroups) {
      const hasGroupAccess = await query(
        'SELECT id FROM dashboard_group_access WHERE dashboard_id = $1 AND group_id = $2',
        [dashboardId, group.id]
      );
      if (hasGroupAccess.rows.length > 0) {
        // User is in a group with access - permission based on app role
        return { hasAccess: meetsAccessLevel(effectiveLevel, requiredLevel), accessLevel: effectiveLevel, exists: true };
      }
    }
    // Private dashboard and user not in any group with access
    return { hasAccess: false, accessLevel: null, exists: true };
  }

  // Public dashboard - anyone can access, permission based on app role
  if (dashboard.visibility === 'public') {
    return { hasAccess: meetsAccessLevel(effectiveLevel, requiredLevel), accessLevel: effectiveLevel, exists: true };
  }

  return { hasAccess: false, accessLevel: null, exists: true };
}

/**
 * Check if access level meets requirement
 */
function meetsAccessLevel(actual, required) {
  const levels = { view: 1, edit: 2, admin: 3, owner: 4 };
  return (levels[actual] || 0) >= (levels[required] || 0);
}

/**
 * Create a new dashboard
 */
export async function createDashboard(dashboardData, ownerId) {
  const {
    name,
    description,
    connectionId,
    warehouse,
    role,
    visibility = 'private',
    isPublished = false,
    yamlDefinition,
    folderId = null,
  } = dashboardData;

  // Validate required fields
  if (!name || !connectionId || !warehouse || !role) {
    throw new Error('Name, connection, warehouse, and role are required');
  }

  // Verify connection belongs to user
  const connection = await query(
    'SELECT id FROM snowflake_connections WHERE id = $1 AND user_id = $2',
    [connectionId, ownerId]
  );

  if (connection.rows.length === 0) {
    throw new Error('Invalid connection');
  }

  const result = await query(`
    INSERT INTO dashboards 
      (name, description, owner_id, connection_id, warehouse, role, 
       visibility, is_published, yaml_definition, folder_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [
    name,
    description || null,
    ownerId,
    connectionId,
    warehouse,
    role,
    visibility,
    isPublished,
    yamlDefinition || null,
    folderId,
  ]);

  // Return full dashboard with connection details
  return getDashboardById(result.rows[0].id);
}

/**
 * Update a dashboard
 */
export async function updateDashboard(dashboardId, updates, userId, userAppRole = null) {
  // Check access - pass user's app role for proper permission check
  const { hasAccess, accessLevel } = await checkDashboardAccess(dashboardId, userId, 'edit', userAppRole);
  if (!hasAccess) {
    throw new Error('You do not have permission to edit this dashboard');
  }

  const allowedFields = ['name', 'description', 'warehouse', 'role', 
                          'visibility', 'is_published', 'yaml_definition', 'folder_id'];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key === 'yamlDefinition' ? 'yaml_definition' :
                  key === 'isPublished' ? 'is_published' :
                  key.replace(/([A-Z])/g, '_$1').toLowerCase();
    
    if (allowedFields.includes(dbKey)) {
      setClauses.push(`${dbKey} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(dashboardId);
  const result = await query(`
    UPDATE dashboards
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, description, warehouse, role, visibility, 
              is_published, yaml_definition, updated_at
  `, values);

  return result.rows[0];
}

/**
 * Delete a dashboard
 */
export async function deleteDashboard(dashboardId, userId, userAppRole = null) {
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }

  // Only dashboard owner or app-level owner/admin can delete
  const isDashboardOwner = dashboard.owner_id === userId;
  const isAppAdmin = ['owner', 'admin'].includes(userAppRole);
  
  if (!isDashboardOwner && !isAppAdmin) {
    throw new Error('Only the dashboard owner or an admin can delete this dashboard');
  }

  await query('DELETE FROM dashboards WHERE id = $1', [dashboardId]);
  return true;
}

/**
 * Grant user access to a dashboard
 */
export async function grantUserAccess(dashboardId, targetUserId, accessLevel, grantedBy) {
  // Check grantor has permission
  const { accessLevel: granterLevel } = await checkDashboardAccess(dashboardId, grantedBy);
  
  if (!granterLevel || !meetsAccessLevel(granterLevel, 'edit')) {
    throw new Error('You do not have permission to grant access');
  }

  // Can only grant lower access levels
  if (!meetsAccessLevel(granterLevel, accessLevel)) {
    throw new Error('Cannot grant access level higher than your own');
  }

  // Upsert access
  await query(`
    INSERT INTO dashboard_user_access (dashboard_id, user_id, access_level, granted_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (dashboard_id, user_id) 
    DO UPDATE SET access_level = $3, granted_by = $4, granted_at = CURRENT_TIMESTAMP
  `, [dashboardId, targetUserId, accessLevel, grantedBy]);

  return true;
}

/**
 * Revoke user access from a dashboard
 */
export async function revokeUserAccess(dashboardId, targetUserId, revokedBy) {
  const { accessLevel } = await checkDashboardAccess(dashboardId, revokedBy);
  
  if (!accessLevel || !meetsAccessLevel(accessLevel, 'admin')) {
    throw new Error('You do not have permission to revoke access');
  }

  await query(
    'DELETE FROM dashboard_user_access WHERE dashboard_id = $1 AND user_id = $2',
    [dashboardId, targetUserId]
  );

  return true;
}

/**
 * Get all users with access to a dashboard
 */
export async function getDashboardUsers(dashboardId) {
  const result = await query(`
    SELECT 
      u.id, u.username, u.email, u.display_name,
      dua.access_level, dua.granted_at,
      granter.username as granted_by_username
    FROM dashboard_user_access dua
    JOIN users u ON dua.user_id = u.id
    LEFT JOIN users granter ON dua.granted_by = granter.id
    WHERE dua.dashboard_id = $1
    ORDER BY dua.granted_at DESC
  `, [dashboardId]);

  return result.rows;
}

/**
 * Transfer dashboard ownership
 */
export async function transferOwnership(dashboardId, newOwnerId, currentOwnerId) {
  const dashboard = await getDashboardById(dashboardId);
  
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }

  if (dashboard.owner_id !== currentOwnerId) {
    throw new Error('Only the owner can transfer ownership');
  }

  // Verify new owner exists and has creator or higher role
  const newOwner = await query(
    "SELECT id, role FROM users WHERE id = $1 AND role IN ('owner', 'admin', 'creator')",
    [newOwnerId]
  );

  if (newOwner.rows.length === 0) {
    throw new Error('New owner must have at least creator role');
  }

  await query(
    'UPDATE dashboards SET owner_id = $1 WHERE id = $2',
    [newOwnerId, dashboardId]
  );

  // Add previous owner as admin
  await grantUserAccess(dashboardId, currentOwnerId, 'admin', newOwnerId);

  return true;
}

/**
 * Update dashboard connection
 */
export async function updateDashboardConnection(dashboardId, connectionId, userId) {
  // Only owner can change connection
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard || dashboard.owner_id !== userId) {
    throw new Error('Only the owner can change the connection');
  }

  // Verify connection belongs to user
  const connection = await query(
    'SELECT id FROM snowflake_connections WHERE id = $1 AND user_id = $2',
    [connectionId, userId]
  );

  if (connection.rows.length === 0) {
    throw new Error('Invalid connection');
  }

  await query(
    'UPDATE dashboards SET connection_id = $1 WHERE id = $2',
    [connectionId, dashboardId]
  );

  return true;
}

/**
 * Get all groups with access to a dashboard
 */
export async function getDashboardGroups(dashboardId) {
  const result = await query(`
    SELECT 
      g.id, g.name, g.description,
      dga.granted_at,
      granter.username as granted_by_username
    FROM dashboard_group_access dga
    JOIN user_groups g ON dga.group_id = g.id
    LEFT JOIN users granter ON dga.granted_by = granter.id
    WHERE dga.dashboard_id = $1
    ORDER BY dga.granted_at DESC
  `, [dashboardId]);

  return result.rows;
}

/**
 * Grant group access to a dashboard
 */
export async function grantGroupAccess(dashboardId, groupId, grantedBy) {
  // Check grantor has permission (must be owner or admin)
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }
  
  const { accessLevel } = await checkDashboardAccess(dashboardId, grantedBy);
  const isOwner = dashboard.owner_id === grantedBy;
  
  if (!isOwner && accessLevel !== 'admin' && accessLevel !== 'owner') {
    throw new Error('Only owner or admin can grant group access');
  }

  // Upsert access
  await query(`
    INSERT INTO dashboard_group_access (dashboard_id, group_id, granted_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (dashboard_id, group_id) 
    DO UPDATE SET granted_by = $3, granted_at = CURRENT_TIMESTAMP
  `, [dashboardId, groupId, grantedBy]);

  return true;
}

/**
 * Revoke group access from a dashboard
 */
export async function revokeGroupAccess(dashboardId, groupId, revokedBy) {
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }
  
  const { accessLevel } = await checkDashboardAccess(dashboardId, revokedBy);
  const isOwner = dashboard.owner_id === revokedBy;
  
  if (!isOwner && accessLevel !== 'admin' && accessLevel !== 'owner') {
    throw new Error('Only owner or admin can revoke group access');
  }

  await query(
    'DELETE FROM dashboard_group_access WHERE dashboard_id = $1 AND group_id = $2',
    [dashboardId, groupId]
  );

  return true;
}

/**
 * Update all group access for a dashboard (replace existing)
 */
export async function updateDashboardGroupAccess(dashboardId, groupIds, userId) {
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }
  
  const { accessLevel } = await checkDashboardAccess(dashboardId, userId);
  const isOwner = dashboard.owner_id === userId;
  
  if (!isOwner && accessLevel !== 'admin' && accessLevel !== 'owner') {
    throw new Error('Only owner or admin can update group access');
  }

  // Remove all existing group access
  await query('DELETE FROM dashboard_group_access WHERE dashboard_id = $1', [dashboardId]);
  
  // Add new group access
  for (const groupId of groupIds) {
    await query(`
      INSERT INTO dashboard_group_access (dashboard_id, group_id, granted_by)
      VALUES ($1, $2, $3)
    `, [dashboardId, groupId, userId]);
  }

  return true;
}

export default {
  getDashboardsForUser,
  getDashboardById,
  checkDashboardAccess,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  grantUserAccess,
  revokeUserAccess,
  getDashboardUsers,
  getDashboardGroups,
  grantGroupAccess,
  revokeGroupAccess,
  updateDashboardGroupAccess,
  transferOwnership,
  updateDashboardConnection,
};
