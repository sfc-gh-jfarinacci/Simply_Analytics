/**
 * Cortex AI routes — LLM completion, natural-language ask, insights,
 * sentiment, summarize, translate, and model listing.
 */

import { Router } from 'express';
import { complete as llmComplete } from '../../services/llmProvider.js';
import {
  resolveConnWithCredsFromReq,
  getSnowflakeConnectionFromId,
  executeUserQuery,
  escapeString,
} from '../../services/semanticService.js';

export const cortexRouter = Router();

// ---------------------------------------------------------------------------
// POST /complete — generic LLM text generation
// ---------------------------------------------------------------------------

cortexRouter.post('/complete', async (req, res) => {
  try {
    const {
      prompt, model = 'claude-sonnet-4-6', temperature = 0.7, maxTokens = 1024,
      systemPrompt = null, provider: reqProvider, apiKey: reqApiKey, endpointUrl: reqEndpointUrl,
    } = req.body;

    const provider = reqProvider || 'cortex';
    if (provider === 'cortex' && !req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const connWithCreds = await resolveConnWithCredsFromReq(req);
    const startTime = Date.now();
    const response = await llmComplete({
      messages, model, maxTokens, temperature,
      provider, apiKey: reqApiKey, connWithCreds, endpointUrl: reqEndpointUrl,
    });
    const executionTime = Date.now() - startTime;

    res.json({
      response: typeof response === 'string' ? response : JSON.stringify(response),
      model, executionTime,
    });
  } catch (error) {
    console.error('LLM COMPLETE error:', error);
    res.status(500).json({ error: error.message || 'LLM COMPLETE failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /ask — natural-language → semantic view query params
// ---------------------------------------------------------------------------

cortexRouter.post('/ask', async (req, res) => {
  try {
    const {
      question, semanticView, semanticViewSchema, model = 'claude-sonnet-4-6',
      provider: reqProvider, apiKey: reqApiKey, endpointUrl: reqEndpointUrl,
    } = req.body;

    const provider = reqProvider || 'cortex';
    if (provider === 'cortex' && !req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }
    if (!question || !semanticView) {
      return res.status(400).json({ error: 'Question and semanticView are required' });
    }

    const systemPrompt = `You are a SQL query generator for Snowflake Semantic Views.
Given a natural language question, generate the appropriate query parameters for the SEMANTIC_VIEW function.

The semantic view is: ${semanticView}

Available fields:
- Dimensions: ${semanticViewSchema?.dimensions?.map(d => d.name || d).join(', ') || 'unknown'}
- Measures: ${semanticViewSchema?.measures?.map(m => m.name || m).join(', ') || 'unknown'}

Respond with ONLY a valid JSON object in this exact format:
{
  "dimensions": ["field1", "field2"],
  "measures": ["measure1"],
  "filters": [{"field": "fieldName", "operator": "=", "value": "value"}],
  "orderBy": [{"field": "field1", "direction": "DESC"}],
  "limit": 1000000,
  "explanation": "Brief explanation of what this query does"
}

Only include fields that are relevant to the question. Use valid operator values: =, !=, <, >, <=, >=, IN, LIKE, IS NULL, IS NOT NULL.
Do not include any other text, markdown, or code blocks - just the raw JSON.`;

    const connWithCreds = await resolveConnWithCredsFromReq(req);
    const startTime = Date.now();
    const responseText = await llmComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      model, maxTokens: 1024, temperature: 0.3,
      provider, apiKey: reqApiKey, connWithCreds, endpointUrl: reqEndpointUrl,
    });
    const executionTime = Date.now() - startTime;

    let queryParams;
    try {
      const textToParse = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
      const jsonMatch = textToParse.match(/\{[\s\S]*\}/);
      if (jsonMatch) queryParams = JSON.parse(jsonMatch[0]);
      else throw new Error('No JSON found in response');
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
      return res.json({ success: false, error: 'Could not parse AI response into query parameters', rawResponse: responseText, executionTime });
    }

    res.json({ success: true, queryParams, explanation: queryParams.explanation, executionTime });
  } catch (error) {
    console.error('Cortex ASK error:', error);
    res.status(500).json({ error: error.message || 'Cortex ASK failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /insights — AI insights about query results
// ---------------------------------------------------------------------------

cortexRouter.post('/insights', async (req, res) => {
  let tempConnection = null;

  try {
    const {
      data, query, semanticView, model = 'claude-sonnet-4-6',
      connectionId, role, warehouse,
      provider: reqProvider, apiKey: reqApiKey, endpointUrl: reqEndpointUrl,
    } = req.body;

    const provider = reqProvider || 'cortex';
    let connection = req.snowflakeConnection;

    if (provider === 'cortex' && connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(connectionId, req.user.id, req.user.sessionId, { role, warehouse });
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({ error: 'Failed to connect: ' + connError.message, code: 'CONNECTION_ERROR' });
      }
    }

    if (provider === 'cortex' && !connection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }
    if (!data || data.length === 0) {
      return res.status(400).json({ error: 'Data is required for insights' });
    }

    const sampleData = data.slice(0, 50);

    const systemPrompt = `You are a data analyst assistant. Analyze the following query results and provide actionable insights.

Query: ${query || 'Data query'}
Semantic View: ${semanticView || 'Dashboard data'}

Provide insights in this format:
1. Key Findings (2-3 bullet points)
2. Trends or Patterns (if applicable)
3. Recommendations (1-2 actionable items)

Be concise and focus on business-relevant observations.`;

    const connWithCreds = await resolveConnWithCredsFromReq(req);
    const startTime = Date.now();
    const response = await llmComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this data:\n${JSON.stringify(sampleData, null, 2)}` },
      ],
      model, maxTokens: 1024, temperature: 0.5,
      provider, apiKey: reqApiKey, connWithCreds, endpointUrl: reqEndpointUrl,
    });
    const executionTime = Date.now() - startTime;

    res.json({ insights: response, dataRowsAnalyzed: sampleData.length, executionTime });
  } catch (error) {
    console.error('Cortex INSIGHTS error:', error);
    res.status(500).json({ error: error.message || 'Cortex INSIGHTS failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /sentiment
// ---------------------------------------------------------------------------

cortexRouter.post('/sentiment', async (req, res) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const sql = `SELECT SNOWFLAKE.CORTEX.SENTIMENT('${escapeString(text)}') as sentiment`;
    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    const executionTime = Date.now() - startTime;

    res.json({ sentiment: parseFloat(result[0]?.SENTIMENT || result[0]?.sentiment), executionTime });
  } catch (error) {
    console.error('Cortex SENTIMENT error:', error);
    res.status(500).json({ error: error.message || 'Cortex SENTIMENT failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /summarize
// ---------------------------------------------------------------------------

cortexRouter.post('/summarize', async (req, res) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const sql = `SELECT SNOWFLAKE.CORTEX.SUMMARIZE('${escapeString(text)}') as summary`;
    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    const executionTime = Date.now() - startTime;

    res.json({ summary: result[0]?.SUMMARY || result[0]?.summary, executionTime });
  } catch (error) {
    console.error('Cortex SUMMARIZE error:', error);
    res.status(500).json({ error: error.message || 'Cortex SUMMARIZE failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /translate
// ---------------------------------------------------------------------------

cortexRouter.post('/translate', async (req, res) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }
    const { text, fromLanguage, toLanguage } = req.body;
    if (!text || !fromLanguage || !toLanguage) {
      return res.status(400).json({ error: 'Text, fromLanguage, and toLanguage are required' });
    }

    const sql = `SELECT SNOWFLAKE.CORTEX.TRANSLATE('${escapeString(text)}', '${fromLanguage}', '${toLanguage}') as translation`;
    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    const executionTime = Date.now() - startTime;

    res.json({ translation: result[0]?.TRANSLATION || result[0]?.translation, executionTime });
  } catch (error) {
    console.error('Cortex TRANSLATE error:', error);
    res.status(500).json({ error: error.message || 'Cortex TRANSLATE failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /models — list available Cortex LLM models
// ---------------------------------------------------------------------------

cortexRouter.get('/models', async (_req, res) => {
  try {
    res.json({
      models: [
        { id: 'snowflake-arctic', name: 'Snowflake Arctic', description: "Snowflake's own LLM, optimized for enterprise tasks" },
        { id: 'llama3.1-405b', name: 'Llama 3.1 405B', description: "Meta's largest and most capable model" },
        { id: 'llama3.1-70b', name: 'Llama 3.1 70B', description: 'Excellent balance of speed and quality (recommended)' },
        { id: 'llama3.1-8b', name: 'Llama 3.1 8B', description: 'Fast responses, good for simple tasks' },
        { id: 'mistral-large2', name: 'Mistral Large 2', description: 'Strong reasoning and code generation' },
        { id: 'mixtral-8x7b', name: 'Mixtral 8x7B', description: 'Fast mixture-of-experts model' },
        { id: 'gemma-7b', name: 'Gemma 7B', description: "Google's efficient open model" },
      ],
    });
  } catch (error) {
    console.error('Error listing Cortex models:', error);
    res.status(500).json({ error: error.message });
  }
});
