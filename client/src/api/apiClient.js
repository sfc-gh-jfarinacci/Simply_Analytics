/**
 * Simply Analytics - API Client
 * 
 * Centralized API client for all server communication.
 * Handles authentication, session management, and API calls.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Debug logging - set to true for verbose logs
const DEBUG = import.meta.env.VITE_DEBUG === 'true';
const log = (...args) => DEBUG && log(...args);

// Session monitoring configuration
const INACTIVITY_TIMEOUT = 20 * 60 * 1000; // 20 minutes of inactivity before logout
const WARNING_BEFORE_TIMEOUT = 2 * 60 * 1000; // Show warning 2 minutes before logout
const HEARTBEAT_INTERVAL = 60 * 1000; // Send heartbeat every 60 seconds to keep Snowflake alive
const SNOWFLAKE_KEEPALIVE_INTERVAL = 30 * 1000; // Keep Snowflake connection alive every 30 seconds

let inactivityTimer = null;
let warningTimer = null;
let heartbeatTimer = null;
let tokenExpiryTimer = null;
let lastActivityTime = Date.now();
let sessionWarningCallback = null;
let sessionExpiredCallback = null;
let isSessionTerminated = false;
let tokenExpiresAt = null;

/**
 * Check if an error is a Snowflake network policy error (IP not allowed)
 * These occur when a cached connection was established from a different IP (e.g., before VPN)
 */
export function isNetworkPolicyError(error) {
  const message = error?.message || String(error);
  return message.includes('not allowed to access Snowflake') ||
         message.includes('IP/Token') ||
         message.includes('Network policy') ||
         message.includes('network policy');
}

// ============================================================
// Request Queue - Limit concurrent requests to prevent resource exhaustion
// ============================================================
const MAX_CONCURRENT_REQUESTS = 4;
let activeRequests = 0;
const requestQueue = [];

function processQueue() {
  while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
    const { resolve, reject, endpoint, options } = requestQueue.shift();
    activeRequests++;
    
    executeRequest(endpoint, options)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        activeRequests--;
        processQueue();
      });
  }
}

async function executeRequest(endpoint, options) {
  const token = getAuthToken();
  
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };

  const response = await fetch(`${API_BASE}${endpoint}`, config);
  return response;
}

function queuedFetch(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, endpoint, options });
    processQueue();
  });
}

/**
 * Get stored auth token
 * Uses sessionStorage so token is cleared when browser closes
 */
function getAuthToken() {
  return sessionStorage.getItem('authToken');
}

/**
 * Set auth token and track expiry
 * Uses sessionStorage so token is cleared when browser closes
 */
function setAuthToken(token, expiresIn = null) {
  if (token) {
    sessionStorage.setItem('authToken', token);
    
    // Track token expiry time
    if (expiresIn) {
      // Parse expiresIn (e.g., "8h", "24h", "1d")
      let expiryMs = 8 * 60 * 60 * 1000; // Default 8 hours
      if (typeof expiresIn === 'string') {
        const match = expiresIn.match(/^(\d+)(h|m|d)$/);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2];
          if (unit === 'h') expiryMs = value * 60 * 60 * 1000;
          else if (unit === 'm') expiryMs = value * 60 * 1000;
          else if (unit === 'd') expiryMs = value * 24 * 60 * 60 * 1000;
        }
      } else if (typeof expiresIn === 'number') {
        expiryMs = expiresIn;
      }
      
      tokenExpiresAt = Date.now() + expiryMs;
      sessionStorage.setItem('tokenExpiresAt', tokenExpiresAt.toString());
    }
  } else {
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('tokenExpiresAt');
    tokenExpiresAt = null;
    
    // Clear token expiry timer
    if (tokenExpiryTimer) {
      clearTimeout(tokenExpiryTimer);
      tokenExpiryTimer = null;
    }
  }
}

/**
 * Start token expiry timer
 * Automatically expires session when JWT expires
 */
function startTokenExpiryTimer() {
  // Clear existing timer
  if (tokenExpiryTimer) {
    clearTimeout(tokenExpiryTimer);
    tokenExpiryTimer = null;
  }
  
  // Get expiry time from sessionStorage or calculated
  const storedExpiry = sessionStorage.getItem('tokenExpiresAt');
  if (storedExpiry) {
    tokenExpiresAt = parseInt(storedExpiry);
  }
  
  if (!tokenExpiresAt) {
    // Default to 8 hours from now if not set
    tokenExpiresAt = Date.now() + (8 * 60 * 60 * 1000);
  }
  
  const timeUntilExpiry = tokenExpiresAt - Date.now();
  
  if (timeUntilExpiry <= 0) {
    // Token already expired
    log('JWT token already expired');
    if (sessionExpiredCallback) {
      sessionExpiredCallback();
    }
    return;
  }
  
  log(`JWT token expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes`);
  
  // Show warning 5 minutes before expiry
  const warningTime = timeUntilExpiry - (5 * 60 * 1000);
  if (warningTime > 0) {
    tokenExpiryTimer = setTimeout(() => {
      log('JWT token expiring soon - showing warning');
      if (sessionWarningCallback) {
        sessionWarningCallback(5 * 60 * 1000); // 5 minutes remaining
      }
      
      // Set final expiry timer
      tokenExpiryTimer = setTimeout(() => {
        log('JWT token expired');
        if (sessionExpiredCallback) {
          sessionExpiredCallback();
        }
      }, 5 * 60 * 1000);
    }, warningTime);
  } else {
    // Less than 5 minutes remaining, just set expiry timer
    tokenExpiryTimer = setTimeout(() => {
      log('JWT token expired');
      if (sessionExpiredCallback) {
        sessionExpiredCallback();
      }
    }, timeUntilExpiry);
  }
}

/**
 * Make API request with authentication
 * Uses request queue to limit concurrent requests
 */
