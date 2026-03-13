import { Router } from 'express';
import { getConnection, executeQuery, getSampleData } from '../db/dashboardSessionManager.js';

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
    const result = await executeQuery(connection, sql, binds);
    const executionTime = Date.now() - startTime;

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

    // Build SQL from semantic model
    const sql = buildQueryFromModel({
      model,
      dimensions,
      measures,
      filters,
      orderBy,
      limit,
    });

    const startTime = Date.now();
    const result = await executeQuery(connection, sql);
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
 * Build SQL query from semantic model definition
 */
function buildQueryFromModel({ model, dimensions = [], measures = [], filters = [], orderBy = [], limit }) {
  const selectParts = [];
  const groupByParts = [];

  // Add dimensions
  dimensions.forEach((dim) => {
    const dimDef = model.dimensions.find((d) => d.name === dim);
    if (dimDef) {
      selectParts.push(`${dimDef.sql} AS "${dimDef.name}"`);
      groupByParts.push(dimDef.sql);
    }
  });

  // Add measures
  measures.forEach((measure) => {
    const measureDef = model.measures.find((m) => m.name === measure);
    if (measureDef) {
      selectParts.push(`${measureDef.sql} AS "${measureDef.name}"`);
    }
  });

  // Build WHERE clause
  let whereClause = '';
  if (filters.length > 0) {
    const filterConditions = filters.map((f) => {
      const field = model.dimensions.find((d) => d.name === f.field) ||
                   model.measures.find((m) => m.name === f.field);
      if (!field) return null;
      
      switch (f.operator) {
        case 'equals':
          return `${field.sql} = '${f.value}'`;
        case 'not_equals':
          return `${field.sql} != '${f.value}'`;
        case 'contains':
          return `${field.sql} LIKE '%${f.value}%'`;
        case 'greater_than':
          return `${field.sql} > ${f.value}`;
        case 'less_than':
          return `${field.sql} < ${f.value}`;
        case 'between':
          return `${field.sql} BETWEEN '${f.value[0]}' AND '${f.value[1]}'`;
        case 'in':
          return `${field.sql} IN (${f.value.map((v) => `'${v}'`).join(', ')})`;
        default:
          return null;
      }
    }).filter(Boolean);
    
    if (filterConditions.length > 0) {
      whereClause = `WHERE ${filterConditions.join(' AND ')}`;
    }
  }

  // Build ORDER BY clause
  let orderByClause = '';
  if (orderBy.length > 0) {
    orderByClause = `ORDER BY ${orderBy.map((o) => `"${o.field}" ${o.direction || 'ASC'}`).join(', ')}`;
  }

  // Build LIMIT clause
  const limitClause = limit ? `LIMIT ${limit}` : '';

  // Construct final SQL
  const sql = `
SELECT ${selectParts.join(', ')}
FROM ${model.table}
${whereClause}
${groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(', ')}` : ''}
${orderByClause}
${limitClause}
  `.trim();

  return sql;
}

