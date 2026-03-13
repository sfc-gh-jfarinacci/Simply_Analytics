import snowflake from 'snowflake-sdk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && console.log('[sfBackend]', ...args);

const SF_ACCOUNT = process.env.SF_SERVICE_ACCOUNT;
const SF_USER = process.env.SF_SERVICE_USER;
const SF_PASSWORD = process.env.SF_SERVICE_PASSWORD;
const SF_PRIVATE_KEY_PATH = process.env.SF_SERVICE_PRIVATE_KEY_PATH;
const SF_PRIVATE_KEY_PASS = process.env.SF_SERVICE_PRIVATE_KEY_PASS || '';
const SF_AUTH_TYPE = process.env.SF_SERVICE_AUTH_TYPE || 'password';
const SF_TOKEN = process.env.SF_SERVICE_TOKEN;

function loadPrivateKey() {
  if (!SF_PRIVATE_KEY_PATH) return null;
  let keyPath = SF_PRIVATE_KEY_PATH;
  if (!path.isAbsolute(keyPath)) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    keyPath = path.resolve(__dirname, '..', '..', '..', keyPath);
  }
  const keyContent = fs.readFileSync(keyPath, 'utf8');
  const privateKeyObj = crypto.createPrivateKey({
    key: keyContent,
    format: 'pem',
    passphrase: SF_PRIVATE_KEY_PASS || undefined,
  });
  return privateKeyObj.export({ type: 'pkcs8', format: 'pem' });
}
const SF_WAREHOUSE = process.env.SF_SERVICE_WAREHOUSE || 'SIMPLY_WH';
const SF_DATABASE = process.env.SF_SERVICE_DATABASE || 'SIMPLY_ANALYTICS';
const SF_SCHEMA = process.env.SF_SERVICE_SCHEMA || 'APP';
const SF_ROLE = process.env.SF_SERVICE_ROLE || 'SIMPLY_SVC_ROLE';

const HEARTBEAT_INTERVAL_SEC = 60;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_RESET_MS = 5 * 60 * 1000;

let serviceConnection = null;
let reconnectAttempts = 0;
let heartbeatTimer = null;
let isConnecting = false;
let connectionPromise = null;

const IS_DEV = process.env.NODE_ENV !== 'production';
const INSECURE_OK = IS_DEV || process.env.SNOWFLAKE_INSECURE_CONNECT === 'true';

snowflake.configure({
  insecureConnect: INSECURE_OK,
  logLevel: 'WARN',
  keepAlive: false,
});

if (INSECURE_OK) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
if (!IS_DEV && INSECURE_OK) {
  console.warn('[sfBackend] WARNING: TLS verification disabled in production via SNOWFLAKE_INSECURE_CONNECT');
}

function sanitizeIdentifier(value) {
  if (!value) return value;
  return value.replace(/"/g, '');
}

function buildConnectionOptions() {
  const opts = {
    account: SF_ACCOUNT,
    username: SF_USER,
    warehouse: sanitizeIdentifier(SF_WAREHOUSE),
    database: sanitizeIdentifier(SF_DATABASE),
    schema: sanitizeIdentifier(SF_SCHEMA),
    role: sanitizeIdentifier(SF_ROLE),
    clientSessionKeepAlive: true,
    clientSessionKeepAliveHeartbeatFrequency: HEARTBEAT_INTERVAL_SEC,
    keepAlive: false,
    timeout: 60000,
  };

  if (SF_AUTH_TYPE === 'keypair') {
    opts.authenticator = 'SNOWFLAKE_JWT';
    opts.privateKey = loadPrivateKey();
  } else if (SF_AUTH_TYPE === 'pat') {
    opts.authenticator = 'SNOWFLAKE';
    opts.password = SF_TOKEN;
  } else {
    opts.authenticator = 'SNOWFLAKE';
    opts.password = SF_PASSWORD;
  }

  return opts;
}

function createServiceConnection() {
  return new Promise((resolve, reject) => {
    const opts = buildConnectionOptions();
    log('Connecting to Snowflake service account...', { account: opts.account, user: opts.username, role: opts.role, warehouse: opts.warehouse });
    const conn = snowflake.createConnection(opts);
    conn.connect((err, c) => {
      if (err) {
        console.error('[sfBackend] Service connection failed:', err.message);
        reject(err);
      } else {
        log('Service connection established');
        resolve(c);
      }
    });
  });
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    if (!serviceConnection) return;
    try {
      if (!serviceConnection.isUp()) {
        console.warn('[sfBackend] Heartbeat: connection is down, reconnecting...');
        await reconnect();
        return;
      }
      await executeRaw(serviceConnection, 'SELECT 1');
      log('Heartbeat OK');
    } catch (err) {
      console.error('[sfBackend] Heartbeat failed:', err.message);
      await reconnect();
    }
  }, HEARTBEAT_INTERVAL_SEC * 1000);
}

let lastSuccessfulConnect = Date.now();

