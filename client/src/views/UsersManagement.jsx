/**
 * Users Management Component
 * 
 * Admin interface for managing users, roles, groups, and permissions.
 * Only accessible to owners and admins.
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  FiUsers, FiUserPlus, FiEdit2, FiTrash2, FiShield, 
  FiSearch, FiCheck, FiX, FiLoader, FiChevronDown, FiPlus,
  FiUserMinus, FiFolder, FiMoreHorizontal, FiLock, FiUnlock,
  FiAlertTriangle, FiClock, FiRefreshCw
} from 'react-icons/fi';
import { useAppStore } from '../store/appStore';
import { userApi, groupApi } from '../api/apiClient';
import { useToast } from '../components/Toast';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import '../styles/UsersManagement.css';

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  creator: 'Editor',
  viewer: 'Viewer',
};

const ROLE_COLORS = {
  owner: '#8b5cf6',
  admin: '#3b82f6',
  creator: '#10b981',
  viewer: '#6b7280',
};

// Individual User Row Component with action menu
const UserRow = ({ 
  user, 
  currentUser, 
  currentRole, 
  canManageUsers,
  canDelete,
  onUpdateRole, 
  onEdit, 
  onDelete,
  onTransferOwnership,
  onLockAccount,
  onUnlockAccount,
  onMfaBypass,
  onResetMfa,
  assignableRoles 
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleMenuToggle = () => {
    if (!menuOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right - 180 // menu width
      });
    }
    setMenuOpen(!menuOpen);
  };

  const formatLastActive = (date) => {
    if (!date) return 'Never';
    const d = new Date(date);
    const day = d.getDate();
    const month = d.toLocaleString('default', { month: 'short' });
    return `${day} ${month}`;
  };

  // Check if we can manage this user's security
  const canManageSecurity = canManageUsers && user.username !== currentUser && 
    (currentRole === 'owner' || (currentRole === 'admin' && !['owner', 'admin'].includes(user.role)));

  return (
    <tr className={`${!user.is_active ? 'row-inactive' : ''} ${user.account_locked ? 'row-locked' : ''}`}>
      <td className="col-name">
        <div className="user-cell">
          <div className="user-avatar" style={{ background: `linear-gradient(135deg, ${ROLE_COLORS[user.role]}88, ${ROLE_COLORS[user.role]})` }}>
            {(user.display_name || user.username || '?')[0].toUpperCase()}
          </div>
          <div className="user-details">
            <span className="user-name">
              {user.display_name || user.username}
              {user.account_locked && <FiLock className="status-icon locked" title="Account Locked" />}
              {user.mfa_bypass_until && new Date(user.mfa_bypass_until) > new Date() && (
                <FiClock className="status-icon bypass" title="MFA Bypassed" />
              )}
            </span>
            <span className="user-email">{user.email}</span>
          </div>
        </div>
      </td>
      <td className="col-role">
        {canManageUsers && user.username !== currentUser ? (
          <div className="role-dropdown">
            <select
              value={user.role}
              onChange={(e) => onUpdateRole(user.id, e.target.value)}
              className="role-select"
            >
              {assignableRoles.map(role => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
            <FiChevronDown className="dropdown-icon" />
          </div>
        ) : (
          <span className="role-label">{ROLE_LABELS[user.role]}</span>
        )}
      </td>
      <td className="col-status">
        <div className="status-badges">
          {user.totp_enabled && <span className="badge badge-mfa" title="TOTP Enabled">TOTP</span>}
          {user.passkey_enabled && <span className="badge badge-mfa" title="Passkey Enabled">Passkey</span>}
          {!user.totp_enabled && !user.passkey_enabled && (
            <span className="badge badge-warning" title="No MFA">No MFA</span>
          )}
        </div>
      </td>
      <td className="col-active">{formatLastActive(user.last_login)}</td>
      <td className="col-settings">
        {canManageUsers && (
          <div className="settings-menu">
            <button 
              ref={triggerRef}
              className="menu-trigger" 
              onClick={handleMenuToggle}
            >
              <FiMoreHorizontal />
            </button>
            {menuOpen && (
              <div 
                ref={menuRef}
                className="menu-dropdown"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                <button onClick={() => { onEdit(user); setMenuOpen(false); }}>
                  <FiEdit2 /> Edit User
                </button>
                
                {/* Security actions - only for manageable users */}
                {canManageSecurity && (
                  <>
                    <div className="menu-divider" />
                    {user.account_locked ? (
                      <button onClick={() => { onUnlockAccount(user); setMenuOpen(false); }}>
                        <FiUnlock /> Unlock Account
                      </button>
                    ) : (
                      <button className="warning" onClick={() => { onLockAccount(user); setMenuOpen(false); }}>
                        <FiLock /> Lock Account
                      </button>
                    )}
                    {(user.totp_enabled || user.passkey_enabled) && (
                      <>
                        <button onClick={() => { onMfaBypass(user); setMenuOpen(false); }}>
                          <FiClock /> Bypass MFA (4h)
                        </button>
                        {currentRole === 'owner' && (
                          <button className="warning" onClick={() => { onResetMfa(user); setMenuOpen(false); }}>
                            <FiRefreshCw /> Reset MFA
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
                
                {/* Transfer Ownership - only shown to owner for admin users */}
                {currentRole === 'owner' && user.role === 'admin' && (
                  <>
                    <div className="menu-divider" />
                    <button className="transfer" onClick={() => { onTransferOwnership(user); setMenuOpen(false); }}>
                      <FiShield /> Transfer Ownership
                    </button>
                  </>
                )}
                
                {canDelete && (
                  <>
                    <div className="menu-divider" />
                    <button className="danger" onClick={() => { onDelete(); setMenuOpen(false); }}>
                      <FiTrash2 /> Delete User
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
};

const UsersManagement = () => {
  const { currentUser, currentRole } = useAppStore();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('users');
  
  // Users state
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Groups state
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showTransferOwnershipModal, setShowTransferOwnershipModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [transferError, setTransferError] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferConfirmText, setTransferConfirmText] = useState('');
  const [transferTargetUser, setTransferTargetUser] = useState(null);
  
  // Security action states
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showMfaBypassModal, setShowMfaBypassModal] = useState(false);
  const [showTransferDashboardsModal, setShowTransferDashboardsModal] = useState(false);
  const [userDashboards, setUserDashboards] = useState([]);
  const [dashboardTransferTarget, setDashboardTransferTarget] = useState('');
  const [securityActionLoading, setSecurityActionLoading] = useState(false);
  const [unlockDuration, setUnlockDuration] = useState(null); // null = permanent, number = hours
  const [mfaBypassHours, setMfaBypassHours] = useState(4);
  
  // Form state
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    displayName: '',
    role: 'viewer',
  });
  const [groupFormData, setGroupFormData] = useState({
    name: '',
    description: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState(null);
  
  // Add member state
  const [selectedUserToAdd, setSelectedUserToAdd] = useState('');
  
  // Delete confirmation state
  const [groupToDelete, setGroupToDelete] = useState(null);
  
  // Group name validation
  const isGroupNameTaken = (name, excludeId = null) => {
    if (!name || !name.trim()) return false;
    return groups.some(g => 
      g.name.toLowerCase() === name.trim().toLowerCase() && g.id !== excludeId
    );
  };

  // Close create group modal and clear form
  const closeCreateGroupModal = () => {
    setShowCreateGroupModal(false);
    setGroupFormData({ name: '', description: '' });
    setFormError(null);
  };

  // Close edit group modal and clear form
  const closeEditGroupModal = () => {
    setShowEditGroupModal(false);
    setGroupFormData({ name: '', description: '' });
    setFormError(null);
  };

  // Load users on mount
  useEffect(() => {
    loadUsers();
    loadGroups();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await userApi.getAll();
      setUsers(response.users || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      setGroupsLoading(true);
      const response = await groupApi.getAll();
      setGroups(response.groups || []);
    } catch (err) {
      console.error('Failed to load groups:', err);
    } finally {
      setGroupsLoading(false);
    }
  };

  const loadGroupMembers = async (groupId) => {
    try {
      setGroupMembersLoading(true);
      const response = await groupApi.getMembers(groupId);
      setGroupMembers(response.members || []);
    } catch (err) {
      console.error('Failed to load group members:', err);
    } finally {
      setGroupMembersLoading(false);
    }
  };

  const handleSelectGroup = (group) => {
    setSelectedGroup(group);
    loadGroupMembers(group.id);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);

    try {
      await userApi.create(formData);
      await loadUsers();
      setShowCreateModal(false);
      resetForm();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateRole = async (userId, newRole) => {
    try {
      await userApi.updateRole(userId, newRole);
      await loadUsers();
      toast.success('Role updated successfully');
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Password validation helper
  const validatePassword = (password) => {
    const errors = [];
    if (password.length < 14) errors.push('at least 14 characters');
    if (!/[A-Z]/.test(password)) errors.push('1 uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('1 lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('1 number');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('1 special character');
    return errors;
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeleteError(null);

    try {
      await userApi.delete(userToDelete.id);
      await loadUsers();
      setUserToDelete(null);
    } catch (err) {
      // Check if it's a dashboard ownership error
      if (err.message.includes('dashboard')) {
        // Fetch user's dashboards and show transfer modal
        try {
          const { dashboards } = await userApi.getUserDashboards(userToDelete.id);
          setUserDashboards(dashboards);
          setShowTransferDashboardsModal(true);
        } catch {
          setDeleteError(err.message);
        }
      } else {
        setDeleteError(err.message);
      }
    }
  };

  // Security action handlers
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [userToLock, setUserToLock] = useState(null);

  const handleLockAccount = (user) => {
    setUserToLock(user);
    setShowLockConfirm(true);
  };

  const confirmLockAccount = async () => {
    if (!userToLock) return;
    
    try {
      await userApi.lockAccount(userToLock.id, 'admin_action');
      await loadUsers();
      toast.success(`Account locked for ${userToLock.display_name || userToLock.username}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setShowLockConfirm(false);
      setUserToLock(null);
    }
  };

  const openUnlockModal = (user) => {
    setSelectedUser(user);
    setUnlockDuration(null);
    setShowUnlockModal(true);
  };

  const handleUnlockAccount = async () => {
    if (!selectedUser) return;
    setSecurityActionLoading(true);
    
    try {
      await userApi.unlockAccount(selectedUser.id, unlockDuration);
      await loadUsers();
      setShowUnlockModal(false);
      toast.success(`Account unlocked for ${selectedUser.display_name || selectedUser.username}`);
      setSelectedUser(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSecurityActionLoading(false);
    }
  };

  const openMfaBypassModal = (user) => {
    setSelectedUser(user);
    setMfaBypassHours(4);
    setShowMfaBypassModal(true);
  };

  const handleMfaBypass = async () => {
    if (!selectedUser) return;
    setSecurityActionLoading(true);
    
    try {
      await userApi.setMfaBypass(selectedUser.id, mfaBypassHours, 'admin_granted');
      await loadUsers();
      setShowMfaBypassModal(false);
      toast.success(`MFA bypassed for ${mfaBypassHours} hours. User can now login without MFA.`);
      setSelectedUser(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSecurityActionLoading(false);
    }
  };

  const [showResetMfaConfirm, setShowResetMfaConfirm] = useState(false);
  const [userToResetMfa, setUserToResetMfa] = useState(null);

  const handleResetMfa = (user) => {
    setUserToResetMfa(user);
    setShowResetMfaConfirm(true);
  };

  const confirmResetMfa = async () => {
    if (!userToResetMfa) return;
    
    try {
      await userApi.reset2fa(userToResetMfa.id);
      await loadUsers();
      toast.success('MFA has been reset. User will need to set up MFA again within the grace period.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setShowResetMfaConfirm(false);
      setUserToResetMfa(null);
    }
  };

  const handleTransferDashboards = async () => {
    if (!userToDelete || !dashboardTransferTarget) return;
    setSecurityActionLoading(true);
    
    try {
      await userApi.transferDashboards(userToDelete.id, dashboardTransferTarget);
      setShowTransferDashboardsModal(false);
      setUserDashboards([]);
      setDashboardTransferTarget('');
      // Now try to delete the user again
      await userApi.delete(userToDelete.id);
      await loadUsers();
      toast.success('Dashboards transferred and user deleted');
      setUserToDelete(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSecurityActionLoading(false);
    }
  };

  // Role hierarchy for permission checks
  const ROLE_HIERARCHY = { owner: 4, admin: 3, creator: 2, viewer: 1 };
  
  // Check if current user can delete a specific user
  const canDeleteUser = (targetUser) => {
    if (!['owner', 'admin'].includes(currentRole)) return false;
    if (targetUser.username === currentUser) return false;
    const myLevel = ROLE_HIERARCHY[currentRole] || 0;
    const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
    return myLevel > targetLevel;
  };

  // Group handlers
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);

    try {
      await groupApi.create(groupFormData);
      await loadGroups();
      closeCreateGroupModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateGroup = async (e) => {
    e.preventDefault();
    if (!selectedGroup) return;
    
    setFormLoading(true);
    setFormError(null);

    try {
      await groupApi.update(selectedGroup.id, groupFormData);
      await loadGroups();
      closeEditGroupModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupToDelete) return;

    try {
      await groupApi.delete(groupToDelete.id);
      await loadGroups();
      if (selectedGroup?.id === groupToDelete.id) {
        setSelectedGroup(null);
        setGroupMembers([]);
      }
      toast.success(`Group "${groupToDelete.name}" deleted`);
      setGroupToDelete(null);
    } catch (err) {
      toast.error(err.message);
      setGroupToDelete(null);
    }
  };

  const handleAddMember = async () => {
    if (!selectedGroup || !selectedUserToAdd) return;

    try {
      await groupApi.addMember(selectedGroup.id, selectedUserToAdd);
      await loadGroupMembers(selectedGroup.id);
      await loadGroups(); // Refresh member count
      setShowAddMemberModal(false);
      setSelectedUserToAdd('');
      toast.success('Member added to group');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const [memberToRemove, setMemberToRemove] = useState(null);

  const handleRemoveMember = (userId) => {
    if (!selectedGroup) return;
    setMemberToRemove(userId);
  };

  const confirmRemoveMember = async () => {
    if (!selectedGroup || !memberToRemove) return;

    try {
      await groupApi.removeMember(selectedGroup.id, memberToRemove);
      await loadGroupMembers(selectedGroup.id);
      await loadGroups(); // Refresh member count
      toast.success('Member removed from group');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMemberToRemove(null);
    }
  };

  const openEditGroupModal = (group) => {
    setSelectedGroup(group);
    setGroupFormData({
      name: group.name,
      description: group.description || '',
    });
    setShowEditGroupModal(true);
  };

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      password: '',
      displayName: '',
      role: 'viewer',
    });
    setFormError(null);
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setFormData({
      username: user.username || '',
      displayName: user.display_name || '',
      email: user.email || '',
      password: '', // Only set if changing
    });
    setFormError(null);
    setShowEditModal(true);
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    setFormError(null);

    // Validate password if provided
    if (formData.password) {
      const passwordErrors = validatePassword(formData.password);
      if (passwordErrors.length > 0) {
        setFormError(`Password must have: ${passwordErrors.join(', ')}`);
        return;
      }
    }

    setFormLoading(true);

    try {
      const updates = {};
      if (formData.displayName !== selectedUser.display_name) {
        updates.display_name = formData.displayName;
      }
      if (formData.email !== selectedUser.email) {
        updates.email = formData.email;
      }
      if (formData.username !== selectedUser.username) {
        updates.username = formData.username;
      }
      
      // Use admin update for other users
      if (selectedUser.username !== currentUser) {
        if (Object.keys(updates).length > 0) {
          await userApi.adminUpdate(selectedUser.id, updates);
        }
        // Handle password change separately
        if (formData.password) {
          await userApi.resetPassword(selectedUser.id, formData.password);
        }
      } else {
        // Self update
        if (Object.keys(updates).length > 0) {
          await userApi.update(selectedUser.id, updates);
        }
      }
      
      await loadUsers();
      setShowEditModal(false);
      resetForm();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  // Transfer Ownership Modal handlers
  const openTransferOwnershipModal = (user) => {
    setTransferTargetUser(user);
    setTransferConfirmText('');
    setTransferError(null);
    setShowTransferOwnershipModal(true);
  };

  const closeTransferOwnershipModal = () => {
    setShowTransferOwnershipModal(false);
    setTransferTargetUser(null);
    setTransferConfirmText('');
    setTransferError(null);
  };

  const handleTransferOwnership = async () => {
    if (!transferTargetUser) {
      setTransferError('Please select a user to transfer ownership to');
      return;
    }
    
    if (transferConfirmText !== transferTargetUser.username) {
      setTransferError('Please type the username exactly to confirm');
      return;
    }

    setTransferLoading(true);
    setTransferError(null);

    try {
      await userApi.transferOwnership(transferTargetUser.id);
      // Refresh users list
      await loadUsers();
      closeTransferOwnershipModal();
      // The current user is no longer owner - they'll see the change on reload
      window.location.reload(); // Force reload to update currentRole
    } catch (err) {
      setTransferError(err.message || 'Failed to transfer ownership');
    } finally {
      setTransferLoading(false);
    }
  };

  // Filter users based on search
  const filteredUsers = users.filter(user => 
    user.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get users not in the selected group
  const availableUsersForGroup = users.filter(user => 
    !groupMembers.some(member => member.id === user.id)
  );

  // Check if current user can create/manage users
  // Only owner and admin can access user management
  const canManageUsers = ['owner', 'admin'].includes(currentRole);
  const canCreateUsers = ['owner', 'admin'].includes(currentRole);
  const canManageGroups = ['owner', 'admin'].includes(currentRole);

  // Get available roles for assignment based on current user's role
  // Note: 'owner' is NOT directly assignable - must use Transfer Ownership
  const getAssignableRoles = () => {
    if (currentRole === 'owner') return ['admin', 'creator', 'viewer']; // owner excluded
    if (currentRole === 'admin') return ['creator', 'viewer'];
    if (currentRole === 'creator') return ['viewer'];
    return [];
  };

  // Only owner and admin can access this page
  if (!canManageUsers) {
    return (
      <div className="users-management">
        <div className="access-denied">
          <FiShield size={48} />
          <h2>Access Denied</h2>
          <p>Only administrators can access user management.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="users-management">
      <div className="users-header">
        <div className="header-left">
          <FiUsers className="header-icon" />
          <div>
            <h1>User Management</h1>
            <p>{users.length} users, {groups.length} groups</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="management-tabs">
        <button 
          className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <FiUsers />
          Users
        </button>
        <button 
          className={`tab-btn ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups')}
        >
          <FiFolder />
          Groups
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <FiX />
          {error}
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="tab-content">
          <div className="content-header">
            <div className="search-box">
              <FiSearch />
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {canCreateUsers && (
              <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
                <FiUserPlus />
                Add User
              </button>
            )}
          </div>

          {loading ? (
            <div className="loading-state">
              <FiLoader className="spinner" />
              <p>Loading users...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="empty-users-state">
              <FiUsers size={40} />
              <p>No users found</p>
            </div>
          ) : (
            <div className="users-table-wrapper">
              <table className="users-table">
                <thead>
                  <tr>
                    <th className="col-name">
                      <span className="sortable">NAME</span>
                    </th>
                    <th className="col-role">ROLE</th>
                    <th className="col-status">STATUS</th>
                    <th className="col-active">LAST ACTIVE</th>
                    <th className="col-settings"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(user => (
                    <UserRow 
                      key={user.id}
                      user={user}
                      currentUser={currentUser}
                      currentRole={currentRole}
                      canManageUsers={canManageUsers}
                      canDelete={canDeleteUser(user)}
                      onUpdateRole={handleUpdateRole}
                      onEdit={openEditModal}
                      onDelete={() => setUserToDelete(user)}
                      onTransferOwnership={openTransferOwnershipModal}
                      onLockAccount={handleLockAccount}
                      onUnlockAccount={openUnlockModal}
                      onMfaBypass={openMfaBypassModal}
                      onResetMfa={handleResetMfa}
                      assignableRoles={getAssignableRoles()}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Groups Tab */}
      {activeTab === 'groups' && (
        <div className="tab-content groups-tab">
          {!canManageGroups ? (
            <div className="access-notice">
              <FiShield />
              <p>Only admins can manage groups.</p>
            </div>
          ) : (
            <div className="groups-layout">
              {/* Groups List */}
              <div className="groups-list-panel">
                <div className="panel-header">
                  <h3>Groups</h3>
                  <button className="btn-primary btn-sm" onClick={() => setShowCreateGroupModal(true)}>
                    <FiPlus />
                    New Group
                  </button>
                </div>

                {groupsLoading ? (
                  <div className="loading-state">
                    <FiLoader className="spinner" />
                  </div>
                ) : groups.length === 0 ? (
                  <div className="empty-groups">
                    <FiFolder size={32} />
                    <p>No groups yet</p>
                    <button className="btn-primary btn-sm" onClick={() => setShowCreateGroupModal(true)}>
                      Create First Group
                    </button>
                  </div>
                ) : (
                  <div className="groups-list">
                    {groups.map(group => (
                      <div 
                        key={group.id} 
                        className={`group-item ${selectedGroup?.id === group.id ? 'selected' : ''}`}
                        onClick={() => handleSelectGroup(group)}
                      >
                        <div className="group-info">
                          <div className="group-icon">
                            <FiFolder />
                          </div>
                          <div>
                            <div className="group-name">{group.name}</div>
                            <div className="group-meta">{group.member_count || 0} members</div>
                          </div>
                        </div>
                        <div className="group-actions">
                          <button
                            className="action-btn-sm"
                            onClick={(e) => { e.stopPropagation(); openEditGroupModal(group); }}
                            title="Edit Group"
                          >
                            <FiEdit2 />
                          </button>
                          <button
                            className="action-btn-sm danger"
                            onClick={(e) => { e.stopPropagation(); setGroupToDelete(group); }}
                            title="Delete Group"
                          >
                            <FiTrash2 />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Group Members Panel */}
              <div className="group-members-panel">
                {!selectedGroup ? (
                  <div className="no-selection">
                    <FiUsers size={40} />
                    <p>Select a group to manage members</p>
                  </div>
                ) : (
                  <>
                    <div className="panel-header">
                      <div>
                        <h3>{selectedGroup.name}</h3>
                        {selectedGroup.description && (
                          <p className="group-description">{selectedGroup.description}</p>
                        )}
                      </div>
                      <button 
                        className="btn-primary btn-sm"
                        onClick={() => setShowAddMemberModal(true)}
                      >
                        <FiUserPlus />
                        Add Member
                      </button>
                    </div>

                    {groupMembersLoading ? (
                      <div className="loading-state">
                        <FiLoader className="spinner" />
                      </div>
                    ) : groupMembers.length === 0 ? (
                      <div className="empty-members">
                        <FiUsers size={32} />
                        <p>No members in this group</p>
                        <button 
                          className="btn-primary btn-sm"
                          onClick={() => setShowAddMemberModal(true)}
                        >
                          Add First Member
                        </button>
                      </div>
                    ) : (
                      <div className="members-list">
                        {groupMembers.map(member => (
                          <div key={member.id} className="member-item">
                            <div className="member-info">
                              <div className="user-avatar">
                                {(member.display_name || member.username || '?')[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="member-name">{member.display_name || member.username}</div>
                                <div className="member-email">{member.email}</div>
                              </div>
                            </div>
                            <span 
                              className="role-badge"
                              style={{ backgroundColor: ROLE_COLORS[member.role] }}
                            >
                              {ROLE_LABELS[member.role]}
                            </span>
                            <button
                              className="remove-member-btn"
                              onClick={() => handleRemoveMember(member.id)}
                              title="Remove from group"
                            >
                              <FiUserMinus />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiUserPlus /> Create New User</h2>
              <button className="close-btn" onClick={() => setShowCreateModal(false)}>
                <FiX />
              </button>
            </div>
            
            <form onSubmit={handleCreateUser}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}
                
                <div className="form-group">
                  <label>Username *</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={e => setFormData({...formData, username: e.target.value})}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Display Name</label>
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={e => setFormData({...formData, displayName: e.target.value})}
                  />
                </div>
                
                <div className="form-group">
                  <label>Password *</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={e => setFormData({...formData, password: e.target.value})}
                    required
                    minLength={8}
                  />
                </div>
                
                <div className="form-group">
                  <label>Role *</label>
                  <select
                    value={formData.role}
                    onChange={e => setFormData({...formData, role: e.target.value})}
                  >
                    {getAssignableRoles().map(role => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={formLoading}>
                  {formLoading ? <FiLoader className="spinner" /> : <FiCheck />}
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Ownership Modal */}
      {showTransferOwnershipModal && transferTargetUser && (
        <div className="modal-overlay">
          <div className="modal transfer-ownership-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiShield /> Transfer Ownership</h2>
              <button className="close-btn" onClick={closeTransferOwnershipModal}>
                <FiX />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="transfer-warning">
                <span className="warning-icon">⚠️</span>
                <div className="warning-text">
                  <strong>This action is irreversible!</strong>
                  <p>You will become an admin, and <strong>{transferTargetUser.display_name || transferTargetUser.username}</strong> will become the new owner.</p>
                </div>
              </div>

              {transferError && <div className="form-error">{transferError}</div>}
              
              <div className="form-group">
                <label>Transfer ownership to</label>
                {/* User Card - immutable */}
                <div className="selected-user-card">
                  <div className="user-avatar" style={{ background: `linear-gradient(135deg, ${ROLE_COLORS[transferTargetUser.role]}88, ${ROLE_COLORS[transferTargetUser.role]})` }}>
                    {(transferTargetUser.display_name || transferTargetUser.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="user-info">
                    <span className="name">{transferTargetUser.display_name || transferTargetUser.username}</span>
                    <span className="email">{transferTargetUser.email}</span>
                  </div>
                  <span className="role-badge-inline" style={{ color: ROLE_COLORS[transferTargetUser.role] }}>
                    {ROLE_LABELS[transferTargetUser.role]} → Owner
                  </span>
                </div>
              </div>
              
              <div className="form-group">
                <label>Type <strong>{transferTargetUser.username}</strong> to confirm</label>
                <input
                  type="text"
                  value={transferConfirmText}
                  onChange={e => setTransferConfirmText(e.target.value)}
                  placeholder="Type username to confirm"
                  className={transferConfirmText && transferConfirmText !== transferTargetUser.username ? 'input-error' : ''}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={closeTransferOwnershipModal}>
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-danger" 
                disabled={transferLoading || !transferTargetUser || transferConfirmText !== transferTargetUser?.username}
                onClick={handleTransferOwnership}
              >
                {transferLoading ? <FiLoader className="spinner" /> : <FiShield />}
                Transfer Ownership
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateGroupModal && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiFolder /> Create New Group</h2>
              <button className="close-btn" onClick={closeCreateGroupModal}>
                <FiX />
              </button>
            </div>
            
            <form onSubmit={handleCreateGroup}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}
                
                <div className={`form-group ${isGroupNameTaken(groupFormData.name) ? 'has-error' : ''}`}>
                  <label>Group Name *</label>
                  <input
                    type="text"
                    value={groupFormData.name}
                    onChange={e => setGroupFormData({...groupFormData, name: e.target.value})}
                    placeholder="e.g., Marketing Team"
                    className={isGroupNameTaken(groupFormData.name) ? 'input-error' : ''}
                    required
                  />
                  {isGroupNameTaken(groupFormData.name) && (
                    <span className="field-error">A group with this name already exists</span>
                  )}
                </div>
                
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={groupFormData.description}
                    onChange={e => setGroupFormData({...groupFormData, description: e.target.value})}
                    placeholder="Optional description"
                    rows={3}
                  />
                </div>
              </div>
              
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={closeCreateGroupModal}>
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={formLoading || !groupFormData.name.trim() || isGroupNameTaken(groupFormData.name)}
                >
                  {formLoading ? <FiLoader className="spinner" /> : <FiCheck />}
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {showEditGroupModal && selectedGroup && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiEdit2 /> Edit Group</h2>
              <button className="close-btn" onClick={closeEditGroupModal}>
                <FiX />
              </button>
            </div>
            
            <form onSubmit={handleUpdateGroup}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}
                
                <div className={`form-group ${isGroupNameTaken(groupFormData.name, selectedGroup.id) ? 'has-error' : ''}`}>
                  <label>Group Name *</label>
                  <input
                    type="text"
                    value={groupFormData.name}
                    onChange={e => setGroupFormData({...groupFormData, name: e.target.value})}
                    className={isGroupNameTaken(groupFormData.name, selectedGroup.id) ? 'input-error' : ''}
                    required
                  />
                  {isGroupNameTaken(groupFormData.name, selectedGroup.id) && (
                    <span className="field-error">A group with this name already exists</span>
                  )}
                </div>
                
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={groupFormData.description}
                    onChange={e => setGroupFormData({...groupFormData, description: e.target.value})}
                    rows={3}
                  />
                </div>
              </div>
              
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={closeEditGroupModal}>
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={formLoading || !groupFormData.name.trim() || isGroupNameTaken(groupFormData.name, selectedGroup.id)}
                >
                  {formLoading ? <FiLoader className="spinner" /> : <FiCheck />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && selectedGroup && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiUserPlus /> Add Member to {selectedGroup.name}</h2>
              <button className="close-btn" onClick={() => setShowAddMemberModal(false)}>
                <FiX />
              </button>
            </div>
            
            <div className="modal-body">
              {availableUsersForGroup.length === 0 ? (
                <p className="no-users-available">All users are already in this group.</p>
              ) : (
                <div className="form-group">
                  <label>Select User</label>
                  <select
                    value={selectedUserToAdd}
                    onChange={e => setSelectedUserToAdd(e.target.value)}
                  >
                    <option value="">Choose a user...</option>
                    {availableUsersForGroup.map(user => (
                      <option key={user.id} value={user.id}>
                        {user.display_name || user.username} ({user.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowAddMemberModal(false)}>
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-primary" 
                onClick={handleAddMember}
                disabled={!selectedUserToAdd}
              >
                <FiCheck />
                Add Member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Confirmation */}
      {groupToDelete && (
        <ConfirmDeleteModal
          itemName={groupToDelete.name}
          itemType="group"
          onConfirm={handleDeleteGroup}
          onCancel={() => setGroupToDelete(null)}
        />
      )}

      {/* Delete User Confirmation */}
      {userToDelete && !showTransferDashboardsModal && (
        <ConfirmDeleteModal
          itemName={userToDelete.display_name || userToDelete.username}
          itemType="user"
          onConfirm={handleDeleteUser}
          onCancel={() => { setUserToDelete(null); setDeleteError(null); }}
          error={deleteError}
        />
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiEdit2 /> Edit User</h2>
              <button className="close-btn" onClick={() => setShowEditModal(false)}>
                <FiX />
              </button>
            </div>
            
            <form onSubmit={handleEditUser}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}
                
                {/* Only allow username change for other users if admin/owner */}
                {selectedUser.username !== currentUser && (
                  <div className="form-group">
                    <label>Username</label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={e => setFormData({...formData, username: e.target.value})}
                    />
                  </div>
                )}
                
                <div className="form-group">
                  <label>Display Name</label>
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={e => setFormData({...formData, displayName: e.target.value})}
                  />
                </div>
                
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                  />
                </div>
                
                {/* Only show password field when editing other users */}
                {selectedUser.username !== currentUser && (
                  <div className="form-group">
                    <label>New Password (leave blank to keep current)</label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={e => setFormData({...formData, password: e.target.value})}
                      placeholder="Enter new password..."
                      minLength={14}
                    />
                    <span className="field-hint">Min 14 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char</span>
                  </div>
                )}
              </div>
              
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={formLoading}>
                  {formLoading ? <FiLoader className="spinner" /> : <FiCheck />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unlock Account Modal */}
      {showUnlockModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiUnlock /> Unlock Account</h2>
              <button className="close-btn" onClick={() => setShowUnlockModal(false)}>
                <FiX />
              </button>
            </div>
            
            <div className="modal-body">
              <p>Unlock account for <strong>{selectedUser.display_name || selectedUser.username}</strong></p>
              
              <div className="form-group">
                <label>Unlock Duration</label>
                <select 
                  value={unlockDuration || ''} 
                  onChange={e => setUnlockDuration(e.target.value ? parseInt(e.target.value) : null)}
                >
                  <option value="">Permanent (until manually locked)</option>
                  <option value="1">1 hour</option>
                  <option value="4">4 hours</option>
                  <option value="8">8 hours</option>
                  <option value="24">24 hours</option>
                </select>
              </div>
              
              {selectedUser.account_locked_reason && (
                <div className="info-box warning">
                  <FiAlertTriangle />
                  <span>Locked reason: {selectedUser.account_locked_reason}</span>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowUnlockModal(false)}>
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-primary" 
                onClick={handleUnlockAccount}
                disabled={securityActionLoading}
              >
                {securityActionLoading ? <FiLoader className="spinner" /> : <FiUnlock />}
                Unlock Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MFA Bypass Modal */}
      {showMfaBypassModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiClock /> MFA Bypass</h2>
              <button className="close-btn" onClick={() => setShowMfaBypassModal(false)}>
                <FiX />
              </button>
            </div>
            
            <div className="modal-body">
              <p>Allow <strong>{selectedUser.display_name || selectedUser.username}</strong> to login without MFA for a temporary period.</p>
              <p className="text-muted">This is useful when the user has lost access to their authenticator.</p>
              
              <div className="form-group">
                <label>Bypass Duration (max 4 hours)</label>
                <select 
                  value={mfaBypassHours} 
                  onChange={e => setMfaBypassHours(parseInt(e.target.value))}
                >
                  <option value="1">1 hour</option>
                  <option value="2">2 hours</option>
                  <option value="3">3 hours</option>
                  <option value="4">4 hours</option>
                </select>
              </div>
            </div>
            
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowMfaBypassModal(false)}>
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-primary" 
                onClick={handleMfaBypass}
                disabled={securityActionLoading}
              >
                {securityActionLoading ? <FiLoader className="spinner" /> : <FiClock />}
                Set Bypass
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Dashboards Modal */}
      {showTransferDashboardsModal && userToDelete && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiAlertTriangle /> Transfer Dashboards</h2>
              <button className="close-btn" onClick={() => { 
                setShowTransferDashboardsModal(false); 
                setUserDashboards([]); 
                setDashboardTransferTarget('');
              }}>
                <FiX />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="info-box warning">
                <FiAlertTriangle />
                <span>
                  <strong>{userToDelete.display_name || userToDelete.username}</strong> owns {userDashboards.length} dashboard(s). 
                  Transfer ownership before deleting.
                </span>
              </div>
              
              <div className="dashboard-list">
                {userDashboards.map(d => (
                  <div key={d.id} className="dashboard-item">
                    <FiFolder />
                    <span>{d.name}</span>
                  </div>
                ))}
              </div>
              
              <div className="form-group">
                <label>Transfer to</label>
                <select 
                  value={dashboardTransferTarget} 
                  onChange={e => setDashboardTransferTarget(e.target.value)}
                >
                  <option value="">Select a user...</option>
                  {users
                    .filter(u => u.id !== userToDelete.id && u.is_active)
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.display_name || u.username} ({ROLE_LABELS[u.role]})
                      </option>
                    ))
                  }
                </select>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={() => { 
                  setShowTransferDashboardsModal(false); 
                  setUserDashboards([]); 
                  setDashboardTransferTarget('');
                  setUserToDelete(null);
                }}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-danger" 
                onClick={handleTransferDashboards}
                disabled={securityActionLoading || !dashboardTransferTarget}
              >
                {securityActionLoading ? <FiLoader className="spinner" /> : <FiCheck />}
                Transfer & Delete User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lock Account Confirmation */}
      {showLockConfirm && userToLock && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiLock /> Lock Account</h2>
              <button className="close-btn" onClick={() => { setShowLockConfirm(false); setUserToLock(null); }}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p>Lock account for <strong>{userToLock.display_name || userToLock.username}</strong>?</p>
              <p className="text-muted">This user will not be able to sign in until unlocked.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setShowLockConfirm(false); setUserToLock(null); }}>
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmLockAccount}>
                <FiLock /> Lock Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset MFA Confirmation */}
      {showResetMfaConfirm && userToResetMfa && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiRefreshCw /> Reset MFA</h2>
              <button className="close-btn" onClick={() => { setShowResetMfaConfirm(false); setUserToResetMfa(null); }}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p>Reset all MFA methods for <strong>{userToResetMfa.display_name || userToResetMfa.username}</strong>?</p>
              <p className="text-muted">They will need to set up MFA again within the grace period.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setShowResetMfaConfirm(false); setUserToResetMfa(null); }}>
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmResetMfa}>
                <FiRefreshCw /> Reset MFA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Member Confirmation */}
      {memberToRemove && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiUserMinus /> Remove Member</h2>
              <button className="close-btn" onClick={() => setMemberToRemove(null)}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p>Remove this user from the group?</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setMemberToRemove(null)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmRemoveMember}>
                <FiUserMinus /> Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersManagement;
