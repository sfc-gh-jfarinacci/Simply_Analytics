/**
 * Simply Analytics - Dashboard Routes
 * 
 * RESTful API for dashboard management.
 * Uses the user's Snowflake connection when available,
 * falls back to in-memory storage for demo mode.
 */

import { Router } from 'express';
import dashboardServicePg from '../services/dashboardServicePg.js';
const dashboardService = dashboardServicePg;
import { query } from '../db/db.js';
import yaml from 'js-yaml';
import { trackEvent } from '../services/eventTracker.js';

// Verbose logging toggle
const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && log(...args);

export const dashboardRoutes = Router();

/**
 * Check if user is authenticated
 */
function isAuthenticated(req) {
  return !!req.user;
}

/**
 * Check if user has MFA enabled (or is SSO-provisioned)
 */
async function hasMfaEnabled(userId) {
  const result = await query(`
    SELECT totp_enabled, passkey_enabled, mfa_bypass_until, auth_provider
    FROM users WHERE id = $1
  `, [userId]);
  
  const user = result.rows[0];
  if (!user) return false;

  if (user.auth_provider === 'saml') return true;
  
  if (user.mfa_bypass_until && new Date(user.mfa_bypass_until) > new Date()) {
    return true;
  }
  
  return user.totp_enabled || user.passkey_enabled;
}

/**
 * Middleware: Require MFA for dashboard viewing
 */
async function requireMfaForView(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const hasMfa = await hasMfaEnabled(req.user.id);
  if (!hasMfa) {
    return res.status(403).json({ 
      error: 'Multi-factor authentication is required to view dashboards. Please set up MFA in your settings.',
      code: 'MFA_REQUIRED'
    });
  }
  
  next();
}

/**
 * Middleware: Require MFA for dashboard create/edit (elevated roles)
 */
async function requireMfaForEdit(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Elevated roles (editor, admin, owner) must have MFA to create/edit
  if (['editor', 'admin', 'owner'].includes(req.user.role)) {
    const hasMfa = await hasMfaEnabled(req.user.id);
    if (!hasMfa) {
      return res.status(403).json({ 
        error: 'Multi-factor authentication is required to create or edit dashboards. Please set up MFA in your settings.',
        code: 'MFA_REQUIRED'
      });
    }
  }
  
  next();
}

/**
 * Map database dashboard fields to frontend format
 */
function mapDashboardForFrontend(dashboard) {
  if (!dashboard) return null;
  
  // Parse YAML definition if it exists
  let yamlContent = {};
  if (dashboard.yaml_definition) {
    try {
      yamlContent = yaml.load(dashboard.yaml_definition) || {};
      log(`Dashboard ${dashboard.id} YAML parsed:`, {
        hasSemanticViewsReferenced: !!yamlContent.semanticViewsReferenced,
        semanticViewsCount: yamlContent.semanticViewsReferenced?.length || 0,
        hasTabs: !!yamlContent.tabs,
      });
    } catch (e) {
      console.error('Failed to parse dashboard YAML:', e.message);
    }
  } else {
    log(`Dashboard ${dashboard.id} has no YAML definition`);
  }
  
  return {
    ...dashboard,
    // Spread parsed YAML content (tabs, widgets, semanticViewsReferenced, etc.)
    ...yamlContent,
    // Map database fields to frontend camelCase
    isPublished: dashboard.is_published,
    // Map Snowflake fields for frontend compatibility
    role: dashboard.role,         // Snowflake role (used by frontend)
    ownerRole: dashboard.role,    // Legacy alias
    ownerUsername: dashboard.owner_username,  // Dashboard owner's username
    createdBy: dashboard.snowflake_username || dashboard.owner_username,  // Snowflake username
    creator: dashboard.snowflake_username || dashboard.owner_username,
  };
}

/**
 * GET /api/v1/dashboard
 * Get all accessible dashboards
 */
