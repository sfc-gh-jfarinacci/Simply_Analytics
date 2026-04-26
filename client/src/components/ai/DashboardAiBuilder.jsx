import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FiX,
  FiZap,
  FiLoader,
  FiCheck,
  FiAlertCircle,
  FiCode,
  FiRefreshCw,
} from 'react-icons/fi';
import { useAppStore } from '../../store/appStore';
import { dashboardAiApi } from '../../api/apiClient';
import '../../styles/DashboardAiBuilder.css';

const LABELS = {
  generate: { title: 'Generate Dashboard', label: 'Describe the dashboard you want to create:', placeholder: 'e.g., Dashboard with trends, breakdowns, and KPIs...', button: 'Generate' },
  modify:   { title: 'Modify Dashboard',   label: 'Describe the changes you want to make:',    placeholder: 'e.g., Add a pie chart, change the layout...',      button: 'Modify' },
  widget:   { title: 'Add Widget',          label: 'Describe the widget you want to add:',      placeholder: 'e.g., Bar chart of totals by category...',          button: 'Add Widget' },
};

function buildSuggestions(mode, metadata) {
  if (!metadata || metadata.length === 0) return [];

  const dims = metadata.flatMap(v => (v.dimensions || []).map(d => typeof d === 'string' ? d : d.name));
  const measures = metadata.flatMap(v => (v.measures || []).map(m => typeof m === 'string' ? m : m.name));
  const facts = metadata.flatMap(v => (v.facts || []).map(f => typeof f === 'string' ? f : f.name));
  const timeDims = dims.filter(d => /date|time|month|year|week|quarter|day|period|created|updated/i.test(d));
  const catDims = dims.filter(d => !timeDims.includes(d));
  const fmt = (n) => n.replace(/_/g, ' ').toLowerCase();

  const s = [];

  if (mode === 'generate') {
    if (measures[0] && catDims[0])
      s.push(`Dashboard showing ${fmt(measures[0])} by ${fmt(catDims[0])}`);
    if (measures[0] && timeDims[0])
      s.push(`Trends dashboard with ${measures.slice(0, 3).map(fmt).join(', ')} over ${fmt(timeDims[0])}`);
    if (measures.length > 1)
      s.push(`KPI dashboard with cards for ${measures.slice(0, 4).map(fmt).join(', ')}`);
    if (catDims[0] && measures[0])
      s.push(`Top 10 ${fmt(catDims[0])} by ${fmt(measures[0])} with comparison table`);
  } else if (mode === 'modify') {
    if (timeDims[0] && measures[0])
      s.push(`Add a line chart of ${fmt(measures[0])} over ${fmt(timeDims[0])}`);
    if (measures.length > 0)
      s.push(`Add KPI cards for ${measures.slice(0, 3).map(fmt).join(', ')}`);
    if (catDims[0] && measures[0])
      s.push(`Add a pie chart of ${fmt(measures[0])} by ${fmt(catDims[0])}`);
    if (catDims[0])
      s.push(`Add a data table with ${catDims.slice(0, 3).map(fmt).join(', ')} details`);
    if (catDims[1] && measures[0])
      s.push(`Add a bar chart comparing ${fmt(measures[0])} across ${fmt(catDims[1])}`);
  } else {
    if (catDims[0] && measures[0])
      s.push(`Bar chart of ${fmt(measures[0])} by ${fmt(catDims[0])}`);
    if (timeDims[0] && measures[0])
      s.push(`Line chart of ${fmt(measures[0])} over ${fmt(timeDims[0])}`);
    if (measures[0])
      s.push(`KPI card for ${fmt(measures[0])}`);
    if (catDims[1] && measures[0])
      s.push(`Pie chart of ${fmt(measures[0])} by ${fmt(catDims[1] || catDims[0])}`);
    if (catDims[0] && facts[0])
      s.push(`Table of ${catDims.slice(0, 3).map(fmt).join(', ')} with ${facts.slice(0, 2).map(fmt).join(', ')}`);
    if (catDims[0] && measures[0])
      s.push(`Top 10 ${fmt(catDims[0])} by ${fmt(measures[0])}`);
  }

  return s.slice(0, 5);
}

