/**
 * Semantic Service — shared helpers for semantic view routes
 *
 * Metadata caching/parsing, connection resolution, SQL utilities
 * (executeUserQuery, sanitizeOperator, formatValue, escapeString),
 * and date-part field helpers used by pivot queries.
 */

import { getCachedDashboardConnection, getConnectionWithCredentialsForDashboard } from './connectionService.js';
import { executeQuery } from '../db/dashboardSessionManager.js';

const DEBUG = process.env.SEMANTIC_DEBUG === 'true' || process.env.VERBOSE_LOGS === 'true';
export const debugLog = (...args) => DEBUG && console.log(...args);

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

export async function resolveConnWithCredsFromReq(req) {
  const connectionId = req.body?.connectionId || req.query?.connectionId;
  if (!connectionId) return null;
  try {
    return await getConnectionWithCredentialsForDashboard(connectionId);
  } catch { return null; }
}

export async function getSnowflakeConnectionFromId(connectionId, userId, sessionId, options = {}) {
  return getCachedDashboardConnection(connectionId, userId, sessionId, options);
}

/**
 * Resolve a temp connection from the request if connectionId is present.
 * Returns { connection, tempConnection } — caller should use `connection`
 * for queries and never destroy `tempConnection` (it's pooled).
 */
export async function resolveConnection(req, { role, warehouse, forceRefresh } = {}) {
  let connection = req.snowflakeConnection;
  let tempConnection = null;

  const connectionId = req.body?.connectionId || req.query?.connectionId;
  if (connectionId && req.user) {
    tempConnection = await getSnowflakeConnectionFromId(
      connectionId,
      req.user.id,
      req.user.sessionId,
      { role: role || req.body?.role, warehouse: warehouse || req.body?.warehouse, forceRefresh },
    );
    connection = tempConnection;
  }

  return { connection, tempConnection };
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

export function executeUserQuery(connection, sql, binds = []) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      binds,
      complete: (err, stmt, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      },
    });
  });
}

/**
 * Returns an async function that executes SQL using either a temp (pooled)
 * connection or the session connection — keeps route handlers DRY.
 */
export function makeExecFn(connection, tempConnection) {
  return tempConnection
    ? async (sql) => (await executeQuery(tempConnection, sql, [], { interactive: true })).rows
    : async (sql) => executeUserQuery(connection, sql);
}

// ---------------------------------------------------------------------------
// Metadata cache & parsing
// ---------------------------------------------------------------------------

const semanticViewMetadataCache = new Map();
const METADATA_CACHE_TTL = 5 * 60 * 1000;

