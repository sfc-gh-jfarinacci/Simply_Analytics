/**
 * useWidgetConfig - Unified widget configuration hook
 * 
 * Consolidates scattered state into a clean, metadata-aware config object
 * that can be sent to the backend for SQL generation and query execution.
 * 
 * This is the SINGLE SOURCE OF TRUTH for widget field configuration.
 */
import { useMemo } from 'react';

/**
 * Field configuration structure:
 * {
 *   name: string,           // Field name (e.g., "ORDER_COUNT")
 *   shelf: string,          // "columns" | "rows" | "marks" | null (for filter-only)
 *   dataType: string,       // "VARCHAR" | "NUMBER" | "DATE" | "TIMESTAMP" | etc
 *   semanticType: string,   // "dimension" | "measure" | "fact" (from semantic view)
 *   aggregation: string,    // "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | null
 *   markType: string,       // "color" | "size" | "detail" | "tooltip" | null
 * }
 */

/**
 * Unified config structure sent to backend:
 * {
 *   semanticView: string,   // Fully qualified name
 *   fields: Field[],        // All fields with their properties
 *   filters: Filter[],      // All active filters
 *   sorts: Sort[],          // All active sorts
 *   customColumns: CustomColumn[], // Calculated field definitions
 *   connectionId: string,
 *   role: string,
 *   warehouse: string,
 * }
 */

