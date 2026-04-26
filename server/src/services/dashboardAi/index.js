/**
 * Dashboard AI Service — orchestration layer
 *
 * Public API: generateDashboard, generateWidget, modifyDashboard,
 * chatWithDashboard, chatWithDashboardStream, conversationalAnswer,
 * askChat, classifyIntent.
 *
 * Internal concerns (prompts, validators, tools) live in sibling modules.
 */

import yaml from 'js-yaml';
import { complete as llmComplete, completeStream as llmStream, stripCodeFences } from '../llmProvider.js';

import {
  DASHBOARD_SCHEMA_PROMPT,
  WIDGET_SCHEMA_PROMPT,
  CHAT_SYSTEM_PROMPT,
  buildSemanticViewContext,
  buildAskSystemPrompt,
  buildConversationalSystemPrompt,
} from './prompts.js';

import {
  validateAndNormalizeDashboard,
  validateAndNormalizeWidget,
} from './validators.js';

import {
  NATIVE_TOOLS,
  executeToolCalls,
} from './tools.js';

// Re-export for external consumers that import WIDGET_SCHEMA_PROMPT directly
export { WIDGET_SCHEMA_PROMPT };

const MAX_TOOL_ROUNDS = 5;

// ---------------------------------------------------------------------------
// LLM call helpers
// ---------------------------------------------------------------------------

async function callLLM(connWithCreds, llmMessages, model, maxTokens, provider, apiKey, endpointUrl, tools) {
  const raw = await llmComplete({
    messages: llmMessages,
    model, maxTokens, temperature: 0.3,
    provider, apiKey, connWithCreds, endpointUrl,
    tools,
  });
  if (typeof raw === 'object' && raw.tool_calls) return raw;
  return stripCodeFences(raw);
}

async function callLLMStreaming(connWithCreds, llmMessages, model, maxTokens, provider, apiKey, endpointUrl, onTextDelta) {
  let full = '';
  for await (const chunk of llmStream({
    messages: llmMessages,
    model, maxTokens, temperature: 0.3,
    provider, apiKey, connWithCreds, endpointUrl,
  })) {
    full += chunk;
    if (onTextDelta) onTextDelta(chunk);
  }
  return stripCodeFences(full);
}

function nudgeFinalAnswer(llmMessages) {
  return [
    ...llmMessages,
    { role: 'user', content: 'You have gathered enough data. Now provide your final answer as JSON. Do NOT call any more tools.' },
  ];
}

function parseAgentAnswer(text, toolSteps) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { return { message: text, action: 'none', yaml: null, toolSteps }; }
    } else {
      return { message: text, action: 'none', yaml: null, toolSteps };
    }
  }

  if (parsed.action === 'replace_dashboard' && parsed.yaml) {
    parsed.yaml = validateAndNormalizeDashboard(parsed.yaml);
  } else if (parsed.action === 'add_widget' && parsed.yaml) {
    parsed.yaml = Array.isArray(parsed.yaml)
      ? parsed.yaml.map(w => validateAndNormalizeWidget(w))
      : validateAndNormalizeWidget(parsed.yaml);
  } else if (parsed.action === 'update_widget' && parsed.yaml?.widget) {
    parsed.yaml.widget = validateAndNormalizeWidget(parsed.yaml.widget);
  } else if (parsed.action === 'add_dashboard' && parsed.yaml) {
    const dashboard = parsed.yaml;
    if (dashboard.tabs) {
      for (const tab of dashboard.tabs) {
        tab.widgets = (tab.widgets || []).map(w => validateAndNormalizeWidget(w));
      }
    } else if (Array.isArray(dashboard.widgets)) {
      dashboard.tabs = [{ id: 'tab-1', label: 'Overview', widgets: dashboard.widgets.map(w => validateAndNormalizeWidget(w)) }];
      delete dashboard.widgets;
    }
    if (!dashboard.title) dashboard.title = parsed.message || 'AI Dashboard';
  }

  return { message: parsed.message || 'Done.', action: parsed.action || 'none', yaml: parsed.yaml || null, toolSteps };
}

// ---------------------------------------------------------------------------
// One-shot generators
// ---------------------------------------------------------------------------

