/**
 * Connection Service
 * 
 * Manages Snowflake connection configurations stored in PostgreSQL.
 * Credentials are encrypted at rest using AES-256.
 */

import CryptoJS from 'crypto-js';
import { query, transaction } from '../db/postgres.js';

// Verbose logging toggle
const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && log(...args);
import { 
  createConnection as createSnowflakeConnection, 
  executeQuery, 
  getDashboardConnection,
  clearCachedConnection,
  isNetworkPolicyError
} from '../db/snowflake.js';

// Encryption key from environment (should be 32+ chars for AES-256)
const ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY || 'default-encryption-key-change-in-production';

/**
 * Encrypt credentials for storage
 */
function encryptCredentials(credentials) {
  const json = JSON.stringify(credentials);
  return CryptoJS.AES.encrypt(json, ENCRYPTION_KEY).toString();
}

/**
 * Decrypt credentials from storage
 */
function decryptCredentials(encrypted) {
  const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
  const json = bytes.toString(CryptoJS.enc.Utf8);
  return JSON.parse(json);
}

/**
 * Get all connections for a user
 */
export async function getConnectionsByUser(userId) {
  const result = await query(`
    SELECT 
      id, name, description, account, username, auth_type,
      default_warehouse, default_role, is_valid, last_tested,
      last_test_error, created_at, updated_at
    FROM snowflake_connections
    WHERE user_id = $1
    ORDER BY name ASC
  `, [userId]);
  
  return result.rows;
}

/**
 * Get a specific connection by ID (checks user ownership)
 */
export async function getConnectionById(connectionId, userId) {
  const result = await query(`
    SELECT 
      id, name, description, user_id, account, username, auth_type,
      credentials_encrypted, default_warehouse, default_role, 
      is_valid, last_tested, last_test_error, created_at, updated_at
    FROM snowflake_connections
    WHERE id = $1 AND user_id = $2
  `, [connectionId, userId]);
  
  return result.rows[0] || null;
}

/**
 * Get a connection by ID for dashboard access (doesn't check user ownership)
 * Used when viewers/editors access dashboards - they use the owner's connection
 */
export async function getConnectionForDashboard(connectionId) {
  const result = await query(`
    SELECT 
      id, name, description, user_id, account, username, auth_type,
      credentials_encrypted, default_warehouse, default_role, 
      is_valid, last_tested, last_test_error, created_at, updated_at
    FROM snowflake_connections
    WHERE id = $1
  `, [connectionId]);
  
  return result.rows[0] || null;
}

/**
 * Get connection with decrypted credentials (checks user ownership)
 */
export async function getConnectionWithCredentials(connectionId, userId) {
  const connection = await getConnectionById(connectionId, userId);
  if (!connection) {
    return null;
  }

  try {
    const credentials = decryptCredentials(connection.credentials_encrypted);
    return {
      ...connection,
      credentials,
    };
  } catch (error) {
    console.error('Failed to decrypt credentials:', error.message);
    throw new Error('Failed to decrypt connection credentials');
  }
}

/**
 * Get connection with decrypted credentials for dashboard access
 * Used when viewers/editors access dashboards - they use the owner's connection
 */
export async function getConnectionWithCredentialsForDashboard(connectionId) {
  const connection = await getConnectionForDashboard(connectionId);
  if (!connection) {
    return null;
  }

  try {
    const credentials = decryptCredentials(connection.credentials_encrypted);
    return {
      ...connection,
      credentials,
    };
  } catch (error) {
    console.error('Failed to decrypt credentials:', error.message);
    throw new Error('Failed to decrypt connection credentials');
  }
}

/**
 * Create a new Snowflake connection
 */
export async function createConnection(userId, connectionData) {
  const {
    name,
    description,
    account,
    username,
    authType, // 'pat' or 'keypair'
    credentials, // { token } for PAT, { privateKey, passphrase } for keypair
    defaultWarehouse,
    defaultRole,
  } = connectionData;

  // Validate auth type
  if (!['pat', 'keypair'].includes(authType)) {
    throw new Error('Invalid auth type. Must be "pat" or "keypair"');
  }

  // Encrypt credentials
  const encryptedCredentials = encryptCredentials(credentials);

  const result = await query(`
    INSERT INTO snowflake_connections 
      (name, description, user_id, account, username, auth_type, 
       credentials_encrypted, default_warehouse, default_role)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, name, description, account, username, auth_type,
              default_warehouse, default_role, created_at
  `, [
    name,
    description || null,
    userId,
    account,
    username,
    authType,
    encryptedCredentials,
    defaultWarehouse || null,
    defaultRole || null,
  ]);

  return result.rows[0];
}

/**
 * Update an existing connection
 */
