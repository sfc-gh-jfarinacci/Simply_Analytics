/**
 * Folder Service - CRUD operations for dashboard folders
 */

import { query } from '../db/postgres.js';
import { getGroupsForUser } from './groupService.js';

/**
 * Check if user has access to a folder
 * Returns true if:
 * - User is owner/admin
 * - User owns the folder
 * - Folder is public
 * - User is in a group with folder access
 */
export async function checkFolderAccess(folderId, userId, userRole) {
  if (['owner', 'admin'].includes(userRole)) {
    return true;
  }
  
  const userGroups = await getGroupsForUser(userId);
  const groupIds = userGroups.map(g => g.id);
  
  const result = await query(`
    SELECT f.id
    FROM dashboard_folders f
    LEFT JOIN folder_group_access fga ON f.id = fga.folder_id AND fga.group_id = ANY($3::uuid[])
    WHERE f.id = $1
      AND (f.owner_id = $2 OR f.is_public = true OR fga.group_id IS NOT NULL)
    LIMIT 1
  `, [folderId, userId, groupIds.length > 0 ? groupIds : [null]]);
  
  return result.rows.length > 0;
}

/**
 * Get all folders accessible to a user
 * User can see folders they:
 * - Own
 * - Are public
 * - Have group access to
 * - Contain dashboards they have access to
 */
export async function getFoldersForUser(userId, userRole) {
  const isAdmin = ['owner', 'admin'].includes(userRole);
  
  if (isAdmin) {
    const result = await query(`
      SELECT 
        f.*,
        u.username as owner_name,
        (SELECT COUNT(*) FROM dashboards WHERE folder_id = f.id) as dashboard_count
      FROM dashboard_folders f
      LEFT JOIN users u ON f.owner_id = u.id
      ORDER BY f.name ASC
    `, []);
    return result.rows;
  }
  
  // For non-admins, get folders they have access to
  const userGroups = await getGroupsForUser(userId);
  const groupIds = userGroups.map(g => g.id);
  
  const result = await query(`
    SELECT DISTINCT
      f.*,
      u.username as owner_name,
      (SELECT COUNT(*) FROM dashboards WHERE folder_id = f.id) as dashboard_count
    FROM dashboard_folders f
    LEFT JOIN users u ON f.owner_id = u.id
    LEFT JOIN folder_group_access fga ON f.id = fga.folder_id AND fga.group_id = ANY($2::uuid[])
    LEFT JOIN dashboards d ON d.folder_id = f.id
    LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id = ANY($2::uuid[])
    LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
    WHERE 
      f.owner_id = $1 
      OR f.is_public = true 
      OR fga.group_id IS NOT NULL
      OR d.owner_id = $1
      OR dga.group_id IS NOT NULL
      OR dua.user_id IS NOT NULL
    ORDER BY f.name ASC
  `, [userId, groupIds.length > 0 ? groupIds : [null]]);
  
  return result.rows;
}

/**
 * Get folders at a specific level (root or within a parent)
 * Access control:
 * - Admins see all folders and dashboards
 * - Non-admins see folders they: own, are public, have group access to, or contain accessible dashboards
 * - Non-admins see dashboards they: own, have direct access to, have group access to, or are public
 * - If user has folder access, they see ALL dashboards in that folder
 */
