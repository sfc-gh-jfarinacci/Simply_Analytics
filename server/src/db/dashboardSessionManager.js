import snowflake from 'snowflake-sdk';
import { acquire as acquireSemaphore } from '../services/querySemaphore.js';

// Verbose logging toggle - set VERBOSE_LOGS=true to enable debug logs
const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && console.log('[sfSession]', ...args);

// Dashboard connection cache - keyed by `sessionId:connectionId`
// Each browser session gets its own cached connections
// Stores { connection, lastUsed, connectionId, sessionId, currentRole, currentWarehouse }
const dashboardConnections = new Map();

// Simple connection store for ad-hoc (non-dashboard) connections
const connections = new Map();

// Pending connection promises to prevent race conditions
// Multiple requests for same session+connection will wait for the same connection
const pendingConnections = new Map();

// Banned connection IDs - when a connection is "refreshed", we ban the connectionId
// until a fresh connection is successfully created. This prevents any stale connections
// from being used even if destroy() doesn't fully work.
const bannedConnectionIds = new Set();

// Connection limits
const MAX_CONNECTIONS = parseInt(process.env.MAX_SF_CONNECTIONS || '200', 10);
const CONNECTION_IDLE_TIMEOUT = 10 * 60 * 1000;  // 10 minutes idle timeout

// Cleanup interval - check for idle connections every minute
setInterval(() => {
  const now = Date.now();
  let closedCount = 0;
  
  for (const [key, entry] of dashboardConnections.entries()) {
    if (now - entry.lastUsed > CONNECTION_IDLE_TIMEOUT) {
      log(`Closing idle dashboard connection: ${key.substring(0, 16)}...`);
      try {
        if (entry.connection && typeof entry.connection.destroy === 'function') {
          entry.connection.destroy();
        }
      } catch (e) {
        console.error('Error closing idle connection:', e.message);
      }
      dashboardConnections.delete(key);
      closedCount++;
    }
  }
  
  if (closedCount > 0) {
    log(`Cleaned up ${closedCount} idle connection(s). Active: ${dashboardConnections.size}`);
  }
}, 60 * 1000);

/**
 * Close oldest connection if we're at the limit
 */
function enforceConnectionLimit() {
  if (dashboardConnections.size < MAX_CONNECTIONS) return;
  
  // Find the oldest connection
  let oldestKey = null;
  let oldestTime = Date.now();
  
  for (const [key, entry] of dashboardConnections.entries()) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }
  
  if (oldestKey) {
    log(`Connection limit reached (${MAX_CONNECTIONS}), closing oldest: ${oldestKey.substring(0, 16)}...`);
    const entry = dashboardConnections.get(oldestKey);
    try {
      if (entry?.connection?.destroy) {
        entry.connection.destroy();
      }
    } catch (e) { /* ignore */ }
    dashboardConnections.delete(oldestKey);
  }
}

/**
 * Switch role and/or warehouse on an existing connection if needed
 * @param connection - Active Snowflake connection
 * @param cached - Cached connection entry
 * @param targetRole - Desired role
 * @param targetWarehouse - Desired warehouse
 * @returns {Promise<boolean>} - True if switch was successful
 */
async function switchRoleAndWarehouseIfNeeded(connection, cached, targetRole, targetWarehouse) {
  let switched = false;
  
  try {
    // Switch role if different
    if (targetRole && cached.currentRole !== targetRole) {
      log(`Switching role from ${cached.currentRole} to ${targetRole}`);
      await _rawExecuteQuery(connection, `USE ROLE "${targetRole}"`);
      cached.currentRole = targetRole;
      switched = true;
    }
    
    // Switch warehouse if different
    if (targetWarehouse && cached.currentWarehouse !== targetWarehouse) {
      log(`Switching warehouse from ${cached.currentWarehouse} to ${targetWarehouse}`);
      await _rawExecuteQuery(connection, `USE WAREHOUSE "${targetWarehouse}"`);
      cached.currentWarehouse = targetWarehouse;
      switched = true;
    }
    
    return true;
  } catch (error) {
    console.error('Failed to switch role/warehouse:', error.message);
    return false;
  }
}

/**
 * Close all connections for a session EXCEPT the one we're about to use
 * This ensures only ONE connection per session is active
 */
