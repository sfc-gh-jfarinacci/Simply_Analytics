import { fetchApi, getAuthToken, API_BASE } from './fetchCore.js';

export const askApi = {
  // ── Conversations ───────────────────────────────────────

  listConversations: async (workspaceId, mode = 'semantic') => {
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspaceId', workspaceId);
    params.set('mode', mode);
    const res = await fetchApi(`/ask/conversations?${params}`);
    return res.json();
  },

  createConversation: async ({ connectionId, title }) => {
    const res = await fetchApi('/ask/conversations', {
      method: 'POST',
      body: JSON.stringify({ connectionId, title }),
    });
    return res.json();
  },

  getConversation: async (id) => {
    const res = await fetchApi(`/ask/conversations/${id}`);
    return res.json();
  },

  deleteConversation: async (id) => {
    const res = await fetchApi(`/ask/conversations/${id}`, { method: 'DELETE' });
    return res.json();
  },

  updateConversation: async (id, data) => {
    const res = await fetchApi(`/ask/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return res.json();
  },

  saveDashboard: async ({ title, yaml, connectionId }) => {
    const res = await fetchApi('/ask/dashboards', {
      method: 'POST',
      body: JSON.stringify({ title, yaml, connectionId }),
    });
    return res.json();
  },

  listDashboards: async () => {
    const res = await fetchApi('/ask/dashboards');
    return res.json();
  },

  getSharedDashboard: async (token) => {
    const res = await fetch(`${API_BASE}/ask/shared/dashboard/${token}`);
    return res.json();
  },
};

export async function streamAskChat(params, onEvent, signal) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/ask/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(params),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Request failed: ${res.status}` }));
    throw new Error(err.error || 'Chat request failed');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = 'message';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent(currentEvent, data);
        } catch {
          onEvent(currentEvent, line.slice(6));
        }
      } else if (line === '') {
        currentEvent = 'message';
      }
    }
  }
}