async function reconnect() {
  if (isConnecting) return connectionPromise;

  if (Date.now() - lastSuccessfulConnect > RECONNECT_RESET_MS && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('[sfBackend] Resetting reconnect counter after cooldown period');
    reconnectAttempts = 0;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`[sfBackend] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Will retry after ${RECONNECT_RESET_MS / 1000}s cooldown.`);
    return;
  }

  isConnecting = true;
  reconnectAttempts++;
  const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_DELAY_MS);
  console.log(`[sfBackend] Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} (backoff ${delay}ms)...`);

  try {
    if (serviceConnection) {
      try { serviceConnection.destroy(); } catch (e) {}
    }
    serviceConnection = null;
    await new Promise(r => setTimeout(r, delay));
    serviceConnection = await createServiceConnection();
    reconnectAttempts = 0;
    lastSuccessfulConnect = Date.now();
    log('Reconnected successfully');
  } catch (err) {
    console.error('[sfBackend] Reconnect failed:', err.message);
    serviceConnection = null;
  } finally {
    isConnecting = false;
  }
}

export async function initServiceConnection() {
  if (serviceConnection) return serviceConnection;
  if (isConnecting) return connectionPromise;

  if (!SF_ACCOUNT || !SF_USER) {
    console.warn('[sfBackend] Missing SF_SERVICE_ACCOUNT or SF_SERVICE_USER - skipping service connection');
    return null;
  }

  isConnecting = true;
  connectionPromise = (async () => {
    try {
      serviceConnection = await createServiceConnection();
      reconnectAttempts = 0;
      startHeartbeat();

      await executeRaw(serviceConnection, `USE DATABASE "${sanitizeIdentifier(SF_DATABASE)}"`);
      await executeRaw(serviceConnection, `USE SCHEMA "${sanitizeIdentifier(SF_SCHEMA)}"`);
      await executeRaw(serviceConnection, `USE WAREHOUSE "${sanitizeIdentifier(SF_WAREHOUSE)}"`);

      return serviceConnection;
    } catch (err) {
      console.error('[sfBackend] Init failed:', err.message);
      serviceConnection = null;
      throw err;
    } finally {
      isConnecting = false;
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

function executeRaw(connection, sql, binds = []) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      binds,
      complete: (err, stmt, rows) => {
        if (err) reject(err);
        else resolve({ rows: rows || [], statement: stmt });
      },
    });
  });
}

async function getConnection() {
  if (serviceConnection && serviceConnection.isUp()) return serviceConnection;
  if (isConnecting && connectionPromise) return connectionPromise;
  await reconnect();
  if (!serviceConnection) throw new Error('Snowflake service connection unavailable');
  return serviceConnection;
}

export async function query(sql, params = []) {
  const conn = await getConnection();
  const start = Date.now();

  const binds = params.map(p => (p === undefined ? null : p));

  let sfSql = sql;
  let paramIndex = 0;
  sfSql = sfSql.replace(/\$(\d+)/g, () => {
    paramIndex++;
    return '?';
  });

  try {
    const { rows, statement } = await executeRaw(conn, sfSql, binds);
    const duration = Date.now() - start;
    if (VERBOSE) {
      log('Query:', { sql: sfSql.substring(0, 100), duration, rows: rows?.length });
    }

    const normalizedRows = rows.map(row => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[key.toLowerCase()] = value;
      }
      return normalized;
    });

    return {
      rows: normalizedRows,
      rowCount: normalizedRows.length,
    };
  } catch (err) {
    console.error('[sfBackend] Query error:', err.message);
    console.error('[sfBackend] SQL:', sfSql.substring(0, 200));
    throw err;
  }
}

export async function transaction(callback) {
  const conn = await getConnection();
  try {
    await executeRaw(conn, 'BEGIN');
    const result = await callback({ query: (sql, params) => query(sql, params) });
    await executeRaw(conn, 'COMMIT');
    return result;
  } catch (err) {
    try { await executeRaw(conn, 'ROLLBACK'); } catch (e) {}
    throw err;
  }
}

export async function getClient() {
  return { query: (sql, params) => query(sql, params), release: () => {} };
}

export async function testConnection() {
  try {
    const result = await query('SELECT CURRENT_TIMESTAMP() AS now');
    console.log('[sfBackend] Connection test OK at', result.rows[0]?.now);
    return true;
  } catch (err) {
    console.error('[sfBackend] Connection test failed:', err.message);
    return false;
  }
}

export async function closeConnection() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (serviceConnection) {
    try { serviceConnection.destroy(); } catch (e) {}
    serviceConnection = null;
  }
  console.log('[sfBackend] Service connection closed');
}

export function getServiceConfig() {
  return {
    account: SF_ACCOUNT,
    database: SF_DATABASE,
    schema: SF_SCHEMA,
    warehouse: SF_WAREHOUSE,
    role: SF_ROLE,
  };
}

export default {
  query,
  getClient,
  transaction,
  testConnection,
  closeConnection,
  initServiceConnection,
  getServiceConfig,
};
