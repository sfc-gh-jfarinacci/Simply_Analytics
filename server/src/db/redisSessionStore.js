/**
 * Redis Session Store
 * 
 * Provides distributed session storage for multi-instance deployments.
 * Falls back to in-memory storage if Redis is not available.
 */

import Redis from 'ioredis';

// Session TTL in seconds (8 hours default)
const SESSION_TTL = parseInt(process.env.SESSION_TTL_SECONDS || '28800', 10);

// Redis configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_PREFIX = process.env.REDIS_SESSION_PREFIX || 'simply:session:';

let redis = null;
let useRedis = false;

// In-memory fallback for development/testing
const memoryStore = new Map();

/**
 * Initialize Redis connection
 */
export async function initRedis() {
  if (process.env.DISABLE_REDIS === 'true') {
    console.log('📦 Redis disabled, using in-memory session store');
    return false;
  }

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        // Don't retry - fail fast if Redis isn't available
        if (times > 1) {
          return null; // Stop retrying
        }
        return 100; // Try once after 100ms
      },
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5000, // 5 second timeout
    });

    let errorLogged = false;

    // Set up event handlers (only log once)
    redis.on('connect', () => {
      console.log('🔌 Connected to Redis');
    });

    redis.on('ready', () => {
      console.log('✅ Redis ready for session storage');
      useRedis = true;
    });

    redis.on('error', (err) => {
      // Only log meaningful errors once, and only if we were trying to use Redis
      if (!errorLogged && err.message && useRedis) {
        console.error('❌ Redis error:', err.message);
        errorLogged = true;
      }
      // Fall back to memory store on error
      useRedis = false;
    });

    redis.on('close', () => {
      if (useRedis) {
        // Only log if we were previously connected
        console.log('🔒 Redis connection closed');
      }
      useRedis = false;
    });

    redis.on('end', () => {
      // Connection ended, clean up
      useRedis = false;
      redis = null;
    });

    // Try to connect with a timeout
    await Promise.race([
      redis.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      )
    ]);
    
    // Test connection
    await redis.ping();
    useRedis = true;
    console.log('✅ Redis session store initialized');
    return true;

  } catch (error) {
    console.log('📦 Redis not available, using in-memory session store');
    useRedis = false;
    
    // Clean up the failed connection to stop retry attempts
    if (redis) {
      redis.disconnect();
      redis = null;
    }
    
    return false;
  }
}

/**
 * Serialize session data for Redis storage
 * Note: We can't store the Snowflake connection object directly,
 * so we store connection metadata and recreate if needed
 */
function serializeSession(session) {
  return JSON.stringify({
    userContext: session.userContext ? {
      username: session.userContext.username,
      role: session.userContext.role,
      account: session.userContext.account,
      warehouse: session.userContext.warehouse,
      database: session.userContext.database,
      schema: session.userContext.schema,
      sessionId: session.userContext.sessionId,
      authenticatedAt: session.userContext.authenticatedAt,
    } : null,
    lastActivity: session.lastActivity,
    createdAt: session.createdAt || Date.now(),
    // Store connection config for potential reconnection
    connectionConfig: session.connectionConfig || null,
  });
}

/**
 * Deserialize session data from Redis
 */
function deserializeSession(data) {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to parse session data:', error);
    return null;
  }
}

/**
 * Get session by ID
 */
export async function getSession(sessionId) {
  if (useRedis && redis) {
    try {
      const data = await redis.get(`${REDIS_PREFIX}${sessionId}`);
      const session = deserializeSession(data);
      
      if (session) {
        // Extend TTL on access (sliding window)
        await redis.expire(`${REDIS_PREFIX}${sessionId}`, SESSION_TTL);
      }
      
      return session;
    } catch (error) {
      console.error('Redis getSession error:', error.message);
      // Fall through to memory store
    }
  }
  
  return memoryStore.get(sessionId) || null;
}

/**
 * Store session
 */
