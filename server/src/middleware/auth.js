/**
 * Simply Analytics - Authentication Middleware
 * 
 * Supports two authentication methods:
 * 1. Snowflake OAuth - User authenticates directly with Snowflake (recommended)
 * 2. Key Pair Authentication - For service accounts using RSA keys
 * 
 * The middleware validates the user and attaches user context to the request.
 * 
 * Session Storage:
 * - Uses Redis for distributed session metadata (user info, role, timestamps)
 * - Keeps Snowflake connections in memory (can't be serialized)
 * - Hybrid approach for horizontal scaling with sticky sessions
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { executeQuery, createConnection } from '../db/dashboardSessionManager.js';
import sessionStore from '../db/redisSessionStore.js';
import configStore from '../config/configStore.js';

// Verbose logging toggle
const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && console.log(...args);

// JWT configuration — read dynamically so hot-reloaded config takes effect
export function getJwtSecret() {
  const secret = configStore.get('JWT_SECRET');
  if (!secret) {
    if (configStore.isConfigured()) {
      throw new Error('JWT_SECRET is not set — refusing to operate without a signing key');
    }
    return 'setup-only-temporary-secret';
  }
  return secret;
}
export function getJwtExpiry() {
  return configStore.get('JWT_EXPIRY') || '8h';
}
function getSessionTimeout() {
  return parseInt(configStore.get('SESSION_TIMEOUT_MINUTES') || '20', 10) * 60 * 1000;
}

// OAuth configuration — read dynamically from configStore
function getOAuthClientId() { return configStore.get('SNOWFLAKE_OAUTH_CLIENT_ID'); }
function getOAuthClientSecret() { return configStore.get('SNOWFLAKE_OAUTH_CLIENT_SECRET'); }
function getOAuthRedirectUri() { return configStore.get('SNOWFLAKE_OAUTH_REDIRECT_URI') || 'http://localhost:3001/api/auth/callback'; }
function getSnowflakeAccount() { return configStore.get('SNOWFLAKE_ACCOUNT'); }

// In-memory session store for Snowflake connection objects
// (Connections can't be serialized to Redis, so we keep them in memory)
// For true horizontal scaling, use sticky sessions (load balancer affinity)
const sessions = new Map();

// Pending OAuth states (for CSRF protection) — capped to prevent memory exhaustion
const MAX_PENDING_OAUTH_STATES = 10_000;
const pendingOAuthStates = new Map();


/**
 * User context attached to authenticated requests
 */
class UserContext {
  constructor(data) {
    this.username = data.username;
    this.role = data.role;
    this.account = data.account;
    this.warehouse = data.warehouse;
    this.database = data.database;
    this.schema = data.schema;
    this.sessionId = data.sessionId;
    this.connection = data.connection;
    this.authenticatedAt = data.authenticatedAt || new Date();
  }

  toJSON() {
    return {
      username: this.username,
      role: this.role,
      account: this.account,
      warehouse: this.warehouse,
      database: this.database,
      sessionId: this.sessionId,
    };
  }
}

/**
 * Generate JWT token for authenticated user
 */
export function generateToken(userContext) {
  const payload = {
    sub: userContext.username,
    role: userContext.role,
    account: userContext.account,
    sessionId: userContext.sessionId,
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, getJwtSecret(), { expiresIn: getJwtExpiry() });
}

/**
 * Create and store a new session
 * Stores in both local memory (for connection) and Redis (for distributed validation)
 */
async function createSession(sessionId, userContext, connection, extras = {}) {
  const now = Date.now();
  
  const sessionData = {
    userContext,
    lastActivity: now,
    createdAt: now,
    connection,
    ...extras,
  };
  
  // Store in local memory (for Snowflake connection access)
  sessions.set(sessionId, sessionData);
  
  // Store in Redis (for distributed session validation)
  await sessionStore.setSession(sessionId, sessionData);
  
  return sessionData;
}

/**
 * Verify JWT token
 * Returns { valid: true, decoded } on success
 * Returns { valid: false, error: string, expired: boolean } on failure
 */
