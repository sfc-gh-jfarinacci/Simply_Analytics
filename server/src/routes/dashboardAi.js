import { Router } from 'express';
import yaml from 'js-yaml';
import dashboardServicePg from '../services/dashboardServicePg.js';
import dashboardAiService from '../services/dashboardAi/index.js';
import explorerAiService from '../services/explorerAiService.js';
import { getCachedDashboardConnection, getConnectionWithCredentialsForDashboard } from '../services/connectionService.js';
import workspaceService from '../services/workspaceService.js';
import { trackEvent } from '../services/eventTracker.js';

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

async function resolveAiConfig(req) {
  if (req.body.provider) {
    return { provider: req.body.provider, model: req.body.model || undefined, apiKey: req.body.apiKey || null, endpointUrl: req.body.endpointUrl || null };
  }
  const workspaceId = req.body.workspaceId;
  if (workspaceId) {
    try {
      const cfg = await workspaceService.getAiConfigWithKey(workspaceId);
      return { provider: cfg.provider || 'cortex', model: cfg.defaultModel || undefined, apiKey: cfg.apiKey, endpointUrl: cfg.endpointUrl };
    } catch { /* fall through */ }
  }
  return { provider: undefined, model: undefined, apiKey: undefined, endpointUrl: undefined };
}

async function resolveConnWithCreds(connectionId, provider) {
  if (provider && provider !== 'cortex') return null;
  if (!connectionId) return null;
  try {
    return await getConnectionWithCredentialsForDashboard(connectionId);
  } catch { return null; }
}

/**
 * POST /api/v1/dashboard-ai/generate
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

    const aiCfg = await resolveAiConfig(req);
    const connWithCreds = await resolveConnWithCreds(connectionId, aiCfg.provider);

    const startTime = Date.now();
    const yamlContent = await dashboardAiService.generateDashboard(connection, {
      prompt,
      semanticViewMetadata,
      model: model || aiCfg.model,
      provider: aiCfg.provider,
      apiKey: aiCfg.apiKey,
      endpointUrl: aiCfg.endpointUrl,
      connWithCreds,
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

    trackEvent('ai.request', {
      userId: req.user?.id,
      workspaceId: req.body.workspaceId || null,
      entityType: 'dashboard',
      metadata: { action: 'generate', generationTime, provider: aiCfg.provider, requestType: 'ai' },
      ip: req.ip,
    });

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
 * POST /api/v1/dashboard-ai/generate-widget
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

    const aiCfg = await resolveAiConfig(req);
    const connWithCreds = await resolveConnWithCreds(req.body.connectionId, aiCfg.provider);

    const startTime = Date.now();
    const widget = await dashboardAiService.generateWidget(connection, {
      prompt,
      semanticViewMetadata,
      existingWidgets,
      position,
      model: model || aiCfg.model,
      provider: aiCfg.provider,
      apiKey: aiCfg.apiKey,
      endpointUrl: aiCfg.endpointUrl,
      connWithCreds,
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
 * POST /api/v1/dashboard-ai/modify
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

    const aiCfg = await resolveAiConfig(req);
    const connWithCreds = await resolveConnWithCreds(req.body.connectionId, aiCfg.provider);

    const startTime = Date.now();
    const yamlContent = await dashboardAiService.modifyDashboard(connection, {
      prompt,
      currentYaml: yamlToModify,
      semanticViewMetadata,
      model: model || aiCfg.model,
      provider: aiCfg.provider,
      apiKey: aiCfg.apiKey,
      endpointUrl: aiCfg.endpointUrl,
      connWithCreds,
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
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const connection = await resolveConnection(req);
    if (!connection) {
      sendEvent('error', { error: 'Snowflake connection required. Pass connectionId in body.' });
      return res.end();
    }

    const {
      messages,
      currentYaml,
      focusedWidgetId,
      semanticViewMetadata,
      model,
    } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      sendEvent('error', { error: 'messages array is required and must not be empty' });
      return res.end();
    }

    const aiCfg = await resolveAiConfig(req);
    const connWithCreds = await resolveConnWithCreds(req.body.connectionId, aiCfg.provider);

    sendEvent('response.status', { message: 'Thinking...' });

    const startTime = Date.now();
    const result = await dashboardAiService.chatWithDashboardStream(connection, {
      messages,
      currentYaml,
      focusedWidgetId,
      semanticViewMetadata,
      model: model || aiCfg.model,
      onToolStep: (step) => {
        sendEvent('response.tool_step', { tool: step.tool, thinking: step.thinking, round: step.round ?? 0 });
      },
      onTextDelta: (delta) => {
        sendEvent('response.text.delta', { text: delta });
      },
      provider: aiCfg.provider,
      apiKey: aiCfg.apiKey,
      endpointUrl: aiCfg.endpointUrl,
      connWithCreds,
    });
    const generationTime = Date.now() - startTime;

    sendEvent('response.result', {
      success: true,
      message: result.message,
      action: result.action,
      yaml: result.yaml,
      toolSteps: result.toolSteps,
      generationTime,
    });
    sendEvent('response.done', {});
  } catch (error) {
    console.error('AI chat error:', error);
    sendEvent('error', { error: error.message || 'AI chat failed' });
  } finally {
    res.end();
  }
});

/**
 * POST /api/v1/dashboard-ai/explore
 * Data Explorer — investigative AI agent that queries data to answer business questions
 */
dashboardAiRoutes.post('/explore', async (req, res) => {
  try {
    const connection = await resolveConnection(req);
    if (!connection) {
      return res.status(401).json({ error: 'Snowflake connection required.', code: 'NO_CONNECTION' });
    }

    const {
      question,
      semanticViewMetadata,
      conversationHistory,
      model,
    } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const aiCfg = await resolveAiConfig(req);
    const connWithCreds = await resolveConnWithCreds(req.body.connectionId, aiCfg.provider);

    const startTime = Date.now();
    const result = await explorerAiService.exploreData(connection, {
      question,
      semanticViewMetadata,
      conversationHistory,
      model: model || aiCfg.model,
      provider: aiCfg.provider,
      apiKey: aiCfg.apiKey,
      endpointUrl: aiCfg.endpointUrl,
      connWithCreds,
    });

    res.json({
      success: true,
      ...result,
      generationTime: Date.now() - startTime,
    });
  } catch (error) {
    console.error('Explorer AI error:', error);
    res.status(500).json({
      error: error.message || 'Explorer AI failed',
      code: 'EXPLORER_ERROR',
    });
  }
});
