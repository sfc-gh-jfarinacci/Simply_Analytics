import { fetchApi } from './fetchCore.js';
import { API_BASE } from './fetchCore.js';

export const adminApi = {
  async getConfig() {
    const res = await fetchApi('/admin/config');
    return res.json();
  },

  async getConfigSection(section) {
    const res = await fetchApi(`/admin/config/${section}`);
    return res.json();
  },

  async updateConfigSection(section, values) {
    const res = await fetchApi(`/admin/config/${section}`, {
      method: 'PUT',
      body: JSON.stringify(values),
    });
    return res.json();
  },

  async testConnection(type, overrides = {}) {
    const res = await fetchApi('/admin/test-connection', {
      method: 'POST',
      body: JSON.stringify({ type, ...overrides }),
    });
    return res.json();
  },

  runMigrations(onMessage, onComplete, onError) {
    return new Promise((resolve) => {
      const token = sessionStorage.getItem('authToken');
      fetch(`${API_BASE}/admin/migrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      }).then((res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function read() {
          reader.read().then(({ done, value }) => {
            if (done) { resolve(); return; }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.type === 'log') onMessage?.(data.message);
                  else if (data.type === 'complete') onComplete?.(data);
                  else if (data.type === 'error') onError?.(data.message);
                } catch (_) {}
              }
            }
            read();
          });
        }
        read();
      }).catch((err) => {
        onError?.(err.message);
        resolve();
      });
    });
  },

  async rotateKey(keyType) {
    const res = await fetchApi(`/admin/rotate-key/${keyType}`, { method: 'POST' });
    return res.json();
  },

  async getSystemInfo() {
    const res = await fetchApi('/admin/system');
    return res.json();
  },

  // Postgres password rotation
  async rotatePgPassword(currentPassword, newPassword) {
    const res = await fetchApi('/admin/rotate-pg-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return res.json();
  },

  // Backup management
  async getBackups() {
    const res = await fetchApi('/admin/backups');
    return res.json();
  },

  async createBackup() {
    const res = await fetchApi('/admin/backups', { method: 'POST' });
    return res.json();
  },

  async downloadBackup(id) {
    const res = await fetchApi(`/admin/backups/${id}/download`);
    if (!res.ok) throw new Error('Download failed');
    return res.blob();
  },

  async deleteBackup(id) {
    const res = await fetchApi(`/admin/backups/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async restoreBackup(backupFile, recoveryKeyFile) {
    const formData = new FormData();
    formData.append('backup', backupFile);
    formData.append('recoveryKey', recoveryKeyFile);
    const token = sessionStorage.getItem('authToken');
    const res = await fetch(`${API_BASE}/admin/backups/restore`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    return res.json();
  },

  // Recovery key
  async downloadRecoveryKey() {
    const res = await fetchApi('/admin/recovery-key');
    if (!res.ok) throw new Error('Failed to download recovery key');
    return res.blob();
  },

  async rotateMasterKey() {
    const res = await fetchApi('/admin/rotate-master-key', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Rotation failed');
    }
    return res.blob();
  },
};
