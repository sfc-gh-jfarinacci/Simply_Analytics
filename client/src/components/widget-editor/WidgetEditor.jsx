import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { semanticApi, sfConnectionApi } from '../../api/apiClient';


import { 
  FilterPopup, 
  ShelfPopup,
  SqlPreviewDropdown,
  AggregationDropdown,
  FieldTooltip,
  FieldsSection,
  FormattingSection,
  FiltersSortsSection,
  ShelvesSection,
  DataSourceSection,
  EditorHeader,
  AGGREGATION_OPTIONS,
} from './components';
import '../../styles/WidgetEditor.css';

// Constants and utilities from widget-editor module
import {
  COLOR_PRESETS,
  CHART_FORMAT_OPTIONS,
  getFormatDefaults,
  getChartConfig,
} from './constants';

import {
  parseColumnsToMetadata,
} from './utils';

import { useFilters, useSorts, useQueryPreview, useDragDrop, useWidgetConfig } from './hooks';

// Debug logging
const DEBUG = import.meta.env.VITE_DEBUG === 'true';
const log = (...args) => DEBUG && console.log(...args);

// Helper to strip entity prefix (e.g., "ORDERS.ORDER_COUNT" -> "ORDER_COUNT")
const stripEntityPrefixGlobal = (name) => {
  if (!name) return name;
  return name.includes('.') ? name.split('.').pop() : name;
};

// Helper to extract fields from fieldsUsed by placement
// Returns null if no fields found (to allow fallback logic to work)
const getFieldsByPlacement = (fieldsUsed, placement) => {
  if (!fieldsUsed || !Array.isArray(fieldsUsed) || fieldsUsed.length === 0) return null;
  const fields = fieldsUsed
    .filter(f => f.placement === placement)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(f => stripEntityPrefixGlobal(f.name)); // Strip entity prefixes
  return fields.length > 0 ? fields : null;
};

