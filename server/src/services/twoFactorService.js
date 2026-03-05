/**
 * Multi-Factor Authentication Service
 * 
 * Handles TOTP (Time-based One-Time Password) and Passkey (WebAuthn) authentication.
 */

import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { query } from '../db/postgres.js';
import crypto from 'crypto';

// App configuration for WebAuthn
const RP_NAME = process.env.APP_NAME || 'Simply Analytics';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173';

// Encryption key for TOTP secrets (use environment variable in production)
const ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY || 'default-encryption-key-change-me!';

// Configure authenticator with time window for clock drift
// Window of 2 means it accepts codes from 60 seconds in the past to 60 seconds in the future
authenticator.options = { window: 2 };

/**
 * Encrypt a string using AES-256
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a string using AES-256
 */
function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================
// TOTP Functions
// ============================================

/**
 * Generate a new TOTP secret for a user
 */
export async function generateTotpSecret(userId, username) {
  // Generate secret
  const secret = authenticator.generateSecret();
  
  // Create otpauth URL
  const otpauthUrl = authenticator.keyuri(username, RP_NAME, secret);
  
  // Generate QR code as data URL
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  
  // Store encrypted secret (but don't enable yet - wait for verification)
  const encryptedSecret = encrypt(secret);
  await query(
    'UPDATE users SET totp_secret = $1 WHERE id = $2',
    [encryptedSecret, userId]
  );
  
  return {
    secret,
    otpauthUrl,
    qrCodeDataUrl,
  };
}

/**
 * Verify a TOTP code and enable TOTP if valid
 */
export async function verifyAndEnableTotp(userId, code) {
  // Get user's TOTP secret
  const result = await query(
    'SELECT totp_secret FROM users WHERE id = $1',
    [userId]
  );
  
  if (!result.rows[0]?.totp_secret) {
    throw new Error('TOTP not set up for this user');
  }
  
  const secret = decrypt(result.rows[0].totp_secret);
  
  // Ensure code is a string and trimmed
  const cleanCode = String(code).trim();
  

  // Generate expected code for debugging
  const expectedCode = authenticator.generate(secret);
 
  
  // Verify the code (window is set globally at module level)
  const isValid = authenticator.verify({ token: cleanCode, secret });
  
 
  
  if (!isValid) {
    // Generate what the current code should be for debugging
    const expectedCode = authenticator.generate(secret);
 
    throw new Error('Invalid TOTP code. Please ensure your authenticator app time is synced.');
  }
  
  // Enable TOTP for the user
  await query(
    'UPDATE users SET totp_enabled = true WHERE id = $1',
    [userId]
  );
  
  // Generate backup codes
  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = backupCodes.map(code => ({
    code: crypto.createHash('sha256').update(code).digest('hex'),
    used: false,
  }));
  
  // Store backup codes in preferences
  await query(
    `UPDATE users SET preferences = preferences || $1::jsonb WHERE id = $2`,
    [JSON.stringify({ backupCodes: hashedBackupCodes }), userId]
  );
  
  return {
    success: true,
    backupCodes, // Return plain backup codes to show user once
  };
}

/**
 * Validate a TOTP code during login
 */
