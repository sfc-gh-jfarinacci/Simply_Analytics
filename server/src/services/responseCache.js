/**
 * Response Cache for API pipe endpoints.
 *
 * Stores serialized query results keyed on endpoint_id + sorted query params.
 * Uses Redis when available, falls back to an in-memory Map with TTL sweep.
 * Dashboard and SimplyAsk queries are NOT cached -- only pipe execution routes.
 */

import crypto from 'crypto';

const CACHE_TTL = parseInt(process.env.PIPE_CACHE_TTL_SECONDS || '60', 10);
const CACHE_PREFIX = 'simply:pipe:cache:';

let redis = null;
let useRedis = false;

const memoryCache = new Map();

let sweepTimer = null;

/**
 * Attach to an existing ioredis instance (called once at startup from index.js or redisSessionStore).
 */
export function attachRedis(redisClient) {
  if (redisClient) {
    redis = redisClient;
    useRedis = true;
  }
}

/**
 * Build a deterministic cache key from endpoint id and query params.
 */
export function buildKey(endpointId, queryParams) {
  const sorted = Object.keys(queryParams)
    .sort()
    .reduce((acc, k) => { acc[k] = queryParams[k]; return acc; }, {});
  const hash = crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  return `${CACHE_PREFIX}${endpointId}:${hash}`;
}

/**
 * Get a cached result. Returns parsed object or null.
 */
export async function get(key) {
  if (useRedis && redis) {
    try {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      // fall through to memory
    }
  }
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a result in the cache with TTL.
 */
export async function set(key, value) {
  if (useRedis && redis) {
    try {
      await redis.setex(key, CACHE_TTL, JSON.stringify(value));
      return;
    } catch {
      // fall through to memory
    }
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL * 1000 });
  ensureSweep();
}

/**
 * Invalidate all cache entries for a specific endpoint.
 */
export async function invalidateEndpoint(endpointId) {
  const prefix = `${CACHE_PREFIX}${endpointId}:`;

  if (useRedis && redis) {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');
    } catch {
      // ignore
    }
  }

  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

function ensureSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryCache) {
      if (now > entry.expiresAt) memoryCache.delete(key);
    }
    if (memoryCache.size === 0) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, 30_000);
  sweepTimer.unref();
}

export default { attachRedis, buildKey, get, set, invalidateEndpoint };