function closeOtherSessionConnections(sessionId, keepConnectionId) {
  if (!sessionId) return; // No session ID, nothing to clean up
  
  let closedCount = 0;
  for (const [key, entry] of dashboardConnections.entries()) {
    if (entry.sessionId === sessionId && entry.connectionId !== keepConnectionId) {
      log(`Closing unused connection for session ${sessionId?.substring?.(0, 8) || 'unknown'}...: ${entry.connectionId}`);
      try {
        if (entry.connection?.destroy) {
          entry.connection.destroy();
        }
      } catch (e) { /* ignore */ }
      dashboardConnections.delete(key);
      closedCount++;
    }
  }
  if (closedCount > 0) {
    log(`Freed ${closedCount} unused connection(s) for session. Active: ${dashboardConnections.size}`);
  }
}

/**
 * Get or create a cached dashboard connection
 * This ensures all operations for a session+connection use the same Snowflake connection
 * Automatically switches role/warehouse if the dashboard requires different settings
 * Handles race conditions - multiple concurrent requests will share the same connection
 * IMPORTANT: Only ONE connection per session is kept - switching dashboards frees the old connection
 * @param sessionId - Unique session ID from JWT (per browser login)
 * @param connectionId - Snowflake connection config ID from PostgreSQL
 * @param connectionConfig - Snowflake connection parameters (includes role, warehouse)
 */
export async function getDashboardConnection(sessionId, connectionId, connectionConfig, options = {}) {
  // If no sessionId provided, generate a temporary one (for backwards compatibility)
  const effectiveSessionId = sessionId || `temp-${Date.now()}`;
  const sessionPrefix = effectiveSessionId.substring(0, 8);
  
  const cacheKey = `${effectiveSessionId}:${connectionId}`;
  const targetRole = connectionConfig.role;
  const targetWarehouse = connectionConfig.warehouse;
  
  // Check if this connectionId is banned (was recently refreshed)
  // If banned, we MUST create a fresh connection - do not reuse anything
  const isBanned = bannedConnectionIds.has(connectionId);
  if (isBanned) {
    log(`[${sessionPrefix}] ConnectionId ${connectionId} is BANNED - forcing fresh connection`);
    // Clear the ban since we're about to create a fresh connection
    bannedConnectionIds.delete(connectionId);
    // Make sure cache is completely cleared
    clearCachedConnection(effectiveSessionId, connectionId);
    // Set forceNew so we skip all cache checks below
    options.forceNew = true;
  }
  
  // If forceNew is set, clear any existing connection first
  if (options.forceNew) {
    log(`[${sessionPrefix}] Force new connection requested - clearing all cached connections for ${connectionId}`);
    clearCachedConnection(effectiveSessionId, connectionId);
  }
  
  // FIRST: Close any OTHER connections this session has
  // Each session should only have ONE active Snowflake connection
  closeOtherSessionConnections(effectiveSessionId, connectionId);
  
  // If forceNew, skip the cache entirely and go straight to creating new connection
  if (options.forceNew) {
    log(`[${sessionPrefix}] Skipping cache due to forceNew flag`);
  }
  
  // Check if we have a cached connection that's still alive for THIS connectionId
  const cached = !options.forceNew ? dashboardConnections.get(cacheKey) : null;
  if (cached && cached.connection) {
    try {
      if (cached.connection.isUp()) {
        cached.lastUsed = Date.now();
        
        // Check if we need to switch role or warehouse for this dashboard
        if (cached.currentRole !== targetRole || cached.currentWarehouse !== targetWarehouse) {
          const switchSuccess = await switchRoleAndWarehouseIfNeeded(
            cached.connection, 
            cached, 
            targetRole, 
            targetWarehouse
          );
          
          if (!switchSuccess) {
            // If switch failed, destroy and recreate connection
            log('Role/warehouse switch failed, recreating connection...');
            try {
              cached.connection.destroy();
            } catch (e) { /* ignore */ }
            dashboardConnections.delete(cacheKey);
            // Fall through to create new connection
          } else {
            return cached.connection;
          }
        } else {
          return cached.connection;
        }
      } else {
        // Connection is down, clean it up
        log(`Connection ${cacheKey.substring(0, 16)}... is down, removing from cache`);
        try {
          cached.connection.destroy();
        } catch (e) { /* ignore */ }
        dashboardConnections.delete(cacheKey);
      }
    } catch (e) {
      // Error checking connection state, remove it
      log(`Error checking connection state: ${e.message}`);
      dashboardConnections.delete(cacheKey);
    }
  }
  
  // Check if there's already a pending connection being created for this key
  // This prevents multiple simultaneous requests from creating duplicate connections
  if (pendingConnections.has(cacheKey)) {
    log(`Waiting for pending connection: ${cacheKey.substring(0, 16)}...`);
    return pendingConnections.get(cacheKey);
  }
  
  // Enforce connection limit before creating new one
  enforceConnectionLimit();
  
  // Create the connection promise and store it
  const connectionPromise = (async () => {
    try {
      log(`Creating new dashboard connection for session ${sessionPrefix}... (active: ${dashboardConnections.size})`);
      const connection = await createConnection(connectionConfig);
      
      // IMPORTANT: Set role and warehouse on the new connection
      // The connection is created without a specific role/warehouse, so we must set them
      let actualRole = null;
      let actualWarehouse = null;
      
      if (targetRole) {
        try {
          log(`Setting initial role to: ${targetRole}`);
          await _rawExecuteQuery(connection, `USE ROLE "${targetRole}"`);
          actualRole = targetRole;
        } catch (roleError) {
          console.warn(`Failed to set initial role ${targetRole}:`, roleError.message);
          // Don't fail - the connection might still work with default role
        }
      }
      
      if (targetWarehouse) {
        try {
          log(`Setting initial warehouse to: ${targetWarehouse}`);
          await _rawExecuteQuery(connection, `USE WAREHOUSE "${targetWarehouse}"`);
          actualWarehouse = targetWarehouse;
        } catch (whError) {
          console.warn(`Failed to set initial warehouse ${targetWarehouse}:`, whError.message);
          // Don't fail - queries will fail with clear error if no warehouse
        }
      }
      
      // Cache it with current role/warehouse tracking
      dashboardConnections.set(cacheKey, {
        connection,
        connectionId,
        sessionId: effectiveSessionId,
        currentRole: actualRole,
        currentWarehouse: actualWarehouse,
        lastUsed: Date.now(),
      });
      
      return connection;
    } finally {
      // Always remove from pending, whether success or failure
      pendingConnections.delete(cacheKey);
    }
  })();
  
  // Store the promise so other concurrent requests can wait on it
  pendingConnections.set(cacheKey, connectionPromise);
  
  return connectionPromise;
}

