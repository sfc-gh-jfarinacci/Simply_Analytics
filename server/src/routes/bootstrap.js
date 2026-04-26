/**
 * Bootstrap Auth Routes
 *
 * Hardcoded admin/admin123 credentials available before first-time setup.
 * Disabled once a real owner account is created via the setup wizard.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import configStore from '../config/configStore.js';
import { getMasterKeyHex } from '../config/configEncryption.js';
import crypto from 'crypto';

const BOOTSTRAP_USER = 'admin';
const BOOTSTRAP_PASS = 'admin123';

export function getBootstrapSecret() {
  return crypto.createHash('sha256').update('bootstrap:' + getMasterKeyHex()).digest('hex');
}

export function setupAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, getBootstrapSecret());
    if (decoded.role === 'bootstrap_admin') { req.user = decoded; return next(); }
  } catch (_) {}

  if (configStore.isConfigured()) return res.status(403).json({ error: 'Setup already complete' });
  return res.status(401).json({ error: 'Invalid or expired token' });
}

export const bootstrapRoutes = Router();

// Login
bootstrapRoutes.post('/login', (req, res, next) => {
  if (configStore.isConfigured()) return next();
  const { username, password } = req.body;
  if (username === BOOTSTRAP_USER && password === BOOTSTRAP_PASS) {
    const token = jwt.sign(
      { userId: 'bootstrap', username: BOOTSTRAP_USER, role: 'bootstrap_admin' },
      getBootstrapSecret(),
      { expiresIn: '4h' },
    );
    return res.json({
      success: true,
      user: { id: 'bootstrap', username: BOOTSTRAP_USER, email: '', role: 'bootstrap_admin' },
      token,
    });
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// Token validation
bootstrapRoutes.get('/validate', (req, res, next) => {
  if (configStore.isConfigured()) return next();
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ valid: false });
  try {
    const decoded = jwt.verify(token, getBootstrapSecret());
    return res.json({ valid: true, user: { id: decoded.userId, username: decoded.username, role: decoded.role } });
  } catch (_) {
    return res.json({ valid: false });
  }
});

// Logout (stateless JWT — no-op)
bootstrapRoutes.post('/logout', (req, res, next) => {
  if (configStore.isConfigured()) return next();
  return res.json({ success: true });
});

// Roles
bootstrapRoutes.get('/roles', (req, res, next) => {
  if (configStore.isConfigured()) return next();
  return res.json({ roles: ['bootstrap_admin'] });
});
