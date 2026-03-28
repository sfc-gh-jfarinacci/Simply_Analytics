import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '../../store/appStore';
import { isNetworkPolicyError } from '../../api/apiClient';
import '../../styles/DashboardWidget.css';
import { renderChart as sharedRenderChart } from '../charts/ChartRenderer';
import WidgetEditor from '../widget-editor';
import { useStableResize } from '../charts';

// Extracted hooks
import useWidgetFields from './hooks/useWidgetFields';
import useWidgetData from './hooks/useWidgetData';
import useWidgetInsights from './hooks/useWidgetInsights';

// Extracted components
import ChartErrorBoundary from './components/ChartErrorBoundary';
import TitleWidget from './components/TitleWidget';
import FilterWidget from './components/FilterWidget';
import ExpandedWidgetModal from './components/ExpandedWidgetModal';
import InsightsModal from './components/InsightsModal';
import WidgetMenu from './components/WidgetMenu';

// Extracted utilities
import { computeWidgetColors, exportToCSV, getWidgetIcon } from './utils.jsx';

// Icons used in the orchestrator template only
import {
  FiMoreVertical, FiEdit3, FiTrash2, FiRefreshCw, FiMove,
  FiBarChart2, FiTable, FiMaximize, FiPause, FiLayers, FiX,
} from 'react-icons/fi';
import { HiSparkles } from 'react-icons/hi2';

