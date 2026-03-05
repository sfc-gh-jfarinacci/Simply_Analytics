/**
 * Group Service
 * 
 * Manages user groups for dashboard sharing.
 */

import { query, transaction } from '../db/postgres.js';

/**
 * Get all groups
 */
export async function getAllGroups() {
  const result = await query(`
    SELECT 
      g.id, g.name, g.description, g.created_at, g.updated_at,
      u.username as created_by_username,
      (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count
    FROM user_groups g
    LEFT JOIN users u ON g.created_by = u.id
    ORDER BY g.name ASC
  `);
  
  return result.rows;
}

/**
 * Get group by ID
 */
export async function getGroupById(groupId) {
  const result = await query(`
    SELECT 
      g.id, g.name, g.description, g.created_at, g.updated_at,
      u.username as created_by_username, g.created_by
    FROM user_groups g
    LEFT JOIN users u ON g.created_by = u.id
    WHERE g.id = $1
  `, [groupId]);
  
  return result.rows[0] || null;
}

/**
 * Get groups that a user belongs to
 */
export async function getGroupsForUser(userId) {
  const result = await query(`
    SELECT 
      g.id, g.name, g.description, g.created_at,
      gm.added_at as joined_at
    FROM user_groups g
    JOIN group_members gm ON g.id = gm.group_id
    WHERE gm.user_id = $1
    ORDER BY g.name ASC
  `, [userId]);
  
  return result.rows;
}

/**
 * Get members of a group
 */
export async function getGroupMembers(groupId) {
  const result = await query(`
    SELECT 
      u.id, u.username, u.email, u.display_name, u.role,
      gm.added_at, 
      adder.username as added_by_username
    FROM group_members gm
    JOIN users u ON gm.user_id = u.id
    LEFT JOIN users adder ON gm.added_by = adder.id
    WHERE gm.group_id = $1
    ORDER BY u.username ASC
  `, [groupId]);
  
  return result.rows;
}

/**
 * Create a new group
 */
export async function createGroup({ name, description, createdBy }) {
  const result = await query(`
    INSERT INTO user_groups (name, description, created_by)
    VALUES ($1, $2, $3)
    RETURNING id, name, description, created_at
  `, [name, description || null, createdBy]);

  return result.rows[0];
}

/**
 * Update a group
 */
export async function updateGroup(groupId, updates, updatedByUser) {
  // Only owner/admin or group creator can update
  const group = await getGroupById(groupId);
  if (!group) {
    throw new Error('Group not found');
  }

  if (!['owner', 'admin'].includes(updatedByUser.role) && group.created_by !== updatedByUser.id) {
    throw new Error('You do not have permission to update this group');
  }

  const allowedFields = ['name', 'description'];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(groupId);
  const result = await query(`
    UPDATE user_groups
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, description, updated_at
  `, values);

  return result.rows[0];
}

/**
 * Delete a group
 */
export async function deleteGroup(groupId, deletedByUser) {
  const group = await getGroupById(groupId);
  if (!group) {
    throw new Error('Group not found');
  }

  // Only owner/admin or group creator can delete
  if (!['owner', 'admin'].includes(deletedByUser.role) && group.created_by !== deletedByUser.id) {
    throw new Error('You do not have permission to delete this group');
  }

  await query('DELETE FROM user_groups WHERE id = $1', [groupId]);
  return true;
}

/**
 * Add a user to a group
 */
export async function addUserToGroup(groupId, userId, addedBy) {
  // Check if group exists
  const group = await getGroupById(groupId);
  if (!group) {
    throw new Error('Group not found');
  }

  // Check if already a member
  const existing = await query(
    'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );

  if (existing.rows.length > 0) {
    throw new Error('User is already a member of this group');
  }

  await query(`
    INSERT INTO group_members (group_id, user_id, added_by)
    VALUES ($1, $2, $3)
  `, [groupId, userId, addedBy]);

  return true;
}

/**
 * Remove a user from a group
 */
export async function removeUserFromGroup(groupId, userId, removedByUser) {
  const group = await getGroupById(groupId);
  if (!group) {
    throw new Error('Group not found');
  }

  // Only owner/admin or group creator can remove members
  if (!['owner', 'admin'].includes(removedByUser.role) && group.created_by !== removedByUser.id) {
    throw new Error('You do not have permission to remove members from this group');
  }

  const result = await query(
    'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );

  if (result.rowCount === 0) {
    throw new Error('User is not a member of this group');
  }

  return true;
}

/**
 * Check if a user is in a group
 */
export async function isUserInGroup(groupId, userId) {
  const result = await query(
    'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  
  return result.rows.length > 0;
}

/**
 * Get all groups that have access to a dashboard
 */
export async function getGroupsForDashboard(dashboardId) {
  const result = await query(`
    SELECT 
      g.id, g.name, g.description,
      dga.granted_at,
      u.username as granted_by_username
    FROM dashboard_group_access dga
    JOIN user_groups g ON dga.group_id = g.id
    LEFT JOIN users u ON dga.granted_by = u.id
    WHERE dga.dashboard_id = $1
    ORDER BY g.name ASC
  `, [dashboardId]);
  
  return result.rows;
}

/**
 * Grant group access to a dashboard
 */
export async function grantGroupAccess(dashboardId, groupId, grantedBy) {
  // Check if already has access
  const existing = await query(
    'SELECT id FROM dashboard_group_access WHERE dashboard_id = $1 AND group_id = $2',
    [dashboardId, groupId]
  );

  if (existing.rows.length > 0) {
    return true; // Already has access
  }

  await query(`
    INSERT INTO dashboard_group_access (dashboard_id, group_id, granted_by)
    VALUES ($1, $2, $3)
  `, [dashboardId, groupId, grantedBy]);

  return true;
}

/**
 * Revoke group access from a dashboard
 */
export async function revokeGroupAccess(dashboardId, groupId) {
  await query(
    'DELETE FROM dashboard_group_access WHERE dashboard_id = $1 AND group_id = $2',
    [dashboardId, groupId]
  );
  
  return true;
}

export default {
  getAllGroups,
  getGroupById,
  getGroupsForUser,
  getGroupMembers,
  createGroup,
  updateGroup,
  deleteGroup,
  addUserToGroup,
  removeUserFromGroup,
  isUserInGroup,
  getGroupsForDashboard,
  grantGroupAccess,
  revokeGroupAccess,
};
