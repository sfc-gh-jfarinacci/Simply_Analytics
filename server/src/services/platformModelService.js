/**
 * Platform Model Service
 *
 * Manages the platform-wide model catalog and cross-cloud inference routing.
 * Models are deployed across AWS Bedrock, GCP Vertex AI, and Azure OpenAI —
 * this service picks the optimal endpoint for each inference request based on
 * the customer's region, endpoint health, latency, and cost.
 *
 * Think Snowflake cross-cloud: users pick a model, the platform routes it.
 */

import { query } from '../db/db.js';

// ── Model Catalog ─────────────────────────────────────────────

export async function listPlatformModels({ enabledOnly = true } = {}) {
  const sql = enabledOnly
    ? `SELECT id, display_name, vendor, category, context_window, is_enabled, created_at
       FROM platform_models WHERE is_enabled = true ORDER BY vendor, display_name`
    : `SELECT id, display_name, vendor, category, context_window, is_enabled, created_at
       FROM platform_models ORDER BY vendor, display_name`;
  const result = await query(sql);
  return result.rows;
}

export async function getPlatformModel(modelId) {
  const result = await query('SELECT * FROM platform_models WHERE id = $1', [modelId]);
  return result.rows[0] || null;
}

export async function upsertPlatformModel({ id, displayName, vendor, category, contextWindow, isEnabled }) {
  if (!id || !displayName || !vendor) throw new Error('id, displayName, and vendor are required');
  await query(
    `INSERT INTO platform_models (id, display_name, vendor, category, context_window, is_enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       vendor = EXCLUDED.vendor,
       category = COALESCE(EXCLUDED.category, platform_models.category),
       context_window = COALESCE(EXCLUDED.context_window, platform_models.context_window),
       is_enabled = COALESCE(EXCLUDED.is_enabled, platform_models.is_enabled)`,
    [id, displayName, vendor, category || 'chat', contextWindow || null, isEnabled !== false],
  );
  return getPlatformModel(id);
}

export async function deletePlatformModel(modelId) {
  await query('DELETE FROM platform_models WHERE id = $1', [modelId]);
}

// ── Endpoint Registry ─────────────────────────────────────────

export async function listEndpoints(modelId) {
  const sql = modelId
    ? `SELECT * FROM platform_model_endpoints WHERE model_id = $1 ORDER BY priority ASC, avg_latency_ms ASC NULLS LAST`
    : `SELECT * FROM platform_model_endpoints ORDER BY model_id, priority ASC`;
  const params = modelId ? [modelId] : [];
  const result = await query(sql, params);
  return result.rows;
}

export async function addEndpoint({ modelId, provider, cloud, region, endpointConfig, priority, costPer1kTokens }) {
  if (!modelId || !provider || !cloud || !region) {
    throw new Error('modelId, provider, cloud, and region are required');
  }
  const result = await query(
    `INSERT INTO platform_model_endpoints
       (model_id, provider, cloud, region, endpoint_config, priority, cost_per_1k_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (model_id, cloud, region) DO UPDATE SET
       provider = EXCLUDED.provider,
       endpoint_config = EXCLUDED.endpoint_config,
       priority = EXCLUDED.priority,
       cost_per_1k_tokens = EXCLUDED.cost_per_1k_tokens,
       is_active = true
     RETURNING *`,
    [modelId, provider, cloud, region, JSON.stringify(endpointConfig || {}), priority || 100, costPer1kTokens || null],
  );
  return result.rows[0];
}

