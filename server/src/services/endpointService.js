import crypto from 'crypto';
import { query } from '../db/db.js';
import responseCache from './responseCache.js';

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;

function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('slug is required');
  }
  const normalized = slug.trim().toLowerCase();
  if (!SLUG_REGEX.test(normalized)) {
    throw new Error('slug must be 3-100 chars, alphanumeric and hyphens only, cannot start/end with hyphen');
  }
  return normalized;
}

function generateShareToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── CRUD ─────────────────────────────────────────────────────

export async function listEndpoints(workspaceId) {
  const result = await query(`
    SELECT we.*, u.display_name AS created_by_name,
           wc.connection_id,
           sc.name AS connection_name
    FROM workspace_endpoints we
    JOIN users u ON we.created_by = u.id
    JOIN workspace_connections wc ON we.workspace_connection_id = wc.id
    JOIN snowflake_connections sc ON wc.connection_id = sc.id
    WHERE we.workspace_id = $1
    ORDER BY we.created_at DESC
  `, [workspaceId]);
  return result.rows;
}

export async function getEndpoint(workspaceId, slug) {
  const result = await query(`
    SELECT we.*, u.display_name AS created_by_name,
           wc.connection_id, wc.warehouse, wc.role,
           sc.name AS connection_name, sc.account AS connection_account
    FROM workspace_endpoints we
    JOIN users u ON we.created_by = u.id
    JOIN workspace_connections wc ON we.workspace_connection_id = wc.id
    JOIN snowflake_connections sc ON wc.connection_id = sc.id
    WHERE we.workspace_id = $1 AND we.slug = $2
  `, [workspaceId, slug]);
  return result.rows[0] || null;
}

export async function getEndpointByToken(shareToken) {
  if (!shareToken) return null;
  const result = await query(`
    SELECT we.*, wc.connection_id, wc.warehouse, wc.role,
           sc.name AS connection_name, sc.account AS connection_account
    FROM workspace_endpoints we
    JOIN workspace_connections wc ON we.workspace_connection_id = wc.id
    JOIN snowflake_connections sc ON wc.connection_id = sc.id
    WHERE we.share_token = $1 AND we.is_public = true
  `, [shareToken]);
  return result.rows[0] || null;
}

const VALID_ENDPOINT_TYPES = ['structured', 'analyst'];

