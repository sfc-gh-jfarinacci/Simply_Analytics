/**
 * MCP Service — communicates with Snowflake-managed MCP servers via JSON-RPC.
 *
 * Snowflake MCP endpoint: POST /api/v2/databases/{db}/schemas/{schema}/mcp-servers/{name}
 * Supported methods: tools/list, tools/call
 * Protocol revision: 2025-06-18
 */

function parseFqn(mcpServerFqn) {
  const parts = mcpServerFqn.split('.');
  if (parts.length !== 3) {
    throw new Error('MCP server FQN must be DATABASE.SCHEMA.SERVER_NAME');
  }
  return { database: parts[0], schema: parts[1], serverName: parts[2] };
}

function buildMcpUrl(account, mcpServerFqn) {
  const { database, schema, serverName } = parseFqn(mcpServerFqn);
  return `https://${account}.snowflakecomputing.com/api/v2/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/mcp-servers/${encodeURIComponent(serverName)}`;
}

let requestIdCounter = 1;

/**
 * Discover available tools on a Snowflake managed MCP server.
 */
export async function listTools(account, authHeaders, mcpServerFqn) {
  const url = buildMcpUrl(account, mcpServerFqn);
  const body = {
    jsonrpc: '2.0',
    id: requestIdCounter++,
    method: 'tools/list',
    params: {},
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`MCP tools/list failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`MCP tools/list error: ${json.error.message || JSON.stringify(json.error)}`);
  }

  return json.result?.tools || [];
}

/**
 * Invoke a tool on a Snowflake managed MCP server.
 */
export async function callTool(account, authHeaders, mcpServerFqn, toolName, args) {
  const url = buildMcpUrl(account, mcpServerFqn);
  const body = {
    jsonrpc: '2.0',
    id: requestIdCounter++,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args || {},
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`MCP tools/call failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`MCP tools/call error: ${json.error.message || JSON.stringify(json.error)}`);
  }

  return json.result;
}

/**
 * Format discovered tools into a system prompt section for Cortex COMPLETE.
 */
export function buildToolSystemPrompt(tools) {
  if (!tools.length) return 'No tools are available.';

  const toolDescriptions = tools.map(t => {
    let desc = `- **${t.name}**: ${t.description || 'No description'}`;
    if (t.inputSchema?.properties) {
      const params = Object.entries(t.inputSchema.properties)
        .map(([k, v]) => `    ${k} (${v.type || 'any'}): ${v.description || ''}`)
        .join('\n');
      if (params) desc += `\n  Parameters:\n${params}`;
    }
    return desc;
  }).join('\n\n');

  return toolDescriptions;
}

/**
 * Extract text content from an MCP tool result.
 */
export function extractToolResultText(result) {
  if (!result) return 'No result returned.';
  if (result.content) {
    return result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  }
  if (result.results) {
    return JSON.stringify(result.results, null, 2);
  }
  return JSON.stringify(result, null, 2);
}

/**
 * Normalize a tool result into structured components for chart-aware processing.
 * Parses text, tabular data, SQL, and determines self-sufficiency.
 */
export function normalizeToolResult(result) {
  const text = extractToolResultText(result);
  let data = null;
  let columns = [];
  let sql = null;
  let isSelfSufficient = false;

  // Try to extract tabular data from the result
  if (result?.content) {
    for (const block of result.content) {
      if (block.type === 'text' && block.text) {
        // Try parsing JSON arrays embedded in text
        if (!data) {
          data = tryParseJsonArray(block.text);
          if (data && data.length > 0) {
            columns = Object.keys(data[0]);
          }
        }
        // Extract SQL statements
        if (!sql) {
          sql = extractSql(block.text);
        }
      }
    }
  }

  // Fallback: try parsing the entire text as JSON
  if (!data) {
    data = tryParseJsonArray(text);
    if (data && data.length > 0) {
      columns = Object.keys(data[0]);
    }
  }

  if (!sql) {
    sql = extractSql(text);
  }

  // Also check result.results directly
  if (!data && result?.results) {
    if (Array.isArray(result.results) && result.results.length > 0 && typeof result.results[0] === 'object') {
      data = result.results;
      columns = Object.keys(data[0]);
    }
  }

  // Self-sufficiency: has both meaningful narrative and structured data
  const hasNarrative = text.length > 100 && !/^\s*[\[{]/.test(text.trim());
  const hasData = data && data.length > 0;
  isSelfSufficient = hasNarrative && hasData;

  return { text, sql, data, columns, isSelfSufficient };
}

function tryParseJsonArray(text) {
  if (!text) return null;
  // Look for JSON array patterns in the text
  const arrayMatch = text.match(/\[[\s\S]*?\{[\s\S]*?\}[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        return parsed;
      }
    } catch { /* not valid JSON */ }
  }
  // Try parsing the whole text as JSON
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      return parsed;
    }
  } catch { /* not JSON */ }
  return null;
}

