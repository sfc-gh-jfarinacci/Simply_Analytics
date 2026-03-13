/**
 * Simply Analytics - Authentication Routes
 * 
 * Handles user authentication via:
 * - App username/password (PostgreSQL users)
 * 
 * Snowflake connections are managed separately after login.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import userService from '../services/userService.js';
import twoFactorService from '../services/twoFactorService.js';

// Verbose logging toggle
const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && log(...args);
import {
  authenticateWithKeyPair,
  authenticateWithPAT,
  getAvailableRoles,
  switchRole,
  logout,
  autoSwitchFromSystemRole,
  isSystemRole,
} from '../middleware/auth.js';
import { closeDashboardConnection } from '../db/dashboardSessionManager.js';

const JWT_SECRET = process.env.JWT_SECRET || 'simply-analytics-secret-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h'; // 8 hours max

// Server instance ID - generated on each startup
// JWTs issued before a server restart will have a different instanceId and be rejected
const SERVER_INSTANCE_ID = uuidv4();
log(`🔐 Server instance ID: ${SERVER_INSTANCE_ID.substring(0, 8)}... (all previous sessions invalidated)`);

/**
 * Get the current server instance ID
 * Used by auth middleware to validate JWTs were issued by this server instance
 */
export function getServerInstanceId() {
  return SERVER_INSTANCE_ID;
}

// Track revoked sessions (sessionId -> revocationTime)
// When user signs out, their sessionId is added here
const revokedSessions = new Map();

// Cleanup old revoked sessions every hour (they're only needed until JWT expires)
setInterval(() => {
  const now = Date.now();
  const maxAge = 8 * 60 * 60 * 1000; // 8 hours
  for (const [sessionId, revokedAt] of revokedSessions.entries()) {
    if (now - revokedAt > maxAge) {
      revokedSessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);

/**
 * Check if a session has been revoked (user signed out)
 */
export function isSessionRevoked(sessionId) {
  return revokedSessions.has(sessionId);
}

/**
 * Revoke a session (called on sign out)
 */
export function revokeSession(sessionId) {
  if (sessionId) {
    revokedSessions.set(sessionId, Date.now());
    log(`Session revoked: ${sessionId?.substring(0, 8)}...`);
  }
}

export const authRoutes = Router();

/**
 * POST /api/auth/login
 * Authenticate with app username and password
 * Enforces single-session: only one active session per user
 */
authRoutes.post('/login', async (req, res) => {
  try {
    const { username, password, forceLogin } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username and password are required' 
      });
    }

    // First, get the user by username to check if account is locked
    const userByUsername = await userService.getUserByUsername(username);
    
    if (userByUsername) {
      if (userByUsername.auth_provider === 'saml') {
        return res.status(400).json({
          success: false,
          error: 'This account uses SSO. Please sign in via your identity provider.',
          code: 'SSO_ACCOUNT',
        });
      }

      // Check if account is locked BEFORE validating credentials
      const lockStatus = await userService.isAccountLocked(userByUsername.id);
      if (lockStatus.locked) {
        return res.status(403).json({
          success: false,
          error: lockStatus.reason === 'too_many_failed_attempts' 
            ? 'Account locked due to too many failed login attempts. Please contact an administrator.'
            : 'Account is locked. Please contact an administrator.',
          code: 'ACCOUNT_LOCKED',
          reason: lockStatus.reason,
        });
      }
    }

    // Validate credentials against PostgreSQL users table
    const user = await userService.validateCredentials(username, password);
    
    if (!user) {
      // Track failed login attempt if user exists
      if (userByUsername) {
        const failResult = await userService.recordFailedLogin(userByUsername.id);
        if (failResult.locked) {
          return res.status(403).json({
            success: false,
            error: 'Account locked due to too many failed login attempts. Please contact an administrator.',
            code: 'ACCOUNT_LOCKED',
          });
        }
        return res.status(401).json({
          success: false,
          error: `Invalid password. ${failResult.remaining} attempts remaining.`,
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password',
      });
    }

    // Reset failed login attempts on successful password validation
    await userService.resetFailedLoginAttempts(user.id);

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is disabled. Please contact an administrator.',
      });
    }

    // Check if user can proceed (not locked, grace period, etc.)
    const canProceed = await twoFactorService.checkUserCanProceed(user.id);
    
    if (!canProceed.canProceed) {
      if (canProceed.reason === 'account_locked') {
        return res.status(403).json({
          success: false,
          error: canProceed.message || 'Account is locked. Please contact an administrator.',
          code: 'ACCOUNT_LOCKED',
        });
      }
      if (canProceed.reason === 'grace_period_expired') {
        return res.status(403).json({
          success: false,
          error: 'Your MFA setup grace period has expired. Please contact an administrator to unlock your account.',
          code: 'GRACE_PERIOD_EXPIRED',
        });
      }
    }

    // Check if MFA is bypassed (temporary bypass for fixing MFA issues)
    const mfaBypassed = await userService.isMfaBypassed(user.id);
    
    // Check if 2FA is enabled and required
    const twoFactorStatus = await twoFactorService.get2FAStatus(user.id);
    
    if (twoFactorStatus.has2FA && !mfaBypassed) {
      // 2FA is enabled - return pending token for 2FA verification
      const pendingToken = jwt.sign(
        {
          userId: user.id,
          type: 'pending_2fa',
        },
        JWT_SECRET,
        { expiresIn: '5m' } // 5 minute expiry for 2FA step
      );
      
      return res.json({
        success: true,
        requires2FA: true,
        pendingToken,
        userId: user.id,
        methods: {
          totp: twoFactorStatus.totpEnabled,
          passkey: twoFactorStatus.passkeyEnabled,
        },
        gracePeriodDaysRemaining: canProceed.gracePeriodDaysRemaining,
      });
    }

    // No 2FA enabled - check if within grace period (show warning)
    const gracePeriodWarning = canProceed.gracePeriodDaysRemaining !== null
      ? `You have ${canProceed.gracePeriodDaysRemaining} days remaining to set up Multi-Factor Authentication.`
      : null;

    // Check for existing active session (single-session enforcement)
    const existingSessionId = await userService.getActiveSession(user.id);
    if (existingSessionId) {
      // Check if it's not revoked
      if (!isSessionRevoked(existingSessionId)) {
        // If forceLogin is true, invalidate the existing session and proceed
        if (forceLogin) {
          log(`Force login for ${username}: invalidating existing session ${existingSessionId.substring(0, 8)}...`);
          revokeSession(existingSessionId);
          await userService.clearActiveSession(user.id);
          // Also clean up any Snowflake connections for the old session
          closeDashboardConnection(existingSessionId);
        } else {
          log(`Login blocked for ${username}: already has active session ${existingSessionId.substring(0, 8)}...`);
          return res.status(409).json({
            success: false,
            error: 'You are already signed in on another device or browser. Please close your existing session to proceed.',
            code: 'SESSION_ALREADY_EXISTS',
          });
        }
      } else {
        // If the existing session was revoked, clear it and proceed
        await userService.clearActiveSession(user.id);
      }
    }

    // Generate unique session ID for this login
    const sessionId = uuidv4();
    
    // Store the active session
    await userService.setActiveSession(user.id, sessionId, 8); // 8 hours to match JWT
    
    // Generate JWT token with session ID and server instance ID
    // Server instance ID ensures JWTs are invalidated when server restarts
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        sessionId, // Unique per login, used for connection caching
        instanceId: SERVER_INSTANCE_ID, // Invalidates token on server restart
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    log(`App login successful: ${username} with role ${user.role}, session ${sessionId.substring(0, 8)}...`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        theme_preference: user.theme_preference,
      },
      expiresIn: JWT_EXPIRY,
      gracePeriodWarning, // Warning if 2FA not set up but within grace period
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed. Please try again.',
    });
  }
});