dashboardRoutes.get('/', requireMfaForView, async (req, res, next) => {
  try {
    const { workspaceId } = req.query;
    const dashboards = await dashboardServicePg.getDashboardsForUser(req.user.id, req.user.role, workspaceId || null);
    res.json({ dashboards: dashboards.map(mapDashboardForFrontend) });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/dashboard/:id
 * Get a specific dashboard
 */
dashboardRoutes.get('/:id', requireMfaForView, async (req, res, next) => {
  try {
    
    const { hasAccess, accessLevel, exists } = await dashboardServicePg.checkDashboardAccess(
      req.params.id, req.user.id, 'view', req.user.role
    );
    
    if (!hasAccess) {
      if (!exists) {
        return res.status(404).json({ error: 'Dashboard not found' });
      }
      return res.status(403).json({ error: 'You do not have access to this dashboard' });
    }
    
    const dashboard = await dashboardServicePg.getDashboardById(req.params.id);
    const isOwner = dashboard.owner_id === req.user.id;

    trackEvent('dashboard.view', {
      userId: req.user.id,
      workspaceId: dashboard.workspace_id || null,
      entityType: 'dashboard',
      entityId: dashboard.id,
      metadata: { dashboardName: dashboard.name },
      ip: req.ip,
    });

    res.json({ 
      dashboard: {
        ...mapDashboardForFrontend(dashboard),
        access_level: accessLevel,
        isOwner,
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/dashboard/:id/init-session
 * Initialize a Snowflake session for a dashboard
 * This establishes the connection with the dashboard's warehouse and role
 * Call this when opening a dashboard to ensure the session is ready for queries
 */
dashboardRoutes.post('/:id/init-session', requireMfaForView, async (req, res, next) => {
  try {
    const { hasAccess, accessLevel, exists } = await dashboardServicePg.checkDashboardAccess(
      req.params.id, req.user.id, 'view', req.user.role
    );
    
    if (!hasAccess) {
      if (!exists) {
        return res.status(404).json({ error: 'Dashboard not found' });
      }
      return res.status(403).json({ error: 'You do not have access to this dashboard' });
    }
    
    const dashboard = await dashboardServicePg.getDashboardById(req.params.id);
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }
    
    const { getCachedDashboardConnection } = await import('../services/connectionService.js');
    
    try {
      // Resolve connection: dashboard's own or workspace's
      let connId = dashboard.connection_id;
      let wsWarehouse = dashboard.warehouse;
      let wsRole = dashboard.role;

      if (!connId && dashboard.workspace_id) {
        const wsResult = await query(
          'SELECT connection_id, warehouse, role FROM workspace_connections WHERE workspace_id = $1 ORDER BY added_at ASC LIMIT 1',
          [dashboard.workspace_id],
        );
        if (wsResult.rows.length > 0) {
          connId = wsResult.rows[0].connection_id;
          wsWarehouse = wsWarehouse || wsResult.rows[0].warehouse;
          wsRole = wsRole || wsResult.rows[0].role;
        }
      }

      if (!connId) {
        return res.status(400).json({ success: false, error: 'No connection configured', code: 'NO_CONNECTION' });
      }

      const connection = await getCachedDashboardConnection(
        connId,
        req.user.id,
        req.user.sessionId,
        {
          role: wsRole,
          warehouse: wsWarehouse,
        }
      );
      
      res.json({ 
        success: true, 
        message: 'Session initialized',
        warehouse: dashboard.warehouse,
        role: dashboard.role,
        connectionId: dashboard.connection_id,
      });
    } catch (connError) {
      console.error('Failed to initialize dashboard session:', connError);
      res.status(400).json({ 
        success: false,
        error: connError.message || 'Failed to initialize Snowflake session',
        code: 'SESSION_INIT_FAILED',
      });
    }
  } catch (error) {
    console.error('Error initializing dashboard session:', error);
    next(error);
  }
});

/**
 * POST /api/v1/dashboard
 * Create a new dashboard
 * REQUIRES: User must be authenticated and have a stored Snowflake connection
 */
dashboardRoutes.post('/', requireMfaForEdit, async (req, res, next) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required. Please sign in to create a dashboard.'
      });
    }

    if (!['owner', 'admin', 'editor'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Only owners, admins, and editors can create dashboards.',
      });
    }

    const { name, description, connectionId, warehouse, role, visibility, yamlDefinition, semanticViewsReferenced, workspaceId } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ 
        success: false,
        error: 'Dashboard name is required' 
      });
    }
    
    if (!workspaceId) {
      return res.status(400).json({ 
        success: false,
        error: 'Workspace is required to create a dashboard' 
      });
    }

    // Build initial YAML definition if semantic views were selected
    let initialYaml = yamlDefinition;
    log('Creating dashboard - semanticViewsReferenced:', JSON.stringify(semanticViewsReferenced, null, 2));
    
    if (!initialYaml && semanticViewsReferenced && semanticViewsReferenced.length > 0) {
      const yamlContent = {
        semanticViewsReferenced: semanticViewsReferenced.map(sv => ({
          name: sv.name,
          fullyQualifiedName: sv.fullyQualifiedName,
        })),
        tabs: [{
          id: 'tab-1',
          title: 'Sheet 1',
          widgets: [],
        }],
        filters: [],
        calculatedFields: [],
      };
      initialYaml = yaml.dump(yamlContent);
      log('Generated initial YAML:', initialYaml);
    } else {
      log('No semantic views or already has yamlDefinition');
    }

    const dashboardData = {
      name: name.trim(),
      description: description || '',
      connectionId: connectionId || null,
      warehouse: warehouse || null,
      role: role || null,
      visibility: visibility || 'private',
      yamlDefinition: initialYaml || null,
      workspaceId: workspaceId || null,
    };

    const dashboard = await dashboardServicePg.createDashboard(dashboardData, req.user.id);
    
    res.status(201).json({ 
      success: true,
      dashboard: mapDashboardForFrontend(dashboard),
      message: 'Dashboard created successfully'
    });
  } catch (error) {
    console.error('Error creating dashboard:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to create dashboard'
    });
  }
});

