import crypto from 'crypto';
import { query, transaction, now } from '../db/db.js';
import { encrypt, decrypt } from '../utils/encryption.js';

export async function listWorkspaces(userId, userRole) {
  if (['owner', 'admin'].includes(userRole)) {
    const result = await query(`
      SELECT w.*, u.display_name as owner_name,
             (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) as member_count,
             (SELECT COUNT(*) FROM workspace_connections wc WHERE wc.workspace_id = w.id) as connection_count
      FROM workspaces w
      JOIN users u ON w.created_by = u.id
      ORDER BY w.updated_at DESC
    `);
    return result.rows;
  }

  const result = await query(`
    SELECT DISTINCT w.*, u.display_name as owner_name,
           (SELECT COUNT(*) FROM workspace_members wm2 WHERE wm2.workspace_id = w.id) as member_count,
           (SELECT COUNT(*) FROM workspace_connections wc WHERE wc.workspace_id = w.id) as connection_count
    FROM workspaces w
    JOIN users u ON w.created_by = u.id
    JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
    ORDER BY w.updated_at DESC
  `, [userId]);
  return result.rows;
}

export async function getWorkspaceById(workspaceId) {
  const result = await query(`
    SELECT w.*, u.display_name as owner_name
    FROM workspaces w
    JOIN users u ON w.created_by = u.id
    WHERE w.id = $1
  `, [workspaceId]);
  return result.rows[0] || null;
}

export async function checkWorkspaceAccess(workspaceId, userId, userRole) {
  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return null;

  if (ws.created_by === userId) return { workspace: ws, accessLevel: 'owner' };
  if (['owner', 'admin'].includes(userRole)) return { workspace: ws, accessLevel: 'admin' };

  const membership = await query(
    'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  if (membership.rows.length > 0) return { workspace: ws, accessLevel: 'member' };

  return null;
}

export async function isWorkspaceMember(workspaceId, userId) {
  const result = await query(
    'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  return result.rows.length > 0;
}

export async function createWorkspace({ name, description, createdBy }) {
  const id = crypto.randomUUID();
  await query(`
    INSERT INTO workspaces (id, name, description, created_by)
    VALUES ($1, $2, $3, $4)
  `, [id, name.trim(), description || null, createdBy]);

  // Auto-add creator as member
  await query(`
    INSERT INTO workspace_members (workspace_id, user_id, added_by)
    VALUES ($1, $2, $2)
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `, [id, createdBy]);

  return getWorkspaceById(id);
}

export async function updateWorkspace(workspaceId, updates) {
  const allowedFields = ['name', 'description'];
  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      setClauses.push(`${key} = $${idx}`);
      values.push(typeof value === 'string' ? value.trim() : value);
      idx++;
    }
  }

  if (setClauses.length === 0) return getWorkspaceById(workspaceId);

  values.push(workspaceId);
  await query(`UPDATE workspaces SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);

  return getWorkspaceById(workspaceId);
}

export async function getWorkspaceDeletePreview(workspaceId) {
  const [folders, dashboards, conversations, members, connections, endpoints] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM dashboard_folders WHERE workspace_id = $1', [workspaceId]),
    query('SELECT COUNT(*)::int AS count FROM dashboards WHERE workspace_id = $1', [workspaceId]),
    query('SELECT COUNT(*)::int AS count FROM ask_conversations WHERE workspace_id = $1', [workspaceId]),
    query('SELECT COUNT(*)::int AS count FROM workspace_members WHERE workspace_id = $1', [workspaceId]),
    query('SELECT COUNT(*)::int AS count FROM workspace_connections WHERE workspace_id = $1', [workspaceId]),
    query('SELECT COUNT(*)::int AS count FROM workspace_endpoints WHERE workspace_id = $1', [workspaceId]),
  ]);

  return {
    folderCount: folders.rows[0].count,
    dashboardCount: dashboards.rows[0].count,
    conversationCount: conversations.rows[0].count,
    memberCount: members.rows[0].count,
    connectionCount: connections.rows[0].count,
    endpointCount: endpoints.rows[0].count,
  };
}

export async function deleteWorkspace(workspaceId) {
  const preview = await getWorkspaceDeletePreview(workspaceId);

  await transaction(async (client) => {
    // Clear default_workspace_id for any users pointing at this workspace
    await client.query(
      'UPDATE users SET default_workspace_id = NULL WHERE default_workspace_id = $1',
      [workspaceId],
    );

    // Delete ask conversations (ask_messages cascade via FK)
    await client.query(
      'DELETE FROM ask_conversations WHERE workspace_id = $1',
      [workspaceId],
    );

    // Delete dashboards (dashboard_user_access cascades via FK)
    await client.query(
      'DELETE FROM dashboards WHERE workspace_id = $1',
      [workspaceId],
    );

    // Delete folders (nested children cascade via parent_id FK)
    await client.query(
      'DELETE FROM dashboard_folders WHERE workspace_id = $1',
      [workspaceId],
    );

    // Delete the workspace itself
    // (workspace_connections, workspace_members, workspace_semantic_views cascade via FK)
    await client.query(
      'DELETE FROM workspaces WHERE id = $1',
      [workspaceId],
    );
  });

  return preview;
}

// ── Connections ──────────────────────────────────────────────

export async function getWorkspaceConnections(workspaceId) {
  const result = await query(`
    SELECT wc.id, wc.connection_id, wc.warehouse, wc.role, wc.added_at,
           sc.name as connection_name, sc.account as connection_account,
           sc.default_warehouse, sc.default_role
    FROM workspace_connections wc
    JOIN snowflake_connections sc ON wc.connection_id = sc.id
    WHERE wc.workspace_id = $1
    ORDER BY wc.added_at ASC
  `, [workspaceId]);
  return result.rows;
}

export async function addWorkspaceConnection(workspaceId, { connectionId, warehouse, role, addedBy }) {
  if (!warehouse) throw new Error('warehouse is required');
  if (!role) throw new Error('role is required');
  const id = crypto.randomUUID();
  await query(`
    INSERT INTO workspace_connections (id, workspace_id, connection_id, warehouse, role, added_by)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [id, workspaceId, connectionId, warehouse, role, addedBy]);
  return getWorkspaceConnections(workspaceId);
}