export function verifyToken(token, serverInstanceId = null) {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    
    // Check if JWT was issued by a different server instance (server restart)
    if (serverInstanceId && decoded.instanceId && decoded.instanceId !== serverInstanceId) {
      return { 
        valid: false, 
        error: 'Server restarted - session invalidated', 
        serverRestarted: true,
        expired: false 
      };
    }
    
    return { valid: true, decoded };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired', expired: true, expiredAt: error.expiredAt };
    }
    return { valid: false, error: error.message, expired: false };
  }
}

/**
 * Hash password/token for storage
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Authenticate user with Snowflake credentials
 * Creates a Snowflake connection to validate credentials
 * Uses user's default role if none specified
 */
export async function authenticateWithSnowflake(credentials) {
  const { account, username, password, warehouse } = credentials;

  // Clean account identifier
  let cleanAccount = account.trim();
  cleanAccount = cleanAccount.replace(/^https?:\/\//, '');
  cleanAccount = cleanAccount.replace(/\.snowflakecomputing\.com\/?$/, '');
  cleanAccount = cleanAccount.replace(/\/+$/, '');
  
  log(`Authenticating user ${username} to account ${cleanAccount}`);

  try {
    // Create connection with minimal config - let Snowflake use defaults
    const connection = await createConnection({
      account: cleanAccount,
      username,
      password,
      warehouse: warehouse || undefined, // Let Snowflake use default warehouse
      // Don't specify role/database/schema - use Snowflake defaults
    });

    // Get current user, role, warehouse, database, schema from Snowflake
    const contextResult = await executeQuery(connection, `
      SELECT 
        CURRENT_USER() as user,
        CURRENT_ROLE() as role,
        CURRENT_WAREHOUSE() as warehouse,
        CURRENT_DATABASE() as database,
        CURRENT_SCHEMA() as schema
    `);
    
    const context = contextResult.rows[0] || {};
    const actualUser = context.USER || username;
    const actualRole = context.ROLE || 'PUBLIC';
    const actualWarehouse = context.WAREHOUSE || warehouse;
    const actualDatabase = context.DATABASE;
    const actualSchema = context.SCHEMA || 'PUBLIC';

    // Create session
    const sessionId = crypto.randomUUID();
    const userContext = new UserContext({
      username: actualUser,
      role: actualRole,
      account,
      warehouse: actualWarehouse,
      database: actualDatabase,
      schema: actualSchema,
      sessionId,
      connection,
      authenticatedAt: new Date(),
    });

    // Store session in local memory and Redis
    await createSession(sessionId, userContext, connection);

    // Generate token
    const token = generateToken(userContext);

    return {
      success: true,
      token,
      user: userContext.toJSON(),
      expiresIn: getJwtExpiry(),
    };
  } catch (error) {
    console.error('Authentication failed:', error.message);
    throw new Error('Invalid credentials or connection failed');
  }
}

// ============================================================
// Snowflake OAuth Authentication
// Requires custom OAuth security integration in Snowflake
// ============================================================

/**
 * Generate OAuth authorization URL
 * Requires custom security integration to be configured
 */
export function getOAuthAuthorizationUrl(account) {
  if (!account) {
    throw new Error('Snowflake account is required');
  }
  
  const clientId = getOAuthClientId();
  if (!clientId) {
    throw new Error('OAuth not configured. Set SNOWFLAKE_OAUTH_CLIENT_ID and SNOWFLAKE_OAUTH_CLIENT_SECRET in your environment.');
  }
  
  const state = crypto.randomUUID();

  if (pendingOAuthStates.size >= MAX_PENDING_OAUTH_STATES) {
    const oldest = pendingOAuthStates.keys().next().value;
    pendingOAuthStates.delete(oldest);
  }

  pendingOAuthStates.set(state, {
    account,
    createdAt: Date.now(),
  });

  setTimeout(() => pendingOAuthStates.delete(state), 10 * 60 * 1000);
  
  const redirectUri = getOAuthRedirectUri();
  
  // Build Snowflake OAuth authorization URL
  const authUrl = new URL(`https://${account}.snowflakecomputing.com/oauth/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'session:role:any');
  authUrl.searchParams.set('state', state);
  
  return {
    url: authUrl.toString(),
    state,
  };
}

/**
 * Exchange OAuth authorization code for access token
 */
export async function exchangeOAuthCode(code, state) {
  // Validate state to prevent CSRF
  const pendingState = pendingOAuthStates.get(state);
  if (!pendingState) {
    throw new Error('Invalid or expired OAuth state. Please try again.');
  }
  
  pendingOAuthStates.delete(state);
  const account = pendingState.account;
  
  // Exchange authorization code for access token
  const tokenUrl = `https://${account}.snowflakecomputing.com/oauth/token-request`;
  const redirectUri = getOAuthRedirectUri();
  
  log('Exchanging OAuth code for token...');
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${getOAuthClientId()}:${getOAuthClientSecret()}`
      ).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('OAuth token exchange failed:', errorText);
    throw new Error('Failed to authenticate with Snowflake: ' + errorText);
  }
  
  const tokenData = await response.json();
  log('OAuth token received successfully');
  
  // Create Snowflake connection using the OAuth access token
  const connection = await createConnection({
    account,
    authenticator: 'OAUTH',
    token: tokenData.access_token,
  });
  
  // Get user context from Snowflake
  const contextResult = await executeQuery(connection, `
    SELECT 
      CURRENT_USER() as user,
      CURRENT_ROLE() as role,
      CURRENT_WAREHOUSE() as warehouse,
      CURRENT_DATABASE() as database,
      CURRENT_SCHEMA() as schema
  `);
  
  const context = contextResult.rows[0] || {};
  
  // Create session
  const sessionId = crypto.randomUUID();
  const userContext = new UserContext({
    username: context.USER,
    role: context.ROLE || 'PUBLIC',
    account,
    warehouse: context.WAREHOUSE,
    database: context.DATABASE,
    schema: context.SCHEMA || 'PUBLIC',
    sessionId,
    connection,
    authenticatedAt: new Date(),
  });
  
  // Store session with OAuth tokens for later refresh
  await createSession(sessionId, userContext, connection, {
    authMethod: 'oauth',
    oauthTokens: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
    },
  });
  
  // Generate app JWT token
  const token = generateToken(userContext);
  
  return {
    success: true,
    token,
    user: userContext.toJSON(),
    expiresIn: getJwtExpiry(),
  };
}

/**
 * Check if custom OAuth is configured (for production redirect flow)
 */
export function isOAuthConfigured() {
  return !!(getOAuthClientId() && getOAuthClientSecret());
}

// ============================================================
// Key Pair Authentication
// ============================================================

/**
 * Authenticate with Snowflake using RSA key pair
 * The private key should be provided as a PEM string
 */
/**
 * Authenticate using Programmatic Access Token (PAT)
 * Bypasses MFA - just needs the token and username
 */
export async function authenticateWithPAT(credentials) {
  const { account, username, token } = credentials;

  // Clean account identifier
  let cleanAccount = account.trim();
  cleanAccount = cleanAccount.replace(/^https?:\/\//, '');
  cleanAccount = cleanAccount.replace(/\.snowflakecomputing\.com\/?$/, '');
  cleanAccount = cleanAccount.replace(/\/+$/, '');

  log(`Authenticating ${username} with PAT to account ${cleanAccount}`);
  log(`Token length: ${token?.length || 0} chars`);

  try {
    const connection = await createConnection({
      account: cleanAccount,
      username: username,
      authenticator: 'PROGRAMMATIC_ACCESS_TOKEN',
      token: token,
    });

    // Get current user context
    const contextResult = await executeQuery(connection, `
      SELECT 
        CURRENT_USER() as user,
        CURRENT_ROLE() as role,
        CURRENT_WAREHOUSE() as warehouse,
        CURRENT_DATABASE() as database,
        CURRENT_SCHEMA() as schema
    `);

    const context = contextResult.rows[0] || {};

    // Create session
    const sessionId = crypto.randomUUID();
    const userContext = new UserContext({
      username: context.USER,
      role: context.ROLE || 'PUBLIC',
      account: cleanAccount,
      warehouse: context.WAREHOUSE,
      database: context.DATABASE,
      schema: context.SCHEMA || 'PUBLIC',
      sessionId,
      connection,
      authenticatedAt: new Date(),
    });

    // Store session in local memory and Redis
    await createSession(sessionId, userContext, connection, {
      authMethod: 'pat',
    });

    // Generate JWT
    const jwtToken = generateToken(userContext);

    return {
      success: true,
      token: jwtToken,
      user: userContext.toJSON(),
      expiresIn: getJwtExpiry(),
    };
  } catch (error) {
    console.error('PAT authentication failed:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    throw new Error('PAT authentication failed: ' + error.message);
  }
}

export async function authenticateWithKeyPair(credentials) {
  const { account, username, privateKey, privateKeyPassphrase, warehouse } = credentials;
  
  if (!account || !username || !privateKey) {
    throw new Error('Account, username, and private key are required');
  }
  
  try {
    // Create connection using key pair authentication
    const connection = await createConnection({
      account,
      username,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey,
      privateKeyPass: privateKeyPassphrase,
      warehouse: warehouse || undefined,
    });
    
    // Get user context from Snowflake
    const contextResult = await executeQuery(connection, `
      SELECT 
        CURRENT_USER() as user,
        CURRENT_ROLE() as role,
        CURRENT_WAREHOUSE() as warehouse,
        CURRENT_DATABASE() as database,
        CURRENT_SCHEMA() as schema
    `);
    
    const context = contextResult.rows[0] || {};
    
    // Create session
    const sessionId = crypto.randomUUID();
    const userContext = new UserContext({
      username: context.USER || username,
      role: context.ROLE || 'PUBLIC',
      account,
      warehouse: context.WAREHOUSE || warehouse,
      database: context.DATABASE,
      schema: context.SCHEMA || 'PUBLIC',
      sessionId,
      connection,
      authenticatedAt: new Date(),
    });
    
    // Store session in local memory and Redis
    await createSession(sessionId, userContext, connection, {
      authMethod: 'keypair',
    });
    
    // Generate token
    const token = generateToken(userContext);
    
    return {
      success: true,
      token,
      user: userContext.toJSON(),
      expiresIn: getJwtExpiry(),
    };
  } catch (error) {
    console.error('Key pair authentication failed:', error.message);
    throw new Error('Key pair authentication failed: ' + error.message);
  }
}

/**
 * Get available roles for authenticated user
 * Queries Snowflake for roles granted to the current user
 */
// System roles that should not be used as default
const SYSTEM_ROLES = ['ORGADMIN', 'ACCOUNTADMIN', 'SECURITYADMIN', 'USERADMIN', 'SYSADMIN', 'PUBLIC', 'APPADMIN', 'WORKSHEETS_APP_RL'];

/**
 * Check if a role is a system role
 */
export function isSystemRole(role) {
  return SYSTEM_ROLES.includes((role || '').toUpperCase());
}

/**
 * Auto-switch to first non-system role if current role is a system role
 * Returns the new role if switched, or null if no switch needed/possible
 */
export async function autoSwitchFromSystemRole(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  const currentRole = session.userContext.role;
  
  // If current role is not a system role, no switch needed
  if (!isSystemRole(currentRole)) {
    return null;
  }
  
  // Get available non-system roles
  const availableRoles = await getAvailableRoles(sessionId);
  
  if (availableRoles.length === 0) {
    log(`User has no non-system roles available, staying on ${currentRole}`);
    return null;
  }
  
  // Switch to first available non-system role
  const newRole = availableRoles[0];
  log(`Auto-switching from system role ${currentRole} to ${newRole}`);
  
  try {
    await switchRole(sessionId, newRole);
    return newRole;
  } catch (error) {
    console.error(`Failed to auto-switch role: ${error.message}`);
    return null;
  }
}

export async function getAvailableRoles(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return [];

  try {
    // Get roles granted to the current user
    const result = await executeQuery(
      session.connection, 
      `SHOW GRANTS TO USER "${session.userContext.username.replace(/"/g, '')}"`
    );
    
    // Filter for role grants and extract role names
    // Role grants have granted_on === 'ROLE' AND privilege === 'USAGE'

    // Filter for non-system role grants and extract role names
    const roles = result.rows
      .filter(row => {
        const meetsCriteria = row.granted_on === 'ROLE' && row.privilege === 'USAGE';
        const roleName = (row.role || row.name || '').toUpperCase();
        return meetsCriteria && !SYSTEM_ROLES.includes(roleName);
      })
      .map(row => row.role || row.name)
      .filter(Boolean);

    // Remove duplicates and sort
    const uniqueRoles = [...new Set(roles)].sort();
    
    // Check if current role is a system role
    const currentRoleIsSystem = isSystemRole(session.userContext.role);
    
    // If current role is a system role and we have other roles, suggest switching
    if (currentRoleIsSystem && uniqueRoles.length > 0) {
      log(`Current role ${session.userContext.role} is a system role. Available non-system roles: ${uniqueRoles.join(', ')}`);
      // Don't include system role in the list - user should switch
    } else if (!currentRoleIsSystem && !uniqueRoles.includes(session.userContext.role)) {
      // Current role is not a system role, ensure it's in the list
      uniqueRoles.unshift(session.userContext.role);
    }
    
    return uniqueRoles.length > 0 ? uniqueRoles : [session.userContext.role];
  } catch (error) {
    console.error('Failed to get roles:', error.message);
    
    // Fallback: try SHOW ROLES (shows all roles user can see)
    try {
      const rolesResult = await executeQuery(session.connection, 'SHOW ROLES');
      const allRoles = rolesResult.rows.map(r => r.name).filter(Boolean);
      return allRoles.length > 0 ? allRoles : [session.userContext.role];
    } catch (fallbackError) {
      console.error('Fallback role query failed:', fallbackError.message);
      return [session.userContext.role];
    }
  }
}

