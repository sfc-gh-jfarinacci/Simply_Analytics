/**
 * Folder Routes - API endpoints for dashboard folder management
 */

import express from 'express';
import * as folderService from '../services/folderService.js';

const router = express.Router();

/**
 * GET /api/v1/folders
 * Get all folders for the current user
 */
router.get('/', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    const folders = await folderService.getFoldersForUser(req.user.id, req.user.role, workspaceId || null);
    res.json(folders);
  } catch (error) {
    console.error('Error getting folders:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/folders/contents
 * Get folder contents (folders + dashboards) at root level
 */
router.get('/contents', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    const contents = await folderService.getFolderContents(req.user.id, req.user.role, null, workspaceId || null);
    res.json(contents);
  } catch (error) {
    console.error('Error getting folder contents:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/folders/:id/contents
 * Get folder contents (subfolders + dashboards) for a specific folder
 */
router.get('/:id/contents', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    const contents = await folderService.getFolderContents(req.user.id, req.user.role, req.params.id, workspaceId || null);
    const folder = await folderService.getFolderById(req.params.id);
    const path = await folderService.getFolderPath(req.params.id);
    
    res.json({
      folder,
      path,
      ...contents
    });
  } catch (error) {
    console.error('Error getting folder contents:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/folders/:id
 * Get a specific folder by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const folder = await folderService.getFolderById(req.params.id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    const path = await folderService.getFolderPath(req.params.id);
    res.json({ ...folder, path });
  } catch (error) {
    console.error('Error getting folder:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/folders/:id/path
 * Get the path (breadcrumb) for a folder
 */
router.get('/:id/path', async (req, res) => {
  try {
    const path = await folderService.getFolderPath(req.params.id);
    res.json(path);
  } catch (error) {
    console.error('Error getting folder path:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/folders
 * Create a new folder
 */
router.post('/', async (req, res) => {
  try {
    // Only owners, admins, and editors can create folders
    if (!['owner', 'admin', 'developer'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to create folders' });
    }
    
    const { name, description, parentId, workspaceId, icon, color } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    const folder = await folderService.createFolder({
      name: name.trim(),
      description,
      parentId,
      ownerId: req.user.id,
      workspaceId,
      icon,
      color
    });
    
    res.status(201).json(folder);
  } catch (error) {
    console.error('Error creating folder:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/folders/:id
 * Update a folder
 */
router.put('/:id', async (req, res) => {
  try {
    const folder = await folderService.getFolderById(req.params.id);
    
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Only owner or admins can update folders
    if (folder.owner_id !== req.user.id && !['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to update this folder' });
    }
    
    const { name, description, icon, color } = req.body;
    
    const updated = await folderService.updateFolder(req.params.id, {
      name,
      description,
      icon,
      color,
    });
    
    res.json(updated);
  } catch (error) {
    console.error('Error updating folder:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/folders/:id
 * Delete a folder
 */
router.delete('/:id', async (req, res) => {
  try {
    const folder = await folderService.getFolderById(req.params.id);
    
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Only owner or admins can delete folders
    if (folder.owner_id !== req.user.id && !['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to delete this folder' });
    }
    
    await folderService.deleteFolder(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting folder:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/v1/folders/search
 * Search folders and dashboards
 */
router.post('/search', async (req, res) => {
  try {
    const { query: searchTerm, workspaceId } = req.body;
    
    if (!searchTerm || searchTerm.trim().length < 2) {
      return res.json({ folders: [], dashboards: [] });
    }
    
    const results = await folderService.searchFoldersAndDashboards(
      req.user.id,
      req.user.role,
      searchTerm.trim(),
      workspaceId || null
    );
    
    res.json(results);
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/folders/move-dashboard/:dashboardId
 * Move a dashboard to a folder
 */
router.put('/move-dashboard/:dashboardId', async (req, res) => {
  try {
    const { folderId } = req.body;
    
    const updated = await folderService.moveDashboardToFolder(
      req.params.dashboardId,
      folderId // null = move to root
    );
    
    if (!updated) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }
    
    res.json(updated);
  } catch (error) {
    console.error('Error moving dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