/**
 * Close all dashboard connections for a specific session
 * Called when user logs out
 */
export function closeDashboardConnection(sessionId) {
  let closedCount = 0;
  for (const [key, entry] of dashboardConnections.entries()) {
    if (entry.sessionId === sessionId) {
      try {
        entry.connection.destroy();
      } catch (e) {
        console.error('Error closing connection:', e);
      }
      dashboardConnections.delete(key);
      closedCount++;
    }
  }
  if (closedCount > 0) {
    log(`Closed ${closedCount} cached connection(s) for session ${sessionId?.substring?.(0, 8) || 'unknown'}...`);
  }
}

/**
 * Clear a specific cached connection (by session and connection ID)
 * Used when a connection error occurs (e.g., IP blocked by network policy)
 * This forces a fresh connection on the next request
 */
export function clearCachedConnection(sessionId, connectionId) {
  let cleared = false;
  
  // If sessionId is provided, try to clear specific connection first
  if (sessionId && connectionId) {
    const cacheKey = `${sessionId}:${connectionId}`;
    const cached = dashboardConnections.get(cacheKey);
    
    if (cached) {
      log(`Clearing cached connection: ${cacheKey.substring(0, 16)}... (forcing fresh connection)`);
      try {
        if (cached.connection?.destroy) {
          cached.connection.destroy();
        }
      } catch (e) {
        // Ignore errors when destroying - connection may already be dead
      }
      dashboardConnections.delete(cacheKey);
      cleared = true;
    }
    
    // Also remove any pending connection promise
    if (pendingConnections.has(cacheKey)) {
      log(`Clearing pending connection promise: ${cacheKey.substring(0, 16)}...`);
      pendingConnections.delete(cacheKey);
    }
  }
  
  // Also clear any connection with matching connectionId (handles case where sessionId is missing or changed)
  if (connectionId) {
    for (const [key, entry] of dashboardConnections.entries()) {
      if (key.endsWith(`:${connectionId}`)) {
        log(`Clearing cached connection by connectionId: ${key.substring(0, 16)}...`);
        try {
          if (entry.connection?.destroy) {
            entry.connection.destroy();
          }
        } catch (e) {
          // Ignore errors when destroying
        }
        dashboardConnections.delete(key);
        cleared = true;
      }
    }
    
    // Also clear any pending connections for this connectionId
    for (const key of pendingConnections.keys()) {
      if (key.endsWith(`:${connectionId}`)) {
        log(`Clearing pending connection promise by connectionId: ${key.substring(0, 16)}...`);
        pendingConnections.delete(key);
      }
    }
  }
  
  return cleared;
}

