/**
 * User Service
 * 
 * Handles user management operations:
 * - CRUD for users
 * - Password management
 * - Role/privilege assignment
 */

import bcrypt from 'bcryptjs';
import { query, transaction } from '../db/postgres.js';

const SALT_ROUNDS = 10;

// Role hierarchy for permission checks
const ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  creator: 2,
  viewer: 1,
};

/**
 * Get all users (for admin views)
 * Only returns active users - deleted users are filtered out
 */
export async function getAllUsers() {
  const result = await query(`
    SELECT 
      id, username, email, display_name, role, 
      is_active, created_at, updated_at, last_login,
      created_by,
      account_locked, account_locked_reason, account_unlock_expires,
      failed_login_attempts,
      totp_enabled, passkey_enabled,
      mfa_bypass_until
    FROM users
    WHERE is_active = true
    ORDER BY created_at DESC
  `);
  return result.rows;
}

/**
 * Get user by ID
 */
export async function getUserById(userId) {
  const result = await query(
    'SELECT id, username, email, display_name, role, is_active, theme_preference, created_at, updated_at, last_login FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Get user by username
 */
export async function getUserByUsername(username) {
  const result = await query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email) {
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Create a new user
 */
export async function createUser({ username, email, password, displayName, role, createdBy }) {
  // Validate role
  if (!ROLE_HIERARCHY[role]) {
    throw new Error(`Invalid role: ${role}`);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await query(`
    INSERT INTO users (username, email, password_hash, display_name, role, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, username, email, display_name, role, is_active, created_at
  `, [username, email, passwordHash, displayName || username, role, createdBy]);

  return result.rows[0];
}

/**
 * Update user details
 */
export async function updateUser(userId, updates) {
  const allowedFields = ['email', 'display_name', 'is_active'];
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

  values.push(userId);
  const result = await query(`
    UPDATE users
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, username, email, display_name, role, is_active, updated_at
  `, values);

  return result.rows[0];
}

/**
 * Update user role (with permission checks)
 * @param {string} userId - User to update
 * @param {string} newRole - New role to assign
 * @param {object} assignerUser - User performing the assignment
 */
export async function updateUserRole(userId, newRole, assignerUser) {
  // Validate new role
  if (!ROLE_HIERARCHY[newRole]) {
    throw new Error(`Invalid role: ${newRole}`);
  }

  const assignerRoleLevel = ROLE_HIERARCHY[assignerUser.role];
  const newRoleLevel = ROLE_HIERARCHY[newRole];

  // Check if assigner has permission to assign this role
  // Owner can assign admin
  // Admin can assign creator and viewer
  // Creator can assign viewer
  if (assignerUser.role === 'owner') {
    // Owner can assign any role
  } else if (assignerUser.role === 'admin') {
    if (newRole === 'owner' || newRole === 'admin') {
      throw new Error('Admins can only assign creator or viewer roles');
    }
  } else if (assignerUser.role === 'creator') {
    if (newRole !== 'viewer') {
      throw new Error('Creators can only assign viewer role');
    }
  } else {
    throw new Error('You do not have permission to assign roles');
  }

  // Cannot change role of user with higher/equal privilege (except owner)
  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  const targetRoleLevel = ROLE_HIERARCHY[targetUser.role];
  if (targetRoleLevel >= assignerRoleLevel && assignerUser.role !== 'owner') {
    throw new Error('Cannot change role of user with equal or higher privilege');
  }

  // Check if account is locked - cannot promote locked accounts
  const lockCheck = await query(`
    SELECT account_locked, totp_enabled, passkey_enabled 
    FROM users WHERE id = $1
  `, [userId]);
  
  if (lockCheck.rows[0]?.account_locked) {
    throw new Error('Cannot change role of a locked account. Unlock the account first.');
  }

  // Check MFA requirement for elevated roles (admin, creator)
  // Users must have MFA enabled to be promoted to admin or editor
  if (['admin', 'creator'].includes(newRole) && !['admin', 'creator', 'owner'].includes(targetUser.role)) {
    const hasMfa = lockCheck.rows[0]?.totp_enabled || lockCheck.rows[0]?.passkey_enabled;
    
    if (!hasMfa) {
      throw new Error(`Cannot promote to ${newRole === 'admin' ? 'Admin' : 'Editor'} role. User must have 2FA (TOTP or Passkey) enabled first.`);
    }
  }

  const result = await query(`
    UPDATE users
    SET role = $1
    WHERE id = $2
    RETURNING id, username, email, display_name, role, is_active, updated_at
  `, [newRole, userId]);

  return result.rows[0];
}

/**
 * Change password for a user
 */
export async function changePassword(userId, currentPassword, newPassword) {
  const user = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  
  if (!user.rows[0]) {
    throw new Error('User not found');
  }

  // Verify current password
  const isValid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
  if (!isValid) {
    throw new Error('Current password is incorrect');
  }

  // Validate password requirements
  const passwordErrors = validatePasswordStrength(newPassword);
  if (passwordErrors.length > 0) {
    throw new Error(`Password must have: ${passwordErrors.join(', ')}`);
  }

  // Hash and update new password
  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);

  return true;
}

/**
 * Validate password strength
 * Requirements: 14+ chars, 1 uppercase, 1 lowercase, 1 number, 1 special character
 */
function validatePasswordStrength(password) {
  const errors = [];
  if (password.length < 14) errors.push('at least 14 characters');
  if (!/[A-Z]/.test(password)) errors.push('1 uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('1 lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('1 number');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('1 special character');
  return errors;
}

/**
 * Update user email
 */
export async function updateEmail(userId, email) {
  // Check if email is already in use by another user
  const existing = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
  if (existing.rows.length > 0) {
    throw new Error('Email address is already in use');
  }

  await query('UPDATE users SET email = $1 WHERE id = $2', [email, userId]);
  return true;
}

/**
 * Reset password (admin action)
 */
export async function resetPassword(userId, newPassword, resetByUser) {
  // Only owner and admin can reset passwords
  if (!['owner', 'admin'].includes(resetByUser.role)) {
    throw new Error('Only owners and admins can reset passwords');
  }

  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  // Admin cannot reset owner's password
  if (resetByUser.role === 'admin' && targetUser.role === 'owner') {
    throw new Error('Cannot reset owner password');
  }

  // Validate password requirements
  const passwordErrors = validatePasswordStrength(newPassword);
  if (passwordErrors.length > 0) {
    throw new Error(`Password must have: ${passwordErrors.join(', ')}`);
  }

  // Hash and update new password
  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);

  // Log the action
  await query(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'PASSWORD_RESET', 'user', $2, $3)
  `, [resetByUser.id, userId, JSON.stringify({ resetBy: resetByUser.username })]);

  return true;
}

/**
 * Delete user (soft delete by deactivating)
 * - Only owner and admin can delete
 * - Can only delete users with lower role level
 * - Cannot delete users who own dashboards
 */
export async function deleteUser(userId, deletedByUser) {
  // Only owner and admin can delete users
  if (!['owner', 'admin'].includes(deletedByUser.role)) {
    throw new Error('Only owners and admins can delete users');
  }

  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  // Cannot delete yourself
  if (userId === deletedByUser.id) {
    throw new Error('Cannot delete your own account');
  }

  // Check role hierarchy - can only delete users with lower roles
  const deleterLevel = ROLE_HIERARCHY[deletedByUser.role] || 0;
  const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
  
  if (targetLevel >= deleterLevel) {
    throw new Error(`Cannot delete a user with ${targetUser.role} role. You can only delete users with roles lower than yours.`);
  }

  // Cannot delete the last owner
  if (targetUser.role === 'owner') {
    const ownerCount = await query("SELECT COUNT(*) FROM users WHERE role = 'owner' AND is_active = true");
    if (parseInt(ownerCount.rows[0].count) <= 1) {
      throw new Error('Cannot delete the last owner');
    }
  }

  // Check if user owns any dashboards
  const ownedDashboards = await query(`
    SELECT id, name FROM dashboards 
    WHERE owner_id = $1
  `, [userId]);
  
  if (ownedDashboards.rows.length > 0) {
    const dashboardNames = ownedDashboards.rows.map(d => d.name).join(', ');
    throw new Error(`Cannot delete user. They own ${ownedDashboards.rows.length} dashboard(s): ${dashboardNames}. Transfer or delete these dashboards first.`);
  }

  // Check if user owns any Snowflake connections
  const ownedConnections = await query(`
    SELECT id, name FROM snowflake_connections 
    WHERE user_id = $1
  `, [userId]);
  
  if (ownedConnections.rows.length > 0) {
    const connectionNames = ownedConnections.rows.map(c => c.name).join(', ');
    throw new Error(`Cannot delete user. They own ${ownedConnections.rows.length} connection(s): ${connectionNames}. Delete these connections first.`);
  }

  // Remove user from all groups first
  await query('DELETE FROM group_members WHERE user_id = $1', [userId]);

  // Log the action before deleting
  await query(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'USER_DELETED', 'user', $2, $3)
  `, [deletedByUser.id, userId, JSON.stringify({ deletedUser: targetUser.username })]);

  // Hard delete the user
  await query('DELETE FROM users WHERE id = $1', [userId]);

  return true;
}

/**
 * Transfer ownership from current owner to another user
 * This is an irreversible action - the current owner becomes admin
 */
export async function transferOwnership(currentOwnerId, newOwnerId) {
  // Get both users
  const currentOwner = await getUserById(currentOwnerId);
  const newOwner = await getUserById(newOwnerId);

  if (!currentOwner) {
    throw new Error('Current owner not found');
  }

  if (!newOwner) {
    throw new Error('Target user not found');
  }

  if (currentOwner.role !== 'owner') {
    throw new Error('Only the owner can transfer ownership');
  }

  if (newOwner.id === currentOwner.id) {
    throw new Error('Cannot transfer ownership to yourself');
  }

  if (!newOwner.is_active) {
    throw new Error('Cannot transfer ownership to an inactive user');
  }

  // Can only transfer to admins
  if (newOwner.role !== 'admin') {
    throw new Error('Ownership can only be transferred to administrators');
  }

  // Perform the transfer in a transaction-like manner
  // 1. Set the new owner's role to 'owner'
  await query(
    "UPDATE users SET role = 'owner', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    [newOwnerId]
  );

  // 2. Demote the current owner to 'admin'
  await query(
    "UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    [currentOwnerId]
  );

  // 3. Log the action
  await query(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'OWNERSHIP_TRANSFERRED', 'user', $2, $3)
  `, [currentOwnerId, newOwnerId, JSON.stringify({ 
    previousOwner: currentOwner.username, 
    newOwner: newOwner.username 
  })]);

  console.log(`Ownership transferred from ${currentOwner.username} to ${newOwner.username}`);

  return { success: true, newOwner: newOwner.username };
}

/**
 * Validate user credentials
 */
export async function validateCredentials(username, password) {
  const result = await query(
    'SELECT * FROM users WHERE username = $1 AND is_active = true',
    [username]
  );

  const user = result.rows[0];
  if (!user) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    return null;
  }

  // Update last login
  await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

  // Return user without password hash
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

/**
 * Check if user has at least the specified role level
 */
export function hasRoleLevel(userRole, requiredRole) {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Get role hierarchy info
 */
export function getRoleHierarchy() {
  return { ...ROLE_HIERARCHY };
}

/**
 * Update user's theme preference
 */
export async function updateThemePreference(userId, theme) {
  if (!['light', 'dark'].includes(theme)) {
    throw new Error('Invalid theme. Must be "light" or "dark"');
  }
  
  const result = await query(
    'UPDATE users SET theme_preference = $1 WHERE id = $2 RETURNING theme_preference',
    [theme, userId]
  );
  
  return result.rows[0]?.theme_preference;
}

/**
 * Get user's theme preference
 */
export async function getThemePreference(userId) {
  const result = await query(
    'SELECT theme_preference FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.theme_preference || 'light';
}

/**
 * Save user's custom color schemes
 */
export async function saveColorSchemes(userId, colorSchemes) {
  const result = await query(
    'UPDATE users SET preferences = jsonb_set(COALESCE(preferences, \'{}\'::jsonb), \'{colorSchemes}\', $1::jsonb) WHERE id = $2 RETURNING preferences',
    [JSON.stringify(colorSchemes), userId]
  );
  return result.rows[0]?.preferences?.colorSchemes || [];
}

/**
 * Get user's custom color schemes
 */
export async function getColorSchemes(userId) {
  const result = await query(
    'SELECT preferences->\'colorSchemes\' as color_schemes FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.color_schemes || [];
}

/**
 * Get all user preferences
 */
export async function getUserPreferences(userId) {
  const result = await query(
    'SELECT preferences, theme_preference FROM users WHERE id = $1',
    [userId]
  );
  const row = result.rows[0];
  return {
    theme: row?.theme_preference || 'light',
    colorSchemes: row?.preferences?.colorSchemes || [],
    ...row?.preferences,
  };
}

/**
 * Update user preferences (merge with existing)
 */
export async function updateUserPreferences(userId, updates) {
  const result = await query(
    `UPDATE users 
     SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb 
     WHERE id = $2 
     RETURNING preferences`,
    [JSON.stringify(updates), userId]
  );
  return result.rows[0]?.preferences || {};
}

// ============================================
// SESSION MANAGEMENT (Single-session enforcement)
// ============================================

/**
 * Check if user has an active session
 * Returns the active session ID if one exists and hasn't expired
 */
export async function getActiveSession(userId) {
  const result = await query(
    `SELECT active_session_id, session_expires_at 
     FROM users 
     WHERE id = $1 AND active_session_id IS NOT NULL`,
    [userId]
  );
  
  const user = result.rows[0];
  if (!user || !user.active_session_id) {
    return null;
  }
  
  // Check if session has expired
  if (user.session_expires_at && new Date(user.session_expires_at) < new Date()) {
    // Session expired, clear it
    await clearActiveSession(userId);
    return null;
  }
  
  return user.active_session_id;
}

/**
 * Set the active session for a user
 * @param userId - User ID
 * @param sessionId - New session ID
 * @param expiresInHours - Session expiry in hours (default 8)
 */
export async function setActiveSession(userId, sessionId, expiresInHours = 8) {
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  
  await query(
    `UPDATE users 
     SET active_session_id = $1, session_expires_at = $2 
     WHERE id = $3`,
    [sessionId, expiresAt, userId]
  );
}

/**
 * Clear the active session for a user (on logout)
 */
export async function clearActiveSession(userId) {
  await query(
    `UPDATE users 
     SET active_session_id = NULL, session_expires_at = NULL 
     WHERE id = $1`,
    [userId]
  );
}

/**
 * Clear session by session ID (for force logout)
 */
export async function clearSessionById(sessionId) {
  await query(
    `UPDATE users 
     SET active_session_id = NULL, session_expires_at = NULL 
     WHERE active_session_id = $1`,
    [sessionId]
  );
}

/**
 * Clear all active sessions (called on server startup)
 * This invalidates all existing sessions when the server restarts
 */
export async function clearAllActiveSessions() {
  const result = await query(
    `UPDATE users 
     SET active_session_id = NULL, session_expires_at = NULL 
     WHERE active_session_id IS NOT NULL`
  );
  console.log(`🔐 Cleared ${result.rowCount} active sessions from database (server restart)`);
  return result.rowCount;
}

// ============================================
// ACCOUNT LOCK/UNLOCK
// ============================================

/**
 * Lock a user's account
 * @param {string} userId - User to lock
 * @param {string} reason - Reason for locking (e.g., 'failed_attempts', 'admin_action')
 * @param {string} lockedByUser - User performing the lock (for admin locks)
 */
export async function lockAccount(userId, reason, lockedByUser = null) {
  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  // Cannot lock owner account (they can lock themselves though)
  if (targetUser.role === 'owner' && lockedByUser && lockedByUser.role !== 'owner') {
    throw new Error('Cannot lock the owner account');
  }

  await query(`
    UPDATE users 
    SET account_locked = true, 
        account_locked_reason = $1,
        account_unlock_expires = NULL
    WHERE id = $2
  `, [reason, userId]);

  // Log the action
  if (lockedByUser) {
    await query(`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
      VALUES ($1, 'ACCOUNT_LOCKED', 'user', $2, $3)
    `, [lockedByUser.id, userId, JSON.stringify({ reason, lockedBy: lockedByUser.username })]);
  }

  return { success: true, message: 'Account locked' };
}

/**
 * Unlock a user's account
 * @param {string} userId - User to unlock
 * @param {number} temporaryHours - If provided, account is only unlocked for this duration
 * @param {object} unlockedByUser - User performing the unlock
 */
export async function unlockAccount(userId, temporaryHours = null, unlockedByUser) {
  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  // Role hierarchy check
  if (unlockedByUser.role === 'admin' && targetUser.role === 'owner') {
    throw new Error('Admins cannot unlock owner accounts');
  }

  const unlockExpires = temporaryHours 
    ? new Date(Date.now() + temporaryHours * 60 * 60 * 1000)
    : null;

  await query(`
    UPDATE users 
    SET account_locked = false, 
        account_locked_reason = NULL,
        account_unlock_expires = $1,
        failed_login_attempts = 0
    WHERE id = $2
  `, [unlockExpires, userId]);

  // Log the action
  await query(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'ACCOUNT_UNLOCKED', 'user', $2, $3)
  `, [unlockedByUser.id, userId, JSON.stringify({ 
    temporaryHours, 
    unlockedBy: unlockedByUser.username,
    unlockExpires: unlockExpires?.toISOString()
  })]);

  return { 
    success: true, 
    message: temporaryHours 
      ? `Account unlocked for ${temporaryHours} hours`
      : 'Account unlocked permanently',
    unlockExpires
  };
}

/**
 * Check if an account is locked
 */
export async function isAccountLocked(userId) {
  const result = await query(`
    SELECT account_locked, account_locked_reason, account_unlock_expires 
    FROM users WHERE id = $1
  `, [userId]);
  
  const user = result.rows[0];
  if (!user) return { locked: false };
  
  // Check if temporary unlock has expired
  if (!user.account_locked && user.account_unlock_expires) {
    if (new Date(user.account_unlock_expires) < new Date()) {
      // Re-lock the account
      await query(`
        UPDATE users 
        SET account_locked = true, 
            account_locked_reason = 'temporary_unlock_expired'
        WHERE id = $1
      `, [userId]);
      return { locked: true, reason: 'temporary_unlock_expired' };
    }
  }
  
  return { 
    locked: user.account_locked, 
    reason: user.account_locked_reason,
    unlockExpires: user.account_unlock_expires
  };
}

/**
 * Record failed login attempt and auto-lock if threshold exceeded
 * @param {string} userId - User ID
 * @returns {object} - { locked: boolean, attempts: number }
 */
export async function recordFailedLogin(userId) {
  const MAX_FAILED_ATTEMPTS = 5;
  
  const result = await query(`
    UPDATE users 
    SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
        last_failed_login = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING failed_login_attempts, role
  `, [userId]);
  
  const attempts = result.rows[0]?.failed_login_attempts || 0;
  const role = result.rows[0]?.role;
  
  // Auto-lock if threshold exceeded (except for owner)
  if (attempts >= MAX_FAILED_ATTEMPTS && role !== 'owner') {
    await lockAccount(userId, 'too_many_failed_attempts');
    return { locked: true, attempts };
  }
  
  return { locked: false, attempts, remaining: MAX_FAILED_ATTEMPTS - attempts };
}

/**
 * Reset failed login attempts on successful login
 */
export async function resetFailedLoginAttempts(userId) {
  await query(`
    UPDATE users 
    SET failed_login_attempts = 0, last_failed_login = NULL
    WHERE id = $1
  `, [userId]);
}

// ============================================
// MFA BYPASS
// ============================================

/**
 * Set MFA bypass for a user (allows login without 2FA for a period)
 * @param {string} userId - User ID
 * @param {number} hours - Number of hours to bypass MFA (max 4)
 * @param {string} reason - Reason for bypass
 * @param {object} byUser - Admin user granting the bypass
 */
export async function setMfaBypass(userId, hours, reason, byUser) {
  if (hours > 4) hours = 4; // Max 4 hours
  
  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  const bypassUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  
  await query(`
    UPDATE users 
    SET mfa_bypass_until = $1, mfa_bypass_reason = $2
    WHERE id = $3
  `, [bypassUntil, reason, userId]);

  // Log the action
  await query(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'MFA_BYPASS_SET', 'user', $2, $3)
  `, [byUser.id, userId, JSON.stringify({ hours, reason, bypassUntil: bypassUntil.toISOString() })]);

  return { success: true, bypassUntil };
}

/**
 * Clear MFA bypass for a user
 */
export async function clearMfaBypass(userId) {
  await query(`
    UPDATE users 
    SET mfa_bypass_until = NULL, mfa_bypass_reason = NULL
    WHERE id = $1
  `, [userId]);
}

/**
 * Check if MFA is currently bypassed for a user
 */
export async function isMfaBypassed(userId) {
  const result = await query(`
    SELECT mfa_bypass_until FROM users WHERE id = $1
  `, [userId]);
  
  const bypassUntil = result.rows[0]?.mfa_bypass_until;
  if (!bypassUntil) return false;
  
  return new Date(bypassUntil) > new Date();
}

// ============================================
// DASHBOARD OWNERSHIP TRANSFER
// ============================================

/**
 * Transfer all dashboards from one user to another
 * @param {string} fromUserId - User whose dashboards to transfer
 * @param {string} toUserId - User to receive the dashboards
 * @param {object} performedByUser - Admin/owner performing the transfer
 */
export async function transferDashboards(fromUserId, toUserId, performedByUser) {
  const fromUser = await getUserById(fromUserId);
  const toUser = await getUserById(toUserId);
  
  if (!fromUser) throw new Error('Source user not found');
  if (!toUser) throw new Error('Target user not found');

  // Get count of dashboards to transfer
  const countResult = await query(`
    SELECT COUNT(*) as count FROM dashboards WHERE owner_id = $1
  `, [fromUserId]);
  const count = parseInt(countResult.rows[0].count);

  if (count === 0) {
    return { success: true, transferredCount: 0 };
  }

  // Transfer all dashboards
  await query(`
    UPDATE dashboards SET owner_id = $1 WHERE owner_id = $2
  `, [toUserId, fromUserId]);

  // Log the action
  await query(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'DASHBOARDS_TRANSFERRED', 'user', $2, $3)
  `, [performedByUser.id, fromUserId, JSON.stringify({
    from: fromUser.username,
    to: toUser.username,
    count
  })]);

  return { success: true, transferredCount: count };
}