export async function generateDashboard(connection, { prompt, semanticViewMetadata, model = 'claude-sonnet-4-6', maxTokens = 4096, provider, apiKey, endpointUrl, connWithCreds }) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  const response = await llmComplete({
    messages: [
      { role: 'system', content: `${DASHBOARD_SCHEMA_PROMPT}\n\n${viewContext}` },
      { role: 'user', content: prompt },
    ],
    model, maxTokens, temperature: 0.3, provider, apiKey, connWithCreds, endpointUrl,
  });

  return validateAndNormalizeDashboard(yaml.load(stripCodeFences(response)));
}

export async function generateWidget(connection, { prompt, semanticViewMetadata, existingWidgets, position, model = 'claude-sonnet-4-6', maxTokens = 2048, provider, apiKey, endpointUrl, connWithCreds }) {
  const viewContext = buildSemanticViewContext(semanticViewMetadata);

  let positionHint = '';
  if (position) {
    positionHint = `\n\nPlace the widget at position x:${position.x}, y:${position.y}, w:${position.w || 6}, h:${position.h || 4}.`;
  } else if (existingWidgets?.length) {
    const maxY = Math.max(...existingWidgets.map(w => (w.position?.y || 0) + (w.position?.h || 4)));
    positionHint = `\n\nExisting widgets occupy up to row ${maxY}. Place this widget below them at y:${maxY}.`;
  }

  const response = await llmComplete({
    messages: [
      { role: 'system', content: `${WIDGET_SCHEMA_PROMPT}\n\n${viewContext}${positionHint}` },
      { role: 'user', content: prompt },
    ],
    model, maxTokens, temperature: 0.3, provider, apiKey, connWithCreds, endpointUrl,
  });

  return validateAndNormalizeWidget(yaml.load(stripCodeFences(response)));
}

export async function modifyDashboard(connection, { prompt, currentYaml, semanticViewMetadata, model = 'claude-sonnet-4-6', maxTokens = 4096, provider, apiKey, endpointUrl, connWithCreds }) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  const currentYamlStr = typeof currentYaml === 'string' ? currentYaml : yaml.dump(currentYaml);

  const modifyPrompt = `${DASHBOARD_SCHEMA_PROMPT}\n\n${viewContext}\n\n## CURRENT DASHBOARD YAML\nThe user wants to MODIFY this existing dashboard. Apply the requested changes while preserving\nexisting widgets and configuration that shouldn't change.\n\n\`\`\`yaml\n${currentYamlStr}\n\`\`\`\n\nReturn the COMPLETE modified YAML (not just the changed parts).`;

  const response = await llmComplete({
    messages: [
      { role: 'system', content: modifyPrompt },
      { role: 'user', content: prompt },
    ],
    model, maxTokens, temperature: 0.3, provider, apiKey, connWithCreds, endpointUrl,
  });

  return validateAndNormalizeDashboard(yaml.load(stripCodeFences(response)));
}

// ---------------------------------------------------------------------------
// Agentic tool-loop helpers (shared by chat functions)
// ---------------------------------------------------------------------------

function buildFocusContext(focusedWidgetId, currentYaml) {
  if (!focusedWidgetId || !currentYaml?.tabs) return '';
  for (const tab of currentYaml.tabs) {
    const w = (tab.widgets || []).find(w => w.id === focusedWidgetId);
    if (w) {
      return `\n\n## FOCUSED WIDGET\nThe user is focused on widget "${w.title}" (id: ${w.id}, type: ${w.type}). Apply changes to THIS widget unless they clearly ask for something else.\n\`\`\`yaml\n${yaml.dump(w)}\`\`\``;
    }
  }
  return '';
}