/**
 * Force destroy ALL cached connections for a specific connectionId
 * This is the nuclear option - kills everything and ensures fresh connections
 */
export async function forceDestroyAllForConnection(connectionId) {
  log(`🔥 Force destroying ALL connections for connectionId: ${connectionId}`);
  
  // IMMEDIATELY ban this connectionId to prevent any reuse
  bannedConnectionIds.add(connectionId);
  log(`  ⛔ Banned connectionId: ${connectionId}`);
  
  let destroyedCount = 0;
  const destroyPromises = [];
  
  // Destroy all cached connections matching this connectionId
  for (const [key, entry] of dashboardConnections.entries()) {
    if (key.endsWith(`:${connectionId}`)) {
      log(`  Destroying: ${key}`);
      if (entry.connection) {
        // Create a promise that properly waits for destroy
        const destroyPromise = new Promise((resolve) => {
          try {
            if (typeof entry.connection.destroy === 'function') {
              entry.connection.destroy((err) => {
                if (err) {
                  log(`  Destroy callback error (ignored): ${err.message}`);
                } else {
                  log(`  Connection destroyed successfully: ${key.substring(0, 16)}...`);
                }
                resolve();
              });
            } else {
              resolve();
            }
          } catch (e) {
            log(`  Error destroying: ${e.message}`);
            resolve();
          }
        });
        destroyPromises.push(destroyPromise);
        
        // Null out references immediately
        entry.connection = null;
      }
      dashboardConnections.delete(key);
      destroyedCount++;
    }
  }
  
  // Clear ALL pending connections for this connectionId
  for (const key of pendingConnections.keys()) {
    if (key.endsWith(`:${connectionId}`)) {
      log(`  Clearing pending: ${key}`);
      pendingConnections.delete(key);
      destroyedCount++;
    }
  }
  
  // Wait for all destroys to complete (with timeout)
  if (destroyPromises.length > 0) {
    try {
      await Promise.race([
        Promise.all(destroyPromises),
        new Promise(resolve => setTimeout(resolve, 3000)) // 3 second timeout
      ]);
    } catch (e) {
      log(`  Error waiting for destroys: ${e.message}`);
    }
  }
  
  log(`🔥 Destroyed ${destroyedCount} connection(s) for ${connectionId}`);
  return destroyedCount;
}

/**
 * Check if an error is a network policy error (IP not allowed)
 * These errors mean the cached connection was established from a different IP
 * and the connection needs to be recreated
 */
export function isNetworkPolicyError(error) {
  const errorMessage = error?.message || String(error);
  return errorMessage.includes('not allowed to access Snowflake') ||
         errorMessage.includes('IP/Token') ||
         errorMessage.includes('Network policy') ||
         errorMessage.includes('network policy');
}

/**
 * Get connection cache stats (for debugging/monitoring)
 */
export function getConnectionCacheStats() {
  const stats = {
    activeConnections: dashboardConnections.size,
    pendingConnections: pendingConnections.size,
    maxConnections: MAX_CONNECTIONS,
    connections: [],
  };
  for (const [key, entry] of dashboardConnections.entries()) {
    let isUp = false;
    try {
      isUp = entry.connection?.isUp?.() || false;
    } catch (e) { /* ignore */ }
    stats.connections.push({
      key: key.substring(0, 20) + '...',
      isUp,
      idleSeconds: Math.round((Date.now() - entry.lastUsed) / 1000),
      role: entry.currentRole,
      warehouse: entry.currentWarehouse,
    });
  }
  return stats;
}

// Configure Snowflake SDK for local development
// Configure Snowflake SDK
// IMPORTANT: Disable the internal connection pool to ensure fresh connections on reconnect
snowflake.configure({
  insecureConnect: process.env.NODE_ENV !== 'production' || process.env.SNOWFLAKE_INSECURE_CONNECT === 'true',
  logLevel: 'WARN',
  // Disable connection pooling - we manage our own connection cache
  // This ensures destroy() actually closes the connection and new connections get fresh IPs
  keepAlive: false,
});

// Disable SSL validation ONLY in development (never in production)
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('⚠️  Running with insecure SSL (development mode)');
}

/**
 * Create a Snowflake connection with provided credentials
 * Supports multiple authentication methods:
 * - Password (default)
 * - EXTERNALBROWSER (browser OAuth)
 * - SNOWFLAKE_JWT (Key Pair)
 * - OAUTH (with access token)
 */
