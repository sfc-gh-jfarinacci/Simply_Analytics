/**
 * Shared Query Builder Utility
 * 
 * This is the SINGLE SOURCE OF TRUTH for building semantic view queries.
 * Used by both:
 * - Frontend: SQL preview (useQueryPreview) and data loading (DashboardWidget)
 * - Backend: Query execution (semantic routes)
 * 
 * The config can come from:
 * - liveConfig (during editing in WidgetEditor)
 * - saved widget config (from YAML file)
 * - API request body (from backend routes)
 */

// Default query limit: 1 million rows
const DEFAULT_QUERY_LIMIT = 1000000;

/**
 * Date part field detection and transformation utilities
 */
const DATE_PART_FUNCTIONS = {
  YEAR: (field) => `YEAR("${field}")`,
  QUARTER: (field) => `QUARTER("${field}")`,
  MONTH: (field) => `MONTH("${field}")`,
  WEEK: (field) => `WEEKOFYEAR("${field}")`,
  DAY: (field) => `DAY("${field}")`,
  HOUR: (field) => `HOUR("${field}")`,
  DAYOFWEEK: (field) => `DAYOFWEEK("${field}")`,
  DAYOFYEAR: (field) => `DAYOFYEAR("${field}")`,
};

/**
 * Check if a field object or name represents a date part field
 */
const isDatePartField = (field) => {
  if (typeof field === 'object' && field !== null) {
    return field.isDatePart === true && field.parentField && field.datePart;
  }
  // Also check for naming convention: FIELD__PART (double underscore)
  if (typeof field === 'string') {
    const validParts = Object.keys(DATE_PART_FUNCTIONS);
    const match = field.match(/^(.+)__(\w+)$/);
    return match && validParts.includes(match[2].toUpperCase());
  }
  return false;
};

/**
 * Parse date part field info from field object or naming convention
 */
const parseDatePartField = (field) => {
  if (typeof field === 'object' && field !== null && field.isDatePart) {
    return {
      baseName: field.parentField,
      datePart: field.datePart?.toUpperCase(),
      alias: field.name,
    };
  }
  if (typeof field === 'string') {
    const match = field.match(/^(.+)__(\w+)$/);
    if (match && Object.keys(DATE_PART_FUNCTIONS).includes(match[2].toUpperCase())) {
      return {
        baseName: match[1],
        datePart: match[2].toUpperCase(),
        alias: `${match[1]}_${match[2].toLowerCase()}`,
      };
    }
  }
  return null;
};

/**
 * Transform a date part field to SQL expression
 */
const transformDatePartToSql = (field) => {
  const parsed = parseDatePartField(field);
  if (!parsed) return null;
  
  const fn = DATE_PART_FUNCTIONS[parsed.datePart];
  if (!fn) return null;
  
  return {
    expression: fn(parsed.baseName),
    alias: parsed.alias,
    baseName: parsed.baseName,
  };
};

/**
 * Get the base field name from a potentially date-part field
 */
const getBaseFieldName = (field) => {
  const parsed = parseDatePartField(field);
  return parsed ? parsed.baseName : (typeof field === 'object' ? field.name : field);
};

/**
 * Extract field references from a calculated field expression
 * Handles both [FIELD_NAME] and "FIELD_NAME" syntax
 */
const extractFieldReferences = (expression) => {
  if (!expression) return [];
  const fields = new Set();
  
  // Match [FIELD_NAME] syntax
  const bracketMatches = expression.matchAll(/\[([^\]]+)\]/g);
  for (const match of bracketMatches) {
    fields.add(match[1]);
  }
  
  // Match "FIELD_NAME" syntax (quoted identifiers in SQL)
  const quoteMatches = expression.matchAll(/"([^"]+)"/g);
  for (const match of quoteMatches) {
    fields.add(match[1]);
  }
  
  return Array.from(fields);
};

/**
 * Check if an expression contains aggregate functions
 */
const isAggregateExpression = (expression) => {
  if (!expression) return false;
  const upper = expression.toUpperCase();
  return /\b(SUM|COUNT|AVG|MIN|MAX|STDDEV|VARIANCE|MEDIAN)\s*\(/i.test(upper);
};

/**
 * Check if an expression contains window/analytic functions.
 * These require a CTE because they must run AFTER GROUP BY aggregation.
 */
const isWindowExpression = (expression) => {
  if (!expression) return false;
  return /\b(LAG|LEAD|ROW_NUMBER|RANK|DENSE_RANK|NTILE|FIRST_VALUE|LAST_VALUE|NTH_VALUE|CUME_DIST|PERCENT_RANK)\s*\(/i.test(expression)
    && /\bOVER\s*\(/i.test(expression);
};

/**
 * Resolve inter-calculated-field references by inlining expressions.
 * If calc field B's expression contains [A] and A is another calc field,
 * replace [A] with (A's expression) so the final SQL is self-contained.
 * Handles transitive references (A -> B -> C) with a depth limit to
 * prevent infinite recursion on circular references.
 */
const resolveCalcFieldReferences = (customColumns) => {
  if (!customColumns || customColumns.length <= 1) return customColumns;
  
  const byName = new Map();
  customColumns.forEach(cc => {
    if (cc && cc.name && cc.expression) {
      byName.set(cc.name.toUpperCase(), cc);
    }
  });
  
  const resolve = (expr, depth = 0) => {
    if (depth > 10 || !expr) return expr;
    return expr.replace(/\[([^\]]+)\]/g, (match, fieldName) => {
      const ref = byName.get(fieldName.toUpperCase());
      if (ref) {
        // Recursively resolve so transitive refs work (A refs B refs C)
        const resolved = resolve(ref.expression, depth + 1);
        // Wrap in parens to preserve operator precedence
        return `(${resolved.replace(/\[([^\]]+)\]/g, '"$1"')})`;
      }
      return match; // Not a calc field — leave as-is for later bracket replacement
    });
  };
  
  return customColumns.map(cc => {
    if (!cc || !cc.expression) return cc;
    const refs = extractFieldReferences(cc.expression);
    const hasCalcRef = refs.some(r => byName.has(r.toUpperCase()) && r.toUpperCase() !== cc.name.toUpperCase());
    if (!hasCalcRef) return cc;
    return { ...cc, expression: resolve(cc.expression) };
  });
};

/**
 * Sanitize SQL operator for safety
 */
const sanitizeOperator = (op) => {
  const validOps = ['=', '!=', '<>', '<', '>', '<=', '>=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE', 'BETWEEN', 'CUSTOM'];
  const upperOp = (op || '=').toUpperCase();
  return validOps.includes(upperOp) ? upperOp : '=';
};

/**
 * Format a value for SQL based on type
 */
const formatSqlValue = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  // Escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`;
};

/**
 * Build a single SQL filter condition from a filter object.
 * @param {Object} f - Filter: { field, operator, value, value2, values, customExpression }
 * @param {string} fieldName - The resolved field/alias name to use in the condition
 * @returns {string|null} - SQL condition string or null
 */
const buildFilterCondition = (f, fieldName) => {
  const field = `"${fieldName}"`;
  const op = sanitizeOperator(f.operator);
  
  if (op === 'CUSTOM' && f.customExpression) {
    return f.customExpression
      .replace(/\[\[([^\]]+)\]\]/g, '"$1"')
      .replace(/\{\{([^}]+)\}\}/g, '"$1"');
  }
  
  if ((op === 'IN' || op === 'NOT IN') && Array.isArray(f.values) && f.values.length > 0) {
    const escapedValues = f.values.map(v => formatSqlValue(v));
    return `${field} ${op} (${escapedValues.join(', ')})`;
  }
  
  if (['IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE'].includes(op)) {
    return `${field} ${op}`;
  }
  
  if (op === 'BETWEEN' && f.value !== undefined && f.value2 !== undefined) {
    return `${field} BETWEEN ${formatSqlValue(f.value)} AND ${formatSqlValue(f.value2)}`;
  }
  
  if (op === 'LIKE' && f.value !== undefined) {
    const escapedValue = String(f.value).replace(/'/g, "''");
    return `${field} ILIKE '%${escapedValue}%'`;
  }
  
  if (f.value !== undefined) {
    return `${field} ${op} ${formatSqlValue(f.value)}`;
  }
  
  if (f.values?.length > 0) {
    const escapedValues = f.values.map(v => formatSqlValue(v));
    return `${field} IN (${escapedValues.join(', ')})`;
  }
  
  return null;
};