function extractSql(text) {
  if (!text) return null;
  const sqlMatch = text.match(/```sql\s*\n([\s\S]*?)\n```/i);
  if (sqlMatch) return sqlMatch[1].trim();
  const selectMatch = text.match(/(SELECT\s[\s\S]*?(?:;|$))/i);
  if (selectMatch) return selectMatch[1].trim();
  return null;
}

/**
 * Heuristic chart type detection based on column metadata and data shape.
 * Returns a widget YAML object or null if no chart is appropriate.
 */
export function detectChartHeuristic(columns, data) {
  if (!columns || columns.length === 0 || !data || data.length === 0) return null;

  // Single row, single numeric column -> metric
  if (data.length === 1 && columns.length === 1) {
    const val = data[0][columns[0]];
    if (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)))) {
      return buildWidgetYaml('metric', columns[0], columns, data);
    }
  }

  // Classify columns as dimension or measure
  const dims = [];
  const measures = [];
  for (const col of columns) {
    const sample = data[0][col];
    const isNumeric = typeof sample === 'number' || (typeof sample === 'string' && !isNaN(Number(sample)) && sample.trim() !== '');
    if (isNumeric && !isDateLike(col)) {
      measures.push(col);
    } else {
      dims.push(col);
    }
  }

  // Single KPI: 1 row, 1 measure, 0-1 dims
  if (data.length === 1 && measures.length === 1 && dims.length <= 1) {
    return buildWidgetYaml('metric', measures[0], columns, data);
  }

  // No measures or no dims -> table
  if (measures.length === 0 || dims.length === 0) {
    return buildWidgetYaml('table', null, columns, data);
  }

  const dim = dims[0];
  const measure = measures[0];
  const uniqueVals = new Set(data.map(r => r[dim]));

  // Time series detection
  if (isDateLike(dim)) {
    return buildWidgetYaml('line', measure, columns, data, dim);
  }

  // Geographic detection
  if (isGeoLike(dim)) {
    return buildWidgetYaml('choropleth', measure, columns, data, dim);
  }

  // Category comparison
  if (uniqueVals.size <= 6) {
    return buildWidgetYaml('bar', measure, columns, data, dim);
  }
  if (uniqueVals.size <= 20) {
    return buildWidgetYaml('horizontal-bar', measure, columns, data, dim);
  }

  return buildWidgetYaml('table', null, columns, data);
}

function isDateLike(colName) {
  const lower = colName.toLowerCase();
  return /date|time|month|year|quarter|week|day|period|timestamp/.test(lower);
}

function isGeoLike(colName) {
  const lower = colName.toLowerCase();
  return /country|nation|state|region|territory|province|continent|city|county|geography|geo/.test(lower);
}

function buildWidgetYaml(chartType, measureCol, columns, data, dimCol) {
  const id = `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const fields = [];

  if (chartType === 'metric') {
    fields.push({
      name: measureCol,
      shelf: 'rows',
      dataType: 'NUMBER',
      semanticType: 'measure',
      aggregation: 'SUM',
    });
  } else if (chartType === 'table') {
    for (const col of columns) {
      const sample = data[0]?.[col];
      const isNum = typeof sample === 'number' || (typeof sample === 'string' && !isNaN(Number(sample)) && sample.trim() !== '');
      fields.push({
        name: col,
        shelf: isNum ? 'rows' : 'columns',
        dataType: isNum ? 'NUMBER' : 'VARCHAR',
        semanticType: isNum ? 'measure' : 'dimension',
        aggregation: isNum ? 'SUM' : null,
      });
    }
  } else {
    if (dimCol) {
      fields.push({
        name: dimCol,
        shelf: 'columns',
        dataType: isDateLike(dimCol) ? 'DATE' : 'VARCHAR',
        semanticType: 'dimension',
        aggregation: null,
      });
    }
    if (measureCol) {
      fields.push({
        name: measureCol,
        shelf: 'rows',
        dataType: 'NUMBER',
        semanticType: 'measure',
        aggregation: 'SUM',
      });
    }
  }

  const title = measureCol
    ? `${measureCol.replace(/_/g, ' ')}${dimCol ? ` by ${dimCol.replace(/_/g, ' ')}` : ''}`
    : 'Query Results';

  return {
    id,
    title,
    type: chartType,
    fields,
    position: { x: 0, y: 0, w: 6, h: 4, minW: 2, minH: 2 },
    config: { showTitle: true, titlePosition: 'top-left', colorScheme: 'tableau10' },
    filtersApplied: [],
    sortsApplied: [],
    customColumns: [],
    marks: {},
    chartQuery: {},
  };
}

export default {
  listTools,
  callTool,
  buildToolSystemPrompt,
  extractToolResultText,
  normalizeToolResult,
  detectChartHeuristic,
  parseFqn,
};