async function fetchApi(endpoint, options = {}) {
  // Use queued fetch to limit concurrent requests
  const response = await queuedFetch(endpoint, options);
  
  if (response.status === 401) {
    // Try to get the actual error message from the response
    let errorMessage = 'Session expired';
    let isSessionInvalid = false;
    let isServerRestarted = false;
    try {
      const errorData = await response.clone().json();
      if (errorData.error) {
        errorMessage = errorData.error;
        
        // Check for token expiration or session revocation
        if (errorData.code === 'TOKEN_EXPIRED' || errorData.expired) {
          isSessionInvalid = true;
          errorMessage = 'Your session has expired. Please sign in again.';
          log('JWT token expired - signing out user');
        } else if (errorData.code === 'SESSION_REVOKED') {
          isSessionInvalid = true;
          errorMessage = 'You have been signed out.';
          log('Session was revoked - signing out user');
        } else if (errorData.code === 'SERVER_RESTARTED' || errorData.serverRestarted) {
          isSessionInvalid = true;
          isServerRestarted = true;
          errorMessage = 'Connection to server was lost. Please sign in again.';
          log('Server restarted - all sessions invalidated');
        }
        
        // Check if this is an IP/network policy error (not a session issue)
        const isNetworkPolicyErr = errorMessage.includes('not allowed to access') || 
                                   errorMessage.includes('IP/Token') ||
                                   errorMessage.includes('network policy');
        
        if (isNetworkPolicyErr) {
          // This is a Snowflake network policy restriction, not session expiry
          throw new Error(`Snowflake Access Denied: ${errorMessage}`);
        }
      }
    } catch (parseError) {
      // If we already threw a network policy error, re-throw it
      if (parseError.message.includes('Snowflake Access Denied')) {
        throw parseError;
      }
      // Otherwise continue with generic session expired
      isSessionInvalid = true;
    }
    
    // Only sign out user if this is actually a session-related 401
    // Don't sign out for 401s due to password validation, 2FA, etc.
    if (isSessionInvalid) {
      // Token expired/invalid/server restarted - clear auth state
      setAuthToken(null);
      if (sessionExpiredCallback) {
        // Pass additional context for server restart notification
        sessionExpiredCallback(isServerRestarted ? 'server_restarted' : 'expired');
      }
    }
    
    throw new Error(errorMessage);
  }
  
  return response;
}

// Helper to safely parse JSON response
async function safeJson(res, defaultValue = null) {
  try {
    const text = await res.text();
    if (!text || text.trim() === '') {
      return defaultValue;
    }
    return JSON.parse(text);
  } catch (e) {
    console.warn('Failed to parse JSON response:', e.message);
    return defaultValue;
  }
}

// ============================================================
// Dashboard API
// ============================================================
export const dashboardApi = {
  async list() {
    const res = await fetchApi('/dashboard');
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Failed to load dashboards' });
      // For MFA required errors, throw to display message
      if (res.status === 403 && data.code === 'MFA_REQUIRED') {
        const error = new Error(data.error || 'Two-factor authentication is required to view dashboards');
        error.status = res.status;
        error.code = 'MFA_REQUIRED';
        throw error;
      }
      console.warn('Dashboard list failed:', res.status, data.error);
      return { dashboards: [] };
    }
    return safeJson(res, { dashboards: [] });
  },
  
  async get(id) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Failed to load dashboard' });
      const error = new Error(data.error || (res.status === 403 ? 'You do not have access to this dashboard' : 'Dashboard not found'));
      error.status = res.status;
      // Preserve MFA_REQUIRED code from server, otherwise default based on status
      error.code = data.code || (res.status === 403 ? 'ACCESS_DENIED' : 'NOT_FOUND');
      throw error;
    }
    return safeJson(res, { dashboard: null });
  },
  
  /**
   * Initialize the Snowflake session for a dashboard
   * This establishes the connection with the correct warehouse and role
   */
  async initSession(id) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}/init-session`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Failed to initialize session' });
      const error = new Error(data.error || 'Failed to initialize dashboard session');
      error.status = res.status;
      error.code = data.code || 'SESSION_INIT_FAILED';
      throw error;
    }
    return safeJson(res, { success: false });
  },
  
  async create(dashboard) {
    const res = await fetchApi('/dashboard', {
      method: 'POST',
      body: JSON.stringify(dashboard),
    });
    const data = await safeJson(res, { success: false, error: 'Failed to parse response' });
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create dashboard');
    }
    return data;
  },
  
  async update(id, updates) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    const data = await safeJson(res, { success: false, error: 'Failed to parse response' });
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update dashboard');
    }
    return data;
  },
  
  async delete(id) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await safeJson(res, { success: false, error: 'Failed to parse response' });
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete dashboard');
    }
    return data;
  },
  
  // Group access management
  async getGroups(id) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}/groups`);
    if (!res.ok) {
      console.warn('Failed to get dashboard groups:', res.status);
      return { groups: [] };
    }
    return safeJson(res, { groups: [] });
  },
  
  async updateGroups(id, groupIds) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}/groups`, {
      method: 'PUT',
      body: JSON.stringify({ groupIds }),
    });
    const data = await safeJson(res, { success: false, error: 'Failed to parse response' });
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update group access');
    }
    return data;
  },
  
  async grantGroupAccess(id, groupId) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}/groups`, {
      method: 'POST',
      body: JSON.stringify({ groupId }),
    });
    const data = await safeJson(res, { success: false, error: 'Failed to parse response' });
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to grant group access');
    }
    return data;
  },
  
  async revokeGroupAccess(id, groupId) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}/groups/${encodeURIComponent(groupId)}`, {
      method: 'DELETE',
    });
    const data = await safeJson(res, { success: false, error: 'Failed to parse response' });
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to revoke group access');
    }
    return data;
  },
  
  async getPermission(id) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}/permission`);
    if (!res.ok) return { permission: 'view' };
    return safeJson(res, { permission: 'view' });
  },
  
  async exportYaml(id) {
    const res = await fetchApi(`/dashboard/${encodeURIComponent(id)}/yaml`);
    if (!res.ok) return '';
    try {
      return await res.text();
    } catch {
      return '';
    }
  },
  
  async importYaml(yamlContent) {
    const res = await fetchApi('/dashboard/import', {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlContent }),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Failed to import' });
      throw new Error(data.error || 'Failed to import YAML');
    }
    return safeJson(res, { success: true });
  },
};

