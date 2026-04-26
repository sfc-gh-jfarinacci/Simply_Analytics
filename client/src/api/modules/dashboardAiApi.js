import { fetchApi, safeJson, getAuthToken, API_BASE } from './fetchCore.js';

export const dashboardAiApi = {
  async generate(params) {
    const res = await fetchApi('/dashboard-ai/generate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'AI dashboard generation failed' });
      throw new Error(data.error || 'AI dashboard generation failed');
    }
    return res.json();
  },

  async generateWidget(params) {
    const res = await fetchApi('/dashboard-ai/generate-widget', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'AI widget generation failed' });
      throw new Error(data.error || 'AI widget generation failed');
    }
    return res.json();
  },

  async modify(params) {
    const res = await fetchApi('/dashboard-ai/modify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'AI dashboard modification failed' });
      throw new Error(data.error || 'AI dashboard modification failed');
    }
    return res.json();
  },

  async explore(params) {
    const res = await fetchApi('/dashboard-ai/explore', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Explorer AI failed' });
      throw new Error(data.error || 'Explorer AI failed');
    }
    return res.json();
  },
};

export async function streamDashboardChat(params, onEvent, signal) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/dashboard-ai/chat`, {
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
