/**
 * User Group Routes
 * 
 * Manages user groups for dashboard sharing.
 */

import { Router } from 'express';
import groupService from '../services/groupService.js';

export const groupRoutes = Router();

/**
 * GET /api/groups
 * Get all groups
 */
groupRoutes.get('/', async (req, res) => {
  try {
    const groups = await groupService.getAllGroups();
    res.json({ groups });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/groups/my-groups
 * Get groups the current user belongs to
 */
groupRoutes.get('/my-groups', async (req, res) => {
  try {
    const { user } = req;
    const groups = await groupService.getGroupsForUser(user.id);
    res.json({ groups });
  } catch (error) {
    console.error('Get my groups error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/groups/:id
 * Get a specific group
 */
groupRoutes.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const group = await groupService.getGroupById(id);
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ group });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/groups/:id/members
 * Get members of a group
 */
groupRoutes.get('/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const members = await groupService.getGroupMembers(id);
    res.json({ members });
  } catch (error) {
    console.error('Get group members error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/groups
 * Create a new group
 */
groupRoutes.post('/', async (req, res) => {
  try {
    const { user } = req;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // Only owner and admin can create groups
    if (!['owner', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only admins can create groups' });
    }

    const group = await groupService.createGroup({
      name,
      description,
      createdBy: user.id,
    });

    res.status(201).json({ group });
  } catch (error) {
    console.error('Create group error:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'A group with this name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/groups/:id
 * Update a group (owner and admin only)
 */
groupRoutes.put('/:id', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;
    const updates = req.body;

    // Only owner and admin can update groups
    if (!['owner', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only admins can update groups' });
    }

    const group = await groupService.updateGroup(id, updates, user);
    res.json({ group });
  } catch (error) {
    console.error('Update group error:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'A group with this name already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/groups/:id
 * Delete a group (owner and admin only)
 */
groupRoutes.delete('/:id', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;

    // Only owner and admin can delete groups
    if (!['owner', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only admins can delete groups' });
    }

    await groupService.deleteGroup(id, user);
    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/groups/:id/members
 * Add a user to a group (owner and admin only)
 */
groupRoutes.post('/:id/members', async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;
    const { userId } = req.body;

    // Only owner and admin can add members to groups
    if (!['owner', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only admins can manage group members' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    await groupService.addUserToGroup(id, userId, user.id);
    res.json({ success: true, message: 'User added to group' });
  } catch (error) {
    console.error('Add group member error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/groups/:id/members/:userId
 * Remove a user from a group (owner and admin only)
 */
groupRoutes.delete('/:id/members/:userId', async (req, res) => {
  try {
    const { user } = req;
    const { id, userId } = req.params;

    // Only owner and admin can remove members from groups
    if (!['owner', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only admins can manage group members' });
    }

    await groupService.removeUserFromGroup(id, userId, user);
    res.json({ success: true, message: 'User removed from group' });
  } catch (error) {
    console.error('Remove group member error:', error);
    res.status(400).json({ error: error.message });
  }
});

export default groupRoutes;
