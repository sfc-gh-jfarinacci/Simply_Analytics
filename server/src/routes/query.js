import { Router } from 'express';
import { getConnection, executeQuery, getSampleData } from '../db/dashboardSessionManager.js';
import { trackEvent } from '../services/eventTracker.js';

export const queryRoutes = Router();

// Execute raw SQL query
queryRoutes.post('/execute', async (req, res, next) => {
  try {
    const { connectionId, sql, binds } = req.body;

    const connection = getConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const startTime = Date.now();
    const result = await executeQuery(connection, sql, binds, { interactive: true });
    const executionTime = Date.now() - startTime;

    trackEvent('query.execute', {
      userId: req.user?.id,
      metadata: { executionTime, requestType: 'query' },
      ip: req.ip,
    });

    res.json({
      ...result,
      executionTime,
    });
  } catch (error) {
    next(error);
  }
});

// Get sample data from a table
queryRoutes.get('/sample/:connectionId/:database/:schema/:table', async (req, res, next) => {
  try {
    const connection = getConnection(req.params.connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const result = await getSampleData(
      connection,
      req.params.database,
      req.params.schema,
      req.params.table,
      limit
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Build and execute a query from semantic model
queryRoutes.post('/build', async (req, res, next) => {
  try {
    const { connectionId, model, dimensions, measures, filters, orderBy, limit } = req.body;

    const connection = getConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const { sql, binds: queryBinds } = buildQueryFromModel({
      model,
      dimensions,
      measures,
      filters,
      orderBy,
      limit,
    });

    const startTime = Date.now();
    const result = await executeQuery(connection, sql, queryBinds, { interactive: true });
    const executionTime = Date.now() - startTime;

    res.json({
      ...result,
      sql,
      executionTime,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Build SQL query from semantic model definition.
 * Returns { sql, binds } with parameterized filter values.
 */
function buildQueryFromModel({ model, dimensions = [], measures = [], filters = [], orderBy = [], limit }) {
  const selectParts = [];
  const groupByParts = [];
  const binds = [];

  dimensions.forEach((dim) => {
    const dimDef = model.dimensions.find((d) => d.name === dim);
    if (dimDef) {
      selectParts.push(`${dimDef.sql} AS "${dimDef.name}"`);
      groupByParts.push(dimDef.sql);
    }
  });

  measures.forEach((measure) => {
    const measureDef = model.measures.find((m) => m.name === measure);
    if (measureDef) {
      selectParts.push(`${measureDef.sql} AS "${measureDef.name}"`);
    }
  });

  let whereClause = '';
  if (filters.length > 0) {
    const filterConditions = filters.map((f) => {
      const field = model.dimensions.find((d) => d.name === f.field) ||
                   model.measures.find((m) => m.name === f.field);
      if (!field) return null;

      switch (f.operator) {
        case 'equals':
          binds.push(f.value);
          return `${field.sql} = ?`;
        case 'not_equals':
          binds.push(f.value);
          return `${field.sql} != ?`;
        case 'contains':
          binds.push(`%${f.value}%`);
          return `${field.sql} LIKE ?`;
        case 'greater_than':
          binds.push(Number(f.value));
          return `${field.sql} > ?`;
        case 'less_than':
          binds.push(Number(f.value));
          return `${field.sql} < ?`;
        case 'between': {
          binds.push(f.value[0], f.value[1]);
          return `${field.sql} BETWEEN ? AND ?`;
        }
        case 'in': {
          const placeholders = f.value.map((v) => { binds.push(v); return '?'; });
          return `${field.sql} IN (${placeholders.join(', ')})`;
        }
        default:
          return null;
      }
    }).filter(Boolean);

    if (filterConditions.length > 0) {
      whereClause = `WHERE ${filterConditions.join(' AND ')}`;
    }
  }

  const validDirections = new Set(['ASC', 'DESC']);
  let orderByClause = '';
  if (orderBy.length > 0) {
    orderByClause = `ORDER BY ${orderBy.map((o) => {
      const dir = validDirections.has((o.direction || '').toUpperCase()) ? o.direction.toUpperCase() : 'ASC';
      return `"${o.field}" ${dir}`;
    }).join(', ')}`;
  }

  const limitClause = limit ? `LIMIT ${parseInt(limit, 10) || 1000}` : '';

  const sql = `
SELECT ${selectParts.join(', ')}
FROM ${model.table}
${whereClause}
${groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(', ')}` : ''}
${orderByClause}
${limitClause}
  `.trim();

  return { sql, binds };
}

