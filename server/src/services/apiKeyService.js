import crypto from 'crypto';
import { query } from '../db/db.js';

const KEY_PREFIX = 'sa_ws_';

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export async function createKey(workspaceId, { name, expiresAt, createdBy }) {
  if (!name?.trim()) throw new Error('name is required');

  const rawKey = KEY_PREFIX + crypto.randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);
  const id = crypto.randomUUID();

  await query(`
    INSERT INTO workspace_api_keys (id, workspace_id, name, key_hash, key_prefix, created_by, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, workspaceId, name.trim(), keyHash, keyPrefix, createdBy, expiresAt || null]);

  const row = await query(
    'SELECT id, workspace_id, name, key_prefix, created_at, expires_at, is_active FROM workspace_api_keys WHERE id = $1',
    [id],
  );

  return { key: row.rows[0], rawKey };
}

export async function listKeys(workspaceId) {
  const result = await query(`
    SELECT ak.id, ak.name, ak.key_prefix, ak.is_active, ak.last_used_at,
           ak.expires_at, ak.created_at, u.display_name AS created_by_name
    FROM workspace_api_keys ak
    JOIN users u ON ak.created_by = u.id
    WHERE ak.workspace_id = $1
    ORDER BY ak.created_at DESC
  `, [workspaceId]);
  return result.rows;
}

export async function revokeKey(keyId, workspaceId) {
  await query(
    'UPDATE workspace_api_keys SET is_active = false WHERE id = $1 AND workspace_id = $2',
    [keyId, workspaceId],
  );
  return true;
}

export async function deleteKey(keyId, workspaceId) {
  await query(
    'DELETE FROM workspace_api_keys WHERE id = $1 AND workspace_id = $2',
    [keyId, workspaceId],
  );
  return true;
}

/**
 * Validate a raw API key and return the workspace_id it belongs to.
 * Updates last_used_at on success.
 */
export async function validateKey(rawKey) {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashKey(rawKey);
  const result = await query(`
    SELECT id, workspace_id, expires_at, is_active
    FROM workspace_api_keys
    WHERE key_hash = $1
  `, [keyHash]);

  const row = result.rows[0];
  if (!row) return null;
  if (!row.is_active) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // Fire-and-forget last_used_at update
  query('UPDATE workspace_api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => {});

  return { workspaceId: row.workspace_id, keyId: row.id };
}

export default { createKey, listKeys, revokeKey, deleteKey, validateKey };