export async function getFolderContents(userId, userRole, parentId = null) {
  const isAdmin = ['owner', 'admin'].includes(userRole);
  const userGroups = await getGroupsForUser(userId);
  const groupIds = userGroups.map(g => g.id);
  
  // If viewing inside a folder, don't show any folders (nested folders disabled)
  // Only show folders at root level
  if (parentId) {
    // Inside a folder - no subfolders to show
    const foldersResult = { rows: [] };
    
    // Get dashboards in this folder
    let dashboardSql, dashboardParams;
    
    if (isAdmin) {
      // Admins see all dashboards, but drafts only if they are the owner
      dashboardSql = `
        SELECT 
          d.id, d.name, d.description, d.visibility, d.is_published,
          d.created_at, d.updated_at, d.folder_id,
          u.username as owner_name,
          d.owner_id = $2 as is_owner
        FROM dashboards d
        LEFT JOIN users u ON d.owner_id = u.id
        WHERE d.folder_id = $1
          AND (d.is_published = true OR d.owner_id = $2)
        ORDER BY d.name ASC
      `;
      dashboardParams = [parentId, userId];
    } else {
      // Check if user has folder access
      const hasFolderAccess = await checkFolderAccess(parentId, userId, userRole);
      
      if (hasFolderAccess) {
        // User has folder access - show published dashboards + own drafts
        dashboardSql = `
          SELECT 
            d.id, d.name, d.description, d.visibility, d.is_published,
            d.created_at, d.updated_at, d.folder_id,
            u.username as owner_name,
            d.owner_id = $2 as is_owner
          FROM dashboards d
          LEFT JOIN users u ON d.owner_id = u.id
          WHERE d.folder_id = $1
            AND (d.is_published = true OR d.owner_id = $2)
          ORDER BY d.name ASC
        `;
        dashboardParams = [parentId, userId];
      } else {
        // User only has access to specific dashboards - show published or own drafts
        dashboardSql = `
          SELECT DISTINCT
            d.id, d.name, d.description, d.visibility, d.is_published,
            d.created_at, d.updated_at, d.folder_id,
            u.username as owner_name,
            d.owner_id = $2 as is_owner
          FROM dashboards d
          LEFT JOIN users u ON d.owner_id = u.id
          LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $2
          LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id = ANY($3::uuid[])
          WHERE d.folder_id = $1
            AND (d.is_published = true OR d.owner_id = $2)
            AND (d.owner_id = $2 OR dua.user_id = $2 OR dga.group_id = ANY($3::uuid[]) OR (d.visibility = 'public' AND d.is_published = true))
          ORDER BY d.name ASC
        `;
        dashboardParams = [parentId, userId, groupIds.length > 0 ? groupIds : [null]];
      }
    }
    
    const dashboardsResult = await query(dashboardSql, dashboardParams);
    return {
      folders: foldersResult.rows,
      dashboards: dashboardsResult.rows
    };
  }
  
  // At root level - show folders and root-level dashboards
  let folderSql, dashboardSql;
  let folderParams, dashboardParams;
  
  if (isAdmin) {
    // Admins see all folders at root level, count only published + own drafts
    folderSql = `
      SELECT 
        f.*,
        u.username as owner_name,
        f.owner_id = $1 as is_owner,
        (SELECT COUNT(*) FROM dashboards d2 WHERE d2.folder_id = f.id AND (d2.is_published = true OR d2.owner_id = $1)) as dashboard_count
      FROM dashboard_folders f
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.parent_id IS NULL
      ORDER BY f.name ASC
    `;
    folderParams = [userId];
    
    // Admins see all root-level dashboards, but drafts only if owner
    dashboardSql = `
      SELECT 
        d.id, d.name, d.description, d.visibility, d.is_published,
        d.created_at, d.updated_at, d.folder_id,
        u.username as owner_name,
        d.owner_id = $1 as is_owner
      FROM dashboards d
      LEFT JOIN users u ON d.owner_id = u.id
      WHERE d.folder_id IS NULL
        AND (d.is_published = true OR d.owner_id = $1)
      ORDER BY d.name ASC
    `;
    dashboardParams = [userId];
  } else {
    // Non-admins: show folders they have access to or contain accessible dashboards
    // Count only published dashboards + own drafts
    folderSql = `
      SELECT DISTINCT
        f.*,
        u.username as owner_name,
        f.owner_id = $1 as is_owner,
        (SELECT COUNT(*) FROM dashboards d2 WHERE d2.folder_id = f.id AND (d2.is_published = true OR d2.owner_id = $1)) as dashboard_count,
        CASE WHEN f.owner_id = $1 OR f.is_public = true OR fga.group_id IS NOT NULL THEN true ELSE false END as has_folder_access
      FROM dashboard_folders f
      LEFT JOIN users u ON f.owner_id = u.id
      LEFT JOIN folder_group_access fga ON f.id = fga.folder_id AND fga.group_id = ANY($2::uuid[])
      LEFT JOIN dashboards d ON d.folder_id = f.id AND (d.is_published = true OR d.owner_id = $1)
      LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id = ANY($2::uuid[])
      LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
      WHERE f.parent_id IS NULL
        AND (
          f.owner_id = $1 
          OR f.is_public = true 
          OR fga.group_id IS NOT NULL
          OR d.owner_id = $1
          OR dga.group_id IS NOT NULL
          OR dua.user_id IS NOT NULL
          OR (d.visibility = 'public' AND d.is_published = true)
        )
      ORDER BY f.name ASC
    `;
    folderParams = [userId, groupIds.length > 0 ? groupIds : [null]];
    
    // Root level dashboards only - show published or own drafts
    dashboardSql = `
      SELECT DISTINCT
        d.id, d.name, d.description, d.visibility, d.is_published,
        d.created_at, d.updated_at, d.folder_id,
        u.username as owner_name,
        d.owner_id = $1 as is_owner
      FROM dashboards d
      LEFT JOIN users u ON d.owner_id = u.id
      LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
      LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id = ANY($2::uuid[])
      WHERE d.folder_id IS NULL
        AND (d.is_published = true OR d.owner_id = $1)
        AND (d.owner_id = $1 OR dua.user_id = $1 OR dga.group_id = ANY($2::uuid[]) OR (d.visibility = 'public' AND d.is_published = true))
      ORDER BY d.name ASC
    `;
    dashboardParams = [userId, groupIds.length > 0 ? groupIds : [null]];
  }
  
  const [foldersResult, dashboardsResult] = await Promise.all([
    query(folderSql, folderParams),
    query(dashboardSql, dashboardParams)
  ]);
  
  return {
    folders: foldersResult.rows,
    dashboards: dashboardsResult.rows
  };
}

