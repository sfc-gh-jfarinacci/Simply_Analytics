import { useState, useCallback, useRef } from 'react';
import { workspaceApi } from '../../api/modules/workspaceApi';

export function useMembers({ activeWorkspace, loadDetail, toast }) {
  const [allUsers, setAllUsers] = useState([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberError, setAddMemberError] = useState('');
  const [dropdownDir, setDropdownDir] = useState('down');
  const memberDropdownRef = useRef(null);
  const addBtnRef = useRef(null);

  const loadAllUsers = useCallback(async () => {
    try {
      const { fetchApi, safeJson } = await import('../../api/modules/fetchCore.js');
      const res = await fetchApi('/users');
      const data = await safeJson(res, { users: [] });
      const users = data.users || data;
      setAllUsers(Array.isArray(users) ? users : []);
    } catch { setAllUsers([]); }
  }, []);

  const handleAddMember = async (userId) => {
    if (!userId || !activeWorkspace) return;
    setAddingMember(true);
    setAddMemberError('');
    try {
      await workspaceApi.addMember(activeWorkspace.id, userId);
      await loadDetail(activeWorkspace.id);
      setShowAddMember(false);
      setMemberSearch('');
    } catch (e) {
      setAddMemberError(e.message || 'Failed to add member');
    } finally { setAddingMember(false); }
  };

  const handleAddByEmail = async (members) => {
    const email = memberSearch.trim().toLowerCase();
    if (!email || !activeWorkspace) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setAddMemberError('Enter a valid email address');
      return;
    }
    setAddingMember(true);
    setAddMemberError('');
    try {
      const { fetchApi, safeJson } = await import('../../api/modules/fetchCore.js');
      const res = await fetchApi(`/users/lookup?email=${encodeURIComponent(email)}`);
      if (!res.ok) { setAddMemberError('No user found with that email'); return; }
      const data = await safeJson(res, {});
      if (!data.user) { setAddMemberError('No user found with that email'); return; }
      const already = members.find(m => (m.user_id || m.id) === data.user.id);
      if (already) { setAddMemberError('User is already a member'); return; }
      await workspaceApi.addMember(activeWorkspace.id, data.user.id);
      await loadDetail(activeWorkspace.id);
      setShowAddMember(false);
      setMemberSearch('');
    } catch (e) {
      setAddMemberError(e.message || 'Failed to add member');
    } finally { setAddingMember(false); }
  };

  const handleRemoveMember = async (userId) => {
    if (!activeWorkspace) return;
    await workspaceApi.removeMember(activeWorkspace.id, userId);
    await loadDetail(activeWorkspace.id);
  };

  return {
    allUsers, showAddMember, setShowAddMember, memberSearch, setMemberSearch,
    addingMember, addMemberError, setAddMemberError, dropdownDir, setDropdownDir,
    memberDropdownRef, addBtnRef,
    loadAllUsers, handleAddMember, handleAddByEmail, handleRemoveMember,
  };
}