export async function updateConnection(connectionId, userId, updates) {
  // Get existing connection to ensure ownership
  const existing = await getConnectionById(connectionId, userId);
  if (!existing) {
    throw new Error('Connection not found');
  }

  const allowedFields = ['name', 'description', 'account', 'username', 
                          'default_warehouse', 'default_role'];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase to snake_case
    if (allowedFields.includes(dbKey)) {
      setClauses.push(`${dbKey} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  // Handle credentials update separately
  if (updates.credentials) {
    setClauses.push(`credentials_encrypted = $${paramIndex}`);
    values.push(encryptCredentials(updates.credentials));
    paramIndex++;

    if (updates.authType) {
      setClauses.push(`auth_type = $${paramIndex}`);
      values.push(updates.authType);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(connectionId, userId);
  const result = await query(`
    UPDATE snowflake_connections
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
    RETURNING id, name, description, account, username, auth_type,
              default_warehouse, default_role, updated_at
  `, values);

  return result.rows[0];
}

/**
 * Delete a connection
 */
export async function deleteConnection(connectionId, userId) {
  // Check if connection is used by any dashboards
  const dashboardCheck = await query(
    'SELECT COUNT(*) FROM dashboards WHERE connection_id = $1',
    [connectionId]
  );

  if (parseInt(dashboardCheck.rows[0].count) > 0) {
    throw new Error('Cannot delete connection that is in use by dashboards');
  }

  const result = await query(`
    DELETE FROM snowflake_connections
    WHERE id = $1 AND user_id = $2
    RETURNING id
  `, [connectionId, userId]);

  if (result.rowCount === 0) {
    throw new Error('Connection not found');
  }

  return true;
}

/**
 * Test a connection to Snowflake
 */
export async function testConnection(connectionId, userId) {
  const connWithCreds = await getConnectionWithCredentials(connectionId, userId);
  if (!connWithCreds) {
    throw new Error('Connection not found');
  }

  try {
    // Build Snowflake connection config
    const sfConfig = {
      account: connWithCreds.account,
      username: connWithCreds.username,
      warehouse: connWithCreds.default_warehouse,
      role: connWithCreds.default_role,
    };

    // Add auth based on type
    if (connWithCreds.auth_type === 'pat') {
      sfConfig.authenticator = 'PROGRAMMATIC_ACCESS_TOKEN';
      sfConfig.token = connWithCreds.credentials.token;
    } else if (connWithCreds.auth_type === 'keypair') {
      sfConfig.authenticator = 'SNOWFLAKE_JWT';
      sfConfig.privateKey = connWithCreds.credentials.privateKey;
      sfConfig.privateKeyPass = connWithCreds.credentials.passphrase;
    }

    // Attempt connection
    const connection = await createSnowflakeConnection(sfConfig);
    
    // Run a simple query
    const result = await executeQuery(connection, 'SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE()');
    
    // Close connection
    connection.destroy();

    // Update connection status
    await query(`
      UPDATE snowflake_connections
      SET is_valid = true, last_tested = CURRENT_TIMESTAMP, last_test_error = NULL
      WHERE id = $1
    `, [connectionId]);

    return {
      success: true,
      user: result.rows[0]['CURRENT_USER()'],
      role: result.rows[0]['CURRENT_ROLE()'],
      warehouse: result.rows[0]['CURRENT_WAREHOUSE()'],
    };
  } catch (error) {
    // Update connection status with error
    await query(`
      UPDATE snowflake_connections
      SET is_valid = false, last_tested = CURRENT_TIMESTAMP, last_test_error = $1
      WHERE id = $2
    `, [error.message.substring(0, 1000), connectionId]);

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get Snowflake resources available through a connection
 * First call: just get roles
 * Second call (with role): get warehouses and semantic views for that role
 */
export async function getSnowflakeResources(connectionId, userId, selectedRole = null) {
  const connWithCreds = await getConnectionWithCredentials(connectionId, userId);
  if (!connWithCreds) {
    throw new Error('Connection not found');
  }

  // Build Snowflake connection config
  const sfConfig = {
    account: connWithCreds.account,
    username: connWithCreds.username,
    warehouse: connWithCreds.default_warehouse,
    // Use selected role if provided, otherwise use default
    role: selectedRole || connWithCreds.default_role,
  };

  if (connWithCreds.auth_type === 'pat') {
    sfConfig.authenticator = 'PROGRAMMATIC_ACCESS_TOKEN';
    sfConfig.token = connWithCreds.credentials.token;
  } else {
    sfConfig.authenticator = 'SNOWFLAKE_JWT';
    sfConfig.privateKey = connWithCreds.credentials.privateKey;
    sfConfig.privateKeyPass = connWithCreds.credentials.passphrase;
  }

  const connection = await createSnowflakeConnection(sfConfig);

  try {
    // Always get available roles first
    const rolesResult = await executeQuery(connection, 'SHOW ROLES');
    const roles = rolesResult.rows.map(r => r.name);

    // If no role selected yet, just return roles
    if (!selectedRole) {
      return {
        roles,
        warehouses: [],
        semanticViews: [],
      };
    }

    // Switch to the selected role to get its available warehouses
    await executeQuery(connection, `USE ROLE "${selectedRole}"`);

    // Get available warehouses for this role
    const warehousesResult = await executeQuery(connection, 'SHOW WAREHOUSES');
    const warehouses = warehousesResult.rows.map(w => w.name);

    // Get semantic views using SHOW SEMANTIC VIEWS command
    let semanticViews = [];
    try {
      const semanticResult = await executeQuery(connection, 'SHOW SEMANTIC VIEWS');
      semanticViews = semanticResult.rows.map((row) => ({
        name: row.name,
        database: row.database_name,
        schema: row.schema_name,
        fullyQualifiedName: `${row.database_name}.${row.schema_name}.${row.name}`,
      }));
      log(`Found ${semanticViews.length} semantic views for role ${selectedRole}`);
    } catch (e) {
      log('Semantic views query failed (may not have access):', e.message);
    }

    // Get Cortex agents available to this role
    let cortexAgents = [];
    try {
      const cortexResult = await executeQuery(connection, 'SHOW AGENTS IN ACCOUNT');
      cortexAgents = cortexResult.rows.map((row) => ({
        name: row.name,
        database: row.database_name,
        schema: row.schema_name,
        fullyQualifiedName: `${row.database_name}.${row.schema_name}.${row.name}`,
      }));
      log(`Found ${cortexAgents.length} cortex agents for role ${selectedRole}`);
    } catch (e) {
      log('Cortex agents query failed (may not have access):', e.message);
    }

    return {
      roles,
      warehouses,
      semanticViews,
      cortexAgents,
    };
  } finally {
    connection.destroy();
  }
}

/**
 * Get a cached Snowflake connection for dashboard operations
 * This reuses connections instead of creating new ones for each query
 * Automatically switches role/warehouse if dashboard requires different settings
 * Handles network policy errors (IP change) by clearing cache and retrying
 * @param connectionId - Snowflake connection config ID
 * @param userId - App user ID (for permission check)
 * @param sessionId - Unique session ID from JWT (for connection caching)
 * @param options - Optional overrides for dashboard-specific settings
 * @param options.role - Dashboard-specific role (overrides connection default)
 * @param options.warehouse - Dashboard-specific warehouse (overrides connection default)
 * @param options.forceRefresh - Force a new connection (clear cache first)
 */
export async function getCachedDashboardConnection(connectionId, userId, sessionId, options = {}) {
  // Use dashboard-specific function that doesn't check user ownership
  // This allows viewers to use the dashboard owner's connection
  const connWithCreds = await getConnectionWithCredentialsForDashboard(connectionId);
  if (!connWithCreds) {
    throw new Error('Connection not found');
  }

  // Build Snowflake connection config
  // Use dashboard-specific role/warehouse if provided, otherwise use connection defaults
  const sfConfig = {
    account: connWithCreds.account,
    username: connWithCreds.username,
    warehouse: options.warehouse || connWithCreds.default_warehouse,
    role: options.role || connWithCreds.default_role,
  };

  if (connWithCreds.auth_type === 'pat') {
    sfConfig.authenticator = 'PROGRAMMATIC_ACCESS_TOKEN';
    sfConfig.token = connWithCreds.credentials.token;
  } else {
    sfConfig.authenticator = 'SNOWFLAKE_JWT';
    sfConfig.privateKey = connWithCreds.credentials.privateKey;
    sfConfig.privateKeyPass = connWithCreds.credentials.passphrase;
  }

  // If forceRefresh, clear the cached connection first and force a new one
  if (options.forceRefresh) {
    log(`Force refresh requested for connection ${connectionId}`);
    // Clear cache for ALL sessions, not just this one
    clearCachedConnection(sessionId, connectionId);
  }

  // Use the cached connection pool, keyed by session+connection
  // The pool will automatically switch role/warehouse if needed
  try {
    return await getDashboardConnection(sessionId, connectionId, sfConfig, { 
      forceNew: options.forceRefresh 
    });
  } catch (error) {
    // If this is a network policy error, destroy all connections for this connectionId
    // and DON'T retry - user needs to click Reconnect button after IP is allowed
    if (isNetworkPolicyError(error)) {
      log(`Network policy error detected (IP blocked). Destroying all connections - user must reconnect.`);
      // Force destroy all connections to stop heartbeats
      const { forceDestroyAllForConnection } = await import('../db/snowflake.js');
      await forceDestroyAllForConnection(connectionId);
      
      // Re-throw with clear message - don't retry
      throw new Error(`Failed to connect: ${error.message}. Your IP may not be allowed. Check Snowflake network policies.`);
    }
    
    // Re-throw the error
    throw error;
  }
}

export default {
  getConnectionsByUser,
  getConnectionById,
  getConnectionForDashboard,
  getConnectionWithCredentials,
  getConnectionWithCredentialsForDashboard,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
  getSnowflakeResources,
  getCachedDashboardConnection,
};