const WidgetEditor = ({ widget, dashboardId, onClose, onSave, onAutoSave, isNew = false, onConfigChange, onFormulaEditingChange }) => {
  const { 
    semanticModels, 
    currentDashboard, 
    getCachedViewMetadata, 
    setCachedViewMetadata,
    updateWidget,
  } = useAppStore();
  
  // Store original widget state for cancel/revert
  const originalWidgetRef = useRef(widget ? JSON.parse(JSON.stringify(widget)) : null);

  const [title, setTitle] = useState(widget?.title || '');
  const [widgetType, setWidgetType] = useState(widget?.type || 'table');
  const [semanticViewId, setSemanticViewId] = useState(() => {
    // Try to get semanticViewId from semanticViewsReferenced first
    if (widget?.semanticViewsReferenced?.[0]?.name) {
      return widget.semanticViewsReferenced[0].name;
    }
    return widget?.semanticViewId || '';
  });
  // Helper to strip entity prefix (e.g., "ORDERS.ORDER_COUNT" -> "ORDER_COUNT")
  const stripEntityPrefix = (name) => {
    if (!name) return name;
    return name.includes('.') ? name.split('.').pop() : name;
  };
  
  // Helper to extract fields from unified fields array by shelf
  const getFieldsFromUnified = (fields, shelf) => {
    if (!fields || !Array.isArray(fields)) return null;
    const shelfFields = fields.filter(f => f.shelf === shelf);
    // Strip entity prefixes from field names
    return shelfFields.length > 0 ? shelfFields.map(f => stripEntityPrefix(f.name)) : null;
  };

  // Initialize columns - priority: unified fields > fieldsUsed > queryDimensions > legacy
  const [columns, setColumns] = useState(() => {
    // Priority 1: UNIFIED fields array with shelf='columns'
    const fromUnified = getFieldsFromUnified(widget?.fields, 'columns');
    if (fromUnified) {
      console.log('[WidgetEditor] Columns from unified fields:', fromUnified);
      return fromUnified;
    }
    
    // Priority 2: fieldsUsed with placement='column'
    const fromFieldsUsed = getFieldsByPlacement(widget?.fieldsUsed, 'column');
    if (fromFieldsUsed && fromFieldsUsed.length > 0) {
      console.log('[WidgetEditor] Columns from fieldsUsed:', fromFieldsUsed);
      return fromFieldsUsed;
    }
    
    // Priority 3: queryDimensions (newer format - dimensions go to columns)
    if (widget?.queryDimensions && widget.queryDimensions.length > 0) {
      console.log('[WidgetEditor] Columns from queryDimensions:', widget.queryDimensions);
      return [...widget.queryDimensions];
    }
    
    // Priority 4: legacy query.dimensions
    if (widget?.query?.dimensions && widget.query.dimensions.length > 0) {
      console.log('[WidgetEditor] Columns from query.dimensions:', widget.query.dimensions);
      return [...widget.query.dimensions];
    }
    
    console.log('[WidgetEditor] No columns found, returning empty array');
    return [];
  });
  
  // Initialize rows - priority: unified fields > fieldsUsed > queryMeasures > legacy
  const [rows, setRows] = useState(() => {
    // Priority 1: UNIFIED fields array with shelf='rows'
    const fromUnified = getFieldsFromUnified(widget?.fields, 'rows');
    if (fromUnified) {
      console.log('[WidgetEditor] Rows from unified fields:', fromUnified);
      return fromUnified;
    }
    
    // Priority 2: fieldsUsed with placement='row'
    const fromFieldsUsed = getFieldsByPlacement(widget?.fieldsUsed, 'row');
    if (fromFieldsUsed && fromFieldsUsed.length > 0) {
      console.log('[WidgetEditor] Rows from fieldsUsed:', fromFieldsUsed);
      return fromFieldsUsed;
    }
    
    // Priority 3: queryMeasures (newer format - measures go to rows for charts)
    if (widget?.queryMeasures && widget.queryMeasures.length > 0) {
      console.log('[WidgetEditor] Rows from queryMeasures:', widget.queryMeasures);
      return [...widget.queryMeasures];
    }
    
    // Priority 4: fieldsUsed with placement='value' (measures)
    const fromValues = getFieldsByPlacement(widget?.fieldsUsed, 'value');
    if (fromValues && fromValues.length > 0) {
      console.log('[WidgetEditor] Rows from fieldsUsed value placement:', fromValues);
      return fromValues;
    }
    
    console.log('[WidgetEditor] No rows found, returning empty array');
    return [];
  });
  const [values, setValues] = useState(() => {
    // Note: Since we removed the Values shelf and measures go through Marks,
    // values is now mainly used for internal query building.
    // Fields from fieldsUsed with placement 'value' are loaded into markFields instead.
    // We keep values empty to avoid duplication.
    return [];
  });
  
  const [colorPreset, setColorPreset] = useState(widget?.config?.colorPresetIndex ?? 0);
  const [customScheme, setCustomScheme] = useState(widget?.config?.customScheme || null);
  
  // Helper to get current color config (handles both presets and custom)
  const getColorConfig = useCallback(() => {
    if (colorPreset === -1 && customScheme) {
      return {
        colors: customScheme.colors,
        colorScheme: null, // No scheme key for custom - use colors directly
        colorSchemeType: customScheme.type || 'categorical',
        colorPresetIndex: -1,
        customScheme: customScheme,
      };
    }
    const preset = COLOR_PRESETS[colorPreset] || COLOR_PRESETS[0];
    return {
      colors: preset.colors,
      colorScheme: preset.schemeKey,
      colorSchemeType: preset.type,
      colorPresetIndex: colorPreset,
      customScheme: null, // Clear custom scheme reference when using a preset
    };
  }, [colorPreset, customScheme]);
  
  const [customConfig, setCustomConfig] = useState(() => ({
    ...getFormatDefaults(widget?.type || 'table'),
    ...widget?.config,
  }));
  const [prevWidgetType, setPrevWidgetType] = useState(widget?.type || 'table');
  // previewData is handled by DashboardWidget via editingWidgetConfig
  const [loading, setLoading] = useState(false);
  // Drag state is now managed by useDragDrop hook (called after markFields is defined)
  const [titleError, setTitleError] = useState('');
  
  // Shelf field picker popup state
  const [shelfPopup, setShelfPopup] = useState({ open: null, search: '', x: 0, y: 0, openUp: false }); // open: 'columns' | 'rows' | null
  const [pendingColumns, setPendingColumns] = useState([]); // Pending selections before OK
  const [pendingRows, setPendingRows] = useState([]); // Pending selections before OK
  
  // Aggregation dropdown state
  const [aggDropdown, setAggDropdown] = useState({ open: false, shelf: null, idx: null, x: 0, y: 0 });
  
  // Tooltip state for instant field name display
  const [fieldTooltip, setFieldTooltip] = useState({ visible: false, name: '', type: '', x: 0, y: 0 });
  
  // Semantic view state
  const [semanticViews, setSemanticViews] = useState([]);
  const [selectedView, setSelectedView] = useState(null);
  const [viewMetadata, setViewMetadata] = useState(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  
  // Combine facts and dimensions for the field list
  // IMPORTANT: This must be defined BEFORE useEffects that use it
  // Note: Date part fields (YEAR, QUARTER, MONTH, etc.) are NOT auto-generated.
  // Users can create their own date transformations using calculated fields/formulas.
  const allDimensions = useMemo(() => {
    return [
      ...(viewMetadata?.facts || []),
      ...(viewMetadata?.dimensions || []),
    ].map(dim => ({ ...dim, isDatePart: false }));
  }, [viewMetadata]);
  
  // Component-level helper functions for field type checking (case-insensitive)
  const normalizeFieldName = useCallback((name) => name?.toUpperCase?.() || '', []);
  
  // Ensure every calculated field has a stable UUID
  const ensureCalcFieldIds = (fields) =>
    (fields || []).map(f => f.id ? f : { ...f, id: crypto.randomUUID() });

  // Calculated fields state - must be before useFilters hook which depends on it
  const [customColumns, setCustomColumns] = useState(() => ensureCalcFieldIds(widget?.customColumns));
  
  // Helper to get the fully qualified name for the current semantic view
  // Must be defined before useFilters hook
  const getFullyQualifiedName = useCallback(() => {
    if (!semanticViewId) return null;
    
    const viewObj = semanticViews.find(v => 
      (typeof v === 'string' ? v : v.name) === semanticViewId
    );
    
    // Try multiple sources for the fully qualified name
    
    // 1. From the view object itself
    if (typeof viewObj === 'object' && viewObj) {
      if (viewObj.fullyQualifiedName) return viewObj.fullyQualifiedName;
      if (viewObj.full_name) return viewObj.full_name;
      if (viewObj.database && viewObj.schema && viewObj.name) {
        return `${viewObj.database}.${viewObj.schema}.${viewObj.name}`;
      }
      if (viewObj.databaseName && viewObj.schemaName && viewObj.name) {
        return `${viewObj.databaseName}.${viewObj.schemaName}.${viewObj.name}`;
      }
    }
    
    // 2. From widget's semanticViewsReferenced
    if (widget?.semanticViewsReferenced?.[0]?.fullyQualifiedName) {
      return widget.semanticViewsReferenced[0].fullyQualifiedName;
    }
    
    // 3. From dashboard's semanticViewsReferenced
    if (currentDashboard?.semanticViewsReferenced) {
      const dashboardView = currentDashboard.semanticViewsReferenced.find(v => 
        (typeof v === 'string' ? v : v.name) === semanticViewId
      );
      if (typeof dashboardView === 'object' && dashboardView?.fullyQualifiedName) {
        return dashboardView.fullyQualifiedName;
      }
    }
    
    // 4. Last resort - construct from dashboard connection info
    const viewName = typeof viewObj === 'string' ? viewObj : (viewObj?.name || semanticViewId);
    const dashboardDb = currentDashboard?.connection?.database;
    const dashboardSchema = currentDashboard?.connection?.schema || 'PUBLIC';
    if (dashboardDb && viewName) {
      return `${dashboardDb}.${dashboardSchema}.${viewName}`;
    }
    
    return null;
  }, [semanticViewId, semanticViews, currentDashboard, widget?.semanticViewsReferenced]);

  // Create a ref to pass getFullyQualifiedName to hooks
  const getFullyQualifiedNameRef = useRef(getFullyQualifiedName);
  getFullyQualifiedNameRef.current = getFullyQualifiedName;

  // Use the filters hook - must be called before useEffects that depend on filters
  const {
    filters,
    setFilters,
    filterPopup,
    setFilterPopup,
    filterSearch,
    filterPopupRef,
    showFilterPanel,
    setShowFilterPanel,
    exprAutocomplete,
    setExprAutocomplete,
    customExprRef,
    openFilterPopup,
    closeFilterPopup,
    handleFilterListScroll,
    handleFilterSearchChange,
    handleCustomExpressionChange,
    handleExprKeyDown,
    insertExprAutocomplete,
    applyAdvancedFilter,
    toggleFilterValue,
    isValueSelected,
    removeFilter,
    getFilterForField,
  } = useFilters({
    initialFilters: widget?.filtersApplied || [],
    allDimensions,
    measures: viewMetadata?.measures,
    customColumns,
    getFullyQualifiedNameRef,
    currentDashboard,
  });

  // Use the sorts hook - must be called before useEffects that depend on sorts
  const {
    sorts,
    setSorts,
    showSortPanel,
    setShowSortPanel,
    addSort,
    removeSort,
    updateSortDirection,
    toggleSortDirection,
    moveSortUp,
    moveSortDown,
    getSortForField,
  } = useSorts(widget?.sortsApplied || []);

  const filterListRef = useRef(null);
  // SQL preview dropdown state - { open: boolean, x: number, y: number }
  const [sqlPreviewDropdown, setSqlPreviewDropdown] = useState({ open: false, x: 0, y: 0 });
  const [copiedSql, setCopiedSql] = useState(false);
  
  // Reset copied state when dropdown closes
  useEffect(() => {
    if (!sqlPreviewDropdown.open) {
      setCopiedSql(false);
    }
  }, [sqlPreviewDropdown.open]);
  const [refreshEnabled, setRefreshEnabled] = useState(widget?.config?.refreshEnabled !== false);
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const [forceNextRefresh, setForceNextRefresh] = useState(false);
  const [showChartPicker, setShowChartPicker] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [fieldSearch, setFieldSearch] = useState('');
  const [editingPill, setEditingPill] = useState(null); // { shelf: 'columns'|'rows', fieldName: string }
  const editingPillInputRef = useRef(null);
  
  // Filtered dimensions and measures based on search
  const filteredDimensions = useMemo(() => {
    if (!fieldSearch.trim()) return allDimensions;
    const search = fieldSearch.toLowerCase();
    return allDimensions.filter(d => 
      d.name.toLowerCase().includes(search) ||
      (d.parentEntity && d.parentEntity.toLowerCase().includes(search))
    );
  }, [allDimensions, fieldSearch]);
  
  const filteredMeasures = useMemo(() => {
    if (!fieldSearch.trim()) return viewMetadata?.measures || [];
    const search = fieldSearch.toLowerCase();
    return (viewMetadata?.measures || []).filter(m => 
      m.name.toLowerCase().includes(search) ||
      (m.parentEntity && m.parentEntity.toLowerCase().includes(search))
    );
  }, [viewMetadata?.measures, fieldSearch]);
  
  // Calculated field state - FormulaBar replaces the old modal
  // Note: customColumns state is declared earlier (before hooks)
  const [showFormulaBar, setShowFormulaBar] = useState(false);
  const [editingCalculatedField, setEditingCalculatedField] = useState(null);
  const [calcFieldDeleteError, setCalcFieldDeleteError] = useState(null); // { fieldName, message }
  
  // Notify parent when formula editing state changes
  useEffect(() => {
    onFormulaEditingChange?.(showFormulaBar);
  }, [showFormulaBar, onFormulaEditingChange]);
  
  // Filtered calculated fields (must be after customColumns is declared)
  const filteredCalcFields = useMemo(() => {
    if (!fieldSearch.trim()) return customColumns;
    const search = fieldSearch.toLowerCase();
    return customColumns.filter(c => 
      c.name.toLowerCase().includes(search) ||
      (c.displayName && c.displayName.toLowerCase().includes(search))
    );
  }, [customColumns, fieldSearch]);
  
  // Track last saved calc fields to avoid unnecessary updates
  const lastSavedCalcFieldsRef = useRef(null);
  
  // Auto-save calculated fields to dashboard when they change
  // Uses a ref to compare and only update if there's an actual change
  // This saves to the dashboard but DashboardWidget now uses stable keys
  // so it won't re-render unless the actual field definitions change
  useEffect(() => {
    if (!currentDashboard || !semanticViewId) return;
    
    // Create a stable key for current calc fields
    const currentKey = JSON.stringify(customColumns.map(c => ({ name: c.name, expression: c.expression })));
    
    // Skip if nothing changed
    if (lastSavedCalcFieldsRef.current === currentKey) return;
    
    // Skip initial render with empty custom columns
    if (customColumns.length === 0 && lastSavedCalcFieldsRef.current === null) {
      lastSavedCalcFieldsRef.current = currentKey;
      return;
    }
    
    // Debounce the save to avoid rapid updates
    const timer = setTimeout(() => {
      const { updateDashboard } = useAppStore.getState();
      const viewObj = semanticViews.find(v => (typeof v === 'string' ? v : v.name) === semanticViewId);
      const fullyQualifiedName = typeof viewObj === 'object' ? (viewObj?.fullyQualifiedName || viewObj?.full_name || semanticViewId) : semanticViewId;
      const dashboardViews = [...(currentDashboard.semanticViewsReferenced || [])];
      const existingViewIndex = dashboardViews.findIndex(v => 
        (typeof v === 'string' ? v : v.name) === semanticViewId
      );
      
      if (existingViewIndex >= 0) {
        const existingView = dashboardViews[existingViewIndex];
        const existingCalcFields = existingView.calculatedFields || [];
        
        // Merge calculated fields
        const mergedCalcFields = [...existingCalcFields];
        customColumns.forEach(newCf => {
          const existingIndex = mergedCalcFields.findIndex(cf => cf.name === newCf.name);
          if (existingIndex >= 0) {
            mergedCalcFields[existingIndex] = newCf;
          } else {
            mergedCalcFields.push(newCf);
          }
        });
        
        dashboardViews[existingViewIndex] = {
          ...existingView,
          calculatedFields: mergedCalcFields,
        };
        
        updateDashboard(currentDashboard.id, {
          semanticViewsReferenced: dashboardViews,
        });
      } else if (semanticViewId && customColumns.length > 0) {
        // Add new view entry
        dashboardViews.push({
          name: semanticViewId,
          fullyQualifiedName: fullyQualifiedName || semanticViewId,
          calculatedFields: customColumns,
        });
        
        updateDashboard(currentDashboard.id, {
          semanticViewsReferenced: dashboardViews,
        });
      }
      
      lastSavedCalcFieldsRef.current = currentKey;
    }, 500); // Debounce 500ms
    
    return () => clearTimeout(timer);
  }, [customColumns, currentDashboard?.id, semanticViewId]);
  
  // Auto-save widget config when it changes
  const autoSaveTimerRef = useRef(null);
  const autoSaveMountTimeRef = useRef(Date.now());
  const prevFiltersRef = useRef(filters);
  const prevSortsRef = useRef(sorts);
  
  // Build the auto-save payload (shared between debounced and immediate paths)
  const buildAutoSaveUpdates = useCallback(() => {
    const fieldsUsed = [];
    
    columns.forEach((field, index) => {
      const fieldName = typeof field === 'object' && field !== null ? field.name : field;
      const aggregation = typeof field === 'object' && field !== null ? field.aggregation : null;
      fieldsUsed.push({ 
        name: fieldName, 
        order: index, 
        placement: 'column',
        ...(aggregation && { aggregation })
      });
    });
    
    rows.forEach((field, index) => {
      const fieldName = typeof field === 'object' && field !== null ? field.name : field;
      const aggregation = typeof field === 'object' && field !== null ? field.aggregation : null;
      fieldsUsed.push({ 
        name: fieldName, 
        order: index, 
        placement: 'row',
        ...(aggregation && { aggregation })
      });
    });
    
    values.forEach((field, index) => {
      const fieldName = typeof field === 'object' && field !== null ? field.name : field;
      fieldsUsed.push({ name: fieldName, order: index, placement: 'value' });
    });
    
    const viewObj = semanticViews.find(v => (typeof v === 'string' ? v : v.name) === semanticViewId);
    const fqn = typeof viewObj === 'object' ? (viewObj?.fullyQualifiedName || viewObj?.full_name || semanticViewId) : semanticViewId;
    const semanticViewsReferenced = semanticViewId ? [{
      name: semanticViewId,
      fullyQualifiedName: fqn || semanticViewId,
      calculatedFields: customColumns,
    }] : [];
    
    return {
      title: title.trim(),
      type: widgetType,
      config: {
        ...customConfig,
        ...getColorConfig(),
      },
      fieldsUsed,
      filtersApplied: filters,
      sortsApplied: sorts,
      semanticViewsReferenced,
      customColumns,
      query: {
        dimensions: columns.map(f => typeof f === 'object' ? f.name : f),
        measures: values.map(f => typeof f === 'object' ? f.name : f),
        filters,
        orderBy: sorts,
        limit: 1000000,
      },
    };
  }, [title, widgetType, columns, rows, values, filters, sorts, customColumns, customConfig, semanticViewId, getColorConfig, semanticViews]);
  
  useEffect(() => {
    if (!onAutoSave) return;
    if (!title.trim()) return;
    
    if (Date.now() - autoSaveMountTimeRef.current < 800) {
      return;
    }
    
    // Flush immediately when filters or sorts change (discrete user actions)
    const filtersChanged = filters !== prevFiltersRef.current;
    const sortsChanged = sorts !== prevSortsRef.current;
    prevFiltersRef.current = filters;
    prevSortsRef.current = sorts;
    
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    
    const delay = (filtersChanged || sortsChanged) ? 0 : 1000;
    
    autoSaveTimerRef.current = setTimeout(() => {
      onAutoSave(buildAutoSaveUpdates());
    }, delay);
    
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [title, widgetType, columns, rows, values, filters, sorts, customColumns, customConfig, semanticViewId, onAutoSave, getColorConfig, semanticViews, buildAutoSaveUpdates]);
  
  // Field type checking functions (must be after customColumns is declared)
  // Handle both string field names and field objects
  const isMeasureField = useCallback((field) => {
    // Extract field name if it's an object
    const name = typeof field === 'object' && field !== null ? field.name : field;
    const normalized = normalizeFieldName(name);
    // Check if it's a regular measure from semantic view
    if ((viewMetadata?.measures || []).some(m => normalizeFieldName(m.name) === normalized)) {
      return true;
    }
    // Check if it's a calculated field with aggregate function (makes it a measure)
    const calcField = customColumns.find(c => normalizeFieldName(c.name) === normalized);
    if (calcField) {
      const expr = (calcField.expression || '').toUpperCase();
      return expr.includes('SUM(') || expr.includes('AVG(') || expr.includes('COUNT(') || 
             expr.includes('MIN(') || expr.includes('MAX(') || expr.includes('MEDIAN(') ||
             expr.includes('STDDEV(') || expr.includes('VARIANCE(');
    }
    return false;
  }, [viewMetadata, normalizeFieldName, customColumns]);
  
  // Handle both string field names and field objects
  const isDimensionField = useCallback((field) => {
    // Extract field name if it's an object
    const name = typeof field === 'object' && field !== null ? field.name : field;
    const normalized = normalizeFieldName(name);
    // Check if it's a regular dimension from semantic view
    if (allDimensions.some(d => normalizeFieldName(d.name) === normalized)) {
      return true;
    }
    // Check if it's a calculated field WITHOUT aggregate function (makes it a dimension)
    const calcField = customColumns.find(c => normalizeFieldName(c.name) === normalized);
    if (calcField) {
      const expr = (calcField.expression || '').toUpperCase();
      const isAggregate = expr.includes('SUM(') || expr.includes('AVG(') || expr.includes('COUNT(') || 
                          expr.includes('MIN(') || expr.includes('MAX(') || expr.includes('MEDIAN(') ||
                          expr.includes('STDDEV(') || expr.includes('VARIANCE(');
      return !isAggregate; // Non-aggregate calculated fields are dimensions
    }
    return false;
  }, [allDimensions, normalizeFieldName, customColumns]);
  
  // Marks card state (Tableau-style visual encodings)
  // Each mark field has: { field: string, type: 'color' | 'size' | 'label' | 'detail' | 'tooltip' | null }
  const [markFields, setMarkFields] = useState(() => {
    // If we have the new markFields format, use it directly
    if (widget?.markFields?.length) return widget.markFields;
    
    // Convert from old format if needed
    const existingMarks = widget?.marks || {};
    const fields = [];
    const addedFields = new Set();
    
    // Add fields from legacy marks format
    if (existingMarks.color) {
      fields.push({ field: existingMarks.color, type: 'color' });
      addedFields.add(existingMarks.color);
    }
    if (existingMarks.size) {
      fields.push({ field: existingMarks.size, type: 'size' });
      addedFields.add(existingMarks.size);
    }
    if (existingMarks.label) {
      fields.push({ field: existingMarks.label, type: 'label' });
      addedFields.add(existingMarks.label);
    }
    if (existingMarks.detail?.length) {
      existingMarks.detail.forEach(f => {
        if (!addedFields.has(f)) {
          fields.push({ field: f, type: 'detail' });
          addedFields.add(f);
        }
      });
    }
    if (existingMarks.tooltip?.length) {
      existingMarks.tooltip.forEach(f => {
        if (!addedFields.has(f)) {
          fields.push({ field: f, type: 'tooltip' });
          addedFields.add(f);
        }
      });
    }
    
    // Also load measures from fieldsUsed with placement 'value'
    // These are shown in the Marks panel as unassigned (they're the Values)
    const valueFields = getFieldsByPlacement(widget?.fieldsUsed, 'value') || [];
    valueFields.forEach(f => {
      if (!addedFields.has(f)) {
        // Add as unassigned mark - user can drag to a tile to assign type
        fields.push({ field: f, type: null });
        addedFields.add(f);
      }
    });
    
    return fields;
  });
  
  // Field aggregations state - maps fieldName -> aggregation type (sum, avg, min, max, etc.)
  const [fieldAggregations, setFieldAggregations] = useState(() => {
    const aggs = {};
    
    // Priority 1: UNIFIED fields array
    if (widget?.fields && Array.isArray(widget.fields)) {
      widget.fields.forEach(f => {
        if (f.aggregation && f.name) {
          aggs[f.name] = f.aggregation;
        }
      });
      if (Object.keys(aggs).length > 0) return aggs;
    }
    
    // Priority 2: widget config
    if (widget?.config?.fieldAggregations) {
      Object.assign(aggs, widget.config.fieldAggregations);
    }
    
    // Priority 3: fieldsUsed
    widget?.fieldsUsed?.forEach(f => {
      if (f.aggregation && f.name) {
        aggs[f.name] = f.aggregation;
      }
    });
    
    return aggs;
  });
  
  // Field mark types state - maps fieldName -> markType for pills
  const [fieldMarkTypes, setFieldMarkTypes] = useState(() => {
    const markTypes = {};
    
    // Priority 1: UNIFIED fields array
    if (widget?.fields && Array.isArray(widget.fields)) {
      widget.fields.forEach(f => {
        if (f.markType && f.name) {
          markTypes[f.name] = f.markType;
        }
      });
      if (Object.keys(markTypes).length > 0) return markTypes;
    }
    
    // Priority 2: widget config
    return widget?.config?.fieldMarkTypes || {};
  });
  
  // Keep markFields types in sync when fieldMarkTypes changes (e.g., user
  // picks a mark type from the pill popup, which only updates fieldMarkTypes).
  useEffect(() => {
    setMarkFields(prev => {
      const updated = prev.map(mf => {
        const newType = fieldMarkTypes[mf.field] ?? mf.type;
        return newType !== mf.type ? { ...mf, type: newType } : mf;
      });
      return updated.some((mf, i) => mf !== prev[i]) ? updated : prev;
    });
  }, [fieldMarkTypes]);

  // Field configs state - per-field formatting options (data type, number format, text color, etc.)
  const [fieldConfigs, setFieldConfigs] = useState(() => {
    return widget?.config?.fieldConfigs || {};
  });
  
  // Handler for toggling sort from pill click: no sort -> ASC -> DESC -> no sort
  const handlePillToggleSort = useCallback((fieldName, currentDirection) => {
    if (!currentDirection) {
      // No sort -> ASC
      addSort(fieldName);
    } else if (currentDirection === 'ASC') {
      // ASC -> DESC
      updateSortDirection(fieldName, 'DESC');
    } else {
      // DESC -> remove
      removeSort(fieldName);
    }
  }, [addSort, updateSortDirection, removeSort]);
  
  // Handler for adding filter from pill click
  const handlePillAddFilter = useCallback((fieldName, event) => {
    // openFilterPopup expects a field object with a name property
    openFilterPopup({ name: fieldName }, event);
  }, [openFilterPopup]);
  
  // Derive old marks format from markFields for compatibility
  const marks = useMemo(() => {
    const result = { color: null, cluster: null, size: null, label: null, detail: [], tooltip: [] };
    markFields.forEach(mf => {
      if (mf.type === 'color') result.color = mf.field;
      else if (mf.type === 'cluster') result.cluster = mf.field;
      else if (mf.type === 'size') result.size = mf.field;
      else if (mf.type === 'label') result.label = mf.field;
      else if (mf.type === 'detail') result.detail.push(mf.field);
      else if (mf.type === 'tooltip') result.tooltip.push(mf.field);
    });
    return result;
  }, [markFields]);
  
  // Use drag and drop hook
  const {
    draggedField,
    dragSource,
    dragOverZone,
    dragOverIndex,
    dragOverShelf,
    setDragOverZone,
    setDragOverIndex,
    handleFieldDragStart,
    handleFieldDragEnd,
    handleShelfDragOver,
    handleShelfDragLeave,
    handleShelfDrop,
    removeFromShelf,
    handlePillDragStart,
    handlePillDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeFromZone,
  } = useDragDrop({
    columns,
    rows,
    values,
    setColumns,
    setRows,
    setValues,
    setMarkFields,
    customColumns,
    sorts,
    setSorts,
  });
  
  // Format options - initialize with chart-specific defaults
  const [fontSize, setFontSize] = useState(widget?.config?.fontSize || getFormatDefaults(widget?.type || 'table').fontSize);
  const [textColor, setTextColor] = useState(widget?.config?.textColor || getFormatDefaults(widget?.type || 'table').textColor);
  const [labelColor, setLabelColor] = useState(widget?.config?.labelColor || getFormatDefaults(widget?.type || 'table').labelColor);
  const [numberFormat, setNumberFormat] = useState(widget?.config?.numberFormat || 'auto');
  const [decimalPlaces, setDecimalPlaces] = useState(widget?.config?.decimalPlaces ?? 2);
  
  // Column aliases - custom display names for columns
  // Loaded from dashboard-level semanticViewsReferenced to share across widgets
  const [columnAliases, setColumnAliases] = useState(() => {
    const aliases = {};
    
    // Priority 1: UNIFIED fields array
    if (widget?.fields && Array.isArray(widget.fields)) {
      widget.fields.forEach(f => {
        if (f.alias && f.name) {
          aliases[f.name] = f.alias;
        }
      });
      if (Object.keys(aliases).length > 0) return aliases;
    }
    
    // Priority 2: Dashboard-level aliases for the semantic view
    const viewId = widget?.semanticViewsReferenced?.[0]?.name || widget?.semanticViewId;
    if (viewId && currentDashboard?.semanticViewsReferenced) {
      const dashboardView = currentDashboard.semanticViewsReferenced.find(v => 
        (typeof v === 'string' ? v : v.name) === viewId
      );
      if (dashboardView && typeof dashboardView === 'object' && dashboardView.columnAliases) {
        return dashboardView.columnAliases;
      }
    }
    
    // Priority 3: Widget-level config for backwards compatibility
    return widget?.config?.columnAliases || {};
  });

  const chartPickerRef = useRef(null);
  const chartConfig = getChartConfig(widgetType);

  // Unified widget config - SINGLE SOURCE OF TRUTH for field configuration
  const {
    config: widgetConfig,
    fields: configFields,
    dimensions: configDimensions,
    measures: configMeasures,
    semanticViewFQN,
    isValid: configIsValid,
    getFieldMetadata,
    getSemanticType,
  } = useWidgetConfig({
    semanticViewId,
    semanticViews,
    viewMetadata,
    columns,
    rows,
    values,
    markFields,
    fieldMarkTypes,
    fieldAggregations,
    columnAliases,
    filters,
    sorts,
    customColumns,
    connectionId: currentDashboard?.connection_id,
    role: currentDashboard?.role,
    warehouse: currentDashboard?.warehouse,
  });

  // Live SQL preview - uses the unified config
  // Backend is the SINGLE SOURCE OF TRUTH for SQL generation
  const { liveQueryPreview, dimensions: previewDimensions, measures: previewMeasures, previewLoading } = useQueryPreview({
    config: widgetConfig,
  });

  // Track last synced state to avoid infinite loops
  const lastSyncedRef = useRef(null);
  const syncTimeoutRef = useRef(null);
  // Stabilization window: when the editor opens, metadata loading and field
  // reclassification cause several rapid re-computations.  We absorb ALL of
  // them by treating everything within the first ~800ms as "initial" — the
  // baseline key is updated silently without marking unsaved.
  const mountTimeRef = useRef(Date.now());
  const isStabilizingRef = useRef(true);
  
  // Memoize the fields array to prevent unnecessary effect triggers
  const fieldsKey = useMemo(() => {
    return JSON.stringify(widgetConfig?.fields?.map(f => ({ name: f.name, shelf: f.shelf, markType: f.markType })) || []);
  }, [widgetConfig?.fields]);
  
  // Memoize marks to prevent unnecessary effect triggers
  const marksKey = useMemo(() => {
    return JSON.stringify((markFields || []).filter(mf => mf.field).map(mf => ({ type: mf.type, field: mf.field })));
  }, [markFields]);
  
  // Memoize customConfig to prevent unnecessary effect triggers
  const customConfigKey = useMemo(() => {
    return JSON.stringify(customConfig);
  }, [customConfig]);
  
  // Debounced sync to global config for real-time updates to DashboardWidget
  // Uses debounce + comparison to prevent infinite loops
  useEffect(() => {
    // Skip for new widgets (not yet in global config) or if no dashboard
    if (!widget?.id || isNew || !currentDashboard?.id || !updateWidget) return;
    
    // CRITICAL: Don't sync until metadata is loaded.
    // Without metadata, useWidgetConfig classifies ALL fields as 'dimension' by default,
    // which causes measures to be sent in the DIMENSIONS clause and Snowflake rejects them.
    if (!viewMetadata && semanticViewId) return;
    
    // Build a sync key from PRIMITIVE values only to detect actual changes
    // Title is excluded — it syncs separately to avoid triggering data reloads.
    const syncKey = `${widgetType}|${semanticViewFQN}|${fieldsKey}|${configDimensions?.join(',')}|${configMeasures?.join(',')}|${colorPreset}|${marksKey}|${customConfigKey}`;
    
    // During the stabilization window (~800ms after mount), metadata loading
    // and field reclassification cause the syncKey to shift several times.
    // Keep absorbing those changes into the baseline so they don't mark the
    // dashboard as unsaved.
    if (isStabilizingRef.current) {
      if (Date.now() - mountTimeRef.current < 800) {
        lastSyncedRef.current = syncKey;
        return;
      }
      isStabilizingRef.current = false;
      lastSyncedRef.current = syncKey;
      return;
    }
    
    // Skip if nothing actually changed
    if (lastSyncedRef.current === syncKey) {
      return;
    }
    
    // Clear any pending sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    
    // Debounce the sync to prevent rapid updates
    syncTimeoutRef.current = setTimeout(() => {
      // Double-check the key hasn't changed during debounce
      if (lastSyncedRef.current === syncKey) return;
      lastSyncedRef.current = syncKey;
      
      // Build the unified widget definition
      const updatedWidget = {
        title,
        type: widgetType,
        semanticView: semanticViewFQN,
        fields: widgetConfig?.fields || [],
        filters: widgetConfig?.filters || [],
        sorts: widgetConfig?.sorts || [],
        filtersApplied: widgetConfig?.filters || [],
        sortsApplied: widgetConfig?.sorts || [],
        customColumns: widgetConfig?.customColumns || [],
        queryDimensions: configDimensions,
        queryMeasures: configMeasures,
        semanticViewsReferenced: semanticViewId ? [{
          name: semanticViewId,
          fullyQualifiedName: semanticViewFQN || semanticViewId,
        }] : [],
        marks: Object.fromEntries(
          (markFields || [])
            .filter(mf => mf.field && mf.type && mf.type !== 'label')
            .map(mf => [mf.type, mf.field])
        ),
        markFields,
        config: {
          colorPresetIndex: colorPreset,
          customScheme,
          ...customConfig,
          ...getColorConfig(),
          refreshEnabled,
          columnAliases,
        },
      };
      
      // Write to global config
      updateWidget(currentDashboard.id, widget.id, updatedWidget);
    }, 300); // 300ms debounce - longer to allow chart type transitions to settle
    
    // Cleanup on unmount
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
    // Only include stable/primitive dependencies to avoid infinite loops
    // Title is NOT included — it has its own lightweight sync below.
  }, [widget?.id, isNew, currentDashboard?.id, widgetType, semanticViewFQN, fieldsKey, configDimensions, configMeasures, semanticViewId, colorPreset, marksKey, customConfigKey, updateWidget, viewMetadata]);

  // Lightweight title-only sync — updates the widget header in real time
  // without rewriting fields/dimensions/config, so no data reload is triggered.
  const lastSyncedTitleRef = useRef(title);
  useEffect(() => {
    if (!widget?.id || isNew || !currentDashboard?.id || !updateWidget) return;
    if (title === lastSyncedTitleRef.current) return;
    lastSyncedTitleRef.current = title;
    updateWidget(currentDashboard.id, widget.id, { title });
  }, [widget?.id, isNew, currentDashboard?.id, title, updateWidget]);

  // Close chart picker on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (chartPickerRef.current && !chartPickerRef.current.contains(e.target)) {
        setShowChartPicker(false);
        setExpandedCategory(null);
      }
    };
    if (showChartPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showChartPicker]);

  // Keyboard shortcuts for WidgetEditor
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape = Close editor
      if (e.key === 'Escape') {
        // Don't close if formula bar is open
        if (showFormulaBar) return;
        onClose();
      }
      
      // Ctrl/Cmd + Enter = Save widget
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showFormulaBar]);

  // Handle chart type changes - migrate overlapping format options and apply new defaults
  useEffect(() => {
    if (widgetType !== prevWidgetType) {
      const prevOptions = CHART_FORMAT_OPTIONS[prevWidgetType] || {};
      const newOptions = CHART_FORMAT_OPTIONS[widgetType] || {};
      const newDefaults = getFormatDefaults(widgetType);
      
      // Build new config: start with new defaults, then overlay migrated values
      const migratedConfig = { ...newDefaults };
      
      // Migrate overlapping options (keep current value if both chart types support it)
      const overlappingKeys = ['showGrid', 'showLabels', 'showLegend', 'showDots', 'animate', 'labelColor', 'showTotals'];
      overlappingKeys.forEach(key => {
        if (prevOptions[key] && newOptions[key] && customConfig[key] !== undefined) {
          migratedConfig[key] = customConfig[key];
        }
      });
      
      // Always keep color preset and fontSize (universal options)
      migratedConfig.colorPreset = colorPreset;
      migratedConfig.fontSize = fontSize;
      
      setCustomConfig(migratedConfig);
      
      // Update individual state for options that changed defaults
      if (migratedConfig.labelColor !== labelColor) {
        setLabelColor(migratedConfig.labelColor);
      }
      
      setPrevWidgetType(widgetType);
    }
  }, [widgetType, prevWidgetType, customConfig, colorPreset, fontSize, labelColor]);

  // Track if we've initialized semantic views (to prevent infinite loops in inline mode)
  const semanticViewsInitializedRef = useRef(false);
  const widgetIdRef = useRef(widget?.id);

  // Load semantic views from dashboard on mount (only once per widget)
  useEffect(() => {
    // Only initialize once, or when switching to a different widget
    if (semanticViewsInitializedRef.current && widgetIdRef.current === widget?.id) {
      return;
    }
    
    semanticViewsInitializedRef.current = true;
    widgetIdRef.current = widget?.id;
    
    log('WidgetEditor: Loading semantic views from dashboard:', {
      dashboardId: currentDashboard?.id,
      semanticViewsReferenced: currentDashboard?.semanticViewsReferenced,
    });
    
    if (currentDashboard?.semanticViewsReferenced && currentDashboard.semanticViewsReferenced.length > 0) {
      setSemanticViews(currentDashboard.semanticViewsReferenced);
      
      // If editing existing widget, try to restore the selected view
      if (widget?.semanticViewId) {
        setSemanticViewId(widget.semanticViewId);
      } else if (widget?.semanticViewsReferenced?.[0]) {
        // Get from widget's own reference
        const viewId = widget.semanticViewsReferenced[0].name;
        setSemanticViewId(viewId);
      } else if (currentDashboard.semanticViewsReferenced.length > 0) {
        // Auto-select first view if creating new widget
        const firstView = currentDashboard.semanticViewsReferenced[0];
        const viewId = typeof firstView === 'string' ? firstView : firstView.name;
        setSemanticViewId(viewId);
      }
    } else {
      console.warn('WidgetEditor: No semantic views configured for this dashboard');
      // Try to get from widget if dashboard doesn't have it (for existing widgets)
      if (widget?.semanticViewsReferenced && widget.semanticViewsReferenced.length > 0) {
        log('WidgetEditor: Using semantic views from widget:', widget.semanticViewsReferenced);
        setSemanticViews(widget.semanticViewsReferenced);
        setSemanticViewId(widget.semanticViewsReferenced[0].name);
      }
      // No fallback - widgets can only use semantic views allowed for this dashboard
      // User must add semantic views in Dashboard Settings
    }
  }, [currentDashboard?.id, currentDashboard?.semanticViewsReferenced, widget?.id]);

  // Track if we've loaded calculated fields (to prevent infinite loops in inline mode)
  const calcFieldsLoadedRef = useRef(false);
  
  // Load calculated fields from dashboard-level when semantic view changes
  // This allows reuse of calculated fields across widgets using the same semantic view
  useEffect(() => {
    if (!semanticViewId || !currentDashboard?.semanticViewsReferenced) return;
    
    // Only load once per semantic view change (not on every widget prop update)
    if (calcFieldsLoadedRef.current) return;
    calcFieldsLoadedRef.current = true;
    
    // Find the semantic view in dashboard's semanticViewsReferenced
    const dashboardView = currentDashboard.semanticViewsReferenced.find(v => 
      (typeof v === 'string' ? v : v.name) === semanticViewId
    );
    
    // Load dashboard-level calculated fields if available (and widget doesn't have its own)
    if (!customColumns.length && dashboardView && typeof dashboardView === 'object' && dashboardView.calculatedFields) {
      const dashboardCalcFields = dashboardView.calculatedFields || [];
      if (dashboardCalcFields.length > 0) {
        log('Loading dashboard-level calculated fields for semantic view:', semanticViewId, dashboardCalcFields);
        setCustomColumns(ensureCalcFieldIds(dashboardCalcFields));
      }
    }
    
    // Load dashboard-level column aliases if available
    if (dashboardView && typeof dashboardView === 'object' && dashboardView.columnAliases) {
      log('Loading dashboard-level column aliases for semantic view:', semanticViewId, dashboardView.columnAliases);
      setColumnAliases(dashboardView.columnAliases);
    }
  }, [semanticViewId, currentDashboard?.semanticViewsReferenced]);
  
  // Reset the calcFieldsLoaded ref when semantic view changes
  useEffect(() => {
    calcFieldsLoadedRef.current = false;
  }, [semanticViewId]);

  // Fetch semantic view metadata when view is selected
  // parseColumnsToMetadata is now imported from widget-editor/utils

  // Helper to get fallback metadata from semantic models
  const getFallbackMetadata = (viewName) => {
    // Try to find matching semantic model
    const model = semanticModels.find(m => 
      m.id === viewName || 
      m.name === viewName || 
      m.name?.toLowerCase() === viewName?.toLowerCase()
    );
    
    if (model) {
      return {
        dimensions: model.dimensions || [],
        measures: model.measures || [],
        facts: model.facts || [],
      };
    }
    
    // Return first available model if no exact match
    if (semanticModels.length > 0) {
      const firstModel = semanticModels[0];
      return {
        dimensions: firstModel.dimensions || [],
        measures: firstModel.measures || [],
        facts: firstModel.facts || [],
      };
    }
    
    return null;
  };

  useEffect(() => {
    const fetchViewMetadata = async () => {
      if (!semanticViewId) {
        setViewMetadata(null);
        setSelectedView(null);
        return;
      }
      
      // Find the selected view object
      const viewObj = semanticViews.find(v => 
        (typeof v === 'string' ? v : v.name) === semanticViewId
      );
      setSelectedView(viewObj);
      
      // Fetch from API
      // Determine the fully qualified name - try multiple sources
      let fullyQualifiedName = null;
      
      // Try to get from view object
      if (typeof viewObj === 'object' && viewObj) {
        if (viewObj.fullyQualifiedName) {
          fullyQualifiedName = viewObj.fullyQualifiedName;
        } else if (viewObj.full_name) {
          fullyQualifiedName = viewObj.full_name;
        } else if (viewObj.database && viewObj.schema && viewObj.name) {
          fullyQualifiedName = `${viewObj.database}.${viewObj.schema}.${viewObj.name}`;
        } else if (viewObj.databaseName && viewObj.schemaName && viewObj.name) {
          fullyQualifiedName = `${viewObj.databaseName}.${viewObj.schemaName}.${viewObj.name}`;
        }
      }
      
      // If still no FQN, try to find it from widget's semanticViewsReferenced
      if (!fullyQualifiedName && widget?.semanticViewsReferenced?.[0]) {
        const widgetView = widget.semanticViewsReferenced[0];
        if (widgetView.fullyQualifiedName) {
          fullyQualifiedName = widgetView.fullyQualifiedName;
        }
      }
      
      // If still no FQN, try to find it from dashboard's semanticViewsReferenced
      if (!fullyQualifiedName && currentDashboard?.semanticViewsReferenced) {
        const dashboardView = currentDashboard.semanticViewsReferenced.find(v => 
          (typeof v === 'string' ? v : v.name) === semanticViewId
        );
        if (typeof dashboardView === 'object' && dashboardView?.fullyQualifiedName) {
          fullyQualifiedName = dashboardView.fullyQualifiedName;
        }
      }
      
      // Last resort: use connection info if available
      if (!fullyQualifiedName && (typeof viewObj === 'string' || viewObj?.name)) {
        const viewName = typeof viewObj === 'string' ? viewObj : viewObj.name;
        const dashboardDb = currentDashboard?.connection?.database;
        const dashboardSchema = currentDashboard?.connection?.schema || 'PUBLIC';
        if (dashboardDb) {
          fullyQualifiedName = `${dashboardDb}.${dashboardSchema}.${viewName}`;
        }
      }

      if (fullyQualifiedName) {
        // Check cache first - avoid unnecessary API calls
        const cachedMetadata = getCachedViewMetadata(fullyQualifiedName);
        if (cachedMetadata) {
          log('Using cached metadata for:', fullyQualifiedName);
          setViewMetadata(cachedMetadata);
          return;
        }
        
        setLoadingMetadata(true);
        try {
          const parts = fullyQualifiedName.split('.');
          const [database, schema, name] = parts.length === 3 ? parts : [null, null, fullyQualifiedName];
          
          if (database && schema && name) {
            // Pass connection info including dashboard-specific role/warehouse
            const data = await semanticApi.getView(database, schema, name, {
              connectionId: currentDashboard?.connection_id,
              role: currentDashboard?.role,
              warehouse: currentDashboard?.warehouse,
            });
            
            // Check if we got valid columns data
            if (data && data.columns && data.columns.length > 0) {
              const metadata = parseColumnsToMetadata(data.columns);
              setViewMetadata(metadata);
              // Cache the metadata for future use
              setCachedViewMetadata(fullyQualifiedName, metadata);
            } else if (data && (data.dimensions || data.measures || data.facts)) {
              // API returned semantic view structure directly
              const metadata = {
                dimensions: data.dimensions || [],
                measures: data.measures || [],
                facts: data.facts || [],
              };
              setViewMetadata(metadata);
              // Cache the metadata for future use
              setCachedViewMetadata(fullyQualifiedName, metadata);
            } else if (data && data.error) {
              // API returned an error message - try fallback
              console.warn('View metadata API returned error:', data.error);
              const fallback = getFallbackMetadata(semanticViewId);
              if (fallback) {
                setViewMetadata(fallback);
                setCachedViewMetadata(fullyQualifiedName, fallback);
              } else {
                setViewMetadata({ dimensions: [], measures: [], facts: [] });
              }
            } else {
              // No columns returned - try fallback
              console.warn('View metadata API returned no columns:', data);
              const fallback = getFallbackMetadata(semanticViewId);
              if (fallback) {
                setViewMetadata(fallback);
                setCachedViewMetadata(fullyQualifiedName, fallback);
              } else {
                setViewMetadata({ dimensions: [], measures: [], facts: [] });
              }
            }
          } else {
            console.warn('Could not parse fullyQualifiedName:', fullyQualifiedName);
            setViewMetadata({ dimensions: [], measures: [], facts: [] });
          }
        } catch (error) {
          console.error('Failed to fetch view metadata:', error);
          // Try fallback to semantic models
          const fallback = getFallbackMetadata(semanticViewId);
          if (fallback) {
            log('Using semantic model as fallback for view metadata');
            setViewMetadata(fallback);
            setCachedViewMetadata(fullyQualifiedName, fallback);
          } else {
            setViewMetadata({ dimensions: [], measures: [], facts: [] });
          }
        } finally {
          setLoadingMetadata(false);
        }
      } else {
        // No fullyQualifiedName available - use fallback from semantic models
        const fallback = getFallbackMetadata(semanticViewId);
        if (fallback) {
          log('Using semantic model metadata for view:', semanticViewId);
          setViewMetadata(fallback);
        } else {
          console.warn('No metadata available for view:', semanticViewId);
          setViewMetadata({ dimensions: [], measures: [], facts: [] });
        }
      }
    };
    
    fetchViewMetadata();
  }, [semanticViewId, semanticViews, semanticModels, currentDashboard, getCachedViewMetadata, setCachedViewMetadata]);

  // Smart Defaults: Auto-select first dimension and measure for new widgets
  // Only applies when:
  // 1. Widget is new (isNew prop)
  // 2. Metadata just loaded
  // 3. No fields are currently selected
  // 4. Smart defaults haven't been applied yet
  const smartDefaultsAppliedRef = useRef(false);
  useEffect(() => {
    // Only apply smart defaults once per widget lifecycle
    console.log('[SmartDefaults] Effect triggered:', { 
      isNew, 
      alreadyApplied: smartDefaultsAppliedRef.current,
      hasMetadata: !!viewMetadata,
      columnsLength: columns.length,
      rowsLength: rows.length
    });
    
    if (!isNew || smartDefaultsAppliedRef.current) {
      console.log('[SmartDefaults] Skipping - not new or already applied');
      return;
    }
    if (!viewMetadata) return;
    if (columns.length > 0 || rows.length > 0) return; // Already has fields
    
    const dims = viewMetadata?.dimensions || [];
    const measures = viewMetadata?.measures || [];
    
    // If we have both dimensions and measures, suggest a smart default
    if (dims.length > 0 || measures.length > 0) {
      const newColumns = [];
      const newRows = [];
      
      // Add first dimension to columns
      if (dims.length > 0) {
        newColumns.push({
          name: dims[0].name,
          fieldType: 'dimension',
          aggregation: 'NONE'
        });
      }
      
      // Add first measure to rows (values)
      if (measures.length > 0) {
        newRows.push({
          name: measures[0].name,
          fieldType: 'measure',
          aggregation: 'NONE'
        });
      }
      
      // Only apply if we have something to add
      if (newColumns.length > 0) setColumns(newColumns);
      if (newRows.length > 0) setRows(newRows);
      
      // Auto-select chart type based on what we have
      if (newColumns.length > 0 && newRows.length > 0) {
        setWidgetType('bar'); // Bar chart is a good default
      } else if (newRows.length > 0) {
        setWidgetType('kpi'); // Just a measure = KPI
      } else {
        setWidgetType('table'); // Default to table
      }
      
      smartDefaultsAppliedRef.current = true;
    }
  }, [isNew, viewMetadata, columns.length, rows.length]);

  // Note: getFullyQualifiedName and filter/sort hooks are defined earlier in the component

  const handleSave = () => {
    // Validate title is provided
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError('Title is required');
      return;
    }
    
    // Clear any previous error
    setTitleError('');
    
    // USE UNIFIED CONFIG FROM useWidgetConfig - SINGLE SOURCE OF TRUTH
    // This ensures save, edit, create, and YAML preview all use the same definition
    const fullyQualifiedName = widgetConfig.semanticView;
    
    // Build semantic view reference with calculated fields
    const semanticViewsReferenced = semanticViewId ? [{
      name: semanticViewId,
      fullyQualifiedName: fullyQualifiedName || semanticViewId,
      calculatedFields: customColumns,
    }] : [];
    
    // Update dashboard-level semantic view references for calculated fields and aliases
    if ((customColumns.length > 0 || Object.keys(columnAliases).length > 0) && currentDashboard && semanticViewId) {
      const dashboardViews = [...(currentDashboard.semanticViewsReferenced || [])];
      const existingViewIndex = dashboardViews.findIndex(v => 
        (typeof v === 'string' ? v : v.name) === semanticViewId
      );
      
      let updatedViews;
      
      if (existingViewIndex >= 0) {
        const existingView = dashboardViews[existingViewIndex];
        
        // Merge calculated fields
        const existingCalcFields = existingView.calculatedFields || [];
        const mergedCalcFields = [...existingCalcFields];
        customColumns.forEach(newCf => {
          const existingIndex = mergedCalcFields.findIndex(cf => cf.name === newCf.name);
          if (existingIndex >= 0) {
            mergedCalcFields[existingIndex] = newCf;
          } else {
            mergedCalcFields.push(newCf);
          }
        });
        
        // Merge aliases
        const mergedAliases = { ...(existingView.columnAliases || {}), ...columnAliases };
        Object.keys(mergedAliases).forEach(key => {
          if (!mergedAliases[key]) delete mergedAliases[key];
        });
        
        updatedViews = [...dashboardViews];
        updatedViews[existingViewIndex] = {
          ...existingView,
          calculatedFields: mergedCalcFields,
          columnAliases: mergedAliases,
        };
      } else {
        updatedViews = [
          ...dashboardViews,
          {
            name: semanticViewId,
            fullyQualifiedName: fullyQualifiedName || semanticViewId,
            calculatedFields: customColumns,
            columnAliases,
          }
        ];
      }
      
      const { updateDashboard } = useAppStore.getState();
      updateDashboard(currentDashboard.id, {
        semanticViewsReferenced: updatedViews,
      });
      
      log('Updated dashboard semanticViewsReferenced:', updatedViews);
    }
    
    onSave({
      title: trimmedTitle,
      type: widgetType,
      
      // UNIFIED WIDGET DEFINITION - SINGLE SOURCE OF TRUTH
      // This is THE widget definition used everywhere: save, edit, create, YAML preview
      semanticView: fullyQualifiedName,
      fields: widgetConfig.fields,
      filters: widgetConfig.filters,
      sorts: widgetConfig.sorts,
      customColumns: widgetConfig.customColumns,
      
      // Computed query classification (from unified fields)
      queryDimensions: configDimensions,
      queryMeasures: configMeasures,
      
      // Reference info
      semanticViewsReferenced,
      
      // Legacy marks (for backwards compat with chart rendering)
      marks,
      markFields,
      config: {
        ...customConfig,
        ...getColorConfig(),
        fontSize,
        textColor,
        labelColor,
        columnAliases, // Custom display names for columns
        numberFormat,
        decimalPlaces,
        fieldAggregations, // Aggregation types per field (sum, avg, min, max, etc.)
        fieldMarkTypes, // Mark types per field (color, size, label, etc.)
        fieldConfigs, // Per-field formatting options (data type, number format, text color, etc.)
      },
    });
  };

  // Filter and sort functions are now provided by useFilters and useSorts hooks
  // Drag handlers are now provided by useDragDrop hook

  // Update aggregation for a field in a shelf
  const updateFieldAggregation = (shelf, idx, aggregation) => {
    const updateField = (fields) => {
      return fields.map((field, i) => {
        if (i !== idx) return field;
        
        // Normalize to object format
        const fieldObj = typeof field === 'string' 
          ? { name: field, fieldType: 'dimension' }
          : { ...field };
        
        // Update aggregation (null removes it)
        if (aggregation) {
          fieldObj.aggregation = aggregation;
        } else {
          delete fieldObj.aggregation;
        }
        
        return fieldObj;
      });
    };
    
    if (shelf === 'columns') setColumns(updateField);
    if (shelf === 'rows') setRows(updateField);
    if (shelf === 'values') setValues(updateField);
    
    setAggDropdown({ open: false, shelf: null, idx: null, x: 0, y: 0 });
  };

  // Helper to get aggregation from field (string or object)
  const getFieldAggregation = (field) => {
    if (typeof field === 'object' && field !== null) {
      return field.aggregation || null;
    }
    return null;
  };

  // Helper to get aggregation label
  const getAggregationLabel = (aggregation) => {
    if (!aggregation) return null;
    const opt = AGGREGATION_OPTIONS.find(o => o.value === aggregation);
    return opt ? opt.label : aggregation;
  };

  const isFieldUsed = (fieldName) => {
    // Handle both string and object fields in columns/rows
    const inColumns = columns.some(c => (typeof c === 'object' ? c.name : c) === fieldName);
    const inRows = rows.some(r => (typeof r === 'object' ? r.name : r) === fieldName);
    // Note: values is kept empty, measures go through markFields
    return inColumns || inRows || markFields.some(mf => mf.field === fieldName);
  };

  // Get where a field is being used (for error messages)
  const getFieldUsageLocations = (fieldName) => {
    const locations = [];
    // Handle both string and object fields in columns/rows
    if (columns.some(c => (typeof c === 'object' ? c.name : c) === fieldName)) locations.push('Columns');
    if (rows.some(r => (typeof r === 'object' ? r.name : r) === fieldName)) locations.push('Rows');
    if (markFields.some(mf => mf.field === fieldName)) locations.push('Marks');
    return locations;
  };

  // Handle calculated field deletion with validation
  const handleDeleteCalculatedField = (col) => {
    // Clear any previous error
    setCalcFieldDeleteError(null);
    
    // Check if the field is in use
    if (isFieldUsed(col.name)) {
      const locations = getFieldUsageLocations(col.name);
      setCalcFieldDeleteError({
        fieldName: col.name,
        message: `Cannot delete "${col.displayName || col.name}" - it is currently in use in: ${locations.join(', ')}. Remove it from the chart first.`,
      });
      
      // Auto-clear the error after 5 seconds
      setTimeout(() => {
        setCalcFieldDeleteError(prev => prev?.fieldName === col.name ? null : prev);
      }, 5000);
      return;
    }
    
    // Not in use - safe to delete
    setCustomColumns(prev => prev.filter(c => c.name !== col.name));
    
    // Also update the dashboard-level calculated fields
    if (currentDashboard && semanticViewId) {
      const dashboardViews = [...(currentDashboard.semanticViewsReferenced || [])];
      const viewIndex = dashboardViews.findIndex(v => 
        (typeof v === 'string' ? v : v.name) === semanticViewId
      );
      
      if (viewIndex >= 0 && typeof dashboardViews[viewIndex] === 'object') {
        const updatedView = {
          ...dashboardViews[viewIndex],
          calculatedFields: (dashboardViews[viewIndex].calculatedFields || [])
            .filter(cf => cf.name !== col.name),
        };
        
        const updatedViews = [...dashboardViews];
        updatedViews[viewIndex] = updatedView;
        
        const { updateDashboard } = useAppStore.getState();
        updateDashboard(currentDashboard.id, {
          semanticViewsReferenced: updatedViews,
        });
        
        log('Removed calculated field from dashboard:', col.name);
      }
    }
  };

  // Build preview widget object
  const previewWidget = {
    id: 'preview',
    title: title || 'Preview',
    type: widgetType,
    semanticViewId,
    modelId: semanticViewId,
    config: {
      ...customConfig,
      ...getColorConfig(),
    },
    query: {
      dimensions: [...columns, ...rows],
      measures: values,
      // Store separate axis info for charts that need it (multiline, grouped bar, etc.)
      xAxis: columns,      // Fields used for x-axis (columns shelf)
      series: rows,        // Fields used for series/grouping (rows shelf)
    },
    position: { x: 0, y: 0, w: 6, h: 4 },
  };
  
  // For inline mode: Real-time updates are disabled for now to prevent loops
  // Changes are saved when the widget is deselected or the user explicitly saves
  // TODO: Re-enable with proper optimization when performance is stable

  // Embedded mode - editor inside the widget card itself
  // Collapsible sections state for space efficiency
  const [expandedSections, setExpandedSections] = useState({
    fields: false,      // Closed by default - user can expand if needed
    shelves: true,      // Data Layout open by default
    filters: false,
    format: false
  });
  
  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Sidebar is the only presentation mode
  return (
    <div className="widget-editor-embedded">
        
        {/* Header with title and actions */}
        <EditorHeader
          title={title}
          setTitle={setTitle}
          titleError={titleError}
          setTitleError={setTitleError}
          refreshEnabled={refreshEnabled}
          setRefreshEnabled={setRefreshEnabled}
          pendingRefresh={pendingRefresh}
          setPendingRefresh={setPendingRefresh}
          setForceNextRefresh={setForceNextRefresh}
          sqlPreviewDropdown={sqlPreviewDropdown}
          setSqlPreviewDropdown={setSqlPreviewDropdown}
          onClose={onClose}
        />

        {/* Loading bar at top */}
        {(loadingMetadata || loading) && (
          <div className="embedded-loading-bar top">
            <div className="loading-bar-progress"></div>
          </div>
        )}

        {/* Main editor body with animated panels */}
        <div className="embedded-editor-body sidebar-mode">
          {/* Configuration Panel (scrollable) - takes full width in sidebar mode */}
          <div className="embedded-config-panel">
            {/* Data Source & Chart Type Row */}
            <DataSourceSection
              semanticViewId={semanticViewId}
              setSemanticViewId={setSemanticViewId}
              semanticViews={semanticViews}
              widgetType={widgetType}
              setWidgetType={setWidgetType}
              onViewChange={() => {
                setColumns([]);
                setRows([]);
                setValues([]);
                setMarkFields([]);
                setFilters([]);
                setSorts([]);
              }}
            />

            {/* Collapsible: Fields */}
            <FieldsSection
              expanded={expandedSections.fields}
              toggleSection={toggleSection}
              viewMetadata={viewMetadata}
              allDimensions={allDimensions}
              customColumns={customColumns}
              setCustomColumns={setCustomColumns}
              loadingMetadata={loadingMetadata}
              setFieldTooltip={setFieldTooltip}
              showFormulaBar={showFormulaBar}
              setShowFormulaBar={setShowFormulaBar}
              editingCalculatedField={editingCalculatedField}
              setEditingCalculatedField={setEditingCalculatedField}
              calcFieldDeleteError={calcFieldDeleteError}
              setCalcFieldDeleteError={setCalcFieldDeleteError}
              handleDeleteCalculatedField={handleDeleteCalculatedField}
            />

            {/* Collapsible: Shelves (Columns, Rows) */}
            <ShelvesSection
              expanded={expandedSections.shelves}
              toggleSection={toggleSection}
              columns={columns}
              setColumns={setColumns}
              rows={rows}
              setRows={setRows}
              columnAliases={columnAliases}
              setColumnAliases={setColumnAliases}
              fieldAggregations={fieldAggregations}
              setFieldAggregations={setFieldAggregations}
              fieldMarkTypes={fieldMarkTypes}
              setFieldMarkTypes={setFieldMarkTypes}
              sorts={sorts}
              onToggleSort={handlePillToggleSort}
              onAddFilter={handlePillAddFilter}
              removeFromShelf={removeFromShelf}
              shelfPopup={shelfPopup}
              setShelfPopup={setShelfPopup}
              setPendingColumns={setPendingColumns}
              setPendingRows={setPendingRows}
              dragOverZone={dragOverZone}
              setDragOverZone={setDragOverZone}
              dragOverIndex={dragOverIndex}
              setDragOverIndex={setDragOverIndex}
              handleDrop={handleDrop}
              handlePillDragStart={handlePillDragStart}
              handlePillDragEnd={handlePillDragEnd}
            />

            {/* Collapsible: Filters & Sorts */}
            <FiltersSortsSection
              expanded={expandedSections.filters}
              toggleSection={toggleSection}
              filters={filters}
              showFilterPanel={showFilterPanel}
              setShowFilterPanel={setShowFilterPanel}
              openFilterPopup={openFilterPopup}
              removeFilter={removeFilter}
              getFilterForField={getFilterForField}
              sorts={sorts}
              showSortPanel={showSortPanel}
              setShowSortPanel={setShowSortPanel}
              addSort={addSort}
              removeSort={removeSort}
              updateSortDirection={updateSortDirection}
              moveSortUp={moveSortUp}
              moveSortDown={moveSortDown}
              allDimensions={allDimensions}
              measures={viewMetadata?.measures}
              customColumns={customColumns}
              columns={columns}
              rows={rows}
            />

            {/* Collapsible: Formatting */}
            <FormattingSection
              expanded={expandedSections.format}
              toggleSection={toggleSection}
              widgetType={widgetType}
              colorPreset={colorPreset}
              setColorPreset={setColorPreset}
              customScheme={customScheme}
              setCustomScheme={setCustomScheme}
              numberFormat={numberFormat}
              setNumberFormat={setNumberFormat}
              decimalPlaces={decimalPlaces}
              setDecimalPlaces={setDecimalPlaces}
              customConfig={customConfig}
              setCustomConfig={setCustomConfig}
              allFields={[...columns, ...rows]}
              fieldConfigs={fieldConfigs}
              setFieldConfigs={setFieldConfigs}
            />
          </div>

          {/* Preview is shown in the DashboardWidget on the canvas, not here */}
        </div>


        {/* SQL Preview Dropdown */}
        <SqlPreviewDropdown
          sqlPreviewDropdown={sqlPreviewDropdown}
          setSqlPreviewDropdown={setSqlPreviewDropdown}
          liveQueryPreview={liveQueryPreview}
          copiedSql={copiedSql}
          setCopiedSql={setCopiedSql}
          widgetConfig={widgetConfig}
        />


        {/* Field Tooltip */}
        <FieldTooltip fieldTooltip={fieldTooltip} />

        {/* Shelf Field Picker Popup */}
        <ShelfPopup
          shelfPopup={shelfPopup}
          setShelfPopup={setShelfPopup}
          setFieldTooltip={setFieldTooltip}
          allDimensions={allDimensions}
          measures={viewMetadata?.measures}
          customColumns={customColumns}
          columns={columns}
          rows={rows}
          pendingColumns={pendingColumns}
          setPendingColumns={setPendingColumns}
          pendingRows={pendingRows}
          setPendingRows={setPendingRows}
          setColumns={setColumns}
          setRows={setRows}
        />

        {/* Aggregation Dropdown */}
        <AggregationDropdown
          aggDropdown={aggDropdown}
          setAggDropdown={setAggDropdown}
          columns={columns}
          rows={rows}
          getFieldAggregation={getFieldAggregation}
          updateFieldAggregation={updateFieldAggregation}
        />

        {/* Filter Popup */}
        <FilterPopup
          filterPopup={filterPopup}
          setFilterPopup={setFilterPopup}
          filterPopupRef={filterPopupRef}
          closeFilterPopup={closeFilterPopup}
          filterSearch={filterSearch}
          handleFilterSearchChange={handleFilterSearchChange}
          handleFilterListScroll={handleFilterListScroll}
          isValueSelected={isValueSelected}
          toggleFilterValue={toggleFilterValue}
          filters={filters}
          removeFilter={removeFilter}
          applyAdvancedFilter={applyAdvancedFilter}
          customExprRef={customExprRef}
          handleCustomExpressionChange={handleCustomExpressionChange}
          handleExprKeyDown={handleExprKeyDown}
          exprAutocomplete={exprAutocomplete}
          setExprAutocomplete={setExprAutocomplete}
          insertExprAutocomplete={insertExprAutocomplete}
        />
      </div>
    );
};

export default WidgetEditor;
