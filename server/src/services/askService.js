import { buildQueryDirect } from '../utils/queryBuilder.js';
import dashboardAiService from './dashboardAi/index.js';

export function buildSqlForWidget(widget) {
  const semanticViewFQN =
    widget.semanticView ||
    widget.semanticViewsReferenced?.[0]?.fullyQualifiedName;

  if (!semanticViewFQN) return null;

  const dimensions = [];
  const measures = [];

  for (const field of Array.isArray(widget.fields) ? widget.fields : []) {
    if (field.semanticType === 'measure' || field.shelf === 'rows') {
      measures.push({ name: field.name, aggregation: field.aggregation || 'SUM' });
    } else if (field.semanticType === 'dimension' || field.shelf === 'columns') {
      dimensions.push(field.name);
    }
  }

  const filters = (Array.isArray(widget.filtersApplied) ? widget.filtersApplied : []).map((f) => ({
    field: f.field, operator: f.operator || '=', value: f.value, values: f.values, value2: f.value2,
  }));
  const orderBy = (Array.isArray(widget.sortsApplied) ? widget.sortsApplied : []).map((s) => ({
    field: s.field, direction: s.direction || 'ASC',
  }));
  const customColumns = (Array.isArray(widget.customColumns) ? widget.customColumns : []).map((cc) => ({
    name: cc.name, expression: cc.expression,
  }));

  if (dimensions.length === 0 && measures.length === 0) return null;

  return buildQueryDirect({ semanticViewFQN, dimensions, measures, filters, orderBy, customColumns });
}

function execQuery(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows || [])),
    });
  });
}

async function executeWidgetQueries(connection, widgets) {
  const results = [];
  for (const widget of widgets) {
    const sql = buildSqlForWidget(widget);
    if (!sql) {
      results.push({ widget, data: [], sql: null, columns: [], totalRows: 0, error: 'Could not build SQL from widget config' });
      continue;
    }
    try {
      const rows = await execQuery(connection, sql);
      results.push({ widget, data: rows, sql, columns: rows.length > 0 ? Object.keys(rows[0]) : [], totalRows: rows.length });
    } catch (err) {
      results.push({ widget, data: [], sql, columns: [], totalRows: 0, error: err.message });
    }
  }
  return results;
}

export async function generateAndExecuteWidget(connection, { prompt, metadata, model, provider, apiKey, endpointUrl, connWithCreds }) {
  const widget = await dashboardAiService.generateWidget(connection, {
    prompt, semanticViewMetadata: metadata, model, maxTokens: 2048, provider, apiKey, endpointUrl, connWithCreds,
  });
  const widgets = await executeWidgetQueries(connection, [widget]);
  return { message: widget.title || 'Here are your results.', widgets };
}

export async function generateAndExecuteDashboard(connection, { prompt, metadata, model, provider, apiKey, endpointUrl, connWithCreds }) {
  const dashboard = await dashboardAiService.generateDashboard(connection, {
    prompt, semanticViewMetadata: metadata, model, maxTokens: 4096, provider, apiKey, endpointUrl, connWithCreds,
  });
  const allWidgets = [];
  for (const tab of dashboard.tabs || []) allWidgets.push(...(tab.widgets || []));
  const executed = await executeWidgetQueries(connection, allWidgets);
  const widgetData = {};
  for (const r of executed) {
    widgetData[r.widget.id] = { data: r.data, sql: r.sql, columns: r.columns, totalRows: r.totalRows, error: r.error };
  }
  return {
    message: `Here's a dashboard with ${allWidgets.length} widget${allWidgets.length === 1 ? '' : 's'} based on your data.`,
    dashboard: { yaml: dashboard, widgetData },
  };
}

export async function agenticChat(connection, { messages, metadata, model, provider, apiKey, endpointUrl, connWithCreds }) {
  const result = await dashboardAiService.chatWithDashboard(connection, {
    messages, currentYaml: null, focusedWidgetId: null, semanticViewMetadata: metadata, model, maxTokens: 4096, provider, apiKey, endpointUrl, connWithCreds,
  });

  if (result.action === 'add_widget' || result.action === 'replace_dashboard') {
    const widgets = Array.isArray(result.yaml) ? result.yaml : result.yaml ? [result.yaml] : [];
    const executed = await executeWidgetQueries(connection, widgets);
    return { message: result.message, action: result.action, widgets: executed, toolSteps: result.toolSteps };
  }
  return { message: result.message, action: result.action, widgets: [], toolSteps: result.toolSteps };
}

export async function conversationalAnswer(connection, { messages, metadata, model, provider, apiKey, endpointUrl, connWithCreds }) {
  return dashboardAiService.conversationalAnswer(connection, {
    messages, semanticViewMetadata: metadata, model, maxTokens: 4096, provider, apiKey, endpointUrl, connWithCreds,
  });
}

export async function askChatAndExecute(connection, { messages, metadata, priorArtifacts, model, onToolStep, onTextDelta, provider, apiKey, endpointUrl, connWithCreds }) {
  const result = await dashboardAiService.askChat(connection, {
    messages,
    semanticViewMetadata: metadata,
    priorArtifacts: priorArtifacts || [],
    model,
    maxTokens: 4096,
    onToolStep,
    onTextDelta,
    provider,
    apiKey,
    endpointUrl,
    connWithCreds,
  });

  if (result.action === 'add_widget' && result.yaml) {
    const widgets = Array.isArray(result.yaml) ? result.yaml : [result.yaml];
    const executed = await executeWidgetQueries(connection, widgets);
    return { message: result.message, action: result.action, widgets: executed, toolSteps: result.toolSteps };
  }

  if (result.action === 'update_widget' && result.yaml?.widget) {
    const executed = await executeWidgetQueries(connection, [result.yaml.widget]);
    return {
      message: result.message,
      action: result.action,
      widgetId: result.yaml.widgetId,
      widgets: executed,
      toolSteps: result.toolSteps,
    };
  }

  if (result.action === 'add_dashboard' && result.yaml) {
    const dashboard = result.yaml;
    const allWidgets = [];
    for (const tab of dashboard.tabs || []) allWidgets.push(...(tab.widgets || []));
    const executed = await executeWidgetQueries(connection, allWidgets);
    const widgetData = {};
    for (const r of executed) {
      widgetData[r.widget.id] = { data: r.data, sql: r.sql, columns: r.columns, totalRows: r.totalRows, error: r.error };
    }
    return {
      message: result.message,
      action: result.action,
      dashboard: { yaml: dashboard, widgetData },
      widgets: [],
      toolSteps: result.toolSteps,
    };
  }

  return { message: result.message, action: result.action || 'none', widgets: [], toolSteps: result.toolSteps };
}

export async function classifyIntent(connection, { message, hasHistory, provider, apiKey, endpointUrl, connWithCreds }) {
  return dashboardAiService.classifyIntent(connection, { message, hasHistory, provider, apiKey, endpointUrl, connWithCreds });
}

export default { buildSqlForWidget, generateAndExecuteWidget, generateAndExecuteDashboard, agenticChat, conversationalAnswer, askChatAndExecute, classifyIntent };