/**
 * Get dashboards owned by a user
 */
export async function getUserDashboards(userId) {
  const result = await query(`
    SELECT id, name FROM dashboards WHERE owner_id = $1
  `, [userId]);
  return result.rows;
}

/**
 * Get the extended user info including security status
 */
export async function getUserSecurityInfo(userId) {
  const result = await query(`
    SELECT 
      id, username, email, display_name, role, is_active,
      account_locked, account_locked_reason, account_unlock_expires,
      failed_login_attempts, last_failed_login,
      totp_enabled, passkey_enabled,
      two_factor_required, two_factor_grace_period_start, two_factor_grace_days,
      mfa_bypass_until, mfa_bypass_reason,
      last_login
    FROM users WHERE id = $1
  `, [userId]);
  
  return result.rows[0] || null;
}

/**
 * Admin update user details (email, username, display_name)
 * Only owner/admin can do this for users of lesser roles
 */
export async function adminUpdateUser(userId, updates, adminUser) {
  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  // Role hierarchy check
  const adminLevel = ROLE_HIERARCHY[adminUser.role] || 0;
  const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
  
  if (targetLevel >= adminLevel && adminUser.role !== 'owner') {
    throw new Error('Cannot modify a user with equal or higher privilege');
  }

  const allowedFields = ['email', 'display_name', 'username'];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      // Check for uniqueness of username/email
      if (key === 'username' && value !== targetUser.username) {
        const existing = await getUserByUsername(value);
        if (existing) throw new Error('Username already in use');
      }
      if (key === 'email' && value !== targetUser.email) {
        const existing = await getUserByEmail(value);
        if (existing) throw new Error('Email already in use');
      }
      
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(userId);
  const result = await query(`
    UPDATE users
    SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${paramIndex}
    RETURNING id, username, email, display_name, role, is_active, updated_at
  `, values);

  // Log the action
  await query(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'USER_UPDATED_BY_ADMIN', 'user', $2, $3)
  `, [adminUser.id, userId, JSON.stringify({ updates, updatedBy: adminUser.username })]);

  return result.rows[0];
}

export default {
  getAllUsers,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  createUser,
  updateUser,
  updateUserRole,
  changePassword,
  updateEmail,
  resetPassword,
  deleteUser,
  validateCredentials,
  hasRoleLevel,
  getRoleHierarchy,
  updateThemePreference,
  getThemePreference,
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  clearSessionById,
  clearAllActiveSessions,
  // New account management
  lockAccount,
  unlockAccount,
  isAccountLocked,
  recordFailedLogin,
  resetFailedLoginAttempts,
  setMfaBypass,
  clearMfaBypass,
  isMfaBypassed,
  transferDashboards,
  getUserDashboards,
  getUserSecurityInfo,
  adminUpdateUser,
};