/**
 * Get a folder by ID
 */
export async function getFolderById(folderId) {
  const result = await query(
    `SELECT f.*, u.username as owner_name
     FROM dashboard_folders f
     LEFT JOIN users u ON f.owner_id = u.id
     WHERE f.id = $1`,
    [folderId]
  );
  return result.rows[0] || null;
}

/**
 * Get folder path (breadcrumb)
 */
export async function getFolderPath(folderId) {
  const path = [];
  let currentId = folderId;
  
  while (currentId) {
    const result = await query(
      'SELECT id, name, parent_id FROM dashboard_folders WHERE id = $1',
      [currentId]
    );
    
    if (result.rows.length === 0) break;
    
    const folder = result.rows[0];
    path.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parent_id;
  }
  
  return path;
}

/**
 * Create a new folder
 */
export async function createFolder(folderData) {
  const { name, description, parentId, ownerId, isPublic, icon, color } = folderData;
  
  // Nested folders are not allowed - all folders must be at root level
  if (parentId) {
    throw new Error('Nested folders are not supported. All folders must be at the root level.');
  }
  
  // Check for duplicate folder name (case-insensitive)
  const existingFolder = await query(
    `SELECT id FROM dashboard_folders WHERE LOWER(name) = LOWER($1)`,
    [name.trim()]
  );
  
  if (existingFolder.rows.length > 0) {
    throw new Error('A folder with this name already exists');
  }
  
  const result = await query(
    `INSERT INTO dashboard_folders (name, description, parent_id, owner_id, is_public, icon, color)
     VALUES ($1, $2, NULL, $3, $4, $5, $6)
     RETURNING *`,
    [name.trim(), description || null, ownerId, isPublic || false, icon || 'folder', color || '#6366f1']
  );
  
  return result.rows[0];
}

/**
 * Update a folder
 */
export async function updateFolder(folderId, updates) {
  const { name, description, isPublic, icon, color } = updates;
  
  // Check for duplicate folder name if name is being updated (case-insensitive)
  if (name) {
    const existingFolder = await query(
      `SELECT id FROM dashboard_folders WHERE LOWER(name) = LOWER($1) AND id != $2`,
      [name.trim(), folderId]
    );
    
    if (existingFolder.rows.length > 0) {
      throw new Error('A folder with this name already exists');
    }
  }
  
  // Note: parentId is intentionally not updatable - nested folders are not allowed
  const result = await query(
    `UPDATE dashboard_folders 
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         is_public = COALESCE($3, is_public),
         icon = COALESCE($4, icon),
         color = COALESCE($5, color)
     WHERE id = $6
     RETURNING *`,
    [name ? name.trim() : name, description, isPublic, icon, color, folderId]
  );
  
  return result.rows[0];
}

/**
 * Delete a folder
 */
export async function deleteFolder(folderId) {
  // Check if folder has dashboards
  const contents = await query(
    `SELECT COUNT(*) as dashboard_count FROM dashboards WHERE folder_id = $1`,
    [folderId]
  );
  
  const dashboardCount = parseInt(contents.rows[0].dashboard_count);
  
  if (dashboardCount > 0) {
    throw new Error(`Cannot delete folder: it contains ${dashboardCount} dashboard${dashboardCount > 1 ? 's' : ''}. Move or delete the dashboards first.`);
  }
  
  await query('DELETE FROM dashboard_folders WHERE id = $1', [folderId]);
  return true;
}

/**
 * Move a dashboard to a folder
 */
export async function moveDashboardToFolder(dashboardId, folderId) {
  const result = await query(
    'UPDATE dashboards SET folder_id = $1 WHERE id = $2 RETURNING *',
    [folderId, dashboardId]
  );
  return result.rows[0];
}

/**
 * Search folders and dashboards
 */
