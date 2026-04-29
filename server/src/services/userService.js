import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, transaction, parseJson, jsonSet, now } from '../db/db.js';
import configStore from '../config/configStore.js';

const SALT_ROUNDS = 10;

const ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  developer: 2,
  viewer: 1,
};

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

export async function getUserById(userId) {
  const result = await query(
    'SELECT id, username, email, display_name, role, is_active, theme_preference, created_at, updated_at, last_login FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

export async function getUserByUsername(username) {
  const result = await query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

export async function getUserByEmail(email) {
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

export async function createUser({ username, email, password, displayName, role, createdBy }) {
  if (!ROLE_HIERARCHY[role]) {
    throw new Error(`Invalid role: ${role}`);
  }

  const passwordErrors = validatePasswordStrength(password);
  if (passwordErrors.length > 0) {
    throw new Error(`Password must have: ${passwordErrors.join(', ')}`);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = crypto.randomUUID();

  await query(`
    INSERT INTO users (id, username, email, password_hash, display_name, role, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, username, email, passwordHash, displayName || username, role, createdBy]);

  const result = await query(
    'SELECT id, username, email, display_name, role, is_active, created_at FROM users WHERE id = $1',
    [id]
  );

  return result.rows[0];
}

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
  await query(`
    UPDATE users
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
  `, values);

  const result = await query(
    'SELECT id, username, email, display_name, role, is_active, updated_at FROM users WHERE id = $1',
    [userId]
  );

  return result.rows[0];
}

export async function updateUserRole(userId, newRole, assignerUser) {
  if (!ROLE_HIERARCHY[newRole]) {
    throw new Error(`Invalid role: ${newRole}`);
  }

  const assignerRoleLevel = ROLE_HIERARCHY[assignerUser.role];
  const newRoleLevel = ROLE_HIERARCHY[newRole];

  if (assignerUser.role === 'owner') {
  } else if (assignerUser.role === 'admin') {
    if (newRole === 'owner' || newRole === 'admin') {
      throw new Error('Admins can only assign developer or viewer roles');
    }
  } else if (assignerUser.role === 'developer') {
    if (newRole !== 'viewer') {
      throw new Error('Developers can only assign viewer role');
    }
  } else {
    throw new Error('You do not have permission to assign roles');
  }

  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  const targetRoleLevel = ROLE_HIERARCHY[targetUser.role];
  if (targetRoleLevel >= assignerRoleLevel && assignerUser.role !== 'owner') {
    throw new Error('Cannot change role of user with equal or higher privilege');
  }

  const lockCheck = await query(`
    SELECT account_locked, totp_enabled, passkey_enabled, auth_provider 
    FROM users WHERE id = $1
  `, [userId]);
  
  if (lockCheck.rows[0]?.account_locked) {
    throw new Error('Cannot change role of a locked account. Unlock the account first.');
  }

  if (['admin', 'developer'].includes(newRole) && !['admin', 'developer', 'owner'].includes(targetUser.role)) {
    const row = lockCheck.rows[0];
    const hasMfa = row?.auth_provider === 'saml' || row?.totp_enabled || row?.passkey_enabled;
    
    if (!hasMfa) {
      throw new Error(`Cannot promote to ${newRole === 'admin' ? 'Admin' : 'Developer'} role. User must have 2FA (TOTP or Passkey) enabled or use SSO first.`);
    }
  }

  await query(`
    UPDATE users
    SET role = $1
    WHERE id = $2
  `, [newRole, userId]);

  const result = await query(
    'SELECT id, username, email, display_name, role, is_active, updated_at FROM users WHERE id = $1',
    [userId]
  );

  return result.rows[0];
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  
  if (!user.rows[0]) {
    throw new Error('User not found');
  }

  const isValid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
  if (!isValid) {
    throw new Error('Current password is incorrect');
  }

  const passwordErrors = validatePasswordStrength(newPassword);
  if (passwordErrors.length > 0) {
    throw new Error(`Password must have: ${passwordErrors.join(', ')}`);
  }

  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);

  return true;
}

export function validatePasswordStrength(password, policyOverride) {
  const policy = policyOverride || configStore.getPasswordPolicy();
  const errors = [];
  if (password.length < policy.minLength) errors.push(`at least ${policy.minLength} characters`);
  if (policy.requireUppercase && !/[A-Z]/.test(password)) errors.push('1 uppercase letter');
  if (policy.requireLowercase && !/[a-z]/.test(password)) errors.push('1 lowercase letter');
  if (policy.requireNumber && !/[0-9]/.test(password)) errors.push('1 number');
  if (policy.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('1 special character');
  return errors;
}

export async function updateEmail(userId, email) {
  const existing = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
  if (existing.rows.length > 0) {
    throw new Error('Email address is already in use');
  }

  await query('UPDATE users SET email = $1 WHERE id = $2', [email, userId]);
  return true;
}

export async function resetPassword(userId, newPassword, resetByUser) {
  if (!['owner', 'admin'].includes(resetByUser.role)) {
    throw new Error('Only owners and admins can reset passwords');
  }

  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  if (resetByUser.role === 'admin' && targetUser.role === 'owner') {
    throw new Error('Cannot reset owner password');
  }

  const passwordErrors = validatePasswordStrength(newPassword);
  if (passwordErrors.length > 0) {
    throw new Error(`Password must have: ${passwordErrors.join(', ')}`);
  }

  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);

  const auditId = crypto.randomUUID();
  await query(`
    INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
    VALUES ($1, $2, 'PASSWORD_RESET', 'user', $3, ${parseJson('$4')})
  `, [auditId, resetByUser.id, userId, JSON.stringify({ resetBy: resetByUser.username })]);

  return true;
}

export async function deleteUser(userId, deletedByUser) {
  if (!['owner', 'admin'].includes(deletedByUser.role)) {
    throw new Error('Only owners and admins can delete users');
  }

  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  if (userId === deletedByUser.id) {
    throw new Error('Cannot delete your own account');
  }

  const deleterLevel = ROLE_HIERARCHY[deletedByUser.role] || 0;
  const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
  
  if (targetLevel >= deleterLevel) {
    throw new Error(`Cannot delete a user with ${targetUser.role} role. You can only delete users with roles lower than yours.`);
  }

  if (targetUser.role === 'owner') {
    const ownerCount = await query("SELECT COUNT(*) as count FROM users WHERE role = 'owner' AND is_active = true");
    if (parseInt(ownerCount.rows[0].count) <= 1) {
      throw new Error('Cannot delete the last owner');
    }
  }

  const ownedDashboards = await query(`
    SELECT id, name FROM dashboards 
    WHERE owner_id = $1
  `, [userId]);
  
  if (ownedDashboards.rows.length > 0) {
    const dashboardNames = ownedDashboards.rows.map(d => d.name).join(', ');
    throw new Error(`Cannot delete user. They own ${ownedDashboards.rows.length} dashboard(s): ${dashboardNames}. Transfer or delete these dashboards first.`);
  }

  const ownedConnections = await query(`
    SELECT id, name FROM snowflake_connections 
    WHERE user_id = $1
  `, [userId]);
  
  if (ownedConnections.rows.length > 0) {
    const connectionNames = ownedConnections.rows.map(c => c.name).join(', ');
    throw new Error(`Cannot delete user. They own ${ownedConnections.rows.length} connection(s): ${connectionNames}. Delete these connections first.`);
  }

  await query('DELETE FROM group_members WHERE user_id = $1', [userId]);

  const auditId = crypto.randomUUID();
  await query(`
    INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
    VALUES ($1, $2, 'USER_DELETED', 'user', $3, ${parseJson('$4')})
  `, [auditId, deletedByUser.id, userId, JSON.stringify({ deletedUser: targetUser.username })]);

  await query('DELETE FROM users WHERE id = $1', [userId]);

  return true;
}

export async function transferOwnership(currentOwnerId, newOwnerId) {
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

  if (newOwner.role !== 'admin') {
    throw new Error('Ownership can only be transferred to administrators');
  }

  await query(
    `UPDATE users SET role = 'owner', updated_at = ${now()} WHERE id = $1`,
    [newOwnerId]
  );

  await query(
    `UPDATE users SET role = 'admin', updated_at = ${now()} WHERE id = $1`,
    [currentOwnerId]
  );

  const auditId = crypto.randomUUID();
  await query(`
    INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
    VALUES ($1, $2, 'OWNERSHIP_TRANSFERRED', 'user', $3, ${parseJson('$4')})
  `, [auditId, currentOwnerId, newOwnerId, JSON.stringify({ 
    previousOwner: currentOwner.username, 
    newOwner: newOwner.username 
  })]);

  console.log(`Ownership transferred from ${currentOwner.username} to ${newOwner.username}`);

  return { success: true, newOwner: newOwner.username };
}

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

  await query(`UPDATE users SET last_login = ${now()} WHERE id = $1`, [user.id]);

  const { password_hash, ...safeUser } = user;
  return safeUser;
}

export function hasRoleLevel(userRole, requiredRole) {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function getRoleHierarchy() {
  return { ...ROLE_HIERARCHY };
}

export async function updateThemePreference(userId, theme) {
  if (!['light', 'dark'].includes(theme)) {
    throw new Error('Invalid theme. Must be "light" or "dark"');
  }
  
  await query(
    'UPDATE users SET theme_preference = $1 WHERE id = $2',
    [theme, userId]
  );
  
  const result = await query(
    'SELECT theme_preference FROM users WHERE id = $1',
    [userId]
  );
  
  return result.rows[0]?.theme_preference;
}

export async function getThemePreference(userId) {
  const result = await query(
    'SELECT theme_preference FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.theme_preference || 'light';
}

export async function saveColorSchemes(userId, colorSchemes) {
  await query(
    `UPDATE users SET preferences = ${jsonSet('preferences', 'colorSchemes', '$1')} WHERE id = $2`,
    [JSON.stringify(colorSchemes), userId]
  );
  const result = await query(
    'SELECT preferences FROM users WHERE id = $1',
    [userId]
  );
  const prefs = result.rows[0]?.preferences;
  if (prefs && typeof prefs === 'object') {
    return prefs.colorSchemes || [];
  }
  if (typeof prefs === 'string') {
    try { return JSON.parse(prefs).colorSchemes || []; } catch { return []; }
  }
  return [];
}

export async function getColorSchemes(userId) {
  const result = await query(
    'SELECT preferences FROM users WHERE id = $1',
    [userId]
  );
  const prefs = result.rows[0]?.preferences;
  if (prefs && typeof prefs === 'object') {
    return prefs.colorSchemes || [];
  }
  if (typeof prefs === 'string') {
    try { return JSON.parse(prefs).colorSchemes || []; } catch { return []; }
  }
  return [];
}

export async function getUserPreferences(userId) {
  const result = await query(
    'SELECT preferences, theme_preference FROM users WHERE id = $1',
    [userId]
  );
  const row = result.rows[0];
  let prefs = row?.preferences;
  if (typeof prefs === 'string') {
    try { prefs = JSON.parse(prefs); } catch { prefs = {}; }
  }
  prefs = prefs || {};
  return {
    theme: row?.theme_preference || 'light',
    colorSchemes: prefs.colorSchemes || [],
    ...prefs,
  };
}

export async function updateUserPreferences(userId, updates) {
  const current = await query('SELECT preferences FROM users WHERE id = $1', [userId]);
  let prefs = current.rows[0]?.preferences;
  if (typeof prefs === 'string') {
    try { prefs = JSON.parse(prefs); } catch { prefs = {}; }
  }
  prefs = prefs || {};
  const merged = { ...prefs, ...updates };
  await query(
    `UPDATE users SET preferences = ${parseJson('$1')} WHERE id = $2`,
    [JSON.stringify(merged), userId]
  );
  return merged;
}

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
  
  if (user.session_expires_at && new Date(user.session_expires_at) < new Date()) {
    await clearActiveSession(userId);
    return null;
  }
  
  return user.active_session_id;
}

export async function setActiveSession(userId, sessionId, expiresInHours = 8) {
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  
  await query(
    `UPDATE users 
     SET active_session_id = $1, session_expires_at = $2 
     WHERE id = $3`,
    [sessionId, expiresAt, userId]
  );
}

export async function clearActiveSession(userId) {
  await query(
    `UPDATE users 
     SET active_session_id = NULL, session_expires_at = NULL 
     WHERE id = $1`,
    [userId]
  );
}

export async function clearSessionById(sessionId) {
  await query(
    `UPDATE users 
     SET active_session_id = NULL, session_expires_at = NULL 
     WHERE active_session_id = $1`,
    [sessionId]
  );
}

export async function clearAllActiveSessions() {
  const result = await query(
    `UPDATE users 
     SET active_session_id = NULL, session_expires_at = NULL 
     WHERE active_session_id IS NOT NULL`
  );
  const count = result.rowCount ?? result.rows[0]?.['number of rows updated'] ?? 0;
  console.log(`Cleared ${count} active sessions from database (server restart)`);
  return count;
}

export async function lockAccount(userId, reason, lockedByUser = null) {
  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

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

  if (lockedByUser) {
    const auditId = crypto.randomUUID();
    await query(`
      INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, 'ACCOUNT_LOCKED', 'user', $3, ${parseJson('$4')})
    `, [auditId, lockedByUser.id, userId, JSON.stringify({ reason, lockedBy: lockedByUser.username })]);
  }

  return { success: true, message: 'Account locked' };
}

export async function unlockAccount(userId, temporaryHours = null, unlockedByUser) {
  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

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

  const auditId = crypto.randomUUID();
  await query(`
    INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
    VALUES ($1, $2, 'ACCOUNT_UNLOCKED', 'user', $3, ${parseJson('$4')})
  `, [auditId, unlockedByUser.id, userId, JSON.stringify({ 
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

export async function isAccountLocked(userId) {
  const result = await query(`
    SELECT account_locked, account_locked_reason, account_unlock_expires 
    FROM users WHERE id = $1
  `, [userId]);
  
  const user = result.rows[0];
  if (!user) return { locked: false };
  
  if (!user.account_locked && user.account_unlock_expires) {
    if (new Date(user.account_unlock_expires) < new Date()) {
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

export async function recordFailedLogin(userId) {
  const MAX_FAILED_ATTEMPTS = 5;
  
  await query(`
    UPDATE users 
    SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
        last_failed_login = ${now()}
    WHERE id = $1
  `, [userId]);
  
  const result = await query(
    'SELECT failed_login_attempts, role FROM users WHERE id = $1',
    [userId]
  );
  
  const attempts = result.rows[0]?.failed_login_attempts || 0;
  const role = result.rows[0]?.role;
  
  if (attempts >= MAX_FAILED_ATTEMPTS && role !== 'owner') {
    await lockAccount(userId, 'too_many_failed_attempts');
    return { locked: true, attempts };
  }
  
  return { locked: false, attempts, remaining: MAX_FAILED_ATTEMPTS - attempts };
}

export async function resetFailedLoginAttempts(userId) {
  await query(`
    UPDATE users 
    SET failed_login_attempts = 0, last_failed_login = NULL
    WHERE id = $1
  `, [userId]);
}

export async function setMfaBypass(userId, hours, reason, byUser) {
  if (hours > 4) hours = 4;
  
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

  const auditId = crypto.randomUUID();
  await query(`
    INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
    VALUES ($1, $2, 'MFA_BYPASS_SET', 'user', $3, ${parseJson('$4')})
  `, [auditId, byUser.id, userId, JSON.stringify({ hours, reason, bypassUntil: bypassUntil.toISOString() })]);

  return { success: true, bypassUntil };
}

export async function clearMfaBypass(userId) {
  await query(`
    UPDATE users 
    SET mfa_bypass_until = NULL, mfa_bypass_reason = NULL
    WHERE id = $1
  `, [userId]);
}

export async function isMfaBypassed(userId) {
  const result = await query(`
    SELECT mfa_bypass_until FROM users WHERE id = $1
  `, [userId]);
  
  const bypassUntil = result.rows[0]?.mfa_bypass_until;
  if (!bypassUntil) return false;
  
  return new Date(bypassUntil) > new Date();
}

export async function transferDashboards(fromUserId, toUserId, performedByUser) {
  const fromUser = await getUserById(fromUserId);
  const toUser = await getUserById(toUserId);
  
  if (!fromUser) throw new Error('Source user not found');
  if (!toUser) throw new Error('Target user not found');

  const countResult = await query(`
    SELECT COUNT(*) as count FROM dashboards WHERE owner_id = $1
  `, [fromUserId]);
  const count = parseInt(countResult.rows[0].count);

  if (count === 0) {
    return { success: true, transferredCount: 0 };
  }

  await query(`
    UPDATE dashboards SET owner_id = $1 WHERE owner_id = $2
  `, [toUserId, fromUserId]);

  const auditId = crypto.randomUUID();
  await query(`
    INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
    VALUES ($1, $2, 'DASHBOARDS_TRANSFERRED', 'user', $3, ${parseJson('$4')})
  `, [auditId, performedByUser.id, fromUserId, JSON.stringify({
    from: fromUser.username,
    to: toUser.username,
    count
  })]);

  return { success: true, transferredCount: count };
}

export async function getUserDashboards(userId) {
  const result = await query(`
    SELECT id, name FROM dashboards WHERE owner_id = $1
  `, [userId]);
  return result.rows;
}

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

export async function adminUpdateUser(userId, updates, adminUser) {
  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw new Error('User not found');
  }

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
  await query(`
    UPDATE users
    SET ${setClauses.join(', ')}, updated_at = ${now()}
    WHERE id = $${paramIndex}
  `, values);

  const result = await query(
    'SELECT id, username, email, display_name, role, is_active, updated_at FROM users WHERE id = $1',
    [userId]
  );

  const auditId = crypto.randomUUID();
  await query(`
    INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
    VALUES ($1, $2, 'USER_UPDATED_BY_ADMIN', 'user', $3, ${parseJson('$4')})
  `, [auditId, adminUser.id, userId, JSON.stringify({ updates, updatedBy: adminUser.username })]);

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
  validatePasswordStrength,
  hasRoleLevel,
  getRoleHierarchy,
  updateThemePreference,
  getThemePreference,
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  clearSessionById,
  clearAllActiveSessions,
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
