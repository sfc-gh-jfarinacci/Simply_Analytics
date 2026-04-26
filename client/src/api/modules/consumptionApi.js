import { fetchApi } from './fetchCore.js';

function qs(params) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const consumptionApi = {
  async getOverview({ workspaceId, from, to } = {}) {
    const res = await fetchApi(`/consumption/overview${qs({ workspace_id: workspaceId, from, to })}`);
    if (!res.ok) throw new Error('Failed to load overview');
    return res.json();
  },

  async getAuthMetrics({ workspaceId, from, to, bucket } = {}) {
    const res = await fetchApi(`/consumption/auth-metrics${qs({ workspace_id: workspaceId, from, to, bucket })}`);
    if (!res.ok) throw new Error('Failed to load auth metrics');
    return res.json();
  },

  async getPopularDashboards({ workspaceId, from, to, limit } = {}) {
    const res = await fetchApi(`/consumption/popular-dashboards${qs({ workspace_id: workspaceId, from, to, limit })}`);
    if (!res.ok) throw new Error('Failed to load popular dashboards');
    return res.json();
  },

  async getRequestVolume({ workspaceId, from, to, bucket } = {}) {
    const res = await fetchApi(`/consumption/request-volume${qs({ workspace_id: workspaceId, from, to, bucket })}`);
    if (!res.ok) throw new Error('Failed to load request volume');
    return res.json();
  },

  async getActiveUsers({ workspaceId, from, to, bucket } = {}) {
    const res = await fetchApi(`/consumption/active-users${qs({ workspace_id: workspaceId, from, to, bucket })}`);
    if (!res.ok) throw new Error('Failed to load active users');
    return res.json();
  },
};
