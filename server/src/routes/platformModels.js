/**
 * Platform Model Admin Routes
 *
 * These routes are platform-admin-only. They manage the model catalog
 * and cross-cloud endpoint registry. Regular users never see these —
 * they just pick from the dropdown and the router handles the rest.
 */

import { Router } from 'express';
import platformModelService from '../services/platformModelService.js';

export const platformModelRoutes = Router();

function requirePlatformAdmin(req, res, next) {
  if (req.user?.role !== 'owner' && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Platform admin access required' });
  }
  next();
}

// ── Public: list available models (any authenticated user) ───

platformModelRoutes.get('/models', async (req, res) => {
  try {
    const models = await platformModelService.listPlatformModels({ enabledOnly: true });
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

platformModelRoutes.get('/models/:modelId/availability', async (req, res) => {
  try {
    const availability = await platformModelService.getModelAvailability(req.params.modelId);
    res.json({ modelId: req.params.modelId, endpoints: availability });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: model catalog CRUD ────────────────────────────────

platformModelRoutes.get('/admin/models', requirePlatformAdmin, async (req, res) => {
  try {
    const models = await platformModelService.listPlatformModels({ enabledOnly: false });
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

platformModelRoutes.put('/admin/models/:modelId', requirePlatformAdmin, async (req, res) => {
  try {
    const { displayName, vendor, category, contextWindow, isEnabled } = req.body;
    if (!displayName || !vendor) {
      return res.status(400).json({ error: 'displayName and vendor are required' });
    }
    const model = await platformModelService.upsertPlatformModel({
      id: req.params.modelId,
      displayName, vendor, category, contextWindow, isEnabled,
    });
    res.json({ model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

platformModelRoutes.delete('/admin/models/:modelId', requirePlatformAdmin, async (req, res) => {
  try {
    await platformModelService.deletePlatformModel(req.params.modelId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: endpoint registry CRUD ────────────────────────────

platformModelRoutes.get('/admin/endpoints', requirePlatformAdmin, async (req, res) => {
  try {
    const modelId = req.query.modelId || null;
    const endpoints = await platformModelService.listEndpoints(modelId);
    res.json({ endpoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

platformModelRoutes.post('/admin/endpoints', requirePlatformAdmin, async (req, res) => {
  try {
    const { modelId, provider, cloud, region, endpointConfig, priority, costPer1kTokens } = req.body;
    if (!modelId || !provider || !cloud || !region) {
      return res.status(400).json({ error: 'modelId, provider, cloud, and region are required' });
    }
    const endpoint = await platformModelService.addEndpoint({
      modelId, provider, cloud, region, endpointConfig, priority, costPer1kTokens,
    });
    res.json({ endpoint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

platformModelRoutes.patch('/admin/endpoints/:endpointId', requirePlatformAdmin, async (req, res) => {
  try {
    const endpoint = await platformModelService.updateEndpoint(req.params.endpointId, req.body);
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });
    res.json({ endpoint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

platformModelRoutes.delete('/admin/endpoints/:endpointId', requirePlatformAdmin, async (req, res) => {
  try {
    await platformModelService.removeEndpoint(req.params.endpointId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