export function parseSemanticViewMetadata(columns) {
  const dimensions = [];
  const measures = [];
  const facts = [];

  if (!columns || columns.length === 0) return { dimensions, measures, facts };

  const isSnowflakeFormat = columns[0]?.object_kind !== undefined;

  if (isSnowflakeFormat) {
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

    const stripPrefix = (name) => (name?.includes('.') ? name.split('.').pop() : name);

    objectMap.forEach((obj) => {
      const kind = (obj.kind || '').toUpperCase();
      const cleanName = stripPrefix(obj.name);
      const fieldObj = {
        name: cleanName,
        type: obj.properties.DATA_TYPE || 'VARCHAR',
        description: obj.properties.DESCRIPTION || '',
        parentEntity: obj.parentEntity,
      };

      if (kind === 'METRIC' || kind === 'MEASURE') measures.push(fieldObj.name);
      else if (kind === 'DIMENSION') dimensions.push(fieldObj.name);
      else if (kind === 'FACT') facts.push(fieldObj.name);
    });
  } else {
    columns.forEach(col => {
      const name = col.name || col.column_name;
      const kind = (col.semantic_type || col.kind || '').toUpperCase();

      if (kind === 'METRIC' || kind === 'MEASURE') measures.push(name);
      else if (kind === 'DIMENSION') dimensions.push(name);
      else if (kind === 'FACT') facts.push(name);
      else {
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

export async function getSemanticViewMetadata(connection, semanticViewFQN, tempConnection = null) {
  const cacheKey = semanticViewFQN.toUpperCase();
  const cached = semanticViewMetadataCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp < METADATA_CACHE_TTL)) {
    debugLog(`[getSemanticViewMetadata] Cache hit for ${semanticViewFQN}`);
    return cached.metadata;
  }

  debugLog(`[getSemanticViewMetadata] Fetching metadata for ${semanticViewFQN}`);
  const describeSql = `DESCRIBE SEMANTIC VIEW ${semanticViewFQN}`;

  const columns = tempConnection
    ? (await executeQuery(tempConnection, describeSql, [], { interactive: true })).rows
    : await executeUserQuery(connection, describeSql);

  const metadata = parseSemanticViewMetadata(columns);

  semanticViewMetadataCache.set(cacheKey, { metadata, timestamp: Date.now() });

  debugLog(`[getSemanticViewMetadata] Cached metadata:`, {
    dimensions: metadata.dimensions.length,
    measures: metadata.measures.length,
    facts: metadata.facts.length,
  });

  return metadata;
}

// ---------------------------------------------------------------------------
// SQL formatting / sanitization
// ---------------------------------------------------------------------------

export function sanitizeOperator(op) {
  const validOperators = [
    '=', '!=', '<>', '<', '>', '<=', '>=',
    'LIKE', 'ILIKE', 'NOT LIKE', 'NOT ILIKE',
    'IN', 'NOT IN', 'NOT_IN',
    'IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE',
    'BETWEEN',
    'STARTS_WITH', 'ENDS_WITH', 'NOT_LIKE',
    'CUSTOM',
  ];
  let upperOp = (op || '=').toUpperCase();
  if (upperOp === 'NOT_IN') upperOp = 'NOT IN';
  return validOperators.includes(upperOp) ? upperOp : '=';
}

export function escapeString(str) {
  return str.replace(/'/g, "''");
}

export function formatValue(value, operator) {
  const op = (operator || '').toUpperCase();

  if (op === 'IS NULL' || op === 'IS NOT NULL') return '';

  if (op === 'IN' || op === 'NOT IN') {
    if (Array.isArray(value)) {
      const formatted = value.map(v => typeof v === 'string' ? `'${escapeString(v)}'` : v);
      return `(${formatted.join(', ')})`;
    }
    return `('${escapeString(value)}')`;
  }

  if (typeof value === 'string') return `'${escapeString(value)}'`;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (value === null) return 'NULL';

  return `'${escapeString(String(value))}'`;
}

/**
 * Build a WHERE clause from an array of filter objects.
 * Re-usable across query, pivot, and distinct-values routes.
 */
export function buildWhereClause(filters) {
  if (!filters || filters.length === 0) return '';

  const whereClauses = filters.map(f => {
    if (!f || !f.field) return null;

    const field = `"${f.field}"`;
    const op = sanitizeOperator(f.operator);

    const val = f.value !== undefined ? f.value : f.values?.[0];
    const val2 = f.value2 !== undefined ? f.value2 : f.values?.[1];

    if ((op === 'IN' || (f.values && !['BETWEEN', 'LIKE', '=', 'NOT IN'].includes(op))) && Array.isArray(f.values) && f.values.length > 0) {
      const escapedValues = f.values.map(v => `'${String(v).replace(/'/g, "''")}'`);
      return `${field} IN (${escapedValues.join(', ')})`;
    }
    if (op === 'NOT IN' && Array.isArray(f.values) && f.values.length > 0) {
      const escapedValues = f.values.map(v => `'${String(v).replace(/'/g, "''")}'`);
      return `${field} NOT IN (${escapedValues.join(', ')})`;
    }
    if (op === 'IS NULL' || op === 'IS NOT NULL' || op === 'IS TRUE' || op === 'IS FALSE') {
      return `${field} ${op}`;
    }
    if (op === 'CUSTOM' && f.customExpression?.trim()) {
      let expr = f.customExpression.trim();
      expr = expr.replace(/\{\{([^}]+)\}\}/g, (_, fieldName) => `"${fieldName.trim()}"`);
      return expr;
    }
    if (op === 'BETWEEN' && val !== undefined && val2 !== undefined) {
      return `${field} BETWEEN ${formatValue(val, f.operator)} AND ${formatValue(val2, f.operator)}`;
    }
    if (op === 'LIKE' && val !== undefined) return `${field} ILIKE '%${String(val).replace(/'/g, "''")}%'`;
    if (op === 'STARTS_WITH' && val !== undefined) return `${field} ILIKE '${String(val).replace(/'/g, "''")}%'`;
    if (op === 'ENDS_WITH' && val !== undefined) return `${field} ILIKE '%${String(val).replace(/'/g, "''")}'`;
    if (op === 'NOT_LIKE' && val !== undefined) return `${field} NOT ILIKE '%${String(val).replace(/'/g, "''")}%'`;
    if (op === '=' && val !== undefined) return `${field} = ${formatValue(val, f.operator)}`;
    if (val !== undefined) return `${field} ${op} ${formatValue(val, f.operator)}`;

    return null;
  }).filter(Boolean);

  return whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
}

// ---------------------------------------------------------------------------
// Date-part field helpers (local versions for pivot queries)
// ---------------------------------------------------------------------------

const VALID_DATE_PARTS = ['YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'HOUR', 'MINUTE', 'DAYOFWEEK', 'DAYOFYEAR'];

export function parseDatePartFieldLocal(fieldName) {
  const match = fieldName.match(/^(.+)__(\w+)$/);
  if (match && VALID_DATE_PARTS.includes(match[2].toUpperCase())) {
    return { baseName: match[1], datePart: match[2].toUpperCase() };
  }
  return { baseName: fieldName, datePart: null };
}

export function isDatePartFieldLocal(fieldName) {
  return parseDatePartFieldLocal(fieldName).datePart !== null;
}

export function getBaseFieldNameLocal(fieldName) {
  return parseDatePartFieldLocal(fieldName).baseName;
}

export function transformDimensionToSql(fieldName) {
  const { baseName, datePart } = parseDatePartFieldLocal(fieldName);
  if (!datePart) return `"${baseName}"`;

  const fnMap = {
    YEAR: 'YEAR', QUARTER: 'QUARTER', MONTH: 'MONTH',
    WEEK: 'WEEKOFYEAR', DAY: 'DAY', HOUR: 'HOUR',
    MINUTE: 'MINUTE', DAYOFWEEK: 'DAYOFWEEK', DAYOFYEAR: 'DAYOFYEAR',
  };
  const fn = fnMap[datePart];
  return fn ? `${fn}("${baseName}")` : `DATE_PART('${datePart}', "${baseName}")`;
}

export function getDimensionAlias(fieldName) {
  const { baseName, datePart } = parseDatePartFieldLocal(fieldName);
  return datePart ? `${baseName}_${datePart}` : fieldName;
}
