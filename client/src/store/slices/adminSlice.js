import { setupApi } from '../../api/modules/setupApi';
import { adminApi } from '../../api/modules/adminApi';
import { authApi } from '../../api/modules/authApi';

function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

export const createAdminSlice = (set, get) => ({
  // Setup / provisioning state
  setupProgress: null,
  setupMigrationLogs: [],
  setupMigrationResult: null,
  setupLoading: false,
  setupError: null,
  bundledPg: null,

  // Admin panel state
  adminConfig: null,
  adminSystemInfo: null,
  adminMigrationLogs: [],
  adminMigrationResult: null,
  adminLoading: false,
  adminError: null,

  // Backup state
  backups: [],
  backupStats: null,
  backupLoading: false,

  // Emergency mode DB status
  emergencyDbStatus: null,

  // Setup actions
  fetchSetupProgress: async () => {
    try {
      const progress = await setupApi.getProgress();
      set({ setupProgress: progress });
      return progress;
    } catch (err) {
      console.warn('Failed to fetch setup progress:', err.message);
      return null;
    }
  },

  detectBundledPg: async () => {
    try {
      const result = await setupApi.detectBundledPg();
      set({ bundledPg: result });
      return result;
    } catch (_) {
      return { detected: false };
    }
  },

  downloadRecoveryKey: async () => {
    try {
      const blob = await setupApi.downloadRecoveryKey();
      _triggerDownload(blob, 'simply-analytics-recovery.key');
      return true;
    } catch (err) {
      set({ setupError: err.message });
      return false;
    }
  },

  restoreFromBackup: async (backupFile, recoveryKeyFile) => {
    set({ setupLoading: true, setupError: null });
    try {
      const result = await setupApi.restore(backupFile, recoveryKeyFile);
      set({ setupLoading: false });
      if (result.success && result.blob) {
        _triggerDownload(result.blob, 'simply-analytics-recovery.key');
      }
      return result;
    } catch (err) {
      set({ setupLoading: false, setupError: err.message });
      return { error: err.message };
    }
  },

  testSetupDatabase: async (config) => {
    set({ setupLoading: true, setupError: null });
    try {
      const result = await setupApi.testDatabase(config);
      set({ setupLoading: false });
      return result;
    } catch (err) {
      set({ setupLoading: false, setupError: err.message });
      return { success: false, message: err.message };
    }
  },

  provisionDatabase: async (config) => {
    set({ setupLoading: true, setupError: null });
    try {
      const result = await setupApi.provisionDatabase(config);
      set({ setupLoading: false });
      return result;
    } catch (err) {
      set({ setupLoading: false, setupError: err.message });
      return { success: false, message: err.message };
    }
  },

  saveSetupConfig: async (config) => {
    set({ setupLoading: true, setupError: null });
    try {
      const result = await setupApi.saveConfig(config);
      set({ setupLoading: false });
      return result;
    } catch (err) {
      set({ setupLoading: false, setupError: err.message });
      return { success: false };
    }
  },

  runSetupMigrations: async () => {
    set({ setupMigrationLogs: [], setupMigrationResult: null, setupLoading: true });
    await setupApi.runMigrations(
      (msg) => set((s) => ({ setupMigrationLogs: [...s.setupMigrationLogs, msg] })),
      (result) => set({ setupMigrationResult: result, setupLoading: false }),
      (errMsg) => set({ setupError: errMsg, setupLoading: false }),
    );
  },

  createSetupOwner: async (data) => {
    set({ setupLoading: true, setupError: null });
    try {
      const result = await setupApi.createOwner(data);
      set({ setupLoading: false });
      return result;
    } catch (err) {
      set({ setupLoading: false, setupError: err.message });
      return { error: err.message };
    }
  },

  completeSetup: async () => {
    set({ setupLoading: true });
    try {
      await setupApi.complete();
      set({ setupLoading: false });
      return { success: true };
    } catch (err) {
      set({ setupLoading: false, setupError: err.message });
      return { success: false };
    }
  },

  // Admin actions
  loadAdminConfig: async () => {
    set({ adminLoading: true, adminError: null });
    try {
      const config = await adminApi.getConfig();
      set({ adminConfig: config, adminLoading: false });
      return config;
    } catch (err) {
      set({ adminLoading: false, adminError: err.message });
      return null;
    }
  },

  loadAdminConfigSection: async (section) => {
    try {
      return await adminApi.getConfigSection(section);
    } catch (err) {
      set({ adminError: err.message });
      return null;
    }
  },

  updateAdminConfig: async (section, values) => {
    set({ adminLoading: true, adminError: null });
    try {
      const result = await adminApi.updateConfigSection(section, values);
      set({ adminLoading: false });
      const config = await adminApi.getConfig();
      set({ adminConfig: config });
      return result;
    } catch (err) {
      set({ adminLoading: false, adminError: err.message });
      return { error: err.message };
    }
  },

  testAdminConnection: async (type, overrides) => {
    set({ adminLoading: true });
    try {
      const result = await adminApi.testConnection(type, overrides);
      set({ adminLoading: false });
      return result;
    } catch (err) {
      set({ adminLoading: false });
      return { success: false, message: err.message };
    }
  },

  runAdminMigrations: async () => {
    set({ adminMigrationLogs: [], adminMigrationResult: null, adminLoading: true });
    await adminApi.runMigrations(
      (msg) => set((s) => ({ adminMigrationLogs: [...s.adminMigrationLogs, msg] })),
      (result) => set({ adminMigrationResult: result, adminLoading: false }),
      (errMsg) => set({ adminError: errMsg, adminLoading: false }),
    );
  },

  rotateAdminKey: async (keyType) => {
    set({ adminLoading: true, adminError: null });
    try {
      const result = await adminApi.rotateKey(keyType);
      set({ adminLoading: false });
      const config = await adminApi.getConfig();
      set({ adminConfig: config });
      return result;
    } catch (err) {
      set({ adminLoading: false, adminError: err.message });
      return { error: err.message };
    }
  },

  loadSystemInfo: async () => {
    try {
      const info = await adminApi.getSystemInfo();
      set({ adminSystemInfo: info });
      return info;
    } catch (err) {
      set({ adminError: err.message });
      return null;
    }
  },

  // Postgres password rotation
  rotatePgPassword: async (currentPassword, newPassword) => {
    set({ adminLoading: true, adminError: null });
    try {
      const result = await adminApi.rotatePgPassword(currentPassword, newPassword);
      set({ adminLoading: false });
      return result;
    } catch (err) {
      set({ adminLoading: false, adminError: err.message });
      return { error: err.message };
    }
  },

  // Backup actions
  loadBackups: async () => {
    set({ backupLoading: true });
    try {
      const data = await adminApi.getBackups();
      set({ backups: data.backups || [], backupStats: data.stats || null, backupLoading: false });
      return data;
    } catch (err) {
      set({ backupLoading: false, adminError: err.message });
      return null;
    }
  },

  triggerBackup: async () => {
    set({ backupLoading: true });
    try {
      const result = await adminApi.createBackup();
      set({ backupLoading: false });
      if (result.success) {
        const data = await adminApi.getBackups();
        set({ backups: data.backups || [], backupStats: data.stats || null });
      }
      return result;
    } catch (err) {
      set({ backupLoading: false, adminError: err.message });
      return { error: err.message };
    }
  },

  downloadBackup: async (id, filename) => {
    try {
      const blob = await adminApi.downloadBackup(id);
      _triggerDownload(blob, filename || `simply-backup-${id}.tar.gz`);
      return true;
    } catch (err) {
      set({ adminError: err.message });
      return false;
    }
  },

  removeBackup: async (id) => {
    try {
      await adminApi.deleteBackup(id);
      const data = await adminApi.getBackups();
      set({ backups: data.backups || [], backupStats: data.stats || null });
      return true;
    } catch (err) {
      set({ adminError: err.message });
      return false;
    }
  },

  adminRestoreBackup: async (backupFile, recoveryKeyFile) => {
    set({ adminLoading: true, adminError: null });
    try {
      const result = await adminApi.restoreBackup(backupFile, recoveryKeyFile);
      set({ adminLoading: false });
      return result;
    } catch (err) {
      set({ adminLoading: false, adminError: err.message });
      return { error: err.message };
    }
  },

  // Recovery key and master key rotation
  adminDownloadRecoveryKey: async () => {
    try {
      const blob = await adminApi.downloadRecoveryKey();
      _triggerDownload(blob, 'simply-analytics-recovery.key');
      return true;
    } catch (err) {
      set({ adminError: err.message });
      return false;
    }
  },

  adminRotateMasterKey: async () => {
    set({ adminLoading: true, adminError: null });
    try {
      const blob = await adminApi.rotateMasterKey();
      _triggerDownload(blob, 'simply-analytics-recovery.key');
      set({ adminLoading: false });
      return { success: true };
    } catch (err) {
      set({ adminLoading: false, adminError: err.message });
      return { error: err.message };
    }
  },

  checkDbStatus: async () => {
    try {
      const status = await authApi.dbStatus();
      set({ emergencyDbStatus: status });
      return status;
    } catch (err) {
      set({ emergencyDbStatus: { dbReachable: false, userCount: 0, error: err.message } });
      return { dbReachable: false, userCount: 0 };
    }
  },

  emergencyCreateOwner: async (data) => {
    set({ adminLoading: true, adminError: null });
    try {
      const result = await authApi.emergencyCreateOwner(data);
      set({ adminLoading: false });
      return result;
    } catch (err) {
      set({ adminLoading: false, adminError: err.message });
      return { error: err.message };
    }
  },

  clearAdminError: () => set({ adminError: null }),
  clearSetupError: () => set({ setupError: null }),
});