const DashboardAiBuilder = ({ isOpen, onClose, onDashboardGenerated, onWidgetGenerated, mode = 'modify' }) => {
  const {
    currentDashboard,
    currentTabId,
    semanticViewMetadataCache,
    updateDashboard,
    activeWorkspace,
  } = useAppStore();

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [showYaml, setShowYaml] = useState(false);
  const textareaRef = useRef(null);

  const cfg = LABELS[mode] || LABELS.modify;

  useEffect(() => {
    if (isOpen && textareaRef.current) textareaRef.current.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) { setPrompt(''); setError(null); setResult(null); setShowYaml(false); }
  }, [isOpen]);

  const getSemanticViewMetadata = () => {
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
  };

  const viewMetadata = useMemo(() => {
    if (!isOpen) return null;
    return getSemanticViewMetadata();
  }, [isOpen, currentDashboard, semanticViewMetadataCache]);

  const suggestions = useMemo(() => buildSuggestions(mode, viewMetadata), [mode, viewMetadata]);

  const getExistingWidgets = () => {
    if (!currentDashboard?.tabs) return [];
    const tab = currentDashboard.tabs.find(t => t.id === currentTabId);
    return (tab?.widgets || []).map(w => ({ id: w.id, type: w.type, title: w.title, position: w.position }));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const metadata = viewMetadata;
      const baseBody = {
        prompt: prompt.trim(),
        semanticViewMetadata: mode === 'widget' ? (metadata?.[0] || null) : metadata,
        connectionId: currentDashboard?.connection_id,
        warehouse: currentDashboard?.warehouse,
        role: currentDashboard?.role,
        workspaceId: activeWorkspace?.id,
      };

      let data;
      if (mode === 'widget') {
        data = await dashboardAiApi.generateWidget({ ...baseBody, existingWidgets: getExistingWidgets() });
        if (data.widget && onWidgetGenerated) {
          onWidgetGenerated(data.widget);
          onClose();
          return;
        }
      } else if (mode === 'modify') {
        data = await dashboardAiApi.modify({
          ...baseBody,
          dashboardId: currentDashboard?.id,
          currentYaml: currentDashboard ? {
            tabs: currentDashboard.tabs,
            filters: currentDashboard.filters,
            semanticViewsReferenced: currentDashboard.semanticViewsReferenced,
            customColorSchemes: currentDashboard.customColorSchemes,
          } : undefined,
        });
      } else {
        data = await dashboardAiApi.generate(baseBody);
      }
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = () => {
    if (!result?.yamlContent) return;
    const yamlContent = result.yamlContent;
    if (currentDashboard) {
      updateDashboard(currentDashboard.id, {
        tabs: yamlContent.tabs || currentDashboard.tabs,
        filters: yamlContent.filters || currentDashboard.filters,
        semanticViewsReferenced: yamlContent.semanticViewsReferenced || currentDashboard.semanticViewsReferenced,
      });
    }
    if (onDashboardGenerated) onDashboardGenerated(yamlContent);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="ai-builder-overlay" onClick={onClose}>
      <div className="ai-builder-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ai-builder-header">
          <div className="ai-builder-header-left">
            <FiZap className="ai-builder-icon" />
            <h2>{cfg.title}</h2>
          </div>
          <button className="ai-builder-close" onClick={onClose}><FiX /></button>
        </div>

        <div className="ai-builder-body">
          <div className="ai-builder-input-section">
            <label className="ai-builder-label">{cfg.label}</label>
            <textarea
              ref={textareaRef}
              className="ai-builder-textarea"
              placeholder={cfg.placeholder}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={mode === 'widget' ? 2 : 4}
              disabled={isGenerating}
            />
            <div className="ai-builder-hint">
              Press <kbd>⌘</kbd>+<kbd>Enter</kbd> to {cfg.button.toLowerCase()}
            </div>
          </div>

          {!result && !isGenerating && suggestions.length > 0 && (
            <div className="ai-builder-suggestions">
              <span className="ai-builder-suggestions-label">Suggestions:</span>
              <div className="ai-builder-suggestion-chips">
                {suggestions.map((s, i) => (
                  <button key={i} className="ai-builder-chip" onClick={() => setPrompt(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {isGenerating && (
            <div className="ai-builder-loading">
              <FiLoader className="ai-builder-spinner" />
              <span>Generating...</span>
            </div>
          )}

          {error && (
            <div className="ai-builder-error">
              <FiAlertCircle />
              <span>{error}</span>
              <button onClick={() => setError(null)}>Dismiss</button>
            </div>
          )}

          {result && (
            <div className="ai-builder-result">
              <div className="ai-builder-result-header">
                <FiCheck className="ai-builder-success-icon" />
                <span>Generated in {(result.generationTime / 1000).toFixed(1)}s</span>
              </div>
              <div className="ai-builder-result-summary">
                <div className="ai-builder-stat">
                  <span className="ai-builder-stat-value">{result.yamlContent?.tabs?.length || 0}</span>
                  <span className="ai-builder-stat-label">Tabs</span>
                </div>
                <div className="ai-builder-stat">
                  <span className="ai-builder-stat-value">{result.yamlContent?.tabs?.reduce((acc, tab) => acc + (tab.widgets?.length || 0), 0) || 0}</span>
                  <span className="ai-builder-stat-label">Widgets</span>
                </div>
                <div className="ai-builder-stat">
                  <span className="ai-builder-stat-value">{result.yamlContent?.semanticViewsReferenced?.length || 0}</span>
                  <span className="ai-builder-stat-label">Views</span>
                </div>
              </div>
              <div className="ai-builder-result-actions">
                <button className="ai-builder-btn ai-builder-btn-secondary" onClick={() => setShowYaml(!showYaml)}>
                  <FiCode /> {showYaml ? 'Hide YAML' : 'Preview YAML'}
                </button>
                <button className="ai-builder-btn ai-builder-btn-secondary" onClick={() => { setResult(null); setError(null); }}>
                  <FiRefreshCw /> Regenerate
                </button>
              </div>
              {showYaml && <pre className="ai-builder-yaml-preview">{result.yamlString}</pre>}
            </div>
          )}
        </div>

        <div className="ai-builder-footer">
          <button className="ai-builder-btn ai-builder-btn-cancel" onClick={onClose}>Cancel</button>
          {result ? (
            <button className="ai-builder-btn ai-builder-btn-primary" onClick={handleApply}>
              <FiCheck /> Apply to Dashboard
            </button>
          ) : (
            <button className="ai-builder-btn ai-builder-btn-primary" onClick={handleGenerate} disabled={!prompt.trim() || isGenerating}>
              <FiZap /> {isGenerating ? 'Generating...' : cfg.button}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardAiBuilder;