// ============================================================
// Semantic API
// ============================================================
export const semanticApi = {
  async listViews() {
    const res = await fetchApi('/semantic/views');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Failed to list views: ${res.status}`);
    }
    return res.json();
  },
  
  async getView(database, schema, name, options = {}) {
    // options: { connectionId, role, warehouse }
    const { connectionId, role, warehouse } = typeof options === 'string' 
      ? { connectionId: options } // Legacy: just connectionId as string
      : options;
    
    const queryParams = new URLSearchParams();
    if (connectionId) queryParams.set('connectionId', connectionId);
    if (role) queryParams.set('role', role);
    if (warehouse) queryParams.set('warehouse', warehouse);
    const queryString = queryParams.toString();
    
    const res = await fetchApi(`/semantic/views/${encodeURIComponent(database)}/${encodeURIComponent(schema)}/${encodeURIComponent(name)}${queryString ? `?${queryString}` : ''}`);
    if (!res.ok) {
      // Try to parse error response
      try {
        const errorData = await res.json();
        // Return the error data so caller can handle gracefully
        return { error: errorData.error || `Failed to get view: ${res.status}`, columns: [] };
      } catch {
        return { error: `Failed to get view: ${res.status}`, columns: [] };
      }
    }
    try {
      return await res.json();
    } catch (e) {
      return { error: 'Invalid response from server', columns: [] };
    }
  },
  
  async query(params, connectionId = null) {
    // Accept either object params or legacy separate args
    let body;
    if (typeof params === 'object' && params !== null && 'semanticView' in params) {
      // Object format: { semanticView, dimensions, measures, filters, orderBy, limit, connectionId }
      body = { ...params };
      // Allow connectionId to be passed in params or as second arg
      if (connectionId) body.connectionId = connectionId;
    } else {
      // Legacy positional format: (semanticView, dimensions, measures, filters, orderBy, limit)
      body = { 
        semanticView: arguments[0], 
        dimensions: arguments[1], 
        measures: arguments[2], 
        filters: arguments[3], 
        orderBy: arguments[4], 
        limit: arguments[5] 
      };
    }
    
    const res = await fetchApi('/semantic/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let errorMessage = `Query failed: ${res.status}`;
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        const text = await res.text();
        if (text) errorMessage = text;
      }
      throw new Error(errorMessage);
    }
    return res.json();
  },
  
  /**
   * Generate SQL preview from field configuration
   * Backend is the SINGLE SOURCE OF TRUTH for SQL generation
   * 
   * @param {Object} params - { semanticView, fields, customColumns, connectionId, role, warehouse }
   * @param {string} params.semanticView - Fully qualified semantic view name
   * @param {Array} params.fields - Field config: [{ name, shelf, aggregation, filter, sortDir }]
   * @param {Array} params.customColumns - Calculated fields: [{ name, expression }]
   * @returns {Object} - { sql, dimensions, measures, valid }
   */
  async preview(params) {
    const res = await fetchApi('/semantic/preview', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      // Don't throw - return error in response format
      return {
        sql: `-- Preview error: ${res.status}`,
        dimensions: [],
        measures: [],
        valid: false,
      };
    }
    return res.json();
  },
  
  /**
   * Execute a pivot query on a semantic view
   * @param {Object} params - { semanticView, rowDimensions, pivotColumn, measures, aggregation, filters, limit }
   */
  async pivot(params) {
    const res = await fetchApi('/semantic/pivot', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      let errorMessage = `Pivot query failed: ${res.status}`;
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        const text = await res.text();
        if (text) errorMessage = text;
      }
      throw new Error(errorMessage);
    }
    return res.json();
  },
  
  /**
   * Get distinct values for a field (optimized for filter dropdowns)
   * @param {Object} params - { semanticView, field, search?, limit?, connectionId?, role?, warehouse? }
   * @returns {Promise<{ values: any[], totalCount: number, hasMore: boolean }>}
   */
  async getDistinctValues(params) {
    const res = await fetchApi('/semantic/distinct-values', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      let errorMessage = `Failed to get distinct values: ${res.status}`;
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        const text = await res.text();
        if (text) errorMessage = text;
      }
      throw new Error(errorMessage);
    }
    return res.json();
  },
  
  async listDatabases() {
    const res = await fetchApi('/semantic/databases');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Failed to list databases: ${res.status}`);
    }
    return res.json();
  },
  
  async listSchemas(database) {
    const res = await fetchApi(`/semantic/schemas/${encodeURIComponent(database)}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Failed to list schemas: ${res.status}`);
    }
    return res.json();
  },

  // ============================================================
  // Cortex AI Functions
  // ============================================================
  
  /**
   * Execute Cortex COMPLETE for LLM text generation
   */
  async cortexComplete(params) {
    const res = await fetchApi('/semantic/cortex/complete', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Cortex COMPLETE failed' });
      throw new Error(data.error || 'Cortex COMPLETE failed');
    }
    return res.json();
  },

  /**
   * Ask a natural language question about a semantic view
   */
  async cortexAsk(params) {
    const res = await fetchApi('/semantic/cortex/ask', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Cortex ASK failed' });
      throw new Error(data.error || 'Cortex ASK failed');
    }
    return res.json();
  },

  /**
   * Generate AI insights about query results
   */
  async cortexInsights(params) {
    const res = await fetchApi('/semantic/cortex/insights', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Cortex INSIGHTS failed' });
      throw new Error(data.error || 'Cortex INSIGHTS failed');
    }
    return res.json();
  },

  /**
   * Analyze sentiment of text
   */
  async cortexSentiment(text) {
    const res = await fetchApi('/semantic/cortex/sentiment', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Cortex SENTIMENT failed' });
      throw new Error(data.error || 'Cortex SENTIMENT failed');
    }
    return res.json();
  },

  /**
   * Summarize text
   */
  async cortexSummarize(text) {
    const res = await fetchApi('/semantic/cortex/summarize', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Cortex SUMMARIZE failed' });
      throw new Error(data.error || 'Cortex SUMMARIZE failed');
    }
    return res.json();
  },

  /**
   * Translate text
   */
  async cortexTranslate(text, fromLanguage, toLanguage) {
    const res = await fetchApi('/semantic/cortex/translate', {
      method: 'POST',
      body: JSON.stringify({ text, fromLanguage, toLanguage }),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Cortex TRANSLATE failed' });
      throw new Error(data.error || 'Cortex TRANSLATE failed');
    }
    return res.json();
  },

  /**
   * List available Cortex LLM models
   */
  async cortexModels() {
    const res = await fetchApi('/semantic/cortex/models');
    if (!res.ok) {
      return { models: [] };
    }
    return res.json();
  },

  /**
   * Execute a query with custom calculated columns
   */
  async queryWithCustomColumns(params) {
    const res = await fetchApi('/semantic/query-with-custom-columns', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      let errorMessage = `Query failed: ${res.status}`;
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        const text = await res.text();
        if (text) errorMessage = text;
      }
      throw new Error(errorMessage);
    }
    return res.json();
  },
};

