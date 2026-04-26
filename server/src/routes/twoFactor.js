/**
 * Multi-Factor Authentication Routes
 * 
 * Handles TOTP and Passkey setup, verification, and management.
 */

import { Router } from 'express';
import twoFactorService from '../services/twoFactorService.js';
import { getServerInstanceId } from './auth.js';
import configStore from '../config/configStore.js';
import { getJwtSecret } from '../middleware/auth.js';

export const twoFactorRoutes = Router();

// ============================================
// 2FA Status
// ============================================

/**
 * GET /api/v1/2fa/status
 * Get current user's 2FA status
 */
twoFactorRoutes.get('/status', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const status = await twoFactorService.get2FAStatus(req.user.id);
    res.json(status);
  } catch (error) {
    console.error('Error getting 2FA status:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TOTP Routes
// ============================================

/**
 * POST /api/v1/2fa/totp/setup
 * Generate TOTP secret and QR code for setup
 */
twoFactorRoutes.post('/totp/setup', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const result = await twoFactorService.generateTotpSecret(
      req.user.id,
      req.user.username
    );
    
    res.json({
      secret: result.secret,
      qrCode: result.qrCodeDataUrl,
      otpauthUrl: result.otpauthUrl,
    });
  } catch (error) {
    console.error('Error setting up TOTP:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/2fa/totp/verify
 * Verify TOTP code and enable TOTP
 */
twoFactorRoutes.post('/totp/verify', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    
    const result = await twoFactorService.verifyAndEnableTotp(req.user.id, code);
    
    res.json({
      success: true,
      message: 'TOTP enabled successfully',
      backupCodes: result.backupCodes,
    });
  } catch (error) {
    console.error('Error verifying TOTP:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/2fa/totp
 * Disable TOTP
 */
twoFactorRoutes.delete('/totp', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Require password confirmation for security
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password confirmation required' });
    }
    
    // Verify password (import bcrypt and user query)
    const bcrypt = await import('bcryptjs');
    const { query } = await import('../db/db.js');
    
    const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isValidPassword = await bcrypt.default.compare(password, userResult.rows[0].password_hash);
    
    if (!isValidPassword) {
      // Use 400 instead of 401 to avoid triggering session expiry handling
      return res.status(400).json({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
    }
    
    await twoFactorService.disableTotp(req.user.id);
    
    res.json({ success: true, message: 'TOTP disabled' });
  } catch (error) {
    console.error('Error disabling TOTP:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Passkey Routes
// ============================================

/**
 * POST /api/v1/2fa/passkey/register-options
 * Get WebAuthn registration options
 */
twoFactorRoutes.post('/passkey/register-options', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const options = await twoFactorService.generatePasskeyRegistrationOptions(
      req.user.id,
      req.user.username,
      req.user.displayName || req.user.username
    );
    
    res.json(options);
  } catch (error) {
    console.error('Error getting passkey registration options:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/2fa/passkey/register-verify
 * Verify and save passkey registration
 */
twoFactorRoutes.post('/passkey/register-verify', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { response, name } = req.body;
    
    if (!response) {
      return res.status(400).json({ error: 'Response is required' });
    }
    
    const result = await twoFactorService.verifyPasskeyRegistration(
      req.user.id,
      response,
      name
    );
    
    res.json({
      success: true,
      message: 'Passkey registered successfully',
      credentialId: result.credentialId,
    });
  } catch (error) {
    console.error('Error verifying passkey registration:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/v1/2fa/passkeys
 * Get user's registered passkeys
 */
twoFactorRoutes.get('/passkeys', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const passkeys = await twoFactorService.getUserPasskeys(req.user.id);
    res.json({ passkeys });
  } catch (error) {
    console.error('Error getting passkeys:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/2fa/passkey/:id
 * Remove a passkey
 */
twoFactorRoutes.delete('/passkey/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password confirmation required' });
    }
    
    // Verify password
    const bcrypt = await import('bcryptjs');
    const { query } = await import('../db/db.js');
    
    const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isValidPassword = await bcrypt.default.compare(password, userResult.rows[0].password_hash);
    
    if (!isValidPassword) {
      // Use 400 instead of 401 to avoid triggering session expiry handling
      return res.status(400).json({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
    }
    
    await twoFactorService.removePasskey(req.user.id, req.params.id);
    
    res.json({ success: true, message: 'Passkey removed' });
  } catch (error) {
    console.error('Error removing passkey:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Login Verification (called during 2FA step of login)
// ============================================

/**
 * POST /api/v1/2fa/validate/totp
 * Validate TOTP code during login (requires pending 2FA session)
 */
twoFactorRoutes.post('/validate/totp', async (req, res) => {
  try {
    const { userId, code, pendingToken, forceLogin } = req.body;
    
    if (!userId || !code || !pendingToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Verify pending token (this should be a short-lived token from password verification)
    const jwt = await import('jsonwebtoken');
    
    try {
      const decoded = jwt.default.verify(pendingToken, getJwtSecret());
      
      if (decoded.userId !== userId || decoded.type !== 'pending_2fa') {
        return res.status(401).json({ error: 'Invalid pending token' });
      }
    } catch (tokenError) {
      return res.status(401).json({ error: 'Pending token expired' });
    }
    
    // Validate TOTP
    const result = await twoFactorService.validateTotpCode(userId, code);
    
    // Get user details and session utilities
    const { query } = await import('../db/db.js');
    const userResult = await query(
      'SELECT id, username, email, role, display_name, theme_preference, auth_provider, totp_enabled, passkey_enabled FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    
    // Import session management utilities
    const userService = await import('../services/userService.js');
    const { isSessionRevoked, revokeSession } = await import('./auth.js');
    const { closeDashboardConnection } = await import('../db/dashboardSessionManager.js');
    const { v4: uuidv4 } = await import('uuid');
    
    // Check for existing active session (single-session enforcement)
    const existingSessionId = await userService.getActiveSession(user.id);
    if (existingSessionId) {
      if (!isSessionRevoked(existingSessionId)) {
        if (forceLogin) {
          // Force login - invalidating existing session
          revokeSession(existingSessionId);
          await userService.clearActiveSession(user.id);
          closeDashboardConnection(existingSessionId);
        } else {
          return res.status(409).json({
            success: false,
            error: 'You are already signed in on another device or browser. Please close your existing session to proceed.',
            code: 'SESSION_ALREADY_EXISTS',
          });
        }
      } else {
        await userService.clearActiveSession(user.id);
      }
    }
    
    // Generate unique session ID
    const sessionId = uuidv4();
    
    // Store the active session
    await userService.setActiveSession(user.id, sessionId, 8); // 8 hours
    
    // Generate full auth token with session ID
    const token = jwt.default.sign(
      { 
        userId: user.id, 
        username: user.username, 
        email: user.email,
        role: user.role,
        sessionId,
        instanceId: getServerInstanceId(),
      },
      getJwtSecret(),
      { expiresIn: '8h' }
    );
    
    // TOTP login successful
    
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
        auth_provider: user.auth_provider,
        totp_enabled: user.totp_enabled || false,
        passkey_enabled: user.passkey_enabled || false,
      },
      method: result.method,
      remainingBackupCodes: result.remainingBackupCodes,
      expiresIn: '8h',
    });
  } catch (error) {
    console.error('Error validating TOTP:', error);
    res.status(401).json({ error: error.message });
  }
});

/**
 * POST /api/v1/2fa/validate/passkey/options
 * Get passkey authentication options during login
 */
twoFactorRoutes.post('/validate/passkey/options', async (req, res) => {
  try {
    const { userId, pendingToken } = req.body;
    
    if (!userId || !pendingToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Verify pending token
    const jwt = await import('jsonwebtoken');
    
    try {
      const decoded = jwt.default.verify(pendingToken, getJwtSecret());
      
      if (decoded.userId !== userId || decoded.type !== 'pending_2fa') {
        return res.status(401).json({ error: 'Invalid pending token' });
      }
    } catch (tokenError) {
      return res.status(401).json({ error: 'Pending token expired' });
    }
    
    const options = await twoFactorService.generatePasskeyAuthOptions(userId);
    res.json(options);
  } catch (error) {
    console.error('Error getting passkey auth options:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/2fa/validate/passkey/verify
 * Verify passkey during login
 */
twoFactorRoutes.post('/validate/passkey/verify', async (req, res) => {
  try {
    const { userId, response, pendingToken, forceLogin } = req.body;
    
    if (!userId || !response || !pendingToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Verify pending token
    const jwt = await import('jsonwebtoken');
    
    try {
      const decoded = jwt.default.verify(pendingToken, getJwtSecret());
      
      if (decoded.userId !== userId || decoded.type !== 'pending_2fa') {
        return res.status(401).json({ error: 'Invalid pending token' });
      }
    } catch (tokenError) {
      return res.status(401).json({ error: 'Pending token expired' });
    }
    
    // Verify passkey
    await twoFactorService.verifyPasskeyAuthentication(userId, response);
    
    // Get user details
    const { query } = await import('../db/db.js');
    const userResult = await query(
      'SELECT id, username, email, role, display_name, theme_preference, auth_provider, totp_enabled, passkey_enabled FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    
    // Import session management utilities
    const userService = await import('../services/userService.js');
    const { isSessionRevoked, revokeSession } = await import('./auth.js');
    const { closeDashboardConnection } = await import('../db/dashboardSessionManager.js');
    const { v4: uuidv4 } = await import('uuid');
    
    // Check for existing active session (single-session enforcement)
    const existingSessionId = await userService.getActiveSession(user.id);
    if (existingSessionId) {
      if (!isSessionRevoked(existingSessionId)) {
        if (forceLogin) {
          // Force login - invalidating existing session
          revokeSession(existingSessionId);
          await userService.clearActiveSession(user.id);
          closeDashboardConnection(existingSessionId);
        } else {
          return res.status(409).json({
            success: false,
            error: 'You are already signed in on another device or browser. Please close your existing session to proceed.',
            code: 'SESSION_ALREADY_EXISTS',
          });
        }
      } else {
        await userService.clearActiveSession(user.id);
      }
    }
    
    // Generate unique session ID
    const sessionId = uuidv4();
    
    // Store the active session
    await userService.setActiveSession(user.id, sessionId, 8); // 8 hours
    
    // Generate full auth token with session ID
    const token = jwt.default.sign(
      { 
        userId: user.id, 
        username: user.username, 
        email: user.email,
        role: user.role,
        sessionId,
        instanceId: getServerInstanceId(),
      },
      getJwtSecret(),
      { expiresIn: '8h' }
    );
    
    // Passkey login successful
    
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
        auth_provider: user.auth_provider,
        totp_enabled: user.totp_enabled || false,
        passkey_enabled: user.passkey_enabled || false,
      },
      expiresIn: '8h',
    });
  } catch (error) {
    console.error('Error verifying passkey:', error);
    res.status(401).json({ error: error.message });
  }
});

export default twoFactorRoutes;
