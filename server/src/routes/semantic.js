/**
 * Simply Analytics - Semantic Views Routes
 * 
 * Semantic views are Snowflake-native objects. Users pick from semantic views
 * they already have access to in their Snowflake account. This app does NOT
 * create or store semantic models - it only:
 * 
 * 1. Lists available semantic views (based on user's Snowflake role)
 * 2. Gets metadata/schema for a semantic view
 * 3. Applies filters and query logic to get results
 * 
 * User's Snowflake connection is used for all operations (not the app service account)
 * since access to semantic views is determined by the user's role.
 */

import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getCachedDashboardConnection } from '../services/connectionService.js';
import { executeQuery } from '../db/dashboardSessionManager.js';
import {
  buildQueryDirect,
  isDatePartField,
  parseDatePartField,
  getBaseFieldName,
  isAggregateExpression,
  extractFieldReferences,
  DEFAULT_QUERY_LIMIT,
} from '../utils/queryBuilder.js';

// Debug logging toggle - set SEMANTIC_DEBUG=true for verbose logs
const DEBUG = process.env.SEMANTIC_DEBUG === 'true' || process.env.VERBOSE_LOGS === 'true';
const debugLog = (...args) => DEBUG && console.log(...args);

export const semanticRoutes = Router();

/**
 * Helper to get cached Snowflake connection from connectionId
 * Uses connection pool to reuse connections instead of creating new ones
 * Automatically switches role/warehouse if dashboard requires different settings
 * @param connectionId - Snowflake connection config ID
 * @param userId - App user ID (for permission check)
 * @param sessionId - Unique session ID from JWT (for connection caching)
 * @param options - Optional dashboard-specific role/warehouse overrides
 */
async function getSnowflakeConnectionFromId(connectionId, userId, sessionId, options = {}) {
  return getCachedDashboardConnection(connectionId, userId, sessionId, options);
}

/**
 * GET /api/semantic/views
 * List all semantic views accessible by the current user's role
 */
semanticRoutes.get('/views', async (req, res, next) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ 
        error: 'Authentication required to list semantic views',
        code: 'NO_CONNECTION'
      });
    }

    // Query Snowflake for semantic views accessible to this role
    const sql = `
      SHOW SEMANTIC VIEWS;
    `;

    const views = await executeUserQuery(req.snowflakeConnection, sql);
    
    res.json({ 
      views: views.map(row => ({
        name: row.name || row.NAME,
        database: row.database_name || row.DATABASE_NAME,
        schema: row.schema_name || row.SCHEMA_NAME,
        owner: row.owner || row.OWNER,
        comment: row.comment || row.COMMENT,
        createdOn: row.created_on || row.CREATED_ON,
      }))
    });
  } catch (error) {
    // If SHOW SEMANTIC VIEWS fails, try alternative approach
    if (error.message?.includes('Unsupported')) {
      return res.json({ views: [], message: 'Semantic views not available in this Snowflake edition' });
    }
    next(error);
  }
});

/**
 * GET /api/semantic/views/:database/:schema/:name
 * Get details/metadata for a specific semantic view
 * Query param: connectionId - use stored connection instead of session
 */
semanticRoutes.get('/views/:database/:schema/:name', async (req, res, next) => {
  let tempConnection = null;
  
  try {
    const { connectionId, role, warehouse } = req.query;
    let connection = req.snowflakeConnection;
    
    // If connectionId provided, use stored connection
    // Pass dashboard-specific role/warehouse to switch if needed
    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(
          connectionId, 
          req.user.id, 
          req.user.sessionId,
          { role, warehouse }
        );
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({ 
          error: 'Failed to connect: ' + connError.message,
          code: 'CONNECTION_ERROR'
        });
      }
    }
    
    if (!connection) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'NO_CONNECTION'
      });
    }

    const { database, schema, name } = req.params;
    const fullyQualifiedName = `"${database}"."${schema}"."${name}"`;

    // Get semantic view definition
    const describeSql = `DESCRIBE SEMANTIC VIEW ${fullyQualifiedName}`;
    
    try {
      // Use executeQuery for temp connections, executeUserQuery for session connections
      const description = tempConnection 
        ? (await executeQuery(tempConnection, describeSql)).rows
        : await executeUserQuery(connection, describeSql);
      
      res.json({
        name,
        database,
        schema,
        fullyQualifiedName,
        columns: description,
      });
    } catch (descError) {
      // Try to get basic info if DESCRIBE fails
      res.json({
        name,
        database,
        schema,
        fullyQualifiedName,
        columns: [],
        error: 'Could not describe semantic view: ' + descError.message,
      });
    }
  } catch (error) {
    next(error);
  }
  // Note: Don't destroy cached connections - they are reused
});

// In-memory cache for semantic view metadata (simple cache, could use Redis in production)
const semanticViewMetadataCache = new Map();
const METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Helper to parse DESCRIBE SEMANTIC VIEW output into structured metadata
 */
function parseSemanticViewMetadata(columns) {
  const dimensions = [];
  const measures = [];
  const facts = [];
  
  if (!columns || columns.length === 0) {
    return { dimensions, measures, facts };
  }
  
  // Check if this is Snowflake's flattened property format
  const isSnowflakeFormat = columns[0]?.object_kind !== undefined;
  
  if (isSnowflakeFormat) {
    // Group rows by object_name to build complete field objects
    const objectMap = new Map();
    
    columns.forEach(row => {
      const { object_kind, object_name, property, property_value, parent_entity } = row;
      if (!object_name) return;
      
      if (!objectMap.has(object_name)) {
        objectMap.set(object_name, {
          name: object_name,
          kind: object_kind,
          parentEntity: parent_entity,
          properties: {},
        });
      }
      
      if (property) {
        objectMap.get(object_name).properties[property] = property_value;
      }
    });
    
    // Helper to strip entity prefix (e.g., "ORDERS.ORDER_COUNT" -> "ORDER_COUNT")
    const stripPrefix = (name) => {
      if (!name) return name;
      return name.includes('.') ? name.split('.').pop() : name;
    };
    
    // Categorize by kind
    objectMap.forEach((obj) => {
      const kind = (obj.kind || '').toUpperCase();
      const cleanName = stripPrefix(obj.name);
      const fieldObj = {
        name: cleanName,
        type: obj.properties.DATA_TYPE || 'VARCHAR',
        description: obj.properties.DESCRIPTION || '',
        parentEntity: obj.parentEntity,
      };
      
      if (kind === 'METRIC' || kind === 'MEASURE') {
        measures.push(fieldObj.name);
      } else if (kind === 'DIMENSION') {
        dimensions.push(fieldObj.name);
      } else if (kind === 'FACT') {
        facts.push(fieldObj.name);
      }
    });
  } else {
    // Standard format - columns have name, type, etc. directly
    columns.forEach(col => {
      const name = col.name || col.column_name;
      const kind = (col.semantic_type || col.kind || '').toUpperCase();
      
      if (kind === 'METRIC' || kind === 'MEASURE') {
        measures.push(name);
      } else if (kind === 'DIMENSION') {
        dimensions.push(name);
      } else if (kind === 'FACT') {
        facts.push(name);
      } else {
        // Default: numbers are facts, others are dimensions
        const type = (col.type || col.data_type || '').toUpperCase();
        if (type.includes('NUMBER') || type.includes('INT') || type.includes('FLOAT') || type.includes('DECIMAL')) {
          facts.push(name);
        } else {
          dimensions.push(name);
        }
      }
    });
  }
  
  return { dimensions, measures, facts };
}