/**
 * PUT /api/v1/dashboard/:id
 * Update a dashboard
 */
dashboardRoutes.put('/:id', requireMfaForEdit, async (req, res, next) => {
  try {
    
    const { name, description, warehouse, role, visibility, isPublished, yamlDefinition, tabs, filters, semanticViewsReferenced, customColorSchemes, folderId } = req.body;
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (warehouse !== undefined) updates.warehouse = warehouse;
    if (role !== undefined) updates.role = role;
    if (visibility !== undefined) updates.visibility = visibility;
    if (isPublished !== undefined) updates.isPublished = isPublished;
    if (folderId !== undefined) updates.folderId = folderId;
    
    // Build yaml_definition from provided data
    if (yamlDefinition !== undefined || tabs !== undefined || filters !== undefined || semanticViewsReferenced !== undefined || customColorSchemes !== undefined) {
      let yamlContent = {};
      
      // If yamlDefinition is already a string, parse it first
      if (typeof yamlDefinition === 'string') {
        try {
          yamlContent = yaml.load(yamlDefinition) || {};
        } catch (e) {
          console.warn('Failed to parse yamlDefinition string:', e.message);
          yamlContent = {};
        }
      } else if (yamlDefinition && typeof yamlDefinition === 'object') {
        yamlContent = yamlDefinition;
      }
      
      // Override with explicitly provided fields
      if (tabs !== undefined) yamlContent.tabs = tabs;
      if (filters !== undefined) yamlContent.filters = filters;
      if (semanticViewsReferenced !== undefined) yamlContent.semanticViewsReferenced = semanticViewsReferenced;
      if (customColorSchemes !== undefined) yamlContent.customColorSchemes = customColorSchemes;
      
      // Convert to YAML string for storage
      updates.yamlDefinition = yaml.dump(yamlContent);
    }

    const dashboard = await dashboardServicePg.updateDashboard(req.params.id, updates, req.user.id, req.user.role);
    
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }
    
    res.json({ 
      success: true,
      dashboard,
      message: 'Dashboard updated successfully'
    });
  } catch (error) {
    console.error('Error updating dashboard:', error);
    res.status(500).json({ error: error.message || 'Failed to update dashboard' });
  }
});