/**
 * Build query arrays from widget config
 * 
 * @param {Object} config - Widget configuration
 * @param {Array} config.columns - Fields on columns shelf (xAxis)
 * @param {Array} config.rows - Fields on rows shelf
 * @param {Array} config.markFields - Mark fields [{field, type}]
 * @param {Array} config.customColumns - Calculated fields [{name, expression}]
 * @param {Object} config.viewMetadata - Semantic view metadata with dimensions/measures
 * @returns {Object} - { dimensions, measures, customColumns, columnDimensions, rowDimensions, chartMeasures, datePartFields }
 */
const buildQueryFromConfig = (config) => {
  const {
    columns = [],
    rows = [],
    markFields = [],
    fieldMarkTypes = {}, // Mark types for fields on shelves (color, cluster, detail, etc.)
    fieldAggregations = {}, // Aggregation types per field (SUM, AVG, etc.)
    customColumns = [],
    viewMetadata = {},
  } = config;
  
  // Mark types that affect grouping (add to GROUP BY)
  const GROUPING_MARK_TYPES = ['color', 'cluster', 'detail'];
  // Mark types that are display-only (don't affect grouping)
  const DISPLAY_ONLY_MARK_TYPES = ['label', 'tooltip'];
  
  // Helper to check if a field has a display-only mark type
  const isDisplayOnlyField = (fieldName) => {
    const markType = fieldMarkTypes[fieldName];
    return markType && DISPLAY_ONLY_MARK_TYPES.includes(markType);
  };

  const normalizeFieldName = (name) => name?.toUpperCase?.() || '';
  const calcFieldNames = customColumns.map(c => c.name);
  const calcFieldNamesUpper = calcFieldNames.map(n => normalizeFieldName(n));

  // Helper to check if a field has an aggregation assigned
  // This makes it a measure regardless of viewMetadata
  const hasFieldAggregation = (fieldName) => {
    const normalized = normalizeFieldName(fieldName);
    // Check fieldAggregations map (case-insensitive)
    return Object.keys(fieldAggregations).some(key => 
      normalizeFieldName(key) === normalized && fieldAggregations[key]
    );
  };

  // Helper to get the aggregation type for a field
  const getFieldAggregation = (fieldName) => {
    const normalized = normalizeFieldName(fieldName);
    // Check fieldAggregations map (case-insensitive)
    const key = Object.keys(fieldAggregations).find(k => 
      normalizeFieldName(k) === normalized && fieldAggregations[k]
    );
    return key ? fieldAggregations[key].toUpperCase() : 'SUM'; // Default to SUM
  };

  // Helper to check if a field is a measure
  // Handles cases where field might have parent entity prefix (e.g., "ORDERS.ORDER_COUNT")
  const isMeasureField = (fieldName) => {
    const normalized = normalizeFieldName(fieldName);
    // Get just the field name without parent entity prefix
    const fieldNameOnly = normalized.includes('.') ? normalized.split('.').pop() : normalized;
    
    // Get measure names - handle both string arrays and object arrays
    const measures = viewMetadata?.measures || [];
    
    // Check if it's a semantic view measure
    // Match by either full name or just the field name part
    // Also handle entity prefixes in the measure names (e.g., "ORDERS.ORDER_COUNT")
    const isSemanticMeasure = measures.some(m => {
      // Handle both string and object format
      const measureName = normalizeFieldName(typeof m === 'string' ? m : m.name);
      const measureNameOnly = measureName.includes('.') ? measureName.split('.').pop() : measureName;
      // Match: full to full, suffix to suffix, or cross-match
      return measureName === normalized || 
             measureNameOnly === fieldNameOnly ||
             measureName === fieldNameOnly ||
             measureNameOnly === normalized;
    });
    if (isSemanticMeasure) {
      return true;
    }
    // Check if it's a calculated field with aggregate function
    const calcField = customColumns.find(c => normalizeFieldName(c.name) === normalized);
    if (calcField) {
      return isAggregateExpression(calcField.expression);
    }
    return false;
  };

  // Extract field info from columns/rows, tracking date part fields
  // Also capture aggregation property - fields with aggregation are measures
  const getFieldInfo = (field) => {
    if (typeof field === 'object' && field !== null) {
      // Get aggregation from field object or fieldAggregations map
      const aggFromField = field.aggregation?.toUpperCase?.();
      const aggFromMap = getFieldAggregation(field.name);
      return { 
        name: field.name, 
        field,
        hasAggregation: !!field.aggregation, // Track if field has explicit aggregation
        aggregation: aggFromField || (hasFieldAggregation(field.name) ? aggFromMap : null),
      };
    }
    const aggFromMap = hasFieldAggregation(field) ? getFieldAggregation(field) : null;
    return { name: field, field, hasAggregation: !!aggFromMap, aggregation: aggFromMap };
  };
  
  const colInfos = columns.map(getFieldInfo).filter(f => f.name);
  const rowInfos = rows.map(getFieldInfo).filter(f => f.name);

  // Build dimensions and measures for SEMANTIC_VIEW query
  // For date part fields, we send the full name (e.g. ORDER_DATE__YEAR)
  // The query builder will handle extracting base field for DIMENSIONS clause
  const dimensions = [];
  const measures = []; // Array of { name, aggregation }
  const measureNames = new Set(); // Track names to avoid duplicates
  const datePartFields = []; // Track date part transformations needed for SQL

  // Process columns and rows - add to dims/meas if not a calculated field name
  [...colInfos, ...rowInfos].forEach(({ name, field, hasAggregation, aggregation }) => {
    if (calcFieldNamesUpper.includes(normalizeFieldName(name))) return;
    
    // Check if this is a date part field
    if (isDatePartField(field) || isDatePartField(name)) {
      const parsed = parseDatePartField(field) || parseDatePartField(name);
      if (parsed) {
        // Add the DATE PART field name to dimensions
        if (!dimensions.includes(name)) {
          dimensions.push(name);
        }
        // Track the date part transformation for SELECT/GROUP BY
        datePartFields.push({
          originalName: name,
          baseName: parsed.baseName,
          datePart: parsed.datePart,
          alias: parsed.alias,
        });
        return;
      }
    }
    
    // A field is a measure if:
    // 1. It has an explicit aggregation on the field object (e.g., { name: "ORDER_COUNT", aggregation: "sum" })
    // 2. OR it has an aggregation in the fieldAggregations map
    // 3. OR it's defined as a measure in viewMetadata
    if (hasAggregation || hasFieldAggregation(name) || isMeasureField(name)) {
      if (!measureNames.has(name)) {
        measureNames.add(name);
        measures.push({ 
          name, 
          aggregation: aggregation || getFieldAggregation(name) || 'SUM'
        });
      }
    } else {
      if (!dimensions.includes(name)) dimensions.push(name);
    }
  });

  // Process marks
  markFields.forEach(m => {
    const name = m.field;
    if (!name || calcFieldNamesUpper.includes(normalizeFieldName(name))) return;
    // Check fieldAggregations map and viewMetadata for measure classification
    if (hasFieldAggregation(name) || isMeasureField(name)) {
      if (!measureNames.has(name)) {
        measureNames.add(name);
        measures.push({ 
          name, 
          aggregation: getFieldAggregation(name) || 'SUM'
        });
      }
    } else {
      if (!dimensions.includes(name)) dimensions.push(name);
    }
  });

  // Determine which calculated fields are USED (on shelves or marks)
  // Must be calculated BEFORE extracting field references
  const allShelfFieldNames = new Set();
  [...colInfos, ...rowInfos].forEach(f => allShelfFieldNames.add(normalizeFieldName(f.name)));
  markFields.forEach(m => m.field && allShelfFieldNames.add(normalizeFieldName(m.field)));

  // Start with calc fields directly on shelves, then transitively include
  // any calc fields they reference (e.g., ORDER_COUNT_LY refs order_date_year)
  const usedCalcNames = new Set();
  customColumns.forEach(cc => {
    if (allShelfFieldNames.has(normalizeFieldName(cc.name))) {
      usedCalcNames.add(normalizeFieldName(cc.name));
    }
  });
  const calcByName = new Map(customColumns.map(cc => [normalizeFieldName(cc.name), cc]));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const name of usedCalcNames) {
      const cc = calcByName.get(name);
      if (!cc) continue;
      const refs = extractFieldReferences(cc.expression);
      for (const ref of refs) {
        const norm = normalizeFieldName(ref);
        if (calcByName.has(norm) && !usedCalcNames.has(norm)) {
          usedCalcNames.add(norm);
          expanded = true;
        }
      }
    }
  }
  const usedCustomColumns = customColumns.filter(cc =>
    usedCalcNames.has(normalizeFieldName(cc.name))
  );

  // Extract field references ONLY from USED calculated fields
  // These fields need to be in SEMANTIC_VIEW for the expressions to work
  // Unused calculated fields should NOT add their references to the query
  usedCustomColumns.forEach(cf => {
    const referencedFields = extractFieldReferences(cf.expression);
    referencedFields.forEach(refField => {
      // Skip if it's another calculated field name
      if (calcFieldNamesUpper.includes(normalizeFieldName(refField))) return;
      if (isMeasureField(refField)) {
        if (!measureNames.has(refField)) {
          measureNames.add(refField);
          measures.push({ name: refField, aggregation: getFieldAggregation(refField) || 'SUM' });
        }
      } else {
        if (!dimensions.includes(refField)) dimensions.push(refField);
      }
    });
  });

  // For visualization: column/row dimensions (non-measures, including non-aggregate calc fields)
  const colNames = colInfos.map(f => f.name);
  const rowNames = rowInfos.map(f => f.name);
  const columnDimensions = colNames.filter(n => !isMeasureField(n));
  const rowDimensions = rowNames.filter(n => !isMeasureField(n));

  // Chart measures: measures from rows (including aggregate calc fields)
  const chartMeasures = rowNames.filter(n => isMeasureField(n));

  return {
    dimensions,           // For SEMANTIC_VIEW DIMENSIONS clause (will be converted to base fields)
    measures,             // For SEMANTIC_VIEW METRICS clause
    usedCustomColumns,    // Calculated fields to include in SELECT
    columnDimensions,     // For chart xAxis visualization
    rowDimensions,        // For chart row dimensions
    chartMeasures,        // For chart measures (includes calc fields with aggregates)
    datePartFields,       // Date part transformations needed
  };
};

