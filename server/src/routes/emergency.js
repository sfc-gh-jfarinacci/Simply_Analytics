/**
 * Emergency Auth Routes
 *
 * When the DB is unreachable, lets the owner authenticate using their
 * master encryption key (saved during initial setup). No database
 * access is needed for the login itself. Additional endpoints check
 * DB status and allow creating/resetting the owner account once the
 * DB comes back online.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import configStore from '../config/configStore.js';

export const emergencyRoutes = Router();

function requireEmergencyJwt(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, configStore.get('JWT_SECRET'));
    if (decoded.emergencyMode) { req.user = decoded; return next(); }
  } catch (_) {}
  return res.status(403).json({ error: 'Emergency authentication required' });
}

// Emergency login via master key
emergencyRoutes.post('/emergency-login', (req, res) => {
  if (!configStore.isConfigured()) {
    return res.status(400).json({ success: false, error: 'App is not configured yet' });
  }

  const { masterKey } = req.body;
  if (!masterKey) return res.status(400).json({ success: false, error: 'Master encryption key is required' });
  if (!configStore.verifyMasterKey(masterKey)) {
    return res.status(401).json({ success: false, error: 'Invalid master key' });
  }

  const jwtSecret = configStore.get('JWT_SECRET');
  if (!jwtSecret) return res.status(500).json({ success: false, error: 'JWT secret not configured' });

  const token = jwt.sign(
    { userId: 'emergency', username: 'owner', role: 'owner', emergencyMode: true },
    jwtSecret,
    { expiresIn: '2h' },
  );

  console.warn('[emergency-login] Owner authenticated via master key (database may be unreachable)');

  res.json({
    success: true, token,
    user: { id: 'emergency', username: 'owner', role: 'owner' },
    emergencyMode: true,
  });
});

// DB health check (requires emergency JWT)
emergencyRoutes.get('/db-status', requireEmergencyJwt, async (_req, res) => {
  const pg = await import('pg');
  const pool = new pg.default.Pool({
    host: configStore.get('POSTGRES_HOST'),
    port: parseInt(configStore.get('POSTGRES_PORT') || '5432'),
    database: configStore.get('POSTGRES_DB'),
    user: configStore.get('POSTGRES_USER'),
    password: configStore.get('POSTGRES_PASSWORD'),
    connectionTimeoutMillis: 5000,
  });

  try {
    await pool.query('SELECT 1');
    try {
      const userCount = await pool.query('SELECT COUNT(*)::int AS count FROM users');
      const ownerRow = await pool.query(`SELECT id, username, email FROM users WHERE role = 'owner' LIMIT 1`);
      res.json({ dbReachable: true, userCount: userCount.rows[0].count, tablesExist: true, owner: ownerRow.rows[0] || null });
    } catch (_) {
      res.json({ dbReachable: true, userCount: 0, tablesExist: false, owner: null });
    }
  } catch (err) {
    res.json({ dbReachable: false, userCount: 0, tablesExist: false, owner: null, error: err.message });
  } finally {
    await pool.end().catch(() => {});
  }
});

// Create or reset owner account (requires emergency JWT + working DB)
emergencyRoutes.post('/emergency-create-owner', requireEmergencyJwt, async (req, res) => {
  const { username, email, password, displayName } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }

  const { validatePasswordStrength } = await import('../services/userService.js');
  const pwErrors = validatePasswordStrength(password);
  if (pwErrors.length > 0) {
    return res.status(400).json({ error: `Password must have: ${pwErrors.join(', ')}` });
  }

  const pg = await import('pg');
  const pool = new pg.default.Pool({
    host: configStore.get('POSTGRES_HOST'),
    port: parseInt(configStore.get('POSTGRES_PORT') || '5432'),
    database: configStore.get('POSTGRES_DB'),
    user: configStore.get('POSTGRES_USER'),
    password: configStore.get('POSTGRES_PASSWORD'),
  });

  try {
    const { runPostgresMigration, createOwnerAccount } = await import('../services/migrationRunner.js');
    const bcrypt = await import('bcryptjs');

    const tableCheck = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') AS exists`,
    );
    if (!tableCheck.rows[0].exists) {
      const dbConfig = {
        host: configStore.get('POSTGRES_HOST'),
        port: configStore.get('POSTGRES_PORT') || '5432',
        database: configStore.get('POSTGRES_DB'),
        user: configStore.get('POSTGRES_USER'),
        password: configStore.get('POSTGRES_PASSWORD'),
      };
      const migResult = await runPostgresMigration(dbConfig, console.log, { skipAdminUser: true });
      if (!migResult.success) {
        return res.status(500).json({ error: 'Failed to create database tables' });
      }
    }

    const existingOwner = await pool.query(`SELECT id FROM users WHERE role = 'owner' LIMIT 1`);

    if (existingOwner.rows.length > 0) {
      const passwordHash = await bcrypt.default.hash(password, 10);
      const updated = await pool.query(
        `UPDATE users SET username = $1, email = $2, password_hash = $3, display_name = $4,
         account_locked = false, account_locked_reason = NULL, failed_login_attempts = 0,
         is_active = true
         WHERE id = $5
         RETURNING id, username, email, display_name, role`,
        [username, email, passwordHash, displayName || username, existingOwner.rows[0].id],
      );
      return res.json({ success: true, user: updated.rows[0], action: 'reset' });
    }

    const owner = await createOwnerAccount(pool, { username, email, password, displayName });
    res.json({ success: true, user: owner, action: 'created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await pool.end().catch(() => {});
  }
});
