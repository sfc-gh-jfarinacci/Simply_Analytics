/**
 * LLM Provider Abstraction
 *
 * Unified interface for calling LLMs across providers:
 *   - cortex    : Snowflake Cortex REST API (chat/completions)
 *   - openai    : OpenAI Chat Completions API
 *   - anthropic : Anthropic Messages API
 *   - bedrock   : AWS Bedrock Converse API
 *   - vertex    : GCP Vertex AI
 *   - azure     : Azure OpenAI Service
 *
 * All adapters support both blocking (complete) and streaming (completeStream).
 * API keys come from platform env vars — users never supply them.
 */

import { buildSnowflakeHeaders, getAccountUrl } from './snowflakeAuth.js';

const VALID_PROVIDERS = ['cortex', 'openai', 'anthropic', 'bedrock', 'vertex', 'azure'];

// ─── Cortex REST API adapter ─────────────────────────────────
// Uses /api/v2/cortex/v1/chat/completions (OpenAI-compatible).
// Requires connWithCreds (DB row with account + credentials), NOT a snowflake-sdk connection.

function buildCortexBody(messages, model, maxTokens, temperature, tools) {
  // The Cortex REST API uses Anthropic under the hood, which does NOT support
  // OpenAI-style `role: "tool"` messages. Convert tool interactions to plain
  // text so the model sees tool results without breaking the Cortex API.
  //
  // Pattern: assistant[tool_calls] + tool[result]... → assistant(text) + user(text)
  const converted = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];

    if (m.role === 'assistant' && m.tool_calls?.length) {
      // Collect the assistant's tool calls as a text description
      const callDescs = m.tool_calls.map(tc => {
        const name = tc.function?.name || tc.name || 'unknown';
        let args = tc.function?.arguments || '{}';
        if (typeof args === 'string') {
          try { args = JSON.stringify(JSON.parse(args)); } catch { /* keep as-is */ }
        }
        return `${name}(${args})`;
      }).join('\n');
      converted.push({ role: 'assistant', content: `I'll query the data:\n${callDescs}` });

      // Collect all following tool result messages
      const results = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        results.push(messages[j].content || '');
        j++;
      }
      if (results.length > 0) {
        converted.push({ role: 'user', content: `Tool results:\n${results.join('\n')}` });
      }
      i = j;
      continue;
    }

    if (m.role === 'tool') {
      // Orphaned tool message (shouldn't happen) — skip
      i++;
      continue;
    }

    converted.push({ role: m.role, content: m.content ?? '' });
    i++;
  }

  // Merge consecutive same-role messages (Anthropic requires strict alternation)
  const merged = [];
  for (const msg of converted) {
    const prev = merged[merged.length - 1];
    if (prev && msg.role === prev.role && (msg.role === 'user' || msg.role === 'assistant')) {
      prev.content = (prev.content || '') + '\n' + (msg.content || '');
    } else {
      merged.push(msg);
    }
  }

  const body = {
    model,
    messages: merged,
    max_completion_tokens: maxTokens,
    temperature,
  };
  if (tools?.length) body.tools = tools;
  return body;
}

async function cortexComplete({ messages, model, maxTokens, temperature, connWithCreds, tools }) {
  if (!connWithCreds) {
    throw new Error('Snowflake connection credentials are required for the Cortex provider');
  }

  const baseUrl = getAccountUrl(connWithCreds);
  const url = `${baseUrl}/api/v2/cortex/v1/chat/completions`;

  const headers = await buildSnowflakeHeaders(connWithCreds);
  headers['Content-Type'] = 'application/json';

  const cortexBody = buildCortexBody(messages, model, maxTokens, temperature, tools);

  // Debug: log message roles and tool state to diagnose toolUse/toolResult mismatch
  const msgSummary = cortexBody.messages.map(m => {
    let s = m.role;
    if (m.tool_calls) s += `[tool_calls:${m.tool_calls.length}]`;
    if (m.tool_call_id) s += `[tool_call_id:${m.tool_call_id}]`;
    return s;
  }).join(' → ');
  console.log(`[cortexComplete] model=${model} tools=${!!cortexBody.tools} msgs=[${msgSummary}]`);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(cortexBody),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[cortexComplete] ERROR ${res.status}: ${errText}`);
    console.error(`[cortexComplete] Sent messages:`, JSON.stringify(cortexBody.messages.map(m => ({ role: m.role, tool_calls: m.tool_calls?.map(tc => tc.id), tool_call_id: m.tool_call_id, contentLen: m.content?.length }))));
    throw new Error(`Cortex REST API error (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  if (!choice) return '';

  if (choice.message?.tool_calls?.length) {
    console.log('[cortexComplete] Tool calls returned:', JSON.stringify(choice.message.tool_calls));
    return choice.message;
  }
  return choice.message?.content || '';
}

async function* cortexStream({ messages, model, maxTokens, temperature, connWithCreds, tools }) {
  if (!connWithCreds) {
    throw new Error('Snowflake connection credentials are required for the Cortex provider');
  }

  const baseUrl = getAccountUrl(connWithCreds);
  const url = `${baseUrl}/api/v2/cortex/v1/chat/completions`;

  const headers = await buildSnowflakeHeaders(connWithCreds);
  headers['Content-Type'] = 'application/json';

  const body = buildCortexBody(messages, model, maxTokens, temperature, tools);
  body.stream = true;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Cortex REST API stream error (${res.status}): ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip malformed */ }
    }
  }
}