/**
 * Helper to get semantic view metadata (with caching)
 */
async function getSemanticViewMetadata(connection, semanticViewFQN, tempConnection = null) {
  // Check cache first
  const cacheKey = semanticViewFQN.toUpperCase();
  const cached = semanticViewMetadataCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < METADATA_CACHE_TTL)) {
    debugLog(`[getSemanticViewMetadata] Cache hit for ${semanticViewFQN}`);
    return cached.metadata;
  }
  
  // Fetch from Snowflake
  debugLog(`[getSemanticViewMetadata] Fetching metadata for ${semanticViewFQN}`);
  const describeSql = `DESCRIBE SEMANTIC VIEW ${semanticViewFQN}`;
  
  const columns = tempConnection 
    ? (await executeQuery(tempConnection, describeSql)).rows
    : await executeUserQuery(connection, describeSql);
  
  const metadata = parseSemanticViewMetadata(columns);
  
  // Cache the result
  semanticViewMetadataCache.set(cacheKey, {
    metadata,
    timestamp: Date.now(),
  });
  
  debugLog(`[getSemanticViewMetadata] Cached metadata:`, {
    dimensions: metadata.dimensions.length,
    measures: metadata.measures.length,
    facts: metadata.facts.length,
  });
  
  return metadata;
}

/**
 * POST /api/semantic/preview
 * Generate SQL preview from field configuration
 * 
 * This is the SINGLE SOURCE OF TRUTH for SQL generation.
 * Frontend sends field configuration, backend generates SQL.
 * 
 * Body: {
 *   semanticView: "DATABASE.SCHEMA.VIEW_NAME",
 *   fields: [
 *     { name: "R_NAME", shelf: "columns", aggregation: null, filter: null, sortDir: null },
 *     { name: "ORDER_COUNT", shelf: "rows", aggregation: "SUM", filter: null, sortDir: null }
 *   ],
 *   customColumns: [{ name: "custom1", expression: "SUM([FIELD1]) / [FIELD2]" }],
 *   connectionId: "uuid"
 * }
 * 
 * Returns: {
 *   sql: "SELECT ... FROM SEMANTIC_VIEW(...) ...",
 *   dimensions: ["R_NAME"],
 *   measures: ["ORDER_COUNT"],
 *   valid: true
 * }
 */
semanticRoutes.post('/preview', async (req, res, next) => {
  let tempConnection = null;
  
  try {
    const { 
      semanticView,
      fields = [],
      filters: inputFilters = [],
      sorts: inputSorts = [],
      customColumns = [],
      connectionId,
      role,
      warehouse,
    } = req.body;

    console.log('\n=== PREVIEW REQUEST ===');
    console.log('fields:', JSON.stringify(fields.map(f => ({ name: f.name || f, semanticType: f.semanticType, isCustomColumn: f.isCustomColumn }))));
    console.log('customColumns:', JSON.stringify(customColumns.map(cc => ({ name: cc.name, expr: cc.expression?.substring(0, 80) }))));
    console.log('========================\n');

    if (!semanticView) {
      return res.json({
        sql: '-- Select a data source to see SQL preview',
        dimensions: [],
        measures: [],
        valid: false,
      });
    }

    let connection = req.snowflakeConnection;
    
    // Get connection if connectionId provided
    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(
          connectionId, 
          req.user.id, 
          req.user.sessionId,
          { role, warehouse }
        );
        connection = tempConnection;
      } catch (connError) {
        // Return a preview error but don't fail completely
        return res.json({
          sql: `-- Connection error: ${connError.message}`,
          dimensions: [],
          measures: [],
          valid: false,
        });
      }
    }
    
    if (!connection) {
      return res.json({
        sql: '-- Authentication required',
        dimensions: [],
        measures: [],
        valid: false,
      });
    }

    // Get semantic view metadata (cached) - used for validation and fallback
    let metadata;
    try {
      metadata = await getSemanticViewMetadata(connection, semanticView, tempConnection);
    } catch (metaError) {
      console.error('Failed to get metadata:', metaError.message);
      return res.json({
        sql: `-- Failed to get semantic view metadata: ${metaError.message}`,
        dimensions: [],
        measures: [],
        valid: false,
      });
    }

    // Process unified config - fields now include semanticType from frontend
    const dimensions = [];
    const measures = [];
    const previewAggDims = [];
    
    // Helper to check if field is a measure in metadata (fallback)
    const isMetadataMeasure = (fieldName) => {
      const upper = fieldName.toUpperCase();
      return metadata.measures.some(m => m.toUpperCase() === upper);
    };
    
    // Helper to check if field is a calculated field
    const isFieldCustomColumn = (fieldName) => {
      return customColumns.some(cc => cc.name?.toUpperCase() === fieldName?.toUpperCase());
    };
    
    // Process each field from unified config
    // Measures are now stored as { name, aggregation } for proper SQL generation
    const measureSet = new Set(); // Track measure names to avoid duplicates
    
    fields.forEach(field => {
      const name = field.name || field;
      if (!name) return;
      
      // Skip custom columns for dimension/measure classification
      if (isFieldCustomColumn(name) || field.isCustomColumn) return;
      
      // Use semanticType from unified config if available (frontend already classified)
      // Otherwise fall back to aggregation + metadata check
      let isMeasure = false;
      
      if (field.semanticType) {
        // Unified config provides semantic type
        isMeasure = field.semanticType === 'measure';
      } else {
        // Legacy format - classify based on aggregation and metadata
        isMeasure = field.aggregation || isMetadataMeasure(name);
      }
      
      if (isMeasure) {
        if (!measureSet.has(name)) {
          measureSet.add(name);
          const agg = field.aggregation ? field.aggregation.toUpperCase() : null;
          measures.push({ 
            name, 
            aggregation: (agg && agg !== 'NONE') ? agg : null
          });
        }
      } else {
        if (!dimensions.includes(name)) {
          dimensions.push(name);
        }
        // Track aggregated dimensions (dimension with user-applied aggregation)
        const dimAgg = field.aggregation ? field.aggregation.toUpperCase() : null;
        if (dimAgg && dimAgg !== 'NONE') {
          if (!previewAggDims.some(ad => ad.name === name)) {
            previewAggDims.push({ name, aggregation: dimAgg });
          }
        }
      }
    });

    // Process filters - use inputFilters from unified config
    const filters = inputFilters.map(f => ({
      field: f.field,
      operator: f.operator,
      value: f.value,
      values: f.values,
      ...(f.customExpression ? { customExpression: f.customExpression } : {}),
    })).filter(f => f.field && f.operator);

    // Process sorts - use inputSorts from unified config
    const orderBy = inputSorts.map(s => ({
      field: s.field,
      direction: s.direction || 'ASC',
    })).filter(s => s.field);

    // Scan calculated field expressions for MEASURE references that aren't
    // on shelves — they need to be in METRICS. Dimension references are handled
    // automatically by buildQueryDirect's calcFieldReferences → SEMANTIC_VIEW DIMENSIONS
    // (they should NOT be in SELECT/GROUP BY, only in the SEMANTIC_VIEW clause).
    const calcFieldNamesUpper = new Set(customColumns.map(cc => cc.name?.toUpperCase()));
    const measureNamesUpper = new Set([...measureSet].map(m => m.toUpperCase()));
    customColumns.forEach(cc => {
      if (!cc?.expression) return;
      const refs = extractFieldReferences(cc.expression);
      refs.forEach(ref => {
        const upper = ref.toUpperCase();
        if (calcFieldNamesUpper.has(upper)) return;
        if (measureNamesUpper.has(upper)) return;
        if (isMetadataMeasure(ref)) {
          measureSet.add(ref);
          measureNamesUpper.add(upper);
          measures.push({ name: ref, aggregation: 'SUM' });
        }
      });
    });

    // If no fields, return placeholder
    if (dimensions.length === 0 && measures.length === 0 && customColumns.length === 0) {
      return res.json({
        sql: '-- Add fields to Columns or Rows to see SQL preview',
        dimensions: [],
        measures: [],
        valid: false,
      });
    }

    // Generate SQL using the shared query builder
    const sql = buildQueryDirect({
      semanticViewFQN: semanticView,
      dimensions,
      measures,
      aggregatedDimensions: previewAggDims,
      filters,
      orderBy,
      customColumns,
      limit: DEFAULT_QUERY_LIMIT,
    });

    // Extract measure names for response (backwards compatibility)
    const measureNames = measures.map(m => typeof m === 'object' ? m.name : m);
    
    debugLog('\n=== PREVIEW RESPONSE ===');
    debugLog('dimensions:', dimensions);
    debugLog('measures:', measureNames);
    debugLog('sql:', sql);
    debugLog('========================\n');

    res.json({
      sql,
      dimensions,
      measures: measureNames,
      valid: true,
    });
  } catch (error) {
    console.error('Preview error:', error.message);
    res.json({
      sql: `-- Error: ${error.message}`,
      dimensions: [],
      measures: [],
      valid: false,
    });
  }
});

