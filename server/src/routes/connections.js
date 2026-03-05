/**
 * Snowflake Connection Routes
 * 
 * Manages Snowflake connection configurations for users.
 */

import { Router } from 'express';
import connectionService from '../services/connectionService.js';
import { clearCachedConnection, closeDashboardConnection, getConnectionCacheStats, forceDestroyAllForConnection } from '../db/snowflake.js';

// Verbose logging toggle
const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && log(...args);

export const connectionRoutes = Router();

/**
 * GET /api/connections
 * Get all connections for the authenticated user
 */
connectionRoutes.get('/', async (req, res) => {
  try {
    const { user } = req;
    const connections = await connectionService.getConnectionsByUser(user.id);
    res.json({ connections });
  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/connections/:id
 * Get a specific connection (without credentials)
 */
connectionRoutes.get('/:id', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;

    const connection = await connectionService.getConnectionById(id, user.id);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Remove encrypted credentials from response
    const { credentials_encrypted, ...safeConnection } = connection;
    res.json({ connection: safeConnection });
  } catch (error) {
    console.error('Get connection error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/connections
 * Create a new Snowflake connection
 * Only admins and owners can create connections
 */
connectionRoutes.post('/', async (req, res) => {
  try {
    const { user } = req;
    
    // Only admins and owners can create connections
    if (!['owner', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only administrators can create connections' });
    }
    
    const connectionData = req.body;

    // Validate required fields
    const required = ['name', 'account', 'username', 'authType', 'credentials'];
    const missing = required.filter(f => !connectionData[f]);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const connection = await connectionService.createConnection(user.id, connectionData);
    res.status(201).json({ connection });
  } catch (error) {
    console.error('Create connection error:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'A connection with this name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/connections/:id
 * Update an existing connection
 * Only admins and owners can update connections
 */
connectionRoutes.put('/:id', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;
    const updates = req.body;

    // Only admins and owners can update connections
    if (!['owner', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only administrators can update connections' });
    }

    const connection = await connectionService.updateConnection(id, user.id, updates);
    res.json({ connection });
  } catch (error) {
    console.error('Update connection error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/connections/:id
 * Delete a connection
 * Only admins and owners can delete connections
 */
connectionRoutes.delete('/:id', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;

    // Only admins and owners can delete connections
    if (!['owner', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only administrators can delete connections' });
    }

    await connectionService.deleteConnection(id, user.id);
    res.json({ success: true, message: 'Connection deleted successfully' });
  } catch (error) {
    console.error('Delete connection error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/connections/:id/test
 * Test a connection to Snowflake
 */
connectionRoutes.post('/:id/test', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;

    const result = await connectionService.testConnection(id, user.id);
    res.json(result);
  } catch (error) {
    console.error('Test connection error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/connections/:id/resources
 * Get available Snowflake resources (warehouses, roles, semantic views)
 * Optional query param: role - if provided, fetches warehouses/views for that role
 */
connectionRoutes.get('/:id/resources', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;
    const { role } = req.query;

    const resources = await connectionService.getSnowflakeResources(id, user.id, role || null);
    res.json(resources);
  } catch (error) {
    console.error('Get resources error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/connections/:id/refresh
 * Force refresh/clear a cached Snowflake connection
 * Used when IP changes (VPN) or connection becomes stale
 */
connectionRoutes.post('/:id/refresh', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;

    log(`🔄 Refresh connection request - connectionId: ${id}, sessionId: ${user?.sessionId?.substring?.(0, 8) || 'none'}`);

    // Use the nuclear option - destroy ALL connections for this connectionId
    const destroyedCount = await forceDestroyAllForConnection(id);
    
    log(`🔄 Force destroyed ${destroyedCount} connection(s) for ${id}`);
    
    res.json({ 
      success: true, 
      destroyedCount,
      message: destroyedCount > 0 
        ? `Destroyed ${destroyedCount} cached connection(s). Next request will create a fresh connection.` 
        : 'No cached connections found (will create fresh on next request).'
    });
  } catch (error) {
    console.error('Refresh connection error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/connections/clear-all
 * Clear ALL cached Snowflake connections for the current session
 * Used when user wants to force reconnect to all connections
 */
connectionRoutes.post('/clear-all', async (req, res) => {
  try {
    const { user } = req;

    // Clear all cached connections for this session
    closeDashboardConnection(user.sessionId);
    
    res.json({ 
      success: true, 
      message: 'All cached connections for this session have been cleared.'
    });
  } catch (error) {
    console.error('Clear all connections error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/connections/cache-stats
 * Get connection cache statistics (for debugging)
 */
connectionRoutes.get('/cache-stats', async (req, res) => {
  try {
    const stats = getConnectionCacheStats();
    res.json(stats);
  } catch (error) {
    console.error('Get cache stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default connectionRoutes;