// ─── OpenAI adapter ──────────────────────────────────────────

function getOpenAIKey(apiKey) {
  return apiKey || process.env.OPENAI_API_KEY;
}

async function openaiComplete({ messages, model, maxTokens, temperature, apiKey }) {
  const key = getOpenAIKey(apiKey);
  if (!key) throw new Error('OpenAI API key not configured (set OPENAI_API_KEY)');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

async function* openaiStream({ messages, model, maxTokens, temperature, apiKey }) {
  const key = getOpenAIKey(apiKey);
  if (!key) throw new Error('OpenAI API key not configured (set OPENAI_API_KEY)');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      temperature,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip malformed */ }
    }
  }
}

// ─── Anthropic adapter ───────────────────────────────────────

const ANTHROPIC_MODEL_MAP = {
  'claude-sonnet-4-6': 'claude-sonnet-4-20250514',
  'claude-haiku-3': 'claude-3-5-haiku-20241022',
};

function resolveAnthropicModel(model) {
  return ANTHROPIC_MODEL_MAP[model] || model;
}

function getAnthropicKey(apiKey) {
  return apiKey || process.env.ANTHROPIC_API_KEY;
}

function buildAnthropicBody(messages, model, maxTokens, temperature) {
  const resolvedModel = resolveAnthropicModel(model);

  let systemContent = '';
  const chatMessages = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemContent += (systemContent ? '\n\n' : '') + m.content;
    } else {
      chatMessages.push({ role: m.role, content: m.content });
    }
  }

  if (chatMessages.length > 0 && chatMessages[0].role !== 'user') {
    chatMessages.unshift({ role: 'user', content: '(start)' });
  }

  // Merge consecutive same-role messages
  const sanitized = [];
  for (const m of chatMessages) {
    if (sanitized.length > 0 && sanitized[sanitized.length - 1].role === m.role) {
      sanitized[sanitized.length - 1].content += '\n\n' + m.content;
    } else {
      sanitized.push({ ...m });
    }
  }

  const body = { model: resolvedModel, max_tokens: maxTokens, temperature, messages: sanitized };
  if (systemContent) body.system = systemContent;
  return body;
}

function getAnthropicHeaders(key) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };
}

async function anthropicComplete({ messages, model, maxTokens, temperature, apiKey }) {
  const key = getAnthropicKey(apiKey);
  if (!key) throw new Error('Anthropic API key not configured (set ANTHROPIC_API_KEY)');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: getAnthropicHeaders(key),
    body: JSON.stringify(buildAnthropicBody(messages, model, maxTokens, temperature)),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }
  const json = await res.json();
  return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
}

async function* anthropicStream({ messages, model, maxTokens, temperature, apiKey }) {
  const key = getAnthropicKey(apiKey);
  if (!key) throw new Error('Anthropic API key not configured (set ANTHROPIC_API_KEY)');

  const body = buildAnthropicBody(messages, model, maxTokens, temperature);
  body.stream = true;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: getAnthropicHeaders(key),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(trimmed.slice(6));
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield event.delta.text;
        }
      } catch { /* skip */ }
    }
  }
}

// ─── AWS Bedrock adapter ─────────────────────────────────────
// Platform-managed: uses AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY from env.

const BEDROCK_MODEL_MAP = {
  'meta-llama/Llama-4-Scout-17B-16E-Instruct': 'us.meta.llama4-scout-17b-16e-instruct-v1:0',
  'meta-llama/Llama-4-Maverick-17B-128E-Instruct': 'us.meta.llama4-maverick-17b-128e-instruct-v1:0',
  'deepseek-ai/DeepSeek-V3': 'deepseek-r1',
  'mistral-large': 'mistral.mistral-large-2407-v1:0',
};

