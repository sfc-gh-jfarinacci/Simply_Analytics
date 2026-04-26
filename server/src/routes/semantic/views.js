/**
 * Semantic Views — browsing routes
 *
 * List semantic views, describe a view, list databases & schemas.
 */

import { Router } from 'express';
import { executeQuery } from '../../db/dashboardSessionManager.js';
import {
  executeUserQuery,
  getSnowflakeConnectionFromId,
} from '../../services/semanticService.js';

export const viewsRouter = Router();

/**
 * GET /
 * List all semantic views accessible by the current user's role
 * (mounted at /views so final path is /api/v1/semantic/views)
 */
viewsRouter.get('/', async (req, res, next) => {
  try {
    if (!req.snowflakeConnection) {
      return res.status(401).json({
        error: 'Authentication required to list semantic views',
        code: 'NO_CONNECTION',
      });
    }

    const views = await executeUserQuery(req.snowflakeConnection, 'SHOW SEMANTIC VIEWS;');

    res.json({
      views: views.map(row => ({
        name: row.name || row.NAME,
        database: row.database_name || row.DATABASE_NAME,
        schema: row.schema_name || row.SCHEMA_NAME,
        owner: row.owner || row.OWNER,
        comment: row.comment || row.COMMENT,
        createdOn: row.created_on || row.CREATED_ON,
      })),
    });
  } catch (error) {
    if (error.message?.includes('Unsupported')) {
      return res.json({ views: [], message: 'Semantic views not available in this Snowflake edition' });
    }
    next(error);
  }
});

/**
 * GET /views/:database/:schema/:name
 * Get details/metadata for a specific semantic view
 */
viewsRouter.get('/:database/:schema/:name', async (req, res, next) => {
  let tempConnection = null;

  try {
    const { connectionId, role, warehouse } = req.query;
    let connection = req.snowflakeConnection;

    if (connectionId && req.user) {
      try {
        tempConnection = await getSnowflakeConnectionFromId(
          connectionId, req.user.id, req.user.sessionId, { role, warehouse },
        );
        connection = tempConnection;
      } catch (connError) {
        return res.status(400).json({
          error: 'Failed to connect: ' + connError.message,
          code: 'CONNECTION_ERROR',
        });
      }
    }

    if (!connection) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_CONNECTION' });
    }

    const { database, schema, name } = req.params;
    const fullyQualifiedName = `"${database}"."${schema}"."${name}"`;
    const describeSql = `DESCRIBE SEMANTIC VIEW ${fullyQualifiedName}`;

    try {
      const description = tempConnection
        ? (await executeQuery(tempConnection, describeSql, [], { interactive: true })).rows
        : await executeUserQuery(connection, describeSql);

      res.json({ name, database, schema, fullyQualifiedName, columns: description });
    } catch (descError) {
      res.json({
        name, database, schema, fullyQualifiedName,
        columns: [],
        error: 'Could not describe semantic view: ' + descError.message,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Standalone browsing routes mounted at the semantic root level.
 * Exported separately so the barrel can mount them at '/' rather than '/views'.
 */
export const browsingRouter = Router();

/**
 * GET /databases
 * List databases accessible to the user
 */
browsingRouter.get('/databases', async (req, res, next) => {
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
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /schemas/:database
 * List schemas in a database
 */
browsingRouter.get('/schemas/:database', async (req, res, next) => {
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
      })),
    });
  } catch (error) {
    next(error);
  }
});