export async function searchFoldersAndDashboards(userId, userRole, searchTerm) {
  const isAdmin = ['owner', 'admin'].includes(userRole);
  const searchPattern = `%${searchTerm.toLowerCase()}%`;
  
  let folderSql, dashboardSql;
  let folderParams, dashboardParams;
  
  if (isAdmin) {
    folderSql = `
      SELECT 
        f.*,
        'folder' as type,
        u.username as owner_name,
        f.owner_id = $2 as is_owner
      FROM dashboard_folders f
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE LOWER(f.name) LIKE $1 OR LOWER(f.description) LIKE $1
      ORDER BY f.name ASC
      LIMIT 20
    `;
    folderParams = [searchPattern, userId];
    
    // Admins see all matching dashboards, but drafts only if owner
    dashboardSql = `
      SELECT 
        d.id, d.name, d.description, d.visibility, d.is_published,
        d.created_at, d.updated_at, d.folder_id,
        'dashboard' as type,
        u.username as owner_name,
        d.owner_id = $2 as is_owner
      FROM dashboards d
      LEFT JOIN users u ON d.owner_id = u.id
      WHERE (LOWER(d.name) LIKE $1 OR LOWER(d.description) LIKE $1)
        AND (d.is_published = true OR d.owner_id = $2)
      ORDER BY d.name ASC
      LIMIT 20
    `;
    dashboardParams = [searchPattern, userId];
  } else {
    // Get user's groups first
    const userGroups = await getGroupsForUser(userId);
    const groupIds = userGroups.map(g => g.id);
    const groupIdsParam = groupIds.length > 0 ? groupIds : [null];
    
    // Non-admins can see folders they own, public folders, or folders with group access
    folderSql = `
      SELECT DISTINCT
        f.*,
        'folder' as type,
        u.username as owner_name,
        f.owner_id = $2 as is_owner
      FROM dashboard_folders f
      LEFT JOIN users u ON f.owner_id = u.id
      LEFT JOIN folder_group_access fga ON f.id = fga.folder_id AND fga.group_id = ANY($3::uuid[])
      WHERE (LOWER(f.name) LIKE $1 OR LOWER(f.description) LIKE $1)
        AND (
          f.owner_id = $2 
          OR f.is_public = true
          OR fga.group_id IS NOT NULL
        )
      ORDER BY f.name ASC
      LIMIT 20
    `;
    folderParams = [searchPattern, userId, groupIdsParam];
    
    // Non-admins see published dashboards they have access to, plus own drafts
    dashboardSql = `
      SELECT DISTINCT
        d.id, d.name, d.description, d.visibility, d.is_published,
        d.created_at, d.updated_at, d.folder_id,
        'dashboard' as type,
        u.username as owner_name,
        d.owner_id = $2 as is_owner
      FROM dashboards d
      LEFT JOIN users u ON d.owner_id = u.id
      LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $2
      LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id = ANY($3::uuid[])
      LEFT JOIN folder_group_access fga ON d.folder_id = fga.folder_id AND fga.group_id = ANY($3::uuid[])
      WHERE (LOWER(d.name) LIKE $1 OR LOWER(d.description) LIKE $1)
        AND (d.is_published = true OR d.owner_id = $2)
        AND (
          d.owner_id = $2
          OR dua.user_id = $2
          OR dga.group_id IS NOT NULL
          OR fga.group_id IS NOT NULL
          OR (d.visibility = 'public' AND d.is_published = true)
        )
      ORDER BY d.name ASC
      LIMIT 20
    `;
    dashboardParams = [searchPattern, userId, groupIdsParam];
  }
  
  const [foldersResult, dashboardsResult] = await Promise.all([
    query(folderSql, folderParams),
    query(dashboardSql, dashboardParams)
  ]);
  
  return {
    folders: foldersResult.rows,
    dashboards: dashboardsResult.rows
  };
}

// ============================================
// FOLDER ACCESS MANAGEMENT
// ============================================

/**
 * Get groups with access to a folder
 */
export async function getFolderGroups(folderId) {
  const result = await query(`
    SELECT 
      g.id, g.name, g.description,
      fga.granted_at,
      u.username as granted_by_name
    FROM folder_group_access fga
    JOIN user_groups g ON fga.group_id = g.id
    LEFT JOIN users u ON fga.granted_by = u.id
    WHERE fga.folder_id = $1
    ORDER BY g.name ASC
  `, [folderId]);
  
  return result.rows;
}

/**
 * Grant a group access to a folder
 */
export async function grantFolderAccess(folderId, groupId, grantedBy) {
  await query(`
    INSERT INTO folder_group_access (folder_id, group_id, granted_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (folder_id, group_id) DO NOTHING
  `, [folderId, groupId, grantedBy]);
  
  return true;
}

/**
 * Revoke a group's access to a folder
 */
export async function revokeFolderAccess(folderId, groupId) {
  await query(`
    DELETE FROM folder_group_access
    WHERE folder_id = $1 AND group_id = $2
  `, [folderId, groupId]);
  
  return true;
}
