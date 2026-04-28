import { fetchApi, safeJson } from './fetchCore.js';

export const sfConnectionApi = {
  async getAll() {
    const res = await fetchApi('/connections');
    return safeJson(res, { connections: [] });
  },

  async getById(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}`);
    return safeJson(res, { connection: null });
  },

  async create(connectionData) {
    const res = await fetchApi('/connections', {
      method: 'POST',
      body: JSON.stringify(connectionData),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to create connection' });
      throw new Error(error.error);
    }
    return safeJson(res, { connection: null });
  },

  async update(connectionId, updates) {
    const res = await fetchApi(`/connections/${connectionId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update connection' });
      throw new Error(error.error);
    }
    return safeJson(res, { connection: null });
  },

  async delete(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to delete connection' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async test(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}/test`, {
      method: 'POST',
    });
    return safeJson(res, { success: false, error: 'Test failed' });
  },

  async getResources(connectionId, role = null) {
    const params = role ? `?role=${encodeURIComponent(role)}` : '';
    const res = await fetchApi(`/connections/${connectionId}/resources${params}`);
    return safeJson(res, { roles: [], warehouses: [], semanticViews: [] });
  },

  async testRaw({ account, username, authType, credentials }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const res = await fetchApi('/connections/test-raw', {
        method: 'POST',
        body: JSON.stringify({ account, username, authType, credentials }),
        signal: controller.signal,
      });
      return safeJson(res, { success: false, error: 'Connection test failed' });
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, error: 'Connection timed out. Check your account identifier and credentials.' };
      }
      return { success: false, error: err.message };
    } finally {
      clearTimeout(timeout);
    }
  },

  async openConfigSession(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}/config-session`, { method: 'POST' });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to open config session' });
      throw new Error(err.error);
    }
    return safeJson(res, { roles: [] });
  },

  async configSessionWarehouses(connectionId, role) {
    const res = await fetchApi(`/connections/${connectionId}/config-session/warehouses`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const err = await safeJson(res, { error: 'Failed to load warehouses' });
      throw new Error(err.error);
    }
    return safeJson(res, { warehouses: [] });
  },

  async closeConfigSession(connectionId) {
    await fetchApi(`/connections/${connectionId}/config-session`, { method: 'DELETE' }).catch(() => {});
  },

  /**
   * Force refresh/clear a cached Snowflake connection
   * Use when IP changes (VPN) or connection becomes stale
   */
  async refresh(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}/refresh`, {
      method: 'POST',
    });
    return safeJson(res, { success: false });
  },

  /**
   * Clear ALL cached Snowflake connections for the current session
   */
  async clearAllConnections() {
    const res = await fetchApi('/connections/clear-all', {
      method: 'POST',
    });
    return safeJson(res, { success: false });
  },

};
