import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '../store/appStore';
import { semanticApi, sfConnectionApi, isNetworkPolicyError } from '../api/apiClient';
import { getCacheKey, getCachedResult, setCachedResult } from '../utils/widgetCache';
import {
  FiMoreVertical,
  FiEdit3,
  FiTrash2,
  FiRefreshCw,
  FiMove,
  FiBarChart2,
  FiTrendingUp,
  FiPieChart,
  FiTable,
  FiHash,
  FiMaximize,
  FiMaximize2,
  FiGrid,
  FiCircle,
  FiActivity,
  FiTarget,
  FiGitBranch,
  FiHexagon,
  FiAlignLeft,
  FiMinusCircle,
  FiRepeat,
  FiDisc,
  FiCrosshair,
  FiSun,
  FiColumns,
  FiX,
  FiDownload,
  FiLoader,
  FiLayers,
  FiDatabase,
  FiPause,
} from 'react-icons/fi';
import { HiSparkles } from 'react-icons/hi2';
import './DashboardWidget.css';
import { renderChart as sharedRenderChart } from './ChartRenderer';
import WidgetEditor from './widget-editor';
// Note: buildQueryFromConfig removed - backend is now the single source of truth for SQL generation

// Utils only - all chart rendering goes through ChartRenderer
import { useStableResize } from './charts';

// Debug logging
const DEBUG = import.meta.env.VITE_DEBUG === 'true';
const log = (...args) => DEBUG && log(...args);

// Compute widget colors based on canvas background
const computeWidgetColors = (canvasColor) => {
  if (!canvasColor) return null;
  
  // Parse hex color to RGB
  const hex = canvasColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Calculate luminance to determine if color is light or dark
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // For dark canvas: lighten widget bg, darken slightly for header
  // For light canvas: darken widget bg significantly
  if (luminance < 0.5) {
    // Dark canvas - make widgets slightly lighter with transparency
    const widgetBg = `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)}, 0.85)`;
    const headerBg = `rgba(${Math.min(255, r + 25)}, ${Math.min(255, g + 25)}, ${Math.min(255, b + 25)}, 0.95)`;
    const borderColor = `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 60)}, 0.5)`;
    return { widgetBg, headerBg, borderColor, textColor: '#ffffff' };
  } else {
    // Light canvas - make widgets darker for contrast
    const widgetBg = `rgba(${Math.max(0, r - 60)}, ${Math.max(0, g - 60)}, ${Math.max(0, b - 60)}, 0.9)`;
    const headerBg = `rgba(${Math.max(0, r - 80)}, ${Math.max(0, g - 80)}, ${Math.max(0, b - 80)}, 0.95)`;
    const borderColor = `rgba(${Math.max(0, r - 100)}, ${Math.max(0, g - 100)}, ${Math.max(0, b - 100)}, 0.5)`;
    return { widgetBg, headerBg, borderColor, textColor: '#ffffff' };
  }
};

