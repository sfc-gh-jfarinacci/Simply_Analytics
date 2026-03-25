import yaml from 'js-yaml';
import { buildQueryDirect } from '../utils/queryBuilder.js';

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
        filtersApplied:
          - field: "FIELD_NAME"
            operator: "IN"
            values: ["value1", "value2"]
          - field: "FIELD_NAME"
            operator: ">"
            value: "100"
        sortsApplied:
          - field: "FIELD_NAME"
            direction: "ASC"
        customColumns:
          - name: "CALCULATED_FIELD"
            expression: "[FIELD_A] / [FIELD_B]"
        marks: {}
        chartQuery: {}

filters: []
cortexAgentsEnabled: false
cortexAgents: []
customColorSchemes: []
\`\`\`

## WIDGET TYPES
Available chart types: bar, stacked-bar, horizontal-bar, diverging-bar, line, multiline, area, pie, donut, radial, treemap, icicle, sankey, funnel, waterfall, scatter, boxplot, table, pivot, metric

## FILTER RULES
- filtersApplied is an array of filter objects on each widget
- Each filter: { field: "FIELD_NAME", operator: "<OP>", value: "single_value" } OR { field: "FIELD_NAME", operator: "IN", values: ["v1", "v2"] }
- Supported operators: "IN", "NOT IN", "=", "!=", ">", "<", ">=", "<=", "LIKE", "BETWEEN"
- Use "IN" with "values" array for multi-select filters
- Use other operators with a single "value" string
- ALWAYS include filtersApplied in your widget response when the user asks for filters

## SORT RULES
- sortsApplied is an array of sort objects on each widget
- Each sort: { field: "FIELD_NAME", direction: "ASC" | "DESC" }
- ALWAYS include sortsApplied in your widget response when the user asks for sorting

## FIELD RULES
- Dimensions go on shelf "columns", measures go on shelf "rows"
- For color/size/tooltip breakdown, use shelf "marks" with the appropriate markType
- markType values: "color", "size", "detail", "tooltip", "label"
- Any mark type can be assigned to fields on either columns or rows shelf
- Columns-shelf marks take precedence; within a shelf, first field wins for single-value marks (color, cluster)
- aggregation for measures: "SUM", "AVG", "COUNT", "MIN", "MAX", or null
- aggregation for dimensions: null
- semanticType: "dimension" for categorical/date fields, "measure" for numeric metrics
- dataType: match the actual Snowflake type (VARCHAR, NUMBER, DATE, TIMESTAMP_NTZ, etc.)

## CALCULATED FIELDS (customColumns)
- When a widget needs a derived/computed value not available as a native field, create a calculated field
- Add a "customColumns" array to the widget: [{ name: "FIELD_NAME", expression: "SQL expression" }]
- Reference existing fields with bracket syntax: [EXISTING_FIELD]
- Examples:
  - Ratio: { name: "REVENUE_PER_UNIT", expression: "[REVENUE] / [QUANTITY]" }
  - Margin: { name: "PROFIT_MARGIN", expression: "([REVENUE] - [COST]) / [REVENUE] * 100" }
  - Date part: { name: "ORDER_YEAR", expression: "YEAR([ORDER_DATE])" }
  - Conditional: { name: "SIZE_CATEGORY", expression: "CASE WHEN [QUANTITY] > 100 THEN 'Large' ELSE 'Small' END" }
- After creating a calculated field, use its name in the fields array with isCustomColumn: true
- Set semanticType: "measure" for numeric results, "dimension" for categorical results

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
- diverging-bar: positive/negative comparison
- line/multiline: time series trends, continuous data
- area: volume over time, stacked compositions
- pie/donut: part-of-whole (< 7 categories)
- radial: part-of-whole with radial layout
- treemap: hierarchical data, space-efficient part-of-whole
- icicle: hierarchical data, partition layout
- sankey: flow between categories (2+ dimensions, 1 measure)
- funnel: conversion/pipeline stages
- waterfall: cumulative effect of sequential values (1 dimension on columns, 1 measure on rows)
- scatter: relationship between two numeric values (dimension on columns, measures on rows; supports color mark for grouping)
- boxplot: distribution of values across categories (dimension on columns, measures on rows)
- metric: single KPI number (1 measure, 0-1 dimensions)
- table: flat data table, all fields displayed as columns
- pivot: matrix/cross-tab view (dimensions on columns become headers, dimensions on rows become row labels, measures fill cells at intersections)

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
filtersApplied:
  - field: "FIELD_NAME"
    operator: "IN"
    values: ["value1", "value2"]
  - field: "FIELD_NAME"
    operator: ">"
    value: "100"
sortsApplied:
  - field: "FIELD_NAME"
    direction: "ASC"
customColumns:
  - name: "CALCULATED_FIELD_NAME"
    expression: "[FIELD_A] / [FIELD_B]"
marks: {}
chartQuery: {}
\`\`\`

## WIDGET TYPES
Available: bar, stacked-bar, horizontal-bar, diverging-bar, line, multiline, area, pie, donut, radial, treemap, icicle, sankey, funnel, waterfall, scatter, boxplot, table, pivot, metric

## FILTER RULES
- filtersApplied is an array of filter objects on each widget
- Each filter: { field: "FIELD_NAME", operator: "<OP>", value: "single_value" } OR { field: "FIELD_NAME", operator: "IN", values: ["v1", "v2"] }
- Supported operators: "IN", "NOT IN", "=", "!=", ">", "<", ">=", "<=", "LIKE", "BETWEEN"
- Use "IN" with "values" array for multi-select filters
- Use other operators with a single "value" string
- BETWEEN uses "value" as "low_value" and "value2" as "high_value"
- ALWAYS include filtersApplied in your widget response when the user asks for filters

## SORT RULES
- sortsApplied is an array of sort objects on each widget
- Each sort: { field: "FIELD_NAME", direction: "ASC" | "DESC" }
- ALWAYS include sortsApplied in your widget response when the user asks for sorting

## FIELD RULES
- Dimensions: shelf "columns", semanticType "dimension", aggregation null
- Measures: shelf "rows", semanticType "measure", aggregation "SUM"/"AVG"/"COUNT"/"MIN"/"MAX"
- Marks: shelf "marks", markType "color"/"size"/"detail"/"tooltip"/"label"
- Any mark type can be assigned on columns or rows shelf; columns take precedence
- dataType: match the Snowflake column type (VARCHAR, NUMBER, DATE, etc.)

## CALCULATED FIELDS (customColumns)
- When a widget needs a derived value not available as a native field, create it via "customColumns"
- Each entry: { name: "FIELD_NAME", expression: "SQL expression referencing fields with [FIELD] syntax" }
- Examples: { name: "MARGIN", expression: "([REVENUE] - [COST]) / [REVENUE] * 100" }
- After creating, use the calculated field name in the fields array with isCustomColumn: true
- Set semanticType: "measure" for numeric, "dimension" for categorical
- Standard SQL functions are supported: YEAR(), MONTH(), CASE WHEN, CONCAT(), ROUND(), etc.

## CHART SELECTION
- metric: single KPI (1 measure, optional dimension)
- bar/stacked-bar/horizontal-bar/diverging-bar: category vs measure comparisons
- line/multiline: time series trends, continuous data
- area: volume trends over time
- pie/donut: part-of-whole (< 7 slices)
- radial: part-of-whole with radial layout
- treemap/icicle: hierarchical data
- sankey: flow between categories (2+ dimensions, 1 measure)
- funnel: conversion/pipeline stages
- waterfall: cumulative effect of sequential values
- scatter: relationship between two numeric values (supports color mark)
- boxplot: distribution across categories
- table: flat data table with all fields as columns
- pivot: matrix/cross-tab (column dimensions become headers, row dimensions become row labels)

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
    'waterfall', 'scatter', 'boxplot',
    'table', 'pivot', 'metric',
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
  if (!widget.customColumns) widget.customColumns = [];
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

// ============================================================================
// AGENT TOOL DEFINITIONS & EXECUTION
// ============================================================================

const AGENT_TOOLS = [
  {
    name: 'sample_data',
    description: 'Get sample rows from a semantic view to understand what the data looks like before building a chart. Returns up to `limit` rows with the specified fields.',
    parameters: {
      semanticView: 'string — Fully qualified semantic view name (DATABASE.SCHEMA.VIEW)',
      dimensions: 'string[] — Dimension field names to include',
      measures: 'string[] — Measure field names to include (optional)',
      limit: 'number — Max rows to return (default 5)',
    },
  },
  {
    name: 'check_cardinality',
    description: 'Get the number of distinct values for a dimension field. Use this to decide whether a field is suitable for a pie chart (< 7), color encoding (< 20), or should be filtered/aggregated.',
    parameters: {
      semanticView: 'string — Fully qualified semantic view name',
      field: 'string — Dimension field name to check',
    },
  },
  {
    name: 'test_query',
    description: 'Run a test query to verify that a combination of dimensions and measures returns data. Returns the row count and first few rows so you can confirm the chart will render.',
    parameters: {
      semanticView: 'string — Fully qualified semantic view name',
      dimensions: 'string[] — Dimension fields',
      measures: 'string[] — Measure fields with aggregations, e.g. [{"name":"REVENUE","aggregation":"SUM"}]',
      limit: 'number — Max rows (default 5)',
    },
  },
];

function buildToolPromptSection() {
  const toolDescriptions = AGENT_TOOLS.map(t => {
    const params = Object.entries(t.parameters)
      .map(([k, v]) => `    ${k}: ${v}`)
      .join('\n');
    return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
  }).join('\n\n');

  return `## TOOLS
