/**
 * Unified Widget Schema
 * 
 * This defines the SINGLE SOURCE OF TRUTH for widget field configuration.
 * Used consistently across:
 * - Frontend (WidgetEditor, DashboardWidget)
 * - Backend (SQL generation, query execution)
 * - YAML preview
 * - Database storage
 */

/**
 * Field Definition
 * Each field on a shelf has these properties
 */
export const FieldSchema = {
  name: 'string',        // Field name (e.g., "ORDER_COUNT")
  shelf: 'string',       // Placement: "columns" | "rows" | "marks"
  dataType: 'string',    // Data type: "VARCHAR" | "NUMBER" | "DATE" | "TIMESTAMP" | etc.
  semanticType: 'string',// Semantic type: "dimension" | "measure" | "fact"
  aggregation: 'string', // Aggregation: "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | null
  markType: 'string',    // Mark type: "color" | "size" | "detail" | "tooltip" | "cluster" | null
  alias: 'string',       // Display alias (optional)
};

/**
 * Filter Definition
 */
export const FilterSchema = {
  field: 'string',       // Field name
  operator: 'string',    // "=" | "!=" | ">" | "<" | ">=" | "<=" | "IN" | "NOT IN" | "LIKE" | "BETWEEN"
  value: 'any',          // Single value for most operators
  values: 'array',       // Array of values for IN/NOT IN
  dataType: 'string',    // Field data type (for proper formatting)
};

/**
 * Sort Definition
 */
export const SortSchema = {
  field: 'string',       // Field name
  direction: 'string',   // "ASC" | "DESC"
};

/**
 * Custom Column (Calculated Field) Definition
 */
export const CustomColumnSchema = {
  name: 'string',        // Custom field name
  expression: 'string',  // SQL expression (e.g., "SUM([SALES]) / COUNT([ORDERS])")
  dataType: 'string',    // Result data type (usually "NUMBER")
  description: 'string', // Optional description
};

/**
 * Complete Widget Schema
 */
export const WidgetSchema = {
  // Identity
  id: 'string',
  title: 'string',
  type: 'string',        // "table" | "bar" | "line" | "pie" | etc.
  
  // Data Source
  semanticView: 'string', // Fully qualified name (DATABASE.SCHEMA.VIEW)
  
  // Field Configuration - UNIFIED ARRAY
  fields: [FieldSchema], // All fields with their properties
  
  // Filters
  filters: [FilterSchema],
  
  // Sorts
  sorts: [SortSchema],
  
  // Calculated Fields
  customColumns: [CustomColumnSchema],
  
  // Display Configuration
  config: {
    colorPreset: 'number',
    customScheme: 'object',
    fontSize: 'string',
    numberFormat: 'string',
    decimalPlaces: 'number',
    // ... other display settings
  },
};

/**
 * Shelf Types
 */
export const SHELF_TYPES = {
  COLUMNS: 'columns',
  ROWS: 'rows',
  MARKS: 'marks',
};

/**
 * Semantic Types
 */
export const SEMANTIC_TYPES = {
  DIMENSION: 'dimension',
  MEASURE: 'measure',
  FACT: 'fact',
};

/**
 * Mark Types
 */
export const MARK_TYPES = {
  COLOR: 'color',
  SIZE: 'size',
  DETAIL: 'detail',
  TOOLTIP: 'tooltip',
  CLUSTER: 'cluster',
  LABEL: 'label',
};

/**
 * Aggregation Types
 */
export const AGGREGATION_TYPES = {
  SUM: 'SUM',
  AVG: 'AVG',
  COUNT: 'COUNT',
  MIN: 'MIN',
  MAX: 'MAX',
  MEDIAN: 'MEDIAN',
};

/**
 * Convert legacy widget format to unified schema
 * Handles: fieldsUsed, queryDimensions, queryMeasures, query.dimensions
 */