export async function updateWorkspaceConnection(wcId, workspaceId, { warehouse, role }) {
  const setClauses = [];
  const values = [];
  let idx = 1;

  if (warehouse !== undefined) {
    if (!warehouse) throw new Error('warehouse cannot be empty');
    setClauses.push(`warehouse = $${idx}`);
    values.push(warehouse);
    idx++;
  }
  if (role !== undefined) {
    if (!role) throw new Error('role cannot be empty');
    setClauses.push(`role = $${idx}`);
    values.push(role);
    idx++;
  }

  if (setClauses.length === 0) return getWorkspaceConnections(workspaceId);

  values.push(wcId, workspaceId);
  await query(
    `UPDATE workspace_connections SET ${setClauses.join(', ')} WHERE id = $${idx} AND workspace_id = $${idx + 1}`,
    values,
  );
  return getWorkspaceConnections(workspaceId);
}

export async function removeWorkspaceConnection(wcId, workspaceId) {
  await query('DELETE FROM workspace_connections WHERE id = $1 AND workspace_id = $2', [wcId, workspaceId]);
  return true;
}

// ── Members ──────────────────────────────────────────────────

export async function getWorkspaceMembers(workspaceId) {
  const result = await query(`
    SELECT u.id, u.username, u.email, u.display_name, u.role,
           wm.added_at, adder.display_name as added_by_name
    FROM workspace_members wm
    JOIN users u ON wm.user_id = u.id
    LEFT JOIN users adder ON wm.added_by = adder.id
    WHERE wm.workspace_id = $1
    ORDER BY wm.added_at ASC
  `, [workspaceId]);
  return result.rows;
}

