import { buildQueryDirect } from '../utils/queryBuilder.js';
import { complete as llmComplete, stripCodeFences } from './llmProvider.js';
import { executeQuery as _execQuery } from '../db/dashboardSessionManager.js';

async function executeQuery(connection, sql) {
  const result = await _execQuery(connection, sql, [], { lane: 'ai' });
  return result.rows;
}

const EXPLORER_NATIVE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_data',
      description: 'Run a query against a semantic view. Returns rows of data.',
      parameters: {
        type: 'object',
        properties: {
          semanticView: { type: 'string', description: 'Fully qualified semantic view name (DATABASE.SCHEMA.VIEW)' },
          dimensions: { type: 'array', items: { type: 'string' }, description: 'Dimension field names' },
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
            description: 'Filters. For dates use BETWEEN: {"field":"ORDER_DATE","operator":"BETWEEN","value":"1998-01-01","value2":"1998-12-31"}'
          },
          limit: { type: 'number', description: 'Max rows to return (default 20)' },
        },
        required: ['semanticView'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_cardinality',
      description: 'Count distinct values for a dimension field.',
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
];

const EXPLORER_SYSTEM_PROMPT = `You are a data analyst AI embedded in Simply Analytics.
The user asks business questions and you investigate the data to answer them.

## TOOL USAGE
You have tools to query data:
- query_data(semanticView, dimensions?, measures?, filters?, limit?) — run a query and get rows
- check_cardinality(semanticView, field) — count distinct values for a field

All tools support a "filters" array: [{"field":"X","operator":"=","value":"Y"}]
For date filtering by year, use BETWEEN: {"field":"ORDER_DATE","operator":"BETWEEN","value":"1998-01-01","value2":"1998-12-31"}
NEVER use LIKE on date fields — always use BETWEEN or >= / < with date strings.

You can call multiple tools in parallel to speed up analysis.
Always query real data before making claims about numbers or trends.
TRUST the data returned by tools — never question, doubt, or second-guess tool results.

## RESPONSE FORMAT
After gathering data, respond with valid JSON:
{
  "summary": "A clear, concise answer to the user's question (2-5 sentences)",
  "findings": [
    { "label": "Finding title", "detail": "Detail text", "type": "insight" | "trend" | "anomaly" | "comparison" }
  ],
  "suggestedWidget": null | { "title": "...", "type": "bar"|"line"|..., "semanticView": "...", "fields": [...] }
}

RULES:
- Be precise with numbers. Don't make up values.
- findings should be 2-4 items max, each a distinct observation.
- suggestedWidget only when the data tells an interesting story worth visualizing.
- Respond with ONLY valid JSON. No text before or after.`;

const MAX_TOOL_ROUNDS = 5;

async function executeExplorerTool(connection, toolName, args) {
  const startTime = Date.now();
  try {
    switch (toolName) {
      case 'query_data': {
        const { semanticView, dimensions = [], measures = [], filters = [], limit = 20 } = args;
        if (!semanticView) return { error: 'semanticView is required' };
        const normalizedMeasures = measures.map(m =>
          typeof m === 'string' ? { name: m, aggregation: 'SUM' } : m
        );
        const sql = buildQueryDirect({
          semanticViewFQN: semanticView,
          dimensions,
          measures: normalizedMeasures,
          filters: filters.map(f => ({
            field: f.field,
            operator: f.operator || '=',
            value: f.value,
            value2: f.value2,
            values: f.values,
          })),
          limit: Math.min(parseInt(limit) || 20, 50),
        });
        const rows = await executeQuery(connection, sql);
        return {
          rowCount: rows.length,
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          data: rows,
          executionTime: Date.now() - startTime,
        };
      }

      case 'check_cardinality': {
        const { semanticView, field } = args;
        if (!semanticView || !field) return { error: 'semanticView and field are required' };
        const sql = `SELECT COUNT(DISTINCT "${field}") AS DISTINCT_COUNT FROM SEMANTIC_VIEW(${semanticView} DIMENSIONS ${field}) WHERE "${field}" IS NOT NULL LIMIT 1`;
        const rows = await executeQuery(connection, sql);
        return {
          field,
          distinctCount: rows[0]?.DISTINCT_COUNT ?? rows[0]?.distinct_count ?? 0,
          executionTime: Date.now() - startTime,
        };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: err.message, executionTime: Date.now() - startTime };
  }
}

export async function exploreData(connection, {
  question,
  semanticViewMetadata,
  conversationHistory = [],
  model = 'claude-sonnet-4-6',
  maxTokens = 4096,
  provider,
  apiKey,
  endpointUrl,
  connWithCreds,
}) {
  const viewContext = (Array.isArray(semanticViewMetadata) ? semanticViewMetadata : [semanticViewMetadata])
    .filter(Boolean)
    .map(v => {
      const lines = [`Semantic View: ${v.fullyQualifiedName || v.name}`];
      if (v.dimensions?.length) {
        const dims = v.dimensions.map(d => typeof d === 'string' ? d : d.name);
        lines.push(`Dimensions: ${dims.join(', ')}`);
      }
      if (v.measures?.length) {
        const meas = v.measures.map(m => typeof m === 'string' ? m : m.name);
        lines.push(`Measures: ${meas.join(', ')}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  const systemContent = `${EXPLORER_SYSTEM_PROMPT}\n\n## AVAILABLE DATA\n${viewContext}`;

  const llmMessages = [
    { role: 'system', content: systemContent },
    ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];

  const allToolSteps = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;

    const msgs = (isLastRound && allToolSteps.length > 0)
      ? [...llmMessages, { role: 'user', content: 'You have gathered enough data. Now provide your final answer as JSON. Do NOT call any more tools.' }]
      : llmMessages;

    const rawResponse = await llmComplete({
      messages: msgs,
      model, maxTokens, temperature: 0.3,
      provider, apiKey, connWithCreds, endpointUrl,
      tools: EXPLORER_NATIVE_TOOLS,
    });

    if (typeof rawResponse === 'object' && rawResponse.tool_calls?.length) {
      llmMessages.push({ role: 'assistant', content: null, tool_calls: rawResponse.tool_calls });
      const toolResults = await Promise.all(
        rawResponse.tool_calls.map(async (tc) => {
          const fnName = tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }
          const result = await executeExplorerTool(connection, fnName, args);
          allToolSteps.push({ tool: fnName, args, thinking: '', result });
          return { tool_call_id: tc.id, role: 'tool', content: JSON.stringify(result) };
        })
      );
      llmMessages.push(...toolResults);
      continue;
    }

    const cleaned = stripCodeFences(typeof rawResponse === 'string' ? rawResponse : (rawResponse.content || ''));
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch { return { summary: cleaned, findings: [], toolSteps: allToolSteps, suggestedWidget: null }; }

    return {
      summary: parsed.summary || parsed.message || cleaned,
      findings: parsed.findings || [],
      suggestedWidget: parsed.suggestedWidget || null,
      toolSteps: allToolSteps,
    };
  }

  return { summary: 'Reached the analysis limit. Here is what I found so far.', findings: [], suggestedWidget: null, toolSteps: allToolSteps };
}

export default { exploreData };
