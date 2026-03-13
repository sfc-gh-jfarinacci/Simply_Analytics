import crypto from 'crypto';
import { query, transaction, now } from '../db/db.js';
import { encryptCredentials, decryptCredentials } from '../utils/encryption.js';

const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && console.log(...args);
import { 
  createConnection as createSnowflakeConnection, 
  executeQuery, 
  getDashboardConnection,
  clearCachedConnection,
  isNetworkPolicyError
} from '../db/dashboardSessionManager.js';



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

export async function createConnection(userId, connectionData) {
  const {
    name,
    description,
    account,
    username,
    authType,
    credentials,
    defaultWarehouse,
    defaultRole,
  } = connectionData;

  if (!['pat', 'keypair'].includes(authType)) {
    throw new Error('Invalid auth type. Must be "pat" or "keypair"');
  }

  const encryptedCredentials = encryptCredentials(credentials);
  const id = crypto.randomUUID();

  await query(`
    INSERT INTO snowflake_connections 
      (id, name, description, user_id, account, username, auth_type, 
       credentials_encrypted, default_warehouse, default_role)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    id,
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

  const result = await query(
    `SELECT id, name, description, account, username, auth_type,
            default_warehouse, default_role, created_at
     FROM snowflake_connections WHERE id = $1`,
    [id]
  );

  return result.rows[0];
}

export async function updateConnection(connectionId, userId, updates) {
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
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowedFields.includes(dbKey)) {
      setClauses.push(`${dbKey} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

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
  await query(`
    UPDATE snowflake_connections
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
  `, values);

  const result = await query(
    `SELECT id, name, description, account, username, auth_type,
            default_warehouse, default_role, updated_at
     FROM snowflake_connections WHERE id = $1 AND user_id = $2`,
    [connectionId, userId]
  );

  return result.rows[0];
}

export async function deleteConnection(connectionId, userId) {
  const dashboardCheck = await query(
    'SELECT COUNT(*) as count FROM dashboards WHERE connection_id = $1',
    [connectionId]
  );

  if (parseInt(dashboardCheck.rows[0].count) > 0) {
    throw new Error('Cannot delete connection that is in use by dashboards');
  }

  const existing = await query(
    'SELECT id FROM snowflake_connections WHERE id = $1 AND user_id = $2',
    [connectionId, userId]
  );

  if (existing.rows.length === 0) {
    throw new Error('Connection not found');
  }

  await query(`
    DELETE FROM snowflake_connections
    WHERE id = $1 AND user_id = $2
  `, [connectionId, userId]);

  return true;
}

export async function testConnection(connectionId, userId) {
  const connWithCreds = await getConnectionWithCredentials(connectionId, userId);
  if (!connWithCreds) {
    throw new Error('Connection not found');
  }

  try {
    const sfConfig = {
      account: connWithCreds.account,
      username: connWithCreds.username,
      warehouse: connWithCreds.default_warehouse,
      role: connWithCreds.default_role,
    };

    if (connWithCreds.auth_type === 'pat') {
      sfConfig.authenticator = 'PROGRAMMATIC_ACCESS_TOKEN';
      sfConfig.token = connWithCreds.credentials.token;
    } else if (connWithCreds.auth_type === 'keypair') {
      sfConfig.authenticator = 'SNOWFLAKE_JWT';
      sfConfig.privateKey = connWithCreds.credentials.privateKey;
      sfConfig.privateKeyPass = connWithCreds.credentials.passphrase;
    }

    const connection = await createSnowflakeConnection(sfConfig);
    
    const result = await executeQuery(connection, 'SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE()');
    
    connection.destroy();

    await query(`
      UPDATE snowflake_connections
      SET is_valid = true, last_tested = ${now()}, last_test_error = NULL
      WHERE id = $1
    `, [connectionId]);

    return {
      success: true,
      user: result.rows[0]['CURRENT_USER()'],
      role: result.rows[0]['CURRENT_ROLE()'],
      warehouse: result.rows[0]['CURRENT_WAREHOUSE()'],
    };
  } catch (error) {
    await query(`
      UPDATE snowflake_connections
      SET is_valid = false, last_tested = ${now()}, last_test_error = $1
      WHERE id = $2
    `, [error.message.substring(0, 1000), connectionId]);

    return {
      success: false,
      error: error.message,
    };
  }
}

export async function getSnowflakeResources(connectionId, userId, selectedRole = null) {
  const connWithCreds = await getConnectionWithCredentials(connectionId, userId);
  if (!connWithCreds) {
    throw new Error('Connection not found');
  }

  const sfConfig = {
    account: connWithCreds.account,
    username: connWithCreds.username,
    warehouse: connWithCreds.default_warehouse,
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
    const rolesResult = await executeQuery(connection, 'SHOW ROLES');
    const roles = rolesResult.rows.map(r => r.name);

    if (!selectedRole) {
      return {
        roles,
        warehouses: [],
        semanticViews: [],
      };
    }

    await executeQuery(connection, `USE ROLE "${selectedRole}"`);

    const warehousesResult = await executeQuery(connection, 'SHOW WAREHOUSES');
    const warehouses = warehousesResult.rows.map(w => w.name);

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

export async function getCachedDashboardConnection(connectionId, userId, sessionId, options = {}) {
  const connWithCreds = await getConnectionWithCredentialsForDashboard(connectionId);
  if (!connWithCreds) {
    throw new Error('Connection not found');
  }

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

  if (options.forceRefresh) {
    log(`Force refresh requested for connection ${connectionId}`);
    clearCachedConnection(sessionId, connectionId);
  }

  try {
    return await getDashboardConnection(sessionId, connectionId, sfConfig, { 
      forceNew: options.forceRefresh 
    });
  } catch (error) {
    if (isNetworkPolicyError(error)) {
      log(`Network policy error detected (IP blocked). Destroying all connections - user must reconnect.`);
      const { forceDestroyAllForConnection } = await import('../db/dashboardSessionManager.js');
      await forceDestroyAllForConnection(connectionId);
      
      throw new Error(`Failed to connect: ${error.message}. Your IP may not be allowed. Check Snowflake network policies.`);
    }
    
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