/**
 * Build complete SQL query from pre-extracted dimensions/measures
 * This is the CORE query builder used by both frontend and backend.
 * 
 * @param {Object} params - Query parameters
 * @param {string} params.semanticViewFQN - Fully qualified name of semantic view
 * @param {Array} params.dimensions - Dimension field names
 * @param {Array} params.measures - Measure field names
 * @param {Array} params.filters - Filter objects
 * @param {Array} params.orderBy - Sort/order objects
 * @param {Array} params.customColumns - Calculated field definitions
 * @param {number} params.limit - Query limit (default: 1000000)
 * @returns {string} - Complete SQL query
 */
const buildQueryDirect = ({
  semanticViewFQN,
  dimensions = [],
  measures: inputMeasures = [],
  aggregatedDimensions = [],
  filters = [],
  orderBy = [],
  customColumns = [],
  limit = DEFAULT_QUERY_LIMIT,
}) => {
  if (!semanticViewFQN) return '-- Select a data source';

  // Normalize measures to always be objects with { name, aggregation }
  // Supports both string format (backwards compatible) and object format
  // aggregation can be null/"NONE" meaning no wrapping (bare metric)
  const measures = inputMeasures.map(m => {
    if (typeof m === 'string') {
      return { name: m, aggregation: 'SUM' };
    }
    const agg = m.aggregation;
    const normalized = (agg && agg !== 'NONE') ? agg : null;
    return { name: m.name, aggregation: normalized };
  });

  console.log('[buildQueryDirect] INPUT:', JSON.stringify({
    dimensions, measures: inputMeasures, aggregatedDimensions,
    customColumns: customColumns.map(cc => ({ name: cc.name, expr: cc.expression?.substring(0, 80) })),
  }));

  if (dimensions.length === 0 && measures.length === 0 && customColumns.length === 0) {
    return '-- Add fields to query';
  }

  // Build lookup for dimensions that have user-applied aggregation
  const aggDimMap = new Map(aggregatedDimensions.map(ad => [ad.name.toUpperCase(), ad.aggregation]));

  // Set of calculated field names — these are NOT semantic view fields
  const calcFieldNames = new Set(customColumns.filter(cc => cc && cc.name).map(cc => cc.name.toUpperCase()));

  // Split into regular vs window BEFORE resolving.
  // Window cols live in the CTE outer SELECT and reference base query aliases,
  // so their calc field refs should NOT be inlined — just use the alias.
  const rawRegularCalcCols = customColumns.filter(cc => cc?.expression && !isWindowExpression(cc.expression));
  const windowCalcCols = customColumns.filter(cc => cc?.expression && isWindowExpression(cc.expression));

  // Resolve inter-calc-field references only for regular calc cols
  const resolvedRegularCols = resolveCalcFieldReferences(rawRegularCalcCols);

  // Separate regular dimensions from date-part dimensions
  const regularDimensions = dimensions.filter(d => !isDatePartField(d));
  const datePartDimensions = dimensions.filter(d => isDatePartField(d));
  
  // Create a set of measure names for quick lookup
  const measureNames = new Set(measures.map(m => m.name));
  
  // Include ORDER BY fields that aren't already in dimensions
  const orderByFields = orderBy.map(o => o.field).filter(f => f && !dimensions.includes(f));
  const orderByDateParts = orderByFields.filter(f => isDatePartField(f));
  const orderByRegular = orderByFields.filter(f => !isDatePartField(f) && !measureNames.has(f));
  
  // Merge order-by date parts with dimension date parts
  const allDatePartDimensions = [...new Set([...datePartDimensions, ...orderByDateParts])];
  
  // For date part fields, we need their base fields in SEMANTIC_VIEW
  const baseDateFields = allDatePartDimensions.map(d => getBaseFieldName(d));
  
  // Filter fields must also be included in DIMENSIONS
  const filterFields = filters.map(f => f?.field ? getBaseFieldName(f.field) : null).filter(Boolean);
  
  // Extract field references from regular calc cols (resolved) — these need
  // to be in SEMANTIC_VIEW DIMENSIONS (but NOT in SELECT/GROUP BY)
  const calcFieldReferences = [];
  resolvedRegularCols.forEach(cc => {
    if (cc && cc.expression) {
      const refs = extractFieldReferences(cc.expression);
      calcFieldReferences.push(...refs.filter(r =>
        !measureNames.has(r) && !calcFieldNames.has(r.toUpperCase())
      ));
    }
  });
  // Window cols reference base query aliases — extract refs from ORIGINAL
  // expressions to find underlying semantic fields they need
  windowCalcCols.forEach(cc => {
    if (cc && cc.expression) {
      const refs = extractFieldReferences(cc.expression);
      refs.forEach(r => {
        // Skip measures and other calc fields — only need raw dimensions
        if (measureNames.has(r) || calcFieldNames.has(r.toUpperCase())) return;
        calcFieldReferences.push(r);
      });
    }
  });
  
  // Combine all fields needed in SEMANTIC_VIEW (base fields only)
  // Filter out calculated field names — they are SELECT expressions, not semantic view fields
  const allBaseDimensions = [...new Set([
    ...regularDimensions, 
    ...baseDateFields, 
    ...filterFields, 
    ...calcFieldReferences, 
    ...orderByRegular
  ])].filter(d => !calcFieldNames.has(d.toUpperCase()));
  
  const hasSemanticFields = allBaseDimensions.length > 0 || measures.length > 0;
  
  // Check if any regular calc field has an aggregate function
  const hasAggregateCalcField = resolvedRegularCols.some(cc => cc && isAggregateExpression(cc.expression));
  // Check if any non-window calc field is non-aggregate (will create GROUP BY entries)
  const hasNonAggCalcField = resolvedRegularCols.some(cc =>
    cc && cc.expression && !isAggregateExpression(cc.expression)
  );
  
  // Check if any measure has an explicit aggregation function to apply
  const measuresWithAgg = measures.filter(m => m.aggregation);
  
  // We need GROUP BY/aggregation when:
  // - Dimensions and measures with aggregation coexist (standard aggregation case)
  // - Date parts are used (they create GROUP BY)
  // - Aggregate calc fields exist with dimensions
  // - Non-aggregate calc fields exist alongside measures (measures need wrapping)
  // - Any dimension has user-applied aggregation (e.g. SUM of a dimension)
  const needsAggregation = (allBaseDimensions.length > 0 && measuresWithAgg.length > 0) ||
                           allDatePartDimensions.length > 0 || 
                           (hasAggregateCalcField && (regularDimensions.length > 0 || orderByRegular.length > 0)) ||
                           (hasNonAggCalcField && measuresWithAgg.length > 0) ||
                           aggDimMap.size > 0;
  
  // Build SELECT clause
  const selectParts = [];
  const addedToSelect = new Set();
  const groupByParts = [];
  
  // Process dimensions in their original order (skip calc field names — they have expressions)
  dimensions.forEach(dim => {
    if (calcFieldNames.has(dim.toUpperCase())) return;
    if (isDatePartField(dim)) {
      const parsed = parseDatePartField(dim);
      if (parsed) {
        const fn = DATE_PART_FUNCTIONS[parsed.datePart];
        if (fn) {
          const sqlExpr = fn(parsed.baseName);
          selectParts.push(`${sqlExpr} AS "${parsed.alias}"`);
          groupByParts.push(sqlExpr);
          addedToSelect.add(dim);
        }
      }
    } else {
      const dimAgg = aggDimMap.get(dim.toUpperCase());
      if (needsAggregation && dimAgg) {
        selectParts.push(`${dimAgg}("${dim}") AS "${dim}"`);
      } else {
        selectParts.push(`"${dim}"`);
        groupByParts.push(`"${dim}"`);
      }
      addedToSelect.add(dim);
    }
  });
  
  // Add ORDER BY date part fields to SELECT if not already included
  orderByDateParts.forEach(dim => {
    if (!addedToSelect.has(dim)) {
      const parsed = parseDatePartField(dim);
      if (parsed) {
        const fn = DATE_PART_FUNCTIONS[parsed.datePart];
        if (fn) {
          const sqlExpr = fn(parsed.baseName);
          selectParts.push(`${sqlExpr} AS "${parsed.alias}"`);
          groupByParts.push(sqlExpr);
          addedToSelect.add(dim);
        }
      }
    }
  });
  
  // Add ORDER BY regular fields to SELECT if not already included
  orderByRegular.forEach(dim => {
    if (!addedToSelect.has(dim) && !measureNames.has(dim) && !calcFieldNames.has(dim.toUpperCase())) {
      selectParts.push(`"${dim}"`);
      groupByParts.push(`"${dim}"`);
      addedToSelect.add(dim);
    }
  });
  
  // Add measures - wrap in aggregation function only if the measure has one and we need aggregation
  measures.forEach(({ name, aggregation }) => {
    if (needsAggregation && aggregation) {
      selectParts.push(`${aggregation}("${name}") AS "${name}"`);
    } else {
      selectParts.push(`"${name}"`);
    }
    addedToSelect.add(name);
  });
  
  // Add resolved regular custom columns to the base SELECT
  const nonAggregateCalcFieldNames = [];
  resolvedRegularCols.forEach(cc => {
    if (!cc?.expression || !cc?.name) return;
    const sqlExpr = (cc.expression || '').replace(/\[([^\]]+)\]/g, '"$1"');
    selectParts.push(`${sqlExpr} AS "${cc.name}"`);
    if (!isAggregateExpression(cc.expression)) {
      nonAggregateCalcFieldNames.push(cc.name);
      groupByParts.push(sqlExpr);
    }
  });
  
  const selectClause = selectParts.length > 0 ? selectParts.join(', ') : '*';
  
  // Build SEMANTIC_VIEW query (NO quotes in DIMENSIONS/METRICS)
  let sql;
  const measureNamesList = measures.map(m => m.name); // Extract names for METRICS clause
  if (hasSemanticFields) {
    const dimensionsClause = allBaseDimensions.length > 0
      ? `DIMENSIONS ${allBaseDimensions.join(', ')}`
      : '';
    const metricsClause = measureNamesList.length > 0
      ? `METRICS ${measureNamesList.join(', ')}`
      : '';
    
    sql = `SELECT ${selectClause} FROM SEMANTIC_VIEW(${semanticViewFQN} ${dimensionsClause} ${metricsClause})`;
  } else if (resolvedRegularCols.length > 0 || windowCalcCols.length > 0) {
    // Only calculated fields - query from semantic view without DIMENSIONS/METRICS
    sql = `SELECT ${selectClause} FROM SEMANTIC_VIEW(${semanticViewFQN})`;
  } else {
    return '-- At least one dimension, measure, or calculated field is required';
  }
  
  // Categorize filters: base filters go in WHERE, deferred filters (on computed
  // fields like date parts or calculated columns) must be applied on an outer
  // query since their aliases don't exist yet during WHERE evaluation.
  const datePartFieldSet = new Set(allDatePartDimensions.map(d => d.toUpperCase()));
  const baseFilters = [];
  const deferredFilters = [];
  
  filters.filter(f => f && f.field).forEach(f => {
    const fieldUpper = f.field.toUpperCase();
    if (datePartFieldSet.has(fieldUpper) || calcFieldNames.has(fieldUpper)) {
      deferredFilters.push(f);
    } else {
      baseFilters.push(f);
    }
  });
  
  // Build WHERE clause from base filters only
  if (baseFilters.length > 0) {
    const whereParts = baseFilters
      .map(f => buildFilterCondition(f, f.field))
      .filter(Boolean);
    
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }
  }
  
  // Add GROUP BY if needed
  if (needsAggregation && groupByParts.length > 0) {
    sql += ` GROUP BY ${groupByParts.join(', ')}`;
  }
  
  // Track whether we've wrapped in a CTE (for window functions or deferred filters)
  let hasCTE = false;
  
  // Window functions (LAG, LEAD, RANK, etc.) must run AFTER aggregation.
  // Wrap the base query in a CTE and apply window columns in the outer SELECT.
  if (windowCalcCols.length > 0) {
    const baseColumnsSet = new Set([...addedToSelect, ...nonAggregateCalcFieldNames]);
    const outerSelectParts = [...baseColumnsSet].map(c => `"${c}"`);
    
    // Build a map of all base query column aliases for case-correct referencing
    const baseAliases = new Map();
    baseColumnsSet.forEach(c => baseAliases.set(c.toUpperCase(), c));
    
    windowCalcCols.forEach(cc => {
      // Replace [field] with "ALIAS" — use the exact alias from the base query
      const expr = (cc.expression || '').replace(/\[([^\]]+)\]/g, (_, name) => {
        const alias = baseAliases.get(name.toUpperCase());
        return `"${alias || name}"`;
      });
      outerSelectParts.push(`${expr} AS "${cc.name}"`);
    });
    
    sql = `WITH base AS (${sql}) SELECT ${outerSelectParts.join(', ')} FROM base`;
    hasCTE = true;
  }
  
  // Apply deferred filters (date parts, calculated columns) on the outer query.
  // These reference SELECT aliases that only exist after the base query runs.
  if (deferredFilters.length > 0) {
    // Resolve each filter's field to its correct alias
    const deferredWhereParts = deferredFilters.map(f => {
      let alias = f.field;
      if (isDatePartField(f.field)) {
        const parsed = parseDatePartField(f.field);
        if (parsed) alias = parsed.alias;
      }
      return buildFilterCondition(f, alias);
    }).filter(Boolean);
    
    if (deferredWhereParts.length > 0) {
      if (hasCTE) {
        sql += ` WHERE ${deferredWhereParts.join(' AND ')}`;
      } else {
        sql = `WITH base AS (${sql}) SELECT * FROM base WHERE ${deferredWhereParts.join(' AND ')}`;
        hasCTE = true;
      }
    }
  }
  
  // Add ORDER BY
  if (orderBy.length > 0) {
    // When sorting by a custom column that's NOT inside a CTE, the alias
    // isn't a valid identifier — use the resolved SQL expression instead.
    const calcExprMap = new Map();
    if (!hasCTE) {
      resolvedRegularCols.forEach(cc => {
        if (cc?.name && cc?.expression) {
          const sqlExpr = (cc.expression || '').replace(/\[([^\]]+)\]/g, '"$1"');
          calcExprMap.set(cc.name.toUpperCase(), sqlExpr);
        }
      });
    }

    const orderParts = orderBy.map(o => {
      if (isDatePartField(o.field)) {
        const parsed = parseDatePartField(o.field);
        if (parsed) {
          return `"${parsed.alias}" ${o.direction || 'ASC'}`;
        }
      }
      const calcExpr = calcExprMap.get(o.field?.toUpperCase());
      if (calcExpr) {
        return `${calcExpr} ${o.direction || 'ASC'}`;
      }
      return `"${o.field}" ${o.direction || 'ASC'}`;
    });
    sql += ` ORDER BY ${orderParts.join(', ')}`;
  }
  
  // Add LIMIT
  sql += ` LIMIT ${Math.min(parseInt(limit) || DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_LIMIT)}`;
  
  return sql;
};

