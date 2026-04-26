import { Router } from 'express';
import workspaceService from '../services/workspaceService.js';
import { query } from '../db/db.js';

export const workspaceRoutes = Router();

// ── List workspaces ─────────────────────────────────────────

workspaceRoutes.get('/', async (req, res) => {
  try {
    const workspaces = await workspaceService.listWorkspaces(req.user.id, req.user.role);
    const userRow = await query('SELECT default_workspace_id FROM users WHERE id = $1', [req.user.id]);
    const defaultWorkspaceId = userRow.rows[0]?.default_workspace_id || null;
    res.json({ workspaces, defaultWorkspaceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create workspace (owner/admin only) ─────────────────────

workspaceRoutes.post('/', async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only owner and admin roles can create workspaces' });
    }

    const userRow = await query(
      'SELECT auth_provider, totp_enabled, passkey_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    const u = userRow.rows[0];
    const isSso = u?.auth_provider === 'saml';
    const hasMfa = u?.totp_enabled || u?.passkey_enabled;
    if (!isSso && !hasMfa) {
      return res.status(403).json({
        error: 'MFA is required to create workspaces. Enable an authenticator app or passkey in your account settings.',
        code: 'MFA_REQUIRED',
      });
    }

    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const workspace = await workspaceService.createWorkspace({
      name: name.trim(),
      description,
      createdBy: req.user.id,
    });

    res.status(201).json({ workspace });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'A workspace with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Get workspace detail ────────────────────────────────────

workspaceRoutes.get('/:id', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const [views, members, connections, endpoints] = await Promise.all([
      workspaceService.getWorkspaceViews(req.params.id),
      workspaceService.getWorkspaceMembers(req.params.id),
      workspaceService.getWorkspaceConnections(req.params.id),
      workspaceService.getWorkspaceEndpoints(req.params.id),
    ]);

    res.json({
      workspace: access.workspace,
      accessLevel: access.accessLevel,
      semanticViews: views,
      members,
      connections,
      endpoints,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update workspace (owner/admin members only) ─────────────

workspaceRoutes.put('/:id', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can edit settings' });
    }

    const { name, description } = req.body;

    const workspace = await workspaceService.updateWorkspace(req.params.id, {
      name: name || undefined,
      description: description !== undefined ? description : undefined,
    });

    res.json({ workspace });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'A workspace with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Delete workspace preview ─────────────────────────────────

workspaceRoutes.get('/:id/delete-preview', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (access.accessLevel !== 'owner' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the workspace creator or app owner can delete' });
    }

    const preview = await workspaceService.getWorkspaceDeletePreview(req.params.id);
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete workspace ────────────────────────────────────────

workspaceRoutes.delete('/:id', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (access.accessLevel !== 'owner' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the workspace creator or app owner can delete' });
    }

    const deleted = await workspaceService.deleteWorkspace(req.params.id);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Connections (owner/admin only) ──────────────────────────

workspaceRoutes.get('/:id/connections', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const connections = await workspaceService.getWorkspaceConnections(req.params.id);
    res.json({ connections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.post('/:id/connections', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can manage connections' });
    }

    const { connectionId, warehouse, role: sfRole } = req.body;
    if (!connectionId) return res.status(400).json({ error: 'connectionId is required' });
    if (!warehouse?.trim()) return res.status(400).json({ error: 'warehouse is required' });
    if (!sfRole?.trim()) return res.status(400).json({ error: 'role is required' });

    const conn = await query('SELECT id FROM snowflake_connections WHERE id = $1', [connectionId]);
    if (conn.rows.length === 0) return res.status(404).json({ error: 'Connection not found' });

    const connections = await workspaceService.addWorkspaceConnection(req.params.id, {
      connectionId,
      warehouse: warehouse.trim(),
      role: sfRole.trim(),
      addedBy: req.user.id,
    });

    res.status(201).json({ connections });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'That connection is already added to this workspace' });
    }
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.patch('/:id/connections/:wcId', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can update connections' });
    }

    const { warehouse, role } = req.body;
    if (warehouse !== undefined && !warehouse?.trim()) {
      return res.status(400).json({ error: 'warehouse cannot be empty' });
    }
    if (role !== undefined && !role?.trim()) {
      return res.status(400).json({ error: 'role cannot be empty' });
    }

    const connections = await workspaceService.updateWorkspaceConnection(
      req.params.wcId, req.params.id, { warehouse: warehouse?.trim(), role: role?.trim() },
    );
    res.json({ connections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.get('/:id/connections/:wcId/usage', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const wcRow = await query(
      'SELECT connection_id FROM workspace_connections WHERE id = $1 AND workspace_id = $2',
      [req.params.wcId, req.params.id],
    );
    if (wcRow.rows.length === 0) return res.status(404).json({ error: 'Connection not found' });
    const sfConnId = wcRow.rows[0].connection_id;

    const dashUsage = await query(
      'SELECT id, name FROM dashboards WHERE workspace_id = $1 AND connection_id = $2 LIMIT 10',
      [req.params.id, sfConnId],
    );
    const askUsage = await query(
      'SELECT COUNT(*) as count FROM ask_conversations WHERE workspace_id = $1 AND connection_id = $2',
      [req.params.id, sfConnId],
    );

    res.json({
      dashboardCount: dashUsage.rows.length,
      dashboards: dashUsage.rows,
      askConversationCount: parseInt(askUsage.rows[0]?.count || '0', 10),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.delete('/:id/connections/:wcId', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can manage connections' });
    }

    // Look up the underlying snowflake connection_id for this workspace_connection
    const wcRow = await query(
      'SELECT connection_id FROM workspace_connections WHERE id = $1 AND workspace_id = $2',
      [req.params.wcId, req.params.id],
    );
    if (wcRow.rows.length === 0) return res.status(404).json({ error: 'Connection not found' });
    const sfConnId = wcRow.rows[0].connection_id;

    // Block if any dashboard in this workspace uses this connection
    const dashUsage = await query(
      'SELECT id, name FROM dashboards WHERE workspace_id = $1 AND connection_id = $2 LIMIT 5',
      [req.params.id, sfConnId],
    );
    if (dashUsage.rows.length > 0) {
      const names = dashUsage.rows.map(d => d.name).join(', ');
      return res.status(409).json({
        error: 'Connection is in use by dashboards. Update those dashboards to use a different connection first.',
        dashboards: dashUsage.rows,
        detail: `Used by: ${names}`,
      });
    }

    // Check if ask conversations reference this connection (warn but allow)
    const askUsage = await query(
      'SELECT COUNT(*) as count FROM ask_conversations WHERE workspace_id = $1 AND connection_id = $2',
      [req.params.id, sfConnId],
    );
    const askCount = parseInt(askUsage.rows[0]?.count || '0', 10);

    await workspaceService.removeWorkspaceConnection(req.params.wcId, req.params.id);
    res.json({ success: true, askConversationsAffected: askCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Members ─────────────────────────────────────────────────

workspaceRoutes.get('/:id/members', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const members = await workspaceService.getWorkspaceMembers(req.params.id);
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.post('/:id/members', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    const canAddMembers = ['owner', 'admin'].includes(access.accessLevel) || req.user.role === 'editor';
    if (!canAddMembers) {
      return res.status(403).json({ error: 'Only workspace owner, admin, or creator can add members' });
    }

    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await workspaceService.addWorkspaceMember(req.params.id, userId, req.user.id);
    const members = await workspaceService.getWorkspaceMembers(req.params.id);
    res.json({ success: true, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.delete('/:id/members/:userId', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can manage members' });
    }

    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself from the workspace' });
    }

    const ws = await workspaceService.getWorkspaceById(req.params.id);
    if (ws && req.params.userId === ws.created_by) {
      return res.status(400).json({ error: 'The workspace creator cannot be removed' });
    }

    await workspaceService.removeWorkspaceMember(req.params.id, req.params.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Semantic Views (owner/admin only) ────────────────────────

workspaceRoutes.post('/:id/views', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can manage semantic views' });
    }

    const { semanticViewFqn, label, workspaceConnectionId } = req.body;
    if (!semanticViewFqn?.trim()) return res.status(400).json({ error: 'Semantic view FQN is required' });
    if (!workspaceConnectionId) return res.status(400).json({ error: 'workspaceConnectionId is required' });

    const views = await workspaceService.addWorkspaceView(req.params.id, workspaceConnectionId, semanticViewFqn, label);
    res.status(201).json({ semanticViews: views });
  } catch (err) {
    if (err.message?.includes('unique')) {
      return res.status(409).json({ error: 'That semantic view is already added' });
    }
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.patch('/:id/views/:viewId', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can update views' });
    }
    const result = await workspaceService.updateWorkspaceView(req.params.viewId, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.delete('/:id/views/:viewId', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can manage semantic views' });
    }

    await workspaceService.removeWorkspaceView(req.params.viewId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI Config (owner/admin only) ─────────────────────────────

workspaceRoutes.get('/:id/ai-config', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const config = await workspaceService.getAiConfig(req.params.id);
    res.json({ aiConfig: config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.put('/:id/ai-config', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can update AI config' });
    }

    const { provider, apiKey, defaultModel, endpointUrl } = req.body;
    const config = await workspaceService.setAiConfig(req.params.id, { provider, apiKey, defaultModel, endpointUrl });
    res.json({ aiConfig: config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Models (owner/admin only) ────────────────────────────────

workspaceRoutes.get('/:id/models', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });

    const models = await workspaceService.listWorkspaceModels(req.params.id);
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.post('/:id/models', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can manage models' });
    }

    const { modelId, displayName, provider, description, contextWindow,
      capabilities, isDefault, endpointUrl, apiKey } = req.body;

    if (!modelId?.trim() || !displayName?.trim() || !provider?.trim()) {
      return res.status(400).json({ error: 'modelId, displayName, and provider are required' });
    }

    const model = await workspaceService.addWorkspaceModel(req.params.id, {
      modelId: modelId.trim(),
      displayName: displayName.trim(),
      provider: provider.trim(),
      description,
      contextWindow,
      capabilities,
      isDefault,
      endpointUrl,
      apiKey,
      addedBy: req.user.id,
    });

    res.status(201).json({ model });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'That model is already added to this workspace' });
    }
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.patch('/:id/models/:modelId', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can update models' });
    }

    const model = await workspaceService.updateWorkspaceModel(req.params.modelId, req.params.id, req.body);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json({ model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

workspaceRoutes.delete('/:id/models/:modelId', async (req, res) => {
  try {
    const access = await workspaceService.checkWorkspaceAccess(req.params.id, req.user.id, req.user.role);
    if (!access) return res.status(404).json({ error: 'Workspace not found' });
    if (!['owner', 'admin'].includes(access.accessLevel)) {
      return res.status(403).json({ error: 'Only workspace owner or admin can manage models' });
    }

    await workspaceService.removeWorkspaceModel(req.params.modelId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default workspaceRoutes;