export function createConnection(config) {
  return new Promise((resolve, reject) => {
    // Build connection options based on authenticator type


    const connectionOptions = {
      account: config.account,
      username: config.username || '',
      
      // Keep session alive - critical for long-running connections
      clientSessionKeepAlive: true,
      clientSessionKeepAliveHeartbeatFrequency: 60, // Send heartbeat every 60 seconds (minimum is 30)
      
      // Disable HTTP keep-alive to ensure fresh TCP connections on reconnect
      // This helps when IP changes (VPN) since old sockets would use old IP
      keepAlive: false,
    };
    
    // Set authenticator-specific options
    if (config.authenticator) {
      connectionOptions.authenticator = config.authenticator;
      if (config.authenticator === 'SNOWFLAKE_JWT') {
        // Key pair authentication
        connectionOptions.privateKey = config.privateKey;
        connectionOptions.privateKeyPass = config.privateKeyPass;
      } else if (config.authenticator === 'OAUTH') {
        // OAuth with access token
        connectionOptions.token = config.token;
      } else if (config.authenticator === 'PROGRAMMATIC_ACCESS_TOKEN') {
        connectionOptions.authenticator = 'SNOWFLAKE';
        connectionOptions.password = config.token;
      }
    } else {
      // Default: password authentication
      connectionOptions.authenticator = 'SNOWFLAKE';
      connectionOptions.password = config.password;
    }
    
    log('Creating Snowflake connection with options:', {
      account: connectionOptions.account,
      authenticator: connectionOptions.authenticator || 'PASSWORD',
      username: connectionOptions.username || '(none)',
      clientSessionKeepAlive: connectionOptions.clientSessionKeepAlive,
    });
    
    // Set connection timeout (60 seconds for initial connection - PAT auth can be slow)
    connectionOptions.timeout = 60000;
    
    const connection = snowflake.createConnection(connectionOptions);
    
    log('Connecting to Snowflake... (this may take 10-30 seconds)');

    // Use connectAsync for EXTERNALBROWSER (opens browser for SSO/OAuth)
    if (config.authenticator === 'EXTERNALBROWSER') {
      log('Starting EXTERNALBROWSER authentication (browser will open)...');
      connection.connectAsync((err, conn) => {
        if (err) {
          console.error('Failed to connect to Snowflake:', err);
          reject(err);
        } else {
          log('Successfully connected to Snowflake via OAuth');
          resolve(conn);
        }
      });
    } else {
      connection.connect((err, conn) => {
        if (err) {
          console.error('Failed to connect to Snowflake:', err.message);
          
          // Provide helpful error messages
          if (err.message?.includes('RETRY_LOGIN') || err.message?.includes('Incorrect username or password')) {
            reject(new Error('Invalid username or password. Please check your credentials.'));
          } else if (err.message?.includes('not exist') || err.message?.includes('not found')) {
            reject(new Error(`Account "${connectionOptions.account}" not found. Check your account identifier format (e.g., "orgname-accountname" or "accountlocator.region").`));
          } else if (err.message?.includes('MFA') || err.message?.includes('multi-factor')) {
            reject(new Error('MFA is required for this account. Please use SSO/OAuth authentication instead.'));
          } else {
            reject(err);
          }
        } else {
          log('Successfully connected to Snowflake');
          resolve(conn);
        }
      });
    }
  });
}

/**
 * Store a connection for reuse
 */
export function storeConnection(id, connection) {
  connections.set(id, connection);
}

/**
 * Get a stored connection
 */
export function getConnection(id) {
  return connections.get(id);
}

/**
 * Remove a connection
 */
export function removeConnection(id) {
  const conn = connections.get(id);
  if (conn) {
    conn.destroy((err) => {
      if (err) console.error('Error destroying connection:', err);
    });
    connections.delete(id);
  }
}

/**
 * Raw query execution (no concurrency control).
 */
function _rawExecuteQuery(connection, sql, binds = []) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      binds: binds,
      complete: (err, stmt, rows) => {
        if (err) {
          console.error('Query execution failed:', err);
          reject(err);
        } else {
          const columns = stmt.getColumns().map((col) => ({
            name: col.getName(),
            type: col.getType(),
            nullable: col.isNullable(),
            scale: col.getScale(),
            precision: col.getPrecision(),
          }));
          resolve({ rows, columns, rowCount: rows?.length || 0 });
        }
      },
    });
  });
}

const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS || '120000', 10);