const DashboardWidget = ({
  widgetId, tabId, widget, onEdit, onDelete, onResize,
  onUpdateTitle, onSelect, layoutMode = 'adaptive', devicePreview = 'desktop',
  canvasColor, isGridLayout = false, isEditMode = false, isSelected = false,
  isEditing = false, dashboardId, onAutoSave, onCloseEditor, gridPosition,
}) => {
  const {
    currentDashboard, dashboardConnectionError,
    widgetRefreshKey, dashboardFilters,
  } = useAppStore();

  // ── Local UI state ──
  const [showMenu, setShowMenu] = useState(false);
  const [isResizing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandKey, setExpandKey] = useState(0);
  const [showData, setShowData] = useState(false);
  const [size, setSize] = useState(() => ({
    width: (typeof widget.position?.w === 'number' && widget.position.w > 0) ? widget.position.w : 4,
    height: (typeof widget.position?.h === 'number' && widget.position.h > 0) ? widget.position.h : 3,
  }));

  const widgetRef = useRef(null);
  const menuRef = useRef(null);

  // ── Parsed fields ──
  const {
    dimensions, measures, chartMeasures, aggregatedFields,
    columnDimensions, rowDimensions, colorField, clusterField,
    detailFields, tooltipFields, labelFields,
    liveWidgetType, liveSemanticViewId, queryConfig,
  } = useWidgetFields(widget);

  const effectiveWidgetType = liveWidgetType || widget.type;

  // ── Semantic view FQN ──
  const semanticViewFQN = useMemo(() => {
    const resolveToFQN = (viewId) => {
      if (!viewId) return null;
      if (viewId.includes('.')) return viewId;
      if (currentDashboard?.semanticViewsReferenced) {
        const dv = currentDashboard.semanticViewsReferenced.find(v => (typeof v === 'string' ? v : v.name) === viewId);
        if (typeof dv === 'object' && dv?.fullyQualifiedName) return dv.fullyQualifiedName;
      }
      return viewId;
    };
    if (liveSemanticViewId) return resolveToFQN(liveSemanticViewId);
    const viewRef = widget.semanticViewsReferenced?.[0];
    if (viewRef?.fullyQualifiedName) return viewRef.fullyQualifiedName;
    if (viewRef?.name) return resolveToFQN(viewRef.name);
    if (widget.semanticView) return resolveToFQN(widget.semanticView);
    return resolveToFQN(widget.modelId);
  }, [widget.semanticViewsReferenced, widget.semanticView, widget.modelId, liveSemanticViewId, currentDashboard?.semanticViewsReferenced]);

  // ── Filters, sorts, custom columns, aliases ──
  const filtersApplied = useMemo(() => queryConfig?.filters || widget.filtersApplied || [], [queryConfig?.filters, widget.filtersApplied]);
  const sortsApplied = useMemo(() => queryConfig?.orderBy || widget.sortsApplied || [], [queryConfig?.orderBy, widget.sortsApplied]);

  const mergedFilters = useMemo(() => {
    const globalFilters = Object.values(dashboardFilters || {}).filter(f => f?.field && f.values?.length > 0);
    return globalFilters.length ? [...filtersApplied, ...globalFilters] : filtersApplied;
  }, [filtersApplied, dashboardFilters]);

  const widgetSemanticViewName = widget.semanticViewsReferenced?.[0]?.name;

  const dashboardCalcFieldsForView = useMemo(() => {
    const svs = currentDashboard?.semanticViewsReferenced || [];
    const sv = svs.find(v => (typeof v === 'string' ? v : v.name) === widgetSemanticViewName);
    return (typeof sv === 'object' ? sv.calculatedFields : []) || [];
  }, [currentDashboard?.semanticViewsReferenced, widgetSemanticViewName]);

  const ensureCalcFieldIds = (fields) => (fields || []).map(f => f.id ? f : { ...f, id: crypto.randomUUID() });

  const customColumns = useMemo(() => {
    if (queryConfig?.customColumns) return ensureCalcFieldIds(queryConfig.customColumns);
    const merged = [...ensureCalcFieldIds(widget.customColumns)];
    ensureCalcFieldIds(dashboardCalcFieldsForView).forEach(dcf => {
      if (!merged.some(w => w.name === dcf.name)) merged.push(dcf);
    });
    return merged;
  }, [widget.customColumns, dashboardCalcFieldsForView, queryConfig?.customColumns]);

  const dashboardAliasesForView = useMemo(() => {
    const svs = currentDashboard?.semanticViewsReferenced || [];
    const sv = svs.find(v => (typeof v === 'string' ? v : v.name) === widgetSemanticViewName);
    return (typeof sv === 'object' ? sv.columnAliases : null) || {};
  }, [currentDashboard?.semanticViewsReferenced, widgetSemanticViewName]);

  const columnAliases = useMemo(() => {
    if (Object.keys(dashboardAliasesForView).length > 0) return { ...dashboardAliasesForView, ...widget.config?.columnAliases };
    return widget.config?.columnAliases || {};
  }, [widget.config?.columnAliases, dashboardAliasesForView]);

  const effectiveConfig = useMemo(() => ({
    ...widget.config, columnAliases, sorts: sortsApplied,
  }), [widget.config, columnAliases, sortsApplied]);

  // ── Data loading (extracted hook) ──
  const { data, loading, hasAttemptedLoad, error, loadData, autoInsightSummary } = useWidgetData({
    widget, effectiveWidgetType, semanticViewFQN,
    dimensions, measures, aggregatedFields, columnDimensions,
    mergedFilters, sortsApplied, customColumns,
  });

  // ── Insights (extracted hook) ──
  const {
    showInsights, setShowInsights,
    insights, insightsLoading, insightsError,
    generateInsights,
  } = useWidgetInsights({ widget, semanticViewFQN, data });

  // ── DnD / Sortable ──
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id, disabled: isResizing || !isEditMode,
  });

  // ── Close menu on outside click ──
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 10);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [showMenu]);

  // ── Sync size from widget.position ──
  useEffect(() => {
    const w = widget.position?.w, h = widget.position?.h;
    if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) setSize({ width: w, height: h });
  }, [widget.position?.w, widget.position?.h]);

  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);

  // ── GridStack drag implementation ──
  const dragStartRef = useRef({ x: 0, y: 0, itemX: 0, itemY: 0 });
  const [isDraggingWidget, setIsDraggingWidget] = useState(false);

  const handleDragMove = useCallback((e) => {
    if (!isGridLayout || !widgetRef.current) return;
    const el = widgetRef.current;
    el.style.transform = `translate(${e.clientX - dragStartRef.current.x}px, ${e.clientY - dragStartRef.current.y}px)`;
    el.style.zIndex = '1000';
    el.style.opacity = '0.8';
  }, [isGridLayout]);

  const handleDragEnd = useCallback((e) => {
    setIsDraggingWidget(false);
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    if (!widgetRef.current) return;
    const gridStackItem = widgetRef.current;
    const gridEl = widgetRef.current.closest('.grid-stack');
    if (!gridStackItem || !gridEl) return;
    const grid = gridEl.gridstack;
    if (!grid) { gridStackItem.style.transform = ''; gridStackItem.style.zIndex = ''; gridStackItem.style.opacity = ''; return; }
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    const containerWidth = gridEl.offsetWidth || 1200;
    const cellWidth = containerWidth / 12;
    const cellHeight = 80;
    const currentW = gridStackItem.gridstackNode?.w ?? (parseInt(gridStackItem.getAttribute('gs-w')) || 4);
    const currentH = gridStackItem.gridstackNode?.h ?? (parseInt(gridStackItem.getAttribute('gs-h')) || 3);
    const newX = Math.max(0, Math.min(12 - currentW, dragStartRef.current.itemX + Math.round(deltaX / cellWidth)));
    const newY = Math.max(0, dragStartRef.current.itemY + Math.round(deltaY / cellHeight));
    gridStackItem.style.transform = ''; gridStackItem.style.zIndex = ''; gridStackItem.style.opacity = '';
    grid.update(gridStackItem, { x: newX, y: newY, w: currentW, h: currentH });
    if (widgetRef.current) {
      widgetRef.current.dataset.justResized = '1';
      requestAnimationFrame(() => { if (widgetRef.current) delete widgetRef.current.dataset.justResized; });
    }
  }, [handleDragMove, isGridLayout]);

  const handleDragStart = useCallback((e) => {
    if (e.target.closest('button, input, .widget-actions, .inline-edit-widget-title, .resize-handle')) return;
    if (!isGridLayout || !isEditMode) return;
    e.preventDefault();
    setIsDraggingWidget(true);
    const el = widgetRef.current;
    const dn = el?.gridstackNode;
    dragStartRef.current = {
      x: e.clientX, y: e.clientY,
      itemX: dn?.x ?? (parseInt(el?.getAttribute('gs-x')) || 0),
      itemY: dn?.y ?? (parseInt(el?.getAttribute('gs-y')) || 0),
    };
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }, [isGridLayout, isEditMode, handleDragMove, handleDragEnd]);

  useEffect(() => () => {
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
  }, [handleDragMove, handleDragEnd]);

  // ── Widget style ──
  const getWidgetStyle = () => {
    if (isGridLayout) return { opacity: isDragging ? 0.5 : 1 };
    const w = size.width || widget.position?.w || 4;
    const h = size.height || widget.position?.h || 3;
    return {
      transform: CSS.Transform.toString(transform),
      transition: isResizing ? 'none' : transition,
      opacity: isDragging ? 0.5 : 1,
      width: `${Math.max(w * 120, 250)}px`,
      height: `${Math.max(h * 80, 200)}px`,
    };
  };

  const style = getWidgetStyle();
  const widgetColors = computeWidgetColors(canvasColor);
  const colorStyle = widgetColors ? {
    '--widget-bg': widgetColors.widgetBg, '--widget-header-bg': widgetColors.headerBg,
    '--widget-border': widgetColors.borderColor, '--widget-text': widgetColors.textColor,
  } : {};

  // ── Chart query ──
  const buildChartQuery = () => {
    const cq = widget.chartQuery;
    const valid = cq && (cq.xAxis?.length > 0 || cq.measures?.length > 0);
    return valid ? cq : {
      xAxis: columnDimensions, rows: rowDimensions,
      series: colorField ? [colorField] : rowDimensions,
      measures: chartMeasures, marks: widget.marks || {},
      colorField, clusterField, tooltipFields, detailFields, labelFields: labelFields || [],
    };
  };

  // ── renderContent ──
  const renderContent = () => {
    if (effectiveWidgetType === 'title') {
      return <TitleWidget config={widget.config} title={widget.title} isEditing={isEditing} isEditMode={isEditMode} />;
    }
    if (effectiveWidgetType === 'filter') {
      return <FilterWidget widget={widget} semanticViewFQN={semanticViewFQN} isEditMode={isEditMode} onEdit={onEdit} />;
    }

    if (loading) {
      return (
        <div className="widget-loading-state">
          <div className="widget-chart-skeleton">
            <svg viewBox="0 0 160 80" preserveAspectRatio="xMidYMid meet">
              <rect x="10" y="48" width="18" height="28" rx="2" className="skel-bar" />
              <rect x="34" y="30" width="18" height="46" rx="2" className="skel-bar" style={{ animationDelay: '0.1s' }} />
              <rect x="58" y="38" width="18" height="38" rx="2" className="skel-bar" style={{ animationDelay: '0.2s' }} />
              <rect x="82" y="18" width="18" height="58" rx="2" className="skel-bar" style={{ animationDelay: '0.3s' }} />
              <rect x="106" y="42" width="18" height="34" rx="2" className="skel-bar" style={{ animationDelay: '0.4s' }} />
              <rect x="130" y="52" width="18" height="24" rx="2" className="skel-bar" style={{ animationDelay: '0.5s' }} />
              <line x1="6" y1="76" x2="154" y2="76" className="skel-axis" />
              <line x1="6" y1="10" x2="6" y2="76" className="skel-axis" />
            </svg>
          </div>
        </div>
      );
    }

    const displayError = error || dashboardConnectionError;
    if (displayError) {
      const isNP = isNetworkPolicyError({ message: displayError });
      return (
        <div className="widget-error">
          <span>⚠️ {displayError}</span>
          {isNP ? (
            <p className="widget-error-hint">Use the Reconnect button in the toolbar above.</p>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => loadData(true)}><FiRefreshCw /> Retry</button>
          )}
        </div>
      );
    }

    const hasSemanticView = semanticViewFQN || widget.semanticViewsReferenced?.length > 0;
    const hasMeasures = chartMeasures.length > 0 || widget.query?.measures?.length > 0;
    const hasDimensions = dimensions.length > 0 || widget.query?.dimensions?.length > 0;
    const needsDimensions = !['metric', 'histogram'].includes(effectiveWidgetType);
    const needsMeasures = !['table'].includes(effectiveWidgetType);
    const hasAnyFields = hasDimensions || hasMeasures;
    const isTable = effectiveWidgetType === 'table';

    if (!hasSemanticView || (!isTable && ((!hasMeasures && needsMeasures) || (!hasDimensions && needsDimensions))) || (isTable && !hasAnyFields)) {
      if (isEditing) return <div className="widget-empty empty-preview"><FiBarChart2 style={{ fontSize: 32, opacity: 0.3 }} /><span>Add fields to see preview</span></div>;
      if (!isEditMode) return <div className="widget-empty widget-not-configured"><FiLayers style={{ fontSize: 24, opacity: 0.5 }} /><span>Content not available</span></div>;
      return <div className="widget-empty"><span>Configure this widget</span><button className="btn btn-primary btn-sm" onClick={onEdit}><FiEdit3 /> Configure</button></div>;
    }

    const dataRows = Array.isArray(data) ? data : data?.rows;
    if (!hasAttemptedLoad && !data) {
      return (
        <div className="widget-loading-state">
          <div className="widget-chart-skeleton">
            <svg viewBox="0 0 160 80" preserveAspectRatio="xMidYMid meet">
              <rect x="10" y="48" width="18" height="28" rx="2" className="skel-bar" />
              <rect x="34" y="30" width="18" height="46" rx="2" className="skel-bar" style={{ animationDelay: '0.1s' }} />
              <rect x="58" y="38" width="18" height="38" rx="2" className="skel-bar" style={{ animationDelay: '0.2s' }} />
              <rect x="82" y="18" width="18" height="58" rx="2" className="skel-bar" style={{ animationDelay: '0.3s' }} />
              <rect x="106" y="42" width="18" height="34" rx="2" className="skel-bar" style={{ animationDelay: '0.4s' }} />
              <rect x="130" y="52" width="18" height="24" rx="2" className="skel-bar" style={{ animationDelay: '0.5s' }} />
              <line x1="6" y1="76" x2="154" y2="76" className="skel-axis" />
              <line x1="6" y1="10" x2="6" y2="76" className="skel-axis" />
            </svg>
          </div>
        </div>
      );
    }

    if (!dataRows?.length) return <div className="widget-empty"><span>No data available</span></div>;

    const chartKey = `${widget.id}-chart`;
    const chartQuery = buildChartQuery();

    if (showData && effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot') {
      return sharedRenderChart('table', data, effectiveConfig, chartQuery, `${chartKey}-data`);
    }
    return sharedRenderChart(effectiveWidgetType, data, effectiveConfig, chartQuery, chartKey);
  };

  // ── Refs ──
  const combinedRef = useCallback((node) => { setNodeRef(node); widgetRef.current = node; }, [setNodeRef]);
  const gridLayoutStyle = isGridLayout ? {} : style;

  const handleWidgetClick = (e) => {
    if (widgetRef.current?.dataset?.justResized) return;
    if (isEditMode && onSelect) { e.stopPropagation(); onSelect(widget); }
  };

  const gridStackAttrs = isGridLayout && gridPosition ? {
    'data-widget-id': widget.id,
    'gs-x': gridPosition.x, 'gs-y': gridPosition.y,
    'gs-w': gridPosition.w, 'gs-h': gridPosition.h,
    'gs-min-w': gridPosition.minW || 1, 'gs-min-h': gridPosition.minH || 1,
  } : {};

  // ── Editing mode: show embedded WidgetEditor ──
  if (isEditing && onAutoSave && onCloseEditor) {
    return (
      <div
        ref={combinedRef}
        style={{ ...gridLayoutStyle, ...colorStyle, minHeight: '500px' }}
        className={`dashboard-widget ${isGridLayout ? 'grid-stack-item' : ''} editing editing-widget ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''} ${canvasColor ? 'has-canvas-color' : ''} ${isGridLayout ? 'grid-layout-widget' : ''} ${isEditMode ? 'edit-mode-widget' : ''} selected`}
        onClick={(e) => e.stopPropagation()}
        {...gridStackAttrs}
      >
        <WidgetEditor widget={widget} dashboardId={dashboardId} isNew={false} embedded onClose={onCloseEditor} onAutoSave={onAutoSave} />
      </div>
    );
  }

  // ── Main render ──
  return (
    <div
      ref={combinedRef}
      style={{ ...gridLayoutStyle, ...colorStyle }}
      className={`dashboard-widget ${isGridLayout ? 'grid-stack-item' : ''} ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''} ${canvasColor ? 'has-canvas-color' : ''} ${isGridLayout ? 'grid-layout-widget' : ''} ${isEditMode ? 'edit-mode-widget' : ''} ${isSelected ? 'panel-editing' : ''} ${loading ? 'is-loading' : ''} title-pos-${widget.config?.titlePosition || 'top-left'} ${widget.config?.showTitle === false ? 'title-hidden' : ''} ${effectiveWidgetType === 'title' ? 'widget-type-title' : ''} ${effectiveWidgetType === 'filter' ? 'widget-type-filter' : ''} ${effectiveWidgetType === 'metric' ? 'widget-type-metric' : ''}`}
      onClick={handleWidgetClick}
      {...gridStackAttrs}
    >
      {loading && <div className="widget-loading-bar" />}

      {/* Header */}
      <div
        className={`widget-header ${isGridLayout && isEditMode ? 'widget-drag-handle draggable-header' : ''} ${isDraggingWidget ? 'dragging' : ''}`}
        {...(isGridLayout ? {} : { ...attributes, ...listeners })}
        onMouseDown={isGridLayout && isEditMode ? handleDragStart : undefined}
      >
        {isEditMode && <div className="widget-handle"><FiMove /></div>}
        <div className="widget-title">
          {getWidgetIcon(effectiveWidgetType)}
          {showData && effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot' && (
            <span className="widget-data-badge" title="Viewing underlying data"><FiTable /></span>
          )}
          <div className="widget-title-group">
            <span className="widget-title-text">{widget.title}</span>
            {widget.config?.subtitle && <span className="widget-subtitle-text">{widget.config.subtitle}</span>}
          </div>
          {autoInsightSummary && !showInsights && (
            <button className="widget-auto-insight-badge" onClick={() => { setShowInsights(true); generateInsights(); }} title={autoInsightSummary}>
              <HiSparkles />
            </button>
          )}
        </div>

        {!isEditMode && (
          <div className="widget-actions" ref={menuRef} onPointerDown={(e) => e.stopPropagation()}>
            <button className="widget-menu-btn" onClick={() => setShowMenu(!showMenu)}><FiMoreVertical /></button>
            {showMenu && (
              <WidgetMenu
                widgetType={effectiveWidgetType}
                data={data}
                showData={showData}
                onRefresh={() => loadData(true)}
                onToggleData={() => setShowData(!showData)}
                onExport={() => exportToCSV(data, widget.title)}
                onGenerateInsights={generateInsights}
                insightsLoading={insightsLoading}
                onCloseMenu={() => setShowMenu(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`widget-content ${widget?.config?.refreshEnabled === false ? 'preview-paused' : ''}`}>
        <ChartErrorBoundary resetKey={`${effectiveWidgetType}-${data?.rows?.length}`}>
          {renderContent()}
        </ChartErrorBoundary>
        {widget?.config?.refreshEnabled === false && (
          <div className="widget-paused-overlay">
            <div className="paused-content"><FiPause className="paused-icon" /><span className="paused-label">Paused</span></div>
          </div>
        )}
      </div>

      {/* Edit-mode click overlay */}
      {isEditMode && !isSelected && (
        <div className="widget-edit-click-overlay" onClick={(e) => { e.stopPropagation(); if (onSelect) onSelect(widget); }} />
      )}

      {/* Edit-mode border actions */}
      {isEditMode && (
        <div className="widget-border-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button className="widget-border-action-btn" style={{ backgroundColor: '#374151', color: '#f9fafb' }} onClick={(e) => { e.stopPropagation(); loadData(true); }} title="Refresh data"><FiRefreshCw /></button>
          {effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot' && (
            <button className="widget-border-action-btn" style={{ backgroundColor: '#374151', color: '#f9fafb' }} onClick={(e) => { e.stopPropagation(); setShowData(!showData); }} disabled={!data?.rows?.length} title={showData ? 'Show chart' : 'View data'}>
              {showData ? <FiBarChart2 /> : <FiTable />}
            </button>
          )}
          <button className="widget-border-action-btn" style={{ backgroundColor: '#374151', color: '#f9fafb' }} onClick={(e) => { e.stopPropagation(); setExpandKey(k => k + 1); setIsExpanded(true); }} title="Expand"><FiMaximize /></button>
          {onDelete && (
            <button className="widget-border-action-btn danger" style={{ backgroundColor: '#374151', color: '#f9fafb' }} onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete widget"><FiTrash2 /></button>
          )}
        </div>
      )}

      {/* View-mode expand corner button */}
      {!isEditMode && (
        <button className="widget-expand-corner-btn" onClick={() => { setExpandKey(k => k + 1); setIsExpanded(true); }} title="Expand to full screen"><FiMaximize /></button>
      )}

      {/* Expanded modal */}
      {isExpanded && (
        <ExpandedWidgetModal
          widget={widget} data={data} config={effectiveConfig}
          widgetType={effectiveWidgetType} chartQuery={buildChartQuery()}
          showData={showData} setShowData={setShowData}
          expandKey={expandKey} onClose={() => setIsExpanded(false)}
        />
      )}

      {/* Insights modal */}
      {showInsights && (
        <InsightsModal
          widget={widget} insights={insights}
          insightsLoading={insightsLoading} insightsError={insightsError}
          onClose={() => setShowInsights(false)} onRegenerate={generateInsights}
        />
      )}
    </div>
  );
};

export default DashboardWidget;