export const useWidgetConfig = ({
  // Data source
  semanticViewId,
  semanticViews = [],
  viewMetadata = null, // Contains dimensions, measures, facts with data types
  
  // Shelf placements
  columns = [],
  rows = [],
  values = [], // Legacy - treated as rows
  
  // Mark shelf (color, size, detail, tooltip)
  markFields = [],
  fieldMarkTypes = {}, // { fieldName: 'color' | 'size' | 'detail' | 'tooltip' }
  
  // Field aggregations (user-specified)
  fieldAggregations = {}, // { fieldName: 'SUM' | 'AVG' | etc }
  
  // Column aliases (display names)
  columnAliases = {}, // { fieldName: 'Display Name' }
  
  // Filters and sorts
  filters = [],
  sorts = [],
  
  // Calculated fields
  customColumns = [],
  
  // Connection info
  connectionId,
  role,
  warehouse,
}) => {
  
  // Resolve fully qualified semantic view name
  const semanticViewFQN = useMemo(() => {
    if (!semanticViewId) return null;
    const viewObj = semanticViews?.find(v => 
      (typeof v === 'string' ? v : v.name) === semanticViewId
    );
    if (typeof viewObj === 'object' && viewObj) {
      return viewObj.fullyQualifiedName || viewObj.full_name || semanticViewId;
    }
    return semanticViewId;
  }, [semanticViewId, semanticViews]);

  // Build metadata lookup maps for O(1) access
  const metadataLookup = useMemo(() => {
    if (!viewMetadata) {
      return { byName: new Map(), measures: new Set(), dimensions: new Set(), facts: new Set() };
    }
    
    const byName = new Map();
    const measures = new Set();
    const dimensions = new Set();
    const facts = new Set();
    
    // Helper to strip entity prefix (e.g., "ORDERS.ORDER_COUNT" -> "ORDER_COUNT")
    const stripPrefix = (name) => {
      if (!name) return null;
      const upper = name.toUpperCase();
      return upper.includes('.') ? upper.split('.').pop() : upper;
    };
    
    // Process dimensions
    (viewMetadata.dimensions || []).forEach(d => {
      const rawName = typeof d === 'string' ? d : d.name;
      const name = stripPrefix(rawName);
      if (!name) return;
      dimensions.add(name);
      byName.set(name, {
        name,
        dataType: d.type || d.dataType || d.data_type || 'VARCHAR',
        semanticType: 'dimension',
        description: d.description || '',
      });
    });
    
    // Process measures (metrics)
    (viewMetadata.measures || []).forEach(m => {
      const rawName = typeof m === 'string' ? m : m.name;
      const name = stripPrefix(rawName);
      if (!name) return;
      measures.add(name);
      byName.set(name, {
        name,
        dataType: m.type || m.dataType || m.data_type || 'NUMBER',
        semanticType: 'measure',
        description: m.description || '',
      });
    });
    
    // Process facts
    (viewMetadata.facts || []).forEach(f => {
      const rawName = typeof f === 'string' ? f : f.name;
      const name = stripPrefix(rawName);
      if (!name) return;
      facts.add(name);
      byName.set(name, {
        name,
        dataType: f.type || f.dataType || f.data_type || 'NUMBER',
        semanticType: 'fact',
        description: f.description || '',
      });
    });
    
    return { byName, measures, dimensions, facts };
  }, [viewMetadata]);

  // Helper to get field name from various formats
  const getFieldName = (field) => {
    if (!field) return null;
    if (typeof field === 'string') return field;
    return field.name || field.field || null;
  };

  // Helper to normalize field name for lookup
  const normalizeFieldName = (name) => {
    if (!name) return null;
    // Remove entity prefix if present (e.g., "ORDERS.ORDER_COUNT" -> "ORDER_COUNT")
    const upper = name.toUpperCase();
    return upper.includes('.') ? upper.split('.').pop() : upper;
  };

  // Helper to get metadata for a field
  const getFieldMetadata = (fieldName) => {
    const normalized = normalizeFieldName(fieldName);
    if (!normalized) return null;
    return metadataLookup.byName.get(normalized) || null;
  };

  // Helper to determine semantic type
  const getSemanticType = (fieldName) => {
    const normalized = normalizeFieldName(fieldName);
    if (!normalized) return 'dimension'; // Default
    if (metadataLookup.measures.has(normalized)) return 'measure';
    if (metadataLookup.facts.has(normalized)) return 'fact';
    if (metadataLookup.dimensions.has(normalized)) return 'dimension';
    return 'dimension'; // Default for unknown fields
  };

  // Helper to get aggregation for a field
  const getAggregation = (fieldName) => {
    if (!fieldName) return null;
    const normalized = normalizeFieldName(fieldName);
    const key = Object.keys(fieldAggregations).find(k => 
      normalizeFieldName(k) === normalized
    );
    return key ? fieldAggregations[key] : null;
  };

  // Helper to get mark type for a field
  const getMarkType = (fieldName) => {
    if (!fieldName) return null;
    const normalized = normalizeFieldName(fieldName);
    const key = Object.keys(fieldMarkTypes).find(k => 
      normalizeFieldName(k) === normalized
    );
    return key ? fieldMarkTypes[key] : null;
  };

  // Helper to check if field is a custom column
  const isCustomColumn = (fieldName) => {
    const normalized = normalizeFieldName(fieldName);
    return customColumns.some(cc => 
      normalizeFieldName(cc.name) === normalized
    );
  };

  // Build unified fields array
  const fields = useMemo(() => {
    const result = [];
    const addedFields = new Set(); // Track added fields to avoid duplicates
    
    // Helper to add a field
    const addField = (fieldInput, shelf, markTypeOverride = null) => {
      const name = getFieldName(fieldInput);
      if (!name) return;
      
      const normalized = normalizeFieldName(name);
      if (!normalized) return;
      
      // Skip if already added (allow mark fields to update existing)
      if (addedFields.has(normalized) && shelf !== 'marks') return;
      
      const metadata = getFieldMetadata(name);
      const aggregation = getAggregation(name);
      const markType = markTypeOverride || getMarkType(name);
      
      // Determine semantic type from semantic view definition
      // Do NOT promote dimensions to measures just because user applied aggregation —
      // the field's semantic type reflects its definition in the semantic view.
      // Aggregated dimensions are still sent as DIMENSIONS to Snowflake;
      // the query builder wraps them with AGG() in the SELECT clause.
      let semanticType = getSemanticType(name);
      
      // For custom columns, semantic type depends on expression
      if (isCustomColumn(name)) {
        semanticType = 'measure';
      }
      
      // Get alias from columnAliases
      const getAlias = (fieldName) => {
        if (!fieldName) return null;
        const normalized = normalizeFieldName(fieldName);
        const key = Object.keys(columnAliases).find(k => 
          normalizeFieldName(k) === normalized
        );
        return key ? columnAliases[key] : null;
      };
      
      const fieldConfig = {
        name: normalized, // Use normalized name
        originalName: name, // Keep original for display
        shelf,
        dataType: metadata?.dataType || 'VARCHAR',
        semanticType,
        aggregation,
        markType,
        alias: getAlias(name),
        isCustomColumn: isCustomColumn(name),
      };
      
      // If already added (marks updating), merge markType
      if (addedFields.has(normalized)) {
        const existing = result.find(f => f.name === normalized);
        if (existing && markType) {
          existing.markType = markType;
        }
        return;
      }
      
      result.push(fieldConfig);
      addedFields.add(normalized);
    };
    
    // Process columns
    columns.forEach(f => addField(f, 'columns'));
    
    // Process rows
    rows.forEach(f => addField(f, 'rows'));
    
    // Process values (legacy - treated as rows)
    values.forEach(f => addField(f, 'rows'));
    
    // Process marks - these may add new fields or update existing
    markFields.forEach(mark => {
      if (mark.field) {
        addField(mark.field, 'marks', mark.type);
      }
    });
    
    console.log('[useWidgetConfig] Built fields:', {
      columnsInput: columns,
      rowsInput: rows,
      valuesInput: values,
      markFieldsInput: markFields,
      resultFields: result,
    });
    
    return result;
  }, [columns, rows, values, markFields, fieldAggregations, fieldMarkTypes, columnAliases, metadataLookup, customColumns]);

  // Build filters array with metadata
  const normalizedFilters = useMemo(() => {
    return filters.map(f => {
      const normalized = normalizeFieldName(f.field);
      const metadata = getFieldMetadata(f.field);
      return {
        field: normalized,
        operator: f.operator,
        value: f.value,
        values: f.values || [],
        dataType: metadata?.dataType || 'VARCHAR',
        ...(f.customExpression ? { customExpression: f.customExpression } : {}),
      };
    }).filter(f => f.field); // Remove invalid filters
  }, [filters, metadataLookup]);

  // Build sorts array with metadata
  const normalizedSorts = useMemo(() => {
    return sorts.map(s => {
      const normalized = normalizeFieldName(s.field);
      return {
        field: normalized,
        direction: s.direction || 'ASC',
      };
    }).filter(s => s.field); // Remove invalid sorts
  }, [sorts]);

  // Build custom columns - include ones on shelves + any they transitively reference
  const normalizedCustomColumns = useMemo(() => {
    const fieldsOnShelves = new Set(fields.map(f => f.name));
    const calcByName = new Map(customColumns.map(cc => [normalizeFieldName(cc.name), cc]));
    
    // Start with calc fields directly on shelves
    const used = new Set();
    customColumns.forEach(cc => {
      if (fieldsOnShelves.has(normalizeFieldName(cc.name))) {
        used.add(normalizeFieldName(cc.name));
      }
    });
    
    // Expand to include transitively referenced calc fields
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const name of used) {
        const cc = calcByName.get(name);
        if (!cc?.expression) continue;
        const refs = cc.expression.matchAll(/\[([^\]]+)\]/g);
        for (const m of refs) {
          const norm = normalizeFieldName(m[1]);
          if (calcByName.has(norm) && !used.has(norm)) {
            used.add(norm);
            expanded = true;
          }
        }
      }
    }
    
    const result = customColumns
      .filter(cc => used.has(normalizeFieldName(cc.name)))
      .map(cc => ({
        name: normalizeFieldName(cc.name),
        expression: cc.expression,
        description: cc.description || '',
        dataType: 'NUMBER',
      }));
    console.log('[useWidgetConfig] normalizedCustomColumns:', JSON.stringify({
      allCalcFields: customColumns.map(cc => cc.name),
      fieldsOnShelves: [...fieldsOnShelves],
      used: [...used],
      result: result.map(cc => ({ name: cc.name, expr: cc.expression?.substring(0, 60) })),
    }));
    return result;
  }, [customColumns, fields]);

  // The unified config object
  const config = useMemo(() => ({
    semanticView: semanticViewFQN,
    fields,
    filters: normalizedFilters,
    sorts: normalizedSorts,
    customColumns: normalizedCustomColumns,
    connectionId,
    role,
    warehouse,
  }), [semanticViewFQN, fields, normalizedFilters, normalizedSorts, normalizedCustomColumns, connectionId, role, warehouse]);

  // Computed values for convenience
  const dimensions = useMemo(() => 
    fields.filter(f => f.semanticType === 'dimension' || f.semanticType === 'fact')
      .map(f => f.name),
    [fields]
  );

  const measures = useMemo(() => 
    fields.filter(f => f.semanticType === 'measure')
      .map(f => f.name),
    [fields]
  );

  const hasFields = fields.length > 0 || customColumns.length > 0;
  const isValid = Boolean(semanticViewFQN && hasFields);

  return {
    // The unified config - ready to send to backend
    config,
    
    // Individual parts for convenience
    semanticViewFQN,
    fields,
    filters: normalizedFilters,
    sorts: normalizedSorts,
    customColumns: normalizedCustomColumns,
    
    // Computed classifications
    dimensions,
    measures,
    
    // Helpers
    getFieldMetadata,
    getSemanticType,
    metadataLookup,
    
    // State flags
    hasFields,
    isValid,
  };
};

export default useWidgetConfig;
