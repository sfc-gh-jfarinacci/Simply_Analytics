import { Router } from 'express';
import workspaceService from '../services/workspaceService.js';
import endpointService from '../services/endpointService.js';
import apiKeyService from '../services/apiKeyService.js';
import { getCachedDashboardConnection, getConnectionWithCredentialsForDashboard } from '../services/connectionService.js';
import { executeQuery } from '../db/dashboardSessionManager.js';
import { buildQueryDirect, DEFAULT_QUERY_LIMIT } from '../utils/queryBuilder.js';
import { callAnalyst } from '../services/cortexAnalystService.js';
import { resolveFormat, formatResponse } from '../utils/responseFormatter.js';
import responseCache from '../services/responseCache.js';
import { pipeRateLimiter } from '../middleware/pipeRateLimit.js';

const MAX_PAGE_SIZE = 100_000;
const DEFAULT_PAGE_SIZE = 10_000;

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.page_size, 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize };
}

// ── Authenticated workspace endpoint routes ──────────────────

export const endpointRoutes = Router({ mergeParams: true });

/**
 * GET /api/v1/workspaces/:id/endpoints
 * List all published endpoints in a workspace
 */
endpointRoutes.get('/', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const endpoints = await endpointService.listEndpoints(req.params.id);
    res.json({ endpoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/workspaces/:id/endpoints
 * Create a new published endpoint (owner/admin only)
 */
endpointRoutes.post('/', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can create endpoints' });
    }

    const {
      slug, name, description, endpointType, semanticViewFqn,
      queryDefinition, parameters, isPublic, workspaceConnectionId, validatedAt,
    } = req.body;

    const endpoint = await endpointService.createEndpoint(req.params.id, {
      slug, name, description, endpointType, semanticViewFqn,
      queryDefinition, parameters, isPublic, workspaceConnectionId,
      validatedAt, createdBy: req.user.id,
    });

    res.status(201).json({ endpoint });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'An endpoint with that slug already exists in this workspace' });
    }
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/workspaces/:id/endpoints/validate
 * Test an endpoint config before saving — runs the query and returns a preview
 */
endpointRoutes.post('/validate', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can validate endpoints' });
    }

    const { endpointType, workspaceConnectionId, semanticViewFqn, queryDefinition, testQuestion } = req.body;

    if (!workspaceConnectionId || !semanticViewFqn) {
      return res.status(400).json({ error: 'Connection and semantic view are required' });
    }

    const wsConns = await workspaceService.getWorkspaceConnections(req.params.id);
    const wsConn = wsConns.find(c => c.id === workspaceConnectionId);
    if (!wsConn) return res.status(404).json({ error: 'Workspace connection not found' });

    if (endpointType === 'analyst') {
      if (!testQuestion?.trim()) {
        return res.status(400).json({ error: 'A test question is required to validate an analyst endpoint' });
      }

      const connWithCreds = await getConnectionWithCredentialsForDashboard(wsConn.connection_id);
      if (!connWithCreds) return res.status(404).json({ error: 'Connection credentials not found' });

      const analystResult = await callAnalyst(connWithCreds, {
        semanticViews: [semanticViewFqn],
        messages: [{ role: 'user', content: [{ type: 'text', text: testQuestion.trim() }] }],
        role: wsConn.role || undefined,
      });

      const result = { valid: true, analystText: analystResult.text, sql: analystResult.sql, suggestions: analystResult.suggestions };

      if (analystResult.sql) {
        const connection = await getCachedDashboardConnection(wsConn.connection_id, null, '__validate__', {
          role: wsConn.role, warehouse: wsConn.warehouse,
        });
        const queryResult = await executeQuery(connection, analystResult.sql.replace(/;\s*$/, ''));
        result.preview = queryResult.rows.slice(0, 5);
        result.rowCount = queryResult.rows.length;
      }

      return res.json(result);
    }

    // Structured validation: build and execute the query
    if (!queryDefinition || typeof queryDefinition !== 'object') {
      return res.status(400).json({ error: 'queryDefinition is required' });
    }
    if (!queryDefinition.dimensions?.length && !queryDefinition.measures?.length) {
      return res.status(400).json({ error: 'At least one dimension or measure is required' });
    }

    const sql = buildQueryDirect({
      semanticViewFQN: semanticViewFqn,
      dimensions: queryDefinition.dimensions || [],
      measures: queryDefinition.measures || [],
      aggregatedDimensions: queryDefinition.aggregatedDimensions || [],
      filters: queryDefinition.filters || [],
      orderBy: queryDefinition.orderBy || [],
      customColumns: queryDefinition.customColumns || [],
      limit: Math.min(queryDefinition.limit || 5, 5),
    });

    const connection = await getCachedDashboardConnection(wsConn.connection_id, null, '__validate__', {
      role: wsConn.role, warehouse: wsConn.warehouse,
    });
    const queryResult = await executeQuery(connection, sql);

    res.json({ valid: true, sql: sql.trim(), preview: queryResult.rows.slice(0, 5), rowCount: queryResult.rows.length });
  } catch (err) {
    res.status(400).json({ valid: false, error: err.message });
  }
});