/**
 * POST /api/semantic/query
 * Query a semantic view with filters
 * 
 * Body: {
 *   semanticView: "DATABASE.SCHEMA.VIEW_NAME",
 *   dimensions: ["dim1", "dim2"],
 *   measures: ["measure1", "measure2"],
 *   filters: [
 *     { field: "dim1", operator: "=", value: "value" },
 *     { field: "measure1", operator: ">", value: 100 }
 *   ],
 *   orderBy: [{ field: "dim1", direction: "ASC" }],
 *   limit: 1000000,
 *   connectionId: "uuid" // Use stored connection
 * }
 */
semanticRoutes.post('/query', async (req, res, next) => {
  let tempConnection = null;
  
  try {
    const { 
      semanticView, 
      dimensions = [], 
      measures = [], 
      aggregatedFields = [],
      filters = [], 
      orderBy = [], 
      customColumns = [],
      limit = 1000000,
      connectionId,
      role,
      warehouse,
      forceRefresh = false
    } = req.body;

    let connection = req.snowflakeConnection;
    
    // If connectionId provided, use stored connection
    // Pass dashboard-specific role/warehouse to switch if needed
    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(
          connectionId, 
          req.user.id, 
          req.user.sessionId,
          { role, warehouse, forceRefresh }
        );
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({ 
          error: 'Failed to connect: ' + connError.message,
          code: 'CONNECTION_ERROR'
        });
      }
    }
    
    if (!connection) {
      return res.status(401).json({ 
        error: 'Authentication required to query semantic views',
        code: 'NO_CONNECTION'
      });
    }

    // Log query parameters for debugging (controlled by SEMANTIC_DEBUG env var)
    debugLog('\n=== SEMANTIC QUERY REQUEST ===');
    debugLog('semanticView:', semanticView);
    debugLog('dimensions:', JSON.stringify(dimensions));
    debugLog('measures:', JSON.stringify(measures));
    debugLog('aggregatedFields:', JSON.stringify(aggregatedFields));
    debugLog('filters:', JSON.stringify(filters, null, 2));
    debugLog('orderBy:', JSON.stringify(orderBy));
    debugLog('customColumns:', JSON.stringify(customColumns));
    debugLog('==============================\n');

    if (!semanticView) {
      return res.status(400).json({ error: 'semanticView is required' });
    }

    // Must have at least one dimension, measure, or custom column
    if (dimensions.length === 0 && measures.length === 0 && customColumns.length === 0) {
      return res.status(400).json({ error: 'At least one dimension, measure, or custom column is required' });
    }

    // Merge aggregatedFields into measures as objects with { name, aggregation }
    const aggMap = new Map(aggregatedFields.map(af => [af.name.toUpperCase(), af.aggregation || null]));

    // Separate aggregated dimensions from measure aggregations
    const dimensionSet = new Set(dimensions.map(d => d.toUpperCase()));
    const aggregatedDimensions = [];
    aggMap.forEach((agg, upperName) => {
      if (agg && dimensionSet.has(upperName)) {
        aggregatedDimensions.push({ name: dimensions.find(d => d.toUpperCase() === upperName) || upperName, aggregation: agg });
      }
    });

    const enrichedMeasures = measures.map(m => {
      const name = typeof m === 'object' ? m.name : m;
      const upperName = name.toUpperCase();
      let agg;
      if (aggMap.has(upperName)) {
        agg = aggMap.get(upperName);
      } else if (typeof m === 'object' && m.aggregation) {
        agg = m.aggregation;
      } else {
        agg = 'SUM';
      }
      return { name, aggregation: (agg && agg !== 'NONE') ? agg : null };
    });

    // Use the shared query builder - SINGLE SOURCE OF TRUTH
    const sql = buildQueryDirect({
      semanticViewFQN: semanticView,
      dimensions,
      measures: enrichedMeasures,
      aggregatedDimensions,
      filters,
      orderBy,
      customColumns,
      limit: Math.min(parseInt(limit) || DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_LIMIT),
    });

    // Log generated SQL for debugging (controlled by SEMANTIC_DEBUG env var)
    debugLog('\n=== GENERATED SQL ===');
    debugLog(sql);
    debugLog('=====================\n');

    const startTime = Date.now();
    // Use executeQuery for temp connections, executeUserQuery for session connections
    const result = tempConnection 
      ? (await executeQuery(tempConnection, sql)).rows
      : await executeUserQuery(connection, sql);
    const executionTime = Date.now() - startTime;

    res.json({
      data: result,
      rowCount: result.length,
      executionTime,
      query: sql.trim(),
    });
  } catch (error) {
    console.error('Semantic query error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ 
      error: error.message || 'Query execution failed',
      code: error.code || 'QUERY_ERROR'
    });
  }
  // Note: Don't destroy cached connections - they are reused
});

/**
 * POST /api/semantic/distinct-values
 * Get distinct values for a field in a semantic view (for filter dropdowns)
 * 
 * Body: {
 *   semanticView: "DATABASE.SCHEMA.VIEW_NAME",
 *   field: "FIELD_NAME",
 *   search: "",           // optional search/filter text
 *   limit: 100,           // page size
 *   offset: 0,            // pagination offset
 *   connectionId: "uuid",
 *   role: "ROLE",         // optional
 *   warehouse: "WH"       // optional
 * }
 */
