/**
 * Dashboard AI — agent tool definitions & execution
 *
 * OpenAI-format tool schemas (sample_data, check_cardinality, test_query)
 * and the functions that execute them against a Snowflake connection.
 */

import { buildQueryDirect } from '../../utils/queryBuilder.js';
import { executeQuery as _execQuery } from '../../db/dashboardSessionManager.js';

// ---------------------------------------------------------------------------
// Tool schema definitions (OpenAI function-calling format)
// ---------------------------------------------------------------------------

export const NATIVE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'sample_data',
      description: 'Get sample rows from a semantic view to understand what the data looks like before building a chart. Returns up to `limit` rows with the specified fields. Use filters to narrow down results.',
      parameters: {
        type: 'object',
        properties: {
          semanticView: { type: 'string', description: 'Fully qualified semantic view name (DATABASE.SCHEMA.VIEW)' },
          dimensions: { type: 'array', items: { type: 'string' }, description: 'Dimension field names to include' },
          measures: { type: 'array', items: { type: 'string' }, description: 'Measure field names to include (optional)' },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                operator: { type: 'string', enum: ['=', '!=', '>', '<', '>=', '<=', 'IN', 'NOT IN', 'LIKE', 'BETWEEN'] },
                value: { description: 'Filter value (use with most operators and as start value for BETWEEN)' },
                value2: { description: 'End value for BETWEEN operator' },
                values: { type: 'array', description: 'Array of values for IN/NOT IN operators' },
              },
              required: ['field', 'operator'],
            },
            description: 'Filters to apply. For dates use BETWEEN with date strings e.g. {"field":"ORDER_DATE","operator":"BETWEEN","value":"1998-01-01","value2":"1998-12-31"}',
          },
          limit: { type: 'number', description: 'Max rows to return (default 5)' },
        },
        required: ['semanticView', 'dimensions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_cardinality',
      description: 'Get the number of distinct values for a dimension field. Use this to decide whether a field is suitable for a pie chart (< 7), color encoding (< 20), or should be filtered/aggregated.',
      parameters: {
        type: 'object',
        properties: {
          semanticView: { type: 'string', description: 'Fully qualified semantic view name' },
          field: { type: 'string', description: 'Dimension field name to check' },
        },
        required: ['semanticView', 'field'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'test_query',
      description: 'Run a test query to verify that a combination of dimensions and measures returns data. Returns the row count and first few rows so you can confirm the chart will render.',
      parameters: {
        type: 'object',
        properties: {
          semanticView: { type: 'string', description: 'Fully qualified semantic view name' },
          dimensions: { type: 'array', items: { type: 'string' }, description: 'Dimension fields' },
          measures: { type: 'array', items: {}, description: 'Measure fields with aggregations, e.g. [{"name":"REVENUE","aggregation":"SUM"}]' },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                operator: { type: 'string', enum: ['=', '!=', '>', '<', '>=', '<=', 'IN', 'NOT IN', 'LIKE', 'BETWEEN'] },
                value: { description: 'Filter value (use with most operators and as start value for BETWEEN)' },
                value2: { description: 'End value for BETWEEN operator' },
                values: { type: 'array', description: 'Array of values for IN/NOT IN operators' },
              },
              required: ['field', 'operator'],
            },
            description: 'Filters to apply. For dates use BETWEEN with date strings',
          },
          limit: { type: 'number', description: 'Max rows (default 5)' },
        },
        required: ['semanticView', 'dimensions'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool labels (human-readable descriptions for UI progress indicators)
// ---------------------------------------------------------------------------

export const TOOL_LABELS = {
  sample_data: 'Sampling data',
  check_cardinality: 'Checking cardinality',
  test_query: 'Testing query',
};

// ---------------------------------------------------------------------------
// Query execution helper — routes through the shared semaphore (ai lane)
// ---------------------------------------------------------------------------

async function executeQuery(connection, sql) {
  const result = await _execQuery(connection, sql, [], { lane: 'ai' });
  return result.rows;
}

// ---------------------------------------------------------------------------
// Single tool executor
// ---------------------------------------------------------------------------

export async function executeAgentTool(connection, toolName, args) {
  console.log(`[executeAgentTool] ${toolName}`, JSON.stringify(args));
  const startTime = Date.now();

  try {
    switch (toolName) {
      case 'sample_data': {
        const { semanticView, dimensions = [], measures = [], filters = [], limit = 5 } = args;
        if (!semanticView) return { error: 'semanticView is required' };
        if (dimensions.length === 0 && measures.length === 0) {
          return { error: 'At least one dimension or measure is required' };
        }
        const normalizedMeasures = measures.map(m =>
          typeof m === 'string' ? { name: m, aggregation: 'SUM' } : m,
        );
        const sql = buildQueryDirect({
          semanticViewFQN: semanticView,
          dimensions,
          measures: normalizedMeasures,
          filters: filters.map(f => ({ field: f.field, operator: f.operator || '=', value: f.value, value2: f.value2, values: f.values })),
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
          recommendation: count <= 6 ? 'Low cardinality — good for pie/donut'
            : count <= 15 ? 'Medium cardinality — good for bar charts, color encoding'
            : count <= 50 ? 'High cardinality — consider horizontal-bar, treemap, or filtering'
            : 'Very high cardinality — use table, filter, or aggregate',
          executionTime: Date.now() - startTime,
        };
      }

      case 'test_query': {
        const { semanticView, dimensions = [], measures = [], filters = [], limit = 5 } = args;
        if (!semanticView) return { error: 'semanticView is required' };
        if (dimensions.length === 0 && measures.length === 0) {
          return { error: 'At least one dimension or measure is required' };
        }
        const normalizedMeasures = measures.map(m =>
          typeof m === 'string' ? { name: m, aggregation: 'SUM' } : m,
        );
        const sql = buildQueryDirect({
          semanticViewFQN: semanticView,
          dimensions,
          measures: normalizedMeasures,
          filters: filters.map(f => ({ field: f.field, operator: f.operator || '=', value: f.value, value2: f.value2, values: f.values })),
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
    return { error: err.message || 'Tool execution failed', executionTime: Date.now() - startTime };
  }
}

// ---------------------------------------------------------------------------
// Batch tool-call executor (runs calls in parallel)
// ---------------------------------------------------------------------------

export async function executeToolCalls(connection, toolCalls, onToolStep) {
  const toolSteps = [];
  const results = await Promise.all(
    toolCalls.map(async (tc) => {
      const fnName = tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments); } catch { /* empty args */ }
      const thinking = TOOL_LABELS[fnName] || `Running ${fnName}`;
      const step = { tool: fnName, args, thinking };
      if (onToolStep) onToolStep(step);
      const result = await executeAgentTool(connection, fnName, args);
      step.result = result;
      toolSteps.push(step);
      return { tool_call_id: tc.id, role: 'tool', content: JSON.stringify(result) };
    }),
  );
  return { toolMessages: results, toolSteps };
}
