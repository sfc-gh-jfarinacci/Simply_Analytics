/**
 * Semantic Routes — barrel file
 *
 * Combines the sub-routers into a single `semanticRoutes` export so the
 * mount point in index.js (`app.use('/api/v1/semantic', semanticRoutes)`)
 * stays unchanged.
 */

import { Router } from 'express';
import { viewsRouter, browsingRouter } from './views.js';
import { queryRouter } from './query.js';
import { cortexRouter } from './cortex.js';

export const semanticRoutes = Router();

// View listing & detail: GET /views, GET /views/:db/:schema/:name
semanticRoutes.use('/views', viewsRouter);

// Database/schema browsing: GET /databases, GET /schemas/:database
semanticRoutes.use('/', browsingRouter);

// Query execution: POST /preview, /query, /distinct-values, /pivot, /query-with-custom-columns
semanticRoutes.use('/', queryRouter);

// Cortex AI: /cortex/complete, /cortex/ask, /cortex/insights, etc.
semanticRoutes.use('/cortex', cortexRouter);
