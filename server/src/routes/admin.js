import { Router } from 'express';
import os from 'os';
import configStore, { SECTION_KEYS } from '../config/configStore.js';

const router = Router();

/** Only the owner role may access admin routes. */
function ownerGuard(req, res, next) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}

router.use(ownerGuard);

// ---------------------------------------------------------------------------
// GET /api/v1/admin/config
// ---------------------------------------------------------------------------
router.get('/config', (_req, res) => {
  res.json(configStore.toSafeObject());
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/config/:section  (raw values for editing)
// ---------------------------------------------------------------------------
router.get('/config/:section', (req, res) => {
  const { section } = req.params;
  if (!SECTION_KEYS[section]) {
    return res.status(400).json({ error: `Unknown section: ${section}` });
  }
  res.json(configStore.getRawSection(section));
});

// ---------------------------------------------------------------------------
// PUT /api/v1/admin/config/:section
// ---------------------------------------------------------------------------
router.put('/config/:section', async (req, res) => {
  const { section } = req.params;
  if (!SECTION_KEYS[section]) {
    return res.status(400).json({ error: `Unknown section: ${section}` });
  }

  if (section === 'security' && req.body.PASSWORD_MIN_LENGTH !== undefined) {
    const len = parseInt(req.body.PASSWORD_MIN_LENGTH, 10);
    if (isNaN(len) || len < 8) {
      return res.status(400).json({ error: 'Password minimum length cannot be less than 8 characters' });
    }
    req.body.PASSWORD_MIN_LENGTH = String(len);
  }

  // For database section: verify connection works before persisting credential changes
  if (section === 'database') {
    const testUser = req.body.POSTGRES_USER || configStore.get('POSTGRES_USER');
    const testPass = (req.body.POSTGRES_PASSWORD && req.body.POSTGRES_PASSWORD !== '••••••••')
      ? req.body.POSTGRES_PASSWORD
      : configStore.get('POSTGRES_PASSWORD');

    const pg = await import('pg');
    const { Pool } = pg.default || pg;
    const pool = new Pool({
      host: configStore.get('POSTGRES_HOST'),
      port: parseInt(configStore.get('POSTGRES_PORT') || '5432'),
      database: configStore.get('POSTGRES_DB'),
      user: testUser,
      password: testPass,
      connectionTimeoutMillis: 5000,
    });

    try {
      const check = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') as ok`
      );
      await pool.end();
      if (!check.rows[0]?.ok) {
        return res.status(400).json({ error: 'Connection succeeded but required tables are not accessible with these credentials.' });
      }
    } catch (err) {
      try { await pool.end(); } catch (_) {}
      return res.status(400).json({ error: `Cannot connect with new credentials: ${err.message}. Config was NOT saved.` });
    }
  }

  try {
    const changedKeys = await configStore.update(section, req.body);
    res.json({ success: true, changedKeys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/test-connection
// ---------------------------------------------------------------------------
router.post('/test-connection', async (req, res) => {
  const { type } = req.body; // 'database' or 'redis'

  if (type === 'database') {
    const pg = await import('pg');
    const { Pool } = pg.default || pg;
    const pool = new Pool({
      host: req.body.host || configStore.get('POSTGRES_HOST'),
      port: parseInt(req.body.port || configStore.get('POSTGRES_PORT') || '5432'),
      database: req.body.database || configStore.get('POSTGRES_DB'),
      user: req.body.user || configStore.get('POSTGRES_USER'),
      password: req.body.password || configStore.get('POSTGRES_PASSWORD'),
      connectionTimeoutMillis: 5000,
    });

    try {
      const result = await pool.query('SELECT NOW() as now');
      await pool.end();
      return res.json({ success: true, message: `Connected at ${result.rows[0].now}` });
    } catch (err) {
      try { await pool.end(); } catch (_) {}
      return res.json({ success: false, message: err.message });
    }
  }

  if (type === 'redis') {
    const url = req.body.redisUrl || configStore.get('REDIS_URL') || 'redis://localhost:6379';
    let client;
    try {
      const Redis = (await import('ioredis')).default;
      client = new Redis(url, {
        maxRetriesPerRequest: 0,
        connectTimeout: 5000,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      client.on('error', () => {});
      await client.connect();
      await client.ping();
      await client.quit();
      return res.json({ success: true, message: 'Redis OK' });
    } catch (err) {
      if (client) {
        try { client.disconnect(false); } catch (_) {}
      }
      return res.json({ success: false, message: err.message });
    }
  }

  res.status(400).json({ error: 'type must be "database" or "redis"' });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/migrate  (SSE)
// ---------------------------------------------------------------------------
router.post('/migrate', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { runPostgresMigration } = await import('../services/migrationRunner.js');

    const result = await runPostgresMigration(
      {
        host: configStore.get('POSTGRES_HOST'),
        port: configStore.get('POSTGRES_PORT'),
        database: configStore.get('POSTGRES_DB'),
        user: configStore.get('POSTGRES_USER'),
        password: configStore.get('POSTGRES_PASSWORD'),
      },
      (msg) => send({ type: 'log', message: msg }),
      { skipAdminUser: true }
    );
    send({ type: 'complete', success: result.success, steps: result.steps, errors: result.errors });
  } catch (err) {
    send({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/rotate-pg-password
// ---------------------------------------------------------------------------
router.post('/rotate-pg-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const pg = await import('pg');
  const { Pool } = pg.default || pg;

  // Verify current password works
  const pool = new Pool({
    host: configStore.get('POSTGRES_HOST'),
    port: parseInt(configStore.get('POSTGRES_PORT') || '5432'),
    database: configStore.get('POSTGRES_DB'),
    user: configStore.get('POSTGRES_USER'),
    password: currentPassword,
    connectionTimeoutMillis: 5000,
  });

  try {
    await pool.query('SELECT NOW()');
  } catch (err) {
    try { await pool.end(); } catch (_) {}
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  try {
    const pgMod = pg.default || pg;
    const pgUser = configStore.get('POSTGRES_USER');
    await pool.query(`ALTER USER ${pgMod.escapeIdentifier(pgUser)} WITH PASSWORD ${pgMod.escapeLiteral(newPassword)}`);
    await pool.end();

    await configStore.update('database', { POSTGRES_PASSWORD: newPassword });
    res.json({ success: true, message: 'Database password updated successfully' });
  } catch (err) {
    try { await pool.end(); } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Backup management
// ---------------------------------------------------------------------------
router.get('/backups', async (_req, res) => {
  try {
    const { listBackups, getBackupStats } = await import('../services/backupService.js');
    res.json({ backups: listBackups(), stats: getBackupStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/backups', async (_req, res) => {
  try {
    const { createBackup } = await import('../services/backupService.js');
    const backup = await createBackup();
    res.json({ success: true, backup });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/backups/:id/download', async (req, res) => {
  try {
    const { getBackupPath } = await import('../services/backupService.js');
    const fs = await import('fs');
    const filePath = getBackupPath(req.params.id);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    const filename = filePath.split('/').pop();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/backups/:id', async (req, res) => {
  try {
    const { deleteBackup } = await import('../services/backupService.js');
    const ok = deleteBackup(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Backup not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/backups/restore', async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const upload = multer({ dest: '/tmp/simply-restore/', limits: { fileSize: 500 * 1024 * 1024 } }).fields([
      { name: 'backup', maxCount: 1 },
      { name: 'recoveryKey', maxCount: 1 },
    ]);

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });

      const backupFile = req.files?.backup?.[0];
      const keyFile = req.files?.recoveryKey?.[0];
      if (!backupFile || !keyFile) {
        return res.status(400).json({ error: 'Both backup archive and recovery key file are required' });
      }

      try {
        const { restoreFromBackup } = await import('../services/backupService.js');
        const fs = await import('fs');
        const recoveryKeyBuffer = fs.readFileSync(keyFile.path);
        const result = await restoreFromBackup(backupFile.path, recoveryKeyBuffer);

        try { fs.unlinkSync(backupFile.path); } catch (_) {}
        try { fs.unlinkSync(keyFile.path); } catch (_) {}

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }
        res.json({ success: true, message: 'Backup restored successfully' });
      } catch (restoreErr) {
        return res.status(500).json({ error: restoreErr.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Recovery key download and master key rotation
// ---------------------------------------------------------------------------
router.get('/recovery-key', (_req, res) => {
  try {
    const buf = configStore.getRecoveryKeyFile();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="simply-analytics-recovery.key"');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rotate-master-key', async (_req, res) => {
  try {
    const { oldKeyHex, newKeyHex, newRecoveryKeyBuffer } = configStore.rotateMasterKey();

    // Re-encrypt all existing backups with the new key
    try {
      const { reEncryptBackups } = await import('../services/backupService.js');
      await reEncryptBackups(oldKeyHex, newKeyHex);
    } catch (backupErr) {
      console.warn('[admin] Backup re-encryption warning:', backupErr.message);
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="simply-analytics-recovery.key"');
    res.send(newRecoveryKeyBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/rotate-key/:keyType
// ---------------------------------------------------------------------------
router.post('/rotate-key/:keyType', async (req, res) => {
  const { keyType } = req.params;
  const crypto = await import('crypto');

  if (keyType === 'jwt') {
    const newSecret = crypto.randomBytes(64).toString('hex');
    await configStore.update('security', { JWT_SECRET: newSecret });
    return res.json({ success: true, message: 'JWT secret rotated — all users will be signed out' });
  }

  if (keyType === 'encryption') {
    const oldKey = configStore.get('CREDENTIALS_ENCRYPTION_KEY');
    const newKeyHex = crypto.randomBytes(32).toString('hex');

    // Re-encrypt stored credentials with the new key
    try {
      const encMod = await import('../utils/encryption.js');
      const pg = await import('pg');
      const { Pool } = pg.default || pg;
      const pool = new Pool({
        host: configStore.get('POSTGRES_HOST'),
        port: parseInt(configStore.get('POSTGRES_PORT') || '5432'),
        database: configStore.get('POSTGRES_DB'),
        user: configStore.get('POSTGRES_USER'),
        password: configStore.get('POSTGRES_PASSWORD'),
      });

      const { rows } = await pool.query('SELECT id, credentials_encrypted FROM snowflake_connections WHERE credentials_encrypted IS NOT NULL');
      const oldKeyBuf = Buffer.from(oldKey, 'hex');
      const newKeyBuf = Buffer.from(newKeyHex, 'hex');

      let reEncrypted = 0;
      for (const row of rows) {
        try {
          const plain = encMod.decryptWithKey(row.credentials_encrypted, oldKeyBuf);
          const cipher = encMod.encryptWithKey(plain, newKeyBuf);
          await pool.query('UPDATE snowflake_connections SET credentials_encrypted = $1 WHERE id = $2', [cipher, row.id]);
          reEncrypted++;
        } catch (e) {
          console.error(`[admin] Re-encrypt failed for connection ${row.id}:`, e.message);
        }
      }
      await pool.end();

      await configStore.update('security', { CREDENTIALS_ENCRYPTION_KEY: newKeyHex });
      return res.json({ success: true, message: `Encryption key rotated — ${reEncrypted} credentials re-encrypted` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(400).json({ error: 'keyType must be "jwt" or "encryption"' });
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/system
// ---------------------------------------------------------------------------
router.get('/system', async (_req, res) => {
  const { getActiveSessionCount } = await import('../middleware/auth.js');

  res.json({
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    memoryUsage: process.memoryUsage(),
    metadataBackend: 'postgres',
    activeSessions: getActiveSessionCount(),
    sessionTimeoutMinutes: parseInt(configStore.get('SESSION_TIMEOUT_MINUTES') || '20', 10),
    serverTime: new Date().toISOString(),
  });
});


export const adminRoutes = router;
