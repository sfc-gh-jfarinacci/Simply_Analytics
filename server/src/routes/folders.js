/**
 * Folder Routes - API endpoints for dashboard folder management
 */

import express from 'express';
import * as folderService from '../services/folderService.js';

const router = express.Router();

/**
 * GET /api/folders
 * Get all folders for the current user
 */
router.get('/', async (req, res) => {
  try {
    const folders = await folderService.getFoldersForUser(req.user.id, req.user.role);
    res.json(folders);
  } catch (error) {
    console.error('Error getting folders:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/folders/contents
 * Get folder contents (folders + dashboards) at root level
 */
router.get('/contents', async (req, res) => {
  try {
    const contents = await folderService.getFolderContents(req.user.id, req.user.role, null);
    res.json(contents);
  } catch (error) {
    console.error('Error getting folder contents:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/folders/:id/contents
 * Get folder contents (subfolders + dashboards) for a specific folder
 */
router.get('/:id/contents', async (req, res) => {
  try {
    const contents = await folderService.getFolderContents(req.user.id, req.user.role, req.params.id);
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
 * GET /api/folders/:id
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
 * GET /api/folders/:id/path
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
 * POST /api/folders
 * Create a new folder
 */
router.post('/', async (req, res) => {
  try {
    // Only owners, admins, and editors can create folders
    if (!['owner', 'admin', 'creator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to create folders' });
    }
    
    const { name, description, parentId, isPublic, icon, color } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    const folder = await folderService.createFolder({
      name: name.trim(),
      description,
      parentId,
      ownerId: req.user.id,
      isPublic,
      icon,
      color
    });
    
    res.status(201).json(folder);
  } catch (error) {
    console.error('Error creating folder:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'A folder with this name already exists in this location' });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/folders/:id
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
    
    const { name, description, parentId, isPublic, icon, color } = req.body;
    
    const updated = await folderService.updateFolder(req.params.id, {
      name,
      description,
      parentId,
      isPublic,
      icon,
      color
    });
    
    res.json(updated);
  } catch (error) {
    console.error('Error updating folder:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A folder with this name already exists in this location' });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/folders/:id
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
 * POST /api/folders/search
 * Search folders and dashboards
 */
router.post('/search', async (req, res) => {
  try {
    const { query: searchTerm } = req.body;
    
    if (!searchTerm || searchTerm.trim().length < 2) {
      return res.json({ folders: [], dashboards: [] });
    }
    
    const results = await folderService.searchFoldersAndDashboards(
      req.user.id,
      req.user.role,
      searchTerm.trim()
    );
    
    res.json(results);
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/folders/move-dashboard/:dashboardId
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

// ============================================
// FOLDER ACCESS MANAGEMENT
// ============================================

/**
 * GET /api/folders/:id/access
 * Get groups with access to a folder
 */
router.get('/:id/access', async (req, res) => {
  try {
    const groups = await folderService.getFolderGroups(req.params.id);
    res.json({ groups });
  } catch (error) {
    console.error('Error getting folder access:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/folders/:id/access
 * Grant a group access to a folder
 */
router.post('/:id/access', async (req, res) => {
  try {
    // Only folder owner or admin can grant access
    if (!['owner', 'admin'].includes(req.user.role)) {
      const folder = await folderService.getFolderById(req.params.id);
      if (!folder || folder.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Only folder owner or admin can manage access' });
      }
    }
    
    const { groupId } = req.body;
    if (!groupId) {
      return res.status(400).json({ error: 'Group ID is required' });
    }
    
    await folderService.grantFolderAccess(req.params.id, groupId, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error granting folder access:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/folders/:id/access/:groupId
 * Revoke a group's access to a folder
 */
router.delete('/:id/access/:groupId', async (req, res) => {
  try {
    // Only folder owner or admin can revoke access
    if (!['owner', 'admin'].includes(req.user.role)) {
      const folder = await folderService.getFolderById(req.params.id);
      if (!folder || folder.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Only folder owner or admin can manage access' });
      }
    }
    
    await folderService.revokeFolderAccess(req.params.id, req.params.groupId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking folder access:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
