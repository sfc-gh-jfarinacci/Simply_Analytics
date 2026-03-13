import crypto from 'crypto';
import { query, transaction, now } from '../db/db.js';
import { getGroupsForUser, isUserInGroup } from './groupService.js';

export async function getDashboardsForUser(userId, userAppRole) {
  const userGroups = await getGroupsForUser(userId);
  const groupIds = userGroups.map(g => g.id);

  const effectiveLevel = ['owner', 'admin', 'editor'].includes(userAppRole) ? 'edit' : 'view';

  const isAdminOrOwner = ['owner', 'admin'].includes(userAppRole);

  let result;
  
  if (isAdminOrOwner) {
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
  } else if (groupIds.length === 0) {
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
      LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
      WHERE 
        d.owner_id = $1
        OR dua.user_id = $1
        OR (d.visibility = 'public' AND d.is_published = true)
      ORDER BY d.updated_at DESC
    `, [userId, effectiveLevel]);
  } else {
    const groupPlaceholders = groupIds.map((_, i) => `$${i + 2}`).join(',');
    const effectiveLevelIdx = groupIds.length + 2;
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
          ELSE $${effectiveLevelIdx}
        END as access_level
      FROM dashboards d
      JOIN users owner ON d.owner_id = owner.id
      LEFT JOIN snowflake_connections c ON d.connection_id = c.id
      LEFT JOIN dashboard_folders f ON d.folder_id = f.id
      LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
      LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id IN (${groupPlaceholders})
      WHERE 
        d.owner_id = $1
        OR dua.user_id = $1
        OR dga.group_id IN (${groupPlaceholders})
        OR (d.visibility = 'public' AND d.is_published = true)
      ORDER BY d.updated_at DESC
    `, [userId, ...groupIds, effectiveLevel]);
  }

  return result.rows;
}

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

export async function checkDashboardAccess(dashboardId, userId, requiredLevel = 'view', userAppRole = null) {
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard) {
    return { hasAccess: false, accessLevel: null, exists: false };
  }

  if (dashboard.owner_id === userId) {
    return { hasAccess: true, accessLevel: 'owner', exists: true };
  }

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

  const userAccess = await query(
    'SELECT access_level FROM dashboard_user_access WHERE dashboard_id = $1 AND user_id = $2',
    [dashboardId, userId]
  );

  if (userAccess.rows.length > 0) {
    return { hasAccess: meetsAccessLevel(effectiveLevel, requiredLevel), accessLevel: effectiveLevel, exists: true };
  }

  if (dashboard.visibility === 'private') {
    const userGroups = await getGroupsForUser(userId);
    for (const group of userGroups) {
      const hasGroupAccess = await query(
        'SELECT id FROM dashboard_group_access WHERE dashboard_id = $1 AND group_id = $2',
        [dashboardId, group.id]
      );
      if (hasGroupAccess.rows.length > 0) {
        return { hasAccess: meetsAccessLevel(effectiveLevel, requiredLevel), accessLevel: effectiveLevel, exists: true };
      }
    }
    return { hasAccess: false, accessLevel: null, exists: true };
  }

  if (dashboard.visibility === 'public') {
    return { hasAccess: meetsAccessLevel(effectiveLevel, requiredLevel), accessLevel: effectiveLevel, exists: true };
  }

  return { hasAccess: false, accessLevel: null, exists: true };
}