/**
 * GET /api/v1/workspaces/:id/endpoints/:slug
 * Get endpoint metadata
 */
endpointRoutes.get('/:slug', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const endpoint = await endpointService.getEndpoint(req.params.id, req.params.slug);
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    res.json({ endpoint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/workspaces/:id/endpoints/:slug/run
 * Execute a published endpoint with query string parameters
 */
endpointRoutes.get('/:slug/run', async (req, res) => {
  try {
    const format = resolveFormat(req);
    const pagination = parsePagination(req.query);
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const endpoint = await endpointService.getEndpoint(req.params.id, req.params.slug);
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    const cacheKey = responseCache.buildKey(endpoint.id, req.query);
    const cached = await responseCache.get(cacheKey);
    if (cached) return formatResponse(res, cached, format, endpoint.slug);

    const result = await runEndpoint(endpoint, req.query, pagination);
    await responseCache.set(cacheKey, result);
    await formatResponse(res, result, format, endpoint.slug);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes('missing required') || err.message?.includes('invalid') ? 400 : 500);
    res.status(status).json({ error: err.message });
  }
});

/**
 * PUT /api/v1/workspaces/:id/endpoints/:slug
 * Update an endpoint (owner/admin only)
 */
endpointRoutes.put('/:slug', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can update endpoints' });
    }

    const existing = await endpointService.getEndpoint(req.params.id, req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Endpoint not found' });

    const updates = { ...req.body };
    const endpoint = await endpointService.updateEndpoint(existing.id, req.params.id, updates);
    res.json({ endpoint });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'An endpoint with that slug already exists in this workspace' });
    }
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/workspaces/:id/endpoints/:slug/regenerate-token
 * Regenerate the share token for a public endpoint
 */
