/**
 * Event Tracker — lightweight, fire-and-forget event logging for consumption analytics.
 *
 * Every call writes a row to the `app_events` table asynchronously.
 * Failures are silently swallowed so tracking never impacts request latency.
 */

import crypto from 'crypto';

let _query = null;

async function getQuery() {
  if (!_query) {
    const db = await import('../db/db.js');
    _query = db.query;
  }
  return _query;
}

/**
 * Track an application event (non-blocking).
 *
 * @param {string} eventType  - Dot-namespaced type, e.g. 'auth.login_success'
 * @param {object} opts
 * @param {string} [opts.userId]
 * @param {string} [opts.workspaceId]
 * @param {string} [opts.entityType]
 * @param {string} [opts.entityId]
 * @param {object} [opts.metadata]   - Arbitrary JSON payload
 * @param {string} [opts.ip]
 */
export function trackEvent(eventType, {
  userId = null,
  workspaceId = null,
  entityType = null,
  entityId = null,
  metadata = {},
  ip = null,
} = {}) {
  (async () => {
    try {
      const query = await getQuery();
      const id = crypto.randomUUID();
      await query(
        `INSERT INTO app_events (id, event_type, user_id, workspace_id, entity_type, entity_id, metadata, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [id, eventType, userId, workspaceId, entityType, entityId, JSON.stringify(metadata), ip]
      );
    } catch (_) {
      // Never block or crash the caller
    }
  })();
}

export default { trackEvent };
