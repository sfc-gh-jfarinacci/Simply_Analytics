import { useState, useEffect } from 'react';
import { userApi, authApi } from '../../../api/apiClient';
import { ROLE_HIERARCHY } from '../constants';

const MFA_MSG = 'Multi-factor authentication is required to manage users. Please set up MFA in Settings.';

function isMfaRequired(err) {
  return err.code === 'MFA_REQUIRED';
}

export const useUserManagement = (currentUser, currentRole, toast) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    username: '', email: '', password: '', displayName: '', role: 'viewer',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [passwordPolicy, setPasswordPolicy] = useState({ minLength: 14, requireUppercase: true, requireLowercase: true, requireNumber: true, requireSpecial: true });

  // Transfer ownership
  const [showTransferOwnershipModal, setShowTransferOwnershipModal] = useState(false);
  const [transferTargetUser, setTransferTargetUser] = useState(null);
  const [transferConfirmText, setTransferConfirmText] = useState('');
  const [transferError, setTransferError] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);

  // Security actions
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [userToLock, setUserToLock] = useState(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showMfaBypassModal, setShowMfaBypassModal] = useState(false);
  const [showResetMfaConfirm, setShowResetMfaConfirm] = useState(false);
  const [userToResetMfa, setUserToResetMfa] = useState(null);
  const [securityActionLoading, setSecurityActionLoading] = useState(false);
  const [unlockDuration, setUnlockDuration] = useState(null);
  const [mfaBypassHours, setMfaBypassHours] = useState(4);

  // Dashboard transfer (pre-delete)
  const [showTransferDashboardsModal, setShowTransferDashboardsModal] = useState(false);
  const [userDashboards, setUserDashboards] = useState([]);
  const [dashboardTransferTarget, setDashboardTransferTarget] = useState('');

  useEffect(() => {
    loadUsers();
    authApi.getPasswordPolicy().then(setPasswordPolicy).catch(() => {});
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

  const resetForm = () => {
    setFormData({ username: '', email: '', password: '', displayName: '', role: 'viewer' });
    setFormError(null);
  };

  const validatePassword = (password) => {
    const p = passwordPolicy;
    const errors = [];
    if (password.length < p.minLength) errors.push(`at least ${p.minLength} characters`);
    if (p.requireUppercase && !/[A-Z]/.test(password)) errors.push('1 uppercase letter');
    if (p.requireLowercase && !/[a-z]/.test(password)) errors.push('1 lowercase letter');
    if (p.requireNumber && !/[0-9]/.test(password)) errors.push('1 number');
    if (p.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('1 special character');
    return errors;
  };

  const getAssignableRoles = () => {
    if (currentRole === 'owner') return ['admin', 'developer', 'viewer'];
    if (currentRole === 'admin') return ['developer', 'viewer'];
    if (currentRole === 'developer') return ['viewer'];
    return [];
  };

  const canDeleteUser = (targetUser) => {
    if (!['owner', 'admin'].includes(currentRole)) return false;
    if (targetUser.username === currentUser) return false;
    const myLevel = ROLE_HIERARCHY[currentRole] || 0;
    const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
    return myLevel > targetLevel;
  };

  const filteredUsers = users.filter(user => 
    user.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // --- CRUD handlers ---
  const handleCreateUser = async (e) => {
    e.preventDefault();
    setFormError(null);

    const passwordErrors = validatePassword(formData.password);
    if (passwordErrors.length > 0) {
      setFormError(`Password must have: ${passwordErrors.join(', ')}`);
      return;
    }

    setFormLoading(true);
    try {
      await userApi.create(formData);
      await loadUsers();
      setShowCreateModal(false);
      resetForm();
    } catch (err) {
      if (isMfaRequired(err)) { setShowCreateModal(false); toast.error(MFA_MSG); }
      else setFormError(err.message);
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
      toast.error(isMfaRequired(err) ? MFA_MSG : err.message);
    }
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setFormData({
      username: user.username || '',
      displayName: user.display_name || '',
      email: user.email || '',
      password: '',
    });
    setFormError(null);
    setShowEditModal(true);
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    setFormError(null);

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
      if (formData.displayName !== selectedUser.display_name) updates.display_name = formData.displayName;
      if (formData.email !== selectedUser.email) updates.email = formData.email;
      if (formData.username !== selectedUser.username) updates.username = formData.username;
      
      if (selectedUser.username !== currentUser) {
        if (Object.keys(updates).length > 0) await userApi.adminUpdate(selectedUser.id, updates);
        if (formData.password) await userApi.resetPassword(selectedUser.id, formData.password);
      } else {
        if (Object.keys(updates).length > 0) await userApi.update(selectedUser.id, updates);
      }
      
      await loadUsers();
      setShowEditModal(false);
      resetForm();
    } catch (err) {
      if (isMfaRequired(err)) { setShowEditModal(false); toast.error(MFA_MSG); }
      else setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeleteError(null);
    try {
      await userApi.delete(userToDelete.id);
      await loadUsers();
      setUserToDelete(null);
    } catch (err) {
      if (isMfaRequired(err)) { setUserToDelete(null); toast.error(MFA_MSG); }
      else if (err.message.includes('dashboard')) {
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

  // --- Security handlers ---
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
      toast.error(isMfaRequired(err) ? MFA_MSG : err.message);
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
      toast.error(isMfaRequired(err) ? MFA_MSG : err.message);
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
      toast.error(isMfaRequired(err) ? MFA_MSG : err.message);
    } finally {
      setSecurityActionLoading(false);
    }
  };

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
      toast.error(isMfaRequired(err) ? MFA_MSG : err.message);
    } finally {
      setShowResetMfaConfirm(false);
      setUserToResetMfa(null);
    }
  };

  // --- Transfer handlers ---
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
      await loadUsers();
      closeTransferOwnershipModal();
      window.location.reload();
    } catch (err) {
      if (isMfaRequired(err)) { closeTransferOwnershipModal(); toast.error(MFA_MSG); }
      else setTransferError(err.message || 'Failed to transfer ownership');
    } finally {
      setTransferLoading(false);
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
      await userApi.delete(userToDelete.id);
      await loadUsers();
      toast.success('Dashboards transferred and user deleted');
      setUserToDelete(null);
    } catch (err) {
      toast.error(isMfaRequired(err) ? MFA_MSG : err.message);
    } finally {
      setSecurityActionLoading(false);
    }
  };

  return {
    // Data
    users, loading, error, searchQuery, setSearchQuery, filteredUsers,
    // Form
    formData, setFormData, formLoading, formError, resetForm, getAssignableRoles,
    // Modals
    showCreateModal, setShowCreateModal,
    showEditModal, setShowEditModal,
    selectedUser, setSelectedUser,
    // Delete
    userToDelete, setUserToDelete, deleteError, setDeleteError,
    handleDeleteUser, canDeleteUser,
    // CRUD
    handleCreateUser, handleUpdateRole, openEditModal, handleEditUser,
    // Security
    showLockConfirm, setShowLockConfirm, userToLock, setUserToLock,
    handleLockAccount, confirmLockAccount,
    showUnlockModal, setShowUnlockModal, unlockDuration, setUnlockDuration,
    openUnlockModal, handleUnlockAccount,
    showMfaBypassModal, setShowMfaBypassModal, mfaBypassHours, setMfaBypassHours,
    openMfaBypassModal, handleMfaBypass,
    showResetMfaConfirm, setShowResetMfaConfirm, userToResetMfa, setUserToResetMfa,
    handleResetMfa, confirmResetMfa,
    securityActionLoading,
    // Transfer ownership
    showTransferOwnershipModal, transferTargetUser,
    transferConfirmText, setTransferConfirmText,
    transferError, transferLoading,
    openTransferOwnershipModal, closeTransferOwnershipModal, handleTransferOwnership,
    // Transfer dashboards
    showTransferDashboardsModal, setShowTransferDashboardsModal,
    userDashboards, setUserDashboards,
    dashboardTransferTarget, setDashboardTransferTarget,
    handleTransferDashboards,
    // Password policy
    passwordPolicy,
  };
};