function resolveBedrockModelId(model) {
  return BEDROCK_MODEL_MAP[model] || model;
}

async function getBedrockSigner(region) {
  const { SignatureV4 } = await import('@smithy/signature-v4');
  const { Sha256 } = await import('@aws-crypto/sha256-js');

  return new SignatureV4({
    service: 'bedrock',
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
    },
    sha256: Sha256,
  });
}

function buildBedrockMessages(messages) {
  const systemParts = [];
  const chatMessages = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push({ text: m.content });
    } else {
      chatMessages.push({ role: m.role, content: [{ text: m.content }] });
    }
  }
  return { systemParts, chatMessages };
}

async function bedrockComplete({ messages, model, maxTokens, temperature, endpointUrl }) {
  const region = endpointUrl || process.env.AWS_BEDROCK_REGION || 'us-east-1';
  const bedrockModel = resolveBedrockModelId(model);
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(bedrockModel)}/converse`;

  const { systemParts, chatMessages } = buildBedrockMessages(messages);
  const body = JSON.stringify({
    messages: chatMessages,
    ...(systemParts.length > 0 && { system: systemParts }),
    inferenceConfig: { maxTokens, temperature },
  });

  const signer = await getBedrockSigner(region);
  const signed = await signer.sign({
    method: 'POST', hostname: host, path,
    headers: { 'Content-Type': 'application/json', host },
    body,
  });

  const res = await fetch(`https://${host}${path}`, {
    method: 'POST', headers: signed.headers, body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AWS Bedrock API error (${res.status}): ${errText}`);
  }
  const json = await res.json();
  return json.output?.message?.content?.[0]?.text || '';
}

async function* bedrockStream({ messages, model, maxTokens, temperature, endpointUrl }) {
  const region = endpointUrl || process.env.AWS_BEDROCK_REGION || 'us-east-1';
  const bedrockModel = resolveBedrockModelId(model);
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(bedrockModel)}/converse-stream`;

  const { systemParts, chatMessages } = buildBedrockMessages(messages);
  const body = JSON.stringify({
    messages: chatMessages,
    ...(systemParts.length > 0 && { system: systemParts }),
    inferenceConfig: { maxTokens, temperature },
  });

  const signer = await getBedrockSigner(region);
  const signed = await signer.sign({
    method: 'POST', hostname: host, path,
    headers: { 'Content-Type': 'application/json', host },
    body,
  });

  const res = await fetch(`https://${host}${path}`, {
    method: 'POST', headers: signed.headers, body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AWS Bedrock stream error (${res.status}): ${errText}`);
  }

  // Bedrock returns an event stream with JSON chunks
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Bedrock uses newline-delimited JSON events
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const text = event.contentBlockDelta?.delta?.text;
        if (text) yield text;
      } catch { /* skip non-JSON framing */ }
    }
  }
}

// ─── GCP Vertex AI adapter ──────────────────────────────────
// Platform-managed: uses GOOGLE_APPLICATION_CREDENTIALS from env.

const VERTEX_MODEL_MAP = {
  'google/gemma-3-27b-it': 'gemma-3-27b-it',
  'meta-llama/Llama-4-Scout-17B-16E-Instruct': 'llama-4-scout-17b-16e-instruct',
  'deepseek-ai/DeepSeek-V3': 'deepseek-v3',
};

function resolveVertexModelId(model) {
  return VERTEX_MODEL_MAP[model] || model;
}

async function getVertexAuth() {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  return tokenRes.token;
}

function buildVertexPayload(messages, maxTokens, temperature) {
  const contents = [];
  let systemInstruction = null;
  for (const m of messages) {
    if (m.role === 'system') {
      systemInstruction = { parts: [{ text: m.content }] };
    } else {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
  }
  return {
    contents,
    ...(systemInstruction && { systemInstruction }),
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
}

async function vertexComplete({ messages, model, maxTokens, temperature, endpointUrl }) {
  const projectId = process.env.GCP_PROJECT_ID;
  const location = endpointUrl || process.env.GCP_VERTEX_REGION || 'us-central1';
  const vertexModel = resolveVertexModelId(model);
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:generateContent`;

  const token = await getVertexAuth();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(buildVertexPayload(messages, maxTokens, temperature)),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Vertex AI API error (${res.status}): ${errText}`);
  }
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function* vertexStream({ messages, model, maxTokens, temperature, endpointUrl }) {
  const projectId = process.env.GCP_PROJECT_ID;
  const location = endpointUrl || process.env.GCP_VERTEX_REGION || 'us-central1';
  const vertexModel = resolveVertexModelId(model);
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:streamGenerateContent?alt=sse`;

  const token = await getVertexAuth();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(buildVertexPayload(messages, maxTokens, temperature)),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Vertex AI stream error (${res.status}): ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      try {
        const chunk = JSON.parse(trimmed.slice(6));
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch { /* skip */ }
    }
  }
}