export async function updateEndpoint(endpointId, updates) {
  const allowed = ['is_active', 'health_status', 'last_health_check', 'avg_latency_ms', 'priority', 'cost_per_1k_tokens', 'endpoint_config'];
  const sets = [];
  const vals = [];
  let idx = 1;

  for (const [key, val] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${idx++}`);
      vals.push(key === 'endpoint_config' ? JSON.stringify(val) : val);
    }
  }

  if (sets.length === 0) return null;
  vals.push(endpointId);
  await query(`UPDATE platform_model_endpoints SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
  const result = await query('SELECT * FROM platform_model_endpoints WHERE id = $1', [endpointId]);
  return result.rows[0];
}

export async function removeEndpoint(endpointId) {
  await query('DELETE FROM platform_model_endpoints WHERE id = $1', [endpointId]);
}

// ── Inference Router ──────────────────────────────────────────

/**
 * Resolve the best cloud endpoint for a given model.
 *
 * Routing strategy (in order of priority):
 *   1. Prefer same cloud as the customer's deployment (if customerCloud is provided)
 *   2. Prefer same region (lowest latency)
 *   3. Prefer healthy endpoints
 *   4. Use configured priority (lower = higher priority)
 *   5. Break ties by lowest latency, then lowest cost
 *
 * @param {string} modelId - The platform model ID (e.g. 'gpt-4o')
 * @param {Object} [hints] - Routing hints
 * @param {string} [hints.customerCloud] - Customer's cloud (aws, gcp, azure)
 * @param {string} [hints.customerRegion] - Customer's region (us-east-1, us-central1, etc.)
 * @param {string} [hints.preferCloud] - Explicit cloud preference
 * @returns {Promise<{provider, cloud, region, endpointConfig, modelId} | null>}
 */
export async function resolveEndpoint(modelId, hints = {}) {
  const { customerCloud, customerRegion, preferCloud } = hints;

  const result = await query(
    `SELECT id, model_id, provider, cloud, region, endpoint_config,
            priority, avg_latency_ms, cost_per_1k_tokens
     FROM platform_model_endpoints
     WHERE model_id = $1 AND is_active = true AND health_status = 'healthy'
     ORDER BY priority ASC, avg_latency_ms ASC NULLS LAST, cost_per_1k_tokens ASC NULLS LAST`,
    [modelId],
  );

  const endpoints = result.rows;
  if (endpoints.length === 0) return null;

  // Score each endpoint
  const scored = endpoints.map(ep => {
    let score = ep.priority || 100;

    // Same cloud as customer → big bonus
    if (customerCloud && ep.cloud === customerCloud) score -= 50;
    // Explicit preference
    if (preferCloud && ep.cloud === preferCloud) score -= 30;
    // Same region → extra bonus
    if (customerRegion && ep.region === customerRegion) score -= 40;

    // Slight bias toward lower latency
    if (ep.avg_latency_ms) score += ep.avg_latency_ms / 100;

    return { ...ep, _score: score };
  });

  scored.sort((a, b) => a._score - b._score);

  const best = scored[0];
  return {
    provider: best.provider,
    cloud: best.cloud,
    region: best.region,
    endpointConfig: typeof best.endpoint_config === 'string'
      ? JSON.parse(best.endpoint_config)
      : best.endpoint_config || {},
    modelId: best.model_id,
    endpointId: best.id,
  };
}

/**
 * Check if a model is a platform-managed model (as opposed to workspace-custom
 * or direct API like OpenAI/Anthropic/Cortex).
 */
export async function isPlatformModel(modelId) {
  const result = await query(
    'SELECT 1 FROM platform_models WHERE id = $1 AND is_enabled = true',
    [modelId],
  );
  return result.rows.length > 0;
}

/**
 * Get available clouds/regions for a specific model.
 */
export async function getModelAvailability(modelId) {
  const result = await query(
    `SELECT cloud, region, health_status, avg_latency_ms, cost_per_1k_tokens
     FROM platform_model_endpoints
     WHERE model_id = $1 AND is_active = true
     ORDER BY cloud, region`,
    [modelId],
  );
  return result.rows;
}

export default {
  listPlatformModels,
  getPlatformModel,
  upsertPlatformModel,
  deletePlatformModel,
  listEndpoints,
  addEndpoint,
  updateEndpoint,
  removeEndpoint,
  resolveEndpoint,
  isPlatformModel,
  getModelAvailability,
};