/**
 * POST /api/auth/keypair
 * Authenticate with RSA key pair
 */
authRoutes.post('/keypair', async (req, res, next) => {
  try {
    const { account, username, privateKey, passphrase } = req.body;

    if (!account || !username || !privateKey) {
      return res.status(400).json({ 
        error: 'Account, username, and private key are required' 
      });
    }

    const result = await authenticateWithKeyPair({
      account,
      username,
      privateKey,
      passphrase,
    });

    if (result.success) {
      // Get available roles using the sessionId from the user context
      const roles = await getAvailableRoles(result.user.sessionId);
      
      // Auto-switch from system role if needed
      let currentRole = result.user.role;
      if (isSystemRole(currentRole)) {
        const newRole = await autoSwitchFromSystemRole(result.user.sessionId);
        if (newRole) {
          currentRole = newRole;
          log(`Auto-switched from system role to ${newRole}`);
        }
      }
      
      res.json({
        success: true,
        token: result.token,
        user: {
          username: result.user.username,
          role: currentRole,
          account: result.user.account,
        },
        roles: roles.length > 0 ? roles : ['<empty>'],
      });
    } else {
      res.status(401).json({ 
        success: false,
        error: result.error || 'Authentication failed' 
      });
    }
  } catch (error) {
    console.error('Key pair auth error:', error);
    res.status(401).json({ 
      success: false,
      error: error.message || 'Authentication failed' 
    });
  }
});

/**
 * POST /api/auth/pat
 * Authenticate with Programmatic Access Token
 */
authRoutes.post('/pat', async (req, res, next) => {
  try {
    const { account, username, token } = req.body;

    if (!account || !username || !token) {
      return res.status(400).json({ 
        error: 'Account, username, and token are required' 
      });
    }

    const result = await authenticateWithPAT({
      account,
      username,
      token,
    });

    if (result.success) {
      // Get available roles using the sessionId from the user context
      const roles = await getAvailableRoles(result.user.sessionId);
      
      // Auto-switch from system role if needed
      let currentRole = result.user.role;
      if (isSystemRole(currentRole)) {
        const newRole = await autoSwitchFromSystemRole(result.user.sessionId);
        if (newRole) {
          currentRole = newRole;
          log(`Auto-switched from system role to ${newRole}`);
        }
      }
      
      res.json({
        success: true,
        token: result.token,
        user: {
          username: result.user.username,
          role: currentRole,
          account: result.user.account,
        },
        roles: roles.length > 0 ? roles : ['<empty>'],
      });
    } else {
      res.status(401).json({ 
        success: false,
        error: result.error || 'Authentication failed' 
      });
    }
  } catch (error) {
    console.error('PAT auth error:', error);
    res.status(401).json({ 
      success: false,
      error: error.message || 'Authentication failed' 
    });
  }
});