async function runToolLoop(connection, llmMessages, { model, maxTokens, provider, apiKey, endpointUrl, connWithCreds, onToolStep, onTextDelta, streaming = false }) {
  const allToolSteps = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;

    if (streaming && isLastRound && allToolSteps.length > 0) {
      const msgs = nudgeFinalAnswer(llmMessages);
      const text = await callLLMStreaming(connWithCreds, msgs, model, maxTokens, provider, apiKey, endpointUrl, onTextDelta);
      return parseAgentAnswer(text, allToolSteps);
    }

    const msgs = (isLastRound && allToolSteps.length > 0) ? nudgeFinalAnswer(llmMessages) : llmMessages;
    const response = await callLLM(connWithCreds, msgs, model, maxTokens, provider, apiKey, endpointUrl, NATIVE_TOOLS);

    if (typeof response === 'object' && response.tool_calls?.length) {
      llmMessages.push({ role: 'assistant', content: null, tool_calls: response.tool_calls });
      const roundToolStep = onToolStep ? (streaming ? (step) => onToolStep({ ...step, round }) : onToolStep) : undefined;
      const { toolMessages, toolSteps } = await executeToolCalls(connection, response.tool_calls, roundToolStep);
      allToolSteps.push(...toolSteps);
      llmMessages.push(...toolMessages);
      continue;
    }

    const text = typeof response === 'string' ? response : (response.content || '');
    if (streaming && onTextDelta && text) onTextDelta(text);
    return parseAgentAnswer(text, allToolSteps);
  }

  return { message: 'I ran out of tool calls. Please try rephrasing your request.', action: 'none', yaml: null, toolSteps: allToolSteps };
}

// ---------------------------------------------------------------------------
// Chat orchestration — dashboard editor
// ---------------------------------------------------------------------------

export async function chatWithDashboard(connection, { messages, currentYaml, focusedWidgetId, semanticViewMetadata, model = 'claude-sonnet-4-6', maxTokens = 4096, onToolStep, onTextDelta, provider, apiKey, endpointUrl, connWithCreds }) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  const currentYamlStr = currentYaml ? (typeof currentYaml === 'string' ? currentYaml : yaml.dump(currentYaml)) : '(empty dashboard)';
  const focusContext = buildFocusContext(focusedWidgetId, currentYaml);
  const systemContent = `${CHAT_SYSTEM_PROMPT}\n\n${viewContext}\n\n## CURRENT DASHBOARD\n\`\`\`yaml\n${currentYamlStr}\n\`\`\`${focusContext}`;

  const llmMessages = [
    { role: 'system', content: systemContent },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  return runToolLoop(connection, llmMessages, { model, maxTokens, provider, apiKey, endpointUrl, connWithCreds, onToolStep, onTextDelta });
}

export async function chatWithDashboardStream(connection, { messages, currentYaml, focusedWidgetId, semanticViewMetadata, model = 'claude-sonnet-4-6', maxTokens = 4096, onToolStep, onTextDelta, provider, apiKey, endpointUrl, connWithCreds }) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  const currentYamlStr = currentYaml ? (typeof currentYaml === 'string' ? currentYaml : yaml.dump(currentYaml)) : '(empty dashboard)';
  const focusContext = buildFocusContext(focusedWidgetId, currentYaml);
  const systemContent = `${CHAT_SYSTEM_PROMPT}\n\n${viewContext}\n\n## CURRENT DASHBOARD\n\`\`\`yaml\n${currentYamlStr}\n\`\`\`${focusContext}`;

  const llmMessages = [
    { role: 'system', content: systemContent },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  return runToolLoop(connection, llmMessages, { model, maxTokens, provider, apiKey, endpointUrl, connWithCreds, onToolStep, onTextDelta, streaming: true });
}

// ---------------------------------------------------------------------------
// Conversational answer (data Q&A, no widget output)
// ---------------------------------------------------------------------------

export async function conversationalAnswer(connection, { messages, semanticViewMetadata, model = 'claude-sonnet-4-6', maxTokens = 4096, provider, apiKey, endpointUrl, connWithCreds }) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  const llmMessages = [
    { role: 'system', content: buildConversationalSystemPrompt(viewContext) },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const allToolSteps = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;
    const msgs = (isLastRound && allToolSteps.length > 0) ? nudgeFinalAnswer(llmMessages) : llmMessages;
    const response = await callLLM(connWithCreds, msgs, model, maxTokens, provider, apiKey, endpointUrl, NATIVE_TOOLS);

    if (typeof response === 'object' && response.tool_calls?.length) {
      llmMessages.push({ role: 'assistant', content: null, tool_calls: response.tool_calls });
      const { toolMessages, toolSteps } = await executeToolCalls(connection, response.tool_calls);
      allToolSteps.push(...toolSteps);
      llmMessages.push(...toolMessages);
      continue;
    }

    const text = typeof response === 'string' ? response : (response.content || '');
    return { message: text, toolSteps: allToolSteps };
  }

  return { message: 'I ran out of tool calls. Please try rephrasing your request.', toolSteps: allToolSteps };
}