semanticRoutes.post('/distinct-values', async (req, res, next) => {
  let tempConnection = null;

  try {
    const {
      semanticView,
      field,
      search = '',
      limit = 100,
      offset = 0,
      connectionId,
      role,
      warehouse,
    } = req.body;

    let connection = req.snowflakeConnection;

    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(
          connectionId,
          req.user.id,
          req.user.sessionId,
          { role, warehouse }
        );
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({
          error: 'Failed to connect: ' + connError.message,
          code: 'CONNECTION_ERROR'
        });
      }
    }

    if (!connection) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NO_CONNECTION'
      });
    }

    if (!semanticView || !field) {
      return res.status(400).json({ error: 'semanticView and field are required' });
    }

    debugLog('\n=== DISTINCT VALUES REQUEST ===');
    debugLog('semanticView:', semanticView, 'field:', field, 'search:', search, 'limit:', limit, 'offset:', offset);

    // Build COUNT query first to get total
    let countSql = `
      SELECT COUNT(DISTINCT "${field}") AS CNT
      FROM SEMANTIC_VIEW(
        ${semanticView}
        DIMENSIONS "${field}"
      )
      WHERE "${field}" IS NOT NULL
    `;
    if (search) {
      const escaped = search.replace(/'/g, "''");
      countSql += ` AND CAST("${field}" AS VARCHAR) ILIKE '%${escaped}%'`;
    }

    // Build the values query
    let valuesSql = `
      SELECT DISTINCT "${field}" AS VAL
      FROM SEMANTIC_VIEW(
        ${semanticView}
        DIMENSIONS "${field}"
      )
      WHERE "${field}" IS NOT NULL
    `;
    if (search) {
      const escaped = search.replace(/'/g, "''");
      valuesSql += ` AND CAST("${field}" AS VARCHAR) ILIKE '%${escaped}%'`;
    }
    valuesSql += ` ORDER BY "${field}" ASC`;
    valuesSql += ` LIMIT ${parseInt(limit) || 100}`;
    if (offset > 0) {
      valuesSql += ` OFFSET ${parseInt(offset)}`;
    }

    debugLog('Count SQL:', countSql.trim());
    debugLog('Values SQL:', valuesSql.trim());

    const execFn = tempConnection
      ? async (sql) => (await executeQuery(tempConnection, sql)).rows
      : async (sql) => executeUserQuery(connection, sql);

    const [countResult, valuesResult] = await Promise.all([
      execFn(countSql),
      execFn(valuesSql),
    ]);

    const totalCount = countResult?.[0]?.CNT ?? countResult?.[0]?.cnt ?? 0;
    const values = valuesResult.map(row => row.VAL ?? row.val ?? row[field] ?? Object.values(row)[0]);
    const hasMore = (parseInt(offset) + values.length) < totalCount;

    debugLog('Returned', values.length, 'values, totalCount:', totalCount, 'hasMore:', hasMore);

    res.json({ values, totalCount, hasMore });
  } catch (error) {
    console.error('Distinct values error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to fetch distinct values',
      code: 'QUERY_ERROR'
    });
  }
});

/**
 * POST /api/semantic/pivot
 * Query a semantic view with SQL-level pivoting
 * 
 * Body: {
 *   semanticView: "DATABASE.SCHEMA.VIEW_NAME",
 *   rowDimensions: ["dim1"],        // Fields for row headers
 *   pivotColumn: "dim2",            // Field to pivot (becomes column headers)
 *   measures: ["measure1"],         // Values to aggregate
 *   aggregation: "SUM",             // Aggregation function (SUM, AVG, COUNT, etc.)
 *   filters: [...],
 *   limit: 1000000
 * }
 */
semanticRoutes.post('/pivot', async (req, res, next) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'NO_CONNECTION'
      });
    }

    const { 
      semanticView, 
      rowDimensions = [], 
      pivotColumn,
      measures = [], 
      aggregation = 'SUM',
      filters = [], 
      limit = 1000000 
    } = req.body;

    if (!semanticView) {
      return res.status(400).json({ error: 'semanticView is required' });
    }

    if (!pivotColumn) {
      return res.status(400).json({ error: 'pivotColumn is required for pivot queries' });
    }

    if (measures.length === 0) {
      return res.status(400).json({ error: 'At least one measure is required' });
    }

    // Validate aggregation function
    const validAggregations = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'MEDIAN'];
    const aggFunc = validAggregations.includes(aggregation.toUpperCase()) 
      ? aggregation.toUpperCase() 
      : 'SUM';

    debugLog('Pivot query request:', { semanticView, rowDimensions, pivotColumn, measures, aggregation: aggFunc, filters });

    // Build WHERE clause from filters (same logic as regular query endpoint)
    const buildWhereClause = (filtersArray) => {
      if (!filtersArray || filtersArray.length === 0) return '';
      
      const whereClauses = filtersArray.map(f => {
        if (!f || !f.field) return null;
        
        const field = `"${f.field}"`;
        const op = sanitizeOperator(f.operator);

        // Normalize: allow values array as fallback for value/value2
        const val = f.value !== undefined ? f.value : f.values?.[0];
        const val2 = f.value2 !== undefined ? f.value2 : f.values?.[1];
        
        // Handle array of values (multiselect filter / IN operator)
        if ((op === 'IN' || (f.values && !['BETWEEN', 'LIKE', '=', 'NOT IN'].includes(op))) && Array.isArray(f.values) && f.values.length > 0) {
          const escapedValues = f.values.map(v => `'${String(v).replace(/'/g, "''")}'`);
          return `${field} IN (${escapedValues.join(', ')})`;
        }
        
        // Handle NOT IN for exclusion filters
        if (op === 'NOT IN' && Array.isArray(f.values) && f.values.length > 0) {
          const escapedValues = f.values.map(v => `'${String(v).replace(/'/g, "''")}'`);
          return `${field} NOT IN (${escapedValues.join(', ')})`;
        }
        
        // Handle IS NULL / IS NOT NULL / IS TRUE / IS FALSE
        if (op === 'IS NULL' || op === 'IS NOT NULL' || op === 'IS TRUE' || op === 'IS FALSE') {
          return `${field} ${op}`;
        }
        
        // Handle CUSTOM expression
        if (op === 'CUSTOM' && f.customExpression && f.customExpression.trim()) {
          let expr = f.customExpression.trim();
          expr = expr.replace(/\{\{([^}]+)\}\}/g, (match, fieldName) => `"${fieldName.trim()}"`);
          return expr;
        }
        
        // Handle BETWEEN
        if (op === 'BETWEEN' && val !== undefined && val2 !== undefined) {
          const v1 = formatValue(val, f.operator);
          const v2 = formatValue(val2, f.operator);
          return `${field} BETWEEN ${v1} AND ${v2}`;
        }
        
        // Handle LIKE variants
        if (op === 'LIKE' && val !== undefined) {
          return `${field} ILIKE '%${String(val).replace(/'/g, "''")}%'`;
        }
        if (op === 'STARTS_WITH' && val !== undefined) {
          return `${field} ILIKE '${String(val).replace(/'/g, "''")}%'`;
        }
        if (op === 'ENDS_WITH' && val !== undefined) {
          return `${field} ILIKE '%${String(val).replace(/'/g, "''")}'`;
        }
        if (op === 'NOT_LIKE' && val !== undefined) {
          return `${field} NOT ILIKE '%${String(val).replace(/'/g, "''")}%'`;
        }

        // Handle equality
        if (op === '=' && val !== undefined) {
          return `${field} = ${formatValue(val, f.operator)}`;
        }
        
        // Handle standard comparison operators
        if (val !== undefined) {
          const value = formatValue(val, f.operator);
          return `${field} ${op} ${value}`;
        }
        
        return null;
      }).filter(Boolean);
      
      return whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    };
    
    const whereClause = buildWhereClause(filters);
    debugLog('Pivot WHERE clause:', whereClause);

    // Step 1: Get distinct values for the pivot column (with filters applied)
    // All dimensions including pivot column must be in DIMENSIONS clause
    // Also include filter fields in DIMENSIONS
    const filterFields = filters.map(f => f?.field).filter(Boolean);
    const allDims = [...new Set([...rowDimensions, pivotColumn, ...filterFields])];
    
    const distinctSql = `
      SELECT DISTINCT "${pivotColumn}" 
      FROM SEMANTIC_VIEW(
        ${semanticView}
        DIMENSIONS ${allDims.join(', ')}
      )
      ${whereClause}
      ORDER BY "${pivotColumn}"
      LIMIT 50
    `;

    debugLog('Getting distinct pivot values:', distinctSql.trim());

    const distinctResult = await executeUserQuery(req.snowflakeConnection, distinctSql);
    const pivotValues = distinctResult.map(row => {
      const val = row[pivotColumn] || row[pivotColumn.toUpperCase()];
      return val;
    }).filter(v => v !== null && v !== undefined);

    if (pivotValues.length === 0) {
      return res.json({
        data: [],
        rowCount: 0,
        pivotColumns: [],
        message: 'No pivot values found (filters may have excluded all values)',
      });
    }

    debugLog('Pivot values found:', pivotValues);

    // Step 2: Build the PIVOT query with filters
    // Snowflake PIVOT syntax:
    // SELECT * FROM (subquery) PIVOT (AGG(measure) FOR pivot_col IN ('val1', 'val2', ...))
    
    const measure = measures[0];  // Snowflake PIVOT supports one measure at a time
    const pivotInClause = pivotValues.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
    
    // Build subquery with all needed fields (include filter fields)
    const subqueryDims = [...new Set([...rowDimensions, pivotColumn, ...filterFields])].map(d => `"${d}"`).join(', ');
    
    const pivotSql = `
      SELECT * FROM (
        SELECT ${subqueryDims}, "${measure}"
        FROM SEMANTIC_VIEW(
          ${semanticView}
          DIMENSIONS ${allDims.join(', ')}
          METRICS ${measure}
        )
        ${whereClause}
      ) subq
      PIVOT (
        ${aggFunc}("${measure}") 
        FOR "${pivotColumn}" IN (${pivotInClause})
      )
      LIMIT ${Math.min(parseInt(limit) || 1000000, 1000000)}
    `;

    debugLog('Executing pivot query:', pivotSql.trim());

    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, pivotSql);
    const executionTime = Date.now() - startTime;

    res.json({
      data: result,
      rowCount: result.length,
      pivotColumns: pivotValues,
      rowDimensions,
      measure,
      aggregation: aggFunc,
      executionTime,
      query: pivotSql.trim(),
    });
  } catch (error) {
    console.error('Pivot query error:', error.message);
    res.status(500).json({ 
      error: error.message || 'Pivot query execution failed',
      code: error.code || 'PIVOT_ERROR'
    });
  }
});