/**
 * Switch to a different role
 */
export async function switchRole(sessionId, newRole) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found');

  try {
    await executeQuery(session.connection, `USE ROLE "${newRole.replace(/"/g, '')}"`);
    session.userContext.role = newRole;
    return session.userContext.toJSON();
  } catch (error) {
    throw new Error(`Cannot switch to role ${newRole}: ${error.message}`);
  }
}

/**
 * Logout and destroy session
 * Removes from both Redis and local memory
 */
export async function logout(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    if (session.connection) {
      session.connection.destroy((err) => {
        if (err) console.error('Error destroying connection:', err);
      });
    }
    sessions.delete(sessionId);
  }
  
  // Also remove from Redis
  await sessionStore.deleteSession(sessionId);
  
  return { success: true };
}

/**
 * Authentication middleware
 * Validates JWT token and attaches user context to request
 * Uses Redis for distributed session validation
 */
export async function authMiddleware(req, res, next) {
  // Skip auth for health checks and login
  const publicPaths = ['/api/v1/health', '/api/v1/auth/login'];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Get token from header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  const token = authHeader.substring(7);
  
  // Get current server instance ID for validation
  let serverInstanceId = null;
  try {
    const { getServerInstanceId } = await import('../routes/auth.js');
    serverInstanceId = getServerInstanceId();
  } catch (e) {
    // If we can't get the instance ID, proceed without it
  }
  
  const result = verifyToken(token, serverInstanceId);

  if (!result.valid) {
    // If token expired or server restarted, try to close any Snowflake connections
    if (result.expired || result.serverRestarted) {
      try {
        // Try to decode the token to get sessionId for cleanup
        const tokenPayload = jwt.decode(token);
        if (tokenPayload?.sessionId) {
          const { closeDashboardConnection } = await import('../db/dashboardSessionManager.js');
          await closeDashboardConnection(tokenPayload.sessionId);
          log(`Closed Snowflake connections for ${result.serverRestarted ? 'invalidated' : 'expired'} session: ${tokenPayload.sessionId}`);
        }
      } catch (cleanupErr) {
        console.warn('Error cleaning up session connections:', cleanupErr.message);
      }
    }
    
    // Determine the error code
    let errorCode = 'TOKEN_INVALID';
    let errorMessage = 'Invalid token';
    
    if (result.expired) {
      errorCode = 'TOKEN_EXPIRED';
      errorMessage = 'Token expired';
    } else if (result.serverRestarted) {
      errorCode = 'SERVER_RESTARTED';
      errorMessage = 'Connection to server was lost. Please sign in again.';
    }
    
    return res.status(401).json({ 
      error: errorMessage,
      code: errorCode,
      expired: result.expired,
      serverRestarted: result.serverRestarted
    });
  }

  const decoded = result.decoded;

  // Check if session has been revoked (user signed out)
  if (decoded.sessionId) {
    const { isSessionRevoked } = await import('../routes/auth.js');
    if (isSessionRevoked(decoded.sessionId)) {
      return res.status(401).json({
        error: 'Session has been signed out',
        code: 'SESSION_REVOKED'
      });
    }
  }

  // App-based authentication (PostgreSQL users)
  // JWT is self-contained - no session storage needed
  if (decoded.userId) {
    req.user = {
      id: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      role: decoded.role,
      sessionId: decoded.sessionId, // Include sessionId for connection management
    };
    return next();
  }

  // Legacy support: Snowflake session-based auth (if sessionId present)
  if (decoded.sessionId) {
    // Check Redis for session validity (distributed check)
    const redisSession = await sessionStore.getSession(decoded.sessionId);
    
    // Get local session (for Snowflake connection)
    const localSession = sessions.get(decoded.sessionId);
    
    // Session must exist in Redis (if Redis is active) OR in local memory
    if (!redisSession && !localSession) {
      return res.status(401).json({ 
        error: 'Session expired',
        code: 'SESSION_EXPIRED'
      });
    }

    // Use Redis session data if available, fall back to local
    const sessionData = redisSession || localSession;
    
    // Check session timeout
    if (Date.now() - sessionData.lastActivity > getSessionTimeout()) {
      await logout(decoded.sessionId);
      return res.status(401).json({ 
        error: 'Session timed out',
        code: 'SESSION_TIMEOUT'
      });
    }

    // Update last activity in both stores
    const now = Date.now();
    if (localSession) {
      localSession.lastActivity = now;
    }
    await sessionStore.updateSession(decoded.sessionId, { lastActivity: now });

    // Attach user context to request
    // Prefer local session for userContext (has full object), fall back to Redis data
    req.user = localSession?.userContext || sessionData.userContext;
    req.sessionId = decoded.sessionId;
    req.snowflakeConnection = localSession?.connection || null;

    // If we have Redis session but no local connection, user may need to re-auth
    // (happens when request hits different server instance)
    if (!req.snowflakeConnection && sessionStore.isRedisActive()) {
      console.warn(`Session ${decoded.sessionId} found in Redis but no local connection - may need sticky sessions`);
    }

    return next();
  }

  // If we get here, token was invalid (no userId, no sessionId)
  return res.status(401).json({ 
    error: 'Invalid token format',
    code: 'TOKEN_INVALID'
  });
}

/**
 * Optional auth middleware - allows unauthenticated access but enriches with user if available
 */
export function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const result = verifyToken(token);
    
    if (result.valid) {
      const decoded = result.decoded;
      // App-based authentication (has userId in JWT)
      if (decoded.userId) {
        req.user = {
          id: decoded.userId,
          username: decoded.username,
          email: decoded.email,
          role: decoded.role,
          sessionId: decoded.sessionId,
        };
      } 
      // Legacy Snowflake session-based auth
      else if (decoded.sessionId) {
        const session = sessions.get(decoded.sessionId);
        if (session && Date.now() - session.lastActivity <= getSessionTimeout()) {
          session.lastActivity = Date.now();
          req.user = session.userContext;
          req.sessionId = decoded.sessionId;
          req.snowflakeConnection = session.connection;
        }
      }
    }
  }

  next();
}

/**
 * Get active session count (for monitoring)
 */
export function getActiveSessionCount() {
  return sessions.size;
}

/**
 * Cleanup expired sessions
 */
export function cleanupExpiredSessions() {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > getSessionTimeout()) {
      logout(sessionId);
      cleaned++;
    }
  }

  return cleaned;
}

// Cleanup expired sessions every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

export default authMiddleware;
