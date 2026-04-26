/**
 * Simply Analytics - API Server
 * 
 * Production-ready Express server for the Simply Analytics platform.
 * Supports zero-config deployment with bootstrap admin login and admin panel provisioning.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

import { createRequire } from 'module';
import configStore from './config/configStore.js';
import { initHotReload } from './config/hotReload.js';

const _require = createRequire(import.meta.url);
const APP_VERSION = _require('../package.json').version;
import { bootstrapRoutes, setupAuthMiddleware } from './routes/bootstrap.js';
import { emergencyRoutes } from './routes/emergency.js';
import { ensureLatestSchema } from './db/schemaPatches.js';

const app = express();
const NODE_ENV = process.env.NODE_ENV || 'development';

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: NODE_ENV === 'production', crossOriginEmbedderPolicy: false }));

app.use(cors({
  origin: (_origin, cb) => {
    const raw = configStore.get('CORS_ORIGINS') || process.env.CORS_ORIGINS;
    const allowed = raw ? raw.split(',') : ['http://localhost:5173', 'http://localhost:3000'];
    cb(null, allowed);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => parseInt(configStore.get('RATE_LIMIT_MAX') || process.env.RATE_LIMIT_MAX || '1000', 10),
  message: { error: 'Too many requests' },
  skip: (req) => req.path === '/api/v1/health' || req.path.startsWith('/api/v1/setup'),
}));

app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ---------------------------------------------------------------------------
// Bootstrap & emergency auth (available before full setup)
// ---------------------------------------------------------------------------

app.use('/api/v1/auth', bootstrapRoutes);
app.use('/api/v1/auth', emergencyRoutes);

// ---------------------------------------------------------------------------
// Health & setup-status endpoints (always available)
// ---------------------------------------------------------------------------

app.get('/api/v1/health', async (_req, res) => {
  let activeSessions = 0;
  let pgOk = false;
  let redisOk = false;

  try {
    const authMod = await import('./middleware/auth.js');
    activeSessions = authMod.getActiveSessionCount();
  } catch (_) {}

  try {
    const { test: testDb } = await import('./db/db.js');
    pgOk = await testDb();
  } catch (_) {}

  try {
    const { isRedisActive } = await import('./db/redisSessionStore.js');
    redisOk = isRedisActive();
  } catch (_) {}

  const status = pgOk ? 'ok' : 'degraded';
  const httpCode = pgOk ? 200 : 503;
  res.status(httpCode).json({
    status,
    timestamp: new Date().toISOString(),
    activeSessions,
    appVersion: APP_VERSION,
    services: { postgres: pgOk, redis: redisOk },
  });
});

app.get('/api/v1/ready', (_req, res) => res.json({ ready: true }));
app.get('/api/v1/live', (_req, res) => res.json({ alive: true }));

app.get('/api/v1/password-policy', (_req, res) => {
  res.json(configStore.getPasswordPolicy());
});

app.get('/api/v1/setup/status', (_req, res) => {
  res.json({ configured: configStore.isConfigured() });
});

import('./routes/setup.js').then(({ setupRoutes }) => {
  app.use('/api/v1/setup', setupAuthMiddleware, setupRoutes);
});

// ---------------------------------------------------------------------------
// Normal-mode route mounting
// ---------------------------------------------------------------------------

let normalRoutesLoaded = false;

async function mountNormalRoutes() {
  if (normalRoutesLoaded) return;
  normalRoutesLoaded = true;

  const { queryRoutes } = await import('./routes/query.js');
  const { semanticRoutes } = await import('./routes/semantic/index.js');
  const { dashboardRoutes } = await import('./routes/dashboard.js');
  const { authRoutes } = await import('./routes/auth.js');
  const { twoFactorRoutes } = await import('./routes/twoFactor.js');
  const { userRoutes } = await import('./routes/users.js');
  const { connectionRoutes } = await import('./routes/connections.js');
  const folderRoutes = (await import('./routes/folders.js')).default;
  const samlRoutes = (await import('./routes/saml.js')).default;
  const scimRoutes = (await import('./routes/scim.js')).default;
  const { dashboardAiRoutes } = await import('./routes/dashboardAi.js');
  const { askRoutes, askPublicRoutes } = await import('./routes/ask.js');
  const { workspaceRoutes } = await import('./routes/workspaces.js');
  const { endpointRoutes, pipePublicRoutes, apiKeyRoutes } = await import('./routes/endpoints.js');

  // Initialize Redis and share the client with cache and rate-limit layers
  try {
    const redisMod = await import('./db/redisSessionStore.js');
    await redisMod.initRedis();
    const redisClient = redisMod.getRedisClient();
    if (redisClient) {
      const { attachRedis: attachCacheRedis } = await import('./services/responseCache.js');
      const { attachRedis: attachRlRedis } = await import('./middleware/pipeRateLimit.js');
      attachCacheRedis(redisClient);
      attachRlRedis(redisClient);
      console.log('[server] Redis shared with response cache and pipe rate limiter');
    }
  } catch (_) {}
  const { groupRoutes } = await import('./routes/groups.js');
  const { platformModelRoutes } = await import('./routes/platformModels.js');
  const { consumptionRoutes } = await import('./routes/consumption.js');

  const { authMiddleware, optionalAuthMiddleware } = await import('./middleware/auth.js');
  const { adminRoutes } = await import('./routes/admin.js');

  app.use('/api/v1/admin', authMiddleware, adminRoutes);
  app.use('/api/v1/platform', authMiddleware, platformModelRoutes);
  app.use('/api/v1/consumption', authMiddleware, consumptionRoutes);

  app.use('/api/v1/auth', optionalAuthMiddleware, authRoutes);
  app.use('/api/v1/2fa', optionalAuthMiddleware, twoFactorRoutes);
  app.use('/api/v1/saml', samlRoutes);
  app.use('/api/v1/ask/shared/dashboard', askPublicRoutes);
  app.use('/api/v1/pipe', pipePublicRoutes);
  app.use('/scim/v2', scimRoutes);

  app.use('/api/v1/workspaces', authMiddleware, workspaceRoutes);
  app.use('/api/v1/workspaces/:id/endpoints', authMiddleware, endpointRoutes);
  app.use('/api/v1/workspaces/:id/api-keys', authMiddleware, apiKeyRoutes);
  app.use('/api/v1/dashboard', authMiddleware, dashboardRoutes);
  app.use('/api/v1/semantic', authMiddleware, semanticRoutes);
  app.use('/api/v1/query', authMiddleware, queryRoutes);
  app.use('/api/v1/dashboard-ai', authMiddleware, dashboardAiRoutes);
  app.use('/api/v1/ask', authMiddleware, askRoutes);
  app.use('/api/v1/users', authMiddleware, userRoutes);
  app.use('/api/v1/connections', authMiddleware, connectionRoutes);
  app.use('/api/v1/folders', authMiddleware, folderRoutes);
  app.use('/api/v1/groups', authMiddleware, groupRoutes);

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1')) res.status(404).json({ error: 'Endpoint not found' });
    else next();
  });

  app.use((err, req, res, _next) => {
    console.error('Error:', err.message);
    res.status(err.status || 500).json({
      error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  });

  // Start automated backup scheduler
  try {
    const { scheduleBackups } = await import('./services/backupService.js');
    scheduleBackups();
  } catch (backupErr) {
    console.warn('[server] Could not start backup scheduler:', backupErr.message);
  }

  console.log('[server] Normal-mode routes mounted');
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function startServer() {
  const isConfigured = configStore.initialize();

  if (isConfigured) {
    try {
      const { validateKeyConfigured } = await import('./utils/encryption.js');
      validateKeyConfigured();
    } catch (err) {
      console.error('FATAL:', err.message);
      process.exit(1);
    }

    try {
      const { init: initDb, test: testDb, metadataBackend } = await import('./db/db.js');
      console.log(`Initializing ${metadataBackend} metadata backend...`);
      await initDb();
      const dbConnected = await testDb();
      if (dbConnected) {
        console.log(`${metadataBackend} metadata connection established`);

        try {
          const { query: dbQuery } = await import('./db/db.js');
          await ensureLatestSchema(dbQuery);
        } catch (schemaErr) {
          console.warn('Schema patch warning:', schemaErr.message);
        }

        try {
          const userService = (await import('./services/userService.js')).default;
          await userService.clearAllActiveSessions();
        } catch (sessionErr) {
          console.warn('Could not clear active sessions:', sessionErr.message);
        }
      } else {
        console.warn(`${metadataBackend} connection test failed - some features may not work`);
      }
    } catch (dbErr) {
      console.warn('Database connection failed:', dbErr.message);
      console.warn('App will start but metadata features require a database');
    }

    await mountNormalRoutes();
    initHotReload();
  } else {
    console.log('[server] Running in SETUP MODE — sign in with: admin / admin123');

    configStore.on('change', async () => {
      if (configStore.isConfigured() && !normalRoutesLoaded) {
        console.log('[server] Setup complete — loading normal-mode routes...');
        await new Promise(r => setTimeout(r, 500));

        try {
          const { init: initDb, test: testDb } = await import('./db/db.js');
          await initDb();
          const ok = await testDb();
          if (ok) {
            console.log('[server] Database connection verified after setup');
            try {
              const userService = (await import('./services/userService.js')).default;
              await userService.clearAllActiveSessions();
            } catch (_) {}
          }
        } catch (err) {
          console.warn('[server] DB init after setup:', err.message);
        }
        await mountNormalRoutes();
        initHotReload();
      }
    });
  }

  const PORT = configStore.get('PORT') || process.env.PORT || 3001;
  const server = app.listen(PORT, () => {
    console.log(`Simply Analytics API Server running on port ${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
    if (!isConfigured) {
      console.log(`Open the app and sign in with: admin / admin123`);
    }
  });

  server.setTimeout(120_000);

  process.on('SIGTERM', () => gracefulShutdown(server));
  process.on('SIGINT', () => gracefulShutdown(server));
}

async function gracefulShutdown(server) {
  console.log('[server] Graceful shutdown initiated...');
  server.close(async () => {
    try {
      const { close: closeDb } = await import('./db/db.js');
      await closeDb();
    } catch (_) {}
    try {
      const { closeRedis } = await import('./db/redisSessionStore.js');
      await closeRedis();
    } catch (_) {}
    console.log('[server] Cleanup complete, exiting');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

// ---------------------------------------------------------------------------
// Crash handlers — log and exit cleanly instead of silent death
// ---------------------------------------------------------------------------

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION — shutting down:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

startServer();

export default app;