// NOTE: The /preview endpoint is defined earlier in this file (around line 309)
// It handles unified widget config and generates SQL with proper DIMENSIONS/METRICS classification

/**
 * GET /api/semantic/databases
 * List databases accessible to the user
 */
semanticRoutes.get('/databases', async (req, res, next) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await executeUserQuery(req.snowflakeConnection, 'SHOW DATABASES');
    
    res.json({
      databases: result.map(row => ({
        name: row.name || row.NAME,
        owner: row.owner || row.OWNER,
        comment: row.comment || row.COMMENT,
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/semantic/schemas/:database
 * List schemas in a database
 */
semanticRoutes.get('/schemas/:database', async (req, res, next) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const sql = `SHOW SCHEMAS IN DATABASE "${req.params.database}"`;
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    
    res.json({
      schemas: result.map(row => ({
        name: row.name || row.NAME,
        owner: row.owner || row.OWNER,
      }))
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// Helper Functions (for pivot queries - use local versions to avoid conflicts with shared imports)
// ============================================================

/**
 * Parse date part field names like "ORDER_DATE__YEAR" into { baseName, datePart }
 * Returns { baseName: original, datePart: null } if not a date part field
 * NOTE: This is a local version for pivot queries. Main queries use shared/queryBuilder.js
 */
function parseDatePartFieldLocal(fieldName) {
  const validDateParts = ['YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'HOUR', 'MINUTE', 'DAYOFWEEK', 'DAYOFYEAR'];
  const match = fieldName.match(/^(.+)__(\w+)$/);
  
  if (match && validDateParts.includes(match[2].toUpperCase())) {
    return { 
      baseName: match[1], 
      datePart: match[2].toUpperCase() 
    };
  }
  return { baseName: fieldName, datePart: null };
}

/**
 * Transform a dimension field name to SQL expression
 * Handles date part fields like "ORDER_DATE__YEAR" -> "YEAR(ORDER_DATE)"
 */
function transformDimensionToSql(fieldName) {
  const { baseName, datePart } = parseDatePartFieldLocal(fieldName);
  
  if (datePart) {
    // Return SQL function for date extraction
    // Use DATE_PART for most, but some functions work better directly
    switch (datePart) {
      case 'YEAR':
        return `YEAR("${baseName}")`;
      case 'QUARTER':
        return `QUARTER("${baseName}")`;
      case 'MONTH':
        return `MONTH("${baseName}")`;
      case 'WEEK':
        return `WEEKOFYEAR("${baseName}")`;
      case 'DAY':
        return `DAY("${baseName}")`;
      case 'HOUR':
        return `HOUR("${baseName}")`;
      case 'MINUTE':
        return `MINUTE("${baseName}")`;
      case 'DAYOFWEEK':
        return `DAYOFWEEK("${baseName}")`;
      case 'DAYOFYEAR':
        return `DAYOFYEAR("${baseName}")`;
      default:
        return `DATE_PART('${datePart}', "${baseName}")`;
    }
  }
  
  // Regular field - just quote it
  return `"${baseName}"`;
}

/**
 * Get the alias for a transformed dimension (for SELECT AS clause)
 */
function getDimensionAlias(fieldName) {
  const { baseName, datePart } = parseDatePartFieldLocal(fieldName);
  
  if (datePart) {
    // Use a clean alias like "ORDER_DATE_YEAR"
    return `${baseName}_${datePart}`;
  }
  return fieldName;
}

/**
 * Check if field name is a date part field (local version for pivot queries)
 */
function isDatePartFieldLocal(fieldName) {
  return parseDatePartFieldLocal(fieldName).datePart !== null;
}

/**
 * Get base field name from potentially date-part field (local version for pivot queries)
 */
function getBaseFieldNameLocal(fieldName) {
  return parseDatePartFieldLocal(fieldName).baseName;
}

/**
 * Execute a query using the user's Snowflake connection
 */
function executeUserQuery(connection, sql, binds = []) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      binds,
      complete: (err, stmt, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    });
  });
}

/**
 * Sanitize operator to prevent SQL injection
 */
function sanitizeOperator(op) {
  const validOperators = [
    '=', '!=', '<>', '<', '>', '<=', '>=', 
    'LIKE', 'ILIKE', 'NOT LIKE', 'NOT ILIKE',
    'IN', 'NOT IN', 'NOT_IN',  // Support both formats for NOT IN
    'IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE',
    'BETWEEN',
    'STARTS_WITH', 'ENDS_WITH', 'NOT_LIKE',  // Custom operators we'll handle specially
    'CUSTOM'  // User-defined SQL expression
  ];
  let upperOp = (op || '=').toUpperCase();
  // Normalize NOT_IN to NOT IN
  if (upperOp === 'NOT_IN') upperOp = 'NOT IN';
  return validOperators.includes(upperOp) ? upperOp : '=';
}

/**
 * Format value for SQL based on type and operator
 */
function formatValue(value, operator) {
  const op = (operator || '').toUpperCase();
  
  // Handle NULL operators
  if (op === 'IS NULL' || op === 'IS NOT NULL') {
    return '';
  }
  
  // Handle IN operator (expects array)
  if (op === 'IN' || op === 'NOT IN') {
    if (Array.isArray(value)) {
      const formatted = value.map(v => typeof v === 'string' ? `'${escapeString(v)}'` : v);
      return `(${formatted.join(', ')})`;
    }
    return `('${escapeString(value)}')`;
  }
  
  // Handle regular values
  if (typeof value === 'string') {
    return `'${escapeString(value)}'`;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (value === null) {
    return 'NULL';
  }
  
  return `'${escapeString(String(value))}'`;
}

/**
 * Escape single quotes in strings
 */
function escapeString(str) {
  return str.replace(/'/g, "''");
}

// ============================================================================
// CORTEX AI FUNCTIONS
// ============================================================================

/**
 * POST /api/semantic/cortex/complete
 * Use Cortex COMPLETE for LLM text generation / natural language queries
 */
semanticRoutes.post('/cortex/complete', async (req, res) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    const { 
      prompt, 
      model = 'llama3.1-70b',  // Default model
      temperature = 0.7,
      maxTokens = 1024,
      systemPrompt = null
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Build the CORTEX.COMPLETE call
    // Format: SNOWFLAKE.CORTEX.COMPLETE(model, prompt) or with options
    let sql;
    if (systemPrompt) {
      sql = `
        SELECT SNOWFLAKE.CORTEX.COMPLETE(
          '${model}',
          [
            {'role': 'system', 'content': '${escapeString(systemPrompt)}'},
            {'role': 'user', 'content': '${escapeString(prompt)}'}
          ],
          {'temperature': ${temperature}, 'max_tokens': ${maxTokens}}
        ) as response
      `;
    } else {
      sql = `
        SELECT SNOWFLAKE.CORTEX.COMPLETE(
          '${model}',
          '${escapeString(prompt)}',
          {'temperature': ${temperature}, 'max_tokens': ${maxTokens}}
        ) as response
      `;
    }

    debugLog('Executing Cortex COMPLETE:', sql);
    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    const executionTime = Date.now() - startTime;

    // Parse the response - extract text from Cortex JSON structure
    let response = result[0]?.RESPONSE || result[0]?.response;
    
    // Cortex COMPLETE returns JSON like: {"choices":[{"messages":"text"}]} for chat format
    if (response && typeof response === 'object') {
      if (response.choices && response.choices[0]) {
        response = response.choices[0].messages || response.choices[0].message?.content || response.choices[0].text;
      } else if (response.content) {
        response = response.content;
      } else if (response.message) {
        response = response.message;
      }
    }
    
    res.json({
      response: typeof response === 'string' ? response : JSON.stringify(response),
      model,
      executionTime,
    });
  } catch (error) {
    console.error('Cortex COMPLETE error:', error);
    res.status(500).json({ error: error.message || 'Cortex COMPLETE failed' });
  }
});

/**
 * POST /api/semantic/cortex/ask
 * Natural language query against a semantic view using Cortex
 * Translates natural language to semantic view query
 */
semanticRoutes.post('/cortex/ask', async (req, res) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    const { 
      question,
      semanticView,
      semanticViewSchema,  // { dimensions: [...], measures: [...] }
      model = 'llama3.1-70b'
    } = req.body;

    if (!question || !semanticView) {
      return res.status(400).json({ error: 'Question and semanticView are required' });
    }

    // Build a prompt that instructs the LLM to generate a semantic query
    const systemPrompt = `You are a SQL query generator for Snowflake Semantic Views.
Given a natural language question, generate the appropriate query parameters for the SEMANTIC_VIEW function.

The semantic view is: ${semanticView}

Available fields:
- Dimensions: ${semanticViewSchema?.dimensions?.map(d => d.name || d).join(', ') || 'unknown'}
- Measures: ${semanticViewSchema?.measures?.map(m => m.name || m).join(', ') || 'unknown'}

Respond with ONLY a valid JSON object in this exact format:
{
  "dimensions": ["field1", "field2"],
  "measures": ["measure1"],
  "filters": [{"field": "fieldName", "operator": "=", "value": "value"}],
  "orderBy": [{"field": "field1", "direction": "DESC"}],
  "limit": 1000000,
  "explanation": "Brief explanation of what this query does"
}

Only include fields that are relevant to the question. Use valid operator values: =, !=, <, >, <=, >=, IN, LIKE, IS NULL, IS NOT NULL.
Do not include any other text, markdown, or code blocks - just the raw JSON.`;

    const sql = `
      SELECT SNOWFLAKE.CORTEX.COMPLETE(
        '${model}',
        [
          {'role': 'system', 'content': '${escapeString(systemPrompt)}'},
          {'role': 'user', 'content': '${escapeString(question)}'}
        ],
        {'temperature': 0.3, 'max_tokens': 1024}
      ) as response
    `;

    debugLog('Executing Cortex ASK for semantic view query generation');
    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    const executionTime = Date.now() - startTime;

    const responseText = result[0]?.RESPONSE || result[0]?.response;
    
    // Try to parse the JSON response
    let queryParams;
    try {
      // Handle both string and object responses
      const textToParse = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
      // Extract JSON from potential markdown code blocks
      const jsonMatch = textToParse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        queryParams = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Cortex response:', responseText);
      return res.json({
        success: false,
        error: 'Could not parse AI response into query parameters',
        rawResponse: responseText,
        executionTime,
      });
    }

    res.json({
      success: true,
      queryParams,
      explanation: queryParams.explanation,
      executionTime,
    });
  } catch (error) {
    console.error('Cortex ASK error:', error);
    res.status(500).json({ error: error.message || 'Cortex ASK failed' });
  }
});

/**
 * POST /api/semantic/cortex/insights
 * Generate AI insights about query results
 */
semanticRoutes.post('/cortex/insights', async (req, res) => {
  let tempConnection = null;
  
  try {
    const { 
      data,  // Query result data
      query, // The query that produced the data
      semanticView,
      model = 'llama3.1-70b',
      connectionId,
      role,      // Dashboard-specific role override
      warehouse  // Dashboard-specific warehouse override
    } = req.body;

    let connection = req.snowflakeConnection;
    
    // If connectionId provided, use stored connection
    // Pass dashboard-specific role/warehouse to switch if needed
    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(
          connectionId, 
          req.user.id, 
          req.user.sessionId,
          { role, warehouse }
        );
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({ 
          error: 'Failed to connect: ' + connError.message,
          code: 'CONNECTION_ERROR'
        });
      }
    }
    
    if (!connection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    if (!data || data.length === 0) {
      return res.status(400).json({ error: 'Data is required for insights' });
    }

    // Limit data to first 50 rows for prompt size
    const sampleData = data.slice(0, 50);
    const dataPreview = JSON.stringify(sampleData, null, 2);

    const systemPrompt = `You are a data analyst assistant. Analyze the following query results and provide actionable insights.

Query: ${query || 'Data query'}
Semantic View: ${semanticView || 'Dashboard data'}

Provide insights in this format:
1. Key Findings (2-3 bullet points)
2. Trends or Patterns (if applicable)
3. Recommendations (1-2 actionable items)

Be concise and focus on business-relevant observations.`;

    const sql = `
      SELECT SNOWFLAKE.CORTEX.COMPLETE(
        '${model}',
        [
          {'role': 'system', 'content': '${escapeString(systemPrompt)}'},
          {'role': 'user', 'content': 'Analyze this data:\\n${escapeString(dataPreview)}'}
        ],
        {'temperature': 0.5, 'max_tokens': 1024}
      ) as response
    `;

    debugLog('Executing Cortex INSIGHTS generation');
    const startTime = Date.now();
    // Use executeQuery for temp connections, executeUserQuery for session connections
    const result = tempConnection 
      ? (await executeQuery(tempConnection, sql)).rows
      : await executeUserQuery(connection, sql);
    const executionTime = Date.now() - startTime;

    let response = result[0]?.RESPONSE || result[0]?.response;
    
    // Extract text content from Cortex response
    // Cortex COMPLETE returns JSON like: {"choices":[{"messages":"text content"}]}
    if (response && typeof response === 'object') {
      if (response.choices && response.choices[0]) {
        response = response.choices[0].messages || response.choices[0].message?.content || response.choices[0].text;
      } else if (response.content) {
        response = response.content;
      } else if (response.message) {
        response = response.message;
      }
    }
    
    // If still an object, stringify it
    if (typeof response === 'object') {
      response = JSON.stringify(response);
    }

    res.json({
      insights: response,
      dataRowsAnalyzed: sampleData.length,
      executionTime,
    });
  } catch (error) {
    console.error('Cortex INSIGHTS error:', error);
    res.status(500).json({ error: error.message || 'Cortex INSIGHTS failed' });
  }
  // Note: Don't destroy cached connections - they are reused
});

/**
 * POST /api/semantic/cortex/sentiment
 * Analyze sentiment of text data
 */
semanticRoutes.post('/cortex/sentiment', async (req, res) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const sql = `SELECT SNOWFLAKE.CORTEX.SENTIMENT('${escapeString(text)}') as sentiment`;

    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    const executionTime = Date.now() - startTime;

    const sentiment = result[0]?.SENTIMENT || result[0]?.sentiment;

    res.json({
      sentiment: parseFloat(sentiment),
      executionTime,
    });
  } catch (error) {
    console.error('Cortex SENTIMENT error:', error);
    res.status(500).json({ error: error.message || 'Cortex SENTIMENT failed' });
  }
});

/**
 * POST /api/semantic/cortex/summarize
 * Summarize text data
 */
semanticRoutes.post('/cortex/summarize', async (req, res) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const sql = `SELECT SNOWFLAKE.CORTEX.SUMMARIZE('${escapeString(text)}') as summary`;

    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    const executionTime = Date.now() - startTime;

    const summary = result[0]?.SUMMARY || result[0]?.summary;

    res.json({
      summary,
      executionTime,
    });
  } catch (error) {
    console.error('Cortex SUMMARIZE error:', error);
    res.status(500).json({ error: error.message || 'Cortex SUMMARIZE failed' });
  }
});