export async function createEndpoint(workspaceId, {
  slug,
  name,
  description,
  endpointType = 'structured',
  semanticViewFqn,
  queryDefinition,
  parameters = [],
  isPublic = false,
  workspaceConnectionId,
  createdBy,
  validatedAt,
}) {
  const normalizedSlug = validateSlug(slug);

  if (!name?.trim()) throw new Error('name is required');
  if (!semanticViewFqn?.trim()) throw new Error('semanticViewFqn is required');
  if (!workspaceConnectionId) throw new Error('workspaceConnectionId is required');
  if (!VALID_ENDPOINT_TYPES.includes(endpointType)) {
    throw new Error(`endpointType must be one of: ${VALID_ENDPOINT_TYPES.join(', ')}`);
  }
  if (!validatedAt) throw new Error('Endpoint must be validated before saving');

  if (endpointType === 'structured') {
    if (!queryDefinition || typeof queryDefinition !== 'object') {
      throw new Error('queryDefinition is required and must be an object');
    }
    validateParameters(parameters);
  } else {
    queryDefinition = queryDefinition || {};
    parameters = [];
  }

  const id = crypto.randomUUID();
  const shareToken = isPublic ? generateShareToken() : null;

  await query(`
    INSERT INTO workspace_endpoints
      (id, workspace_id, workspace_connection_id, slug, name, description, endpoint_type,
       semantic_view_fqn, query_definition, parameters, share_token, is_public, validated_at, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [
    id, workspaceId, workspaceConnectionId,
    normalizedSlug, name.trim(), description || null, endpointType,
    semanticViewFqn.trim(), JSON.stringify(queryDefinition),
    JSON.stringify(parameters), shareToken, isPublic, validatedAt || null, createdBy,
  ]);

  return getEndpoint(workspaceId, normalizedSlug);
}

export async function updateEndpoint(endpointId, workspaceId, updates) {
  if (!updates.validatedAt) throw new Error('Endpoint must be validated before saving');

  const setClauses = [];
  const values = [];
  let idx = 1;

  if (updates.name !== undefined) {
    if (!updates.name?.trim()) throw new Error('name cannot be empty');
    setClauses.push(`name = $${idx}`);
    values.push(updates.name.trim());
    idx++;
  }

  if (updates.description !== undefined) {
    setClauses.push(`description = $${idx}`);
    values.push(updates.description || null);
    idx++;
  }

  if (updates.slug !== undefined) {
    const normalizedSlug = validateSlug(updates.slug);
    setClauses.push(`slug = $${idx}`);
    values.push(normalizedSlug);
    idx++;
  }

  if (updates.endpointType !== undefined) {
    if (!VALID_ENDPOINT_TYPES.includes(updates.endpointType)) {
      throw new Error(`endpointType must be one of: ${VALID_ENDPOINT_TYPES.join(', ')}`);
    }
    setClauses.push(`endpoint_type = $${idx}`);
    values.push(updates.endpointType);
    idx++;
  }

  if (updates.queryDefinition !== undefined) {
    if (!updates.queryDefinition || typeof updates.queryDefinition !== 'object') {
      throw new Error('queryDefinition must be an object');
    }
    setClauses.push(`query_definition = $${idx}`);
    values.push(JSON.stringify(updates.queryDefinition));
    idx++;
  }

  if (updates.parameters !== undefined) {
    if (updates.endpointType !== 'analyst') {
      validateParameters(updates.parameters);
    }
    setClauses.push(`parameters = $${idx}`);
    values.push(JSON.stringify(updates.parameters || []));
    idx++;
  }

  if (updates.isPublic !== undefined) {
    setClauses.push(`is_public = $${idx}`);
    values.push(!!updates.isPublic);
    idx++;

    if (updates.isPublic) {
      setClauses.push(`share_token = $${idx}`);
      values.push(generateShareToken());
      idx++;
    } else {
      setClauses.push(`share_token = $${idx}`);
      values.push(null);
      idx++;
    }
  }

  if (updates.semanticViewFqn !== undefined) {
    if (!updates.semanticViewFqn?.trim()) throw new Error('semanticViewFqn cannot be empty');
    setClauses.push(`semantic_view_fqn = $${idx}`);
    values.push(updates.semanticViewFqn.trim());
    idx++;
  }

  if (updates.validatedAt !== undefined) {
    setClauses.push(`validated_at = $${idx}`);
    values.push(updates.validatedAt);
    idx++;
  }

  if (setClauses.length === 0) {
    const existing = await query(
      'SELECT slug FROM workspace_endpoints WHERE id = $1 AND workspace_id = $2',
      [endpointId, workspaceId],
    );
    return existing.rows[0] ? getEndpoint(workspaceId, existing.rows[0].slug) : null;
  }

  values.push(endpointId, workspaceId);
  await query(
    `UPDATE workspace_endpoints SET ${setClauses.join(', ')} WHERE id = $${idx} AND workspace_id = $${idx + 1}`,
    values,
  );

  responseCache.invalidateEndpoint(endpointId).catch(() => {});

  const updated = await query(
    'SELECT slug FROM workspace_endpoints WHERE id = $1 AND workspace_id = $2',
    [endpointId, workspaceId],
  );
  return updated.rows[0] ? getEndpoint(workspaceId, updated.rows[0].slug) : null;
}

export async function deleteEndpoint(endpointId, workspaceId) {
  await query(
    'DELETE FROM workspace_endpoints WHERE id = $1 AND workspace_id = $2',
    [endpointId, workspaceId],
  );
  responseCache.invalidateEndpoint(endpointId).catch(() => {});
  return true;
}

export async function regenerateToken(endpointId, workspaceId) {
  const newToken = generateShareToken();
  await query(
    'UPDATE workspace_endpoints SET share_token = $1 WHERE id = $2 AND workspace_id = $3 AND is_public = true',
    [newToken, endpointId, workspaceId],
  );
  return { shareToken: newToken };
}

// ── Parameter injection ──────────────────────────────────────

const PARAM_PLACEHOLDER = /^\{\{(\w+)\}\}$/;

function validateParameters(params) {
  if (!Array.isArray(params)) throw new Error('parameters must be an array');
  const validTypes = ['string', 'number', 'date', 'boolean'];
  const seen = new Set();

  for (const p of params) {
    if (!p.name || typeof p.name !== 'string') throw new Error('each parameter must have a name');
    if (seen.has(p.name)) throw new Error(`duplicate parameter name: ${p.name}`);
    seen.add(p.name);

    if (p.type && !validTypes.includes(p.type)) {
      throw new Error(`invalid parameter type "${p.type}" for ${p.name}. Valid: ${validTypes.join(', ')}`);
    }
  }
}

function coerceValue(raw, paramDef) {
  if (raw === null || raw === undefined) return raw;
  const type = paramDef.type || 'string';

  switch (type) {
    case 'number': {
      const n = Number(raw);
      if (isNaN(n)) throw new Error(`parameter "${paramDef.name}" must be a number`);
      return n;
    }
    case 'boolean':
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
      throw new Error(`parameter "${paramDef.name}" must be boolean (true/false)`);
    case 'date':
      if (isNaN(Date.parse(raw))) throw new Error(`parameter "${paramDef.name}" must be a valid date`);
      return String(raw);
    default:
      return String(raw);
  }
}

/**
 * Resolve {{param}} placeholders in the saved query definition using URL query params.
 * Returns a new query definition with placeholders replaced by actual values.
 * Filters whose parameter is optional, unset, and has no default are dropped.
 */
export function injectParameters(queryDef, paramDefs, queryParams) {
  const resolved = structuredClone(queryDef);
  const paramMap = new Map(paramDefs.map(p => [p.name, p]));

  // Check required params are present
  for (const paramDef of paramDefs) {
    const raw = queryParams[paramDef.name];
    if (paramDef.required && raw === undefined && paramDef.default === undefined && paramDef.default !== null) {
      throw new Error(`missing required parameter: ${paramDef.name}`);
    }
  }

  if (!resolved.filters) return resolved;

  resolved.filters = resolved.filters.reduce((kept, filter) => {
    if (!filter) return kept;

    const processValue = (val) => {
      if (typeof val !== 'string') return { resolved: val, drop: false };
      const match = val.match(PARAM_PLACEHOLDER);
      if (!match) return { resolved: val, drop: false };

      const paramName = match[1];
      const paramDef = paramMap.get(paramName);
      if (!paramDef) return { resolved: val, drop: false };

      let rawValue = queryParams[paramName];
      if (rawValue === undefined) rawValue = paramDef.default;
      if (rawValue === undefined || rawValue === null) {
        return { resolved: null, drop: !paramDef.required };
      }

      const coerced = coerceValue(rawValue, paramDef);

      if (paramDef.allowedValues?.length && !paramDef.allowedValues.includes(coerced)) {
        throw new Error(
          `invalid value for "${paramDef.name}". Allowed: ${paramDef.allowedValues.join(', ')}`,
        );
      }

      return { resolved: coerced, drop: false };
    };

    const { resolved: newValue, drop } = processValue(filter.value);
    if (drop) return kept;

    const updatedFilter = { ...filter, value: newValue };

    // Also handle value2 for BETWEEN filters
    if (filter.value2 !== undefined) {
      const { resolved: newValue2 } = processValue(filter.value2);
      updatedFilter.value2 = newValue2;
    }

    // Handle values array (for IN / NOT IN)
    if (Array.isArray(filter.values)) {
      updatedFilter.values = filter.values.map(v => {
        const { resolved: rv } = processValue(v);
        return rv;
      }).filter(v => v !== null);
    }

    kept.push(updatedFilter);
    return kept;
  }, []);

  return resolved;
}

export default {
  listEndpoints,
  getEndpoint,
  getEndpointByToken,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  regenerateToken,
  injectParameters,
};