const DashboardWidget = ({ 
  widgetId,  // Widget ID - for reference
  tabId,     // Tab ID - for reference  
  widget,    // Widget data - passed from parent
  onEdit, 
  onDelete, 
  onResize,
  onUpdateTitle, 
  onSelect, 
  layoutMode = 'adaptive', 
  devicePreview = 'desktop', 
  canvasColor, 
  isGridLayout = false, 
  isEditMode = false, 
  isSelected = false,
  isEditing = false,
  dashboardId,
  onAutoSave,
  onCloseEditor,
  gridPosition, // { x, y, w, h, minW, minH } for GridStack positioning
}) => {
  // Get store state - simple direct access
  const { currentDashboard, dashboardConnectionError, setDashboardConnectionError, widgetRefreshKey } = useAppStore();
  const [showMenu, setShowMenu] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true); // Start as loading
  const [hasAttemptedLoad, setHasAttemptedLoad] = useState(false); // Track if we've tried to load
  const [error, setError] = useState(null);
  const [isResizing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandKey, setExpandKey] = useState(0);
  // Initialize size from widget.position, with robust defaults
  const [size, setSize] = useState(() => {
    const w = widget.position?.w;
    const h = widget.position?.h;
    return {
      width: (typeof w === 'number' && w > 0) ? w : 4,
      height: (typeof h === 'number' && h > 0) ? h : 3,
    };
  });
  
  
  // AI Insights state
  const [showInsights, setShowInsights] = useState(false);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(null);
  
  // Show underlying data toggle
  const [showData, setShowData] = useState(false);
  
  const widgetRef = useRef(null);
  const menuRef = useRef(null);
  const expandedContainerRef = useRef(null);
  
  // Track if we've hit a network policy error - use ref to avoid re-render loops
  const networkPolicyErrorRef = useRef(false);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      // Small delay to prevent immediate close on the same click
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 10);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showMenu]);

  // Get column span - respects saved widget size
  const getColumnSpan = () => {
    return size.width || 4;
  };

  // Get row span - respects saved widget size  
  const getRowSpan = () => {
    return size.height || 3;
  };

  // Extract dimensions, measures, and aggregations for the semantic query
  // Uses unified widget.fields array as THE source of truth
  // Falls back to legacy formats for backwards compatibility
  const { dimensions, measures, aggregatedFields, columnDimensions, rowDimensions, colorField, clusterField, detailFields, tooltipFields, labelFields, liveWidgetType, liveSemanticViewId, queryConfig } = useMemo(() => {
    // Widget config comes directly from global config (currentDashboard.tabs[].widgets[])
    // When WidgetEditor makes changes, it updates the global config via updateWidget
    // This widget prop receives the updated data automatically
    if (DEBUG) {
      console.log('[DashboardWidget] Using saved widget config:', {
        hasUnifiedFields: !!widget.fields?.length,
        queryDimensions: widget.queryDimensions,
        queryMeasures: widget.queryMeasures,
      });
    }
    
    const marks = widget.marks || {};
    
    // Helper to strip entity prefix (e.g., "ORDERS.ORDER_COUNT" -> "ORDER_COUNT")
    const stripPrefix = (name) => {
      if (!name) return name;
      return name.includes('.') ? name.split('.').pop() : name;
    };
    
    // Check for UNIFIED fields array first (new format)
    if (widget.fields && Array.isArray(widget.fields) && widget.fields.length > 0) {
      // Extract from unified fields - strip entity prefixes from all field names
      // Mark types that affect chart visual structure (grouping, encoding)
      const visualMarkTypes = new Set(['color', 'cluster', 'detail', 'tooltip']);
      // A dimension field participates in chart structure only if it's on the
      // columns shelf (x-axis) or has a visual mark type.  Dimensions on the
      // rows shelf with no mark type (or markType 'label') are informational —
      // kept in the SQL for underlying data but collapsed by the chart.
      const isChartDimension = f => {
        if (f.semanticType !== 'dimension' && f.semanticType !== 'fact') return false;
        if (f.shelf === 'columns') return true;
        if (f.markType && visualMarkTypes.has(f.markType)) return true;
        return false;
      };
      // All dimensions go into the query so underlying data shows everything
      const dims = widget.fields
        .filter(f => f.semanticType === 'dimension' || f.semanticType === 'fact')
        .map(f => stripPrefix(f.name));
      // Fields on the columns shelf act as x-axis / grouping dimensions
      // regardless of semanticType (custom columns get 'measure' but still
      // belong on the x-axis when placed on the columns shelf).
      const columnsShelfNames = new Set(
        widget.fields.filter(f => f.shelf === 'columns').map(f => stripPrefix(f.name))
      );
      const meas = widget.fields
        .filter(f => f.semanticType === 'measure' && !columnsShelfNames.has(stripPrefix(f.name)))
        .map(f => stripPrefix(f.name));
      const aggFields = widget.fields
        .filter(f => f.aggregation)
        .map(f => ({ name: stripPrefix(f.name), aggregation: f.aggregation }));
      const colDims = widget.fields
        .filter(f => f.shelf === 'columns')
        .map(f => stripPrefix(f.name));
      const rowDims = widget.fields
        .filter(f => f.shelf === 'rows' && isChartDimension(f))
        .map(f => stripPrefix(f.name));
      const colorMark = stripPrefix(widget.fields.find(f => f.markType === 'color')?.name)
        || stripPrefix(marks.color) || null;
      const clusterMark = stripPrefix(widget.fields.find(f => f.markType === 'cluster')?.name)
        || stripPrefix(marks.cluster) || null;
      const detailFields = widget.fields
        .filter(f => f.markType === 'detail')
        .map(f => stripPrefix(f.name));
      if (detailFields.length === 0 && marks.detail) {
        const legacy = Array.isArray(marks.detail) ? marks.detail : [marks.detail];
        legacy.forEach(d => { if (d && !detailFields.includes(stripPrefix(d))) detailFields.push(stripPrefix(d)); });
      }
      const tooltipFields = widget.fields
        .filter(f => f.markType === 'tooltip')
        .map(f => stripPrefix(f.name));
      if (tooltipFields.length === 0 && marks.tooltip) {
        const legacy = Array.isArray(marks.tooltip) ? marks.tooltip : [marks.tooltip];
        legacy.forEach(t => { if (t && !tooltipFields.includes(stripPrefix(t))) tooltipFields.push(stripPrefix(t)); });
      }
      // Label fields = explicitly marked 'label' OR dimension fields with no
      // visual mark type sitting on the rows shelf (informational only).
      const labelFields = widget.fields
        .filter(f =>
          (f.markType === 'label') ||
          ((f.semanticType === 'dimension' || f.semanticType === 'fact') &&
           f.shelf === 'rows' &&
           (!f.markType || !visualMarkTypes.has(f.markType)))
        )
        .map(f => stripPrefix(f.name));
      
      return { 
        dimensions: dims, 
        measures: meas,
        aggregatedFields: aggFields,
        columnDimensions: colDims.filter(f => !meas.includes(f)),
        rowDimensions: rowDims.filter(f => !meas.includes(f)),
        colorField: colorMark,
        clusterField: clusterMark,
        detailFields,
        tooltipFields,
        labelFields,
        liveWidgetType: null,
        liveSemanticViewId: null,
        queryConfig: null,
      };
    }
    
    // LEGACY FORMATS: Fall back to older data structures
    const fieldsUsed = widget.fieldsUsed || [];
    
    // Extract fields with user-specified aggregation - strip prefixes
    const aggFields = fieldsUsed
      .filter(f => f.aggregation)
      .map(f => ({ name: stripPrefix(f.name), aggregation: f.aggregation }));
    
    // Column placement fields - for COLUMN HEADERS (across the top) in visualizations
    const colFields = fieldsUsed
      .filter(f => f.placement === 'column')
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    
    // Row placement fields - for ROW HEADERS (down the side) in visualizations
    const rowFields = fieldsUsed
      .filter(f => f.placement === 'row')
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    
    // Mark fields from Marks card - strip prefixes
    const colorMarkField = stripPrefix(marks.color) || null;
    const clusterMarkField = stripPrefix(marks.cluster) || null;
    const detailMarkFields = (marks.detail || []).map(stripPrefix);
    const tooltipMarkFields = (marks.tooltip || []).map(stripPrefix);
    const labelMarkFields = (marks.label ? [stripPrefix(marks.label)] : []);
    
    // For visualization: column and row names for headers - strip prefixes
    const colDims = colFields.map(f => stripPrefix(f.name));
    const rowDims = rowFields.map(f => stripPrefix(f.name));
    
    // For SEMANTIC QUERY: Use pre-computed arrays if available (from WidgetEditor)
    // This ensures the dashboard uses the EXACT same query as the editor preview
    let dims, meas;
    
    if (widget.queryDimensions && widget.queryMeasures) {
      // Use the pre-computed arrays from when widget was saved
      // These were computed using viewMetadata in WidgetEditor, so they're correct
      // Strip entity prefixes to ensure consistency
      dims = widget.queryDimensions.map(stripPrefix);
      meas = widget.queryMeasures.map(stripPrefix);
      
      // Add color mark if not already included
      if (colorMarkField && !dims.includes(colorMarkField) && !meas.includes(colorMarkField)) {
        dims.push(colorMarkField);
      }
      
      // Add detail fields
      detailMarkFields.forEach(f => {
        if (!dims.includes(f) && !meas.includes(f)) dims.push(f);
      });
      
      // Add tooltip fields
      tooltipMarkFields.forEach(f => {
        if (!dims.includes(f) && !meas.includes(f)) dims.push(f);
      });
    } else {
      // Fallback for older widgets: derive from fieldsUsed
      // CRITICAL: For old widgets without 'type' field, use placement to determine:
      //   - placement: 'value' → ALWAYS a measure
      //   - placement: 'column' or 'row' → usually dimension, but check if it's also in value placement
      dims = [];
      meas = [];
      
      // FIRST: Collect all field names that have placement: 'value' - these are ALWAYS measures
      const measureFieldNames = new Set(
        fieldsUsed
          .filter(f => f.placement === 'value')
          .map(f => f.name)
      );
      
      // Helper: is this field a known measure?
      const isKnownMeasure = (name) => {
        // Check if it's in the value placement
        if (measureFieldNames.has(name)) return true;
        // Check if it has type: 'measure' explicitly set
        const field = fieldsUsed.find(f => f.name === name);
        if (field?.type === 'measure') return true;
        return false;
      };
      
      // Process column fields - only add to dims if NOT a measure
      colFields.forEach(f => {
        if (isKnownMeasure(f.name)) {
          if (!meas.includes(f.name)) meas.push(f.name);
        } else {
          if (!dims.includes(f.name)) dims.push(f.name);
        }
      });
      
      // Process row fields - only add to dims if NOT a measure
      rowFields.forEach(f => {
        if (isKnownMeasure(f.name)) {
          if (!meas.includes(f.name)) meas.push(f.name);
        } else {
          if (!dims.includes(f.name)) dims.push(f.name);
        }
      });
      
      // Add all value fields to measures (they're always measures)
      measureFieldNames.forEach(name => {
        if (!meas.includes(name)) meas.push(name);
      });
      
      // Add color mark field
      if (colorMarkField) {
        if (isKnownMeasure(colorMarkField)) {
          if (!meas.includes(colorMarkField)) meas.push(colorMarkField);
        } else {
          if (!dims.includes(colorMarkField)) dims.push(colorMarkField);
        }
      }
      
      // Add detail fields (usually dimensions)
      detailMarkFields.forEach(f => {
        if (!dims.includes(f) && !meas.includes(f)) dims.push(f);
      });
      
      // Add tooltip fields
      tooltipMarkFields.forEach(f => {
        if (!dims.includes(f) && !meas.includes(f)) dims.push(f);
      });
    }
    
    // Filter columnDimensions and rowDimensions to only include dimensions (not measures)
    // This matches how WidgetEditor's previewQuery works:
    //   - rows: dimensionRows (only dimensions from rows shelf)
    //   - measures: measuresFromRows (only measures from rows shelf)
    const filteredColDims = colDims.filter(f => !meas.includes(f));
    const filteredRowDims = rowDims.filter(f => !meas.includes(f));
    
    return { 
      dimensions: dims, 
      measures: meas,
      aggregatedFields: aggFields,
      columnDimensions: filteredColDims,
      rowDimensions: filteredRowDims,
      colorField: colorMarkField,
      clusterField: clusterMarkField,
      detailFields: detailMarkFields,
      tooltipFields: tooltipMarkFields,
      labelFields: labelMarkFields,
      liveWidgetType: null,
      liveSemanticViewId: null,
      queryConfig: null,
    };
  }, [widget.fieldsUsed, widget.marks, widget.queryDimensions, widget.queryMeasures, widget.fields]);

  // Computed widget type - use live value when editing
  // Computed widget type - use live value when editing, fallback to saved widget type
  const effectiveWidgetType = liveWidgetType || widget.type;
  
  // Get semantic view FQN - resolve from dashboard's semanticViewsReferenced to get full name
  const semanticViewFQN = useMemo(() => {
    // Helper to resolve FQN from a semantic view ID (short name)
    const resolveToFQN = (viewId) => {
      if (!viewId) return null;
      
      // If it already looks like a FQN (contains dots), use it directly
      if (viewId.includes('.')) return viewId;
      
      // Look up in dashboard's semanticViewsReferenced
      if (currentDashboard?.semanticViewsReferenced) {
        const dashboardView = currentDashboard.semanticViewsReferenced.find(v => 
          (typeof v === 'string' ? v : v.name) === viewId
        );
        if (typeof dashboardView === 'object' && dashboardView?.fullyQualifiedName) {
          return dashboardView.fullyQualifiedName;
        }
      }
      
      // Fallback to the viewId itself
      return viewId;
    };
    
    // Priority 1: Live editing semantic view ID (resolve to FQN)
    if (liveSemanticViewId) {
      return resolveToFQN(liveSemanticViewId);
    }
    
    // Priority 2: Widget's semanticViewsReferenced
    const viewRef = widget.semanticViewsReferenced?.[0];
    if (viewRef?.fullyQualifiedName) return viewRef.fullyQualifiedName;
    if (viewRef?.name) return resolveToFQN(viewRef.name);
    
    // Priority 3: Legacy modelId
    return resolveToFQN(widget.modelId);
  }, [widget.semanticViewsReferenced, widget.modelId, liveSemanticViewId, currentDashboard?.semanticViewsReferenced]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id, disabled: isResizing || !isEditMode });

  // Update size when widget.position changes
  useEffect(() => {
    const w = widget.position?.w;
    const h = widget.position?.h;
    // Only update if we have valid numeric values
    if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) {
      setSize({ width: w, height: h });
    }
  }, [widget.position?.w, widget.position?.h]);

  // Refs to hold latest callback versions (avoid stale closures)
  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);


  // ========== Custom Drag Implementation for GridStack ==========
  const dragStartRef = useRef({ x: 0, y: 0, itemX: 0, itemY: 0 });
  const [isDraggingWidget, setIsDraggingWidget] = useState(false);

  const handleDragMove = useCallback((e) => {
    if (!isGridLayout || !widgetRef.current) return;
    
    // Widget IS the grid-stack-item
    const gridStackItem = widgetRef.current;

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    // Move the grid-stack-item using transform for smooth dragging
    gridStackItem.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    gridStackItem.style.zIndex = '1000';
    gridStackItem.style.opacity = '0.8';
  }, [isGridLayout]);

  const handleDragEnd = useCallback((e) => {
    setIsDraggingWidget(false);
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);

    if (!widgetRef.current) return;

    // Widget IS the grid-stack-item
    const gridStackItem = widgetRef.current;
    const gridEl = widgetRef.current.closest('.grid-stack');
    
    if (!gridStackItem || !gridEl) return;

    // Calculate new grid position based on final pixel position
    const grid = gridEl.gridstack;
    if (!grid) {
      // Reset styles if no grid
      gridStackItem.style.transform = '';
      gridStackItem.style.zIndex = '';
      gridStackItem.style.opacity = '';
      return;
    }

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    // Calculate grid cell sizes
    const containerWidth = gridEl.offsetWidth || 1200;
    const cellWidth = (containerWidth - (16 * 11)) / 12; // 16px margin, 12 columns
    const cellHeight = 80;

    // Calculate new grid position
    const deltaGridX = Math.round(deltaX / cellWidth);
    const deltaGridY = Math.round(deltaY / cellHeight);
    
    const currentW = gridStackItem.gridstackNode?.w ?? (parseInt(gridStackItem.getAttribute('gs-w')) || 4);
    const currentH = gridStackItem.gridstackNode?.h ?? (parseInt(gridStackItem.getAttribute('gs-h')) || 3);
    
    // Clamp to valid grid positions
    const newX = Math.max(0, Math.min(12 - currentW, dragStartRef.current.itemX + deltaGridX));
    const newY = Math.max(0, dragStartRef.current.itemY + deltaGridY);

    // Reset inline styles first
    gridStackItem.style.transform = '';
    gridStackItem.style.zIndex = '';
    gridStackItem.style.opacity = '';

    // Update GridStack position - this will push other widgets if needed
    grid.update(gridStackItem, { x: newX, y: newY, w: currentW, h: currentH });

    // Suppress the click event that fires after mouseup
    if (widgetRef.current) {
      widgetRef.current.dataset.justResized = '1';
      requestAnimationFrame(() => { if (widgetRef.current) delete widgetRef.current.dataset.justResized; });
    }
  }, [handleDragMove, isGridLayout]);

  const handleDragStart = useCallback((e) => {
    // Don't start drag if clicking on interactive elements
    if (e.target.closest('button, input, .widget-actions, .inline-edit-widget-title, .resize-handle')) return;
    if (!isGridLayout || !isEditMode) return;

    e.preventDefault();
    setIsDraggingWidget(true);

    // Widget IS the grid-stack-item — prefer gridstackNode, fall back to gs-* attrs
    const el = widgetRef.current;
    const dragNode = el?.gridstackNode;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      itemX: dragNode?.x ?? (parseInt(el?.getAttribute('gs-x')) || 0),
      itemY: dragNode?.y ?? (parseInt(el?.getAttribute('gs-y')) || 0),
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }, [isGridLayout, isEditMode, handleDragMove, handleDragEnd]);

  // Cleanup drag listeners
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  // Build style based on layout mode and saved position/size
  const getWidgetStyle = () => {
    // When using GridStack, CSS handles sizing via position:absolute + inset:0
    if (isGridLayout) {
      return {
        opacity: isDragging ? 0.5 : 1,
      };
    }
    
    const position = widget.position || { w: 4, h: 3 };
    const w = size.width || position.w || 4;
    const h = size.height || position.h || 3;
    
    // Convert grid units to CSS - matches resize calculation (120px width, 80px height per unit)
    const widthPx = Math.max(w * 120, 250); // Min 250px
    const heightPx = Math.max(h * 80, 200); // Min 200px for AG Grid to render properly
    
    return {
      transform: CSS.Transform.toString(transform),
      transition: isResizing ? 'none' : transition,
      opacity: isDragging ? 0.5 : 1,
      width: `${widthPx}px`,
      height: `${heightPx}px`,
    };
  };

  const style = getWidgetStyle();
  
  // Compute widget colors based on canvas background
  const widgetColors = computeWidgetColors(canvasColor);
  const colorStyle = widgetColors ? {
    '--widget-bg': widgetColors.widgetBg,
    '--widget-header-bg': widgetColors.headerBg,
    '--widget-border': widgetColors.borderColor,
    '--widget-text': widgetColors.textColor,
  } : {};

  // Get filters, sorts, and custom columns for cache key and query
  // Use live config values when editing, fallback to saved widget values
  const filtersApplied = useMemo(() => {
    // If live editing with queryConfig, use filters from unified config
    if (queryConfig?.filters) {
      return queryConfig.filters;
    }
    // Fallback to saved widget filters
    return widget.filtersApplied || [];
  }, [queryConfig?.filters, widget.filtersApplied]);
  
  const sortsApplied = useMemo(() => {
    // If live editing with queryConfig, use sorts from unified config
    if (queryConfig?.orderBy) {
      return queryConfig.orderBy;
    }
    // Fallback to saved widget sorts
    return widget.sortsApplied || [];
  }, [queryConfig?.orderBy, widget.sortsApplied]);
  
  // Get widget's semantic view name for finding dashboard-level calc fields
  const widgetSemanticViewName = widget.semanticViewsReferenced?.[0]?.name;
  
  // Get ONLY this widget's semantic view's calculated fields from dashboard
  // This prevents re-renders when OTHER semantic views' calc fields change
  const dashboardCalcFieldsForView = useMemo(() => {
    const dashboardSemanticViews = currentDashboard?.semanticViewsReferenced || [];
    const dashboardSemanticView = dashboardSemanticViews.find(v => 
      (typeof v === 'string' ? v : v.name) === widgetSemanticViewName
    );
    return (typeof dashboardSemanticView === 'object' ? dashboardSemanticView.calculatedFields : []) || [];
  }, [currentDashboard?.semanticViewsReferenced, widgetSemanticViewName]);
  
  // Create stable key for dashboard calc fields to minimize re-renders
  // Only changes if the actual field definitions change, not just the reference
  const dashboardCalcFieldsKey = useMemo(() => {
    return JSON.stringify(dashboardCalcFieldsForView.map(f => ({ name: f.name, expression: f.expression })));
  }, [dashboardCalcFieldsForView]);
  
  const ensureCalcFieldIds = (fields) =>
    (fields || []).map(f => f.id ? f : { ...f, id: crypto.randomUUID() });

  // Get calculated fields - use live config when editing, fallback to saved widget + dashboard
  // Only recalculates when the actual field definitions change
  const customColumns = useMemo(() => {
    // If live editing with queryConfig, use customColumns from unified config
    if (queryConfig?.customColumns) {
      return ensureCalcFieldIds(queryConfig.customColumns);
    }
    
    // Fallback: merge widget-level and dashboard-level
    const widgetCustomColumns = ensureCalcFieldIds(widget.customColumns);
    
    // Merge: widget-level takes precedence, then dashboard-level
    const merged = [...widgetCustomColumns];
    ensureCalcFieldIds(dashboardCalcFieldsForView).forEach(dcf => {
      if (!merged.some(wcf => wcf.name === dcf.name)) {
        merged.push(dcf);
      }
    });
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.customColumns, dashboardCalcFieldsKey]);
  
  // Get ONLY this widget's semantic view's column aliases from dashboard
  const dashboardAliasesForView = useMemo(() => {
    const dashboardSemanticViews = currentDashboard?.semanticViewsReferenced || [];
    const dashboardSemanticView = dashboardSemanticViews.find(v => 
      (typeof v === 'string' ? v : v.name) === widgetSemanticViewName
    );
    return (typeof dashboardSemanticView === 'object' ? dashboardSemanticView.columnAliases : null) || {};
  }, [currentDashboard?.semanticViewsReferenced, widgetSemanticViewName]);
  
  // Create stable key for aliases to minimize re-renders
  const dashboardAliasesKey = useMemo(() => {
    return JSON.stringify(dashboardAliasesForView);
  }, [dashboardAliasesForView]);
  
  // Get column aliases from dashboard-level semantic view (preferred) or widget config
  const columnAliases = useMemo(() => {
    // Dashboard-level aliases take precedence
    if (Object.keys(dashboardAliasesForView).length > 0) {
      return { ...dashboardAliasesForView, ...widget.config?.columnAliases };
    }
    
    // Fall back to widget-level config
    return widget.config?.columnAliases || {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.config?.columnAliases, dashboardAliasesKey]);
  
  // Build effective config with merged aliases and active sorts
  const effectiveConfig = useMemo(() => ({
    ...widget.config,
    columnAliases,
    sorts: sortsApplied,
  }), [widget.config, columnAliases, sortsApplied]);
  
  // Track if a load is in progress to prevent duplicate requests
  const loadingRef = useRef(false);
  const loadRequestId = useRef(0);
  
  // Create stable dependency keys to prevent infinite re-renders
  const dimensionsKey = useMemo(() => JSON.stringify(dimensions), [dimensions]);
  const measuresKey = useMemo(() => JSON.stringify(measures), [measures]);
  const filtersKey = useMemo(() => JSON.stringify(filtersApplied), [filtersApplied]);
  const sortsKey = useMemo(() => JSON.stringify(sortsApplied), [sortsApplied]);
  
  // Include calculated fields the widget uses, plus any they transitively reference
  const usedCustomColumns = useMemo(() => {
    const allFieldNames = new Set([...dimensions, ...measures, ...columnDimensions].map(n => n.toUpperCase()));
    const calcByName = new Map(customColumns.map(cc => [cc.name.toUpperCase(), cc]));
    const used = new Set();
    customColumns.forEach(cc => {
      if (allFieldNames.has(cc.name.toUpperCase())) used.add(cc.name.toUpperCase());
    });
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const name of used) {
        const cc = calcByName.get(name);
        if (!cc?.expression) continue;
        const refs = cc.expression.matchAll(/\[([^\]]+)\]/g);
        for (const m of refs) {
          const upper = m[1].toUpperCase();
          if (calcByName.has(upper) && !used.has(upper)) {
            used.add(upper);
            expanded = true;
          }
        }
      }
    }
    return customColumns.filter(cc => used.has(cc.name.toUpperCase()));
  }, [customColumns, dimensions, measures, columnDimensions]);
  
  const customColumnsKey = useMemo(() => {
    // Only trigger reload when USED calculated fields change
    return JSON.stringify(usedCustomColumns.map(c => ({ name: c.name, expression: c.expression })));
  }, [usedCustomColumns]);
  
  // Track if this is a refresh trigger (vs initial load)
  const prevRefreshKeyRef = useRef(0);
  // Track which refresh key we already ATTEMPTED (to prevent retrying same refresh)
  const attemptedRefreshKeyRef = useRef(0);
  
  useEffect(() => {
    // If refresh is paused (user paused preview in editor), don't load data
    if (widget?.config?.refreshEnabled === false) {
      return; // Skip - user has paused preview
    }
    
    // FIRST: If there's already a dashboard-level connection error, don't even try
    // This prevents all widgets from making requests when connection is broken
    if (dashboardConnectionError) {
      setLoading(false);
      setHasAttemptedLoad(true);
      return; // Dashboard connection is broken - show error state
    }
    
    // Load data if we have a semantic view and at least one dimension or measure
    const hasDimensions = dimensions.length > 0;
    const hasMeasures = measures.length > 0;
    
    // Check if widgetRefreshKey changed (user clicked Reconnect)
    const isNewRefreshKey = widgetRefreshKey > prevRefreshKeyRef.current;
    const alreadyAttemptedThisRefresh = widgetRefreshKey === attemptedRefreshKeyRef.current;
    
    // Only force refresh if it's a NEW refresh key we haven't attempted yet
    const shouldForceRefresh = isNewRefreshKey && !alreadyAttemptedThisRefresh;
    
    // If force refresh, clear the network policy error flag
    if (shouldForceRefresh) {
      networkPolicyErrorRef.current = false;
      attemptedRefreshKeyRef.current = widgetRefreshKey; // Mark as attempted
    }
    
    // Don't trigger load if this widget already hit a network policy error
    if (networkPolicyErrorRef.current && !shouldForceRefresh) {
      prevRefreshKeyRef.current = widgetRefreshKey; // Update to prevent future attempts
      return; // Skip - waiting for user to click Reconnect
    }
    
    if (semanticViewFQN && (hasDimensions || hasMeasures)) {
      prevRefreshKeyRef.current = widgetRefreshKey;
      loadData(shouldForceRefresh);
    } else {
      // No valid configuration - stop loading state
      setLoading(false);
      setHasAttemptedLoad(true);
    }
    // Include dashboardConnectionError so effect re-runs when error is set/cleared
  }, [semanticViewFQN, dimensionsKey, measuresKey, filtersKey, sortsKey, customColumnsKey, widgetRefreshKey, widget?.config?.refreshEnabled, dashboardConnectionError]);
  
  // Report network policy errors to dashboard level (for reconnect banner)
  // Only report if dashboard doesn't already have an error set (prevent repeated updates)
  useEffect(() => {
    if (error && isNetworkPolicyError({ message: error }) && setDashboardConnectionError && !dashboardConnectionError) {
      setDashboardConnectionError(error);
    }
  }, [error, setDashboardConnectionError, dashboardConnectionError]);

  const loadData = async (forceRefresh = false) => {
    // FIRST CHECK: If dashboard has a connection error, don't even try (unless force refresh)
    if (!forceRefresh && dashboardConnectionError) {
      setLoading(false);
      setHasAttemptedLoad(true);
      return; // Silent skip - dashboard connection is broken
    }
    
    // SECOND CHECK: If this widget already hit a network policy error, don't retry
    if (!forceRefresh && networkPolicyErrorRef.current) {
      setLoading(false);
      setHasAttemptedLoad(true);
      return; // Silent skip - already errored
    }
    
    // Need semantic view and at least one dimension or measure
    if (!semanticViewFQN || (dimensions.length === 0 && measures.length === 0)) {
      log('loadData skipped:', { semanticViewFQN, dimensions, measures, fieldsUsed: widget.fieldsUsed });
      setLoading(false);
      setHasAttemptedLoad(true);
      return;
    }
    
    // Debug: Log connection info
    console.log('[DashboardWidget] loadData - connection info:', {
      widgetId: widget.id,
      semanticViewFQN,
      connectionId: currentDashboard?.connection_id,
      role: currentDashboard?.role,
      warehouse: currentDashboard?.warehouse,
      hasDashboard: !!currentDashboard,
    });
    
    // Clear the flag if this is a force refresh
    if (forceRefresh) {
      networkPolicyErrorRef.current = false;
    }
    
    // Prevent duplicate requests while one is in progress
    if (loadingRef.current && !forceRefresh) {
      log('loadData skipped - already loading');
      return; // Don't update loading state - another load is in progress
    }

    const cacheKey = getCacheKey(semanticViewFQN, dimensions, measures, filtersApplied, sortsApplied, usedCustomColumns);
    
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = getCachedResult(cacheKey);
      if (cached) {
        setData(cached);
        setLoading(false);
        setHasAttemptedLoad(true);
        return;
      }
    }

    // Mark as loading and increment request ID
    loadingRef.current = true;
    const thisRequestId = ++loadRequestId.current;
    
    setLoading(true);
    setError(null);
    try {
      let result;
      let chartData;
      
      // Standard query for all chart types (table handles pivoting client-side via AG Grid)
      
      // DEBUG: Log what we're sending to the API
      console.log('\n=== FRONTEND QUERY REQUEST ===');
      console.log('semanticViewFQN:', semanticViewFQN);
      console.log('dimensions:', JSON.stringify(dimensions));
      console.log('measures:', JSON.stringify(measures));
      console.log('filters:', JSON.stringify(filtersApplied));
      console.log('sorts:', JSON.stringify(sortsApplied));
      console.log('usedCustomColumns:', JSON.stringify(usedCustomColumns));
      console.log('==============================\n');
      
      // Use queryWithCustomColumns if we have USED custom columns, otherwise use regular query
      // Only pass calculated fields that are actually used in dimensions/measures
      if (usedCustomColumns.length > 0) {
        // Filter out calculated field names from dimensions and measures
        // (they're not real semantic view fields, just aliases for expressions)
        const customColumnNamesUpper = new Set(usedCustomColumns.map(cc => cc.name.toUpperCase()));
        const realDimensions = dimensions.filter(d => !customColumnNamesUpper.has(d.toUpperCase()));
        const realMeasures = measures.filter(m => !customColumnNamesUpper.has(m.toUpperCase()));
        
        result = await semanticApi.queryWithCustomColumns({
          semanticView: semanticViewFQN,
          dimensions: realDimensions,
          measures: realMeasures,
          aggregatedFields: aggregatedFields || [],  // Fields with user-specified aggregation
          filters: filtersApplied,
          orderBy: sortsApplied,
          customColumns: usedCustomColumns,  // Only pass used calculated fields
          limit: 1000000,
          connectionId: currentDashboard?.connection_id,
          role: currentDashboard?.role,
          warehouse: currentDashboard?.warehouse,
          forceRefresh,
        });
      } else {
        result = await semanticApi.query({
          semanticView: semanticViewFQN,
          dimensions,
          measures,
          filters: filtersApplied,
          orderBy: sortsApplied,
          limit: 1000000,
          connectionId: currentDashboard?.connection_id,
          role: currentDashboard?.role,
          warehouse: currentDashboard?.warehouse,
          forceRefresh,
        });
      }
      
      // Transform the result data for charts
      // Snowflake returns uppercase column names, map them to the field names
      const transformedRows = (result.data || []).map(row => {
        const transformed = {};
        Object.keys(row).forEach(key => {
          // Find the matching field name (case insensitive)
          const matchingDim = dimensions.find(d => d.toUpperCase() === key.toUpperCase());
          const matchingMeasure = measures.find(m => m.toUpperCase() === key.toUpperCase());
          const fieldName = matchingDim || matchingMeasure || key;
          transformed[fieldName] = row[key];
        });
        return transformed;
      });

      // Build columns array for DataTable and other components
      const allFields = [...dimensions, ...measures];
      const columns = allFields.map(name => ({ name }));

      // Store data in format expected by D3 charts: { rows: [...], columns: [...] }
      chartData = { rows: transformedRows, columns };
      
      // Only apply data if this is still the current request
      if (thisRequestId === loadRequestId.current) {
        setData(chartData);
        setCachedResult(cacheKey, chartData);
      }
    } catch (err) {
      const errorMessage = err.message || 'Unknown error';
      
      // Check if this is a connection-related error
      const isConnectionError = isNetworkPolicyError(err) || 
        errorMessage.includes('connection') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('network') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('Unable to connect');
      
      if (isConnectionError) {
        // Mark that we've hit a connection error - prevents further retries
        networkPolicyErrorRef.current = true;
        // Report to dashboard level so other widgets don't try
        if (setDashboardConnectionError && !dashboardConnectionError) {
          setDashboardConnectionError(errorMessage);
        }
      } else {
        // Only log non-connection errors to console
        console.error('Widget data load error:', err);
      }
      setError(errorMessage);
    } finally {
      // Only clear loading if this is still the current request
      if (thisRequestId === loadRequestId.current) {
        loadingRef.current = false;
        setLoading(false);
        setHasAttemptedLoad(true);
      }
    }
  };

  // Export data to CSV
  const exportToCSV = () => {
    if (!data || !data.rows || data.rows.length === 0) {
      console.warn('No data to export');
      return;
    }

    const { rows, columns } = data;
    const columnNames = columns.map(c => c.name);

    // Build CSV content
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Header row
    const header = columnNames.map(escapeCSV).join(',');

    // Data rows
    const dataRows = rows.map(row => 
      columnNames.map(col => escapeCSV(row[col])).join(',')
    );

    const csvContent = [header, ...dataRows].join('\n');

    // Create blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${widget.title || 'widget-data'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Generate AI insights for this widget's data
  const generateInsights = async () => {
    if (!data || !data.rows || data.rows.length === 0) {
      setInsightsError('No data available for insights');
      return;
    }

    setInsightsLoading(true);
    setInsightsError(null);
    setShowInsights(true);
    setShowMenu(false);

    try {
      const result = await semanticApi.cortexInsights({
        data: data.rows,
        query: `Widget: ${widget.title}`,
        semanticView: semanticViewFQN,
        connectionId: currentDashboard?.connection_id,
        role: currentDashboard?.role,
        warehouse: currentDashboard?.warehouse,
      });

      // Parse the insights response
      let parsedInsights = result.insights;
      
      // Handle JSON response from Cortex
      if (parsedInsights && typeof parsedInsights === 'string') {
        try {
          const parsed = JSON.parse(parsedInsights);
          if (parsed.choices && parsed.choices[0]) {
            parsedInsights = parsed.choices[0].messages || parsed.choices[0].message?.content || parsedInsights;
          }
        } catch {
          // Not JSON, use as-is
        }
      }

      setInsights(parsedInsights);
    } catch (error) {
      console.error('Insights error:', error);
      setInsightsError(error.message);
    } finally {
      setInsightsLoading(false);
    }
  };

  const getWidgetIcon = () => {
    switch (effectiveWidgetType) {
      case 'bar': return <FiBarChart2 />;
      case 'horizontal-bar': return <FiAlignLeft />;
      case 'stacked-bar': return <FiColumns />;
      case 'diverging-bar': return <FiMinusCircle />;
      case 'line': return <FiTrendingUp />;
      case 'multiline': return <FiActivity />;
      case 'area': return <FiTrendingUp />;
      case 'pie': return <FiPieChart />;
      case 'donut': return <FiDisc />;
      case 'radial': return <FiSun />;
      case 'treemap': return <FiGrid />;
      case 'icicle': return <FiLayers />;
      case 'sankey': return <FiActivity />;
      case 'table': return <FiTable />;
      case 'metric': return <FiHash />;
      default: return <FiBarChart2 />;
    }
  };

  const renderContent = () => {
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

    // Show error - either this widget's own error OR the dashboard-level connection error
    const displayError = error || dashboardConnectionError;
    if (displayError) {
      const isNetworkPolicy = isNetworkPolicyError({ message: displayError });
      
      return (
        <div className="widget-error">
          <span>⚠️ {displayError}</span>
          {isNetworkPolicy ? (
            <p className="widget-error-hint">
              Use the Reconnect button in the toolbar above.
            </p>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => loadData(true)}>
              <FiRefreshCw /> Retry
            </button>
          )}
        </div>
      );
    }

    // Check if widget is configured - use new fieldsUsed structure
    const hasSemanticView = semanticViewFQN || widget.semanticViewsReferenced?.length > 0;
    const hasMeasures = measures.length > 0 || widget.query?.measures?.length > 0;
    const hasDimensions = dimensions.length > 0 || widget.query?.dimensions?.length > 0;
    
    // Tables can work with just dimensions (no measures required)
    // Metrics only need measures, other charts need both
    const needsDimensions = !['metric', 'histogram'].includes(effectiveWidgetType);
    const needsMeasures = !['table'].includes(effectiveWidgetType);
    
    // Check if widget has minimum requirements
    const hasRequiredDimensions = hasDimensions || !needsDimensions;
    const hasRequiredMeasures = hasMeasures || !needsMeasures;
    
    // For tables, just need at least one field (dimension or measure)
    const hasAnyFields = hasDimensions || hasMeasures;
    const isTable = effectiveWidgetType === 'table';
    
    if (!hasSemanticView || (!isTable && (!hasRequiredMeasures || !hasRequiredDimensions)) || (isTable && !hasAnyFields)) {
      // If widget is being edited, show empty preview state
      if (isEditing) {
        return (
          <div className="widget-empty empty-preview">
            <FiBarChart2 style={{ fontSize: 32, opacity: 0.3 }} />
            <span>Add fields to see preview</span>
          </div>
        );
      }
      // In view mode, show a placeholder message
      if (!isEditMode) {
        return (
          <div className="widget-empty widget-not-configured">
            <FiLayers style={{ fontSize: 24, opacity: 0.5 }} />
            <span>Content not available</span>
          </div>
        );
      }
      // In edit mode (not focused), show configure button
      return (
        <div className="widget-empty">
          <span>Configure this widget</span>
          <button className="btn btn-primary btn-sm" onClick={onEdit}>
            <FiEdit3 /> Configure
          </button>
        </div>
      );
    }

    // Check if we have data - handle both array and {rows:[]} format
    const dataRows = Array.isArray(data) ? data : data?.rows;
    
    // If we haven't attempted a load yet, show loading
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
    
    if (!dataRows?.length) {
      return (
        <div className="widget-empty">
          <span>No data available</span>
        </div>
      );
    }

    // Stable key keeps ChartRenderer mounted across type changes so it
    // can cross-fade instead of flash-remounting.
    const chartKey = `${widget.id}-chart`;
    
    log('Rendering widget:', widget.id, 'type:', effectiveWidgetType);
    
    // Use pre-computed chartQuery from widget if available (saved by WidgetEditor)
    // This avoids recomputing dimensions/measures on every render
    // Fallback to computed values for backwards compatibility with older widgets
    const chartQuery = widget.chartQuery || {
      xAxis: columnDimensions,
      rows: rowDimensions,
      series: colorField ? [colorField] : rowDimensions,
      measures: measures,
      marks: widget.marks || {},
      colorField: colorField,
      clusterField: clusterField,
      tooltipFields: tooltipFields,
      detailFields: detailFields,
      labelFields: labelFields || [],
    };
    
    // Show underlying data table instead of chart when showData is true
    if (showData && effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot') {
      return sharedRenderChart('table', data, effectiveConfig, chartQuery, `${chartKey}-data`);
    }
    
    // Use shared ChartRenderer for consistent rendering between editor and dashboard
    return sharedRenderChart(effectiveWidgetType, data, effectiveConfig, chartQuery, chartKey);
  };

  // Combined ref handler for both sortable and local ref
  const combinedRef = useCallback((node) => {
    setNodeRef(node);
    widgetRef.current = node;
  }, [setNodeRef]);

  // When using GridStack, let CSS handle sizing (position:absolute + inset:0)
  // For non-GridStack, use the computed style with explicit dimensions
  const gridLayoutStyle = isGridLayout ? {} : style;

  // Handle widget click for selection in edit mode — only pure clicks, not
  // the click event that fires at the end of a drag or resize gesture.
  const handleWidgetClick = (e) => {
    if (widgetRef.current?.dataset?.justResized) return;
    if (isEditMode && onSelect) {
      e.stopPropagation();
      onSelect(widget);
    }
  };

  // Build grid-stack attributes when in grid layout
  const gridStackAttrs = isGridLayout && gridPosition ? {
    'data-widget-id': widget.id,
    'gs-x': gridPosition.x,
    'gs-y': gridPosition.y,
    'gs-w': gridPosition.w,
    'gs-h': gridPosition.h,
    'gs-min-w': gridPosition.minW || 2,
    'gs-min-h': gridPosition.minH || 2,
  } : {};

  // When editing, show the embedded WidgetEditor instead of the chart
  if (isEditing && onAutoSave && onCloseEditor) {
    return (
      <div
        ref={combinedRef}
        style={{ ...gridLayoutStyle, ...colorStyle, minHeight: '500px' }}
        className={`dashboard-widget ${isGridLayout ? 'grid-stack-item' : ''} editing editing-widget ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''} ${canvasColor ? 'has-canvas-color' : ''} ${isGridLayout ? 'grid-layout-widget' : ''} ${isEditMode ? 'edit-mode-widget' : ''} selected`}
        onClick={(e) => e.stopPropagation()}
        {...gridStackAttrs}
      >
        <WidgetEditor
          widget={widget}
          dashboardId={dashboardId}
          isNew={false}
          embedded={true}
          onClose={onCloseEditor}
          onAutoSave={onAutoSave}
        />
        
        {/* Resize handles are provided by GridStack natively */}
      </div>
    );
  }

  return (
    <div
      ref={combinedRef}
      style={{ ...gridLayoutStyle, ...colorStyle }}
      className={`dashboard-widget ${isGridLayout ? 'grid-stack-item' : ''} ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''} ${canvasColor ? 'has-canvas-color' : ''} ${isGridLayout ? 'grid-layout-widget' : ''} ${isEditMode ? 'edit-mode-widget' : ''} ${isSelected ? 'panel-editing' : ''} ${loading ? 'is-loading' : ''} title-pos-${widget.config?.titlePosition || 'top-left'} ${widget.config?.showTitle === false ? 'title-hidden' : ''}`}
      onClick={handleWidgetClick}
      {...gridStackAttrs}
    >
      {/* Loading bar */}
      {loading && (
        <div className="widget-loading-bar" />
      )}
      <div 
        className={`widget-header ${isGridLayout && isEditMode ? 'widget-drag-handle draggable-header' : ''} ${isDraggingWidget ? 'dragging' : ''}`} 
        {...(isGridLayout ? {} : { ...attributes, ...listeners })}
        onMouseDown={isGridLayout && isEditMode ? handleDragStart : undefined}
      >
        {isEditMode && (
          <div className="widget-handle">
            <FiMove />
          </div>
        )}
        <div className="widget-title">
          {getWidgetIcon()}
          {showData && effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot' && (
            <span className="widget-data-badge" title="Viewing underlying data">
              <FiTable />
            </span>
          )}
          <span className="widget-title-text">
            {widget.title}
          </span>
        </div>
        {/* Show action buttons - different for edit mode vs view mode */}
        {!isEditMode && (
          <div className="widget-actions" ref={menuRef} onPointerDown={(e) => e.stopPropagation()}>
            <button
              className="widget-menu-btn"
              onClick={() => setShowMenu(!showMenu)}
            >
              <FiMoreVertical />
            </button>
            {showMenu && (
              <div className="widget-menu">
                <button onClick={() => { loadData(true); setShowMenu(false); }}>
                  <FiRefreshCw /> Refresh
                </button>
                {effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot' && (
                  <button 
                    onClick={() => { setShowData(!showData); setShowMenu(false); }}
                    disabled={!data || !data.rows || data.rows.length === 0}
                    title={showData ? 'Show chart' : 'Show underlying data'}
                    className={showData ? 'active' : ''}
                  >
                    {showData ? <FiBarChart2 /> : <FiTable />} {showData ? 'Show Chart' : 'View Data'}
                  </button>
                )}
                <button 
                  onClick={() => { exportToCSV(); setShowMenu(false); }}
                  disabled={!data || !data.rows || data.rows.length === 0}
                  title={!data || !data.rows || data.rows.length === 0 ? 'No data to export' : 'Export data to CSV'}
                >
                  <FiDownload /> Export CSV
                </button>
                <button 
                  onClick={generateInsights}
                  disabled={!data || !data.rows || data.rows.length === 0 || insightsLoading}
                  title={!data || !data.rows || data.rows.length === 0 ? 'No data to explain' : 'Explain this data with AI'}
                  className="insights-btn"
                >
                  {insightsLoading ? <FiLoader className="spin" /> : <HiSparkles />} Explain
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className={`widget-content ${widget?.config?.refreshEnabled === false ? 'preview-paused' : ''}`}>
        {renderContent()}
        {/* Paused overlay when refresh is disabled */}
        {widget?.config?.refreshEnabled === false && (
          <div className="widget-paused-overlay">
            <div className="paused-content">
              <FiPause className="paused-icon" />
              <span className="paused-label">Paused</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Resize handles are provided by GridStack natively */}

      {/* Border action icons for edit mode */}
      {isEditMode && (
        <div 
          className="widget-border-actions" 
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="widget-border-action-btn"
            style={{ backgroundColor: '#374151', color: '#f9fafb' }}
            onClick={(e) => { e.stopPropagation(); loadData(true); }}
            title="Refresh data"
          >
            <FiRefreshCw />
          </button>
          {effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot' && (
            <button
              className="widget-border-action-btn"
              style={{ backgroundColor: '#374151', color: '#f9fafb' }}
              onClick={(e) => { e.stopPropagation(); setShowData(!showData); }}
              disabled={!data || !data.rows || data.rows.length === 0}
              title={showData ? 'Show chart' : 'View data'}
            >
              {showData ? <FiBarChart2 /> : <FiTable />}
            </button>
          )}
          <button
            className="widget-border-action-btn"
            style={{ backgroundColor: '#374151', color: '#f9fafb' }}
            onClick={(e) => { e.stopPropagation(); setExpandKey(k => k + 1); setIsExpanded(true); }}
            title="Expand"
          >
            <FiMaximize />
          </button>
          {onDelete && (
            <button
              className="widget-border-action-btn danger"
              style={{ backgroundColor: '#374151', color: '#f9fafb' }}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete widget"
            >
              <FiTrash2 />
            </button>
          )}
        </div>
      )}

      {/* Expand button in bottom right corner - only show in view mode */}
      {!isEditMode && (
        <button
          className="widget-expand-corner-btn"
          onClick={() => { setExpandKey(k => k + 1); setIsExpanded(true); }}
          title="Expand to full screen"
        >
          <FiMaximize />
        </button>
      )}

      {/* Expanded Modal - using Portal to render at document body level */}
      {isExpanded && createPortal(
        <div className="widget-expanded-overlay" onClick={() => setIsExpanded(false)}>
          <div className="widget-expanded-modal" onClick={(e) => e.stopPropagation()}>
            <div className="widget-expanded-header">
              <div className="widget-expanded-title">
                {getWidgetIcon()}
                <span>{widget.title}</span>
                {showData && effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot' && (
                  <span className="widget-data-badge" title="Viewing underlying data">
                    <FiTable />
                  </span>
                )}
              </div>
              <div className="widget-expanded-actions">
                {/* Toggle data view in expanded modal */}
                {effectiveWidgetType !== 'table' && effectiveWidgetType !== 'pivot' && (
                  <button 
                    className={`expanded-action-btn ${showData ? 'active' : ''}`}
                    onClick={() => setShowData(!showData)}
                    title={showData ? 'Show chart' : 'View underlying data'}
                  >
                    {showData ? <FiBarChart2 /> : <FiTable />}
                  </button>
                )}
                <button className="widget-expanded-close" onClick={() => setIsExpanded(false)}>
                  <FiX />
                </button>
              </div>
            </div>
            <div className="widget-expanded-content" ref={expandedContainerRef}>
              <div style={{ 
                width: '100%', 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'stretch',
                justifyContent: 'stretch',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <ExpandedContent 
                  key={`expanded-${widget.id}-${expandKey}`} 
                  widget={widget} 
                  data={data} 
                  config={effectiveConfig}
                  widgetType={effectiveWidgetType}
                  chartQuery={widget.chartQuery || {
                    xAxis: columnDimensions,
                    rows: rowDimensions,
                    series: colorField ? [colorField] : rowDimensions,
                    measures: measures,
                    marks: widget.marks || {},
                    colorField: colorField,
                    clusterField: clusterField,
                    tooltipFields: tooltipFields,
                    detailFields: detailFields,
                    labelFields: labelFields || [],
                  }}
                  showData={showData}
                />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}


      {/* AI Insights Panel */}
      {showInsights && createPortal(
        <div className="insights-modal-overlay">
          <div className="insights-modal" onClick={e => e.stopPropagation()}>
            <div className="insights-modal-header">
              <div className="insights-title">
                <HiSparkles className="insights-icon" />
                <span>Explain: {widget.title}</span>
              </div>
              <button className="close-btn" onClick={() => setShowInsights(false)}>
                <FiX />
              </button>
            </div>
            <div className="insights-modal-content">
              {insightsLoading ? (
                <div className="insights-loading">
                  <div className="loading-label">
                    <HiSparkles /> Generating Insights...
                  </div>
                  <div className="shimmer-skeleton">
                    {/* Key Findings section */}
                    <div className="shimmer-section">
                      <div className="shimmer-line header"></div>
                      <div className="shimmer-line full"></div>
                      <div className="shimmer-line long"></div>
                      <div className="shimmer-line medium"></div>
                    </div>
                    {/* Trends section */}
                    <div className="shimmer-section">
                      <div className="shimmer-line header"></div>
                      <div className="shimmer-line long"></div>
                      <div className="shimmer-line full"></div>
                    </div>
                    {/* Recommendations section */}
                    <div className="shimmer-section">
                      <div className="shimmer-line header"></div>
                      <div className="shimmer-line medium"></div>
                      <div className="shimmer-line short"></div>
                    </div>
                  </div>
                </div>
              ) : insightsError ? (
                <div className="insights-error">
                  <span>{insightsError}</span>
                </div>
              ) : insights ? (
                <div className="insights-text">
                  {insights.split('\n').map((line, idx) => {
                    if (line.match(/^[\s]*[-•]\s/)) {
                      return <div key={idx} className="insight-bullet">{line}</div>;
                    }
                    if (line.match(/^[\s]*\d+\.\s/)) {
                      return <div key={idx} className="insight-numbered">{line}</div>;
                    }
                    if (line.match(/^#+\s/) || line.match(/^[A-Z][A-Z\s]*:$/)) {
                      return <h5 key={idx} className="insight-header">{line.replace(/^#+\s/, '')}</h5>;
                    }
                    if (line.match(/^\*\*.*\*\*$/)) {
                      return <strong key={idx} className="insight-bold">{line.replace(/\*\*/g, '')}</strong>;
                    }
                    if (!line.trim()) {
                      return <div key={idx} className="insight-spacer" />;
                    }
                    return <p key={idx} className="insight-paragraph">{line}</p>;
                  })}
                </div>
              ) : (
                <div className="insights-empty">
                  <span>No insights generated yet</span>
                </div>
              )}
            </div>
            <div className="insights-modal-footer">
              <span className="insights-note">Powered by Snowflake Cortex</span>
              <button 
                className="btn btn-secondary"
                onClick={generateInsights}
                disabled={insightsLoading}
              >
                <HiSparkles /> {insightsLoading ? 'Generating...' : 'Generate Again'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// Expanded Content Component - Renders chart at full modal size
// Uses the same chartQuery structure as the main widget for full interactivity
const ExpandedContent = ({ widget, data, config, widgetType, chartQuery, showData }) => {
  const dataRows = Array.isArray(data) ? data : data?.rows;
  if (!dataRows?.length) {
    return <div className="widget-empty"><span>No data available</span></div>;
  }

  const type = widgetType || widget.type || 'bar';
  const query = chartQuery || {};
  
  if (showData && type !== 'table' && type !== 'pivot') {
    return sharedRenderChart('table', data, config, query, `expanded-${widget.id}-data`);
  }
  
  return sharedRenderChart(type, data, config, query, `expanded-${widget.id}`);
};

export default DashboardWidget;