endpointRoutes.post('/:slug/regenerate-token', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can regenerate tokens' });
    }

    const existing = await endpointService.getEndpoint(req.params.id, req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Endpoint not found' });
    if (!existing.is_public) return res.status(400).json({ error: 'Endpoint is not public' });

    const result = await endpointService.regenerateToken(existing.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/workspaces/:id/endpoints/:slug
 * Delete an endpoint (owner/admin only)
 */
endpointRoutes.delete('/:slug', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can delete endpoints' });
    }

    const existing = await endpointService.getEndpoint(req.params.id, req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Endpoint not found' });

    await endpointService.deleteEndpoint(existing.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API key management routes (on workspace) ────────────────

export const apiKeyRoutes = Router({ mergeParams: true });

apiKeyRoutes.get('/', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const keys = await apiKeyService.listKeys(req.params.id);
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

apiKeyRoutes.post('/', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can create API keys' });
    }

    const { name, expiresAt } = req.body;
    const result = await apiKeyService.createKey(req.params.id, {
      name,
      expiresAt,
      createdBy: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'An API key with that name already exists' });
    }
    res.status(400).json({ error: err.message });
  }
});

apiKeyRoutes.delete('/:keyId', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can revoke API keys' });
    }

    await apiKeyService.revokeKey(req.params.keyId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Strip internal details (SQL, parameters) from pipe results before returning to external consumers. */
function sanitizeForPublic(result) {
  if (!result?.meta) return result;
  const { query, sql, parameters, ...safeMeta } = result.meta;
  return { ...result, meta: safeMeta };
}

// ── Public pipe routes (no auth) ─────────────────────────────

export const pipePublicRoutes = Router();

pipePublicRoutes.use(pipeRateLimiter);

/**
 * GET /api/v1/pipe/:shareToken
 * Execute a public endpoint by share token — no authentication required
 */
pipePublicRoutes.get('/:shareToken', async (req, res) => {
  try {
    const format = resolveFormat(req);
    const pagination = parsePagination(req.query);
    const endpoint = await endpointService.getEndpointByToken(req.params.shareToken);
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found or not public' });

    const cacheKey = responseCache.buildKey(endpoint.id, req.query);
    const cached = await responseCache.get(cacheKey);
    if (cached) return formatResponse(res, sanitizeForPublic(cached), format, endpoint.slug);

    const result = await runEndpoint(endpoint, req.query, pagination);
    await responseCache.set(cacheKey, result);
    await formatResponse(res, sanitizeForPublic(result), format, endpoint.slug);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes('missing required') || err.message?.includes('invalid') ? 400 : 500);
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/v1/pipe/:workspaceId/:slug
 * Execute endpoint via workspace-level API key (Bearer sa_ws_...)
 */
pipePublicRoutes.get('/:workspaceId/:slug', async (req, res) => {
  try {
    const format = resolveFormat(req);
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const rawKey = authHeader.slice(7);
    const keyResult = await apiKeyService.validateKey(rawKey);
    if (!keyResult) {
      return res.status(401).json({ error: 'Invalid or expired API key' });
    }
    if (keyResult.workspaceId !== req.params.workspaceId) {
      return res.status(403).json({ error: 'API key does not belong to this workspace' });
    }

    const endpoint = await endpointService.getEndpoint(req.params.workspaceId, req.params.slug);
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    const pagination = parsePagination(req.query);
    const cacheKey = responseCache.buildKey(endpoint.id, req.query);
    const cached = await responseCache.get(cacheKey);
    if (cached) return formatResponse(res, sanitizeForPublic(cached), format, endpoint.slug);

    const result = await runEndpoint(endpoint, req.query, pagination);
    await responseCache.set(cacheKey, result);
    await formatResponse(res, sanitizeForPublic(result), format, endpoint.slug);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes('missing required') || err.message?.includes('invalid') ? 400 : 500);
    res.status(status).json({ error: err.message });
  }
});

// ── Shared execution logic ───────────────────────────────────

const PIPE_SESSION_ID = '__pipe_service__';

async function runEndpoint(endpoint, queryParams, pagination) {
  const epType = endpoint.endpoint_type || 'structured';

  if (epType === 'analyst') {
    return runAnalystEndpoint(endpoint, queryParams, pagination);
  }
  return runStructuredEndpoint(endpoint, queryParams, pagination);
}

async function runStructuredEndpoint(endpoint, queryParams, pagination) {
  const { page, pageSize } = pagination;

  const paramDefs = typeof endpoint.parameters === 'string'
    ? JSON.parse(endpoint.parameters)
    : (endpoint.parameters || []);

  const queryDef = typeof endpoint.query_definition === 'string'
    ? JSON.parse(endpoint.query_definition)
    : endpoint.query_definition;

  const resolvedDef = endpointService.injectParameters(queryDef, paramDefs, queryParams);

  const connection = await getCachedDashboardConnection(
    endpoint.connection_id,
    null,
    PIPE_SESSION_ID,
    { role: endpoint.role, warehouse: endpoint.warehouse },
  );

  const baseSql = buildQueryDirect({
    semanticViewFQN: endpoint.semantic_view_fqn,
    dimensions: resolvedDef.dimensions || [],
    measures: resolvedDef.measures || [],
    aggregatedDimensions: resolvedDef.aggregatedDimensions || [],
    filters: resolvedDef.filters || [],
    orderBy: resolvedDef.orderBy || [],
    customColumns: resolvedDef.customColumns || [],
    limit: Math.min(resolvedDef.limit || DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_LIMIT),
  });

  const offset = (page - 1) * pageSize;
  const fetchSize = pageSize + 1;
  const paginatedSql = `SELECT * FROM (${baseSql}) __page LIMIT ${fetchSize} OFFSET ${offset}`;

  const startTime = Date.now();
  const result = await executeQuery(connection, paginatedSql);
  const executionTime = Date.now() - startTime;

  const hasMore = result.rows.length > pageSize;
  const data = hasMore ? result.rows.slice(0, pageSize) : result.rows;

  const resolvedParams = {};
  for (const pd of paramDefs) {
    const val = queryParams[pd.name] ?? pd.default ?? null;
    resolvedParams[pd.name] = val;
  }

  return {
    data,
    meta: {
      rowCount: data.length,
      page,
      pageSize,
      hasMore,
      executionTime,
      parameters: resolvedParams,
      query: baseSql.trim(),
    },
  };
}

async function runAnalystEndpoint(endpoint, queryParams, pagination) {
  const { page, pageSize } = pagination;

  const question = queryParams.question || queryParams.q;
  if (!question?.trim()) {
    throw new Error('missing required parameter: question (pass as ?question=... or ?q=...)');
  }

  const connWithCreds = await getConnectionWithCredentialsForDashboard(endpoint.connection_id);
  if (!connWithCreds) throw new Error('Connection credentials not found');

  const startTime = Date.now();

  const analystResult = await callAnalyst(connWithCreds, {
    semanticViews: [endpoint.semantic_view_fqn],
    messages: [{ role: 'user', content: [{ type: 'text', text: question.trim() }] }],
    role: endpoint.role || undefined,
  });

  const response = {
    data: [],
    meta: {
      executionTime: 0,
      analystText: analystResult.text,
      sql: analystResult.sql,
      suggestions: analystResult.suggestions,
      page,
      pageSize,
      hasMore: false,
    },
  };

  if (analystResult.sql) {
    const connection = await getCachedDashboardConnection(
      endpoint.connection_id,
      null,
      PIPE_SESSION_ID,
      { role: endpoint.role, warehouse: endpoint.warehouse },
    );

    const queryDef = typeof endpoint.query_definition === 'string'
      ? JSON.parse(endpoint.query_definition)
      : (endpoint.query_definition || {});
    const maxRows = Math.min(queryDef.limit || DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_LIMIT);

    const cleanSql = analystResult.sql.replace(/;\s*$/, '');
    const offset = (page - 1) * pageSize;
    const fetchSize = pageSize + 1;
    const paginatedSql = `SELECT * FROM (${cleanSql}) __analyst LIMIT ${fetchSize} OFFSET ${offset}`;
    const result = await executeQuery(connection, paginatedSql);

    const hasMore = result.rows.length > pageSize;
    response.data = hasMore ? result.rows.slice(0, pageSize) : result.rows;
    response.meta.rowCount = response.data.length;
    response.meta.hasMore = hasMore;
    response.meta.query = analystResult.sql;
  }

  response.meta.executionTime = Date.now() - startTime;
  return response;
}
