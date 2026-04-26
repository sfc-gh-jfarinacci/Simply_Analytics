import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  FiX,
  FiZap,
  FiLoader,
  FiSend,
  FiAlertCircle,
  FiRotateCcw,
  FiTarget,
  FiTrash2,
  FiMessageSquare,
  FiDatabase,
  FiSearch,
  FiCheckCircle,
} from 'react-icons/fi';
import { useAppStore } from '../../store/appStore';
import { streamDashboardChat } from '../../api/apiClient';
import '../../styles/AiChatPanel.css';

function buildSuggestions(metadata, focusedWidget) {
  if (!metadata || metadata.length === 0) return [];

  const dims = metadata.flatMap(v => (v.dimensions || []).map(d => typeof d === 'string' ? d : d.name));
  const measures = metadata.flatMap(v => (v.measures || []).map(m => typeof m === 'string' ? m : m.name));
  const facts = metadata.flatMap(v => (v.facts || []).map(f => typeof f === 'string' ? f : f.name));
  const timeDims = dims.filter(d => /date|time|month|year|week|quarter|day|period|created|updated/i.test(d));
  const catDims = dims.filter(d => !timeDims.includes(d));
  const fmt = (n) => n.replace(/_/g, ' ').toLowerCase();

  const s = [];

  if (focusedWidget) {
    s.push(`Change this to a horizontal bar chart`);
    if (measures[1]) s.push(`Add ${fmt(measures[1])} to this widget`);
    if (catDims[0]) s.push(`Break down by ${fmt(catDims[0])}`);
    s.push(`Make this widget larger`);
  } else {
    if (measures[0] && catDims[0])
      s.push(`Add a bar chart of ${fmt(measures[0])} by ${fmt(catDims[0])}`);
    if (measures[0] && timeDims[0])
      s.push(`Add a trend line of ${fmt(measures[0])} over ${fmt(timeDims[0])}`);
    if (measures.length > 1)
      s.push(`Add KPI cards for ${measures.slice(0, 3).map(fmt).join(', ')}`);
    if (catDims[0] && measures[0])
      s.push(`Add a pie chart of ${fmt(measures[0])} by ${fmt(catDims[0])}`);
  }

  return s.slice(0, 4);
}

function formatToolName(tool) {
  switch (tool) {
    case 'sample_data': return 'Sampled data';
    case 'check_cardinality': return 'Checked field cardinality';
    case 'test_query': return 'Tested query';
    default: return tool;
  }
}

function formatToolResult(step) {
  const r = step.result;
  switch (step.tool) {
    case 'sample_data':
      return `${r.rowCount} row${r.rowCount !== 1 ? 's' : ''} returned · ${r.columns?.length || 0} columns`;
    case 'check_cardinality':
      return `${r.field}: ${r.distinctCount} distinct values · ${r.recommendation}`;
    case 'test_query':
      return r.success
        ? `Query returned ${r.rowCount} row${r.rowCount !== 1 ? 's' : ''}`
        : 'Query returned no data';
    default:
      return JSON.stringify(r).substring(0, 120);
  }
}

function groupStepsByRound(steps) {
  const rounds = [];
  let current = null;
  for (const step of steps) {
    const r = step.round ?? 0;
    if (!current || current.round !== r) {
      current = { round: r, steps: [] };
      rounds.push(current);
    }
    current.steps.push(step);
  }
  return rounds;
}

function roundLabel(steps) {
  const names = [...new Set(steps.map(s => formatToolName(s.tool)))];
  return names.join(', ');
}