You have access to tools that let you query actual data before building widgets.
Use tools when the user asks you to build charts — sampling the data first helps you pick the right chart type and field mappings.

Available tools:
${toolDescriptions}

## RESPONSE FORMAT (IMPORTANT)
You MUST respond with valid JSON. There are TWO response types:

### Type 1: Tool call (to query data before answering)
{
  "type": "tool_call",
  "tool": "<tool_name>",
  "args": { <tool parameters> },
  "thinking": "Brief explanation of why you're calling this tool"
}

### Type 2: Final answer (when you have enough information)
{
  "type": "answer",
  "message": "A short conversational explanation of what you did",
  "action": "none" | "add_widget" | "update_widget" | "remove_widget" | "replace_dashboard",
  "yaml": <the widget/dashboard object for the action, or null if action is "none">
}

RULES:
- You can make at most 4 tool calls per conversation turn. After that, give your best answer.
- Start with sample_data or check_cardinality when building new charts to understand the data.
- If a tool call fails, proceed with your best guess rather than retrying.
- For simple questions or modifications to existing widgets, skip tools and answer directly.
- When adding multiple widgets, use "add_widget" with an array of widget objects.
- Preserve widget IDs when updating. Only generate new IDs for new widgets.
- Be concise in your message. 1-2 sentences max.`;
}

async function executeAgentTool(connection, toolName, args) {
  const startTime = Date.now();
  try {
    switch (toolName) {
      case 'sample_data': {
        const { semanticView, dimensions = [], measures = [], limit = 5 } = args;
        if (!semanticView) return { error: 'semanticView is required' };
        if (dimensions.length === 0 && measures.length === 0) {
          return { error: 'At least one dimension or measure is required' };
        }
        const normalizedMeasures = measures.map(m =>
          typeof m === 'string' ? { name: m, aggregation: 'SUM' } : m
        );
        const sql = buildQueryDirect({
          semanticViewFQN: semanticView,
          dimensions,
          measures: normalizedMeasures,
          limit: Math.min(parseInt(limit) || 5, 20),
        });
        const rows = await executeQuery(connection, sql);
        return {
          rowCount: rows.length,
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          data: rows.slice(0, Math.min(parseInt(limit) || 5, 20)),
          executionTime: Date.now() - startTime,
        };
      }

      case 'check_cardinality': {
        const { semanticView, field } = args;
        if (!semanticView || !field) return { error: 'semanticView and field are required' };
        const sql = `SELECT COUNT(DISTINCT "${field}") AS DISTINCT_COUNT FROM SEMANTIC_VIEW(${semanticView} DIMENSIONS ${field}) WHERE "${field}" IS NOT NULL LIMIT 1`;
        const rows = await executeQuery(connection, sql);
        const count = rows[0]?.DISTINCT_COUNT ?? rows[0]?.distinct_count ?? 0;
        return {
          field,
          distinctCount: count,
          recommendation: count <= 6 ? 'Good for pie/donut charts'
            : count <= 15 ? 'Good for bar charts, color encoding'
            : count <= 50 ? 'Consider filtering or using table/treemap'
            : 'High cardinality — use table, filter, or aggregate',
          executionTime: Date.now() - startTime,
        };
      }

      case 'test_query': {
        const { semanticView, dimensions = [], measures = [], limit = 5 } = args;
        if (!semanticView) return { error: 'semanticView is required' };
        if (dimensions.length === 0 && measures.length === 0) {
          return { error: 'At least one dimension or measure is required' };
        }
        const normalizedMeasures = measures.map(m =>
          typeof m === 'string' ? { name: m, aggregation: 'SUM' } : m
        );
        const sql = buildQueryDirect({
          semanticViewFQN: semanticView,
          dimensions,
          measures: normalizedMeasures,
          limit: Math.min(parseInt(limit) || 5, 10),
        });
        const rows = await executeQuery(connection, sql);
        return {
          success: rows.length > 0,
          rowCount: rows.length,
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          sampleRows: rows.slice(0, 3),
          sql: sql.substring(0, 300),
          executionTime: Date.now() - startTime,
        };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return {
      error: err.message || 'Tool execution failed',
      executionTime: Date.now() - startTime,
    };
  }
}

const MAX_AGENT_ITERATIONS = 4;

const CHAT_SYSTEM_PROMPT = `You are an AI assistant embedded in the Simply Analytics dashboard editor.
You help users build and modify dashboards through conversation. You have full context of the current dashboard state.