export async function validateTotpCode(userId, code) {
  // Get user's TOTP secret
  const result = await query(
    'SELECT totp_secret, totp_enabled, preferences FROM users WHERE id = $1',
    [userId]
  );
  
  if (!result.rows[0]?.totp_enabled || !result.rows[0]?.totp_secret) {
    throw new Error('TOTP not enabled for this user');
  }
  
  const secret = decrypt(result.rows[0].totp_secret);
  
  // Ensure code is a string and trimmed
  const cleanCode = String(code).trim();
  

  // Generate expected code for debugging
  const expectedCode = authenticator.generate(secret);

  
  // Verify the code (window is set globally at module level)
  const isValid = authenticator.verify({ token: cleanCode, secret });

  
  if (isValid) {
    return { success: true, method: 'totp' };
  }
  
  // Try backup codes
  const preferences = result.rows[0].preferences || {};
  const backupCodes = preferences.backupCodes || [];
  const hashedInput = crypto.createHash('sha256').update(code).digest('hex');
  
  const backupIndex = backupCodes.findIndex(bc => bc.code === hashedInput && !bc.used);
  
  if (backupIndex >= 0) {
    // Mark backup code as used
    backupCodes[backupIndex].used = true;
    await query(
      `UPDATE users SET preferences = preferences || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ backupCodes }), userId]
    );
    
    return { success: true, method: 'backup_code', remainingBackupCodes: backupCodes.filter(bc => !bc.used).length };
  }
  
  throw new Error('Invalid code');
}

/**
 * Disable TOTP for a user
 */
export async function disableTotp(userId) {
  await query(
    'UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1',
    [userId]
  );
  
  // Remove backup codes
  await query(
    `UPDATE users SET preferences = preferences - 'backupCodes' WHERE id = $1`,
    [userId]
  );
  
  return { success: true };
}

/**
 * Generate backup codes
 */
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
}

// ============================================
// Passkey/WebAuthn Functions
// ============================================

/**
 * Convert a UUID string to Uint8Array for WebAuthn
 */
function uuidToUint8Array(uuid) {
  // Remove hyphens and convert to Uint8Array
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert base64url string to Uint8Array
 */
function base64urlToUint8Array(base64url) {
  // Add padding if needed
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = Buffer.from(base64, 'base64');
  return new Uint8Array(binary);
}

/**
 * Convert Uint8Array to base64url string
 */
function uint8ArrayToBase64url(uint8Array) {
  return Buffer.from(uint8Array).toString('base64url');
}

/**
 * Generate WebAuthn registration options
 */
export async function generatePasskeyRegistrationOptions(userId, username, displayName) {
  // Get existing credentials
  const result = await query(
    'SELECT passkey_credentials FROM users WHERE id = $1',
    [userId]
  );
  
  const existingCredentials = result.rows[0]?.passkey_credentials || [];
  
  // Convert userId to Uint8Array (required by @simplewebauthn/server v10+)
  const userIdBytes = uuidToUint8Array(userId);
  
  // Generate registration options
  // In @simplewebauthn/server v10+, excludeCredentials[].id should be a base64url STRING
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: userIdBytes,
    userName: username,
    userDisplayName: displayName || username,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map(cred => ({
      id: cred.credentialID, // Already stored as base64url string
      type: 'public-key',
      transports: cred.transports,
    })),
    authenticatorSelection: {
      residentKey: 'required',  // Force discoverable credential (true passkey)
      requireResidentKey: true, // Legacy compatibility
      userVerification: 'preferred',
    },
  });
  
  // Store challenge for verification
  await storeChallenge(userId, options.challenge, 'registration');
  
  return options;
}

/**
 * Verify WebAuthn registration response
 */
export async function verifyPasskeyRegistration(userId, response, credentialName) {
  // Get stored challenge
  const challenge = await getChallenge(userId, 'registration');
  
  if (!challenge) {
    throw new Error('Registration challenge not found or expired');
  }
  
  // Verify the registration
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
  });
  
  if (!verification.verified) {
    throw new Error('Registration verification failed');
  }
  

  
  // In @simplewebauthn/server v10+, the structure is verification.registrationInfo
  const regInfo = verification.registrationInfo || {};
  const credentialPublicKey = regInfo.credentialPublicKey || regInfo.credential?.publicKey;
  const counter = regInfo.counter ?? regInfo.credential?.counter ?? 0;
  
  if (!credentialPublicKey) {

    throw new Error('Registration verification failed - no public key');
  }
  
  // Store the credential
  // Use response.id directly (already base64url) instead of re-encoding registrationInfo.credentialID
  // This ensures the credential ID matches what the browser will return during authentication
  const newCredential = {
    credentialID: response.id, // Use the original ID from the response
    credentialPublicKey: uint8ArrayToBase64url(credentialPublicKey),
    counter: counter,
    transports: response.response.transports || [],
    name: credentialName || `Passkey ${new Date().toLocaleDateString()}`,
    createdAt: new Date().toISOString(),
  };
  
  
  
  // Add to user's credentials
  await query(
    `UPDATE users 
     SET passkey_credentials = passkey_credentials || $1::jsonb,
         passkey_enabled = true
     WHERE id = $2`,
    [JSON.stringify([newCredential]), userId]
  );
  
  // Clean up challenge
  await deleteChallenge(userId, 'registration');
  
  return { success: true, credentialId: newCredential.credentialID };
}

/**
 * Generate WebAuthn authentication options
 */
export async function generatePasskeyAuthOptions(userId) {
  // Get user's credentials
  const result = await query(
    'SELECT passkey_credentials FROM users WHERE id = $1',
    [userId]
  );
  
  const credentials = result.rows[0]?.passkey_credentials || [];
  
  if (credentials.length === 0) {
    throw new Error('No passkeys registered');
  }
  
  // Generate authentication options
  // In @simplewebauthn/server v10+, allowCredentials[].id should be a base64url STRING
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: credentials.map(cred => ({
      id: cred.credentialID, // Already stored as base64url string
      type: 'public-key',
      transports: cred.transports,
    })),
    userVerification: 'preferred',
  });
  
  // Store challenge for verification
  await storeChallenge(userId, options.challenge, 'authentication');
  
  return options;
}

/**
 * Verify WebAuthn authentication response
 */
export async function verifyPasskeyAuthentication(userId, response) {
  // Get stored challenge
  const challenge = await getChallenge(userId, 'authentication');
  
  if (!challenge) {
    throw new Error('Authentication challenge not found or expired');
  }
  
  // Get user's credentials
  const result = await query(
    'SELECT passkey_credentials FROM users WHERE id = $1',
    [userId]
  );
  
  const credentials = result.rows[0]?.passkey_credentials || [];
  const credentialId = response.id;
  

  
  // Find the matching credential
  const credential = credentials.find(c => c.credentialID === credentialId);
  
  if (!credential) {
   
    throw new Error('Credential not found. You may have an old passkey in your browser. Please delete passkeys for localhost in Chrome settings (chrome://settings/passwords) and register a new one.');
  }
  

  
  let verification;
  try {
    // Try different API formats for different versions of @simplewebauthn/server
    const credentialData = {
      id: credential.credentialID,
      publicKey: base64urlToUint8Array(credential.credentialPublicKey),
      counter: credential.counter ?? 0,
    };
    

    
    // Try with 'authenticator' (older API)
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      authenticator: {
        credentialID: base64urlToUint8Array(credential.credentialID),
        credentialPublicKey: base64urlToUint8Array(credential.credentialPublicKey),
        counter: credential.counter ?? 0,
      },
    });
  } catch (verifyError) {
    console.error('[2FA] Verification error:', verifyError);
    throw verifyError;
  }
  
  if (!verification.verified) {
    throw new Error('Authentication verification failed');
  }
  

  // Update counter - handle different response structures in different versions
  const authInfo = verification.authenticationInfo || {};
  const newCounter = authInfo.newCounter ?? authInfo.counter ?? credential.counter + 1;
  
  const updatedCredentials = credentials.map(c => 
    c.credentialID === credentialId 
      ? { ...c, counter: newCounter }
      : c
  );
  
  await query(
    'UPDATE users SET passkey_credentials = $1::jsonb WHERE id = $2',
    [JSON.stringify(updatedCredentials), userId]
  );
  
  // Clean up challenge
  await deleteChallenge(userId, 'authentication');
  
  return { success: true };
}

/**
 * Remove a passkey
 */
export async function removePasskey(userId, credentialId) {
  const result = await query(
    'SELECT passkey_credentials FROM users WHERE id = $1',
    [userId]
  );
  
  const credentials = result.rows[0]?.passkey_credentials || [];
  const updatedCredentials = credentials.filter(c => c.credentialID !== credentialId);
  
  await query(
    `UPDATE users 
     SET passkey_credentials = $1::jsonb,
         passkey_enabled = $2
     WHERE id = $3`,
    [JSON.stringify(updatedCredentials), updatedCredentials.length > 0, userId]
  );
  
  return { success: true };
}

/**
 * Get user's passkeys (without sensitive data)
 */
export async function getUserPasskeys(userId) {
  const result = await query(
    'SELECT passkey_credentials FROM users WHERE id = $1',
    [userId]
  );
  
  const credentials = result.rows[0]?.passkey_credentials || [];
  
  return credentials.map(c => ({
    id: c.credentialID,
    name: c.name,
    createdAt: c.createdAt,
  }));
}

// ============================================
// Challenge Management
// ============================================

async function storeChallenge(userId, challenge, type) {
  // Delete any existing challenges of this type
  await deleteChallenge(userId, type);
  
  // Store new challenge with 5-minute expiry
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  
  await query(
    `INSERT INTO webauthn_challenges (user_id, challenge, type, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, challenge, type, expiresAt]
  );
}

async function getChallenge(userId, type) {
  const result = await query(
    `SELECT challenge FROM webauthn_challenges 
     WHERE user_id = $1 AND type = $2 AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [userId, type]
  );
  
  return result.rows[0]?.challenge || null;
}

async function deleteChallenge(userId, type) {
  await query(
    'DELETE FROM webauthn_challenges WHERE user_id = $1 AND type = $2',
    [userId, type]
  );
}

// ============================================
// 2FA Status & Enforcement
// ============================================

/**
 * Get user's 2FA status
 */
export async function get2FAStatus(userId) {
  const result = await query(
    `SELECT 
      totp_enabled,
      passkey_enabled,
      passkey_credentials,
      two_factor_required,
      two_factor_grace_period_start,
      two_factor_grace_days,
      account_locked,
      account_locked_reason,
      account_unlock_expires
    FROM users WHERE id = $1`,
    [userId]
  );
  
  if (!result.rows[0]) {
    throw new Error('User not found');
  }
  
  const user = result.rows[0];
  const has2FA = user.totp_enabled || user.passkey_enabled;
  const passkeyCount = (user.passkey_credentials || []).length;
  
  // Calculate grace period status
  let gracePeriodExpired = false;
  let gracePeriodDaysRemaining = null;
  let graceStart = user.two_factor_grace_period_start;
  const graceDays = user.two_factor_grace_days || 7;
  
  // If 2FA is required, user doesn't have it, but grace period hasn't started - start it now
  if (user.two_factor_required && !has2FA && !graceStart) {
    graceStart = new Date();
    await query(
      `UPDATE users SET two_factor_grace_period_start = NOW() WHERE id = $1`,
      [userId]
    );
   
  }
  
  if (user.two_factor_required && !has2FA && graceStart) {
    const graceStartDate = new Date(graceStart);
    const graceEnd = new Date(graceStartDate.getTime() + graceDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    
    if (now > graceEnd) {
      gracePeriodExpired = true;
    } else {
      gracePeriodDaysRemaining = Math.ceil((graceEnd - now) / (24 * 60 * 60 * 1000));
    }
  }
  
  return {
    totpEnabled: user.totp_enabled,
    passkeyEnabled: user.passkey_enabled,
    passkeyCount,
    twoFactorRequired: user.two_factor_required,
    has2FA,
    gracePeriodExpired,
    gracePeriodDaysRemaining,
    accountLocked: user.account_locked,
    accountLockedReason: user.account_locked_reason,
    accountUnlockExpires: user.account_unlock_expires,
  };
}

/**
 * Check if user can proceed (not locked, or within grace period)
 */
export async function checkUserCanProceed(userId) {
  const status = await get2FAStatus(userId);
  
  // Check if account is temporarily unlocked
  if (status.accountLocked && status.accountUnlockExpires) {
    const unlockExpires = new Date(status.accountUnlockExpires);
    if (new Date() < unlockExpires) {
      // Temporarily unlocked
      return { canProceed: true, reason: 'temporarily_unlocked' };
    }
  }
  
  // Check if account is locked
  if (status.accountLocked) {
    return { canProceed: false, reason: 'account_locked', message: status.accountLockedReason };
  }
  
  // Check if 2FA is required but not set up and grace period expired
  if (status.twoFactorRequired && !status.has2FA && status.gracePeriodExpired) {
    // Lock the account
    await query(
      `UPDATE users 
       SET account_locked = true, 
           account_locked_reason = 'MFA setup required - grace period expired'
       WHERE id = $1`,
      [userId]
    );
    
    return { canProceed: false, reason: 'grace_period_expired' };
  }
  
  return { 
    canProceed: true, 
    needs2FA: status.has2FA,
    gracePeriodDaysRemaining: status.gracePeriodDaysRemaining,
  };
}

/**
 * Start grace period for a user (called when 2FA becomes required)
 */
export async function startGracePeriod(userId, graceDays = 7) {
  await query(
    `UPDATE users 
     SET two_factor_required = true,
         two_factor_grace_period_start = NOW(),
         two_factor_grace_days = $1
     WHERE id = $2`,
    [graceDays, userId]
  );
}

// ============================================
// Admin Functions
// ============================================

/**
 * Unlock a user's account (admin only)
 */
export async function unlockUserAccount(userId, unlockDurationHours = null) {
  const updates = {
    account_locked: false,
    account_locked_reason: null,
  };
  
  if (unlockDurationHours) {
    // Temporary unlock
    const unlockExpires = new Date(Date.now() + unlockDurationHours * 60 * 60 * 1000);
    await query(
      `UPDATE users 
       SET account_locked = false,
           account_locked_reason = NULL,
           account_unlock_expires = $1
       WHERE id = $2`,
      [unlockExpires, userId]
    );
    
    return { success: true, temporary: true, expiresAt: unlockExpires };
  } else {
    // Permanent unlock (until they miss grace period again)
    await query(
      `UPDATE users 
       SET account_locked = false,
           account_locked_reason = NULL,
           account_unlock_expires = NULL,
           two_factor_grace_period_start = NOW()
       WHERE id = $1`,
      [userId]
    );
    
    return { success: true, temporary: false };
  }
}

/**
 * Set 2FA grace period for a user (admin only)
 */
export async function setUserGracePeriod(userId, graceDays) {
  await query(
    `UPDATE users 
     SET two_factor_grace_days = $1,
         two_factor_grace_period_start = NOW()
     WHERE id = $2`,
    [graceDays, userId]
  );
  
  return { success: true, graceDays };
}

/**
 * Require or exempt user from 2FA (admin only)
 */
export async function setUser2FARequirement(userId, required) {
  if (required) {
    // Start grace period when requiring 2FA
    await startGracePeriod(userId);
  } else {
    await query(
      `UPDATE users 
       SET two_factor_required = false,
           two_factor_grace_period_start = NULL
       WHERE id = $1`,
      [userId]
    );
  }
  
  return { success: true, required };
}

export default {
  // TOTP
  generateTotpSecret,
  verifyAndEnableTotp,
  validateTotpCode,
  disableTotp,
  
  // Passkey
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generatePasskeyAuthOptions,
  verifyPasskeyAuthentication,
  removePasskey,
  getUserPasskeys,
  
  // Status
  get2FAStatus,
  checkUserCanProceed,
  startGracePeriod,
  
  // Admin
  unlockUserAccount,
  setUserGracePeriod,
  setUser2FARequirement,
};
