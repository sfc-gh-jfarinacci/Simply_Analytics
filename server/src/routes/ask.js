import { Router } from 'express';
import crypto from 'crypto';
import { query, now } from '../db/db.js';
import { getCachedDashboardConnection, getConnectionWithCredentialsForDashboard } from '../services/connectionService.js';
import { parseColumnsToMetadata } from '../utils/parseColumnsToMetadata.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { askChatAndExecute, buildSqlForWidget } from '../services/askService.js';
import workspaceService from '../services/workspaceService.js';
import { trackEvent } from '../services/eventTracker.js';

export const askRoutes = Router();
export const askPublicRoutes = Router();


async function resolveConnection(req, options = {}) {
  if (req.snowflakeConnection) return req.snowflakeConnection;
  const connectionId = options.connectionId || req.body?.connectionId || req.query?.connectionId;
  if (connectionId && req.user) {
    const connOpts = {};
    if (options.warehouse) connOpts.warehouse = options.warehouse;
    if (options.role) connOpts.role = options.role;
    return getCachedDashboardConnection(connectionId, req.user.id, req.user.sessionId, connOpts);
  }
  return null;
}

async function resolveWorkspace(workspaceId, userId, userRole) {
  if (!workspaceId) return null;
  const ws = await query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
  if (ws.rows.length === 0) return null;
  const workspace = ws.rows[0];

  const isCreator = workspace.created_by === userId;
  const isAppAdmin = ['owner', 'admin'].includes(userRole);
  if (!isCreator && !isAppAdmin) {
    const memberAccess = await query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1',
      [workspaceId, userId],
    );
    if (memberAccess.rows.length === 0) return null;
  }

  const views = await query(
    'SELECT semantic_view_fqn FROM workspace_semantic_views WHERE workspace_id = $1',
    [workspaceId],
  );
  workspace.semanticViews = views.rows.map(v => v.semantic_view_fqn);

  // Resolve first workspace connection as default
  const wcResult = await query(
    'SELECT connection_id, warehouse, role FROM workspace_connections WHERE workspace_id = $1 ORDER BY added_at ASC LIMIT 1',
    [workspaceId],
  );
  if (wcResult.rows.length > 0) {
    workspace.connection_id = wcResult.rows[0].connection_id;
    workspace.warehouse = wcResult.rows[0].warehouse;
    workspace.role = wcResult.rows[0].role;
  }

  return workspace;
}

async function getSemanticViewMetadata(connection, viewFqn) {
  const rows = await new Promise((resolve, reject) => {
    connection.execute({
      sqlText: `DESCRIBE SEMANTIC VIEW ${viewFqn}`,
      complete: (err, _stmt, r) => (err ? reject(err) : resolve(r || [])),
    });
  });
  return rows;
}

// ===== Conversations CRUD =====

