import yaml from 'js-yaml';

const DASHBOARD_SCHEMA_PROMPT = `You are an expert dashboard builder for the Simply Analytics platform.
You generate dashboard definitions in YAML format based on natural language descriptions.

## YAML SCHEMA

A dashboard YAML has this structure:

\`\`\`yaml
semanticViewsReferenced:
  - name: "VIEW_NAME"
    fullyQualifiedName: "DATABASE.SCHEMA.VIEW_NAME"

tabs:
  - id: "tab-1"
    title: "Sheet 1"
    backgroundColor: null
    widgets:
      - id: "<unique-id>"
        title: "Widget Title"
        type: "<chart_type>"
        semanticView: "DATABASE.SCHEMA.VIEW_NAME"
        semanticViewsReferenced:
          - name: "VIEW_NAME"
            fullyQualifiedName: "DATABASE.SCHEMA.VIEW_NAME"
        fields:
          - name: "FIELD_NAME"
            shelf: "columns"
            dataType: "VARCHAR"
            semanticType: "dimension"
            aggregation: null
            markType: null
            alias: null
            isCustomColumn: false
          - name: "METRIC_NAME"
            shelf: "rows"
            dataType: "NUMBER"
            semanticType: "measure"
            aggregation: "SUM"
            markType: null
            alias: null
            isCustomColumn: false
        position:
          x: 0
          y: 0
          w: 6
          h: 4
          minW: 2
          minH: 2
        config:
          showTitle: true
          titlePosition: "top-left"
          colorScheme: "tableau10"
          sorts: []
          columnAliases: {}
          fieldAggregations: {}
        filtersApplied: []
        sortsApplied: []
        marks: {}
        chartQuery: {}

filters: []
cortexAgentsEnabled: false
cortexAgents: []
customColorSchemes: []
\`\`\`

## WIDGET TYPES
Available chart types: bar, stacked-bar, horizontal-bar, diverging-bar, line, multiline, area, pie, donut, radial, treemap, icicle, sankey, funnel, table, metric

## FIELD RULES
- Dimensions go on shelf "columns", measures go on shelf "rows"
- For color/size/tooltip breakdown, use shelf "marks" with the appropriate markType
- markType values: "color", "size", "detail", "tooltip", "label"
- aggregation for measures: "SUM", "AVG", "COUNT", "MIN", "MAX", or null
- aggregation for dimensions: null
- semanticType: "dimension" for categorical/date fields, "measure" for numeric metrics
- dataType: match the actual Snowflake type (VARCHAR, NUMBER, DATE, TIMESTAMP_NTZ, etc.)

## POSITION GRID
- The grid is 12 columns wide
- w: widget width in grid units (1-12)
- h: widget height in grid units (typically 3-6)
- x: column position (0-11)
- y: row position (0+, auto-stacks vertically)
- Layout widgets in a visually appealing grid. Use the full 12 columns.

## ID GENERATION
- Widget IDs: use format "w-<timestamp>-<random>" e.g. "w-1711234567890-a1b2"
- Tab IDs: use format "tab-<number>" e.g. "tab-1"

## CHART TYPE SELECTION GUIDELINES
- bar/stacked-bar: comparing categories, time series with few points
- horizontal-bar: long category names, ranking comparisons
- line/multiline: time series trends, continuous data
- area: volume over time, stacked compositions
- pie/donut: part-of-whole (< 7 categories)
- treemap: hierarchical data, space-efficient part-of-whole
- metric: single KPI number (1 measure, 0-1 dimensions)
- table: detailed data exploration, many fields
- funnel: conversion/pipeline stages
- sankey: flow between categories
- diverging-bar: positive/negative comparison

## RESPONSE FORMAT
Respond with ONLY valid YAML. No markdown code fences, no explanations, no extra text.
The YAML must be parseable by js-yaml. Use proper indentation (2 spaces).`;