export function migrateToUnifiedSchema(widget) {
  if (!widget) return null;
  
  const fields = [];
  
  // Check if already in unified format
  if (widget.fields && Array.isArray(widget.fields) && widget.fields.length > 0) {
    // Already unified - validate and return
    return {
      ...widget,
      fields: widget.fields.map(normalizeField),
    };
  }
  
  // Migration from fieldsUsed format
  if (widget.fieldsUsed && Array.isArray(widget.fieldsUsed) && widget.fieldsUsed.length > 0) {
    widget.fieldsUsed.forEach(f => {
      const shelf = f.placement === 'value' ? 'rows' : f.placement;
      fields.push({
        name: f.name,
        shelf: shelf || 'rows',
        dataType: f.dataType || 'VARCHAR',
        semanticType: f.type || (f.placement === 'value' ? 'measure' : 'dimension'),
        aggregation: f.aggregation || null,
        markType: null,
        alias: null,
      });
    });
  }
  
  // Migration from queryDimensions/queryMeasures format
  if (fields.length === 0) {
    // Add dimensions to columns
    (widget.queryDimensions || []).forEach(name => {
      fields.push({
        name,
        shelf: 'columns',
        dataType: 'VARCHAR',
        semanticType: 'dimension',
        aggregation: null,
        markType: null,
        alias: null,
      });
    });
    
    // Add measures to rows
    (widget.queryMeasures || []).forEach(name => {
      fields.push({
        name,
        shelf: 'rows',
        dataType: 'NUMBER',
        semanticType: 'measure',
        aggregation: null,
        markType: null,
        alias: null,
      });
    });
  }
  
  // Migration from legacy query.dimensions format
  if (fields.length === 0 && widget.query) {
    (widget.query.dimensions || []).forEach(name => {
      fields.push({
        name,
        shelf: 'columns',
        dataType: 'VARCHAR',
        semanticType: 'dimension',
        aggregation: null,
        markType: null,
        alias: null,
      });
    });
    (widget.query.measures || []).forEach(name => {
      fields.push({
        name,
        shelf: 'rows',
        dataType: 'NUMBER',
        semanticType: 'measure',
        aggregation: null,
        markType: null,
        alias: null,
      });
    });
  }
  
  // Add marks
  if (widget.marks) {
    if (widget.marks.color) {
      const existing = fields.find(f => f.name === widget.marks.color);
      if (existing) {
        existing.markType = 'color';
      } else {
        fields.push({
          name: widget.marks.color,
          shelf: 'marks',
          dataType: 'VARCHAR',
          semanticType: 'dimension',
          aggregation: null,
          markType: 'color',
          alias: null,
        });
      }
    }
    // ... similar for other mark types
  }
  
  return {
    ...widget,
    fields,
    // Keep filters/sorts as-is, they should already be in correct format
    filters: widget.filtersApplied || widget.filters || [],
    sorts: widget.sortsApplied || widget.sorts || [],
    customColumns: widget.customColumns || [],
  };
}

/**
 * Normalize a field to ensure all properties exist
 */
export function normalizeField(field) {
  return {
    name: field.name || '',
    shelf: field.shelf || 'rows',
    dataType: field.dataType || 'VARCHAR',
    semanticType: field.semanticType || 'dimension',
    aggregation: field.aggregation || null,
    markType: field.markType || null,
    alias: field.alias || null,
  };
}

/**
 * Extract dimensions from unified fields array
 */
export function getDimensions(fields) {
  return (fields || [])
    .filter(f => f.semanticType === 'dimension' || f.semanticType === 'fact')
    .map(f => f.name);
}

/**
 * Extract measures from unified fields array
 */
export function getMeasures(fields) {
  return (fields || [])
    .filter(f => f.semanticType === 'measure')
    .map(f => f.name);
}

/**
 * Extract fields by shelf
 */
export function getFieldsByShelf(fields, shelf) {
  return (fields || [])
    .filter(f => f.shelf === shelf)
    .map(f => f.name);
}

/**
 * Convert widget to YAML-friendly format for preview
 */
export function toYamlPreview(widget) {
  if (!widget) return null;
  
  const config = {
    title: widget.title,
    type: widget.type,
    semanticView: widget.semanticView || widget.semanticViewsReferenced?.[0]?.fullyQualifiedName,
    
    // Fields organized by shelf
    columns: (widget.fields || [])
      .filter(f => f.shelf === 'columns')
      .map(f => ({
        name: f.name,
        type: f.semanticType,
        ...(f.aggregation && { aggregation: f.aggregation }),
        ...(f.markType && { mark: f.markType }),
        ...(f.alias && { alias: f.alias }),
      })),
    
    rows: (widget.fields || [])
      .filter(f => f.shelf === 'rows')
      .map(f => ({
        name: f.name,
        type: f.semanticType,
        ...(f.aggregation && { aggregation: f.aggregation }),
        ...(f.markType && { mark: f.markType }),
        ...(f.alias && { alias: f.alias }),
      })),
    
    marks: (widget.fields || [])
      .filter(f => f.shelf === 'marks')
      .map(f => ({
        name: f.name,
        type: f.semanticType,
        mark: f.markType,
      })),
    
    // Filters
    ...(widget.filters?.length > 0 && {
      filters: widget.filters.map(f => ({
        field: f.field,
        operator: f.operator,
        value: f.value ?? f.values,
      })),
    }),
    
    // Sorts
    ...(widget.sorts?.length > 0 && {
      sorts: widget.sorts.map(s => ({
        field: s.field,
        direction: s.direction,
      })),
    }),
    
    // Custom columns
    ...(widget.customColumns?.length > 0 && {
      customColumns: widget.customColumns.map(c => ({
        name: c.name,
        expression: c.expression,
      })),
    }),
  };
  
  return config;
}

export default {
  WidgetSchema,
  FieldSchema,
  FilterSchema,
  SortSchema,
  CustomColumnSchema,
  SHELF_TYPES,
  SEMANTIC_TYPES,
  MARK_TYPES,
  AGGREGATION_TYPES,
  migrateToUnifiedSchema,
  normalizeField,
  getDimensions,
  getMeasures,
  getFieldsByShelf,
  toYamlPreview,
};