// ─── Azure OpenAI adapter ────────────────────────────────────
// Platform-managed: uses AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY from env.

function getAzureConfig(apiKey, endpointUrl) {
  const baseUrl = endpointUrl || process.env.AZURE_OPENAI_ENDPOINT;
  const key = apiKey || process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
  if (!baseUrl) throw new Error('Azure endpoint not configured (set AZURE_OPENAI_ENDPOINT)');
  if (!key) throw new Error('Azure API key not configured (set AZURE_OPENAI_API_KEY)');
  return { baseUrl: baseUrl.replace(/\/+$/, ''), key, apiVersion };
}

async function azureComplete({ messages, model, maxTokens, temperature, apiKey, endpointUrl }) {
  const { baseUrl, key, apiVersion } = getAzureConfig(apiKey, endpointUrl);
  const url = `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': key },
    body: JSON.stringify({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Azure OpenAI API error (${res.status}): ${errText}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

async function* azureStream({ messages, model, maxTokens, temperature, apiKey, endpointUrl }) {
  const { baseUrl, key, apiVersion } = getAzureConfig(apiKey, endpointUrl);
  const url = `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': key },
    body: JSON.stringify({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      temperature,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Azure OpenAI stream error (${res.status}): ${errText}`);
  }

  // Same SSE format as OpenAI
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip */ }
    }
  }
}

// ─── Public interface ────────────────────────────────────────

const STREAM_ADAPTERS = {
  cortex: cortexStream,
  openai: openaiStream,
  anthropic: anthropicStream,
  bedrock: bedrockStream,
  vertex: vertexStream,
  azure: azureStream,
};

const COMPLETE_ADAPTERS = {
  cortex: cortexComplete,
  openai: openaiComplete,
  anthropic: anthropicComplete,
  bedrock: bedrockComplete,
  vertex: vertexComplete,
  azure: azureComplete,
};

/**
 * Send a chat completion request (blocking — waits for full response).
 *
 * When `tools` is provided, the return value may be a message object with
 * `tool_calls` instead of a plain string. Callers must check the type.
 *
 * @param {Object} options
 * @param {Array}   options.messages
 * @param {string}  [options.model]
 * @param {number}  [options.maxTokens=4096]
 * @param {number}  [options.temperature=0.3]
 * @param {string}  [options.provider='cortex']
 * @param {string}  [options.apiKey]
 * @param {Object}  [options.connWithCreds]
 * @param {string}  [options.endpointUrl]
 * @param {Array}   [options.tools]        - OpenAI-format tool definitions
 * @returns {Promise<string|Object>}       - string (content) or message object (tool_calls)
 */
export async function complete({
  messages,
  model = 'claude-sonnet-4-6',
  maxTokens = 4096,
  temperature = 0.3,
  provider = 'cortex',
  apiKey,
  connWithCreds,
  endpointUrl,
  tools,
}) {
  const p = (provider || 'cortex').toLowerCase();
  const adapter = COMPLETE_ADAPTERS[p];
  if (!adapter) {
    throw new Error(`Unknown LLM provider: "${provider}". Valid: ${VALID_PROVIDERS.join(', ')}`);
  }
  return adapter({ messages, model, maxTokens, temperature, apiKey, connWithCreds, endpointUrl, tools });
}

/**
 * Stream a chat completion — yields text chunks as they arrive.
 * All providers (including Cortex) now support real streaming.
 *
 * @param {Object} options  Same as complete()
 * @returns {AsyncGenerator<string>} Yields text deltas
 */
export async function* completeStream({
  messages,
  model = 'claude-sonnet-4-6',
  maxTokens = 4096,
  temperature = 0.3,
  provider = 'cortex',
  apiKey,
  connWithCreds,
  endpointUrl,
  tools,
}) {
  const p = (provider || 'cortex').toLowerCase();
  const adapter = STREAM_ADAPTERS[p];
  if (!adapter) {
    throw new Error(`No streaming adapter for provider: "${provider}"`);
  }

  yield* adapter({ messages, model, maxTokens, temperature, apiKey, connWithCreds, endpointUrl, tools });
}

/**
 * Strip markdown code fences from LLM output.
 */
export function stripCodeFences(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/^\s*```(?:ya?ml|json|sql|text)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();
}

export default { complete, completeStream, stripCodeFences };
