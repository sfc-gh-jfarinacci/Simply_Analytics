import { Router } from 'express';
import yaml from 'js-yaml';
import dashboardServicePg from '../services/dashboardServicePg.js';
import dashboardAiService from '../services/dashboardAiService.js';
import { getCachedDashboardConnection } from '../services/connectionService.js';

export const dashboardAiRoutes = Router();

async function resolveConnection(req) {
  if (req.snowflakeConnection) return req.snowflakeConnection;

  const connectionId = req.body.connectionId;
  if (connectionId && req.user) {
    return getCachedDashboardConnection(
      connectionId,
      req.user.id,
      req.user.sessionId,
      { role: req.body.role, warehouse: req.body.warehouse }
    );
  }

  return null;
}

/**
 * POST /api/dashboard-ai/generate
 */
dashboardAiRoutes.post('/generate', async (req, res) => {
  try {
    const connection = await resolveConnection(req);
    if (!connection) {
      return res.status(401).json({ error: 'Snowflake connection required. Pass connectionId in body.', code: 'NO_CONNECTION' });
    }

    const {
      prompt,
      semanticViewMetadata,
      name,
      connectionId,
      warehouse,
      role,
      model,
      save = false,
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const startTime = Date.now();
    const yamlContent = await dashboardAiService.generateDashboard(connection, {
      prompt,
      semanticViewMetadata,
      model,
    });
    const generationTime = Date.now() - startTime;

    const yamlString = yaml.dump(yamlContent);

    let dashboard = null;
    if (save && connectionId) {
      const dashboardData = {
        name: name || 'AI Generated Dashboard',
        description: `Generated from: "${prompt.slice(0, 200)}"`,
        connectionId,
        warehouse: warehouse || null,
        role: role || null,
        visibility: 'private',
        yamlDefinition: yamlString,
      };
      dashboard = await dashboardServicePg.createDashboard(dashboardData, req.user.id);
    }

    res.json({
      success: true,
      yamlContent,
      yamlString,
      dashboard: dashboard || null,
      generationTime,
    });
  } catch (error) {
    console.error('AI dashboard generation error:', error);
    res.status(500).json({
      error: error.message || 'AI dashboard generation failed',
      code: 'AI_GENERATION_ERROR',
    });
  }
});

/**
 * POST /api/dashboard-ai/generate-widget
 */
dashboardAiRoutes.post('/generate-widget', async (req, res) => {
  try {
    const connection = await resolveConnection(req);
    if (!connection) {
      return res.status(401).json({ error: 'Snowflake connection required. Pass connectionId in body.', code: 'NO_CONNECTION' });
    }

    const {
      prompt,
      semanticViewMetadata,
      existingWidgets,
      position,
      model,
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const startTime = Date.now();
    const widget = await dashboardAiService.generateWidget(connection, {
      prompt,
      semanticViewMetadata,
      existingWidgets,
      position,
      model,
    });
    const generationTime = Date.now() - startTime;

    res.json({
      success: true,
      widget,
      generationTime,
    });
  } catch (error) {
    console.error('AI widget generation error:', error);
    res.status(500).json({
      error: error.message || 'AI widget generation failed',
      code: 'AI_GENERATION_ERROR',
    });
  }
});

/**
 * POST /api/dashboard-ai/modify
 */
dashboardAiRoutes.post('/modify', async (req, res) => {
  try {
    const connection = await resolveConnection(req);
    if (!connection) {
      return res.status(401).json({ error: 'Snowflake connection required. Pass connectionId in body.', code: 'NO_CONNECTION' });
    }

    const {
      prompt,
      dashboardId,
      currentYaml,
      semanticViewMetadata,
      model,
      save = false,
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    let yamlToModify = currentYaml;

    if (!yamlToModify && dashboardId) {
      const { hasAccess } = await dashboardServicePg.checkDashboardAccess(
        dashboardId, req.user.id, 'edit', req.user.role
      );
      if (!hasAccess) {
        return res.status(403).json({ error: 'No edit access to this dashboard' });
      }
      const dashboard = await dashboardServicePg.getDashboardById(dashboardId);
      if (!dashboard) {
        return res.status(404).json({ error: 'Dashboard not found' });
      }
      if (dashboard.yaml_definition) {
        yamlToModify = yaml.load(dashboard.yaml_definition);
      }
    }

    if (!yamlToModify) {
      return res.status(400).json({ error: 'No dashboard YAML to modify. Provide currentYaml or dashboardId.' });
    }

    const startTime = Date.now();
    const yamlContent = await dashboardAiService.modifyDashboard(connection, {
      prompt,
      currentYaml: yamlToModify,
      semanticViewMetadata,
      model,
    });
    const generationTime = Date.now() - startTime;

    const yamlString = yaml.dump(yamlContent);

    if (save && dashboardId) {
      await dashboardServicePg.updateDashboard(
        dashboardId,
        { yamlDefinition: yamlString },
        req.user.id,
        req.user.role
      );
    }

    res.json({
      success: true,
      yamlContent,
      yamlString,
      generationTime,
    });
  } catch (error) {
    console.error('AI dashboard modification error:', error);
    res.status(500).json({
      error: error.message || 'AI dashboard modification failed',
      code: 'AI_GENERATION_ERROR',
    });
  }
});

dashboardAiRoutes.post('/chat', async (req, res) => {
  try {
    const connection = await resolveConnection(req);
    if (!connection) {
      return res.status(401).json({ error: 'Snowflake connection required. Pass connectionId in body.', code: 'NO_CONNECTION' });
    }

    const {
      messages,
      currentYaml,
      focusedWidgetId,
      semanticViewMetadata,
      model,
    } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required and must not be empty' });
    }

    const startTime = Date.now();
    const result = await dashboardAiService.chatWithDashboard(connection, {
      messages,
      currentYaml,
      focusedWidgetId,
      semanticViewMetadata,
      model,
    });
    const generationTime = Date.now() - startTime;

    res.json({
      success: true,
      ...result,
      generationTime,
    });
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({
      error: error.message || 'AI chat failed',
      code: 'AI_CHAT_ERROR',
    });
  }
});