/**
 * GET /api/auth/validate
 * Validate current session token
 */
authRoutes.get('/validate', async (req, res) => {
  try {
    // App user authentication - just check if req.user is set by middleware
    if (req.user) {
      res.json({ 
        valid: true,
        user: req.user,
      });
    } else {
      res.json({ valid: false });
    }
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

/**
 * GET /api/auth/roles
 * Get available roles for current user
 */
authRoutes.get('/roles', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // For app users, return the user's app role
    // App roles are: owner, admin, creator, viewer
    res.json({ 
      roles: [req.user.role], 
      currentRole: req.user.role 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/switch-role
 * Switch to a different role
 */
authRoutes.post('/switch-role', async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }

    if (!req.sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const updatedUser = await switchRole(req.sessionId, role);
    
    res.json({ 
      success: true, 
      role: updatedUser.role,
      user: updatedUser,
      message: `Switched to role: ${role}` 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/auth/heartbeat
 * Keep session alive - for app users, just confirms JWT is valid
 * (Snowflake connections are per-dashboard, not per-session)
 */
authRoutes.post('/heartbeat', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated', alive: false, sessionValid: false });
    }

    // App users - JWT is valid, that's all we need
    res.json({ 
      success: true, 
      alive: true,
      timestamp: new Date().toISOString(),
      sessionValid: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message, alive: false });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh session token
 */
authRoutes.post('/refresh', async (req, res) => {
  try {
    if (!req.sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // For now, just confirm the session is still valid
    // In production, this would issue a new token
    res.json({ 
      success: true,
      message: 'Session refreshed',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/logout
 * End current session, revoke JWT, and clean up cached connections
 */
authRoutes.post('/logout', async (req, res) => {
  try {
    // Get sessionId from JWT for revocation
    const sessionId = req.user?.sessionId || req.sessionId;
    const userId = req.user?.userId;
    
    if (req.sessionId) {
      await logout(req.sessionId);
    }
    
    // Revoke the session so the JWT is no longer valid
    if (sessionId) {
      revokeSession(sessionId);
    }
    
    // Clear the active session from database (for single-session enforcement)
    if (userId) {
      await userService.clearActiveSession(userId);
      log(`Cleared active session for user: ${userId}`);
    } else if (sessionId) {
      await userService.clearSessionById(sessionId);
    }
    
    // Clean up cached Snowflake connections for this session
    if (sessionId) {
      closeDashboardConnection(sessionId);
      log(`Cleaned up cached connections for session: ${sessionId}`);
    }
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success - we don't want logout to fail
    res.json({ success: true, message: 'Logged out' });
  }
});

/**
 * POST /api/auth/test-connection
 * Test the current Snowflake connection
 */
authRoutes.post('/test-connection', async (req, res) => {
  try {
    if (!req.sessionId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    if (!req.snowflakeConnection) {
      return res.status(503).json({ success: false, error: 'No Snowflake connection available' });
    }

    // Test the connection with a simple query
    await new Promise((resolve, reject) => {
      req.snowflakeConnection.execute({
        sqlText: 'SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE()',
        complete: (err, stmt, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      });
    });
    
    res.json({ 
      success: true, 
      message: 'Connection is active',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Connection test failed:', error);
    res.status(503).json({ 
      success: false, 
      error: error.message || 'Connection test failed' 
    });
  }
});

/**
 * POST /api/auth/update-credentials
 * Update the authentication credentials (PAT or keypair)
 */
authRoutes.post('/update-credentials', async (req, res) => {
  try {
    if (!req.sessionId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { type, token, privateKey, passphrase } = req.body;

    if (!type || (type !== 'pat' && type !== 'keypair')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid credential type. Must be "pat" or "keypair"' 
      });
    }

    if (type === 'pat' && !token) {
      return res.status(400).json({ 
        success: false, 
        error: 'PAT token is required' 
      });
    }

    if (type === 'keypair' && !privateKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'Private key is required' 
      });
    }

    // Get current session info to get account and username
    const session = await req.sessionStore?.get(req.sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session not found' });
    }

    let result;
    if (type === 'pat') {
      result = await authenticateWithPAT({
        account: session.account,
        username: session.username,
        token,
      });
    } else {
      result = await authenticateWithKeyPair({
        account: session.account,
        username: session.username,
        privateKey,
        passphrase,
      });
    }

    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Credentials updated successfully',
        token: result.token,
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: result.error || 'Failed to authenticate with new credentials' 
      });
    }
  } catch (error) {
    console.error('Credential update failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to update credentials' 
    });
  }
});

export default authRoutes;
