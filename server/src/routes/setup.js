import { Router } from 'express';
import pg from 'pg';
import configStore from '../config/configStore.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/v1/setup/progress
// ---------------------------------------------------------------------------
router.get('/progress', async (_req, res) => {
  try {
    const progress = await configStore.getSetupProgress();
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/setup/recovery-key  (downloadable file)
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

// ---------------------------------------------------------------------------
// GET /api/v1/setup/detect-bundled-pg
// ---------------------------------------------------------------------------
router.get('/detect-bundled-pg', async (_req, res) => {
  const host = process.env.BUNDLED_PG_HOST;
  const port = process.env.BUNDLED_PG_PORT || '5432';
  const database = process.env.BUNDLED_PG_DB || 'simply_analytics';
  const user = process.env.BUNDLED_PG_USER || 'simply';

  if (!host) {
    return res.json({ detected: false });
  }

  const { Pool } = pg;
  const pool = new Pool({
    host, port: parseInt(port), database: 'postgres', user,
    password: 'simply_default_pw',
    connectionTimeoutMillis: 3000,
  });

  try {
    await pool.query('SELECT NOW()');
    await pool.end();
    return res.json({ detected: true, host, port, database, user });
  } catch (_) {
    try { await pool.end(); } catch (__) {}
    return res.json({ detected: false, host, port, database, user });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/setup/test-database  (for non-bundled / manual Postgres)
// ---------------------------------------------------------------------------
router.post('/test-database', async (req, res) => {
  const { host, port, database, user, password } = req.body;

  const { Pool } = pg;
  const targetDb = database || 'simply_analytics';

  const pool = new Pool({
    host: host || 'localhost',
    port: parseInt(port || '5432'),
    database: 'postgres',
    user, password,
    connectionTimeoutMillis: 5000,
  });

  try {
    await pool.query('SELECT NOW() as now');

    const dbCheck = await pool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]
    );
    await pool.end();

    const dbExists = dbCheck.rows.length > 0;
    const msg = dbExists
      ? `Connected. Database "${targetDb}" exists.`
      : `Connected. Database "${targetDb}" does not exist yet — it will be created during migrations.`;

    return res.json({ success: true, message: msg, databaseExists: dbExists });
  } catch (err) {
    try { await pool.end(); } catch (_) {}
    return res.json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/setup/provision-database
// For bundled Postgres: uses Docker default creds to create/replace the
// user-chosen credentials, ensure database + ownership, then invalidate the
// Docker default password so only the user's chosen creds work going forward.
// ---------------------------------------------------------------------------
router.post('/provision-database', async (req, res) => {
  const { host, port, database, user, password } = req.body;

  if (!user || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }

  const pgHost = host || process.env.BUNDLED_PG_HOST || 'postgres';
  const pgPort = parseInt(port || process.env.BUNDLED_PG_PORT || '5432');
  const targetDb = database || process.env.BUNDLED_PG_DB || 'simply_analytics';
  const defaultUser = process.env.BUNDLED_PG_USER || 'simply';
  const defaultPass = 'simply_default_pw';

  const { Pool } = pg;
  const esc = pg.escapeLiteral;
  const escId = pg.escapeIdentifier;

  // Try connecting with Docker default creds first. If that fails (already
  // provisioned once), try with the user's supplied creds in case they're
  // re-running the step.
  let adminPool;
  let connectedAs = 'default';

  adminPool = new Pool({
    host: pgHost, port: pgPort, database: 'postgres',
    user: defaultUser, password: defaultPass,
    connectionTimeoutMillis: 5000,
  });

  try {
    await adminPool.query('SELECT NOW()');
  } catch (_) {
    try { await adminPool.end(); } catch (__) {}
    // Default creds already invalidated — try user's creds
    adminPool = new Pool({
      host: pgHost, port: pgPort, database: 'postgres',
      user, password,
      connectionTimeoutMillis: 5000,
    });
    try {
      await adminPool.query('SELECT NOW()');
      connectedAs = 'user';
    } catch (err2) {
      try { await adminPool.end(); } catch (__) {}
      return res.json({ success: false, message: `Cannot connect to bundled Postgres: ${err2.message}` });
    }
  }

  try {
    if (connectedAs === 'default') {
      // First-time provisioning: set up credentials from scratch
      if (user === defaultUser) {
        // Same username as Docker default — just change the password and
        // ensure superuser so this role can handle all admin tasks
        await adminPool.query(`ALTER USER ${escId(defaultUser)} WITH PASSWORD ${esc(password)} SUPERUSER`);
      } else {
        // Different username — create new superuser role, transfer everything
        const userCheck = await adminPool.query(
          `SELECT 1 FROM pg_roles WHERE rolname = $1`, [user]
        );
        if (userCheck.rows.length === 0) {
          await adminPool.query(`CREATE USER ${escId(user)} WITH PASSWORD ${esc(password)} SUPERUSER CREATEDB`);
        } else {
          await adminPool.query(`ALTER USER ${escId(user)} WITH PASSWORD ${esc(password)} SUPERUSER CREATEDB`);
        }

        // Ensure target database exists and transfer ownership
        const dbCheck = await adminPool.query(
          `SELECT 1 FROM pg_database WHERE datname = $1`, [targetDb]
        );
        if (dbCheck.rows.length === 0) {
          await adminPool.query(`CREATE DATABASE ${escId(targetDb)} OWNER ${escId(user)}`);
        } else {
          await adminPool.query(`ALTER DATABASE ${escId(targetDb)} OWNER TO ${escId(user)}`);
        }
        await adminPool.query(`GRANT ALL PRIVILEGES ON DATABASE ${escId(targetDb)} TO ${escId(user)}`);

        // Disable the Docker default role entirely — NOLOGIN prevents any
        // future connections, making the user's chosen role the sole credential
        const crypto = await import('crypto');
        const randomPw = crypto.randomBytes(32).toString('hex');
        await adminPool.query(`ALTER USER ${escId(defaultUser)} WITH PASSWORD ${esc(randomPw)} NOLOGIN`);
      }
    } else {
      // Re-provisioning: user already owns the database, just update password
      await adminPool.query(`ALTER USER ${escId(user)} WITH PASSWORD ${esc(password)}`);
    }

    // Ensure target database exists (covers same-user case)
    if (connectedAs === 'default' && user === defaultUser) {
      const dbCheck = await adminPool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`, [targetDb]
      );
      if (dbCheck.rows.length === 0) {
        await adminPool.query(`CREATE DATABASE ${escId(targetDb)} OWNER ${escId(user)}`);
      }
    }

    await adminPool.end();

    // Verify the new credentials work against the target database
    const verifyPool = new Pool({
      host: pgHost, port: pgPort, database: targetDb,
      user, password,
      connectionTimeoutMillis: 5000,
    });

    try {
      await verifyPool.query('SELECT NOW()');
      await verifyPool.end();
    } catch (verifyErr) {
      try { await verifyPool.end(); } catch (_) {}
      return res.json({ success: false, message: `Credentials set but verification failed: ${verifyErr.message}` });
    }

    return res.json({ success: true, message: `Database "${targetDb}" ready. User "${user}" configured with full ownership.` });
  } catch (err) {
    try { await adminPool.end(); } catch (_) {}
    return res.json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/setup/test-redis
// ---------------------------------------------------------------------------
router.post('/test-redis', async (req, res) => {
  const { redisUrl, disable } = req.body;

  if (disable) {
    return res.json({ success: true, message: 'Redis disabled — using in-memory sessions' });
  }

  let client;
  try {
    const Redis = (await import('ioredis')).default;
    client = new Redis(redisUrl || 'redis://localhost:6379', {
      maxRetriesPerRequest: 0,
      connectTimeout: 5000,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    client.on('error', () => {});
    await client.connect();
    await client.ping();
    await client.quit();
    return res.json({ success: true, message: 'Redis connection OK' });
  } catch (err) {
    if (client) {
      try { client.disconnect(false); } catch (_) {}
    }
    return res.json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/setup/save-config
// ---------------------------------------------------------------------------
router.post('/save-config', async (req, res) => {
  try {
    const { config: values } = req.body;
    if (!values || typeof values !== 'object') {
      return res.status(400).json({ error: 'config object required' });
    }
    await configStore.saveInitialConfig(values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/setup/run-migrations  (SSE stream)
// ---------------------------------------------------------------------------
router.post('/run-migrations', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { runPostgresMigration } = await import('../services/migrationRunner.js');

    const dbConfig = {
      host: configStore.get('POSTGRES_HOST'),
      port: configStore.get('POSTGRES_PORT'),
      database: configStore.get('POSTGRES_DB'),
      user: configStore.get('POSTGRES_USER'),
      password: configStore.get('POSTGRES_PASSWORD'),
    };
    const result = await runPostgresMigration(dbConfig, (msg) => send({ type: 'log', message: msg }), { skipAdminUser: true });

    send({ type: 'complete', success: result.success, steps: result.steps, errors: result.errors });
  } catch (err) {
    send({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/setup/create-owner
// ---------------------------------------------------------------------------
router.post('/create-owner', async (req, res) => {
  const { username, email, password, displayName } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  const { validatePasswordStrength } = await import('../services/userService.js');
  const passwordErrors = validatePasswordStrength(password);
  if (passwordErrors.length > 0) {
    return res.status(400).json({ error: `Password must have: ${passwordErrors.join(', ')}` });
  }

  try {
    const { Pool } = pg;
    const pool = new Pool({
      host: configStore.get('POSTGRES_HOST'),
      port: parseInt(configStore.get('POSTGRES_PORT') || '5432'),
      database: configStore.get('POSTGRES_DB'),
      user: configStore.get('POSTGRES_USER'),
      password: configStore.get('POSTGRES_PASSWORD'),
    });

    try {
      const { createOwnerAccount } = await import('../services/migrationRunner.js');
      const owner = await createOwnerAccount(pool, { username, email, password, displayName });
      await pool.end();
      return res.json({ success: true, user: owner });
    } catch (err) {
      await pool.end();
      return res.status(400).json({ error: err.message });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/setup/restore  (multipart: backup archive + recovery key)
// ---------------------------------------------------------------------------
router.post('/restore', async (req, res) => {
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

        // Clean up temp files
        try { fs.unlinkSync(backupFile.path); } catch (_) {}
        try { fs.unlinkSync(keyFile.path); } catch (_) {}

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        configStore.markConfigured();

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="simply-analytics-recovery.key"');
        res.send(result.newRecoveryKeyBuffer);
      } catch (restoreErr) {
        return res.status(500).json({ error: restoreErr.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/setup/complete
// ---------------------------------------------------------------------------
router.post('/complete', async (req, res) => {
  try {
    configStore.markConfigured();
    res.json({ success: true, message: 'Setup complete — app is ready' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export const setupRoutes = router;
