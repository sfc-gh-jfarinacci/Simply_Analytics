/**
 * Semantic Query routes — preview, query, distinct-values, pivot,
 * and query-with-custom-columns.
 */

import { Router } from 'express';
import {
  buildQueryDirect,
  extractFieldReferences,
  DEFAULT_QUERY_LIMIT,
} from '../../utils/queryBuilder.js';
import {
  debugLog,
  resolveConnection,
  getSnowflakeConnectionFromId,
  executeUserQuery,
  makeExecFn,
  getSemanticViewMetadata,
  buildWhereClause,
  sanitizeOperator,
  formatValue,
} from '../../services/semanticService.js';

export const queryRouter = Router();

// ---------------------------------------------------------------------------
// POST /preview
// ---------------------------------------------------------------------------

queryRouter.post('/preview', async (req, res, next) => {
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
      return res.json({ sql: '-- Select a data source to see SQL preview', dimensions: [], measures: [], valid: false });
    }

    let connection = req.snowflakeConnection;

    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(connectionId, req.user.id, req.user.sessionId, { role, warehouse });
        connection = tempConnection;
      } catch (connError) {
        return res.json({ sql: `-- Connection error: ${connError.message}`, dimensions: [], measures: [], valid: false });
      }
    }

    if (!connection) {
      return res.json({ sql: '-- Authentication required', dimensions: [], measures: [], valid: false });
    }

    let metadata;
    try {
      metadata = await getSemanticViewMetadata(connection, semanticView, tempConnection);
    } catch (metaError) {
      console.error('Failed to get metadata:', metaError.message);
      return res.json({ sql: `-- Failed to get semantic view metadata: ${metaError.message}`, dimensions: [], measures: [], valid: false });
    }

    const dimensions = [];
    const measures = [];
    const previewAggDims = [];
    const isMetadataMeasure = (fieldName) => metadata.measures.some(m => m.toUpperCase() === fieldName.toUpperCase());
    const isFieldCustomColumn = (fieldName) => customColumns.some(cc => cc.name?.toUpperCase() === fieldName?.toUpperCase());
    const measureSet = new Set();

    fields.forEach(field => {
      const name = field.name || field;
      if (!name) return;
      if (isFieldCustomColumn(name) || field.isCustomColumn) return;

      let isMeasure = field.semanticType
        ? field.semanticType === 'measure'
        : field.aggregation || isMetadataMeasure(name);

      if (isMeasure) {
        if (!measureSet.has(name)) {
          measureSet.add(name);
          const agg = field.aggregation ? field.aggregation.toUpperCase() : null;
          measures.push({ name, aggregation: (agg && agg !== 'NONE') ? agg : null });
        }
      } else {
        if (!dimensions.includes(name)) dimensions.push(name);
        const dimAgg = field.aggregation ? field.aggregation.toUpperCase() : null;
        if (dimAgg && dimAgg !== 'NONE' && !previewAggDims.some(ad => ad.name === name)) {
          previewAggDims.push({ name, aggregation: dimAgg });
        }
      }
    });

    const filters = inputFilters
      .map(f => ({ field: f.field, operator: f.operator, value: f.value, values: f.values, ...(f.customExpression ? { customExpression: f.customExpression } : {}) }))
      .filter(f => f.field && f.operator);

    const orderBy = inputSorts.map(s => ({ field: s.field, direction: s.direction || 'ASC' })).filter(s => s.field);

    // Ensure calc-field measure references are included
    const calcFieldNamesUpper = new Set(customColumns.map(cc => cc.name?.toUpperCase()));
    const measureNamesUpper = new Set([...measureSet].map(m => m.toUpperCase()));
    customColumns.forEach(cc => {
      if (!cc?.expression) return;
      extractFieldReferences(cc.expression).forEach(ref => {
        const upper = ref.toUpperCase();
        if (calcFieldNamesUpper.has(upper) || measureNamesUpper.has(upper)) return;
        if (isMetadataMeasure(ref)) {
          measureSet.add(ref);
          measureNamesUpper.add(upper);
          measures.push({ name: ref, aggregation: 'SUM' });
        }
      });
    });

    if (dimensions.length === 0 && measures.length === 0 && customColumns.length === 0) {
      return res.json({ sql: '-- Add fields to Columns or Rows to see SQL preview', dimensions: [], measures: [], valid: false });
    }

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

    const measureNames = measures.map(m => typeof m === 'object' ? m.name : m);

    debugLog('\n=== PREVIEW RESPONSE ===');
    debugLog('dimensions:', dimensions);
    debugLog('measures:', measureNames);
    debugLog('sql:', sql);
    debugLog('========================\n');

    res.json({ sql, dimensions, measures: measureNames, valid: true });
  } catch (error) {
    console.error('Preview error:', error.message);
    res.json({ sql: `-- Error: ${error.message}`, dimensions: [], measures: [], valid: false });
  }
});