const WIDGET_SCHEMA_PROMPT = `You are an expert widget builder for the Simply Analytics platform.
You generate individual widget definitions in YAML format based on natural language descriptions.

## WIDGET YAML SCHEMA

\`\`\`yaml
id: "<unique-id>"
title: "Widget Title"
type: "<chart_type>"
semanticView: "DATABASE.SCHEMA.VIEW_NAME"
semanticViewsReferenced:
  - name: "VIEW_NAME"
    fullyQualifiedName: "DATABASE.SCHEMA.VIEW_NAME"
fields:
  - name: "FIELD_NAME"
    shelf: "columns"
    dataType: "VARCHAR"
    semanticType: "dimension"
    aggregation: null
    markType: null
    alias: null
    isCustomColumn: false
position:
  x: 0
  y: 0
  w: 6
  h: 4
  minW: 2
  minH: 2
config:
  showTitle: true
  titlePosition: "top-left"
  colorScheme: "tableau10"
  sorts: []
  columnAliases: {}
  fieldAggregations: {}
filtersApplied: []
sortsApplied: []
marks: {}
chartQuery: {}
\`\`\`

## WIDGET TYPES
Available: bar, stacked-bar, horizontal-bar, diverging-bar, line, multiline, area, pie, donut, radial, treemap, icicle, sankey, funnel, table, metric

## FIELD RULES
- Dimensions: shelf "columns", semanticType "dimension", aggregation null
- Measures: shelf "rows", semanticType "measure", aggregation "SUM"/"AVG"/"COUNT"/"MIN"/"MAX"
- Marks: shelf "marks", markType "color"/"size"/"detail"/"tooltip"/"label"
- dataType: match the Snowflake column type (VARCHAR, NUMBER, DATE, etc.)

## CHART SELECTION
- metric: single KPI (1 measure, optional dimension)
- bar/line: category vs measure comparisons
- pie/donut: part-of-whole (< 7 slices)
- table: detailed multi-field data
- area: volume trends over time

## ID FORMAT
Use "w-<timestamp>-<random>" e.g. "w-1711234567890-x3y4"

## RESPONSE FORMAT
Respond with ONLY valid YAML for a single widget object. No markdown, no explanations.`;

function buildSemanticViewContext(metadata) {
  if (!metadata || (!metadata.dimensions?.length && !metadata.measures?.length)) {
    return '';
  }

  const lines = ['## AVAILABLE DATA FIELDS'];

  if (metadata.fullyQualifiedName) {
    lines.push(`Semantic View: ${metadata.fullyQualifiedName}`);
  }

  if (metadata.dimensions?.length) {
    lines.push('\nDimensions:');
    for (const d of metadata.dimensions) {
      const dt = d.dataType || d.data_type || 'VARCHAR';
      const desc = d.description ? ` — ${d.description}` : '';
      lines.push(`  - ${d.name} (${dt})${desc}`);
    }
  }

  if (metadata.measures?.length) {
    lines.push('\nMeasures/Metrics:');
    for (const m of metadata.measures) {
      const dt = m.dataType || m.data_type || 'NUMBER';
      const agg = m.defaultAggregation || m.default_aggregation || 'SUM';
      const desc = m.description ? ` — ${m.description}` : '';
      lines.push(`  - ${m.name} (${dt}, default agg: ${agg})${desc}`);
    }
  }

  if (metadata.facts?.length) {
    lines.push('\nFacts:');
    for (const f of metadata.facts) {
      const dt = f.dataType || f.data_type || 'NUMBER';
      lines.push(`  - ${f.name} (${dt})`);
    }
  }

  return lines.join('\n');
}

