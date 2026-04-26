import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FiZap, FiSend, FiLoader, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { streamDashboardChat } from '../../../api/apiClient';
import { useAppStore } from '../../../store/appStore';

const EditorCopilot = ({
  expanded,
  toggleSection,
  widget,
  widgetType,
  semanticViewId,
  columns,
  rows,
  filters,
  sorts,
  customColumns,
  viewMetadata,
  fieldMarkTypes,
  setWidgetType,
  setColumns,
  setRows,
  setTitle,
  setFilters,
  setSorts,
  setFieldMarkTypes,
  setCustomColumns,
}) => {
  const { currentDashboard } = useAppStore();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [expanded]);

  const getWidgetContext = useCallback(() => {
    return {
      type: widgetType,
      semanticView: semanticViewId,
      columns: columns.map(c => typeof c === 'object' ? c.name : c),
      rows: rows.map(r => typeof r === 'object' ? r.name : r),
      filters: filters?.map(f => ({ field: f.field, operator: f.operator, value: f.value, values: f.values })) || [],
      sorts: sorts?.map(s => ({ field: s.field, direction: s.direction })) || [],
      marks: fieldMarkTypes || {},
      customColumns: customColumns?.map(cc => ({ name: cc.name, expression: cc.expression })) || [],
      availableDimensions: viewMetadata?.dimensions || [],
      availableMeasures: viewMetadata?.measures || [],
    };
  }, [widgetType, semanticViewId, columns, rows, filters, sorts, fieldMarkTypes, customColumns, viewMetadata]);

  const getSmartSuggestions = useCallback(() => {
    const ctx = getWidgetContext();
    const s = [];
    if (ctx.columns.length === 0 && ctx.rows.length === 0) {
      s.push('Set up this widget for me');
    }
    if (ctx.columns.length > 0 && ctx.rows.length > 0) {
      s.push('Suggest a better chart type');
    }
    if (ctx.availableDimensions.length > 0 && ctx.columns.length > 0) {
      s.push('Add a color breakdown');
    }
    if (ctx.columns.length > 0 && ctx.rows.length > 0 && ctx.filters.length === 0) {
      s.push('Add useful filters');
    }
    return s.slice(0, 3);
  }, [getWidgetContext]);

  const handleSend = async (text) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    setInput('');
    setIsLoading(true);
    setLastResponse(null);

    try {
      const ctx = getWidgetContext();
      const fqn = currentDashboard?.semanticViewsReferenced?.find(
        v => v.name === semanticViewId
      )?.fullyQualifiedName || semanticViewId;

      const viewMeta = [{
        name: semanticViewId,
        fullyQualifiedName: fqn,
        dimensions: ctx.availableDimensions,
        measures: ctx.availableMeasures,
      }];

      const currentWidgetYaml = {
        id: widget?.id || 'new-widget',
        title: widget?.title || 'Untitled',
        type: widgetType,
        semanticView: fqn,
        fields: [
          ...columns.map(c => ({
            name: typeof c === 'object' ? c.name : c,
            shelf: 'columns',
            semanticType: 'dimension',
          })),
          ...rows.map(r => ({
            name: typeof r === 'object' ? r.name : r,
            shelf: 'rows',
            semanticType: 'measure',
          })),
        ],
        filtersApplied: ctx.filters,
        sortsApplied: ctx.sorts,
        customColumns: ctx.customColumns,
      };

      const systemMsg = `The user is editing a single widget in the widget editor. Current widget state:\n${JSON.stringify(currentWidgetYaml, null, 2)}\n\nRespond with update_widget action to modify this widget. The widgetId is "${currentWidgetYaml.id}".\n\nIMPORTANT RULES:\n\n1. FILTERS: Include a "filtersApplied" array when adding filters. Each filter: { field: "FIELD_NAME", operator: "IN"|"="|"!="|">"|"<"|">="|"<="|"LIKE"|"NOT IN"|"BETWEEN", value: "single_value" } OR { field: "FIELD_NAME", operator: "IN", values: ["val1","val2"] }.\n\n2. SORTS: Include a "sortsApplied" array: [{ field: "FIELD_NAME", direction: "ASC"|"DESC" }].\n\n3. CALCULATED FIELDS: When a request needs a derived/computed value that doesn't exist as a native dimension or measure, create it via "customColumns". Each entry: { name: "FIELD_NAME", expression: "SQL expression" }. Reference existing fields with bracket syntax: [EXISTING_FIELD]. Examples:\n   - Revenue per unit: { name: "REVENUE_PER_UNIT", expression: "[REVENUE] / [QUANTITY]" }\n   - Profit margin: { name: "PROFIT_MARGIN", expression: "([REVENUE] - [COST]) / [REVENUE] * 100" }\n   - Year extraction: { name: "ORDER_YEAR", expression: "YEAR([ORDER_DATE])" }\n   - Conditional: { name: "SIZE_CATEGORY", expression: "CASE WHEN [QUANTITY] > 100 THEN 'Large' WHEN [QUANTITY] > 10 THEN 'Medium' ELSE 'Small' END" }\n   After creating a calculated field, you can use its name in the fields array just like any other field. Set isCustomColumn: true and semanticType: "measure" (for numeric) or "dimension" (for categorical) on that field entry.\n\n4. Always include ALL existing fields, filters, sorts, and customColumns in your response to avoid losing state.`;

      let result = null;
      await streamDashboardChat(
        {
          messages: [
            { role: 'user', content: `${systemMsg}\n\nUser request: ${content}` },
          ],
          currentYaml: {
            tabs: [{ id: 'tab-1', title: 'Sheet 1', widgets: [currentWidgetYaml] }],
            semanticViewsReferenced: currentDashboard?.semanticViewsReferenced || [],
          },
          focusedWidgetId: currentWidgetYaml.id,
          semanticViewMetadata: viewMeta,
          connectionId: currentDashboard?.connection_id,
          warehouse: currentDashboard?.warehouse,
          role: currentDashboard?.role,
        },
        (event, data) => {
          if (event === 'response.result') result = data;
          if (event === 'error') throw new Error(data.error || 'AI chat failed');
        },
      );

      if (!result) result = { message: 'No response received', action: 'none' };
      setLastResponse(result);

      if (result.action === 'update_widget' && result.yaml?.widget) {
        applyWidgetChanges(result.yaml.widget);
      } else if (result.action === 'add_widget' && result.yaml) {
        const w = Array.isArray(result.yaml) ? result.yaml[0] : result.yaml;
        applyWidgetChanges(w);
      }
    } catch (err) {
      setLastResponse({ message: err.message || 'Something went wrong', action: 'none' });
    } finally {
      setIsLoading(false);
    }
  };

  const applyWidgetChanges = (w) => {
    if (w.type && w.type !== widgetType) {
      setWidgetType(w.type);
    }
    if (w.title) {
      setTitle(w.title);
    }
    if (w.fields && Array.isArray(w.fields)) {
      const newCols = w.fields
        .filter(f => f.shelf === 'columns')
        .map(f => f.name);
      const newRows = w.fields
        .filter(f => f.shelf === 'rows')
        .map(f => f.name);
      if (newCols.length > 0) setColumns(newCols);
      if (newRows.length > 0) setRows(newRows);

      const markUpdates = {};
      w.fields.forEach(f => {
        if (f.markType) markUpdates[f.name] = f.markType;
      });
      if (Object.keys(markUpdates).length > 0) {
        setFieldMarkTypes(prev => ({ ...prev, ...markUpdates }));
      }
    }

    if (Array.isArray(w.filtersApplied)) {
      const normalized = w.filtersApplied.map(f => ({
        field: f.field,
        operator: f.operator || 'IN',
        ...(f.values ? { values: f.values } : {}),
        ...(f.value !== undefined ? { value: f.value } : {}),
      }));
      setFilters(normalized);
    }

    if (Array.isArray(w.sortsApplied)) {
      const normalized = w.sortsApplied.map(s => ({
        field: s.field,
        direction: s.direction || 'ASC',
      }));
      setSorts(normalized);
    }

    if (Array.isArray(w.customColumns) && w.customColumns.length > 0) {
      setCustomColumns(prev => {
        const existingNames = new Set(prev.map(c => c.name.toUpperCase()));
        const newFields = w.customColumns
          .filter(cc => cc.name && cc.expression)
          .filter(cc => !existingNames.has(cc.name.toUpperCase()))
          .map(cc => ({
            id: crypto.randomUUID(),
            name: cc.name,
            expression: cc.expression,
            referencedFields: (cc.expression.match(/\[([^\]]+)\]/g) || []).map(m => m.slice(1, -1)),
            isAggregate: /\b(SUM|AVG|COUNT|MIN|MAX|COUNT_DISTINCT)\s*\(/i.test(cc.expression),
            isCalculated: true,
          }));
        return newFields.length > 0 ? [...prev, ...newFields] : prev;
      });
    }
  };

  const suggestions = expanded ? getSmartSuggestions() : [];

  return (
    <div className={`embedded-section collapsible ${expanded ? 'expanded' : ''}`}>
      <button className="section-toggle" onClick={() => toggleSection('copilot')}>
        <FiZap className="section-icon copilot-section-icon" />
        <span>AI Copilot</span>
        <span className="toggle-icon">{expanded ? <FiChevronDown /> : <FiChevronRight />}</span>
      </button>

      {expanded && (
        <div className="section-content copilot-section-content">
          {lastResponse && (
            <div className="copilot-response">
              <div className="copilot-response-text">{lastResponse.message}</div>
              {lastResponse.toolSteps?.length > 0 && (
                <div className="copilot-tool-steps">
                  {lastResponse.toolSteps.map((step, i) => (
                    <div key={i} className="copilot-tool-step">
                      <span className="copilot-tool-name">
                        {step.tool === 'sample_data' ? 'Sampled data' :
                         step.tool === 'check_cardinality' ? 'Checked cardinality' :
                         step.tool === 'test_query' ? 'Tested query' : step.tool}
                      </span>
                      {step.thinking && <span className="copilot-tool-thinking">{step.thinking}</span>}
                    </div>
                  ))}
                </div>
              )}
              {lastResponse.action && lastResponse.action !== 'none' && (
                <div className="copilot-action-badge">Applied changes</div>
              )}
            </div>
          )}

          {suggestions.length > 0 && !isLoading && !lastResponse && (
            <div className="copilot-suggestions">
              {suggestions.map((s, i) => (
                <button key={i} className="copilot-suggestion" onClick={() => handleSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="copilot-input-bar">
            <input
              ref={inputRef}
              className="copilot-input"
              placeholder="Ask copilot..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              disabled={isLoading}
            />
            <button
              className="copilot-send"
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
            >
              {isLoading ? <FiLoader className="spin" /> : <FiSend />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditorCopilot;