/**
 * Build complete SQL query string from widget config (columns/rows)
 * This wraps buildQueryDirect after extracting dimensions/measures from config.
 * 
 * @param {Object} config - Query configuration
 * @param {string} semanticViewFQN - Fully qualified name of semantic view
 * @param {Object} options - Additional options
 * @param {number} options.limit - Query limit (default: 1000000)
 * @returns {string} - Complete SQL query
 */
const buildQuery = (config, semanticViewFQN, options = {}) => {
  const { limit = DEFAULT_QUERY_LIMIT } = options;
  
  if (!semanticViewFQN) return '-- Select a data source to see SQL preview';

  let { dimensions, measures, usedCustomColumns, datePartFields } = buildQueryFromConfig(config);

  if (dimensions.length === 0 && measures.length === 0 && usedCustomColumns.length === 0) {
    return '-- Add fields to Columns or Rows to see SQL preview';
  }

  // Set of calculated field names — these are NOT semantic view fields
  const calcFieldNamesSet = new Set(usedCustomColumns.map(cc => cc.name.toUpperCase()));

  // Split into regular vs window BEFORE resolving (same as buildQueryDirect).
  const rawRegularCalcCols = usedCustomColumns.filter(cf => cf?.expression && !isWindowExpression(cf.expression));
  const windowCalcCols = usedCustomColumns.filter(cf => cf?.expression && isWindowExpression(cf.expression));

  // Resolve inter-calc-field references only for regular calc cols
  const resolvedRegularCols = resolveCalcFieldReferences(rawRegularCalcCols);

  // Build SELECT clause
  const selectParts = [];
  const addedToSelect = new Set();
  const groupByParts = [];
  
  // Track dimensions that are ONLY referenced by calculated fields
  const calcFieldRefs = new Set();
  resolvedRegularCols.forEach(cf => {
    extractFieldReferences(cf.expression).forEach(ref => {
      if (!calcFieldNamesSet.has(ref.toUpperCase())) {
        calcFieldRefs.add(ref.toUpperCase());
      }
    });
  });
  windowCalcCols.forEach(cf => {
    extractFieldReferences(cf.expression).forEach(ref => {
      if (!calcFieldNamesSet.has(ref.toUpperCase())) {
        calcFieldRefs.add(ref.toUpperCase());
      }
    });
  });
  
  // Create a map of date part field names to their SQL expressions
  const datePartMap = new Map();
  datePartFields.forEach(dp => {
    const fn = DATE_PART_FUNCTIONS[dp.datePart];
    if (fn) {
      datePartMap.set(dp.originalName.toUpperCase(), {
        expression: fn(dp.baseName),
        alias: dp.alias,
      });
    }
  });
  
  const isImplicitCalcFieldDim = (dim) => {
    const dimUpper = dim.toUpperCase();
    if (calcFieldRefs.has(dimUpper)) {
      return usedCustomColumns.some(cc => {
        const refs = extractFieldReferences(cc.expression);
        return refs.some(r => r.toUpperCase() === dimUpper);
      });
    }
    return false;
  };
  
  const getFieldName = (f) => typeof f === 'object' ? f.name : f;
  const colNames = (config.columns || []).map(getFieldName).filter(Boolean);
  const rowNames = (config.rows || []).map(getFieldName).filter(Boolean);
  const allShelfFields = [...colNames, ...rowNames];
  
  const measureNamesSet = new Set(measures.map(m => m.name));
  
  // Process each field on shelves — skip calc field names
  allShelfFields.forEach(fieldName => {
    if (addedToSelect.has(fieldName)) return;
    if (calcFieldNamesSet.has(fieldName.toUpperCase())) return;
    if (measureNamesSet.has(fieldName)) return;
    
    const datePartInfo = datePartMap.get(fieldName.toUpperCase());
    if (datePartInfo) {
      selectParts.push(`${datePartInfo.expression} AS "${datePartInfo.alias}"`);
      groupByParts.push(datePartInfo.expression);
      addedToSelect.add(fieldName);
      return;
    }
    
    if (isImplicitCalcFieldDim(fieldName)) return;
    
    if (dimensions.includes(fieldName)) {
      selectParts.push(`"${fieldName}"`);
      groupByParts.push(`"${fieldName}"`);
      addedToSelect.add(fieldName);
    }
  });
  
  // Determine if we need aggregation
  const hasNonAggCalcFields = resolvedRegularCols.some(cf => !isAggregateExpression(cf.expression));
  const needsAggregation = groupByParts.length > 0 || hasNonAggCalcFields || datePartFields.length > 0 ||
                           (measures.length > 0 && hasNonAggCalcFields);
  
  // Add measures
  measures.forEach(({ name, aggregation }) => {
    if (!addedToSelect.has(name)) {
      if (needsAggregation) {
        selectParts.push(`${aggregation}("${name}") AS "${name}"`);
      } else {
        selectParts.push(`"${name}"`);
      }
      addedToSelect.add(name);
    }
  });

  // Add resolved regular calc fields to the base SELECT
  const nonAggregateCalcFieldNames = [];
  resolvedRegularCols.forEach(cf => {
    if (!cf?.expression || !cf?.name) return;
    const sqlExpr = (cf.expression || '').replace(/\[([^\]]+)\]/g, '"$1"');
    selectParts.push(`${sqlExpr} AS "${cf.name}"`);
    if (!isAggregateExpression(cf.expression)) {
      nonAggregateCalcFieldNames.push(cf.name);
      groupByParts.push(sqlExpr);
    }
  });

  // Build SEMANTIC_VIEW query (no quotes in DIMENSIONS/METRICS)
  // Filter out calc field names from dimensions
  let sql = `SELECT ${selectParts.join(', ')} FROM SEMANTIC_VIEW(${semanticViewFQN}`;

  if (dimensions.length > 0) {
    const baseDimensions = [...new Set(dimensions.map(d => {
      const parsed = parseDatePartField(d);
      return parsed ? parsed.baseName : d;
    }))].filter(d => !calcFieldNamesSet.has(d.toUpperCase()));
    if (baseDimensions.length > 0) {
      sql += ` DIMENSIONS ${baseDimensions.join(', ')}`;
    }
  }

  if (measures.length > 0) {
    const measureNamesList = measures.map(m => m.name);
    sql += ` METRICS ${measureNamesList.join(', ')}`;
  }

  sql += `)`;

  // Add WHERE clause
  if (config.filters?.length > 0) {
    const calcFieldMapForWhere = new Map(usedCustomColumns.map(cc => [cc.name?.toUpperCase(), cc.expression]));
    
    const whereParts = config.filters
      .filter(f => f && f.field)
      .map(f => {
        const fieldUpper = f.field?.toUpperCase();
        const calcExpr = calcFieldMapForWhere.get(fieldUpper);
        const field = calcExpr 
          ? calcExpr.replace(/\[([^\]]+)\]/g, '"$1"')
          : `"${f.field}"`;
        
        const op = sanitizeOperator(f.operator);
        
        if (op === 'CUSTOM' && f.customExpression) {
          return f.customExpression
            .replace(/\[\[([^\]]+)\]\]/g, '"$1"')
            .replace(/\{\{([^}]+)\}\}/g, '"$1"');
        }
        
        if ((op === 'IN' || op === 'NOT IN') && Array.isArray(f.values) && f.values.length > 0) {
          const escapedValues = f.values.map(v => formatSqlValue(v));
          return `${field} ${op} (${escapedValues.join(', ')})`;
        }
        
        if (op === 'IS NULL' || op === 'IS NOT NULL' || op === 'IS TRUE' || op === 'IS FALSE') {
          return `${field} ${op}`;
        }
        
        if (op === 'BETWEEN' && f.value !== undefined && f.value2 !== undefined) {
          return `${field} BETWEEN ${formatSqlValue(f.value)} AND ${formatSqlValue(f.value2)}`;
        }
        
        if (f.value !== undefined) {
          return `${field} ${op} ${formatSqlValue(f.value)}`;
        }
        
        if (f.values?.length > 0) {
          const escapedValues = f.values.map(v => formatSqlValue(v));
          return `${field} IN (${escapedValues.join(', ')})`;
        }
        
        return null;
      })
      .filter(Boolean);
    
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }
  }

  // Add GROUP BY if needed
  if (needsAggregation && groupByParts.length > 0) {
    sql += ` GROUP BY ${groupByParts.join(', ')}`;
  }

  // Window functions must run AFTER aggregation — wrap in CTE
  const hasCteWrapper = windowCalcCols.length > 0;
  if (hasCteWrapper) {
    const baseColumnsSet = new Set([...addedToSelect, ...nonAggregateCalcFieldNames]);
    const outerSelectParts = [...baseColumnsSet].map(c => `"${c}"`);
    
    const baseAliases = new Map();
    baseColumnsSet.forEach(c => baseAliases.set(c.toUpperCase(), c));
    
    windowCalcCols.forEach(cf => {
      const expr = (cf.expression || '').replace(/\[([^\]]+)\]/g, (_, name) => {
        const alias = baseAliases.get(name.toUpperCase());
        return `"${alias || name}"`;
      });
      outerSelectParts.push(`${expr} AS "${cf.name}"`);
    });
    
    sql = `WITH base AS (${sql}) SELECT ${outerSelectParts.join(', ')} FROM base`;
  }

  // Add ORDER BY
  if (config.sorts?.length > 0) {
    const calcFieldMap = new Map(usedCustomColumns.map(cc => [cc.name?.toUpperCase(), cc.expression]));
    
    const orderParts = config.sorts
      .map(s => {
        const fieldUpper = s.field?.toUpperCase();
        
        const datePartInfo = datePartMap.get(fieldUpper);
        if (datePartInfo) {
          if (hasCteWrapper) {
            return `"${datePartInfo.alias}" ${s.direction || 'ASC'}`;
          }
          return `${datePartInfo.expression} ${s.direction || 'ASC'}`;
        }
        
        const calcExpr = calcFieldMap.get(fieldUpper);
        if (calcExpr) {
          if (hasCteWrapper) {
            return `"${s.field}" ${s.direction || 'ASC'}`;
          }
          const sqlExpr = calcExpr.replace(/\[([^\]]+)\]/g, '"$1"');
          return `${sqlExpr} ${s.direction || 'ASC'}`;
        }
        
        return `"${s.field}" ${s.direction || 'ASC'}`;
      });
    sql += ` ORDER BY ${orderParts.join(', ')}`;
  }

  sql += ` LIMIT ${Math.min(parseInt(limit) || DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_LIMIT)}`;

  return sql;
};