// ============================================================
// Connection API
// ============================================================
export const connectionApi = {
  async test(config) {
    const res = await fetchApi('/connection/test', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    return safeJson(res, { success: false, error: 'Connection test failed' });
  },
  
  async getWarehouses() {
    const res = await fetchApi('/connection/warehouses');
    if (!res.ok) return { warehouses: [] };
    return safeJson(res, { warehouses: [] });
  },
  
  async getRoles() {
    const res = await fetchApi('/connection/roles');
    if (!res.ok) return { roles: [] };
    return safeJson(res, { roles: [] });
  },
};

// ============================================================
// Query API
// ============================================================
export const queryApi = {
  async execute(connectionId, sql, binds = []) {
    const res = await fetchApi('/query/execute', {
      method: 'POST',
      body: JSON.stringify({ connectionId, sql, binds }),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Query execution failed' });
      throw new Error(data.error || 'Query execution failed');
    }
    return safeJson(res, { rows: [], columns: [] });
  },
  
  async getSample(connectionId, database, schema, table, limit = 1000000) {
    const encodedPath = [connectionId, database, schema, table].map(encodeURIComponent).join('/');
    const res = await fetchApi(`/query/sample/${encodedPath}?limit=${limit}`);
    if (!res.ok) return { rows: [], columns: [] };
    return safeJson(res, { rows: [], columns: [] });
  },
  
  async build(modelId, params) {
    const res = await fetchApi(`/query/build/${encodeURIComponent(modelId)}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await safeJson(res, { error: 'Query build failed' });
      throw new Error(data.error || 'Query build failed');
    }
    return safeJson(res, { rows: [], columns: [] });
  },
};

// ============================================================
// Auth API
// ============================================================
export const authApi = {
  // App user login (PostgreSQL)
  // Note: Login doesn't use fetchApi to avoid sending stale auth tokens
  async login(username, password, forceLogin = false) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, forceLogin }),
    });
    
    const data = await safeJson(res, { success: false, error: 'Login failed' });
    
    // Handle login-specific errors (401 means invalid credentials, not session expired)
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    
    if (data.token) {
      setAuthToken(data.token, data.expiresIn);
    }
    return data;
  },
  
  async loginWithKeyPair(account, username, privateKey, passphrase) {
    const res = await fetchApi('/auth/keypair', {
      method: 'POST',
      body: JSON.stringify({ account, username, privateKey, passphrase }),
    });
    const data = await safeJson(res, { success: false, error: 'Login failed' });
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },
  
  async loginWithPAT(account, username, token) {
    const res = await fetchApi('/auth/pat', {
      method: 'POST',
      body: JSON.stringify({ account, username, token }),
    });
    const data = await safeJson(res, { success: false, error: 'Login failed' });
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },
  
  async validate() {
    const res = await fetchApi('/auth/validate');
    if (!res.ok) return { valid: false };
    return safeJson(res, { valid: false });
  },
  
  async getRoles() {
    const res = await fetchApi('/auth/roles');
    if (!res.ok) return { roles: [] };
    return safeJson(res, { roles: [] });
  },
  
  async switchRole(role) {
    const res = await fetchApi('/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    if (!res.ok) return { success: false };
    return safeJson(res, { success: false });
  },
  
  async heartbeat() {
    const res = await fetchApi('/auth/heartbeat', {
      method: 'POST',
    });
    if (!res.ok) return { alive: false };
    return safeJson(res, { alive: true });
  },
  
  async refresh() {
    const res = await fetchApi('/auth/refresh', {
      method: 'POST',
    });
    const data = await safeJson(res, { success: false });
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },
  
  async logout() {
    try {
      await fetchApi('/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
      stopSessionMonitoring();
    }
  },
  
  async testConnection() {
    const res = await fetchApi('/auth/test-connection', {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await safeJson(res, { success: false, error: 'Connection test failed' });
      throw new Error(data.error || 'Connection test failed');
    }
    return safeJson(res, { success: true });
  },
  
  async updateCredentials({ type, token, privateKey, passphrase }) {
    const res = await fetchApi('/auth/update-credentials', {
      method: 'POST',
      body: JSON.stringify({ type, token, privateKey, passphrase }),
    });
    if (!res.ok) {
      const data = await safeJson(res, { success: false, error: 'Failed to update credentials' });
      throw new Error(data.error || 'Failed to update credentials');
    }
    const data = await safeJson(res, { success: false });
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },
};

// ============================================================
// Multi-Factor Authentication API
// ============================================================

export const twoFactorApi = {
  // Get current user's 2FA status
  async getStatus() {
    const res = await fetchApi('/2fa/status');
    if (!res.ok) throw new Error('Failed to get MFA status');
    return safeJson(res, {});
  },

  // TOTP Setup
  async setupTotp() {
    const res = await fetchApi('/2fa/totp/setup', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to set up TOTP');
    return safeJson(res, {});
  },

  async verifyTotp(code) {
    const res = await fetchApi('/2fa/totp/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    const data = await safeJson(res, { success: false });
    if (!res.ok) throw new Error(data.error || 'Failed to verify TOTP');
    return data;
  },

  async disableTotp(password) {
    const res = await fetchApi('/2fa/totp', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
    const data = await safeJson(res, { success: false });
    if (!res.ok) throw new Error(data.error || 'Failed to disable TOTP');
    return data;
  },

  // Passkey Setup
  async getPasskeyRegistrationOptions() {
    const res = await fetchApi('/2fa/passkey/register-options', { method: 'POST' });
    const data = await safeJson(res, {});
    if (!res.ok) throw new Error(data.error || 'Failed to get passkey options');
    return data;
  },

  async verifyPasskeyRegistration(response, name) {
    const res = await fetchApi('/2fa/passkey/register-verify', {
      method: 'POST',
      body: JSON.stringify({ response, name }),
    });
    const data = await safeJson(res, { success: false });
    if (!res.ok) throw new Error(data.error || 'Failed to register passkey');
    return data;
  },

  async getPasskeys() {
    const res = await fetchApi('/2fa/passkeys');
    if (!res.ok) throw new Error('Failed to get passkeys');
    return safeJson(res, { passkeys: [] });
  },

  async removePasskey(id, password) {
    const res = await fetchApi(`/2fa/passkey/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
    const data = await safeJson(res, { success: false });
    if (!res.ok) throw new Error(data.error || 'Failed to remove passkey');
    return data;
  },

  // Login 2FA Verification (used during login flow)
  async validateTotp(userId, code, pendingToken, forceLogin = false) {
    const res = await fetch(`${API_BASE}/2fa/validate/totp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, code, pendingToken, forceLogin }),
    });
    const data = await safeJson(res, { success: false });
    if (!res.ok) {
      const error = new Error(data.error || 'Invalid code');
      error.code = data.code;
      throw error;
    }
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },

  async getPasskeyAuthOptions(userId, pendingToken) {
    const res = await fetch(`${API_BASE}/2fa/validate/passkey/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pendingToken }),
    });
    const data = await safeJson(res, {});
    if (!res.ok) throw new Error(data.error || 'Failed to get passkey options');
    return data;
  },

  async verifyPasskeyAuth(userId, response, pendingToken, forceLogin = false) {
    const res = await fetch(`${API_BASE}/2fa/validate/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, response, pendingToken, forceLogin }),
    });
    const data = await safeJson(res, { success: false });
    if (!res.ok) {
      const error = new Error(data.error || 'Passkey verification failed');
      error.code = data.code;
      throw error;
    }
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },
};

// ============================================================
// Session Management
// ============================================================

/**
 * Start session monitoring
 * - Tracks user activity (mouse, keyboard, clicks)
 * - Shows warning 2 minutes before 20-minute inactivity timeout
 * - Checks elapsed time when tab becomes visible (handles browser throttling)
 */
export function startSessionMonitoring(onWarning, onExpired) {
  sessionWarningCallback = onWarning;
  sessionExpiredCallback = onExpired;
  lastActivityTime = Date.now();
  
  // Start tracking activity
  resetActivityTimer();
  
  // Start heartbeat to keep session alive
  startHeartbeat();
  
  // Start JWT token expiry timer
  startTokenExpiryTimer();
  
  // Track user activity - debounced to avoid excessive calls
  const throttledReset = throttle(resetActivityTimer, 5000);
  document.addEventListener('mousemove', throttledReset);
  document.addEventListener('keypress', throttledReset);
  document.addEventListener('click', throttledReset);
  document.addEventListener('scroll', throttledReset);
  document.addEventListener('touchstart', throttledReset);
  
  // Handle visibility change - check actual elapsed time when user returns
  // This handles browser timer throttling when tab is in background
  // Also validates session is still active (not revoked by force login elsewhere)
  const handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      // First check if JWT token has expired locally
      const storedExpiry = sessionStorage.getItem('tokenExpiresAt');
      if (storedExpiry) {
        const expiryTime = parseInt(storedExpiry);
        if (Date.now() >= expiryTime) {
          log('JWT token expired while tab was backgrounded');
          if (sessionExpiredCallback) {
            sessionExpiredCallback();
          }
          return;
        }
      }
      
      // Validate session is still active on server (catches force-login from other tabs)
      // This runs in background and doesn't block UI
      const token = sessionStorage.getItem('authToken');
      if (token && !isSessionTerminated) {
        try {
          const res = await fetch(`${API_BASE}/auth/validate`, {
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
            }
          });
          
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            // Session was revoked (force login from another tab/device)
            if (data.code === 'SESSION_REVOKED' || data.code === 'SERVER_RESTARTED' || res.status === 401) {
              log('Session was revoked while tab was backgrounded');
              setAuthToken(null);
              if (sessionExpiredCallback) {
                sessionExpiredCallback(data.code === 'SERVER_RESTARTED' ? 'server_restarted' : 'revoked');
              }
              return;
            }
          }
        } catch (err) {
          // Network error - don't sign out, just log
          console.warn('Could not validate session on visibility change:', err.message);
        }
      }
      
      // Check inactivity timeout
      const elapsed = Date.now() - lastActivityTime;
      
      if (elapsed >= INACTIVITY_TIMEOUT) {
        // Session expired while away
        log('Session expired during inactivity (tab was backgrounded)');
        if (sessionExpiredCallback) {
          sessionExpiredCallback();
        }
      } else if (elapsed >= INACTIVITY_TIMEOUT - WARNING_BEFORE_TIMEOUT) {
        // Should show warning
        const remaining = INACTIVITY_TIMEOUT - elapsed;
        if (sessionWarningCallback) {
          sessionWarningCallback(remaining);
        }
        // Set final expiry timer
        if (warningTimer) clearTimeout(warningTimer);
        warningTimer = setTimeout(() => {
          if (sessionExpiredCallback) {
            sessionExpiredCallback();
          }
        }, remaining);
      }
      // If still within timeout, resetActivityTimer will be called by user interaction
    }
  };
  
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // Store handlers for cleanup
  window._sessionActivityHandler = throttledReset;
  window._sessionVisibilityHandler = handleVisibilityChange;
}

/**
 * Throttle function to limit how often a function is called
 */
function throttle(func, limit) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      func.apply(this, args);
    }
  };
}

/**
 * Stop session monitoring
 */
export function stopSessionMonitoring() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (warningTimer) {
    clearTimeout(warningTimer);
    warningTimer = null;
  }
  
  // Stop heartbeat
  stopHeartbeat();
  
  // Stop token expiry timer
  if (tokenExpiryTimer) {
    clearTimeout(tokenExpiryTimer);
    tokenExpiryTimer = null;
  }
  
  const handler = window._sessionActivityHandler;
  if (handler) {
    document.removeEventListener('mousemove', handler);
    document.removeEventListener('keypress', handler);
    document.removeEventListener('click', handler);
    document.removeEventListener('scroll', handler);
    document.removeEventListener('touchstart', handler);
    window._sessionActivityHandler = null;
  }
  
  // Remove visibility change handler
  const visibilityHandler = window._sessionVisibilityHandler;
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    window._sessionVisibilityHandler = null;
  }
}

/**
 * Reset activity timer - called on user activity
 * After 18 minutes of inactivity: show warning
 * After 20 minutes of inactivity: expire session
 */
function resetActivityTimer() {
  lastActivityTime = Date.now();
  
  // Clear existing timers
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (warningTimer) {
    clearTimeout(warningTimer);
    warningTimer = null;
  }
  
  // Set warning timer (18 minutes = 20 min - 2 min warning)
  const warningDelay = INACTIVITY_TIMEOUT - WARNING_BEFORE_TIMEOUT;
  
  inactivityTimer = setTimeout(() => {
    // Show warning with time remaining (2 minutes)
    if (sessionWarningCallback) {
      sessionWarningCallback(WARNING_BEFORE_TIMEOUT);
    }
    
    // Set final expiry timer (2 more minutes)
    warningTimer = setTimeout(() => {
      if (sessionExpiredCallback) {
        sessionExpiredCallback();
      }
    }, WARNING_BEFORE_TIMEOUT);
  }, warningDelay);
}

/**
 * Start heartbeat to keep session alive
 * Sends heartbeat every 60 seconds
 */
function startHeartbeat() {
  // Reset terminated flag when starting new session
  isSessionTerminated = false;
  
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  
  // Send immediate heartbeat
  authApi.heartbeat().catch(err => {
    console.warn('Initial heartbeat failed:', err.message);
    if (isTerminatedError(err.message)) {
      stopHeartbeat();
    }
  });
  
  // Continue sending heartbeats regularly
  heartbeatTimer = setInterval(async () => {
    // Skip if session is terminated
    if (isSessionTerminated) {
      stopHeartbeat();
      return;
    }
    
    try {
      const result = await authApi.heartbeat();
      if (!result.alive && result.sessionValid === false) {
        console.warn('Session invalidated by server');
        stopHeartbeat();
        if (sessionExpiredCallback) {
          sessionExpiredCallback();
        }
      }
    } catch (error) {
      console.warn('Heartbeat failed:', error.message);
      
      // Stop heartbeat on termination errors
      if (isTerminatedError(error.message)) {
        console.warn('Connection terminated, stopping heartbeat');
        stopHeartbeat();
      }
      // Don't expire on other failures - network might be temporarily down
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * Check if error indicates a terminated connection
 */
function isTerminatedError(message) {
  if (!message) return false;
  const lowerMsg = message.toLowerCase();
  return lowerMsg.includes('terminated') || 
         lowerMsg.includes('connection closed') ||
         lowerMsg.includes('session expired') ||
         lowerMsg.includes('not authenticated');
}

/**
 * Stop heartbeat explicitly
 */
function stopHeartbeat() {
  isSessionTerminated = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Set callback for Snowflake connection errors
 * This is useful for showing network policy errors to the user
 */
export function setSnowflakeErrorCallback(callback) {
  window._snowflakeErrorCallback = callback;
}

/**
 * Keep session alive (user clicked "Keep me signed in")
 * Resets inactivity timer and refreshes session with server
 */
export async function keepSessionAlive() {
  // Don't try if session is already terminated
  if (isSessionTerminated) {
    console.warn('Cannot keep session alive - session already terminated');
    return;
  }
  
  resetActivityTimer();
  try {
    await authApi.heartbeat();
    log('Session kept alive');
  } catch (error) {
    console.error('Failed to keep session alive:', error);
    if (isTerminatedError(error.message)) {
      stopHeartbeat();
    }
  }
}

// ============================================================
// Session Persistence
// ============================================================

/**
 * Persist session to sessionStorage (cleared when browser closes)
 */
export function persistSession(user, token) {
  if (token) {
    setAuthToken(token);
  }
  if (user) {
    sessionStorage.setItem('userInfo', JSON.stringify(user));
  }
}

/**
 * Restore session from sessionStorage
 */
export function restoreSession() {
  const token = getAuthToken();
  const userInfo = sessionStorage.getItem('userInfo');
  
  if (token && userInfo) {
    try {
      return { token, user: JSON.parse(userInfo) };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Clear persisted session
 */
export function clearPersistedSession() {
  setAuthToken(null);
  sessionStorage.removeItem('userInfo');
  localStorage.removeItem('lastDashboardId');
}

/**
 * Persist last viewed dashboard
 */
export function persistLastDashboard(dashboardId) {
  if (dashboardId) {
    localStorage.setItem('lastDashboardId', dashboardId);
  }
}

/**
 * Get last viewed dashboard
 */
export function getLastDashboard() {
  return localStorage.getItem('lastDashboardId');
}

// ============================================
// User Management API (PostgreSQL-based)
// ============================================
export const userApi = {
  async getAll() {
    const res = await fetchApi('/users');
    return safeJson(res, { users: [] });
  },

  async getById(userId) {
    const res = await fetchApi(`/users/${userId}`);
    return safeJson(res, { user: null });
  },

  async create(userData) {
    const res = await fetchApi('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to create user' });
      throw new Error(error.error);
    }
    return safeJson(res, { user: null });
  },

  async update(userId, updates) {
    const res = await fetchApi(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update user' });
      throw new Error(error.error);
    }
    return safeJson(res, { user: null });
  },

  async updateRole(userId, role) {
    const res = await fetchApi(`/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update role' });
      throw new Error(error.error);
    }
    return safeJson(res, { user: null });
  },

  async changePassword(userId, currentPassword, newPassword) {
    const res = await fetchApi(`/users/${userId}/change-password`, {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to change password' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async updateEmail(userId, email) {
    const res = await fetchApi(`/users/${userId}/email`, {
      method: 'PUT',
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update email' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: true });
  },

  async resetPassword(userId, newPassword) {
    const res = await fetchApi(`/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to reset password' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async delete(userId) {
    const res = await fetchApi(`/users/${userId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to delete user' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async getTheme() {
    const res = await fetchApi('/users/me/theme');
    return safeJson(res, { theme: 'light' });
  },

  async updateTheme(theme) {
    const res = await fetchApi('/users/me/theme', {
      method: 'PUT',
      body: JSON.stringify({ theme }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update theme' });
      throw new Error(error.error);
    }
    return safeJson(res, { theme: 'light' });
  },

  async transferOwnership(newOwnerId) {
    const res = await fetchApi('/users/transfer-ownership', {
      method: 'POST',
      body: JSON.stringify({ newOwnerId }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to transfer ownership' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  // Color Schemes
  async getColorSchemes() {
    const res = await fetchApi('/users/color-schemes');
    if (!res.ok) return { colorSchemes: [] };
    return safeJson(res, { colorSchemes: [] });
  },

  async saveColorSchemes(colorSchemes) {
    const res = await fetchApi('/users/color-schemes', {
      method: 'PUT',
      body: JSON.stringify({ colorSchemes }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to save color schemes' });
      throw new Error(error.error);
    }
    return safeJson(res, { colorSchemes: [] });
  },

  async getPreferences() {
    const res = await fetchApi('/users/preferences');
    if (!res.ok) return {};
    return safeJson(res, {});
  },

  // ============================================
  // Account Lock/Unlock
  // ============================================
  
  async lockAccount(userId, reason) {
    const res = await fetchApi(`/users/${userId}/lock`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to lock account' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async unlockAccount(userId, temporaryHours = null) {
    const res = await fetchApi(`/users/${userId}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ temporaryHours }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to unlock account' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async getSecurityInfo(userId) {
    const res = await fetchApi(`/users/${userId}/security`);
    if (!res.ok) return null;
    return safeJson(res, null);
  },

  // ============================================
  // MFA Bypass
  // ============================================
  
  async setMfaBypass(userId, hours, reason) {
    const res = await fetchApi(`/users/${userId}/mfa-bypass`, {
      method: 'POST',
      body: JSON.stringify({ hours, reason }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to set MFA bypass' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async clearMfaBypass(userId) {
    const res = await fetchApi(`/users/${userId}/mfa-bypass`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to clear MFA bypass' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  // ============================================
  // Dashboard Transfer
  // ============================================
  
  async getUserDashboards(userId) {
    const res = await fetchApi(`/users/${userId}/dashboards`);
    if (!res.ok) return { dashboards: [] };
    return safeJson(res, { dashboards: [] });
  },

  async transferDashboards(fromUserId, toUserId) {
    const res = await fetchApi(`/users/${fromUserId}/transfer-dashboards`, {
      method: 'POST',
      body: JSON.stringify({ toUserId }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to transfer dashboards' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false, transferredCount: 0 });
  },

  // ============================================
  // Admin User Update
  // ============================================
  
  async adminUpdate(userId, updates) {
    const res = await fetchApi(`/users/${userId}/admin-update`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update user' });
      throw new Error(error.error);
    }
    return safeJson(res, { user: null });
  },

  // ============================================
  // 2FA Admin Management
  // ============================================
  
  async get2faStatus(userId) {
    const res = await fetchApi(`/users/${userId}/2fa-status`);
    if (!res.ok) return null;
    return safeJson(res, null);
  },

  async reset2fa(userId) {
    const res = await fetchApi(`/users/${userId}/2fa`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to reset MFA' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },
};

// ============================================
// Snowflake Connections API (PostgreSQL-based)
// ============================================
export const sfConnectionApi = {
  async getAll() {
    const res = await fetchApi('/connections');
    return safeJson(res, { connections: [] });
  },

  async getById(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}`);
    return safeJson(res, { connection: null });
  },

  async create(connectionData) {
    const res = await fetchApi('/connections', {
      method: 'POST',
      body: JSON.stringify(connectionData),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to create connection' });
      throw new Error(error.error);
    }
    return safeJson(res, { connection: null });
  },

  async update(connectionId, updates) {
    const res = await fetchApi(`/connections/${connectionId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update connection' });
      throw new Error(error.error);
    }
    return safeJson(res, { connection: null });
  },

  async delete(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to delete connection' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async test(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}/test`, {
      method: 'POST',
    });
    return safeJson(res, { success: false, error: 'Test failed' });
  },

  async getResources(connectionId, role = null) {
    const params = role ? `?role=${encodeURIComponent(role)}` : '';
    const res = await fetchApi(`/connections/${connectionId}/resources${params}`);
    return safeJson(res, { roles: [], warehouses: [], semanticViews: [], cortexAgents: [] });
  },

  /**
   * Force refresh/clear a cached Snowflake connection
   * Use when IP changes (VPN) or connection becomes stale
   */
  async refresh(connectionId) {
    const res = await fetchApi(`/connections/${connectionId}/refresh`, {
      method: 'POST',
    });
    return safeJson(res, { success: false });
  },

  /**
   * Clear ALL cached Snowflake connections for the current session
   */
  async clearAllConnections() {
    const res = await fetchApi('/connections/clear-all', {
      method: 'POST',
    });
    return safeJson(res, { success: false });
  },

  /**
   * Stream a Cortex Agent conversation via SSE.
   * @param {Object} params - { connectionId, agentFqn, messages, threadId?, parentMessageId? }
   * @param {Function} onEvent - (eventType, data) => void
   * @param {AbortSignal} signal - optional abort signal
   * @returns {Promise<void>} resolves when stream ends
   */
  async cortexAgentRun(params, onEvent, signal) {
    const res = await fetchApi('/semantic/cortex/agent/run', {
      method: 'POST',
      body: JSON.stringify(params),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Request failed: ${res.status}` }));
      throw new Error(err.error || 'Cortex Agent request failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = 'message';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const raw = line.slice(6);
          try {
            const data = JSON.parse(raw);
            onEvent(currentEvent, data);
          } catch {
            onEvent(currentEvent, raw);
          }
        } else if (line === '') {
          currentEvent = 'message';
        }
      }
    }
  },
};

// ============================================
// User Groups API (PostgreSQL-based)
// ============================================
export const groupApi = {
  async getAll() {
    const res = await fetchApi('/groups');
    return safeJson(res, { groups: [] });
  },

  async getMyGroups() {
    const res = await fetchApi('/groups/my-groups');
    return safeJson(res, { groups: [] });
  },

  async getById(groupId) {
    const res = await fetchApi(`/groups/${groupId}`);
    return safeJson(res, { group: null });
  },

  async getMembers(groupId) {
    const res = await fetchApi(`/groups/${groupId}/members`);
    return safeJson(res, { members: [] });
  },

  async create(groupData) {
    const res = await fetchApi('/groups', {
      method: 'POST',
      body: JSON.stringify(groupData),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to create group' });
      throw new Error(error.error);
    }
    return safeJson(res, { group: null });
  },

  async update(groupId, updates) {
    const res = await fetchApi(`/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update group' });
      throw new Error(error.error);
    }
    return safeJson(res, { group: null });
  },

  async delete(groupId) {
    const res = await fetchApi(`/groups/${groupId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to delete group' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async addMember(groupId, userId) {
    const res = await fetchApi(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to add member' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },

  async removeMember(groupId, userId) {
    const res = await fetchApi(`/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to remove member' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: false });
  },
};

// ============================================
// Folder API (Dashboard organization)
// ============================================
export const folderApi = {
  async getContents(folderId = null) {
    const url = folderId ? `/folders/${folderId}/contents` : '/folders/contents';
    const res = await fetchApi(url);
    return safeJson(res, { folders: [], dashboards: [] });
  },

  async getPath(folderId) {
    const res = await fetchApi(`/folders/${folderId}/path`);
    return safeJson(res, []);
  },

  async getById(folderId) {
    const res = await fetchApi(`/folders/${folderId}`);
    return safeJson(res, null);
  },

  async create(folderData) {
    const res = await fetchApi('/folders', {
      method: 'POST',
      body: JSON.stringify(folderData),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to create folder' });
      throw new Error(error.error);
    }
    return safeJson(res, null);
  },

  async update(folderId, updates) {
    const res = await fetchApi(`/folders/${folderId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to update folder' });
      throw new Error(error.error);
    }
    return safeJson(res, null);
  },

  async delete(folderId) {
    const res = await fetchApi(`/folders/${folderId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to delete folder' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: true });
  },

  async search(query) {
    const res = await fetchApi('/folders/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    return safeJson(res, { folders: [], dashboards: [] });
  },

  async moveDashboard(dashboardId, folderId) {
    const res = await fetchApi(`/folders/move-dashboard/${dashboardId}`, {
      method: 'PUT',
      body: JSON.stringify({ folderId }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to move dashboard' });
      throw new Error(error.error);
    }
    return safeJson(res, null);
  },

  // Folder access management
  async getAccess(folderId) {
    const res = await fetchApi(`/folders/${folderId}/access`);
    return safeJson(res, { groups: [] });
  },

  async grantAccess(folderId, groupId) {
    const res = await fetchApi(`/folders/${folderId}/access`, {
      method: 'POST',
      body: JSON.stringify({ groupId }),
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to grant access' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: true });
  },

  async revokeAccess(folderId, groupId) {
    const res = await fetchApi(`/folders/${folderId}/access/${groupId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await safeJson(res, { error: 'Failed to revoke access' });
      throw new Error(error.error);
    }
    return safeJson(res, { success: true });
  },
};

// Default export
const api = {
  dashboard: dashboardApi,
  semantic: semanticApi,
  connection: connectionApi,
  sfConnection: sfConnectionApi,
  query: queryApi,
  auth: authApi,
  twoFactor: twoFactorApi,
  user: userApi,
  group: groupApi,
  folder: folderApi,
  startSessionMonitoring,
  stopSessionMonitoring,
  keepSessionAlive,
  persistSession,
  restoreSession,
  clearPersistedSession,
  persistLastDashboard,
  getLastDashboard,
};

export default api;
