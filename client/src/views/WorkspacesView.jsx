import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  FiLayers, FiGrid, FiMessageCircle, FiPlus,
  FiArrowRight, FiDatabase, FiUsers, FiTrash2,
  FiLoader, FiX, FiFlag,
  FiMoreVertical, FiExternalLink,
} from 'react-icons/fi';
import { useAppStore } from '../store/appStore';
import { workspaceApi } from '../api/modules/workspaceApi';
import { sfConnectionApi } from '../api/modules/sfConnectionApi';
import { askApi } from '../api/modules/askApi';
import CreateDashboardModal from '../components/CreateDashboardModal';
import ConnectionModal from '../components/ConnectionModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { useToast } from '../components/Toast';
import { useEndpoints } from '../components/workspaces/useEndpoints';
import { useApiKeys } from '../components/workspaces/useApiKeys';
import { useAiConfig } from '../components/workspaces/useAiConfig';
import { useMembers } from '../components/workspaces/useMembers';
import ConnectionsSection from '../components/workspaces/ConnectionsSection';
import EndpointsSection from '../components/workspaces/EndpointsSection';
import ApiKeysSection from '../components/workspaces/ApiKeysSection';
import AiConfigSection from '../components/workspaces/AiConfigSection';
import MembersSection from '../components/workspaces/MembersSection';
import EndpointModal from '../components/workspaces/EndpointModal';
import AssignViewsModal from '../components/workspaces/AssignViewsModal';
import '../styles/WorkspacesView.css';