function ToolStepRounds({ steps, isStreaming }) {
  const [expanded, setExpanded] = React.useState(null);
  const rounds = groupStepsByRound(steps);

  return (
    <div className="ai-chat-tool-rounds">
      {rounds.map((group) => {
        const allDone = group.steps.every(s => s.result);
        const hasError = group.steps.some(s => s.result?.error);
        const isExpanded = expanded === group.round;
        const isActive = !allDone && isStreaming;

        return (
          <div key={group.round} className={`ai-chat-tool-round${isActive ? ' active' : ''}`}>
            <button
              className="ai-chat-tool-round-header"
              onClick={() => setExpanded(isExpanded ? null : group.round)}
            >
              <span className="tool-round-icon">
                {hasError
                  ? <FiAlertCircle className="tool-step-error" />
                  : allDone
                    ? <FiCheckCircle className="tool-step-success" />
                    : <FiLoader className="ai-chat-spinner" />}
              </span>
              <span className="tool-round-label">
                {isActive
                  ? group.steps[group.steps.length - 1].thinking || 'Analyzing...'
                  : `${roundLabel(group.steps)} (${group.steps.length})`}
              </span>
              <FiSearch className={`tool-round-expand ${isExpanded ? 'expanded' : ''}`} />
            </button>
            {isExpanded && (
              <div className="ai-chat-tool-round-details">
                {group.steps.map((step, idx) => (
                  <div key={idx} className="ai-chat-tool-step-compact">
                    <span className="tool-step-name-compact">{formatToolName(step.tool)}</span>
                    {step.result && !step.result.error && (
                      <span className="tool-step-result-compact">{formatToolResult(step)}</span>
                    )}
                    {step.result?.error && (
                      <span className="tool-step-result-compact tool-step-error-text">{step.result.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const AiChatPanel = ({ isOpen, onClose, focusedWidgetId, onFocusWidget }) => {
  const {
    currentDashboard,
    currentTabId,
    semanticViewMetadataCache,
    updateDashboard,
    addWidget,
    activeWorkspace,
  } = useAppStore();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getSemanticViewMetadata = useCallback(() => {
    const views = currentDashboard?.semanticViewsReferenced || [];
    if (views.length === 0) return null;
    return views.map(v => {
      const fqn = v.fullyQualifiedName || v.name;
      const cached = semanticViewMetadataCache[fqn];
      return {
        name: v.name,
        fullyQualifiedName: fqn,
        dimensions: cached?.dimensions || [],
        measures: cached?.measures || [],
        facts: cached?.facts || [],
      };
    }).filter(v => v.dimensions.length > 0 || v.measures.length > 0);
  }, [currentDashboard, semanticViewMetadataCache]);

  const viewMetadata = useMemo(() => {
    if (!isOpen) return null;
    return getSemanticViewMetadata();
  }, [isOpen, getSemanticViewMetadata]);

  const focusedWidget = useMemo(() => {
    if (!focusedWidgetId || !currentDashboard?.tabs) return null;
    for (const tab of currentDashboard.tabs) {
      const w = (tab.widgets || []).find(w => w.id === focusedWidgetId);
      if (w) return w;
    }
    return null;
  }, [focusedWidgetId, currentDashboard]);

  const suggestions = useMemo(
    () => buildSuggestions(viewMetadata, focusedWidget),
    [viewMetadata, focusedWidget]
  );

  const getCurrentYaml = useCallback(() => {
    if (!currentDashboard) return null;
    return {
      tabs: currentDashboard.tabs,
      filters: currentDashboard.filters,
      semanticViewsReferenced: currentDashboard.semanticViewsReferenced,
      customColorSchemes: currentDashboard.customColorSchemes,
    };
  }, [currentDashboard]);

  const saveUndoSnapshot = useCallback(() => {
    const yaml = getCurrentYaml();
    if (yaml) {
      setUndoStack(prev => [...prev.slice(-9), JSON.parse(JSON.stringify(yaml))]);
    }
  }, [getCurrentYaml]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !currentDashboard) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    updateDashboard(currentDashboard.id, prev);
    setMessages(m => [...m, {
      id: Date.now(),
      role: 'system',
      content: 'Reverted to previous state.',
    }]);
  }, [undoStack, currentDashboard, updateDashboard]);

  const applyAction = useCallback((result) => {
    if (!currentDashboard || result.action === 'none') return;

    saveUndoSnapshot();

    if (result.action === 'replace_dashboard' && result.yaml) {
      // Merge new widgets into the current tab instead of replacing all tabs.
      // This preserves existing widgets and avoids tab-ID mismatches.
      const existingIds = new Set(
        currentDashboard.tabs.flatMap(t => (t.widgets || []).map(w => w.id))
      );
      const newWidgets = (result.yaml.tabs || [])
        .flatMap(t => t.widgets || [])
        .filter(w => !existingIds.has(w.id));

      const tabs = currentDashboard.tabs.map((tab, idx) => {
        if (idx !== 0 && tab.id !== currentTabId) return tab;
        return { ...tab, widgets: [...(tab.widgets || []), ...newWidgets] };
      });
      updateDashboard(currentDashboard.id, {
        tabs,
        filters: result.yaml.filters || currentDashboard.filters,
        semanticViewsReferenced: result.yaml.semanticViewsReferenced || currentDashboard.semanticViewsReferenced,
      });
    } else if (result.action === 'add_widget' && result.yaml) {
      // Support both a single widget and an array of widgets
      const widgets = Array.isArray(result.yaml) ? result.yaml : [result.yaml];
      widgets.forEach(w => addWidget(currentDashboard.id, w));
    } else if (result.action === 'update_widget' && result.yaml?.widgetId && result.yaml?.widget) {
      const { widgetId, widget: aiWidget } = result.yaml;
      const tabs = currentDashboard.tabs.map(tab => ({
        ...tab,
        widgets: (tab.widgets || []).map(w => {
          if (w.id !== widgetId) return w;
          // Merge AI changes into existing widget instead of replacing.
          // Strip computed/runtime properties that should be derived from
          // the fields array, not set directly by the AI.
          const {
            chartQuery: _cq,
            queryDimensions: _qd,
            queryMeasures: _qm,
            ...cleanAiWidget
          } = aiWidget;
          return {
            ...w,
            ...cleanAiWidget,
            id: widgetId,
            position: aiWidget.position || w.position,
            config: { ...w.config, ...aiWidget.config },
            marks: { ...w.marks, ...aiWidget.marks },
            filtersApplied: aiWidget.filtersApplied?.length ? aiWidget.filtersApplied : w.filtersApplied,
            sortsApplied: aiWidget.sortsApplied?.length ? aiWidget.sortsApplied : w.sortsApplied,
          };
        }),
      }));
      updateDashboard(currentDashboard.id, { tabs });
    } else if (result.action === 'remove_widget' && result.yaml?.widgetId) {
      const { widgetId } = result.yaml;
      const tabs = currentDashboard.tabs.map(tab => ({
        ...tab,
        widgets: (tab.widgets || []).filter(w => w.id !== widgetId),
      }));
      updateDashboard(currentDashboard.id, { tabs });
      if (focusedWidgetId === widgetId && onFocusWidget) {
        onFocusWidget(null);
      }
    }
  }, [currentDashboard, currentTabId, updateDashboard, addWidget, saveUndoSnapshot, focusedWidgetId, onFocusWidget]);

  const handleSend = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    const userMsg = { id: Date.now(), role: 'user', content };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const assistantId = Date.now() + 1;
    const liveToolSteps = [];
    let statusText = 'Thinking...';

    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      statusText,
      toolSteps: [],
    }]);

    try {
      const chatMessages = [...messages, userMsg]
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }));

      let finalResult = null;

      await streamDashboardChat(
        {
          messages: chatMessages,
          currentYaml: getCurrentYaml(),
          focusedWidgetId: focusedWidgetId || undefined,
          semanticViewMetadata: viewMetadata,
          connectionId: currentDashboard?.connection_id,
          warehouse: currentDashboard?.warehouse,
          role: currentDashboard?.role,
          workspaceId: activeWorkspace?.id,
        },
        (event, data) => {
          switch (event) {
            case 'response.status':
              statusText = data.message;
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, statusText } : m
              ));
              break;
            case 'response.tool_step':
              liveToolSteps.push({ tool: data.tool, thinking: data.thinking, round: data.round ?? 0 });
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, toolSteps: [...liveToolSteps], statusText: data.thinking || statusText } : m
              ));
              break;
            case 'response.text.delta':
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: (m.content || '') + data.text } : m
              ));
              break;
            case 'response.result':
              finalResult = data;
              break;
            case 'error':
              throw new Error(data.error || 'AI chat failed');
          }
        },
      );

      if (finalResult) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? {
              ...m,
              content: finalResult.message || m.content || 'Done.',
              action: finalResult.action,
              generationTime: finalResult.generationTime,
              toolSteps: finalResult.toolSteps || liveToolSteps,
              isStreaming: false,
              statusText: undefined,
            }
            : m
        ));
        if (finalResult.action && finalResult.action !== 'none') {
          applyAction(finalResult);
        }
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false, statusText: undefined } : m
        ));
      }
    } catch (err) {
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== assistantId || (m.content && m.content.trim()));
        return [...filtered.filter(m => m.id !== assistantId), {
          id: assistantId,
          role: 'error',
          content: err.message || 'Something went wrong',
        }];
      });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, getCurrentYaml, focusedWidgetId, viewMetadata, currentDashboard, applyAction, activeWorkspace]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setUndoStack([]);
  };

  return (
    <div className={`ai-chat-panel ${isOpen ? 'open' : ''}`}>
      <div className="ai-chat-header">
        <div className="ai-chat-header-left">
          <FiZap className="ai-chat-icon" />
          <span>AI Assistant</span>
        </div>
        <div className="ai-chat-header-actions">
          {undoStack.length > 0 && (
            <button className="ai-chat-header-btn" onClick={handleUndo} title="Undo last AI change">
              <FiRotateCcw />
            </button>
          )}
          {messages.length > 0 && (
            <button className="ai-chat-header-btn" onClick={handleClearChat} title="Clear chat">
              <FiTrash2 />
            </button>
          )}
          <button className="ai-chat-header-btn" onClick={onClose} title="Close">
            <FiX />
          </button>
        </div>
      </div>

      {focusedWidget && (
        <div className="ai-chat-focus-bar">
          <FiTarget className="ai-chat-focus-icon" />
          <span className="ai-chat-focus-label">
            Focused: <strong>{focusedWidget.title}</strong>
          </span>
          <button className="ai-chat-focus-clear" onClick={() => onFocusWidget?.(null)}>
            <FiX />
          </button>
        </div>
      )}

      <div className="ai-chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="ai-chat-empty">
            <FiMessageSquare className="ai-chat-empty-icon" />
            <p>Ask me to build or modify your dashboard.</p>
            <p className="ai-chat-empty-hint">
              Click a widget to focus on it, then chat to make targeted edits.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`ai-chat-msg ai-chat-msg-${msg.role}`}>
            {msg.role === 'error' ? (
              <div className="ai-chat-msg-error">
                <FiAlertCircle />
                <span>{msg.content}</span>
              </div>
            ) : msg.role === 'system' ? (
              <div className="ai-chat-msg-system">{msg.content}</div>
            ) : (
              <>
                {msg.toolSteps?.length > 0 && (
                  <ToolStepRounds steps={msg.toolSteps} isStreaming={msg.isStreaming} />
                )}
                {msg.content ? (
                  <div className="ai-chat-msg-content">{msg.content}</div>
                ) : msg.isStreaming ? (
                  <div className="ai-chat-msg-loading">
                    <FiLoader className="ai-chat-spinner" />
                    <span>{msg.statusText || 'Thinking...'}</span>
                  </div>
                ) : null}
                {msg.action && msg.action !== 'none' && (
                  <div className="ai-chat-msg-action">
                    Applied: {msg.action.replace(/_/g, ' ')}
                    {msg.generationTime && ` (${(msg.generationTime / 1000).toFixed(1)}s)`}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {isLoading && !messages.some(m => m.isStreaming) && (
          <div className="ai-chat-msg ai-chat-msg-assistant">
            <div className="ai-chat-msg-loading">
              <FiLoader className="ai-chat-spinner" />
              <span>Analyzing data & building...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {messages.length === 0 && suggestions.length > 0 && (
        <div className="ai-chat-suggestions">
          {suggestions.map((s, i) => (
            <button key={i} className="ai-chat-suggestion" onClick={() => handleSend(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="ai-chat-input-bar">
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          placeholder={focusedWidget ? `Edit "${focusedWidget.title}"...` : 'Ask me anything about your dashboard...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isLoading}
        />
        <button
          className="ai-chat-send"
          onClick={() => handleSend()}
          disabled={!input.trim() || isLoading}
        >
          <FiSend />
        </button>
      </div>
    </div>
  );
};

export default AiChatPanel;