function meetsAccessLevel(actual, required) {
  const levels = { view: 1, edit: 2, admin: 3, owner: 4 };
  return (levels[actual] || 0) >= (levels[required] || 0);
}

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

  if (!name || !connectionId || !warehouse || !role) {
    throw new Error('Name, connection, warehouse, and role are required');
  }

  const connection = await query(
    'SELECT id FROM snowflake_connections WHERE id = $1 AND user_id = $2',
    [connectionId, ownerId]
  );

  if (connection.rows.length === 0) {
    throw new Error('Invalid connection');
  }

  const id = crypto.randomUUID();

  await query(`
    INSERT INTO dashboards 
      (id, name, description, owner_id, connection_id, warehouse, role, 
       visibility, is_published, yaml_definition, folder_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [
    id,
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

  return getDashboardById(id);
}

export async function updateDashboard(dashboardId, updates, userId, userAppRole = null) {
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
  await query(`
    UPDATE dashboards
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
  `, values);

  const result = await query(`
    SELECT id, name, description, warehouse, role, visibility, 
           is_published, yaml_definition, updated_at
    FROM dashboards WHERE id = $1
  `, [dashboardId]);

  return result.rows[0];
}

export async function deleteDashboard(dashboardId, userId, userAppRole = null) {
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }

  const isDashboardOwner = dashboard.owner_id === userId;
  const isAppAdmin = ['owner', 'admin'].includes(userAppRole);
  
  if (!isDashboardOwner && !isAppAdmin) {
    throw new Error('Only the dashboard owner or an admin can delete this dashboard');
  }

  await query('DELETE FROM dashboards WHERE id = $1', [dashboardId]);
  return true;
}

export async function grantUserAccess(dashboardId, targetUserId, accessLevel, grantedBy) {
  const { accessLevel: granterLevel } = await checkDashboardAccess(dashboardId, grantedBy);
  
  if (!granterLevel || !meetsAccessLevel(granterLevel, 'edit')) {
    throw new Error('You do not have permission to grant access');
  }

  if (!meetsAccessLevel(granterLevel, accessLevel)) {
    throw new Error('Cannot grant access level higher than your own');
  }

  const existing = await query(
    'SELECT id FROM dashboard_user_access WHERE dashboard_id = $1 AND user_id = $2',
    [dashboardId, targetUserId]
  );

  if (existing.rows.length > 0) {
    await query(`
      UPDATE dashboard_user_access
      SET access_level = $1, granted_by = $2, granted_at = ${now()}
      WHERE dashboard_id = $3 AND user_id = $4
    `, [accessLevel, grantedBy, dashboardId, targetUserId]);
  } else {
    const id = crypto.randomUUID();
    await query(`
      INSERT INTO dashboard_user_access (id, dashboard_id, user_id, access_level, granted_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, dashboardId, targetUserId, accessLevel, grantedBy]);
  }

  return true;
}

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

export async function transferOwnership(dashboardId, newOwnerId, currentOwnerId) {
  const dashboard = await getDashboardById(dashboardId);
  
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }

  if (dashboard.owner_id !== currentOwnerId) {
    throw new Error('Only the owner can transfer ownership');
  }

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

  await grantUserAccess(dashboardId, currentOwnerId, 'admin', newOwnerId);

  return true;
}

export async function updateDashboardConnection(dashboardId, connectionId, userId) {
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard || dashboard.owner_id !== userId) {
    throw new Error('Only the owner can change the connection');
  }

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

export async function grantGroupAccess(dashboardId, groupId, grantedBy) {
  const dashboard = await getDashboardById(dashboardId);
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }
  
  const { accessLevel } = await checkDashboardAccess(dashboardId, grantedBy);
  const isOwner = dashboard.owner_id === grantedBy;
  
  if (!isOwner && accessLevel !== 'admin' && accessLevel !== 'owner') {
    throw new Error('Only owner or admin can grant group access');
  }

  const existing = await query(
    'SELECT id FROM dashboard_group_access WHERE dashboard_id = $1 AND group_id = $2',
    [dashboardId, groupId]
  );

  if (existing.rows.length > 0) {
    await query(`
      UPDATE dashboard_group_access
      SET granted_by = $1, granted_at = ${now()}
      WHERE dashboard_id = $2 AND group_id = $3
    `, [grantedBy, dashboardId, groupId]);
  } else {
    const id = crypto.randomUUID();
    await query(`
      INSERT INTO dashboard_group_access (id, dashboard_id, group_id, granted_by)
      VALUES ($1, $2, $3, $4)
    `, [id, dashboardId, groupId, grantedBy]);
  }

  return true;
}

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

  await query('DELETE FROM dashboard_group_access WHERE dashboard_id = $1', [dashboardId]);
  
  for (const groupId of groupIds) {
    const id = crypto.randomUUID();
    await query(`
      INSERT INTO dashboard_group_access (id, dashboard_id, group_id, granted_by)
      VALUES ($1, $2, $3, $4)
    `, [id, dashboardId, groupId, userId]);
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
