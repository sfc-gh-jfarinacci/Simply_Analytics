import * as pg from './postgresBackend.js';

// ---------------------------------------------------------------------------
// Dialect helpers — return SQL fragments for PostgreSQL.
// ---------------------------------------------------------------------------

export function parseJson(paramRef) {
  return `${paramRef}::jsonb`;
}

export function parseJsonLiteral(value) {
  return `'${value}'::jsonb`;
}

export function jsonSet(column, key, paramRef) {
  return `jsonb_set(COALESCE(${column}, '{}'::jsonb), '{${key}}', ${paramRef}::jsonb)`;
}

export function jsonDelete(column, key) {
  return `COALESCE(${column}, '{}'::jsonb) - '${key}'`;
}

export function jsonConcat(column, paramRef, empty = '[]') {
  return `COALESCE(${column}, '${empty}'::jsonb) || ${paramRef}::jsonb`;
}

export function now() {
  return 'CURRENT_TIMESTAMP';
}

// ---------------------------------------------------------------------------
// Backend wiring — Postgres only
// ---------------------------------------------------------------------------

export async function query(sql, params = []) {
  return pg.query(sql, params);
}

export async function transaction(callback) {
  return pg.transaction(callback);
}

export async function getClient() {
  return pg.getClient();
}

export async function init() {}

export async function test() {
  return pg.testConnection();
}

export async function close() {
  return pg.closePool();
}

export function getServiceConfig() {
  return {
    backend: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB || 'simply_analytics',
  };
}

export const metadataBackend = 'postgres';

export default {
  query,
  transaction,
  getClient,
  init,
  test,
  close,
  getServiceConfig,
};