function escapeForSnowflake(str) {
  return str.replace(/'/g, "''");
}

export async function generateDashboard(connection, { prompt, semanticViewMetadata, model = 'claude-3-5-sonnet', maxTokens = 4096 }) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  const systemPrompt = `${DASHBOARD_SCHEMA_PROMPT}\n\n${viewContext}`;

  const sql = `
    SELECT SNOWFLAKE.CORTEX.COMPLETE(
      '${model}',
      [
        {'role': 'system', 'content': '${escapeForSnowflake(systemPrompt)}'},
        {'role': 'user', 'content': '${escapeForSnowflake(prompt)}'}
      ],
      {'temperature': 0.3, 'max_tokens': ${maxTokens}}
    ) as response
  `;

  const result = await executeQuery(connection, sql);
  let response = result[0]?.RESPONSE || result[0]?.response;

  if (response && typeof response === 'object') {
    if (response.choices?.[0]) {
      response = response.choices[0].messages || response.choices[0].message?.content || response.choices[0].text;
    } else if (response.content) {
      response = response.content;
    }
  }

  if (typeof response !== 'string') {
    response = JSON.stringify(response);
  }

  const cleaned = response
    .replace(/^```ya?ml\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const parsed = yaml.load(cleaned);
  return validateAndNormalizeDashboard(parsed);
}

export async function generateWidget(connection, { prompt, semanticViewMetadata, existingWidgets, position, model = 'claude-3-5-sonnet', maxTokens = 2048 }) {
  const viewContext = buildSemanticViewContext(semanticViewMetadata);

  let positionHint = '';
  if (position) {
    positionHint = `\n\nPlace the widget at position x:${position.x}, y:${position.y}, w:${position.w || 6}, h:${position.h || 4}.`;
  } else if (existingWidgets?.length) {
    const maxY = Math.max(...existingWidgets.map(w => (w.position?.y || 0) + (w.position?.h || 4)));
    positionHint = `\n\nExisting widgets occupy up to row ${maxY}. Place this widget below them at y:${maxY}.`;
  }

  const systemPrompt = `${WIDGET_SCHEMA_PROMPT}\n\n${viewContext}${positionHint}`;

  const sql = `
    SELECT SNOWFLAKE.CORTEX.COMPLETE(
      '${model}',
      [
        {'role': 'system', 'content': '${escapeForSnowflake(systemPrompt)}'},
        {'role': 'user', 'content': '${escapeForSnowflake(prompt)}'}
      ],
      {'temperature': 0.3, 'max_tokens': ${maxTokens}}
    ) as response
  `;

  const result = await executeQuery(connection, sql);
  let response = result[0]?.RESPONSE || result[0]?.response;

  if (response && typeof response === 'object') {
    if (response.choices?.[0]) {
      response = response.choices[0].messages || response.choices[0].message?.content || response.choices[0].text;
    } else if (response.content) {
      response = response.content;
    }
  }

  if (typeof response !== 'string') {
    response = JSON.stringify(response);
  }

  const cleaned = response
    .replace(/^```ya?ml\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const parsed = yaml.load(cleaned);
  return validateAndNormalizeWidget(parsed);
}

export async function modifyDashboard(connection, { prompt, currentYaml, semanticViewMetadata, model = 'claude-3-5-sonnet', maxTokens = 4096 }) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  const currentYamlStr = typeof currentYaml === 'string' ? currentYaml : yaml.dump(currentYaml);

  const modifyPrompt = `${DASHBOARD_SCHEMA_PROMPT}

${viewContext}

## CURRENT DASHBOARD YAML
The user wants to MODIFY this existing dashboard. Apply the requested changes while preserving
existing widgets and configuration that shouldn't change.

\`\`\`yaml
${currentYamlStr}
\`\`\`

Return the COMPLETE modified YAML (not just the changed parts).`;

  const sql = `
    SELECT SNOWFLAKE.CORTEX.COMPLETE(
      '${model}',
      [
        {'role': 'system', 'content': '${escapeForSnowflake(modifyPrompt)}'},
        {'role': 'user', 'content': '${escapeForSnowflake(prompt)}'}
      ],
      {'temperature': 0.3, 'max_tokens': ${maxTokens}}
    ) as response
  `;

  const result = await executeQuery(connection, sql);
  let response = result[0]?.RESPONSE || result[0]?.response;

  if (response && typeof response === 'object') {
    if (response.choices?.[0]) {
      response = response.choices[0].messages || response.choices[0].message?.content || response.choices[0].text;
    } else if (response.content) {
      response = response.content;
    }
  }

  if (typeof response !== 'string') {
    response = JSON.stringify(response);
  }

  const cleaned = response
    .replace(/^```ya?ml\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const parsed = yaml.load(cleaned);
  return validateAndNormalizeDashboard(parsed);
}

function validateAndNormalizeDashboard(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI returned invalid YAML structure');
  }

  if (!parsed.tabs || !Array.isArray(parsed.tabs)) {
    parsed.tabs = [{
      id: 'tab-1',
      title: 'Sheet 1',
      widgets: parsed.widgets || [],
    }];
    delete parsed.widgets;
  }

  for (const tab of parsed.tabs) {
    if (!tab.id) tab.id = `tab-${Date.now()}`;
    if (!tab.title) tab.title = 'Sheet 1';
    if (!tab.widgets) tab.widgets = [];

    for (const widget of tab.widgets) {
      validateAndNormalizeWidget(widget);
    }
  }

  if (!parsed.filters) parsed.filters = [];
  if (!parsed.semanticViewsReferenced) {
    const viewSet = new Map();
    for (const tab of parsed.tabs) {
      for (const widget of tab.widgets) {
        for (const sv of (widget.semanticViewsReferenced || [])) {
          if (sv.fullyQualifiedName) {
            viewSet.set(sv.fullyQualifiedName, sv);
          }
        }
      }
    }
    parsed.semanticViewsReferenced = Array.from(viewSet.values());
  }

  if (parsed.cortexAgentsEnabled === undefined) parsed.cortexAgentsEnabled = false;
  if (!parsed.cortexAgents) parsed.cortexAgents = [];
  if (!parsed.customColorSchemes) parsed.customColorSchemes = [];

  return parsed;
}

function validateAndNormalizeWidget(widget) {
  if (!widget || typeof widget !== 'object') {
    throw new Error('AI returned invalid widget structure');
  }

  const VALID_TYPES = [
    'bar', 'stacked-bar', 'horizontal-bar', 'diverging-bar',
    'line', 'multiline', 'area',
    'pie', 'donut', 'radial',
    'treemap', 'icicle', 'sankey', 'funnel',
    'table', 'metric',
  ];

  if (!widget.id) {
    widget.id = `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }
  if (!widget.title) widget.title = 'Untitled Widget';
  if (!widget.type || !VALID_TYPES.includes(widget.type)) {
    widget.type = 'bar';
  }
  if (!widget.fields) widget.fields = [];
  if (!widget.position) {
    widget.position = { x: 0, y: 0, w: 6, h: 4, minW: 2, minH: 2 };
  } else {
    widget.position.minW = widget.position.minW || 2;
    widget.position.minH = widget.position.minH || 2;
  }
  if (!widget.config) {
    widget.config = {
      showTitle: true,
      titlePosition: 'top-left',
      colorScheme: 'tableau10',
      sorts: [],
      columnAliases: {},
      fieldAggregations: {},
    };
  }
  if (!widget.filtersApplied) widget.filtersApplied = [];
  if (!widget.sortsApplied) widget.sortsApplied = [];
  if (!widget.marks) widget.marks = {};
  if (!widget.chartQuery) widget.chartQuery = {};
  // Derive semanticViewsReferenced from the semanticView FQN when missing.
  // The AI often sets `semanticView` but omits `semanticViewsReferenced`.
  if (!widget.semanticViewsReferenced || widget.semanticViewsReferenced.length === 0) {
    if (widget.semanticView) {
      const fqn = widget.semanticView;
      const name = fqn.includes('.') ? fqn.split('.').pop() : fqn;
      widget.semanticViewsReferenced = [{ name, fullyQualifiedName: fqn }];
    } else {
      widget.semanticViewsReferenced = [];
    }
  }

  for (const field of widget.fields) {
    if (!field.shelf) field.shelf = 'columns';
    if (!field.semanticType) field.semanticType = 'dimension';
    if (!field.dataType) field.dataType = 'VARCHAR';
    if (field.isCustomColumn === undefined) field.isCustomColumn = false;
  }

  return widget;
}

