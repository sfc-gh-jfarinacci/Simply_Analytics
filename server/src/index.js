/**
 * Simply Analytics - API Server
 * 
 * Production-ready Express server for the Simply Analytics platform.
 * 
 * Uses PostgreSQL for user management, connections, and dashboard storage.
 * Snowflake is used for semantic view queries and data analysis.
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

// Middleware
import { authMiddleware, optionalAuthMiddleware, getActiveSessionCount } from './middleware/auth.js';

// Database
import { testConnection as testPostgres } from './db/postgres.js';
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

// ============================================
// Protected routes (require authentication)
// ============================================

// Dashboard and semantic routes (Snowflake-based)
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
app.use('/api/semantic', authMiddleware, semanticRoutes);
app.use('/api/query', authMiddleware, queryRoutes);

// PostgreSQL-based routes
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
    // Test PostgreSQL connection
    console.log('Testing PostgreSQL connection...');
    const pgConnected = await testPostgres();
    if (pgConnected) {
      console.log('✅ PostgreSQL connected');
      
      // Clear all active sessions from database (server restart invalidates all sessions)
      // This ensures JWTs from before the restart are properly rejected
      try {
        await userService.clearAllActiveSessions();
      } catch (sessionErr) {
        console.warn('⚠️ Could not clear active sessions:', sessionErr.message);
      }
    } else {
      console.warn('⚠️ PostgreSQL connection failed - some features may not work');
    }
  } catch (error) {
    console.warn('⚠️ PostgreSQL initialization error:', error.message);
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