/**
 * DELETE /api/v1/dashboard/:id
 * Delete a dashboard (only owner or admin)
 */
dashboardRoutes.delete('/:id', requireMfaForEdit, async (req, res, next) => {
  try {

    await dashboardServicePg.deleteDashboard(req.params.id, req.user.id, req.user.role);
    
    res.json({ 
      success: true,
      message: 'Dashboard deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting dashboard:', error);
    if (error.message.includes('Only the dashboard owner') || error.message.includes('admin can delete')) {
      return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to delete dashboard' });
  }
});

/**
 * GET /api/v1/dashboard/:id/groups
 * Get all groups with access to a dashboard
 */
dashboardRoutes.get('/:id/groups', requireMfaForView, async (req, res, next) => {
  try {
    
    const groups = await dashboardServicePg.getDashboardGroups(req.params.id);
    res.json({ groups });
  } catch (error) {
    console.error('Error getting dashboard groups:', error);
    res.status(500).json({ error: error.message || 'Failed to get dashboard groups' });
  }
});

/**
 * POST /api/v1/dashboard/:id/groups
 * Grant group access to a dashboard
 */
dashboardRoutes.post('/:id/groups', requireMfaForEdit, async (req, res, next) => {
  try {
    
    const { groupId } = req.body;
    if (!groupId) {
      return res.status(400).json({ error: 'Group ID is required' });
    }
    
    await dashboardServicePg.grantGroupAccess(req.params.id, groupId, req.user.id);
    res.json({ success: true, message: 'Group access granted' });
  } catch (error) {
    console.error('Error granting group access:', error);
    res.status(500).json({ error: error.message || 'Failed to grant group access' });
  }
});

/**
 * PUT /api/v1/dashboard/:id/groups
 * Update all group access for a dashboard (replaces existing)
 */
dashboardRoutes.put('/:id/groups', requireMfaForEdit, async (req, res, next) => {
  try {
    
    const { groupIds } = req.body;
    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: 'groupIds must be an array' });
    }
    
    await dashboardServicePg.updateDashboardGroupAccess(req.params.id, groupIds, req.user.id);
    res.json({ success: true, message: 'Group access updated' });
  } catch (error) {
    console.error('Error updating group access:', error);
    res.status(500).json({ error: error.message || 'Failed to update group access' });
  }
});

/**
 * DELETE /api/v1/dashboard/:id/groups/:groupId
 * Revoke group access from a dashboard
 */
dashboardRoutes.delete('/:id/groups/:groupId', requireMfaForEdit, async (req, res, next) => {
  try {
    
    await dashboardServicePg.revokeGroupAccess(req.params.id, req.params.groupId, req.user.id);
    res.json({ success: true, message: 'Group access revoked' });
  } catch (error) {
    console.error('Error revoking group access:', error);
    res.status(500).json({ error: error.message || 'Failed to revoke group access' });
  }
});

/**
 * POST /api/v1/dashboard/:id/clone
 * Clone a dashboard
 */
dashboardRoutes.post('/:id/clone', requireMfaForEdit, async (req, res, next) => {
  try {
    const connection = req.snowflakeConnection || null;
    const { name } = req.body;
    
    const clonedDashboard = await dashboardService.cloneDashboard(connection, req.params.id, {
      newName: name,
      newOwner: req.user?.username || 'demo@simply.analytics',
      newRole: req.user?.role || 'DEMO_USER',
    });
    
    if (!clonedDashboard) {
      return res.status(404).json({ error: 'Source dashboard not found' });
    }
    
    res.status(201).json({ 
      success: true,
      dashboard: clonedDashboard
    });
  } catch (error) {
    console.error('Error cloning dashboard:', error);
    res.status(500).json({ error: error.message || 'Failed to clone dashboard' });
  }
});