function executeQuery(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: (err, stmt, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      },
    });
  });
}

const CHAT_SYSTEM_PROMPT = `You are an AI assistant embedded in the Simply Analytics dashboard editor.
You help users build and modify dashboards through conversation. You have full context of the current dashboard state.

${DASHBOARD_SCHEMA_PROMPT.replace('## RESPONSE FORMAT\nRespond with ONLY valid YAML. No markdown code fences, no explanations, no extra text.\nThe YAML must be parseable by js-yaml. Use proper indentation (2 spaces).', '')}

## RESPONSE FORMAT
You MUST respond with valid JSON in this exact structure:
{
  "message": "A short conversational explanation of what you did or are suggesting",
  "action": "none" | "replace_dashboard" | "add_widget" | "update_widget" | "remove_widget",
  "yaml": <the YAML object for the action, or null if action is "none">
}

Actions:
- "none": just answering a question, no changes
- "add_widget": yaml should be a single widget object OR an array of widget objects to add. PREFER this when the user asks to create/build/add widgets.
- "update_widget": yaml should be { widgetId: "<id>", widget: <updated widget object> }
- "remove_widget": yaml should be { widgetId: "<id>" }
- "replace_dashboard": full dashboard YAML replacement. ONLY use when the user explicitly asks to rebuild/replace the entire dashboard. NEVER use this just to add new widgets — use add_widget instead.

IMPORTANT:
- Always respond with valid JSON. The "yaml" field contains a JS object (not a YAML string).
- When the user asks about a focused widget, apply changes only to that widget.
- Preserve widget IDs when updating. Only generate new IDs for new widgets.
- When adding multiple widgets, use "add_widget" with an array of widget objects, NOT "replace_dashboard".
- Be concise in your message. 1-2 sentences max.`;