/**
 * Execute a SQL query with concurrency semaphore and timeout.
 * @param {object} connection - Snowflake connection
 * @param {string} sql
 * @param {Array} binds
 * @param {{ interactive?: boolean, lane?: string }} opts - lane: 'dashboard' | 'ai' | 'batch', or interactive: true as shorthand for dashboard
 */
export async function executeQuery(connection, sql, binds = [], opts = {}) {
  const lane = opts.lane || (opts.interactive ? 'dashboard' : 'batch');
  const release = await acquireSemaphore(lane);
  let timer;
  try {
    const result = await Promise.race([
      _rawExecuteQuery(connection, sql, binds),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Query timed out')), QUERY_TIMEOUT_MS);
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
    release();
  }
}

/**
 * Get available databases
 */
export async function getDatabases(connection) {
  const result = await executeQuery(connection, 'SHOW DATABASES');
  return result.rows.map((row) => ({
    name: row.name,
    owner: row.owner,
    createdOn: row.created_on,
  }));
}

/**
 * Get schemas in a database
 */
export async function getSchemas(connection, database) {
  const result = await executeQuery(connection, `SHOW SCHEMAS IN DATABASE "${database}"`);
  return result.rows.map((row) => ({
    name: row.name,
    database: database,
    owner: row.owner,
  }));
}

/**
 * Get tables in a schema
 */
export async function getTables(connection, database, schema) {
  const result = await executeQuery(
    connection,
    `SHOW TABLES IN "${database}"."${schema}"`
  );
  return result.rows.map((row) => ({
    name: row.name,
    database: database,
    schema: schema,
    kind: row.kind,
    rows: row.rows,
  }));
}

/**
 * Get columns in a table
 */
export async function getColumns(connection, database, schema, table) {
  const result = await executeQuery(
    connection,
    `DESCRIBE TABLE "${database}"."${schema}"."${table}"`
  );
  return result.rows.map((row) => ({
    name: row.name,
    type: row.type,
    nullable: row.null === 'Y',
    default: row.default,
    primaryKey: row.primary_key === 'Y',
  }));
}

/**
 * Get sample data from a table
 */
export async function getSampleData(connection, database, schema, table, limit = 1000000) {
  return executeQuery(
    connection,
    `SELECT * FROM "${database}"."${schema}"."${table}" LIMIT ${limit}`
  );
}

/**
 * Get warehouses accessible by the current role
 */
export async function getWarehouses(connection) {
  // Get current role
  const currentRoleResult = await executeQuery(connection, 'SELECT CURRENT_ROLE() AS CURRENT_ROLE');
  const currentRole = currentRoleResult.rows[0].CURRENT_ROLE;

  // Get all warehouses visible to account
  const allWarehousesResult = await executeQuery(connection, 'SHOW WAREHOUSES');
  const allWarehouses = allWarehousesResult.rows.map((row) => ({
    name: row.name,
    state: row.state,
    size: row.size,
    type: row.type,
    owner: row.owner,
  }));

  // Get grants for the current role to filter accessible warehouses
  const grantsResult = await executeQuery(connection, `SHOW GRANTS TO ROLE "${currentRole}"`);
  const grantedWarehouses = new Set();
  grantsResult.rows.forEach(grant => {
    if (grant.privilege === 'USAGE' && grant['granted_on'] === 'WAREHOUSE') {
      grantedWarehouses.add(grant['name']);
    }
  });

  // Filter warehouses to only those the role owns or has explicit USAGE on
  return allWarehouses.filter(wh =>
    grantedWarehouses.has(wh.name) || wh.owner === currentRole
  );
}

/**
 * Get semantic views accessible to the current role
 */
export async function getSemanticViews(connection, database = null, schema = null) {
  let sql;
  if (database && schema) {
    sql = `SHOW SEMANTIC VIEWS IN SCHEMA "${database}"."${schema}"`;
  } else if (database) {
    sql = `SHOW SEMANTIC VIEWS IN DATABASE "${database}"`;
  } else {
    sql = 'SHOW SEMANTIC VIEWS';
  }
  
  try {
    const result = await executeQuery(connection, sql);
    return result.rows.map((row) => ({
      name: row.name,
      databaseName: row.database_name,
      schemaName: row.schema_name,
      owner: row.owner,
      createdOn: row.created_on,
      comment: row.comment,
      fullyQualifiedName: `${row.database_name}.${row.schema_name}.${row.name}`,
    }));
  } catch (error) {
    console.error('Failed to get semantic views:', error.message);
    return [];
  }
}