// ---------------------------------------------------------------------------
// AskAI unified chat
// ---------------------------------------------------------------------------

export async function askChat(connection, { messages, semanticViewMetadata, priorArtifacts = [], model = 'claude-sonnet-4-6', maxTokens = 4096, onToolStep, onTextDelta, provider, apiKey, endpointUrl, connWithCreds }) {
  const viewContext = Array.isArray(semanticViewMetadata)
    ? semanticViewMetadata.map(buildSemanticViewContext).join('\n\n')
    : buildSemanticViewContext(semanticViewMetadata);

  let artifactContext = '';
  if (priorArtifacts.length > 0) {
    const widgetSummaries = priorArtifacts
      .filter(a => a.type === 'widget' && a.widget)
      .map(a => {
        const w = a.widget;
        const fieldsSummary = (w.fields || []).map(f =>
          `${f.name} (${f.shelf}, ${f.semanticType}${f.markType ? ', mark:' + f.markType : ''}${f.aggregation ? ', agg:' + f.aggregation : ''})`,
        ).join(', ');
        return `- Widget "${w.title}" (id: ${w.id}, type: ${w.type})\n  semanticView: ${w.semanticView || w.semanticViewsReferenced?.[0]?.fullyQualifiedName || 'unknown'}\n  fields: [${fieldsSummary}]\n  filters: ${JSON.stringify(w.filtersApplied || [])}\n  sorts: ${JSON.stringify(w.sortsApplied || [])}`;
      }).join('\n');
    if (widgetSummaries) {
      artifactContext = `\n\n## EXISTING WIDGETS IN THIS CONVERSATION\nThe user has these widgets from prior messages. When they ask to modify a chart, update the relevant widget rather than creating a new one.\n${widgetSummaries}`;
    }
  }

  const llmMessages = [
    { role: 'system', content: buildAskSystemPrompt(viewContext, artifactContext) },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  return runToolLoop(connection, llmMessages, { model, maxTokens, provider, apiKey, endpointUrl, connWithCreds, onToolStep, onTextDelta });
}

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

export async function classifyIntent(connection, { message, hasHistory, model = 'claude-sonnet-4-6', provider, apiKey, endpointUrl, connWithCreds }) {
  const systemPrompt = `You are an intent classifier for a data analytics chat assistant. Given the user's message, classify their intent into exactly ONE of these categories:

- "dashboard": User wants a multi-widget dashboard, overview, report, or KPI summary with multiple charts
- "widget": User wants a specific chart, graph, table, metric, or data visualization
- "data_answer": User is asking a factual question about their data that can be answered in text (e.g. "what was total revenue last quarter?") — no chart needed
- "chat": General conversation, greetings, help requests, clarification, or anything not related to data analysis

Respond with ONLY a JSON object: {"intent": "<category>", "reason": "<brief explanation>"}
Do NOT include any other text.`;

  const userContent = hasHistory
    ? `[Continuing a conversation] User says: "${message}"`
    : `[New conversation] User says: "${message}"`;

  const raw = await callLLM(connWithCreds, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ], model, 128, provider, apiKey, endpointUrl);

  try {
    const parsed = JSON.parse(raw);
    const valid = ['dashboard', 'widget', 'data_answer', 'chat'];
    if (valid.includes(parsed.intent)) return parsed.intent;
  } catch { /* fallback */ }
  return 'chat';
}

// ---------------------------------------------------------------------------
// Default export (preserves backward compatibility)
// ---------------------------------------------------------------------------

export default {
  generateDashboard,
  generateWidget,
  modifyDashboard,
  chatWithDashboard,
  chatWithDashboardStream,
  conversationalAnswer,
  askChat,
  classifyIntent,
};