export async function addWorkspaceMember(workspaceId, userId, addedBy) {
  await query(`
    INSERT INTO workspace_members (workspace_id, user_id, added_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `, [workspaceId, userId, addedBy]);

  // Auto-set as default workspace if user doesn't have one yet
  await query(`
    UPDATE users SET default_workspace_id = $1
    WHERE id = $2 AND default_workspace_id IS NULL
  `, [workspaceId, userId]);

  return true;
}

export async function removeWorkspaceMember(workspaceId, userId) {
  await query(
    'DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  return true;
}

// ── Endpoints ────────────────────────────────────────────────

export async function getWorkspaceEndpoints(workspaceId) {
  const result = await query(
    'SELECT id, slug, name, is_public, created_at FROM workspace_endpoints WHERE workspace_id = $1 ORDER BY created_at DESC',
    [workspaceId],
  );
  return result.rows;
}

// ── Semantic Views ───────────────────────────────────────────

export async function getWorkspaceViews(workspaceId, workspaceConnectionId) {
  if (workspaceConnectionId) {
    const result = await query(
      'SELECT * FROM workspace_semantic_views WHERE workspace_id = $1 AND workspace_connection_id = $2 ORDER BY added_at ASC',
      [workspaceId, workspaceConnectionId],
    );
    return result.rows;
  }
  const result = await query(
    'SELECT * FROM workspace_semantic_views WHERE workspace_id = $1 ORDER BY added_at ASC',
    [workspaceId],
  );
  return result.rows;
}

export async function addWorkspaceView(workspaceId, workspaceConnectionId, semanticViewFqn, label) {
  const id = crypto.randomUUID();
  const normalizedFqn = semanticViewFqn.trim().toUpperCase();
  await query(
    'INSERT INTO workspace_semantic_views (id, workspace_id, workspace_connection_id, semantic_view_fqn, label) VALUES ($1, $2, $3, $4, $5)',
    [id, workspaceId, workspaceConnectionId, normalizedFqn, label || null],
  );
  return getWorkspaceViews(workspaceId, workspaceConnectionId);
}

export async function updateWorkspaceView(viewId, workspaceId, { sampleQuestions }) {
  const questions = Array.isArray(sampleQuestions) ? sampleQuestions.slice(0, 5) : [];
  await query(
    'UPDATE workspace_semantic_views SET sample_questions = $1 WHERE id = $2 AND workspace_id = $3',
    [JSON.stringify(questions), viewId, workspaceId],
  );
  return { success: true, sampleQuestions: questions };
}

export async function removeWorkspaceView(viewId, workspaceId) {
  await query('DELETE FROM workspace_semantic_views WHERE id = $1 AND workspace_id = $2', [viewId, workspaceId]);
  return true;
}

// ── AI Config ───────────────────────────────────────────────

const VALID_AI_PROVIDERS = ['cortex', 'openai', 'anthropic', 'bedrock', 'vertex', 'azure'];

export async function getAiConfig(workspaceId) {
  const result = await query(
    'SELECT workspace_id, provider, api_key_encrypted, default_model, endpoint_url, updated_at FROM workspace_ai_config WHERE workspace_id = $1',
    [workspaceId],
  );
  if (result.rows.length === 0) {
    return { provider: 'cortex', defaultModel: null, hasApiKey: false, endpointUrl: null };
  }
  const row = result.rows[0];
  return {
    provider: row.provider || 'cortex',
    defaultModel: row.default_model || null,
    hasApiKey: !!row.api_key_encrypted,
    endpointUrl: row.endpoint_url || null,
    updatedAt: row.updated_at,
  };
}

export async function getAiConfigWithKey(workspaceId) {
  const result = await query(
    'SELECT provider, api_key_encrypted, default_model, endpoint_url FROM workspace_ai_config WHERE workspace_id = $1',
    [workspaceId],
  );
  if (result.rows.length === 0) {
    return { provider: 'cortex', apiKey: null, defaultModel: null, endpointUrl: null };
  }
  const row = result.rows[0];
  let apiKey = null;
  if (row.api_key_encrypted) {
    try { apiKey = decrypt(row.api_key_encrypted); } catch { /* corrupted key */ }
  }
  return {
    provider: row.provider || 'cortex',
    apiKey,
    defaultModel: row.default_model || null,
    endpointUrl: row.endpoint_url || null,
  };
}

export async function setAiConfig(workspaceId, { provider, apiKey, defaultModel, endpointUrl }) {
  if (provider && !VALID_AI_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid AI provider: "${provider}". Valid: ${VALID_AI_PROVIDERS.join(', ')}`);
  }

  const existing = await query('SELECT workspace_id FROM workspace_ai_config WHERE workspace_id = $1', [workspaceId]);
  const encryptedKey = apiKey ? encrypt(apiKey) : null;

  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO workspace_ai_config (workspace_id, provider, api_key_encrypted, default_model, endpoint_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, provider || 'cortex', encryptedKey, defaultModel || null, endpointUrl || null],
    );
  } else {
    const sets = [];
    const vals = [];
    let idx = 1;
    if (provider !== undefined) { sets.push(`provider = $${idx++}`); vals.push(provider); }
    if (apiKey !== undefined) { sets.push(`api_key_encrypted = $${idx++}`); vals.push(encryptedKey); }
    if (defaultModel !== undefined) { sets.push(`default_model = $${idx++}`); vals.push(defaultModel || null); }
    if (endpointUrl !== undefined) { sets.push(`endpoint_url = $${idx++}`); vals.push(endpointUrl || null); }
    if (sets.length > 0) {
      vals.push(workspaceId);
      await query(`UPDATE workspace_ai_config SET ${sets.join(', ')} WHERE workspace_id = $${idx}`, vals);
    }
  }

  return getAiConfig(workspaceId);
}

// ── Model Registry ──────────────────────────────────────────

export async function listWorkspaceModels(workspaceId) {
  const result = await query(
    `SELECT id, workspace_id, model_id, display_name, provider, description,
            context_window, capabilities, is_default, is_enabled,
            endpoint_url, api_key_encrypted IS NOT NULL as has_api_key,
            created_at, updated_at
     FROM workspace_models
     WHERE workspace_id = $1
     ORDER BY is_default DESC, display_name ASC`,
    [workspaceId],
  );
  return result.rows;
}

export async function addWorkspaceModel(workspaceId, {
  modelId, displayName, provider, description, contextWindow,
  capabilities, isDefault, endpointUrl, apiKey, addedBy,
}) {
  if (!modelId || !displayName || !provider) {
    throw new Error('modelId, displayName, and provider are required');
  }
  if (!VALID_AI_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider: "${provider}"`);
  }

  const encKey = apiKey ? encrypt(apiKey) : null;

  // If marking as default, unset any existing default
  if (isDefault) {
    await query('UPDATE workspace_models SET is_default = false WHERE workspace_id = $1', [workspaceId]);
  }

  const result = await query(
    `INSERT INTO workspace_models
       (workspace_id, model_id, display_name, provider, description, context_window,
        capabilities, is_default, endpoint_url, api_key_encrypted, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [workspaceId, modelId, displayName, provider, description || null,
     contextWindow || null, JSON.stringify(capabilities || []),
     isDefault || false, endpointUrl || null, encKey, addedBy || null],
  );

  return { id: result.rows[0].id, ...(await getWorkspaceModel(result.rows[0].id)) };
}

async function getWorkspaceModel(modelRowId) {
  const result = await query(
    `SELECT id, workspace_id, model_id, display_name, provider, description,
            context_window, capabilities, is_default, is_enabled,
            endpoint_url, api_key_encrypted IS NOT NULL as has_api_key,
            created_at, updated_at
     FROM workspace_models WHERE id = $1`,
    [modelRowId],
  );
  return result.rows[0] || null;
}

export async function updateWorkspaceModel(modelRowId, workspaceId, updates) {
  const allowed = ['display_name', 'description', 'context_window', 'capabilities',
    'is_default', 'is_enabled', 'endpoint_url'];
  const sets = [];
  const vals = [];
  let idx = 1;

  for (const [key, val] of Object.entries(updates)) {
    if (key === 'apiKey' && val) {
      sets.push(`api_key_encrypted = $${idx++}`);
      vals.push(encrypt(val));
    } else if (key === 'capabilities') {
      sets.push(`capabilities = $${idx++}`);
      vals.push(JSON.stringify(val));
    } else if (allowed.includes(key)) {
      sets.push(`${key} = $${idx++}`);
      vals.push(val);
    }
  }

  if (updates.is_default) {
    await query('UPDATE workspace_models SET is_default = false WHERE workspace_id = $1', [workspaceId]);
  }

  if (sets.length > 0) {
    vals.push(modelRowId, workspaceId);
    await query(
      `UPDATE workspace_models SET ${sets.join(', ')} WHERE id = $${idx} AND workspace_id = $${idx + 1}`,
      vals,
    );
  }

  return getWorkspaceModel(modelRowId);
}

export async function removeWorkspaceModel(modelRowId, workspaceId) {
  await query('DELETE FROM workspace_models WHERE id = $1 AND workspace_id = $2', [modelRowId, workspaceId]);
}

/**
 * Resolve model config for an LLM call.
 *
 * Resolution order:
 *   1. Workspace custom models (workspace_models table)
 *   2. Platform model registry + inference router (cross-cloud routing)
 *   3. Workspace-level AI config fallback
 */
export async function resolveModelConfig(workspaceId, requestedModel) {
  if (!workspaceId) return { provider: 'cortex', apiKey: null, endpointUrl: null, model: requestedModel };

  // Determine which model to resolve
  const cfg = await getAiConfigWithKey(workspaceId);
  const modelId = requestedModel || cfg.defaultModel;

  // 1. Check workspace custom models first
  if (modelId) {
    const modelRow = await query(
      `SELECT model_id, provider, endpoint_url, api_key_encrypted
       FROM workspace_models
       WHERE workspace_id = $1 AND model_id = $2 AND is_enabled = true`,
      [workspaceId, modelId],
    );
    if (modelRow.rows.length > 0) {
      const m = modelRow.rows[0];
      let apiKey = null;
      if (m.api_key_encrypted) { try { apiKey = decrypt(m.api_key_encrypted); } catch { /* */ } }
      return { provider: m.provider, apiKey, endpointUrl: m.endpoint_url, model: m.model_id };
    }
  }

  // 2. Check platform model registry (cross-cloud inference routing)
  if (modelId) {
    const { resolveEndpoint, isPlatformModel } = await import('./platformModelService.js');
    if (await isPlatformModel(modelId)) {
      const endpoint = await resolveEndpoint(modelId, {
        customerCloud: process.env.PLATFORM_CLOUD,
        customerRegion: process.env.PLATFORM_REGION,
      });
      if (endpoint) {
        return {
          provider: endpoint.provider,
          apiKey: cfg.apiKey,
          endpointUrl: endpoint.endpointConfig?.endpointUrl || endpoint.region,
          model: modelId,
        };
      }
    }
  }

  // 3. Fall back to workspace-level AI config
  return {
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    endpointUrl: cfg.endpointUrl,
    model: modelId || requestedModel,
  };
}

export default {
  listWorkspaces,
  getWorkspaceById,
  checkWorkspaceAccess,
  isWorkspaceMember,
  createWorkspace,
  updateWorkspace,
  getWorkspaceDeletePreview,
  deleteWorkspace,
  getWorkspaceConnections,
  addWorkspaceConnection,
  updateWorkspaceConnection,
  removeWorkspaceConnection,
  getWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  getWorkspaceEndpoints,
  getWorkspaceViews,
  addWorkspaceView,
  updateWorkspaceView,
  removeWorkspaceView,
  getAiConfig,
  getAiConfigWithKey,
  setAiConfig,
  listWorkspaceModels,
  addWorkspaceModel,
  updateWorkspaceModel,
  removeWorkspaceModel,
  resolveModelConfig,
};