// ---------------------------------------------------------------------------
// POST /query
// ---------------------------------------------------------------------------

queryRouter.post('/query', async (req, res, next) => {
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
      forceRefresh = false,
    } = req.body;

    let connection = req.snowflakeConnection;

    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(connectionId, req.user.id, req.user.sessionId, { role, warehouse, forceRefresh });
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({ error: 'Failed to connect: ' + connError.message, code: 'CONNECTION_ERROR' });
      }
    }

    if (!connection) {
      return res.status(401).json({ error: 'Authentication required to query semantic views', code: 'NO_CONNECTION' });
    }

    debugLog('\n=== SEMANTIC QUERY REQUEST ===');
    debugLog('semanticView:', semanticView);
    debugLog('dimensions:', JSON.stringify(dimensions));
    debugLog('measures:', JSON.stringify(measures));
    debugLog('aggregatedFields:', JSON.stringify(aggregatedFields));
    debugLog('filters:', JSON.stringify(filters, null, 2));
    debugLog('orderBy:', JSON.stringify(orderBy));
    debugLog('customColumns:', JSON.stringify(customColumns));
    debugLog('==============================\n');

    if (!semanticView) return res.status(400).json({ error: 'semanticView is required' });
    if (dimensions.length === 0 && measures.length === 0 && customColumns.length === 0) {
      return res.status(400).json({ error: 'At least one dimension, measure, or custom column is required' });
    }

    const aggMap = new Map(aggregatedFields.map(af => [af.name.toUpperCase(), af.aggregation || null]));
    const dimensionSet = new Set(dimensions.map(d => d.toUpperCase()));
    const aggregatedDimensions = [];
    aggMap.forEach((agg, upperName) => {
      if (agg && dimensionSet.has(upperName)) {
        aggregatedDimensions.push({ name: dimensions.find(d => d.toUpperCase() === upperName) || upperName, aggregation: agg });
      }
    });

    const enrichedMeasures = measures.map(m => {
      const name = typeof m === 'object' ? m.name : m;
      let agg = aggMap.get(name.toUpperCase()) ?? (typeof m === 'object' ? m.aggregation : undefined) ?? 'SUM';
      return { name, aggregation: (agg && agg !== 'NONE') ? agg : null };
    });

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

    debugLog('\n=== GENERATED SQL ===');
    debugLog(sql);
    debugLog('=====================\n');

    const startTime = Date.now();
    const execFn = makeExecFn(connection, tempConnection);
    const result = await execFn(sql);
    const executionTime = Date.now() - startTime;

    res.json({ data: result, rowCount: result.length, executionTime, query: sql.trim() });
  } catch (error) {
    console.error('Semantic query error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ error: error.message || 'Query execution failed', code: error.code || 'QUERY_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /distinct-values
// ---------------------------------------------------------------------------

queryRouter.post('/distinct-values', async (req, res, next) => {
  let tempConnection = null;

  try {
    const { semanticView, field, search = '', limit = 100, offset = 0, connectionId, role, warehouse } = req.body;

    let connection = req.snowflakeConnection;

    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(connectionId, req.user.id, req.user.sessionId, { role, warehouse });
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({ error: 'Failed to connect: ' + connError.message, code: 'CONNECTION_ERROR' });
      }
    }

    if (!connection) return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    if (!semanticView || !field) return res.status(400).json({ error: 'semanticView and field are required' });

    debugLog('\n=== DISTINCT VALUES REQUEST ===');
    debugLog('semanticView:', semanticView, 'field:', field, 'search:', search, 'limit:', limit, 'offset:', offset);

    let countSql = `SELECT COUNT(DISTINCT "${field}") AS CNT FROM SEMANTIC_VIEW(${semanticView} DIMENSIONS "${field}") WHERE "${field}" IS NOT NULL`;
    let valuesSql = `SELECT DISTINCT "${field}" AS VAL FROM SEMANTIC_VIEW(${semanticView} DIMENSIONS "${field}") WHERE "${field}" IS NOT NULL`;

    if (search) {
      const escaped = search.replace(/'/g, "''");
      const clause = ` AND CAST("${field}" AS VARCHAR) ILIKE '%${escaped}%'`;
      countSql += clause;
      valuesSql += clause;
    }
    valuesSql += ` ORDER BY "${field}" ASC LIMIT ${parseInt(limit) || 100}`;
    if (offset > 0) valuesSql += ` OFFSET ${parseInt(offset)}`;

    debugLog('Count SQL:', countSql.trim());
    debugLog('Values SQL:', valuesSql.trim());

    const execFn = makeExecFn(connection, tempConnection);
    const [countResult, valuesResult] = await Promise.all([execFn(countSql), execFn(valuesSql)]);

    const totalCount = countResult?.[0]?.CNT ?? countResult?.[0]?.cnt ?? 0;
    const values = valuesResult.map(row => row.VAL ?? row.val ?? row[field] ?? Object.values(row)[0]);
    const hasMore = (parseInt(offset) + values.length) < totalCount;

    debugLog('Returned', values.length, 'values, totalCount:', totalCount, 'hasMore:', hasMore);
    res.json({ values, totalCount, hasMore });
  } catch (error) {
    console.error('Distinct values error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch distinct values', code: 'QUERY_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /pivot
// ---------------------------------------------------------------------------

queryRouter.post('/pivot', async (req, res, next) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    const {
      semanticView, rowDimensions = [], pivotColumn, measures = [],
      aggregation = 'SUM', filters = [], limit = 1000000,
    } = req.body;

    if (!semanticView) return res.status(400).json({ error: 'semanticView is required' });
    if (!pivotColumn) return res.status(400).json({ error: 'pivotColumn is required for pivot queries' });
    if (measures.length === 0) return res.status(400).json({ error: 'At least one measure is required' });

    const validAggs = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'MEDIAN'];
    const aggFunc = validAggs.includes(aggregation.toUpperCase()) ? aggregation.toUpperCase() : 'SUM';

    debugLog('Pivot query request:', { semanticView, rowDimensions, pivotColumn, measures, aggregation: aggFunc, filters });

    const whereClause = buildWhereClause(filters);
    debugLog('Pivot WHERE clause:', whereClause);

    const filterFields = filters.map(f => f?.field).filter(Boolean);
    const allDims = [...new Set([...rowDimensions, pivotColumn, ...filterFields])];

    const distinctSql = `
      SELECT DISTINCT "${pivotColumn}"
      FROM SEMANTIC_VIEW(${semanticView} DIMENSIONS ${allDims.join(', ')})
      ${whereClause}
      ORDER BY "${pivotColumn}"
      LIMIT 50
    `;

    debugLog('Getting distinct pivot values:', distinctSql.trim());

    const distinctResult = await executeUserQuery(req.snowflakeConnection, distinctSql);
    const pivotValues = distinctResult
      .map(row => row[pivotColumn] || row[pivotColumn.toUpperCase()])
      .filter(v => v !== null && v !== undefined);

    if (pivotValues.length === 0) {
      return res.json({ data: [], rowCount: 0, pivotColumns: [], message: 'No pivot values found (filters may have excluded all values)' });
    }

    debugLog('Pivot values found:', pivotValues);

    const measure = measures[0];
    const pivotInClause = pivotValues.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
    const subqueryDims = [...new Set([...rowDimensions, pivotColumn, ...filterFields])].map(d => `"${d}"`).join(', ');

    const pivotSql = `
      SELECT * FROM (
        SELECT ${subqueryDims}, "${measure}"
        FROM SEMANTIC_VIEW(${semanticView} DIMENSIONS ${allDims.join(', ')} METRICS ${measure})
        ${whereClause}
      ) subq
      PIVOT (${aggFunc}("${measure}") FOR "${pivotColumn}" IN (${pivotInClause}))
      LIMIT ${Math.min(parseInt(limit) || 1000000, 1000000)}
    `;

    debugLog('Executing pivot query:', pivotSql.trim());

    const startTime = Date.now();
    const result = await executeUserQuery(req.snowflakeConnection, pivotSql);
    const executionTime = Date.now() - startTime;

    res.json({
      data: result, rowCount: result.length, pivotColumns: pivotValues,
      rowDimensions, measure, aggregation: aggFunc, executionTime, query: pivotSql.trim(),
    });
  } catch (error) {
    console.error('Pivot query error:', error.message);
    res.status(500).json({ error: error.message || 'Pivot query execution failed', code: error.code || 'PIVOT_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /query-with-custom-columns
// ---------------------------------------------------------------------------

queryRouter.post('/query-with-custom-columns', async (req, res) => {
  let tempConnection = null;

  try {
    const {
      semanticView, dimensions = [], measures = [], aggregatedFields = [],
      filters = [], orderBy = [], limit = 1000000, customColumns = [],
      connectionId, role, warehouse, forceRefresh = false,
    } = req.body;

    let connection = req.snowflakeConnection;

    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(connectionId, req.user.id, req.user.sessionId, { role, warehouse, forceRefresh });
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({ error: 'Failed to connect: ' + connError.message, code: 'CONNECTION_ERROR' });
      }
    }

    if (!connection) return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    if (!semanticView) return res.status(400).json({ error: 'semanticView is required' });

    let metadata;
    try {
      metadata = await getSemanticViewMetadata(connection, semanticView, tempConnection);
    } catch (e) {
      metadata = { measures: [], dimensions: [], facts: [] };
    }

    const isMetadataMeasure = (name) => metadata.measures.some(m => m.toUpperCase() === name.toUpperCase());
    const calcFieldNamesUpper = new Set(customColumns.map(cc => cc.name?.toUpperCase()));
    const measureNamesUpper = new Set(measures.map(m => (typeof m === 'object' ? m.name : m).toUpperCase()));
    const enrichedMeasures = [...measures];

    customColumns.forEach(cc => {
      if (!cc?.expression) return;
      extractFieldReferences(cc.expression).forEach(ref => {
        const upper = ref.toUpperCase();
        if (calcFieldNamesUpper.has(upper) || measureNamesUpper.has(upper)) return;
        if (isMetadataMeasure(ref)) {
          measureNamesUpper.add(upper);
          enrichedMeasures.push({ name: ref, aggregation: 'SUM' });
        }
      });
    });

    const cwcAggMap = new Map(aggregatedFields.map(af => [af.name.toUpperCase(), af.aggregation || null]));
    const cwcDimensionSet = new Set(dimensions.map(d => d.toUpperCase()));
    const cwcAggDims = [];
    cwcAggMap.forEach((agg, upperName) => {
      if (agg && cwcDimensionSet.has(upperName)) {
        cwcAggDims.push({ name: dimensions.find(d => d.toUpperCase() === upperName) || upperName, aggregation: agg });
      }
    });

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
    const execFn = makeExecFn(connection, tempConnection);
    const result = await execFn(sql);
    const executionTime = Date.now() - startTime;

    res.json({ data: result, rowCount: result.length, executionTime, query: sql.trim() });
  } catch (error) {
    console.error('Query with custom columns error:', error);
    res.status(500).json({ error: error.message || 'Query failed' });
  }
});