askRoutes.get('/conversations', async (req, res) => {
  try {
    const { workspaceId, mode } = req.query;
    if (!workspaceId) {
      return res.json({ conversations: [] });
    }
    const chatMode = mode || 'semantic';
    const result = await query(
      `SELECT id, connection_id, workspace_id, mode, title, created_at, updated_at
       FROM ask_conversations WHERE user_id = $1 AND workspace_id = $2 AND mode = $3 ORDER BY updated_at DESC`,
      [req.user.id, workspaceId, chatMode],
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

askRoutes.post('/conversations', async (req, res) => {
  try {
    const id = crypto.randomUUID();
    const { connectionId, title } = req.body;
    await query(
      `INSERT INTO ask_conversations (id, user_id, connection_id, title) VALUES ($1, $2, $3, $4)`,
      [id, req.user.id, connectionId || null, title || 'New conversation'],
    );
    const result = await query('SELECT * FROM ask_conversations WHERE id = $1', [id]);
    res.status(201).json({ conversation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

askRoutes.get('/conversations/:id', async (req, res) => {
  try {
    const conv = await query(
      'SELECT * FROM ask_conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (conv.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    // Touch updated_at on open
    await query(`UPDATE ask_conversations SET updated_at = ${now()} WHERE id = $1`, [req.params.id]);
    const msgs = await query(
      'SELECT id, role, content, artifacts, created_at FROM ask_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id],
    );
    const messages = msgs.rows.map(m => {
      let content = m.content || '';
      let artifacts = null;
      try { content = decrypt(content); } catch { /* plaintext fallback */ }
      if (m.artifacts) {
        let raw = m.artifacts;
        if (typeof raw === 'string') {
          try { raw = decrypt(raw); } catch { /* plaintext fallback */ }
          try { artifacts = JSON.parse(raw); } catch { artifacts = null; }
        } else {
          artifacts = raw;
        }
      }
      return { ...m, content, artifacts };
    });
    res.json({ conversation: conv.rows[0], messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

askRoutes.delete('/conversations/:id', async (req, res) => {
  try {
    await query('DELETE FROM ask_messages WHERE conversation_id = $1', [req.params.id]);
    await query('DELETE FROM ask_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

askRoutes.patch('/conversations/:id', async (req, res) => {
  try {
    const { title } = req.body;
    await query(
      `UPDATE ask_conversations SET title = $1, updated_at = ${now()} WHERE id = $2 AND user_id = $3`,
      [title, req.params.id, req.user.id],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Chat SSE endpoint =====

askRoutes.post('/message', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let convId = null;
  let responseText = '';
  let artifactToSave;

  try {
    const { conversationId, content, connectionId, semanticView, workspaceId } = req.body;
    if (!content?.trim()) {
      sendEvent('error', { error: 'Empty message' });
      return res.end();
    }

    if (!workspaceId) {
      sendEvent('error', { error: 'A workspace is required to start a chat' });
      return res.end();
    }

    let workspace = null;
    workspace = await resolveWorkspace(workspaceId, req.user.id, req.user.role);
    if (!workspace) {
      sendEvent('error', { error: 'Workspace not found or access denied' });
      return res.end();
    }

    const effectiveConnectionId = workspace?.connection_id || connectionId;
    const sfConn = await resolveConnection(req, {
      connectionId: effectiveConnectionId,
      warehouse: workspace?.warehouse,
      role: workspace?.role,
    });
    if (!sfConn) {
      sendEvent('error', { error: 'Snowflake connection required' });
      return res.end();
    }

    // Ensure conversation exists
    convId = conversationId;
    if (!convId) {
      convId = crypto.randomUUID();
      await query(
        `INSERT INTO ask_conversations (id, user_id, connection_id, workspace_id, mode, title) VALUES ($1, $2, $3, $4, $5, $6)`,
        [convId, req.user.id, effectiveConnectionId || null, workspaceId || null, 'semantic', content.slice(0, 60)],
      );
    }

    sendEvent('response.conversation_id', { conversationId: convId });

    trackEvent('ai.request', {
      userId: req.user.id,
      workspaceId: workspaceId || null,
      entityType: 'conversation',
      entityId: convId,
      metadata: { action: 'ask_message', requestType: 'ai' },
      ip: req.ip,
    });

    const userMsgId = crypto.randomUUID();
    const encryptedUserContent = encrypt(content);
    await query(
      'INSERT INTO ask_messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)',
      [userMsgId, convId, 'user', encryptedUserContent],
    );

    const msgCount = await query('SELECT COUNT(*) as cnt FROM ask_messages WHERE conversation_id = $1', [convId]);
    if (parseInt(msgCount.rows[0].cnt || msgCount.rows[0].CNT) <= 1) {
      await query(`UPDATE ask_conversations SET title = $1, updated_at = ${now()} WHERE id = $2`,
        [content.slice(0, 80), convId]);
    }

    // Resolve semantic view — must be explicitly configured on workspace
    const wsViews = workspace?.semanticViews || [];
    let viewFqn = (semanticView && wsViews.includes(semanticView)) ? semanticView : null;
    if (!viewFqn && wsViews.length > 0) {
      viewFqn = wsViews[0];
    }
    if (!viewFqn) {
      sendEvent('error', { error: 'No semantic views configured. Add a semantic view in workspace settings.' });
      return res.end();
    }

    sendEvent('response.status', { message: 'Reading data model...' });
    const rawMeta = await getSemanticViewMetadata(sfConn, viewFqn);
    const metadata = parseColumnsToMetadata(rawMeta);
    metadata.fullyQualifiedName = viewFqn;

    const priorMsgsRaw = await query(
      'SELECT role, content, artifacts FROM ask_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [convId],
    );
    const priorMsgs = [];
    const priorArtifacts = [];
    for (const m of priorMsgsRaw.rows) {
      let c = m.content || '';
      try { c = decrypt(c); } catch { /* plaintext fallback */ }
      priorMsgs.push({ role: m.role, content: c });

      if (m.artifacts && m.role === 'assistant') {
        let arts = m.artifacts;
        if (typeof arts === 'string') {
          try { arts = decrypt(arts); } catch { /* plaintext */ }
          try { arts = JSON.parse(arts); } catch { arts = null; }
        }
        if (Array.isArray(arts)) priorArtifacts.push(...arts);
      }
    }

    sendEvent('response.status', { message: 'Thinking...' });

    // Resolve workspace AI config: provider, model, and credentials
    let aiProvider = 'cortex', aiModel, aiApiKey, aiEndpointUrl;
    try {
      const aiCfg = await workspaceService.getAiConfigWithKey(workspaceId);
      aiProvider = aiCfg.provider || 'cortex';
      aiModel = aiCfg.defaultModel || undefined;
      aiApiKey = aiCfg.apiKey;
      aiEndpointUrl = aiCfg.endpointUrl;
    } catch { /* default to cortex */ }

    // Cortex REST API uses the same Snowflake connection credentials — no extra setup
    let connWithCreds = null;
    if (aiProvider === 'cortex') {
      try {
        connWithCreds = await getConnectionWithCredentialsForDashboard(effectiveConnectionId);
      } catch (err) {
        console.error('[Ask] Failed to resolve connection credentials:', err.message);
      }
    }

    const MAX_CONTEXT_MESSAGES = 30;
    const trimmedMsgs = priorMsgs.length > MAX_CONTEXT_MESSAGES
      ? priorMsgs.slice(-MAX_CONTEXT_MESSAGES)
      : priorMsgs;
    const chatMsgs = trimmedMsgs.map(m => ({ role: m.role, content: m.content }));
    chatMsgs.push({ role: 'user', content });

    let streamedText = '';
    const result = await askChatAndExecute(sfConn, {
      messages: chatMsgs,
      metadata,
      priorArtifacts,
      model: aiModel,
      provider: aiProvider,
      apiKey: aiApiKey,
      endpointUrl: aiEndpointUrl,
      connWithCreds,
      onToolStep: (step) => {
        sendEvent('response.tool_step', { tool: step.tool, thinking: step.thinking });
      },
      onTextDelta: (delta) => {
        streamedText += delta;
        sendEvent('response.text.delta', { text: delta });
      },
    });

    responseText = result.message || '';
    if (!streamedText) {
      sendEvent('response.text', { text: responseText });
    } else {
      sendEvent('response.text', { text: responseText });
    }

    if (result.action === 'add_dashboard' && result.dashboard) {
      sendEvent('response.artifact', {
        type: 'dashboard',
        dashboard: result.dashboard.yaml,
        widgetData: result.dashboard.widgetData,
      });
      artifactToSave = [{ type: 'dashboard', dashboard: result.dashboard.yaml, widgetData: result.dashboard.widgetData }];
    } else if (result.action === 'add_widget' || result.action === 'update_widget') {
      for (const wr of result.widgets) {
        if (wr.error) sendEvent('response.text', { text: `\n\n**Error:** ${wr.error}` });
        sendEvent('response.artifact', {
          type: 'widget',
          widget: wr.widget,
          data: wr.data,
          sql: wr.sql,
          columns: wr.columns,
          totalRows: wr.totalRows,
          updateWidgetId: result.action === 'update_widget' ? result.widgetId : undefined,
        });
      }
      artifactToSave = result.widgets.map(w => ({
        type: 'widget', widget: w.widget, data: w.data, sql: w.sql, columns: w.columns, totalRows: w.totalRows,
      }));
    } else {
      artifactToSave = null;
    }

    // Persist assistant message (encrypted at rest)
    const asstMsgId = crypto.randomUUID();
    try {
      const encryptedResponse = encrypt(responseText);
      const encryptedArtifacts = artifactToSave?.length > 0 ? encrypt(JSON.stringify(artifactToSave)) : null;
      await query(
        'INSERT INTO ask_messages (id, conversation_id, role, content, artifacts) VALUES ($1, $2, $3, $4, $5)',
        [asstMsgId, convId, 'assistant', encryptedResponse, encryptedArtifacts],
      );
      await query(`UPDATE ask_conversations SET updated_at = ${now()} WHERE id = $1`, [convId]);
    } catch (saveErr) {
      console.error('[Ask] Failed to save assistant message:', saveErr);
    }

    sendEvent('response.done', {});

  } catch (err) {
    console.error('[Ask] Error:', err);
    if (convId && (responseText || artifactToSave?.length > 0)) {
      try {
        const errContent = encrypt(responseText || `Error: ${err.message}`);
        const errArtifacts = artifactToSave?.length > 0 ? encrypt(JSON.stringify(artifactToSave)) : null;
        await query(
          'INSERT INTO ask_messages (id, conversation_id, role, content, artifacts) VALUES ($1, $2, $3, $4, $5)',
          [crypto.randomUUID(), convId, 'assistant', errContent, errArtifacts],
        );
      } catch (saveErr) {
        console.error('[Ask] Failed to save error response:', saveErr);
      }
    }
    sendEvent('response.text', { text: `Error: ${err.message}` });
    sendEvent('error', { error: err.message });
  } finally {
    res.end();
  }
});

// ===== Save dashboard from chat =====

askRoutes.post('/dashboards', async (req, res) => {
  try {
    const { title, yaml, connectionId } = req.body;
    if (!yaml) return res.status(400).json({ error: 'yaml is required' });
    const id = crypto.randomUUID();
    const shareToken = crypto.randomBytes(16).toString('hex');
    await query(
      `INSERT INTO ask_dashboards (id, user_id, connection_id, title, yaml_definition, share_token)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, req.user.id, connectionId || null, title || 'AI Dashboard', JSON.stringify(yaml), shareToken],
    );
    res.status(201).json({ dashboard: { id, title, shareToken }, shareUrl: `/ask/dashboard/${shareToken}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

askRoutes.get('/dashboards', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, title, share_token, created_at FROM ask_dashboards WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id],
    );
    res.json({ dashboards: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

askPublicRoutes.get('/:token', async (req, res) => {
  try {
    const result = await query(
      `SELECT d.*, u.display_name as owner_name FROM ask_dashboards d JOIN users u ON d.user_id = u.id WHERE d.share_token = $1`,
      [req.params.token],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Dashboard not found' });
    const dash = result.rows[0];
    const yamlDef = typeof dash.yaml_definition === 'string' ? JSON.parse(dash.yaml_definition) : dash.yaml_definition;

    if (!dash.connection_id) {
      return res.json({ dashboard: { title: dash.title, owner_name: dash.owner_name, yaml: yamlDef, widgetData: {} } });
    }

    let conn;
    try {
      conn = await getCachedDashboardConnection(dash.connection_id, dash.user_id, `ask-shared-${dash.id}`);
      const allWidgets = [];
      for (const tab of yamlDef.tabs || []) allWidgets.push(...(tab.widgets || []));
      const widgetData = {};
      for (const widget of allWidgets) {
        const sql = buildSqlForWidget(widget);
        if (!sql) { widgetData[widget.id] = { data: [], columns: [], totalRows: 0 }; continue; }
        try {
          const rows = await new Promise((resolve, reject) => {
            conn.execute({ sqlText: sql, complete: (e, _s, r) => (e ? reject(e) : resolve(r || [])) });
          });
          widgetData[widget.id] = { data: rows, sql, columns: rows.length > 0 ? Object.keys(rows[0]) : [], totalRows: rows.length };
        } catch (e) {
          widgetData[widget.id] = { data: [], sql, columns: [], totalRows: 0, error: e.message };
        }
      }
      res.json({ dashboard: { title: dash.title, owner_name: dash.owner_name, yaml: yamlDef, widgetData } });
    } catch (err) {
      res.json({ dashboard: { title: dash.title, owner_name: dash.owner_name, yaml: yamlDef, widgetData: {}, error: err.message } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
