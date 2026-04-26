import { fetchApi, safeJson } from './fetchCore.js';

export const workspaceApi = {
  async list() {
    const res = await fetchApi('/workspaces');
    return safeJson(res, { workspaces: [] });
  },

  async get(id) {
    const res = await fetchApi(`/workspaces/${id}`);
    return res.json();
  },

  async create(data) {
    const res = await fetchApi('/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to create workspace' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async update(id, data) {
    const res = await fetchApi(`/workspaces/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to update workspace' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async deletePreview(id) {
    const res = await fetchApi(`/workspaces/${id}/delete-preview`);
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to load delete preview' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async delete(id) {
    const res = await fetchApi(`/workspaces/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to delete workspace' });
      throw new Error(err.error);
    }
    return res.json();
  },

  // Members
  async getMembers(id) {
    const res = await fetchApi(`/workspaces/${id}/members`);
    return safeJson(res, { members: [] });
  },

  async addMember(id, userId) {
    const res = await fetchApi(`/workspaces/${id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to add member' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async removeMember(id, userId) {
    const res = await fetchApi(`/workspaces/${id}/members/${userId}`, {
      method: 'DELETE',
    });
    return safeJson(res, { success: false });
  },

  // Connections
  async getConnections(wsId) {
    const res = await fetchApi(`/workspaces/${wsId}/connections`);
    return safeJson(res, { connections: [] });
  },

  async addConnection(wsId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/connections`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to add connection' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async updateConnection(wsId, wcId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/connections/${wcId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to update connection' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async checkConnectionUsage(wsId, wcId) {
    const res = await fetchApi(`/workspaces/${wsId}/connections/${wcId}/usage`);
    return safeJson(res, { dashboardCount: 0, askConversationCount: 0 });
  },

  async removeConnection(wsId, wcId) {
    const res = await fetchApi(`/workspaces/${wsId}/connections/${wcId}`, { method: 'DELETE' });
    const data = await safeJson(res, { success: false });
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to remove connection');
      err.status = res.status;
      err.detail = data.detail;
      err.dashboards = data.dashboards;
      throw err;
    }
    return data;
  },

  // Semantic Views
  async addView(wsId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/views`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to add view' });
      const error = new Error(err.error);
      error.status = res.status;
      throw error;
    }
    return res.json();
  },

  async updateView(wsId, viewId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/views/${viewId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async removeView(wsId, viewId) {
    const res = await fetchApi(`/workspaces/${wsId}/views/${viewId}`, { method: 'DELETE' });
    return res.json();
  },

  // Endpoints (published query APIs)
  async listEndpoints(wsId) {
    const res = await fetchApi(`/workspaces/${wsId}/endpoints`);
    return safeJson(res, { endpoints: [] });
  },

  async validateEndpoint(wsId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/endpoints/validate`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    const result = await safeJson(res, { valid: false, error: 'Validation failed' });
    if (!res.ok && !result.error) {
      throw new Error('Validation failed');
    }
    return result;
  },

  async createEndpoint(wsId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/endpoints`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to create endpoint' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async getEndpoint(wsId, slug) {
    const res = await fetchApi(`/workspaces/${wsId}/endpoints/${slug}`);
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Endpoint not found' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async runEndpoint(wsId, slug, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `/workspaces/${wsId}/endpoints/${slug}/run${qs ? `?${qs}` : ''}`;
    const res = await fetchApi(url);
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Endpoint execution failed' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async updateEndpoint(wsId, slug, data) {
    const res = await fetchApi(`/workspaces/${wsId}/endpoints/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to update endpoint' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async deleteEndpoint(wsId, slug) {
    const res = await fetchApi(`/workspaces/${wsId}/endpoints/${slug}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to delete endpoint' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async regenerateEndpointToken(wsId, slug) {
    const res = await fetchApi(`/workspaces/${wsId}/endpoints/${slug}/regenerate-token`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to regenerate token' });
      throw new Error(err.error);
    }
    return res.json();
  },

  // API Keys
  async listApiKeys(wsId) {
    const res = await fetchApi(`/workspaces/${wsId}/api-keys`);
    return safeJson(res, { keys: [] });
  },

  async createApiKey(wsId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to create API key' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async revokeApiKey(wsId, keyId) {
    const res = await fetchApi(`/workspaces/${wsId}/api-keys/${keyId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to revoke API key' });
      throw new Error(err.error);
    }
    return res.json();
  },

  // AI Config
  async getAiConfig(wsId) {
    const res = await fetchApi(`/workspaces/${wsId}/ai-config`);
    return safeJson(res, { aiConfig: { provider: 'cortex', hasApiKey: false, defaultModel: null, endpointUrl: null } });
  },

  async updateAiConfig(wsId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/ai-config`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to update AI config' });
      throw new Error(err.error);
    }
    return res.json();
  },

  // Models
  async listModels(wsId) {
    const res = await fetchApi(`/workspaces/${wsId}/models`);
    return safeJson(res, { models: [] });
  },

  async addModel(wsId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/models`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to add model' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async updateModel(wsId, modelId, data) {
    const res = await fetchApi(`/workspaces/${wsId}/models/${modelId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to update model' });
      throw new Error(err.error);
    }
    return res.json();
  },

  async removeModel(wsId, modelId) {
    const res = await fetchApi(`/workspaces/${wsId}/models/${modelId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to remove model' });
      throw new Error(err.error);
    }
    return res.json();
  },

  // Platform models (available across all workspaces)
  async listPlatformModels() {
    const res = await fetchApi('/platform/models');
    return safeJson(res, { models: [] });
  },
};
