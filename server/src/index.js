/**
 * Simply Analytics - API Server
 * 
 * Production-ready Express server for the Simply Analytics platform.
 * 
 * Uses Snowflake for all data storage including user management,
 * connections, dashboard storage, and data analysis queries.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Route imports
import { queryRoutes } from './routes/query.js';
import { semanticRoutes } from './routes/semantic.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { authRoutes } from './routes/auth.js';
import { twoFactorRoutes } from './routes/twoFactor.js';
import { userRoutes } from './routes/users.js';
import { connectionRoutes } from './routes/connections.js';
import { groupRoutes } from './routes/groups.js';
import folderRoutes from './routes/folders.js';
import samlRoutes from './routes/saml.js';
import scimRoutes from './routes/scim.js';

// Middleware
import { authMiddleware, optionalAuthMiddleware, getActiveSessionCount } from './middleware/auth.js';

// Database
import { init as initDb, test as testDb, metadataBackend } from './db/db.js';
import { validateKeyConfigured } from './utils/encryption.js';
import userService from './services/userService.js';

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security
app.use(helmet({ contentSecurityPolicy: NODE_ENV === 'production', crossOriginEmbedderPolicy: false }));

const corsOptions = {
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
};
app.use(cors(corsOptions));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
  message: { error: 'Too many requests' },
  skip: (req) => req.path === '/api/health',
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Health endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), activeSessions: getActiveSessionCount() });
});

app.get('/api/ready', (req, res) => res.json({ ready: true }));
app.get('/api/live', (req, res) => res.json({ alive: true }));

// ============================================
// Public routes (no auth required)
// ============================================

// Auth routes - handle login/logout
app.use('/api/auth', optionalAuthMiddleware, authRoutes);

// 2FA routes - some require auth, some are for login flow
app.use('/api/2fa', optionalAuthMiddleware, twoFactorRoutes);

// SSO SAML routes (no auth middleware - IdP handles authentication)
app.use('/api/saml', samlRoutes);

// SCIM 2.0 provisioning (bearer token auth handled by scim middleware)
app.use('/scim/v2', scimRoutes);

// ============================================
// Protected routes (require authentication)
// ============================================

// Dashboard and semantic routes (Snowflake-based)
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
app.use('/api/semantic', authMiddleware, semanticRoutes);
app.use('/api/query', authMiddleware, queryRoutes);

// App metadata routes
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/connections', authMiddleware, connectionRoutes);
app.use('/api/groups', authMiddleware, groupRoutes);
app.use('/api/folders', authMiddleware, folderRoutes);

// Error handling
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) res.status(404).json({ error: 'Endpoint not found' });
  else next();
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// Initialize database connections and start server
async function startServer() {
  try {
    validateKeyConfigured();
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }

  try {
    console.log(`Initializing ${metadataBackend} metadata backend...`);
    try {
      await initDb();
      const dbConnected = await testDb();
      if (dbConnected) {
        console.log(`${metadataBackend} metadata connection established`);
        try {
          await userService.clearAllActiveSessions();
        } catch (sessionErr) {
          console.warn('Could not clear active sessions:', sessionErr.message);
        }
      } else {
        console.warn(`${metadataBackend} connection test failed - some features may not work`);
      }
    } catch (dbErr) {
      console.warn(`${metadataBackend} connection failed:`, dbErr.message);
      console.warn('App will start but metadata features require a database');
    }
  } catch (error) {
    console.warn('Initialization error:', error.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`Simply Analytics API Server running on port ${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

startServer();

export default app;
