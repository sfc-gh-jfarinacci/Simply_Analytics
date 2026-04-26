import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import samlService from '../services/samlService.js';
import userService from '../services/userService.js';
import { getServerInstanceId, revokeSession } from './auth.js';
import configStore from '../config/configStore.js';
import { getJwtSecret, getJwtExpiry } from '../middleware/auth.js';

function getFrontendUrl() { return configStore.get('FRONTEND_URL') || process.env.FRONTEND_URL || 'http://localhost:5173'; }

export const samlRoutes = Router();

samlRoutes.get('/login', async (req, res) => {
  try {
    if (!samlService.isEnabled()) {
      return res.status(404).json({ error: 'SSO is not enabled' });
    }
    const url = await samlService.getLoginUrl(req.query.RelayState || '');
    res.redirect(url);
  } catch (err) {
    console.error('[SAML] Login redirect error:', err.message);
    res.status(500).json({ error: 'SSO login failed' });
  }
});

samlRoutes.post('/callback', async (req, res) => {
  try {
    if (!samlService.isEnabled()) {
      return res.status(404).json({ error: 'SSO is not enabled' });
    }

    const { user } = await samlService.validateCallback(req.body);

    if (!user.is_active) {
      return res.redirect(`${getFrontendUrl()}/login?error=account_disabled`);
    }

    const lockStatus = await userService.isAccountLocked(user.id);
    if (lockStatus.locked) {
      return res.redirect(`${getFrontendUrl()}/login?error=account_locked`);
    }

    const existingSessionId = await userService.getActiveSession(user.id);
    if (existingSessionId) {
      revokeSession(existingSessionId);
      await userService.clearActiveSession(user.id);
    }

    const sessionId = uuidv4();
    await userService.setActiveSession(user.id, sessionId, 8);

    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        authProvider: 'saml',
        sessionId,
        instanceId: getServerInstanceId(),
      },
      getJwtSecret(),
      { expiresIn: getJwtExpiry() }
    );

    const relayState = req.body.RelayState || '';
    const redirectPath = relayState || '/';
    res.redirect(`${getFrontendUrl()}${redirectPath}?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('[SAML] Callback error:', err.message);
    res.redirect(`${getFrontendUrl()}/login?error=sso_failed&message=${encodeURIComponent(err.message)}`);
  }
});

samlRoutes.get('/metadata', async (req, res) => {
  try {
    if (!samlService.isEnabled()) {
      return res.status(404).json({ error: 'SSO is not enabled' });
    }
    const metadata = await samlService.getMetadata();
    res.type('application/xml').send(metadata);
  } catch (err) {
    console.error('[SAML] Metadata error:', err.message);
    res.status(500).json({ error: 'Failed to generate metadata' });
  }
});

samlRoutes.get('/status', (req, res) => {
  res.json({
    enabled: samlService.isEnabled(),
    issuer: configStore.get('SAML_ISSUER') || 'simply-analytics',
    callbackUrl: configStore.get('SAML_CALLBACK_URL') || null,
  });
});

export default samlRoutes;
