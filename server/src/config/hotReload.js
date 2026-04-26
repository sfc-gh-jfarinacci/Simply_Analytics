import configStore from './configStore.js';

let _initialized = false;

/**
 * Subscribe to ConfigStore changes and hot-reload affected services.
 * Call once after the server has started.
 */
export function initHotReload() {
  if (_initialized) return;
  _initialized = true;

  configStore.on('change', async ({ section, changedKeys }) => {
    console.log(`[hot-reload] Config section "${section}" changed:`, changedKeys);

    try {
      switch (section) {
        case 'database':
          await reloadDatabase(changedKeys);
          break;
        case 'redis':
          await reloadRedis(changedKeys);
          break;
        case 'security':
          await reloadSecurity(changedKeys);
          break;
        case 'server':
          reloadServer(changedKeys);
          break;
        case 'sso':
        case 'scim':
          console.log(`[hot-reload] ${section} config updated — changes take effect on next request`);
          break;
      }
    } catch (err) {
      console.error(`[hot-reload] Error reloading ${section}:`, err.message);
    }
  });

  console.log('[hot-reload] Listening for config changes');
}

// ---------------------------------------------------------------------------
// Section reloaders
// ---------------------------------------------------------------------------

async function reloadDatabase(changedKeys) {
  const pgKeys = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'];

  if (changedKeys.some(k => pgKeys.includes(k))) {
    console.log('[hot-reload] Reconnecting PostgreSQL pool...');
    try {
      const pgMod = await import('../db/postgresBackend.js');
      if (typeof pgMod.reconnectPool === 'function') {
        await pgMod.reconnectPool();
        console.log('[hot-reload] PostgreSQL pool reconnected');
      } else {
        console.warn('[hot-reload] postgresBackend.reconnectPool not available — restart may be needed');
      }
    } catch (err) {
      console.error('[hot-reload] PostgreSQL reconnect failed:', err.message);
    }
  }
}

async function reloadRedis(changedKeys) {
  if (changedKeys.some(k => ['REDIS_URL', 'DISABLE_REDIS'].includes(k))) {
    console.log('[hot-reload] Reconnecting Redis...');
    try {
      const redisMod = await import('../db/redisSessionStore.js');
      if (typeof redisMod.closeRedis === 'function') {
        await redisMod.closeRedis();
      }
      if (configStore.get('DISABLE_REDIS') !== 'true') {
        await redisMod.initRedis();
        console.log('[hot-reload] Redis reconnected');
      } else {
        console.log('[hot-reload] Redis disabled — using in-memory sessions');
      }
    } catch (err) {
      console.error('[hot-reload] Redis reconnect failed:', err.message);
    }
  }
}

async function reloadSecurity(changedKeys) {
  if (changedKeys.includes('JWT_SECRET')) {
    console.log('[hot-reload] JWT secret rotated — existing tokens are now invalid');
  }

  if (changedKeys.includes('CREDENTIALS_ENCRYPTION_KEY')) {
    console.log('[hot-reload] Encryption key updated — cache cleared');
    try {
      const encMod = await import('../utils/encryption.js');
      if (typeof encMod.clearKeyCache === 'function') {
        encMod.clearKeyCache();
      }
    } catch (_) {}
  }
}

function reloadServer(changedKeys) {
  if (changedKeys.includes('CORS_ORIGINS')) {
    console.log('[hot-reload] CORS origins updated — changes apply on next request');
  }
  if (changedKeys.includes('RATE_LIMIT_MAX')) {
    console.log('[hot-reload] Rate limit updated — changes apply on next window');
  }
}