/**
 * GET /api/v1/dashboard/:id/export
 * Export dashboard as YAML
 */
dashboardRoutes.get('/:id/export', requireMfaForView, async (req, res, next) => {
  try {
    const connection = req.snowflakeConnection || null;
    const yaml = await dashboardService.exportDashboardAsYaml(connection, req.params.id);
    
    if (!yaml) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }
    
    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard-${req.params.id}.yaml"`);
    res.send(yaml);
  } catch (error) {
    console.error('Error exporting dashboard:', error);
    res.status(500).json({ error: error.message || 'Failed to export dashboard' });
  }
});

/**
 * POST /api/v1/dashboard/import
 * Import dashboard from YAML
 */
dashboardRoutes.post('/import', requireMfaForEdit, async (req, res, next) => {
  try {
    const connection = req.snowflakeConnection || null;
    const { yaml, name, warehouse } = req.body;
    
    if (!yaml) {
      return res.status(400).json({ error: 'YAML content is required' });
    }

    const dashboard = await dashboardService.importDashboardFromYaml(connection, yaml, {
      name,
      warehouse,
      createdBy: req.user?.username || 'demo@simply.analytics',
      ownerRole: req.user?.role || 'DEMO_USER',
    });
    
    res.status(201).json({ 
      success: true,
      dashboard
    });
  } catch (error) {
    console.error('Error importing dashboard:', error);
    res.status(500).json({ error: error.message || 'Failed to import dashboard' });
  }
});

/**
 * POST /api/v1/dashboard/:id/tab/:tabId/widget
 * Add a widget to a dashboard tab
 */
dashboardRoutes.post('/:id/tab/:tabId/widget', requireMfaForEdit, async (req, res, next) => {
  try {
    const connection = req.snowflakeConnection || null;
    const widget = await dashboardService.addWidget(
      connection,
      req.params.id,
      req.params.tabId,
      {
        ...req.body,
        creator: req.user?.username || 'demo@simply.analytics',
      }
    );
    
    if (!widget) {
      return res.status(404).json({ error: 'Dashboard or tab not found' });
    }
    
    res.status(201).json({ 
      success: true,
      widget
    });
  } catch (error) {
    console.error('Error adding widget:', error);
    res.status(500).json({ error: error.message || 'Failed to add widget' });
  }
});

/**
 * PUT /api/v1/dashboard/:id/widget/:widgetId
 * Update a widget
 */
dashboardRoutes.put('/:id/widget/:widgetId', requireMfaForEdit, async (req, res, next) => {
  try {
    const connection = req.snowflakeConnection || null;
    const widget = await dashboardService.updateWidget(
      connection,
      req.params.id,
      req.params.widgetId,
      {
        ...req.body,
        updatedBy: req.user?.username || 'demo@simply.analytics',
      }
    );
    
    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    res.json({ 
      success: true,
      widget
    });
  } catch (error) {
    console.error('Error updating widget:', error);
    res.status(500).json({ error: error.message || 'Failed to update widget' });
  }
});

/**
 * DELETE /api/v1/dashboard/:id/widget/:widgetId
 * Delete a widget
 */
dashboardRoutes.delete('/:id/widget/:widgetId', requireMfaForEdit, async (req, res, next) => {
  try {
    const connection = req.snowflakeConnection || null;
    const success = await dashboardService.deleteWidget(
      connection,
      req.params.id,
      req.params.widgetId,
      req.user?.username || 'demo@simply.analytics'
    );
    
    if (!success) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    res.json({ 
      success: true,
      message: 'Widget deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting widget:', error);
    res.status(500).json({ error: error.message || 'Failed to delete widget' });
  }
});

export default dashboardRoutes;
