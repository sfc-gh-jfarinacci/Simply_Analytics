/**
 * PostgreSQL Database Connection
 * 
 * Manages connection pool for the application database
 * which stores users, connections, dashboards, and groups.
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Create connection pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'simply_analytics',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('PostgreSQL: New client connected to pool');
});

pool.on('error', (err) => {
  console.error('PostgreSQL: Unexpected error on idle client', err);
});

/**
 * Execute a query with parameters
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('PostgreSQL query:', { text: text.substring(0, 100), duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    console.error('PostgreSQL query error:', error.message);
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const originalRelease = client.release.bind(client);
  
  // Set a timeout of 5 seconds, after which we will log this client's last query
  const timeout = setTimeout(() => {
    console.error('A client has been checked out for more than 5 seconds!');
  }, 5000);

  client.query = (...args) => {
    return originalQuery(...args);
  };

  client.release = () => {
    clearTimeout(timeout);
    return originalRelease();
  };

  return client;
}

/**
 * Execute a transaction
 */
export async function transaction(callback) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Test database connection
 */
export async function testConnection() {
  try {
    const result = await query('SELECT NOW()');
    console.log('PostgreSQL: Connection successful at', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('PostgreSQL: Connection failed', error.message);
    return false;
  }
}

/**
 * Close all connections
 */
export async function closePool() {
  await pool.end();
  console.log('PostgreSQL: Connection pool closed');
}

export default {
  query,
  getClient,
  transaction,
  testConnection,
  closePool,
  pool,
};