${DASHBOARD_SCHEMA_PROMPT.replace('## RESPONSE FORMAT\nRespond with ONLY valid YAML. No markdown code fences, no explanations, no extra text.\nThe YAML must be parseable by js-yaml. Use proper indentation (2 spaces).', '')}

${buildToolPromptSection()}

Actions for "action" field:
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

async function callCortex(connection, llmMessages, model, maxTokens) {
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

  return response
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

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

  const toolSteps = [];
  let iteration = 0;

  while (iteration < MAX_AGENT_ITERATIONS) {
    iteration++;

    const rawResponse = await callCortex(connection, llmMessages, model, maxTokens);

    let parsed;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      return {
        message: rawResponse,
        action: 'none',
        yaml: null,
        toolSteps,
      };
    }

    if (parsed.type === 'tool_call' && parsed.tool) {
      const toolStep = {
        tool: parsed.tool,
        args: parsed.args || {},
        thinking: parsed.thinking || '',
      };

      const toolResult = await executeAgentTool(connection, parsed.tool, parsed.args || {});
      toolStep.result = toolResult;
      toolSteps.push(toolStep);

      const resultStr = JSON.stringify(toolResult, null, 2);
      const truncatedResult = resultStr.length > 3000
        ? resultStr.substring(0, 3000) + '\n... (truncated)'
        : resultStr;

      llmMessages.push({
        role: 'assistant',
        content: JSON.stringify({ type: 'tool_call', tool: parsed.tool, args: parsed.args, thinking: parsed.thinking }),
      });
      llmMessages.push({
        role: 'user',
        content: `Tool result for ${parsed.tool}:\n${truncatedResult}\n\nContinue. You have ${MAX_AGENT_ITERATIONS - iteration} tool calls remaining. Respond with another tool_call or your final answer.`,
      });

      continue;
    }

    const finalParsed = parsed.type === 'answer' ? parsed : parsed;

    if (finalParsed.action === 'replace_dashboard' && finalParsed.yaml) {
      finalParsed.yaml = validateAndNormalizeDashboard(finalParsed.yaml);
    } else if (finalParsed.action === 'add_widget' && finalParsed.yaml) {
      if (Array.isArray(finalParsed.yaml)) {
        finalParsed.yaml = finalParsed.yaml.map(w => validateAndNormalizeWidget(w));
      } else {
        finalParsed.yaml = validateAndNormalizeWidget(finalParsed.yaml);
      }
    } else if (finalParsed.action === 'update_widget' && finalParsed.yaml?.widget) {
      finalParsed.yaml.widget = validateAndNormalizeWidget(finalParsed.yaml.widget);
    }

    return {
      message: finalParsed.message || 'Done.',
      action: finalParsed.action || 'none',
      yaml: finalParsed.yaml || null,
      toolSteps,
    };
  }

  return {
    message: 'I ran out of tool calls. Please try rephrasing your request.',
    action: 'none',
    yaml: null,
    toolSteps,
  };
}

export default {
  generateDashboard,
  generateWidget,
  modifyDashboard,
  chatWithDashboard,
};