export async function chatWithDashboard(connection, {
  messages,
  currentYaml,
  focusedWidgetId,
  semanticViewMetadata,
  model = 'claude-3-5-sonnet',
  maxTokens = 4096,
}) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  const currentYamlStr = currentYaml
    ? (typeof currentYaml === 'string' ? currentYaml : yaml.dump(currentYaml))
    : '(empty dashboard)';

  let focusContext = '';
  if (focusedWidgetId && currentYaml?.tabs) {
    for (const tab of currentYaml.tabs) {
      const w = (tab.widgets || []).find(w => w.id === focusedWidgetId);
      if (w) {
        focusContext = `\n\n## FOCUSED WIDGET\nThe user is focused on widget "${w.title}" (id: ${w.id}, type: ${w.type}). Apply changes to THIS widget unless they clearly ask for something else.\n\`\`\`yaml\n${yaml.dump(w)}\`\`\``;
        break;
      }
    }
  }

  const systemContent = `${CHAT_SYSTEM_PROMPT}\n\n${viewContext}\n\n## CURRENT DASHBOARD\n\`\`\`yaml\n${currentYamlStr}\n\`\`\`${focusContext}`;

  const llmMessages = [
    { role: 'system', content: systemContent },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const messagesStr = llmMessages.map(m =>
    `{'role': '${m.role}', 'content': '${escapeForSnowflake(m.content)}'}`
  ).join(', ');

  const sql = `
    SELECT SNOWFLAKE.CORTEX.COMPLETE(
      '${model}',
      [${messagesStr}],
      {'temperature': 0.3, 'max_tokens': ${maxTokens}}
    ) as response
  `;

  const result = await executeQuery(connection, sql);
  let response = result[0]?.RESPONSE || result[0]?.response;

  if (response && typeof response === 'object') {
    if (response.choices?.[0]) {
      response = response.choices[0].messages || response.choices[0].message?.content || response.choices[0].text;
    } else if (response.content) {
      response = response.content;
    }
  }

  if (typeof response !== 'string') {
    response = JSON.stringify(response);
  }

  const cleaned = response
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      message: cleaned,
      action: 'none',
      yaml: null,
    };
  }

  if (parsed.action === 'replace_dashboard' && parsed.yaml) {
    parsed.yaml = validateAndNormalizeDashboard(parsed.yaml);
  } else if ((parsed.action === 'add_widget') && parsed.yaml) {
    if (Array.isArray(parsed.yaml)) {
      parsed.yaml = parsed.yaml.map(w => validateAndNormalizeWidget(w));
    } else {
      parsed.yaml = validateAndNormalizeWidget(parsed.yaml);
    }
  } else if (parsed.action === 'update_widget' && parsed.yaml?.widget) {
    parsed.yaml.widget = validateAndNormalizeWidget(parsed.yaml.widget);
  }

  return parsed;
}

export default {
  generateDashboard,
  generateWidget,
  modifyDashboard,
  chatWithDashboard,
};
