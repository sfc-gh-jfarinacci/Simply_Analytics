import crypto from 'crypto';
import { query } from '../db/db.js';
import { getGroupsForUser } from './groupService.js';

export async function checkFolderAccess(folderId, userId, userRole) {
  if (['owner', 'admin'].includes(userRole)) {
    return true;
  }
  
  const userGroups = await getGroupsForUser(userId);
  const groupIds = userGroups.map(g => g.id);
  
  if (groupIds.length === 0) {
    const result = await query(`
      SELECT f.id
      FROM dashboard_folders f
      WHERE f.id = $1
        AND (f.owner_id = $2 OR f.is_public = true)
      LIMIT 1
    `, [folderId, userId]);
    return result.rows.length > 0;
  }
  
  const groupPlaceholders = groupIds.map((_, i) => `$${i + 3}`).join(',');
  const result = await query(`
    SELECT f.id
    FROM dashboard_folders f
    LEFT JOIN folder_group_access fga ON f.id = fga.folder_id AND fga.group_id IN (${groupPlaceholders})
    WHERE f.id = $1
      AND (f.owner_id = $2 OR f.is_public = true OR fga.group_id IS NOT NULL)
    LIMIT 1
  `, [folderId, userId, ...groupIds]);
  
  return result.rows.length > 0;
}

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
  
  const userGroups = await getGroupsForUser(userId);
  const groupIds = userGroups.map(g => g.id);
  
  if (groupIds.length === 0) {
    const result = await query(`
      SELECT DISTINCT
        f.*,
        u.username as owner_name,
        (SELECT COUNT(*) FROM dashboards WHERE folder_id = f.id) as dashboard_count
      FROM dashboard_folders f
      LEFT JOIN users u ON f.owner_id = u.id
      LEFT JOIN dashboards d ON d.folder_id = f.id
      LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
      WHERE 
        f.owner_id = $1 
        OR f.is_public = true 
        OR d.owner_id = $1
        OR dua.user_id IS NOT NULL
      ORDER BY f.name ASC
    `, [userId]);
    return result.rows;
  }
  
  const groupPlaceholders = groupIds.map((_, i) => `$${i + 2}`).join(',');
  const result = await query(`
    SELECT DISTINCT
      f.*,
      u.username as owner_name,
      (SELECT COUNT(*) FROM dashboards WHERE folder_id = f.id) as dashboard_count
    FROM dashboard_folders f
    LEFT JOIN users u ON f.owner_id = u.id
    LEFT JOIN folder_group_access fga ON f.id = fga.folder_id AND fga.group_id IN (${groupPlaceholders})
    LEFT JOIN dashboards d ON d.folder_id = f.id
    LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id IN (${groupPlaceholders})
    LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
    WHERE 
      f.owner_id = $1 
      OR f.is_public = true 
      OR fga.group_id IS NOT NULL
      OR d.owner_id = $1
      OR dga.group_id IS NOT NULL
      OR dua.user_id IS NOT NULL
    ORDER BY f.name ASC
  `, [userId, ...groupIds]);
  
  return result.rows;
}

