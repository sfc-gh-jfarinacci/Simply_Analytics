/**
 * Consumption Dashboard API — admin/owner only.
 *
 * All endpoints accept optional query params:
 *   workspace_id  — filter to a specific workspace (omit for all)
 *   from          — ISO start date  (default: 30 days ago)
 *   to            — ISO end date    (default: now)
 *   bucket        — 'day' | 'hour'  (default: 'day')
 */

import { Router } from 'express';
import consumptionService from '../services/consumptionService.js';

export const consumptionRoutes = Router();

function requireAdmin(req, res, next) {
  if (!req.user || !['owner', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or owner access required' });
  }
  next();
}

consumptionRoutes.use(requireAdmin);

function parseRange(req) {
  const now = new Date();
  const to = req.query.to ? new Date(req.query.to) : now;
  const from = req.query.from ? new Date(req.query.from) : new Date(now.getTime() - 30 * 86400000);
  const bucket = req.query.bucket === 'hour' ? 'hour' : 'day';
  const workspaceId = req.query.workspace_id || null;
  return { workspaceId, from, to, bucket };
}

consumptionRoutes.get('/overview', async (req, res) => {
  try {
    const { workspaceId, from, to } = parseRange(req);
    const data = await consumptionService.getOverviewStats(workspaceId, from, to);
    res.json(data);
  } catch (err) {
    console.error('[consumption] overview error:', err.message);
    res.status(500).json({ error: 'Failed to load overview stats' });
  }
});

consumptionRoutes.get('/auth-metrics', async (req, res) => {
  try {
    const { workspaceId, from, to, bucket } = parseRange(req);
    const data = await consumptionService.getAuthMetrics(workspaceId, from, to, bucket);
    res.json(data);
  } catch (err) {
    console.error('[consumption] auth-metrics error:', err.message);
    res.status(500).json({ error: 'Failed to load auth metrics' });
  }
});

consumptionRoutes.get('/popular-dashboards', async (req, res) => {
  try {
    const { workspaceId, from, to } = parseRange(req);
    const limit = parseInt(req.query.limit) || 10;
    const data = await consumptionService.getDashboardPopularity(workspaceId, from, to, limit);
    res.json(data);
  } catch (err) {
    console.error('[consumption] popular-dashboards error:', err.message);
    res.status(500).json({ error: 'Failed to load popular dashboards' });
  }
});

consumptionRoutes.get('/request-volume', async (req, res) => {
  try {
    const { workspaceId, from, to, bucket } = parseRange(req);
    const data = await consumptionService.getRequestVolume(workspaceId, from, to, bucket);
    res.json(data);
  } catch (err) {
    console.error('[consumption] request-volume error:', err.message);
    res.status(500).json({ error: 'Failed to load request volume' });
  }
});

consumptionRoutes.get('/active-users', async (req, res) => {
  try {
    const { workspaceId, from, to, bucket } = parseRange(req);
    const data = await consumptionService.getActiveUsers(workspaceId, from, to, bucket);
    res.json(data);
  } catch (err) {
    console.error('[consumption] active-users error:', err.message);
    res.status(500).json({ error: 'Failed to load active users' });
  }
});
