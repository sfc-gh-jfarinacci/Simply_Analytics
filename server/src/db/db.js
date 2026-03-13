import dotenv from 'dotenv';
dotenv.config();

const BACKEND = (process.env.METADATA_BACKEND || 'snowflake').toLowerCase();

if (!['postgres', 'snowflake'].includes(BACKEND)) {
  throw new Error(`Invalid METADATA_BACKEND: "${BACKEND}". Must be "postgres" or "snowflake".`);
}

const isPg = BACKEND === 'postgres';

// ---------------------------------------------------------------------------
// Dialect helpers — return SQL fragments for the active backend.
// Services call these instead of hardcoding Snowflake or Postgres syntax.
// ---------------------------------------------------------------------------

export function parseJson(paramRef) {
  if (isPg) return `${paramRef}::jsonb`;
  return `PARSE_JSON(${paramRef})`;
}

export function parseJsonLiteral(value) {
  if (isPg) return `'${value}'::jsonb`;
  return `PARSE_JSON('${value}')`;
}

export function jsonSet(column, key, paramRef) {
  if (isPg) return `jsonb_set(COALESCE(${column}, '{}'::jsonb), '{${key}}', ${paramRef}::jsonb)`;
  return `OBJECT_INSERT(COALESCE(${column}, PARSE_JSON('{}')), '${key}', PARSE_JSON(${paramRef}), true)`;
}

export function jsonDelete(column, key) {
  if (isPg) return `COALESCE(${column}, '{}'::jsonb) - '${key}'`;
  return `OBJECT_DELETE(COALESCE(${column}, PARSE_JSON('{}')), '${key}')`;
}

export function jsonConcat(column, paramRef, empty = '[]') {
  if (isPg) return `COALESCE(${column}, '${empty}'::jsonb) || ${paramRef}::jsonb`;
  return `ARRAY_CAT(COALESCE(${column}, PARSE_JSON('${empty}')), PARSE_JSON(${paramRef}))`;
}

export function now() {
  if (isPg) return 'CURRENT_TIMESTAMP';
  return 'CURRENT_TIMESTAMP()';
}

// ---------------------------------------------------------------------------
// Backend wiring
// ---------------------------------------------------------------------------

let backend;

if (isPg) {
  const pg = await import('./postgresBackend.js');

  backend = {
    async query(sql, params = []) {
      return pg.query(sql, params);
    },
    async transaction(callback) {
      return pg.transaction(callback);
    },
    async getClient() {
      return pg.getClient();
    },
    async init() {},
    async test() {
      return pg.testConnection();
    },
    async close() {
      return pg.closePool();
    },
    getServiceConfig() {
      return {
        backend: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        database: process.env.POSTGRES_DB || 'simply_analytics',
      };
    },
  };
} else {
  const sf = await import('./snowflakeBackend.js');

  backend = {
    query: sf.query,
    transaction: sf.transaction,
    getClient: sf.getClient,
    init: sf.initServiceConnection,
    test: sf.testConnection,
    close: sf.closeConnection,
    getServiceConfig: sf.getServiceConfig,
  };
}

export const query = backend.query;
export const transaction = backend.transaction;
export const getClient = backend.getClient;
export const init = backend.init;
export const test = backend.test;
export const close = backend.close;
export const getServiceConfig = backend.getServiceConfig;
export const metadataBackend = BACKEND;

export default backend;