export default function WorkspacesView() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const {
    workspaces, activeWorkspace, loadWorkspaces, switchWorkspace,
    defaultWorkspaceId, setDefaultWorkspace,
    dashboards, isLoadingDashboards, currentRole, currentUser,
    askConversations, setAskConversations,
  } = useAppStore();

  const [wsDetail, setWsDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState(null);

  const [settingsOpen, setSettingsOpen] = useState({});

  const [connMenuOpen, setConnMenuOpen] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const connMenuRef = useRef(null);

  const [showCreateDashboard, setShowCreateDashboard] = useState(false);

  const [testingConnId, setTestingConnId] = useState(null);
  const [connTestResults, setConnTestResults] = useState({});

  const [connectionToDelete, setConnectionToDelete] = useState(null);
  const [connectionDeleteWarning, setConnectionDeleteWarning] = useState(null);

  const [editingWsConnection, setEditingWsConnection] = useState(null);

  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const wsMenuRef = useRef(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState(null);
  const [deletePreview, setDeletePreview] = useState(null);
  const [loadingDeletePreview, setLoadingDeletePreview] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const nameInputRef = useRef(null);
  const descInputRef = useRef(null);
  const saveTimerRef = useRef(null);

  const endpointMenuRef = useRef(null);

  const isAdmin = ['owner', 'admin'].includes(currentRole);
  const canAddMembers = ['owner', 'admin', 'developer'].includes(currentRole);
  const hasSecureAuth = currentUser?.auth_provider === 'saml' ||
    currentUser?.totp_enabled || currentUser?.passkey_enabled;
  const hasWorkspaces = workspaces.length > 0;
  const noWorkspaceSelected = hasWorkspaces && !activeWorkspace;

  // Pending state for batch assignment
  const [assignPending, setAssignPending] = useState(new Set());
  const [assignSearch, setAssignSearch] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);

  const saveWorkspaceField = useCallback(async (field, value) => {
    if (!activeWorkspace) return;
    const trimmed = value.trim();
    if (field === 'name' && !trimmed) return;
    const current = field === 'name' ? activeWorkspace.name : (activeWorkspace.description || '');
    if (trimmed === current.trim()) return;
    try {
      await workspaceApi.update(activeWorkspace.id, { [field]: trimmed });
      await loadWorkspaces();
    } catch {
      toast.error(`Failed to update ${field}`);
    }
  }, [activeWorkspace, loadWorkspaces, toast]);

  const startEditName = () => {
    if (!isAdmin || !activeWorkspace) return;
    setDraftName(activeWorkspace.name || '');
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const startEditDesc = () => {
    if (!isAdmin || !activeWorkspace) return;
    setDraftDesc(activeWorkspace.description || '');
    setEditingDesc(true);
    setTimeout(() => descInputRef.current?.focus(), 0);
  };

  const commitName = () => { clearTimeout(saveTimerRef.current); setEditingName(false); saveWorkspaceField('name', draftName); };
  const commitDesc = () => { clearTimeout(saveTimerRef.current); setEditingDesc(false); saveWorkspaceField('description', draftDesc); };

  const handleNameChange = (e) => {
    setDraftName(e.target.value);
    clearTimeout(saveTimerRef.current);
    const val = e.target.value;
    saveTimerRef.current = setTimeout(() => { setEditingName(false); saveWorkspaceField('name', val); }, 2000);
  };

  const handleDescChange = (e) => {
    setDraftDesc(e.target.value);
    clearTimeout(saveTimerRef.current);
    const val = e.target.value;
    saveTimerRef.current = setTimeout(() => { setEditingDesc(false); saveWorkspaceField('description', val); }, 2000);
  };

  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter') commitName();
    if (e.key === 'Escape') { clearTimeout(saveTimerRef.current); setEditingName(false); }
  };

  const handleDescKeyDown = (e) => {
    if (e.key === 'Enter') commitDesc();
    if (e.key === 'Escape') { clearTimeout(saveTimerRef.current); setEditingDesc(false); }
  };

  useEffect(() => { setEditingName(false); setEditingDesc(false); clearTimeout(saveTimerRef.current); }, [activeWorkspace?.id]);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  const openAssignModal = useCallback(async (wc, type) => {
    setConnMenuOpen(null);
    setAssignSearch('');
    setAssignModal({ wcId: wc.id, connectionName: wc.connection_name, type, loading: true, available: [] });
    try {
      const [freshDetail, res] = await Promise.all([
        workspaceApi.get(activeWorkspace.id),
        sfConnectionApi.getResources(wc.connection_id, wc.role || undefined),
      ]);
      setWsDetail(freshDetail);
      const connViews = (freshDetail?.semanticViews || []).filter(v => v.workspace_connection_id === wc.id);
      const rawItems = res?.semanticViews || [];
      const available = rawItems.map(item => {
        const fqn = typeof item === 'object' ? item.fullyQualifiedName || item.name : item;
        const label = typeof item === 'object' ? item.name : item;
        const fqnUpper = fqn.toUpperCase();
        const match = connViews.find(a => a.semantic_view_fqn?.toUpperCase() === fqnUpper);
        return { fqn, label, assigned: !!match, recordId: match?.id };
      });
      setAssignPending(new Set(available.filter(a => a.assigned).map(a => a.fqn)));
      setAssignModal(prev => prev ? { ...prev, loading: false, available } : null);
    } catch {
      setAssignPending(new Set());
      setAssignModal(prev => prev ? { ...prev, loading: false, available: [] } : null);
    }
  }, [activeWorkspace?.id]);

  const loadDetail = useCallback(async (wsId) => {
    if (!wsId) return;
    setLoadingDetail(true);
    try { setWsDetail(await workspaceApi.get(wsId)); }
    catch (e) { console.error('Failed to load workspace detail:', e); }
    finally { setLoadingDetail(false); }
  }, []);

  const endpoints = useEndpoints({ activeWorkspace, wsDetail, toast });
  const apiKeys = useApiKeys({ activeWorkspace, toast });
  const aiCfg = useAiConfig({ activeWorkspace, isAdmin, toast });
  const membersHook = useMembers({ activeWorkspace, loadDetail, toast });

  const {
    wsEndpoints, endpointMenuOpen, setEndpointMenuOpen, endpointToDelete, setEndpointToDelete,
    endpointModal, setEndpointModal, epForm, setEpForm, epViewMeta, setEpViewMeta, epViewLoading, epSaving, epError,
    epValidating, epValidation,
    loadEndpoints, handleDeleteEndpoint, copyEndpointUrl, slugifyEp,
    openEndpointCreate, openEndpointEdit, handleEpViewSelect,
    toggleEpField, addEpFilter, updateEpFilter, toggleFilterMode, updateEpParamDef, removeEpFilter,
    handleValidateEndpoint, handleSaveEndpoint,
  } = endpoints;

  const {
    wsApiKeys, showCreateKey, setShowCreateKey, newKeyName, setNewKeyName,
    creatingKey, revealedKey, setRevealedKey,
    loadApiKeys, handleCreateApiKey, handleRevokeApiKey,
  } = apiKeys;

  const {
    selectedModel, aiSaving,
    loadAiConfig, handleSelectModel,
    AVAILABLE_MODELS, DEFAULT_MODEL_ID,
  } = aiCfg;

  const {
    allUsers, showAddMember, setShowAddMember, memberSearch, setMemberSearch,
    addingMember, addMemberError, setAddMemberError, dropdownDir, setDropdownDir,
    memberDropdownRef, addBtnRef,
    loadAllUsers, handleAddMember, handleAddByEmail, handleRemoveMember,
  } = membersHook;

  useEffect(() => {
    if (activeWorkspace?.id) {
      loadDetail(activeWorkspace.id);
      loadEndpoints();
      loadApiKeys();
      askApi.listConversations(activeWorkspace.id)
        .then(res => setAskConversations(res.conversations || []))
        .catch(console.error);
    } else {
      setWsDetail(null);
      setAskConversations([]);
    }
  }, [activeWorkspace?.id, loadDetail, loadEndpoints, loadApiKeys]);

  useEffect(() => {
    if (activeWorkspace?.id && location.pathname === '/workspaces')
      navigate(`/workspaces/${activeWorkspace.id}`, { replace: true });
  }, [activeWorkspace?.id, location.pathname, navigate]);

  useEffect(() => {
    if (searchParams.get('create') === '1') { setShowCreateForm(true); setSearchParams({}, { replace: true }); }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!wsMenuOpen) return;
    const h = (e) => { if (wsMenuRef.current && !wsMenuRef.current.contains(e.target)) setWsMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [wsMenuOpen]);

  useEffect(() => {
    if (!connMenuOpen) return;
    const h = (e) => { if (connMenuRef.current && !connMenuRef.current.contains(e.target)) setConnMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [connMenuOpen]);

  useEffect(() => {
    if (!showAddMember) return;
    const h = (e) => { if (memberDropdownRef.current && !memberDropdownRef.current.contains(e.target)) { setShowAddMember(false); setMemberSearch(''); setAddMemberError(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showAddMember]);

  useEffect(() => {
    if (!endpointMenuOpen) return;
    const h = (e) => { if (endpointMenuRef.current && !endpointMenuRef.current.contains(e.target)) setEndpointMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [endpointMenuOpen]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true); setCreateError('');
    try {
      const ws = await workspaceApi.create({ name: createName.trim(), description: createDesc.trim() });
      await loadWorkspaces();
      if (ws.workspace) { switchWorkspace(ws.workspace); navigate(`/workspaces/${ws.workspace.id}`, { replace: true }); }
      setShowCreateForm(false); setCreateName(''); setCreateDesc('');
    } catch (e) { setCreateError(e.message); }
    finally { setCreating(false); }
  };

  const handleConnectionSaved = async (savedConn, config = {}) => {
    setShowConnectionModal(false);
    const wsConn = editingWsConnection;
    setEditingConnection(null); setEditingWsConnection(null);
    if (!activeWorkspace) return;
    if (wsConn && config.role && config.warehouse) {
      try { await workspaceApi.updateConnection(activeWorkspace.id, wsConn.id, { role: config.role, warehouse: config.warehouse }); } catch { /* swallow */ }
      await loadDetail(activeWorkspace.id);
    } else if (!wsConn && savedConn?.id && config.role && config.warehouse) {
      try { await workspaceApi.addConnection(activeWorkspace.id, { connectionId: savedConn.id, role: config.role, warehouse: config.warehouse }); } catch { /* might already be linked */ }
      await loadDetail(activeWorkspace.id);
    }
  };

  const handleEditConnection = async (wc) => {
    try {
      const res = await sfConnectionApi.getById(wc.connection_id);
      setEditingConnection(res.connection || res); setEditingWsConnection(wc); setShowConnectionModal(true);
    } catch (e) { console.error('Failed to load connection for editing:', e); }
  };

  const handleRequestDeleteConnection = async (wc) => {
    setConnMenuOpen(null);
    if (!activeWorkspace) return;
    try {
      const usage = await workspaceApi.checkConnectionUsage(activeWorkspace.id, wc.id);
      if (usage.dashboardCount > 0) {
        toast.error(`Cannot remove — this connection is used by dashboard(s): ${usage.dashboards.map(d => d.name).join(', ')}. Update those dashboards to use a different connection first.`);
        return;
      }
      setConnectionDeleteWarning(usage.askConversationCount > 0
        ? `${usage.askConversationCount} existing conversation(s) use this connection. Removing it will render those chats unusable — users will need to start new conversations.`
        : null);
      setConnectionToDelete(wc);
    } catch { toast.error('Failed to check connection usage'); }
  };

  const handleRemoveConnection = async () => {
    if (!activeWorkspace || !connectionToDelete) return;
    try {
      const result = await workspaceApi.removeConnection(activeWorkspace.id, connectionToDelete.id);
      toast.success(result.askConversationsAffected > 0
        ? `Connection removed. ${result.askConversationsAffected} conversation(s) using this connection will need new conversations.`
        : `Connection "${connectionToDelete.connection_name}" removed`);
      setConnectionToDelete(null); setConnectionDeleteWarning(null);
      await loadDetail(activeWorkspace.id);
    } catch (err) {
      toast.error(err.status === 409
        ? (err.message || 'This connection is in use by dashboards. Update those dashboards to use a different connection first.')
        : (err.message || 'Failed to remove connection'));
      setConnectionToDelete(null); setConnectionDeleteWarning(null);
    }
  };

  const handleTestConnection = async (connId) => {
    setTestingConnId(connId); setConnTestResults(prev => ({ ...prev, [connId]: null }));
    try {
      const result = await sfConnectionApi.test(connId);
      setConnTestResults(prev => ({ ...prev, [connId]: result.success ? { success: true, message: `Connected as ${result.user}` } : { success: false, message: result.error || 'Failed' } }));
      setTimeout(() => setConnTestResults(prev => ({ ...prev, [connId]: null })), 4000);
    } catch (err) {
      setConnTestResults(prev => ({ ...prev, [connId]: { success: false, message: err.message } }));
      setTimeout(() => setConnTestResults(prev => ({ ...prev, [connId]: null })), 4000);
    } finally { setTestingConnId(null); }
  };

  const handleTogglePending = (fqn) => {
    setAssignPending(prev => { const next = new Set(prev); if (next.has(fqn)) next.delete(fqn); else next.add(fqn); return next; });
  };

  const handleApplyAssignment = async () => {
    if (!activeWorkspace || !assignModal) return;
    const { wcId, available } = assignModal;
    setAssignSaving(true);
    try {
      for (const item of available.filter(a => !assignPending.has(a.fqn) && a.assigned)) {
        try { await workspaceApi.removeView(activeWorkspace.id, item.recordId); } catch (e) { console.warn(`Failed to remove ${item.fqn}:`, e.message); }
      }
      for (const item of available.filter(a => assignPending.has(a.fqn) && !a.assigned)) {
        try { await workspaceApi.addView(activeWorkspace.id, { semanticViewFqn: item.fqn, workspaceConnectionId: wcId }); }
        catch (e) { if (!e.message?.includes('already') && e.status !== 409) console.warn(`Failed to add ${item.fqn}:`, e.message); }
      }
    } finally {
      try { setWsDetail(await workspaceApi.get(activeWorkspace.id)); } catch { /* best effort */ }
      setAssignSaving(false); setAssignModal(null); setAssignSearch('');
    }
  };

  const canDeleteWorkspace = activeWorkspace && (activeWorkspace.created_by === currentUser?.id || currentRole === 'owner');

  const handleRequestDeleteWorkspace = async () => {
    if (!activeWorkspace) return;
    setLoadingDeletePreview(true);
    try { setDeletePreview(await workspaceApi.deletePreview(activeWorkspace.id)); setWorkspaceToDelete(activeWorkspace); }
    catch (e) { toast.error(e.message || 'Failed to load delete preview'); }
    finally { setLoadingDeletePreview(false); }
  };

  const handleDeleteWorkspace = async () => {
    if (!workspaceToDelete) return;
    setDeletingWorkspace(true);
    try {
      await workspaceApi.delete(workspaceToDelete.id);
      toast.success(`Workspace "${workspaceToDelete.name}" and all its contents have been deleted`);
      setWorkspaceToDelete(null); setDeletePreview(null); switchWorkspace(null);
      navigate('/workspaces', { replace: true }); await loadWorkspaces();
    } catch (e) { toast.error(e.message || 'Failed to delete workspace'); }
    finally { setDeletingWorkspace(false); }
  };

  const toggleSection = (key) => {
    setSettingsOpen(prev => ({ ...prev, [key]: !prev[key] }));
    if (key === 'members' && !settingsOpen.members && isAdmin) loadAllUsers();
    if (key === 'endpoints' && !settingsOpen.endpoints) loadEndpoints();
    if (key === 'apiKeys' && !settingsOpen.apiKeys) loadApiKeys();
    if (key === 'aiConfig' && !settingsOpen.aiConfig) { loadAiConfig(); }
  };

  // =========================================================================
  // RENDER: No workspaces — welcome screen
  // =========================================================================
  if (!hasWorkspaces) {
    return (
      <div className="workspaces-view ws-view-centered">
        <div className="ws-welcome">
          <div className="ws-welcome-hero">
            <div className="ws-welcome-icon"><FiLayers /></div>
            <h1>Welcome to Workspaces</h1>
            <p className="ws-welcome-subtitle">
              {isAdmin
                ? 'Create your first workspace to start building dashboards and chatting with your data.'
                : 'Your admin hasn\'t added you to a workspace yet. Once you\'re added, your dashboards and AskAI will appear here.'}
            </p>
          </div>
          <div className="ws-feature-cards">
            <div className="ws-feature-card"><div className="ws-feature-icon"><FiGrid /></div><h3>Dashboards</h3><p>Build interactive dashboards with charts, tables, and filters — all powered by your Snowflake data.</p></div>
            <div className="ws-feature-card"><div className="ws-feature-icon"><FiMessageCircle /></div><h3>AskAI</h3><p>Chat with your data using natural language. Ask questions and get instant answers with semantic views.</p></div>
            <div className="ws-feature-card"><div className="ws-feature-icon"><FiDatabase /></div><h3>Connections</h3><p>Each workspace connects to Snowflake with its own role, warehouse, and semantic views.</p></div>
          </div>
          {isAdmin && <button className="ws-btn ws-btn-primary ws-btn-lg ws-get-started-btn" onClick={() => setShowCreateForm(true)}><FiPlus /> Get Started</button>}
          {!isAdmin && (
            <div className="ws-waiting-card">
              <FiUsers className="ws-waiting-icon" />
              <h3>Awaiting Access</h3>
              <p>Ask your workspace admin to add you as a member. You'll be able to access dashboards and AskAI once you're part of a workspace.</p>
            </div>
          )}
        </div>

        {showCreateForm && (
          <div className="ws-create-overlay" onClick={() => setShowCreateForm(false)}>
            <div className="ws-create-card" onClick={e => e.stopPropagation()}>
              <button className="ws-create-close" onClick={() => setShowCreateForm(false)}><FiX /></button>
              <h2>Create Workspace</h2>
              <p>Give your workspace a name and you can configure connections later.</p>
              <div className="ws-field"><label>Workspace Name</label><input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Marketing Analytics" autoFocus /></div>
              <div className="ws-field"><label>Description <span className="optional">(optional)</span></label><input value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="What is this workspace for?" /></div>
              {createError && <div className="ws-error">{createError}</div>}
              <div className="ws-btn-row">
                <button className="ws-btn ws-btn-ghost" onClick={() => setShowCreateForm(false)}>Cancel</button>
                <button className="ws-btn ws-btn-primary" disabled={!createName.trim() || creating} onClick={handleCreate}>
                  {creating ? <><FiLoader className="spinner" /> Creating...</> : <><FiPlus /> Create Workspace</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // RENDER: Pick a workspace
  // =========================================================================
  if (noWorkspaceSelected) {
    return (
      <div className="workspaces-view ws-view-centered">
        <div className="ws-welcome">
          <div className="ws-welcome-hero">
            <div className="ws-welcome-icon"><FiLayers /></div>
            <h1>Select a Workspace</h1>
            <p className="ws-welcome-subtitle">Your default workspace is no longer available. Choose one of your workspaces below to continue.</p>
          </div>
          <div className="ws-picker-list">
            {workspaces.map(ws => (
              <button key={ws.id} className="ws-picker-item" onClick={async () => { switchWorkspace(ws); await setDefaultWorkspace(ws.id); navigate(`/workspaces/${ws.id}`, { replace: true }); }}>
                <div className="ws-picker-icon"><FiLayers /></div>
                <div className="ws-picker-info">
                  <span className="ws-picker-name">{ws.name}</span>
                  {ws.description && <span className="ws-picker-desc">{ws.description}</span>}
                </div>
                <FiArrowRight className="ws-picker-arrow" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RENDER: Workspace hub
  // =========================================================================
  const wsConnections = wsDetail?.connections || [];
  const members = wsDetail?.members || [];
  const allSemanticViews = wsDetail?.semanticViews || [];
  const hasConnections = wsConnections.length > 0;
  const recentDashboards = dashboards.slice(0, 3);
  const recentConversations = (askConversations || []).slice(0, 3);
  const memberIds = new Set(members.map(m => m.user_id || m.id));
  const filteredSearchUsers = memberSearch.trim()
    ? allUsers.filter(u => u.email).filter(u =>
        u.email.toLowerCase().includes(memberSearch.trim().toLowerCase()) ||
        (u.display_name || u.username || '').toLowerCase().includes(memberSearch.trim().toLowerCase()))
    : [];

  return (
    <div className="workspaces-view">
      {/* Header */}
      <div className="ws-header">
        <div className="ws-header-left">
          <h1>
            <FiLayers />
            {editingName ? (
              <input ref={nameInputRef} className="ws-inline-edit ws-inline-edit-name" value={draftName} onChange={handleNameChange} onBlur={commitName} onKeyDown={handleNameKeyDown} maxLength={100} />
            ) : (
              <span className={isAdmin ? 'ws-editable' : ''} onDoubleClick={startEditName} title={isAdmin ? 'Double-click to rename' : undefined}>
                {activeWorkspace?.name || 'Workspaces'}
              </span>
            )}
          </h1>
          {editingDesc ? (
            <input ref={descInputRef} className="ws-inline-edit ws-inline-edit-desc" value={draftDesc} onChange={handleDescChange} onBlur={commitDesc} onKeyDown={handleDescKeyDown} placeholder="Add a description..." maxLength={255} />
          ) : (
            <p className={isAdmin ? 'ws-editable' : ''} onDoubleClick={startEditDesc} title={isAdmin ? 'Double-click to edit description' : undefined}>
              {activeWorkspace?.description || (isAdmin ? 'Add a description...' : '')}
            </p>
          )}
        </div>
        <div className="ws-header-actions">
          {activeWorkspace && workspaces.length > 1 && activeWorkspace.id === defaultWorkspaceId && (
            <span className="ws-default-badge"><FiFlag /> Default</span>
          )}
          {activeWorkspace && (
            <div className="ws-kebab-wrap" ref={wsMenuRef}>
              <button className="ws-kebab-btn" onClick={() => setWsMenuOpen(prev => !prev)}><FiMoreVertical /></button>
              {wsMenuOpen && (
                <div className="ws-kebab-menu">
                  {workspaces.length > 1 && activeWorkspace.id !== defaultWorkspaceId && (
                    <button onClick={async () => { setWsMenuOpen(false); await setDefaultWorkspace(activeWorkspace.id); toast.success('Set as default workspace'); }}>
                      <FiFlag size={13} /> Make Default
                    </button>
                  )}
                  {canDeleteWorkspace && (
                    <button className="ws-kebab-danger" onClick={() => { setWsMenuOpen(false); handleRequestDeleteWorkspace(); }} disabled={loadingDeletePreview}>
                      <FiTrash2 size={13} /> Delete Workspace
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create workspace modal */}
      {showCreateForm && (
        <div className="ws-create-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="ws-create-card" onClick={e => e.stopPropagation()}>
            <button className="ws-create-close" onClick={() => setShowCreateForm(false)}><FiX /></button>
            <h2>Create New Workspace</h2>
            <div className="ws-field"><label>Workspace Name</label><input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Finance Team" /></div>
            <div className="ws-field"><label>Description <span className="optional">(optional)</span></label><input value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="What is this workspace for?" /></div>
            {createError && <div className="ws-error">{createError}</div>}
            <div className="ws-btn-row">
              <button className="ws-btn ws-btn-ghost" onClick={() => setShowCreateForm(false)}>Cancel</button>
              <button className="ws-btn ws-btn-primary" disabled={!createName.trim() || creating} onClick={handleCreate}>
                {creating ? <><FiLoader className="spinner" /> Creating...</> : <><FiPlus /> Create</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {noWorkspaceSelected && (
        <div className="ws-select-prompt"><FiLayers /><p>Select a workspace from the sidebar to get started.</p></div>
      )}

      {activeWorkspace && (
        <div className="ws-hub-grid">
          {/* Dashboards Card */}
          <div className={`ws-card ${!hasSecureAuth ? 'ws-card-disabled' : ''}`}>
            <div className="ws-card-header">
              <div className="ws-card-title"><FiGrid /> Dashboards</div>
              <span className="ws-card-count">{isLoadingDashboards ? '…' : dashboards.length}</span>
            </div>
            <div className="ws-card-body">
              {!hasSecureAuth ? (
                <p className="ws-card-empty">Set up Multi-Factor Authentication in your settings to access dashboards.</p>
              ) : recentDashboards.length > 0 ? (
                <ul className="ws-recent-list">
                  {recentDashboards.map(d => (
                    <li key={d.id}><button className="ws-recent-item" onClick={() => navigate(`/workspaces/${activeWorkspace.id}/dashboards?id=${d.id}`)}><span className="ws-recent-name">{d.name}</span><FiExternalLink /></button></li>
                  ))}
                </ul>
              ) : isLoadingDashboards ? null : (
                <p className="ws-card-empty">No dashboards yet. Create one to get started.</p>
              )}
            </div>
            <div className="ws-card-footer">
              <button className="ws-btn ws-btn-ghost" onClick={() => navigate(`/workspaces/${activeWorkspace.id}/dashboards`)} disabled={!hasSecureAuth}>View All <FiArrowRight /></button>
              <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => setShowCreateDashboard(true)} disabled={!hasSecureAuth}><FiPlus /> New Dashboard</button>
            </div>
          </div>

          {/* AskAI Card */}
          <div className={`ws-card ${(!hasConnections || !hasSecureAuth) ? 'ws-card-disabled' : ''}`}>
            <div className="ws-card-header">
              <div className="ws-card-title"><FiMessageCircle /> SimplyAsk</div>
              {askConversations.length > 0 && hasSecureAuth && (
                <span className="ws-card-count">{askConversations.length} {askConversations.length === 1 ? 'conversation' : 'conversations'}</span>
              )}
            </div>
            <div className="ws-card-body">
              {!hasSecureAuth ? (
                <p className="ws-card-empty">Set up Multi-Factor Authentication in your settings to use SimplyAsk.</p>
              ) : !hasConnections ? (
                <p className="ws-card-empty">Add a Snowflake connection to enable AskAI.</p>
              ) : recentConversations.length > 0 ? (
                <ul className="ws-recent-list">
                  {recentConversations.map(c => (
                    <li key={c.id}><button className="ws-recent-item" onClick={() => navigate(`/workspaces/${activeWorkspace.id}/ask`)}><span className="ws-recent-name">{c.title || 'Untitled chat'}</span><FiExternalLink /></button></li>
                  ))}
                </ul>
              ) : (
                <p className="ws-card-empty">No conversations yet. Start chatting with your data.</p>
              )}
            </div>
            <div className="ws-card-footer">
              <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => navigate(`/workspaces/${activeWorkspace.id}/ask`)} disabled={!hasConnections || !hasSecureAuth}><FiMessageCircle /> Start Chat</button>
            </div>
          </div>

          {/* Workspace Settings */}
          <div className="ws-flat-settings">
            <h2 className="ws-flat-heading">Workspace Settings</h2>

            <ConnectionsSection
              isOpen={settingsOpen.connections} onToggle={() => toggleSection('connections')}
              wsConnections={wsConnections} allSemanticViews={allSemanticViews} isAdmin={isAdmin}
              connMenuOpen={connMenuOpen} setConnMenuOpen={setConnMenuOpen} connMenuRef={connMenuRef}
              handleTestConnection={handleTestConnection} handleEditConnection={handleEditConnection}
              openAssignModal={openAssignModal} handleRequestDeleteConnection={handleRequestDeleteConnection}
              testingConnId={testingConnId} connTestResults={connTestResults}
              onNewConnection={() => setShowConnectionModal(true)}
            />

            <EndpointsSection
              isOpen={settingsOpen.endpoints} onToggle={() => toggleSection('endpoints')}
              wsEndpoints={wsEndpoints} wsConnections={wsConnections} isAdmin={isAdmin}
              endpointMenuOpen={endpointMenuOpen} setEndpointMenuOpen={setEndpointMenuOpen} endpointMenuRef={endpointMenuRef}
              copyEndpointUrl={copyEndpointUrl} openEndpointEdit={openEndpointEdit} setEndpointToDelete={setEndpointToDelete}
              openEndpointCreate={openEndpointCreate}
            />

            <ApiKeysSection
              isOpen={settingsOpen.apiKeys} onToggle={() => toggleSection('apiKeys')}
              wsApiKeys={wsApiKeys} isAdmin={isAdmin} toast={toast}
              revealedKey={revealedKey} setRevealedKey={setRevealedKey}
              showCreateKey={showCreateKey} setShowCreateKey={setShowCreateKey}
              newKeyName={newKeyName} setNewKeyName={setNewKeyName}
              creatingKey={creatingKey} handleCreateApiKey={handleCreateApiKey} handleRevokeApiKey={handleRevokeApiKey}
            />

            <AiConfigSection
              isOpen={settingsOpen.aiConfig} onToggle={() => toggleSection('aiConfig')}
              isAdmin={isAdmin}
              selectedModel={selectedModel} handleSelectModel={handleSelectModel} aiSaving={aiSaving}
              AVAILABLE_MODELS={AVAILABLE_MODELS} DEFAULT_MODEL_ID={DEFAULT_MODEL_ID}
            />

            <MembersSection
              isOpen={settingsOpen.members} onToggle={() => toggleSection('members')}
              members={members} isAdmin={isAdmin} currentUser={currentUser} activeWorkspace={activeWorkspace} toast={toast}
              canAddMembers={canAddMembers} addBtnRef={addBtnRef}
              showAddMember={showAddMember} setShowAddMember={setShowAddMember}
              memberSearch={memberSearch} setMemberSearch={setMemberSearch}
              addMemberError={addMemberError} setAddMemberError={setAddMemberError}
              dropdownDir={dropdownDir} setDropdownDir={setDropdownDir} memberDropdownRef={memberDropdownRef}
              filteredSearchUsers={filteredSearchUsers} memberIds={memberIds} addingMember={addingMember}
              handleAddMember={handleAddMember} handleAddByEmail={handleAddByEmail} handleRemoveMember={handleRemoveMember}
            />
          </div>
        </div>
      )}

      <EndpointModal
        endpointModal={endpointModal} setEndpointModal={setEndpointModal}
        epForm={epForm} setEpForm={setEpForm}
        epViewMeta={epViewMeta} setEpViewMeta={setEpViewMeta}
        epViewLoading={epViewLoading} epSaving={epSaving} epError={epError}
        slugifyEp={slugifyEp} handleEpViewSelect={handleEpViewSelect}
        toggleEpField={toggleEpField} addEpFilter={addEpFilter}
        updateEpFilter={updateEpFilter} toggleFilterMode={toggleFilterMode}
        updateEpParamDef={updateEpParamDef} removeEpFilter={removeEpFilter}
        handleSaveEndpoint={handleSaveEndpoint}
        wsConnections={wsConnections} wsDetail={wsDetail}
        epValidating={epValidating} epValidation={epValidation}
        handleValidateEndpoint={handleValidateEndpoint}
      />

      {endpointToDelete && (
        <ConfirmDeleteModal itemName={endpointToDelete.name} itemType="endpoint" onConfirm={handleDeleteEndpoint} onCancel={() => setEndpointToDelete(null)} />
      )}

      <AssignViewsModal
        assignModal={assignModal} setAssignModal={setAssignModal}
        assignSearch={assignSearch} setAssignSearch={setAssignSearch}
        assignPending={assignPending} handleTogglePending={handleTogglePending}
        assignSaving={assignSaving} handleApplyAssignment={handleApplyAssignment}
      />

      {workspaceToDelete && (() => {
        const parts = deletePreview ? [
          deletePreview.dashboardCount > 0 && `${deletePreview.dashboardCount} dashboard${deletePreview.dashboardCount !== 1 ? 's' : ''}`,
          deletePreview.folderCount > 0 && `${deletePreview.folderCount} folder${deletePreview.folderCount !== 1 ? 's' : ''}`,
          deletePreview.conversationCount > 0 && `${deletePreview.conversationCount} conversation${deletePreview.conversationCount !== 1 ? 's' : ''}`,
        ].filter(Boolean) : [];
        return (
          <ConfirmDeleteModal
            itemName={workspaceToDelete.name} itemType="workspace"
            warning={parts.length > 0 ? `This will permanently delete ${parts.join(', ')}. This cannot be undone.` : null}
            onConfirm={handleDeleteWorkspace}
            onCancel={() => { setWorkspaceToDelete(null); setDeletePreview(null); }}
          />
        );
      })()}

      {connectionToDelete && (
        <ConfirmDeleteModal
          itemName={connectionToDelete.connection_name} itemType="connection" warning={connectionDeleteWarning}
          onConfirm={handleRemoveConnection}
          onCancel={() => { setConnectionToDelete(null); setConnectionDeleteWarning(null); }}
        />
      )}

      {showConnectionModal && (
        <ConnectionModal
          connection={editingConnection} workspaceConnection={editingWsConnection} showConfig
          onClose={() => { setShowConnectionModal(false); setEditingConnection(null); setEditingWsConnection(null); }}
          onSaved={handleConnectionSaved}
        />
      )}

      <CreateDashboardModal isOpen={showCreateDashboard} onClose={() => setShowCreateDashboard(false)} onSuccess={() => setShowCreateDashboard(false)} />
    </div>
  );
}