/**
 * POST /api/semantic/cortex/translate
 * Translate text
 */
semanticRoutes.post('/cortex/translate', async (req, res) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    const { text, fromLanguage, toLanguage } = req.body;

    if (!text || !fromLanguage || !toLanguage) {
      return res.status(400).json({ error: 'Text, fromLanguage, and toLanguage are required' });
    }

    const sql = `SELECT SNOWFLAKE.CORTEX.TRANSLATE('${escapeString(text)}', '${fromLanguage}', '${toLanguage}') as translation`;

    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, sql);
    const executionTime = Date.now() - startTime;

    const translation = result[0]?.TRANSLATION || result[0]?.translation;

    res.json({
      translation,
      executionTime,
    });
  } catch (error) {
    console.error('Cortex TRANSLATE error:', error);
    res.status(500).json({ error: error.message || 'Cortex TRANSLATE failed' });
  }
});

/**
 * GET /api/semantic/cortex/models
 * List available Cortex LLM models
 */
semanticRoutes.get('/cortex/models', async (req, res) => {
  try {
    // These are the currently available Cortex models
    const models = [
      { id: 'snowflake-arctic', name: 'Snowflake Arctic', description: 'Snowflake\'s own LLM, optimized for enterprise tasks' },
      { id: 'llama3.1-405b', name: 'Llama 3.1 405B', description: 'Meta\'s largest and most capable model' },
      { id: 'llama3.1-70b', name: 'Llama 3.1 70B', description: 'Excellent balance of speed and quality (recommended)' },
      { id: 'llama3.1-8b', name: 'Llama 3.1 8B', description: 'Fast responses, good for simple tasks' },
      { id: 'mistral-large2', name: 'Mistral Large 2', description: 'Strong reasoning and code generation' },
      { id: 'mixtral-8x7b', name: 'Mixtral 8x7B', description: 'Fast mixture-of-experts model' },
      { id: 'gemma-7b', name: 'Gemma 7B', description: 'Google\'s efficient open model' },
    ];

    res.json({ models });
  } catch (error) {
    console.error('Error listing Cortex models:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CORTEX AGENT CHAT (Streaming SSE proxy)
// ============================================================================

/**
 * POST /api/semantic/cortex/agent/run
 * Proxy to Snowflake Cortex Agent :run API with SSE streaming.
 * Uses the dashboard's stored connection credentials to authenticate.
 *
 * Body: {
 *   connectionId: "uuid",
 *   agentFqn: "DB.SCHEMA.AGENT_NAME",
 *   messages: [{ role: "user", content: [{ type: "text", text: "..." }] }],
 *   threadId?: number,
 *   parentMessageId?: number,
 * }
 */
semanticRoutes.post('/cortex/agent/run', async (req, res) => {
  try {
    const {
      connectionId,
      agentFqn,
      messages,
      threadId,
      parentMessageId,
      role,
    } = req.body;

    if (!connectionId || !agentFqn || !messages) {
      return res.status(400).json({ error: 'connectionId, agentFqn, and messages are required' });
    }

    // Parse FQN into database, schema, name
    const parts = agentFqn.split('.');
    if (parts.length !== 3) {
      return res.status(400).json({ error: 'agentFqn must be DATABASE.SCHEMA.AGENT_NAME' });
    }
    const [database, schema, agentName] = parts;

    // Get connection credentials
    const { getConnectionWithCredentialsForDashboard } = await import('../services/connectionService.js');
    const connWithCreds = await getConnectionWithCredentialsForDashboard(connectionId);
    if (!connWithCreds) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Build Snowflake REST API URL
    const account = connWithCreds.account.replace(/\.snowflakecomputing\.com\/?$/, '');
    const agentUrl = `https://${account}.snowflakecomputing.com/api/v2/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/agents/${encodeURIComponent(agentName)}:run`;

    // Build auth headers – supports PAT and key-pair, all server-side
    const sfHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };

    if (connWithCreds.auth_type === 'pat') {
      sfHeaders['Authorization'] = `Bearer ${connWithCreds.credentials.token}`;
      sfHeaders['X-Snowflake-Authorization-Token-Type'] = 'PROGRAMMATIC_ACCESS_TOKEN';
    } else {
      // Key-pair auth: generate a short-lived JWT signed with the user's private key
      const qualifiedAccount = account.toUpperCase();
      const qualifiedUser = connWithCreds.username.toUpperCase();

      // Decode private key and derive the public key fingerprint
      const privateKeyObj = crypto.createPrivateKey({
        key: connWithCreds.credentials.privateKey,
        format: 'pem',
        passphrase: connWithCreds.credentials.passphrase || undefined,
      });
      const publicKeyDer = crypto.createPublicKey(privateKeyObj)
        .export({ type: 'spki', format: 'der' });
      const fingerprint = crypto.createHash('sha256').update(publicKeyDer).digest('base64');

      const now = Math.floor(Date.now() / 1000);
      const keypairJwt = jwt.sign(
        {
          iss: `${qualifiedAccount}.${qualifiedUser}.SHA256:${fingerprint}`,
          sub: `${qualifiedAccount}.${qualifiedUser}`,
          iat: now,
          exp: now + 3600,
        },
        { key: connWithCreds.credentials.privateKey, passphrase: connWithCreds.credentials.passphrase || undefined },
        { algorithm: 'RS256' },
      );

      sfHeaders['Authorization'] = `Bearer ${keypairJwt}`;
      sfHeaders['X-Snowflake-Authorization-Token-Type'] = 'KEYPAIR_JWT';
    }

    // Use the dashboard's configured role (or the connection's default role)
    const effectiveRole = role || connWithCreds.default_role;
    if (effectiveRole) {
      sfHeaders['X-Snowflake-Role'] = effectiveRole;
    }

    // Build request body
    const agentBody = {
      messages,
      stream: true,
    };
    if (threadId != null) {
      agentBody.thread_id = threadId;
      agentBody.parent_message_id = parentMessageId ?? 0;
    }

    // Set up SSE headers for streaming to client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Proxy the request to Snowflake
    const sfResponse = await fetch(agentUrl, {
      method: 'POST',
      headers: sfHeaders,
      body: JSON.stringify(agentBody),
    });

    if (!sfResponse.ok) {
      const errText = await sfResponse.text();
      res.write(`event: error\ndata: ${JSON.stringify({ error: errText || `Snowflake returned ${sfResponse.status}` })}\n\n`);
      res.end();
      return;
    }

    // Pipe the SSE stream from Snowflake through to the client
    const reader = sfResponse.body.getReader();
    const decoder = new TextDecoder();

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      } catch (streamErr) {
        console.error('Cortex Agent stream error:', streamErr.message);
        res.write(`event: error\ndata: ${JSON.stringify({ error: streamErr.message })}\n\n`);
      } finally {
        res.end();
      }
    };

    // Handle client disconnect
    req.on('close', () => {
      try { reader.cancel(); } catch {}
    });

    await pump();
  } catch (error) {
    console.error('Cortex Agent run error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Cortex Agent run failed' });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

// ============================================================================
// CUSTOM COLUMNS
// ============================================================================

/**
 * POST /api/semantic/query-with-custom-columns
 * Execute a semantic view query with custom calculated columns
 */
semanticRoutes.post('/query-with-custom-columns', async (req, res) => {
  let tempConnection = null;
  
  try {
    const { 
      semanticView, 
      dimensions = [], 
      measures = [], 
      aggregatedFields = [],
      filters = [], 
      orderBy = [], 
      limit = 1000000,
      customColumns = [],
      connectionId,
      role,
      warehouse,
      forceRefresh = false
    } = req.body;

    let connection = req.snowflakeConnection;
    
    // If connectionId provided, use stored connection
    // Pass dashboard-specific role/warehouse to switch if needed
    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(
          connectionId, 
          req.user.id, 
          req.user.sessionId,
          { role, warehouse, forceRefresh }
        );
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({ 
          error: 'Failed to connect: ' + connError.message,
          code: 'CONNECTION_ERROR'
        });
      }
    }
    
    if (!connection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    if (!semanticView) {
      return res.status(400).json({ error: 'semanticView is required' });
    }

    // Scan calc field expressions for measure references not already in the
    // measures array. Without this, referenced measures end up in DIMENSIONS.
    let metadata;
    try {
      metadata = await getSemanticViewMetadata(connection, semanticView, tempConnection);
    } catch (e) {
      metadata = { measures: [], dimensions: [], facts: [] };
    }
    const isMetadataMeasure = (name) => {
      const upper = name.toUpperCase();
      return metadata.measures.some(m => m.toUpperCase() === upper);
    };
    const calcFieldNamesUpper = new Set(customColumns.map(cc => cc.name?.toUpperCase()));
    const measureNamesUpper = new Set(measures.map(m => (typeof m === 'object' ? m.name : m).toUpperCase()));
    const enrichedMeasures = [...measures];
    customColumns.forEach(cc => {
      if (!cc?.expression) return;
      const refs = extractFieldReferences(cc.expression);
      refs.forEach(ref => {
        const upper = ref.toUpperCase();
        if (calcFieldNamesUpper.has(upper)) return;
        if (measureNamesUpper.has(upper)) return;
        if (isMetadataMeasure(ref)) {
          measureNamesUpper.add(upper);
          enrichedMeasures.push({ name: ref, aggregation: 'SUM' });
        }
      });
    });

    // Separate aggregated dimensions from measure aggregations
    const cwcAggMap = new Map(aggregatedFields.map(af => [af.name.toUpperCase(), af.aggregation || null]));
    const cwcDimensionSet = new Set(dimensions.map(d => d.toUpperCase()));
    const cwcAggDims = [];
    cwcAggMap.forEach((agg, upperName) => {
      if (agg && cwcDimensionSet.has(upperName)) {
        cwcAggDims.push({ name: dimensions.find(d => d.toUpperCase() === upperName) || upperName, aggregation: agg });
      }
    });

    // Use the shared query builder - SINGLE SOURCE OF TRUTH
    const sql = buildQueryDirect({
      semanticViewFQN: semanticView,
      dimensions,
      measures: enrichedMeasures,
      aggregatedDimensions: cwcAggDims,
      filters,
      orderBy,
      customColumns,
      limit: Math.min(parseInt(limit) || DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_LIMIT),
    });

    console.log('Executing query with custom columns:', sql);

    const startTime = Date.now();
    // Use executeQuery for temp connections, executeUserQuery for session connections
    const result = tempConnection 
      ? (await executeQuery(tempConnection, sql)).rows
      : await executeUserQuery(connection, sql);
    const executionTime = Date.now() - startTime;

    res.json({
      data: result,
      rowCount: result.length,
      executionTime,
      query: sql.trim(),
    });
  } catch (error) {
    console.error('Query with custom columns error:', error);
    res.status(500).json({ error: error.message || 'Query failed' });
  }
  // Note: Don't destroy cached connections - they are reused
});
