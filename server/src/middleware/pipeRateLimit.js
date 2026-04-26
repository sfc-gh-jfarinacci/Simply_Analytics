/**
 * Per-consumer rate limiter for pipe (API endpoint) routes.
 *
 * Keys on the API key token or share token so one consumer
 * cannot exhaust a workspace's capacity.
 *
 * Uses Redis (INCR + EXPIRE) when available, in-memory Map otherwise.
 */

const LIMIT = parseInt(process.env.PIPE_RATE_LIMIT_PER_KEY || '120', 10);
const WINDOW_MS = 60_000;

let redis = null;
let useRedis = false;
const REDIS_PREFIX = 'simply:pipe:rl:';

const memoryBuckets = new Map();

let sweepTimer = null;

export function attachRedis(redisClient) {
  if (redisClient) {
    redis = redisClient;
    useRedis = true;
  }
}

function extractKey(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7, 40);
  if (req.params.shareToken) return req.params.shareToken.slice(0, 32);
  return req.ip || 'unknown';
}

async function checkRedis(key) {
  const redisKey = `${REDIS_PREFIX}${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.pexpire(redisKey, WINDOW_MS);
  }
  const ttl = await redis.pttl(redisKey);
  return { count, ttlMs: ttl > 0 ? ttl : WINDOW_MS };
}

function checkMemory(key) {
  const now = Date.now();
  let bucket = memoryBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    memoryBuckets.set(key, bucket);
    ensureSweep();
  }

  bucket.count++;
  return { count: bucket.count, ttlMs: bucket.resetAt - now };
}

function ensureSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of memoryBuckets) {
      if (now > b.resetAt) memoryBuckets.delete(k);
    }
    if (memoryBuckets.size === 0) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, 30_000);
  sweepTimer.unref();
}

/**
 * Express middleware -- mount on pipePublicRoutes.
 */
export async function pipeRateLimiter(req, res, next) {
  try {
    const key = extractKey(req);
    let count, ttlMs;

    if (useRedis && redis) {
      try {
        ({ count, ttlMs } = await checkRedis(key));
      } catch {
        ({ count, ttlMs } = checkMemory(key));
      }
    } else {
      ({ count, ttlMs } = checkMemory(key));
    }

    res.setHeader('X-RateLimit-Limit', LIMIT);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, LIMIT - count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(ttlMs / 1000));

    if (count > LIMIT) {
      const retryAfter = Math.ceil(ttlMs / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter,
      });
    }

    next();
  } catch (err) {
    next();
  }
}

export default { attachRedis, pipeRateLimiter };