export async function setSession(sessionId, session) {
  // Always store in memory (for connection object access)
  memoryStore.set(sessionId, session);
  
  if (useRedis && redis) {
    try {
      const serialized = serializeSession(session);
      await redis.setex(`${REDIS_PREFIX}${sessionId}`, SESSION_TTL, serialized);
    } catch (error) {
      console.error('Redis setSession error:', error.message);
    }
  }
}

/**
 * Update session (e.g., last activity, role change)
 */
export async function updateSession(sessionId, updates) {
  const existing = memoryStore.get(sessionId);
  if (existing) {
    Object.assign(existing, updates);
    memoryStore.set(sessionId, existing);
  }
  
  if (useRedis && redis) {
    try {
      const session = await getSession(sessionId);
      if (session) {
        const updated = { ...session, ...updates };
        const serialized = serializeSession(updated);
        await redis.setex(`${REDIS_PREFIX}${sessionId}`, SESSION_TTL, serialized);
      }
    } catch (error) {
      console.error('Redis updateSession error:', error.message);
    }
  }
}

/**
 * Delete session
 */
export async function deleteSession(sessionId) {
  memoryStore.delete(sessionId);
  
  if (useRedis && redis) {
    try {
      await redis.del(`${REDIS_PREFIX}${sessionId}`);
    } catch (error) {
      console.error('Redis deleteSession error:', error.message);
    }
  }
}

/**
 * Check if session exists
 */
export async function hasSession(sessionId) {
  if (useRedis && redis) {
    try {
      const exists = await redis.exists(`${REDIS_PREFIX}${sessionId}`);
      return exists === 1;
    } catch (error) {
      console.error('Redis hasSession error:', error.message);
    }
  }
  
  return memoryStore.has(sessionId);
}

/**
 * Get all active session IDs (for admin/monitoring)
 */
export async function getAllSessionIds() {
  if (useRedis && redis) {
    try {
      const keys = await redis.keys(`${REDIS_PREFIX}*`);
      return keys.map(key => key.replace(REDIS_PREFIX, ''));
    } catch (error) {
      console.error('Redis getAllSessionIds error:', error.message);
    }
  }
  
  return Array.from(memoryStore.keys());
}

/**
 * Get session count
 */
export async function getSessionCount() {
  if (useRedis && redis) {
    try {
      const keys = await redis.keys(`${REDIS_PREFIX}*`);
      return keys.length;
    } catch (error) {
      console.error('Redis getSessionCount error:', error.message);
    }
  }
  
  return memoryStore.size;
}

/**
 * Clean up expired sessions from memory store
 * (Redis handles this automatically via TTL)
 */
export function cleanupExpiredSessions(maxAge = SESSION_TTL * 1000) {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [sessionId, session] of memoryStore) {
    if (now - session.lastActivity > maxAge) {
      // Destroy Snowflake connection if exists
      if (session.connection) {
        session.connection.destroy((err) => {
          if (err) console.error('Error destroying connection:', err);
        });
      }
      memoryStore.delete(sessionId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} expired sessions`);
  }
  
  return cleaned;
}

/**
 * Get the in-memory session (needed for Snowflake connection object)
 * Redis can't store the actual connection, so we keep a hybrid approach
 */
export function getMemorySession(sessionId) {
  return memoryStore.get(sessionId);
}

/**
 * Check if Redis is being used
 */
export function isRedisActive() {
  return useRedis;
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedis() {
  if (redis && useRedis) {
    try {
      await redis.quit();
      console.log('🔒 Redis connection closed gracefully');
    } catch (error) {
      // Ignore errors during shutdown
    }
    redis = null;
    useRedis = false;
  }
}

export default {
  initRedis,
  getSession,
  setSession,
  updateSession,
  deleteSession,
  hasSession,
  getAllSessionIds,
  getSessionCount,
  cleanupExpiredSessions,
  getMemorySession,
  isRedisActive,
  closeRedis,
};
