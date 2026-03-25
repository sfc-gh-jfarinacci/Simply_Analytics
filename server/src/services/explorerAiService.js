import { buildQueryDirect } from '../utils/queryBuilder.js';

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

function escapeForSnowflake(str) {
  return str.replace(/'/g, "''");
}

const EXPLORER_SYSTEM_PROMPT = `You are a data analyst AI embedded in Simply Analytics.
The user asks business questions and you investigate the data to answer them.

## TOOLS
You have tools to query data:

- query_data: Run a query against a semantic view. Returns rows of data.
  Parameters: { semanticView: string, dimensions: string[], measures: [{name, aggregation}], filters: [{field, operator, value}], limit: number }

- check_cardinality: Count distinct values for a field.
  Parameters: { semanticView: string, field: string }

## RESPONSE FORMAT
Respond with valid JSON. Two types:

### Type 1: Tool call
{
  "type": "tool_call",
  "tool": "query_data" | "check_cardinality",
  "args": { ... },
  "thinking": "Why you're making this query"
}

### Type 2: Final answer
{
  "type": "answer",
  "summary": "A clear, concise answer to the user's question (2-5 sentences)",
  "findings": [
    { "label": "Finding title", "detail": "Detail text", "type": "insight" | "trend" | "anomaly" | "comparison" }
  ],
  "suggestedWidget": null | {
    "title": "Widget title",
    "type": "bar" | "line" | "pie" | ...,
    "semanticView": "DB.SCHEMA.VIEW",
    "fields": [
      { "name": "FIELD", "shelf": "columns" | "rows", "semanticType": "dimension" | "measure", "aggregation": null | "SUM" | "AVG" | ... }
    ]
  }
}

RULES:
- Maximum 4 tool calls per question. Then give your best answer.
- Always query real data before making claims about numbers or trends.
- suggestedWidget should only be included when the data tells an interesting story worth visualizing.
- Be precise with numbers. Don't make up values.
- findings should be 2-4 items max, each a distinct observation.`;

const MAX_ITERATIONS = 4;

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
  model = 'claude-3-5-sonnet',
  maxTokens = 4096,
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

  const toolSteps = [];
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

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
    if (typeof response !== 'string') response = JSON.stringify(response);

    const cleaned = response
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { summary: cleaned, findings: [], toolSteps, suggestedWidget: null };
    }

    if (parsed.type === 'tool_call' && parsed.tool) {
      const toolStep = {
        tool: parsed.tool,
        args: parsed.args || {},
        thinking: parsed.thinking || '',
      };

      const toolResult = await executeExplorerTool(connection, parsed.tool, parsed.args || {});
      toolStep.result = toolResult;
      toolSteps.push(toolStep);

      const resultStr = JSON.stringify(toolResult, null, 2);
      const truncated = resultStr.length > 4000
        ? resultStr.substring(0, 4000) + '\n... (truncated)'
        : resultStr;

      llmMessages.push({
        role: 'assistant',
        content: JSON.stringify({ type: 'tool_call', tool: parsed.tool, args: parsed.args, thinking: parsed.thinking }),
      });
      llmMessages.push({
        role: 'user',
        content: `Tool result for ${parsed.tool}:\n${truncated}\n\nContinue investigating. ${MAX_ITERATIONS - iteration} tool calls remaining. Respond with another tool_call or your final answer.`,
      });
      continue;
    }

    return {
      summary: parsed.summary || parsed.message || cleaned,
      findings: parsed.findings || [],
      suggestedWidget: parsed.suggestedWidget || null,
      toolSteps,
    };
  }

  return {
    summary: 'Reached the analysis limit. Here is what I found so far.',
    findings: [],
    suggestedWidget: null,
    toolSteps,
  };
}

export default { exploreData };