/**
 * Build SQL preview string (formatted for display)
 * Same as buildQuery but with newlines for readability
 */
const buildSqlPreview = (config, semanticViewFQN, options = {}) => {
  const { limit = DEFAULT_QUERY_LIMIT } = options;
  
  if (!semanticViewFQN) return '-- Select a data source to see SQL preview';

  let { dimensions, measures, usedCustomColumns, datePartFields } = buildQueryFromConfig(config);

  if (dimensions.length === 0 && measures.length === 0 && usedCustomColumns.length === 0) {
    return '-- Add fields to Columns or Rows to see SQL preview';
  }

  // Set of calculated field names — these are NOT semantic view fields
  const calcFieldNamesSet = new Set(usedCustomColumns.map(cc => cc.name.toUpperCase()));

  // Split into regular vs window BEFORE resolving (same as buildQueryDirect).
  const rawRegularCalcCols = usedCustomColumns.filter(cf => cf?.expression && !isWindowExpression(cf.expression));
  const windowCalcCols = usedCustomColumns.filter(cf => cf?.expression && isWindowExpression(cf.expression));

  // Resolve inter-calc-field references only for regular calc cols
  const resolvedRegularCols = resolveCalcFieldReferences(rawRegularCalcCols);

  // Build SELECT clause
  const selectParts = [];
  const addedToSelect = new Set();
  const groupByParts = [];
  
  const calcFieldRefs = new Set();
  resolvedRegularCols.forEach(cf => {
    extractFieldReferences(cf.expression).forEach(ref => {
      if (!calcFieldNamesSet.has(ref.toUpperCase())) {
        calcFieldRefs.add(ref.toUpperCase());
      }
    });
  });
  windowCalcCols.forEach(cf => {
    extractFieldReferences(cf.expression).forEach(ref => {
      if (!calcFieldNamesSet.has(ref.toUpperCase())) {
        calcFieldRefs.add(ref.toUpperCase());
      }
    });
  });
  
  const datePartMap = new Map();
  datePartFields.forEach(dp => {
    const fn = DATE_PART_FUNCTIONS[dp.datePart];
    if (fn) {
      datePartMap.set(dp.originalName.toUpperCase(), {
        expression: fn(dp.baseName),
        alias: dp.alias,
      });
    }
  });
  
  const isImplicitCalcFieldDim = (dim) => {
    const dimUpper = dim.toUpperCase();
    if (calcFieldRefs.has(dimUpper)) {
      return usedCustomColumns.some(cc => {
        const refs = extractFieldReferences(cc.expression);
        return refs.some(r => r.toUpperCase() === dimUpper);
      });
    }
    return false;
  };
  
  const getFieldName = (f) => typeof f === 'object' ? f.name : f;
  const colNames = (config.columns || []).map(getFieldName).filter(Boolean);
  const rowNames = (config.rows || []).map(getFieldName).filter(Boolean);
  const allShelfFields = [...colNames, ...rowNames];
  
  const measureNamesSet = new Set(measures.map(m => m.name));
  
  // Process each field on shelves — skip calc field names
  allShelfFields.forEach(fieldName => {
    if (addedToSelect.has(fieldName)) return;
    if (calcFieldNamesSet.has(fieldName.toUpperCase())) return;
    if (measureNamesSet.has(fieldName)) return;
    
    const datePartInfo = datePartMap.get(fieldName.toUpperCase());
    if (datePartInfo) {
      selectParts.push(`  ${datePartInfo.expression} AS "${datePartInfo.alias}"`);
      groupByParts.push(datePartInfo.expression);
      addedToSelect.add(fieldName);
      return;
    }
    
    if (isImplicitCalcFieldDim(fieldName)) return;
    
    if (dimensions.includes(fieldName)) {
      selectParts.push(`  "${fieldName}"`);
      groupByParts.push(`"${fieldName}"`);
      addedToSelect.add(fieldName);
    }
  });
  
  const hasNonAggCalcFields = resolvedRegularCols.some(cf => !isAggregateExpression(cf.expression));
  const needsAggregation = groupByParts.length > 0 || hasNonAggCalcFields || datePartFields.length > 0 ||
                           (measures.length > 0 && hasNonAggCalcFields);
  
  measures.forEach(({ name, aggregation }) => {
    if (!addedToSelect.has(name)) {
      if (needsAggregation) {
        selectParts.push(`  ${aggregation}("${name}") AS "${name}"`);
      } else {
        selectParts.push(`  "${name}"`);
      }
      addedToSelect.add(name);
    }
  });

  // Add resolved regular calc fields to the base SELECT
  const nonAggregateCalcFieldNames = [];
  resolvedRegularCols.forEach(cf => {
    if (!cf?.expression || !cf?.name) return;
    const sqlExpr = (cf.expression || '').replace(/\[([^\]]+)\]/g, '"$1"');
    selectParts.push(`  ${sqlExpr} AS "${cf.name}"`);
    if (!isAggregateExpression(cf.expression)) {
      nonAggregateCalcFieldNames.push(cf.name);
      groupByParts.push(sqlExpr);
    }
  });

  let sql = `SELECT\n${selectParts.join(',\n')}\nFROM SEMANTIC_VIEW(\n  ${semanticViewFQN}`;

  // Build base dimensions — filter out calc field names
  const baseDimensions = [...new Set(dimensions.map(d => {
    const parsed = parseDatePartField(d);
    return parsed ? parsed.baseName : d;
  }))].filter(d => !calcFieldNamesSet.has(d.toUpperCase()));
  
  const filterFields = (config.filters || [])
    .map(f => f?.field ? getBaseFieldName(f.field) : null)
    .filter(Boolean)
    .filter(f => !baseDimensions.includes(f) && !measureNamesSet.has(f));
  
  const allDimensions = [...new Set([...baseDimensions, ...filterFields])];
  
  if (allDimensions.length > 0) {
    sql += `\n  DIMENSIONS ${allDimensions.join(', ')}`;
  }

  if (measures.length > 0) {
    const measureNamesList = measures.map(m => m.name);
    sql += `\n  METRICS ${measureNamesList.join(', ')}`;
  }

  sql += `\n)`;

  // Add WHERE clause if filters exist
  if (config.filters?.length > 0) {
    const calcFieldMapForWhere = new Map(usedCustomColumns.map(cc => [cc.name?.toUpperCase(), cc.expression]));
    
    const whereParts = config.filters
      .filter(f => f && f.field)
      .map(f => {
        const fieldUpper = f.field?.toUpperCase();
        const calcExpr = calcFieldMapForWhere.get(fieldUpper);
        const field = calcExpr 
          ? calcExpr.replace(/\[([^\]]+)\]/g, '"$1"')
          : `"${f.field}"`;
        
        const op = sanitizeOperator(f.operator);
        
        if (op === 'CUSTOM' && f.customExpression) {
          return f.customExpression
            .replace(/\[\[([^\]]+)\]\]/g, '"$1"')
            .replace(/\{\{([^}]+)\}\}/g, '"$1"');
        }
        
        if ((op === 'IN' || op === 'NOT IN') && Array.isArray(f.values) && f.values.length > 0) {
          const escapedValues = f.values.map(v => formatSqlValue(v));
          return `${field} ${op} (${escapedValues.join(', ')})`;
        }
        
        if (op === 'IS NULL' || op === 'IS NOT NULL' || op === 'IS TRUE' || op === 'IS FALSE') {
          return `${field} ${op}`;
        }
        
        if (op === 'BETWEEN' && f.value !== undefined && f.value2 !== undefined) {
          return `${field} BETWEEN ${formatSqlValue(f.value)} AND ${formatSqlValue(f.value2)}`;
        }
        
        if (f.value !== undefined) {
          return `${field} ${op} ${formatSqlValue(f.value)}`;
        }
        
        if (f.values?.length > 0) {
          const escapedValues = f.values.map(v => formatSqlValue(v));
          return `${field} IN (${escapedValues.join(', ')})`;
        }
        
        return null;
      })
      .filter(Boolean);
    
    if (whereParts.length > 0) {
      sql += `\nWHERE ${whereParts.join(' AND ')}`;
    }
  }

  if (needsAggregation && groupByParts.length > 0) {
    sql += `\nGROUP BY ${groupByParts.join(', ')}`;
  }

  // Window functions must run AFTER aggregation — wrap in CTE
  const hasCteWrapper = windowCalcCols.length > 0;
  if (hasCteWrapper) {
    const baseColumnsSet = new Set([...addedToSelect, ...nonAggregateCalcFieldNames]);
    const outerSelectParts = [...baseColumnsSet].map(c => `  "${c}"`);
    
    const baseAliases = new Map();
    baseColumnsSet.forEach(c => baseAliases.set(c.toUpperCase(), c));
    
    windowCalcCols.forEach(cf => {
      const expr = (cf.expression || '').replace(/\[([^\]]+)\]/g, (_, name) => {
        const alias = baseAliases.get(name.toUpperCase());
        return `"${alias || name}"`;
      });
      outerSelectParts.push(`  ${expr} AS "${cf.name}"`);
    });
    
    sql = `WITH base AS (\n${sql}\n)\nSELECT\n${outerSelectParts.join(',\n')}\nFROM base`;
  }

  if (config.sorts?.length > 0) {
    const calcFieldMap = new Map(usedCustomColumns.map(cc => [cc.name?.toUpperCase(), cc.expression]));
    
    const orderParts = config.sorts
      .map(s => {
        const fieldUpper = s.field?.toUpperCase();
        
        const datePartInfo = datePartMap.get(fieldUpper);
        if (datePartInfo) {
          if (hasCteWrapper) {
            return `"${datePartInfo.alias}" ${s.direction || 'ASC'}`;
          }
          return `${datePartInfo.expression} ${s.direction || 'ASC'}`;
        }
        
        const calcExpr = calcFieldMap.get(fieldUpper);
        if (calcExpr) {
          if (hasCteWrapper) {
            return `"${s.field}" ${s.direction || 'ASC'}`;
          }
          const sqlExpr = calcExpr.replace(/\[([^\]]+)\]/g, '"$1"');
          return `${sqlExpr} ${s.direction || 'ASC'}`;
        }
        
        return `"${s.field}" ${s.direction || 'ASC'}`;
      });
    sql += `\nORDER BY ${orderParts.join(', ')}`;
  }

  sql += `\nLIMIT ${Math.min(parseInt(limit) || DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_LIMIT)}`;

  return sql;
};

// Export for ES modules (frontend)
export {
  DEFAULT_QUERY_LIMIT,
  DATE_PART_FUNCTIONS,
  isDatePartField,
  parseDatePartField,
  transformDatePartToSql,
  getBaseFieldName,
  extractFieldReferences,
  isAggregateExpression,
  isWindowExpression,
  resolveCalcFieldReferences,
  sanitizeOperator,
  formatSqlValue,
  buildQueryFromConfig,
  buildQueryDirect,
  buildQuery,
  buildSqlPreview,
};

// Default export
export default {
  DEFAULT_QUERY_LIMIT,
  buildQueryFromConfig,
  buildQueryDirect,
  buildQuery,
  buildSqlPreview,
  extractFieldReferences,
  isAggregateExpression,
  isWindowExpression,
  resolveCalcFieldReferences,
  isDatePartField,
  parseDatePartField,
  transformDatePartToSql,
  getBaseFieldName,
  sanitizeOperator,
  formatSqlValue,
};