export async function getFolderContents(userId, userRole, parentId = null) {
  const isAdmin = ['owner', 'admin'].includes(userRole);
  const userGroups = await getGroupsForUser(userId);
  const groupIds = userGroups.map(g => g.id);
  
  if (parentId) {
    const foldersResult = { rows: [] };
    
    let dashboardSql, dashboardParams;
    
    if (isAdmin) {
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
      const hasFolderAccess = await checkFolderAccess(parentId, userId, userRole);
      
      if (hasFolderAccess) {
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
        if (groupIds.length === 0) {
          dashboardSql = `
            SELECT DISTINCT
              d.id, d.name, d.description, d.visibility, d.is_published,
              d.created_at, d.updated_at, d.folder_id,
              u.username as owner_name,
              d.owner_id = $2 as is_owner
            FROM dashboards d
            LEFT JOIN users u ON d.owner_id = u.id
            LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $2
            WHERE d.folder_id = $1
              AND (d.is_published = true OR d.owner_id = $2)
              AND (d.owner_id = $2 OR dua.user_id = $2 OR (d.visibility = 'public' AND d.is_published = true))
            ORDER BY d.name ASC
          `;
          dashboardParams = [parentId, userId];
        } else {
          const groupPlaceholders = groupIds.map((_, i) => `$${i + 3}`).join(',');
          dashboardSql = `
            SELECT DISTINCT
              d.id, d.name, d.description, d.visibility, d.is_published,
              d.created_at, d.updated_at, d.folder_id,
              u.username as owner_name,
              d.owner_id = $2 as is_owner
            FROM dashboards d
            LEFT JOIN users u ON d.owner_id = u.id
            LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $2
            LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id IN (${groupPlaceholders})
            WHERE d.folder_id = $1
              AND (d.is_published = true OR d.owner_id = $2)
              AND (d.owner_id = $2 OR dua.user_id = $2 OR dga.group_id IN (${groupPlaceholders}) OR (d.visibility = 'public' AND d.is_published = true))
            ORDER BY d.name ASC
          `;
          dashboardParams = [parentId, userId, ...groupIds];
        }
      }
    }
    
    const dashboardsResult = await query(dashboardSql, dashboardParams);
    return {
      folders: foldersResult.rows,
      dashboards: dashboardsResult.rows
    };
  }
  
  let folderSql, dashboardSql;
  let folderParams, dashboardParams;
  
  if (isAdmin) {
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
    if (groupIds.length === 0) {
      folderSql = `
        SELECT DISTINCT
          f.*,
          u.username as owner_name,
          f.owner_id = $1 as is_owner,
          (SELECT COUNT(*) FROM dashboards d2 WHERE d2.folder_id = f.id AND (d2.is_published = true OR d2.owner_id = $1)) as dashboard_count,
          CASE WHEN f.owner_id = $1 OR f.is_public = true THEN true ELSE false END as has_folder_access
        FROM dashboard_folders f
        LEFT JOIN users u ON f.owner_id = u.id
        LEFT JOIN dashboards d ON d.folder_id = f.id AND (d.is_published = true OR d.owner_id = $1)
        LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
        WHERE f.parent_id IS NULL
          AND (
            f.owner_id = $1 
            OR f.is_public = true 
            OR d.owner_id = $1
            OR dua.user_id IS NOT NULL
            OR (d.visibility = 'public' AND d.is_published = true)
          )
        ORDER BY f.name ASC
      `;
      folderParams = [userId];
      
      dashboardSql = `
        SELECT DISTINCT
          d.id, d.name, d.description, d.visibility, d.is_published,
          d.created_at, d.updated_at, d.folder_id,
          u.username as owner_name,
          d.owner_id = $1 as is_owner
        FROM dashboards d
        LEFT JOIN users u ON d.owner_id = u.id
        LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
        WHERE d.folder_id IS NULL
          AND (d.is_published = true OR d.owner_id = $1)
          AND (d.owner_id = $1 OR dua.user_id = $1 OR (d.visibility = 'public' AND d.is_published = true))
        ORDER BY d.name ASC
      `;
      dashboardParams = [userId];
    } else {
      const groupPlaceholders = groupIds.map((_, i) => `$${i + 2}`).join(',');
      folderSql = `
        SELECT DISTINCT
          f.*,
          u.username as owner_name,
          f.owner_id = $1 as is_owner,
          (SELECT COUNT(*) FROM dashboards d2 WHERE d2.folder_id = f.id AND (d2.is_published = true OR d2.owner_id = $1)) as dashboard_count,
          CASE WHEN f.owner_id = $1 OR f.is_public = true OR fga.group_id IS NOT NULL THEN true ELSE false END as has_folder_access
        FROM dashboard_folders f
        LEFT JOIN users u ON f.owner_id = u.id
        LEFT JOIN folder_group_access fga ON f.id = fga.folder_id AND fga.group_id IN (${groupPlaceholders})
        LEFT JOIN dashboards d ON d.folder_id = f.id AND (d.is_published = true OR d.owner_id = $1)
        LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id IN (${groupPlaceholders})
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
      folderParams = [userId, ...groupIds];
      
      dashboardSql = `
        SELECT DISTINCT
          d.id, d.name, d.description, d.visibility, d.is_published,
          d.created_at, d.updated_at, d.folder_id,
          u.username as owner_name,
          d.owner_id = $1 as is_owner
        FROM dashboards d
        LEFT JOIN users u ON d.owner_id = u.id
        LEFT JOIN dashboard_user_access dua ON d.id = dua.dashboard_id AND dua.user_id = $1
        LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id IN (${groupPlaceholders})
        WHERE d.folder_id IS NULL
          AND (d.is_published = true OR d.owner_id = $1)
          AND (d.owner_id = $1 OR dua.user_id = $1 OR dga.group_id IN (${groupPlaceholders}) OR (d.visibility = 'public' AND d.is_published = true))
        ORDER BY d.name ASC
      `;
      dashboardParams = [userId, ...groupIds];
    }
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

export async function createFolder(folderData) {
  const { name, description, parentId, ownerId, isPublic, icon, color } = folderData;
  
  if (parentId) {
    throw new Error('Nested folders are not supported. All folders must be at the root level.');
  }
  
  const existingFolder = await query(
    `SELECT id FROM dashboard_folders WHERE LOWER(name) = LOWER($1)`,
    [name.trim()]
  );
  
  if (existingFolder.rows.length > 0) {
    throw new Error('A folder with this name already exists');
  }
  
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO dashboard_folders (id, name, description, parent_id, owner_id, is_public, icon, color)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
    [id, name.trim(), description || null, ownerId, isPublic || false, icon || 'folder', color || '#6366f1']
  );
  
  const result = await query(
    'SELECT * FROM dashboard_folders WHERE id = $1',
    [id]
  );
  
  return result.rows[0];
}

export async function updateFolder(folderId, updates) {
  const { name, description, isPublic, icon, color } = updates;
  
  if (name) {
    const existingFolder = await query(
      `SELECT id FROM dashboard_folders WHERE LOWER(name) = LOWER($1) AND id != $2`,
      [name.trim(), folderId]
    );
    
    if (existingFolder.rows.length > 0) {
      throw new Error('A folder with this name already exists');
    }
  }
  
  await query(
    `UPDATE dashboard_folders 
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         is_public = COALESCE($3, is_public),
         icon = COALESCE($4, icon),
         color = COALESCE($5, color)
     WHERE id = $6`,
    [name ? name.trim() : name, description, isPublic, icon, color, folderId]
  );
  
  const result = await query(
    'SELECT * FROM dashboard_folders WHERE id = $1',
    [folderId]
  );
  
  return result.rows[0];
}

export async function deleteFolder(folderId) {
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

export async function moveDashboardToFolder(dashboardId, folderId) {
  await query(
    'UPDATE dashboards SET folder_id = $1 WHERE id = $2',
    [folderId, dashboardId]
  );
  const result = await query(
    'SELECT * FROM dashboards WHERE id = $1',
    [dashboardId]
  );
  return result.rows[0];
}

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
    const userGroups = await getGroupsForUser(userId);
    const groupIds = userGroups.map(g => g.id);
    
    if (groupIds.length === 0) {
      folderSql = `
        SELECT DISTINCT
          f.*,
          'folder' as type,
          u.username as owner_name,
          f.owner_id = $2 as is_owner
        FROM dashboard_folders f
        LEFT JOIN users u ON f.owner_id = u.id
        WHERE (LOWER(f.name) LIKE $1 OR LOWER(f.description) LIKE $1)
          AND (
            f.owner_id = $2 
            OR f.is_public = true
          )
        ORDER BY f.name ASC
        LIMIT 20
      `;
      folderParams = [searchPattern, userId];
      
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
        WHERE (LOWER(d.name) LIKE $1 OR LOWER(d.description) LIKE $1)
          AND (d.is_published = true OR d.owner_id = $2)
          AND (
            d.owner_id = $2
            OR dua.user_id = $2
            OR (d.visibility = 'public' AND d.is_published = true)
          )
        ORDER BY d.name ASC
        LIMIT 20
      `;
      dashboardParams = [searchPattern, userId];
    } else {
      const groupPlaceholders = groupIds.map((_, i) => `$${i + 3}`).join(',');
      folderSql = `
        SELECT DISTINCT
          f.*,
          'folder' as type,
          u.username as owner_name,
          f.owner_id = $2 as is_owner
        FROM dashboard_folders f
        LEFT JOIN users u ON f.owner_id = u.id
        LEFT JOIN folder_group_access fga ON f.id = fga.folder_id AND fga.group_id IN (${groupPlaceholders})
        WHERE (LOWER(f.name) LIKE $1 OR LOWER(f.description) LIKE $1)
          AND (
            f.owner_id = $2 
            OR f.is_public = true
            OR fga.group_id IS NOT NULL
          )
        ORDER BY f.name ASC
        LIMIT 20
      `;
      folderParams = [searchPattern, userId, ...groupIds];
      
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
        LEFT JOIN dashboard_group_access dga ON d.id = dga.dashboard_id AND dga.group_id IN (${groupPlaceholders})
        LEFT JOIN folder_group_access fga ON d.folder_id = fga.folder_id AND fga.group_id IN (${groupPlaceholders})
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
      dashboardParams = [searchPattern, userId, ...groupIds];
    }
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

export async function grantFolderAccess(folderId, groupId, grantedBy) {
  const existing = await query(
    'SELECT folder_id FROM folder_group_access WHERE folder_id = $1 AND group_id = $2',
    [folderId, groupId]
  );

  if (existing.rows.length > 0) {
    return true;
  }

  const id = crypto.randomUUID();
  await query(`
    INSERT INTO folder_group_access (id, folder_id, group_id, granted_by)
    VALUES ($1, $2, $3, $4)
  `, [id, folderId, groupId, grantedBy]);
  
  return true;
}

export async function revokeFolderAccess(folderId, groupId) {
  await query(`
    DELETE FROM folder_group_access
    WHERE folder_id = $1 AND group_id = $2
  `, [folderId, groupId]);
  
  return true;
}
