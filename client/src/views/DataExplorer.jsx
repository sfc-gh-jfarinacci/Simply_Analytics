import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  FiSend,
  FiLoader,
  FiAlertCircle,
  FiDatabase,
  FiCheckCircle,
  FiChevronDown,
  FiPlus,
  FiTrash2,
  FiSearch,
  FiBarChart2,
} from 'react-icons/fi';
import { HiSparkles } from 'react-icons/hi2';
import { useAppStore } from '../store/appStore';
import { dashboardAiApi, semanticApi } from '../api/apiClient';
import '../styles/DataExplorer.css';

const DataExplorer = () => {
  const {
    isAuthenticated,
    currentDashboard,
    dashboards,
    semanticViewMetadataCache,
    setCachedViewMetadata,
  } = useAppStore();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [availableViews, setAvailableViews] = useState([]);
  const [selectedView, setSelectedView] = useState(null);
  const [viewMetadata, setViewMetadata] = useState(null);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Gather available connections from dashboards
  const connections = useMemo(() => {
    const map = new Map();
    (dashboards || []).forEach(d => {
      if (d.connection_id) {
        map.set(d.connection_id, {
          id: d.connection_id,
          label: d.title || d.connection_id,
          role: d.role,
          warehouse: d.warehouse,
          views: d.semanticViewsReferenced || [],
        });
      }
    });
    return Array.from(map.values());
  }, [dashboards]);

  // When a connection is selected, gather its views
  useEffect(() => {
    if (selectedConnection) {
      const conn = connections.find(c => c.id === selectedConnection);
      if (conn?.views?.length) {
        setAvailableViews(conn.views);
        if (!selectedView && conn.views[0]) {
          setSelectedView(conn.views[0]);
        }
      }
    }
  }, [selectedConnection, connections]);

  // Auto-select first connection
  useEffect(() => {
    if (!selectedConnection && connections.length > 0) {
      setSelectedConnection(connections[0].id);
    }
  }, [connections, selectedConnection]);

  // Load view metadata when a view is selected
  useEffect(() => {
    if (!selectedView?.fullyQualifiedName) return;
    const fqn = selectedView.fullyQualifiedName;
    const cached = semanticViewMetadataCache?.[fqn];
    if (cached) {
      setViewMetadata({ ...cached, fullyQualifiedName: fqn, name: selectedView.name });
      return;
    }
    const parts = fqn.replace(/"/g, '').split('.');
    if (parts.length === 3) {
      semanticApi.getViewMetadata(parts[0], parts[1], parts[2], selectedConnection)
        .then(meta => {
          if (meta?.columns) {
            const dims = [], meas = [];
            meta.columns.forEach(col => {
              const kind = (col.object_kind || '').toUpperCase();
              const name = col.object_name?.includes('.') ? col.object_name.split('.').pop() : col.object_name;
              if (kind === 'METRIC' || kind === 'MEASURE') meas.push(name);
              else if (kind === 'DIMENSION') dims.push(name);
            });
            const parsed = { dimensions: dims, measures: meas, fullyQualifiedName: fqn, name: selectedView.name };
            setViewMetadata(parsed);
            setCachedViewMetadata(fqn, parsed);
          }
        })
        .catch(() => {});
    }
  }, [selectedView, selectedConnection, semanticViewMetadataCache]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || isLoading || !selectedView) return;

    const userMsg = { id: Date.now(), role: 'user', content };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const conn = connections.find(c => c.id === selectedConnection);
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.role === 'assistant' ? m.summary : m.content }));

      const result = await dashboardAiApi.explore({
        question: content,
        semanticViewMetadata: viewMetadata ? [viewMetadata] : [],
        conversationHistory: history,
        connectionId: selectedConnection,
        role: conn?.role,
        warehouse: conn?.warehouse,
      });

      const assistantMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        summary: result.summary || 'No results.',
        findings: result.findings || [],
        suggestedWidget: result.suggestedWidget || null,
        toolSteps: result.toolSteps || [],
        generationTime: result.generationTime,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'error',
        content: err.message || 'Something went wrong',
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, selectedConnection, selectedView, viewMetadata, connections]);

  const suggestions = useMemo(() => {
    if (!viewMetadata) return [];
    const dims = viewMetadata.dimensions || [];
    const meas = viewMetadata.measures || [];
    const fmt = n => (n || '').replace(/_/g, ' ').toLowerCase();
    const s = [];
    if (meas[0] && dims[0]) s.push(`What is total ${fmt(meas[0])} by ${fmt(dims[0])}?`);
    if (meas[0]) s.push(`What are the trends in ${fmt(meas[0])}?`);
    if (dims[0] && dims[1] && meas[0]) s.push(`How does ${fmt(meas[0])} compare across ${fmt(dims[0])} and ${fmt(dims[1])}?`);
    if (meas[0]) s.push(`What anomalies exist in ${fmt(meas[0])}?`);
    return s.slice(0, 4);
  }, [viewMetadata]);

  const findingTypeIcon = (type) => {
    switch (type) {
      case 'anomaly': return '⚠️';
      case 'trend': return '📈';
      case 'comparison': return '⚖️';
      default: return '💡';
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="explorer-page">
        <div className="explorer-empty">
          <FiSearch className="explorer-empty-icon" />
          <h2>Data Explorer</h2>
          <p>Sign in to explore your data with AI.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="explorer-page">
      <div className="explorer-header">
        <div className="explorer-header-left">
          <HiSparkles className="explorer-logo" />
          <h1>Data Explorer</h1>
        </div>
        <div className="explorer-selectors">
          {availableViews.length > 0 && (
            <select
              className="explorer-select"
              value={selectedView?.fullyQualifiedName || ''}
              onChange={e => {
                const v = availableViews.find(av => av.fullyQualifiedName === e.target.value);
                setSelectedView(v || null);
              }}
            >
              {availableViews.map(v => (
                <option key={v.fullyQualifiedName} value={v.fullyQualifiedName}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="explorer-chat">
        <div className="explorer-messages">
          {messages.length === 0 && (
            <div className="explorer-welcome">
              <HiSparkles className="explorer-welcome-icon" />
              <h2>Ask a question about your data</h2>
              <p>The AI will query your data, analyze results, and surface findings.</p>
              {selectedView && (
                <div className="explorer-meta-badge">
                  <FiDatabase />
                  <span>{selectedView.name}</span>
                  {viewMetadata && (
                    <span className="explorer-meta-counts">
                      {viewMetadata.dimensions?.length || 0} dimensions, {viewMetadata.measures?.length || 0} measures
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`explorer-msg explorer-msg-${msg.role}`}>
              {msg.role === 'user' && (
                <div className="explorer-msg-content">{msg.content}</div>
              )}
              {msg.role === 'error' && (
                <div className="explorer-msg-error">
                  <FiAlertCircle />
                  <span>{msg.content}</span>
                </div>
              )}
              {msg.role === 'assistant' && (
                <div className="explorer-msg-assistant">
                  {msg.toolSteps?.length > 0 && (
                    <div className="explorer-tool-steps">
                      {msg.toolSteps.map((step, i) => (
                        <div key={i} className="explorer-tool-step">
                          <FiCheckCircle className="tool-ok" />
                          <span className="tool-label">
                            {step.tool === 'query_data' ? 'Queried data' : 'Checked cardinality'}
                          </span>
                          {step.thinking && <span className="tool-thought">{step.thinking}</span>}
                          {step.result?.rowCount != null && (
                            <span className="tool-stat">{step.result.rowCount} rows</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="explorer-summary">{msg.summary}</div>

                  {msg.findings?.length > 0 && (
                    <div className="explorer-findings">
                      {msg.findings.map((f, i) => (
                        <div key={i} className="explorer-finding">
                          <span className="finding-icon">{findingTypeIcon(f.type)}</span>
                          <div>
                            <div className="finding-label">{f.label}</div>
                            <div className="finding-detail">{f.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.suggestedWidget && (
                    <div className="explorer-widget-suggestion">
                      <FiBarChart2 className="suggestion-chart-icon" />
                      <span>Suggested: <strong>{msg.suggestedWidget.title}</strong> ({msg.suggestedWidget.type})</span>
                      <button
                        className="suggestion-pin-btn"
                        onClick={() => {/* TODO: pin to dashboard */}}
                        title="Pin to dashboard"
                      >
                        <FiPlus /> Pin
                      </button>
                    </div>
                  )}

                  {msg.generationTime && (
                    <div className="explorer-msg-time">{(msg.generationTime / 1000).toFixed(1)}s</div>
                  )}
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="explorer-msg explorer-msg-assistant">
              <div className="explorer-msg-loading">
                <FiLoader className="explorer-spinner" />
                <span>Investigating your data...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {messages.length === 0 && suggestions.length > 0 && (
          <div className="explorer-suggestions">
            {suggestions.map((s, i) => (
              <button key={i} className="explorer-suggestion" onClick={() => handleSend(s)}>
                <FiSearch />
                <span>{s}</span>
              </button>
            ))}
          </div>
        )}

        <div className="explorer-input-bar">
          <textarea
            ref={inputRef}
            className="explorer-input"
            placeholder={selectedView ? `Ask about ${selectedView.name}...` : 'Select a data source first...'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
            rows={1}
            disabled={isLoading || !selectedView}
          />
          <button
            className="explorer-send"
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading || !selectedView}
          >
            <FiSend />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataExplorer;
