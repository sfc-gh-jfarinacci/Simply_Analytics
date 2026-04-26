import { buildSnowflakeHeaders, getAccountUrl } from './snowflakeAuth.js';

const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && console.log('[CortexAnalyst]', ...args);

/**
 * Call Cortex Analyst REST API with streaming SSE.
 *
 * @param {Object} connWithCreds - Connection object with decrypted credentials
 * @param {Object} options
 * @param {string[]} options.semanticViews - Array of fully qualified semantic view names
 * @param {Array} options.messages - Conversation messages in Analyst format:
 *   [{ role: 'user', content: [{ type: 'text', text: '...' }] }]
 * @param {string} [options.role] - Snowflake role override
 * @param {Function} [options.onStatus] - Callback for status events: (status) => void
 * @returns {Promise<{ text: string, sql: string|null, suggestions: string[]|null, requestId: string|null }>}
 */
export async function callAnalyst(connWithCreds, { semanticViews, messages, role, onStatus }) {
  const baseUrl = getAccountUrl(connWithCreds);
  const url = `${baseUrl}/api/v2/cortex/analyst/message`;

  const headers = await buildSnowflakeHeaders(connWithCreds, { accept: 'text/event-stream' });
  if (role) {
    headers['X-Snowflake-Role'] = role;
  }

  const body = { messages, stream: true };

  if (semanticViews.length === 1) {
    body.semantic_view = semanticViews[0];
  } else {
    body.semantic_models = semanticViews.map(v => ({ semantic_view: v }));
  }

  log('Calling Cortex Analyst:', url, 'views:', semanticViews);
  const startTime = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    log('Analyst error:', response.status, errText);
    throw new Error(`Cortex Analyst error (${response.status}): ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const contentParts = {};
  let requestId = null;

  const processEvent = (eventType, data) => {
    try {
      const parsed = JSON.parse(data);

      switch (eventType) {
        case 'status':
          if (parsed.status && onStatus) {
            onStatus(parsed.status);
          }
          break;

        case 'message.content.delta': {
          const idx = parsed.index;
          if (!contentParts[idx]) {
            contentParts[idx] = { type: parsed.type, text: '', statement: '', suggestions: [] };
          }
          const part = contentParts[idx];
          part.type = parsed.type;

          if (parsed.type === 'text' && parsed.text_delta) {
            part.text += parsed.text_delta;
          } else if (parsed.type === 'sql' && parsed.statement_delta) {
            part.statement += parsed.statement_delta;
          } else if (parsed.type === 'suggestions' && parsed.suggestions_delta) {
            const sIdx = parsed.suggestions_delta.index;
            if (!part.suggestions[sIdx]) part.suggestions[sIdx] = '';
            part.suggestions[sIdx] += parsed.suggestions_delta.suggestion_delta || '';
          }
          break;
        }

        case 'error':
          throw new Error(parsed.message || 'Cortex Analyst streaming error');

        case 'response_metadata':
          break;

        case 'done':
          break;

        default:
          break;
      }
    } catch (e) {
      if (e.message?.includes('Cortex Analyst')) throw e;
      log('Failed to parse SSE event:', eventType, data, e.message);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const rawData = line.slice(6);
          if (currentEvent && rawData) {
            processEvent(currentEvent, rawData);
          }
        } else if (line === '') {
          currentEvent = '';
        }
      }
    }
  } catch (err) {
    log('Stream read error:', err.message);
    throw err;
  }

  let text = '';
  let sql = null;
  let suggestions = null;

  for (const part of Object.values(contentParts)) {
    if (part.type === 'text') {
      text += part.text;
    } else if (part.type === 'sql' && part.statement) {
      sql = part.statement;
    } else if (part.type === 'suggestions' && part.suggestions.length > 0) {
      suggestions = part.suggestions;
    }
  }

  log(`Analyst responded in ${Date.now() - startTime}ms — text: ${text.length} chars, sql: ${sql ? 'yes' : 'no'}, suggestions: ${suggestions?.length || 0}`);

  return { text, sql, suggestions, requestId };
}
