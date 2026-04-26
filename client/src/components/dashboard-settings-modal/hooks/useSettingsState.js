import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/appStore';
import { sfConnectionApi, folderApi } from '../../../api/apiClient';
import { workspaceApi } from '../../../api/modules/workspaceApi';

/**
 * @param {object} yamlBridgeRef - Ref populated by parent after useYamlExport: { pendingYamlImport, setPendingYamlImport, setImportSuccess, setImportError }
 */
export function useSettingsState(dashboard, isOpen, onClose, onSave, yamlBridgeRef) {
  const { currentRole, currentDashboard, updateDashboard, isAuthenticated, activeWorkspace } = useAppStore();

  // Store original values when modal opens for cancel/revert
  const originalValuesRef = useRef(null);

  // Connection-based resources
  const [availableWarehouses, setAvailableWarehouses] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [availableSemanticViews, setAvailableSemanticViews] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);

  // Settings state
  const [name, setName] = useState(dashboard?.name || '');
  const [description, setDescription] = useState(dashboard?.description || '');
  const [warehouse, setWarehouse] = useState(dashboard?.warehouse || '');
  const [role, setRole] = useState(dashboard?.role || '');
  const [isPublished, setIsPublished] = useState(dashboard?.isPublished || false);

  // Semantic views referenced
  const [semanticViewsReferenced, setSemanticViewsReferenced] = useState(dashboard?.semanticViewsReferenced || []);
  const [selectedSemanticView, setSelectedSemanticView] = useState('');

  // Folder state
  const [folderId, setFolderId] = useState(dashboard?.folder_id || null);
  const [folders, setFolders] = useState([]);
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const [showInlineCreateFolder, setShowInlineCreateFolder] = useState(false);
  const [inlineFolderName, setInlineFolderName] = useState('');
  const [creatingInlineFolder, setCreatingInlineFolder] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');

  // Active tab
  const [activeTab, setActiveTab] = useState('general');

  // Loading/saving state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Ownership transfer state
  const [transferOwnerTo, setTransferOwnerTo] = useState('');
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);

  // Credential update state
  const [showCredentialUpdate, setShowCredentialUpdate] = useState(false);
  const [credentialType, setCredentialType] = useState('pat'); // 'pat' or 'keypair'
  const [newPatToken, setNewPatToken] = useState('');
  const [newPrivateKey, setNewPrivateKey] = useState('');
  const [newPrivateKeyPassphrase, setNewPrivateKeyPassphrase] = useState('');

  // Connection test state
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState(null);

  // Connection menu/replace state
  const [showConnectionMenu, setShowConnectionMenu] = useState(false);
  const [connectionMenuPos, setConnectionMenuPos] = useState({ top: 0, left: 0 });
  const [showReplaceConnection, setShowReplaceConnection] = useState(false);
  const [availableConnections, setAvailableConnections] = useState([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState(null);
  const connectionMenuRef = useRef(null);
  const connectionMenuBtnRef = useRef(null);

  // Check if current user is the owner (from backend access check)
  const isOwner = dashboard?.isOwner || dashboard?.access_level === 'owner';

  // Admin roles for ownership transfer (derived from dashboard access data if available)
  const adminRoles = (dashboard?.access || []).filter((a) => a.permission === 'admin').map((a) => a.role);

  // State for tracking which semantic view has error (before revertToOriginal references timeout ref)
  const [semanticViewError, setSemanticViewError] = useState(null);
  const [errorViewName, setErrorViewName] = useState(null);
  const semanticViewErrorTimeoutRef = useRef(null);

  // Sync state with dashboard prop when modal opens or dashboard data changes
  useEffect(() => {
    if (isOpen && dashboard) {
      // Set current values from dashboard
      setName(dashboard.name || '');
      setDescription(dashboard.description || '');
      setWarehouse(dashboard.warehouse || '');
      setRole(dashboard.role || '');
      setIsPublished(dashboard.isPublished || false);
      setSemanticViewsReferenced(dashboard.semanticViewsReferenced ? [...dashboard.semanticViewsReferenced] : []);
      setFolderId(dashboard.folder_id || null);

      originalValuesRef.current = {
        name: dashboard.name || '',
        description: dashboard.description || '',
        warehouse: dashboard.warehouse || '',
        isPublished: dashboard.isPublished || false,
        semanticViewsReferenced: dashboard.semanticViewsReferenced ? [...dashboard.semanticViewsReferenced] : [],
        folderId: dashboard.folder_id || null,
      };
    }
  }, [isOpen, dashboard?.id, dashboard?.isPublished]);

  const readYamlBridge = () => yamlBridgeRef?.current ?? {};

  // Revert to original values
  const revertToOriginal = () => {
    if (originalValuesRef.current) {
      setName(originalValuesRef.current.name);
      setDescription(originalValuesRef.current.description);
      setWarehouse(originalValuesRef.current.warehouse);
      setIsPublished(originalValuesRef.current.isPublished);
      setSemanticViewsReferenced([...originalValuesRef.current.semanticViewsReferenced]);
      setFolderId(originalValuesRef.current.folderId);
    }
    // Clear temporary states
    setError(null);
    setSelectedSemanticView('');
    setShowTransferConfirm(false);
    setTransferOwnerTo('');
    setShowCredentialUpdate(false);
    setNewPatToken('');
    setNewPrivateKey('');
    setNewPrivateKeyPassphrase('');
    setConnectionTestResult(null);
    setActiveTab('general');
    setFolderDropdownOpen(false);
    setFolderSearchQuery('');
    // Clear YAML import state
    const yb = readYamlBridge();
    yb.setPendingYamlImport?.(null);
    yb.setImportSuccess?.(false);
    yb.setImportError?.(null);
    // Clear semantic view error
    setSemanticViewError(null);
    setErrorViewName(null);
    if (semanticViewErrorTimeoutRef.current) {
      clearTimeout(semanticViewErrorTimeoutRef.current);
    }
  };

  // Handle cancel - revert changes and close
  const handleCancel = () => {
    revertToOriginal();
    onClose();
  };

  // Role/warehouse always come from the connection — they are read-only
  const connectionInherited = true;

  // Load resources from the dashboard's connection
  const loadResourcesFromConnection = async () => {
    if (!dashboard?.connection_id) return;

    setLoadingResources(true);
    try {
      const parseFqn = (fqn) => {
        const parts = (fqn || '').split('.');
        return {
          name: parts.length > 0 ? parts[parts.length - 1] : fqn,
          database: parts.length >= 3 ? parts[0] : undefined,
          schema: parts.length >= 3 ? parts[1] : undefined,
          fullyQualifiedName: fqn,
        };
      };

      const wsId = activeWorkspace?.id || dashboard?.workspace_id;
      if (wsId) {
        const wsDetail = await workspaceApi.get(wsId);
        const wsConnections = wsDetail?.connections || [];
        const wsConn = wsConnections.find(wc => wc.connection_id === dashboard.connection_id);

        if (wsConn) {
          if (wsConn.role) setRole(wsConn.role);
          if (wsConn.warehouse) setWarehouse(wsConn.warehouse);

          setAvailableSemanticViews(
            (wsDetail?.semanticViews || [])
              .filter(v => v.workspace_connection_id === wsConn.id)
              .map(v => parseFqn(v.semantic_view_fqn))
          );
        } else {
          setAvailableSemanticViews([]);
        }
      } else if (dashboard.role) {
        const resources = await sfConnectionApi.getResources(dashboard.connection_id, dashboard.role);
        setAvailableSemanticViews(resources.semanticViews || []);
      }
    } catch (err) {
      console.error('Failed to load resources:', err);
    } finally {
      setLoadingResources(false);
    }
  };

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      loadResourcesFromConnection();
      loadFolders();
    }
  }, [isOpen, isAuthenticated, dashboard?.connection_id, dashboard?.role]);

  useEffect(() => {
    if (dashboard) {
      setName(dashboard.name || '');
      setDescription(dashboard.description || '');
      setWarehouse(dashboard.warehouse || '');
      setRole(dashboard.role || '');
      setIsPublished(dashboard.isPublished || false);
      setSemanticViewsReferenced(dashboard.semanticViewsReferenced || []);
      setFolderId(dashboard.folder_id || null);
    }
  }, [dashboard]);

  // Add semantic view to list
  const addSemanticView = () => {
    if (!selectedSemanticView) return;

    // Check if already added
    const viewName = typeof selectedSemanticView === 'string' ? selectedSemanticView : selectedSemanticView.name;

    if (semanticViewsReferenced.some((v) => (typeof v === 'string' ? v : v.name) === viewName)) {
      return; // Already added
    }

    // Find the full view object from available views
    const viewObj = availableSemanticViews.find((v) => (v.name || v) === viewName || v === viewName);

    const newView = viewObj
      ? {
          name: viewObj.name || viewObj,
          fullyQualifiedName:
            viewObj.fullyQualifiedName ||
            viewObj.fqn ||
            `${viewObj.database || ''}.${viewObj.schema || ''}.${viewObj.name || viewObj}`.replace(/^\.+/, ''),
        }
      : { name: viewName, fullyQualifiedName: null };

    setSemanticViewsReferenced([...semanticViewsReferenced, newView]);
    setSelectedSemanticView('');
    // Clear any semantic view related error
    setSemanticViewError(null);
    setErrorViewName(null);
  };

  // Remove semantic view from list (with dependency check)
  const removeSemanticView = (viewName) => {
    // Clear any existing timeout
    if (semanticViewErrorTimeoutRef.current) {
      clearTimeout(semanticViewErrorTimeoutRef.current);
    }

    // Check if any widget in the dashboard is using this semantic view
    const widgetsUsingView = [];

    if (dashboard?.tabs) {
      dashboard.tabs.forEach((tab) => {
        if (tab.widgets) {
          tab.widgets.forEach((widget) => {
            const widgetViewRefs = widget.semanticViewsReferenced || [];
            const usesView = widgetViewRefs.some((ref) => {
              const refName = typeof ref === 'string' ? ref : ref.name;
              return refName === viewName;
            });
            if (usesView) {
              widgetsUsingView.push({
                widgetTitle: widget.title || widget.id,
                tabTitle: tab.title || tab.id,
              });
            }
          });
        }
      });
    }

    if (widgetsUsingView.length > 0) {
      const widgetNames = widgetsUsingView.map((w) => `"${w.widgetTitle}" (${w.tabTitle})`).join(', ');
      setSemanticViewError(`Cannot remove "${viewName}" - it is used by: ${widgetNames}. Remove it from these widgets first.`);
      setErrorViewName(viewName);

      // Auto-clear after 5 seconds
      semanticViewErrorTimeoutRef.current = setTimeout(() => {
        setSemanticViewError(null);
        setErrorViewName(null);
      }, 5000);
      return;
    }

    // Safe to remove
    setSemanticViewsReferenced(semanticViewsReferenced.filter((v) => (typeof v === 'string' ? v : v.name) !== viewName));
    setSemanticViewError(null);
    setErrorViewName(null);
  };

  // Test connection using the dashboard's stored connection
  const testConnection = async () => {
    if (!dashboard?.connection_id) {
      setConnectionTestResult({ success: false, message: 'No connection configured' });
      return;
    }

    setTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const result = await sfConnectionApi.test(dashboard.connection_id);
      if (result.success) {
        setConnectionTestResult({ success: true, message: `Connected as ${result.user} with role ${result.role}` });
      } else {
        setConnectionTestResult({ success: false, message: result.error || 'Connection failed' });
      }
    } catch (error) {
      setConnectionTestResult({ success: false, message: error.message || 'Connection failed' });
    } finally {
      setTestingConnection(false);
      // Reset the result after 5 seconds
      setTimeout(() => {
        setConnectionTestResult(null);
      }, 5000);
    }
  };

  // Load workspace connections for replacement (not raw Snowflake connections)
  const loadAvailableConnections = async () => {
    setLoadingConnections(true);
    try {
      const wsId = activeWorkspace?.id || dashboard?.workspace_id;
      if (!wsId) {
        setAvailableConnections([]);
        return;
      }
      const wsDetail = await workspaceApi.get(wsId);
      const wsConnections = wsDetail?.connections || [];
      const wsViews = wsDetail?.semanticViews || [];

      const enriched = wsConnections.map(wc => ({
        ...wc,
        views: wsViews.filter(v => v.workspace_connection_id === wc.id).map(v => v.semantic_view_fqn),
      }));
      setAvailableConnections(enriched);
    } catch (error) {
      console.error('Failed to load workspace connections:', error);
      setAvailableConnections([]);
    } finally {
      setLoadingConnections(false);
    }
  };

  // Handle replace connection — verify semantic view compatibility first
  const handleReplaceConnection = async () => {
    if (!selectedConnectionId || !availableConnections.length) return;

    const target = availableConnections.find(c => c.id === selectedConnectionId);
    if (!target) return;

    // Check that the new connection covers the dashboard's referenced semantic views
    const dashViews = (dashboard?.semanticViewsReferenced || []).map(v =>
      (typeof v === 'string' ? v : v.fullyQualifiedName || v.name || '').toUpperCase()
    ).filter(Boolean);

    const targetViewsUpper = (target.views || []).map(fqn => fqn.toUpperCase());

    const missingViews = dashViews.filter(fqn => !targetViewsUpper.includes(fqn));
    if (missingViews.length > 0) {
      setError(`Cannot switch — the target connection is missing semantic view(s): ${missingViews.join(', ')}`);
      return;
    }

    try {
      await updateDashboard(currentDashboard.id, {
        connection_id: target.connection_id,
        connection_name: target.connection_name,
        warehouse: target.warehouse,
        role: target.role,
      });
      setShowReplaceConnection(false);
      setSelectedConnectionId(null);
      setError(null);
    } catch (err) {
      setError('Failed to replace connection: ' + err.message);
    }
  };

  // Close connection menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (connectionMenuRef.current && !connectionMenuRef.current.contains(e.target)) {
        setShowConnectionMenu(false);
      }
    };
    if (showConnectionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showConnectionMenu]);

  const loadFolders = async () => {
    try {
      const wsId = activeWorkspace?.id || dashboard?.workspace_id;
      const response = await folderApi.getContents(null, wsId);
      setFolders(response.folders || []);
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  };

  // Create folder inline
  const handleInlineCreateFolder = async () => {
    if (!inlineFolderName.trim()) return;

    setCreatingInlineFolder(true);
    try {
      const wsId = activeWorkspace?.id || dashboard?.workspace_id;
      const newFolder = await folderApi.create({
        name: inlineFolderName.trim(),
        parentId: null,
        workspaceId: wsId,
      });
      // API returns folder directly, not wrapped
      setFolders([...folders, newFolder]);
      setFolderId(newFolder.id);
      setShowInlineCreateFolder(false);
      setInlineFolderName('');
      setFolderSearchQuery('');
      setFolderDropdownOpen(false);
    } catch (err) {
      console.error('Failed to create folder:', err);
    } finally {
      setCreatingInlineFolder(false);
    }
  };

  // Transfer ownership
  const handleTransferOwnership = async () => {
    if (!transferOwnerTo) return;

    try {
      // Update dashboard with new owner
      await updateDashboard(dashboard.id, { ownerRole: transferOwnerTo });
      setShowTransferConfirm(false);
      setTransferOwnerTo('');
      // Refresh the page or close settings since ownership has changed
      onClose();
    } catch (error) {
      setError('Failed to transfer ownership: ' + error.message);
    }
  };

  // Update credentials for the dashboard's connection
  const handleUpdateCredentials = async () => {
    if (!dashboard?.connection_id) {
      setError('No connection configured');
      return;
    }

    try {
      const updateData = {};
      if (credentialType === 'pat') {
        if (!newPatToken) {
          setError('Please enter a PAT token');
          return;
        }
        updateData.authType = 'pat';
        updateData.credentials = { token: newPatToken };
      } else {
        if (!newPrivateKey) {
          setError('Please enter a private key');
          return;
        }
        updateData.authType = 'keypair';
        updateData.credentials = {
          privateKey: newPrivateKey,
          passphrase: newPrivateKeyPassphrase,
        };
      }

      await sfConnectionApi.update(dashboard.connection_id, updateData);
      setShowCredentialUpdate(false);
      setNewPatToken('');
      setNewPrivateKey('');
      setNewPrivateKeyPassphrase('');
      setConnectionTestResult({ success: true, message: 'Credentials updated successfully!' });
    } catch (error) {
      setError('Failed to update credentials: ' + error.message);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Dashboard name is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const pendingYamlImport = readYamlBridge().pendingYamlImport;

      // Build the settings object
      const settings = {
        name: name.trim(),
        description: description.trim(),
        warehouse,
        role,
        isPublished,
        semanticViewsReferenced,
        folder_id: folderId,
      };

      // Include pending YAML import if present
      if (pendingYamlImport) {
        if (pendingYamlImport.tabs) settings.tabs = pendingYamlImport.tabs;
        if (pendingYamlImport.filters) settings.filters = pendingYamlImport.filters;
        if (pendingYamlImport.semanticViewsReferenced) settings.semanticViewsReferenced = pendingYamlImport.semanticViewsReferenced;
        if (pendingYamlImport.customColorSchemes) settings.customColorSchemes = pendingYamlImport.customColorSchemes;
      }

      await onSave(settings);

      // Clear pending import after successful save
      readYamlBridge().setPendingYamlImport?.(null);
      readYamlBridge().setImportSuccess?.(false);
      // Note: onSave handler closes the modal, no need to call onClose() here
    } catch (err) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  return {
    currentRole,
    currentDashboard,
    updateDashboard,
    isAuthenticated,
    originalValuesRef,
    availableWarehouses,
    setAvailableWarehouses,
    availableRoles,
    setAvailableRoles,
    availableSemanticViews,
    setAvailableSemanticViews,
    loadingResources,
    setLoadingResources,
    name,
    setName,
    description,
    setDescription,
    warehouse,
    setWarehouse,
    role,
    setRole,
    isPublished,
    setIsPublished,
    semanticViewsReferenced,
    setSemanticViewsReferenced,
    selectedSemanticView,
    setSelectedSemanticView,
    folderId,
    setFolderId,
    folders,
    setFolders,
    folderDropdownOpen,
    setFolderDropdownOpen,
    showInlineCreateFolder,
    setShowInlineCreateFolder,
    inlineFolderName,
    setInlineFolderName,
    creatingInlineFolder,
    setCreatingInlineFolder,
    folderSearchQuery,
    setFolderSearchQuery,
    activeTab,
    setActiveTab,
    isSaving,
    setIsSaving,
    error,
    setError,
    transferOwnerTo,
    setTransferOwnerTo,
    showTransferConfirm,
    setShowTransferConfirm,
    showCredentialUpdate,
    setShowCredentialUpdate,
    credentialType,
    setCredentialType,
    newPatToken,
    setNewPatToken,
    newPrivateKey,
    setNewPrivateKey,
    newPrivateKeyPassphrase,
    setNewPrivateKeyPassphrase,
    testingConnection,
    setTestingConnection,
    connectionTestResult,
    setConnectionTestResult,
    showConnectionMenu,
    setShowConnectionMenu,
    connectionMenuPos,
    setConnectionMenuPos,
    showReplaceConnection,
    setShowReplaceConnection,
    availableConnections,
    setAvailableConnections,
    loadingConnections,
    setLoadingConnections,
    selectedConnectionId,
    setSelectedConnectionId,
    connectionMenuRef,
    connectionMenuBtnRef,
    isOwner,
    adminRoles,
    revertToOriginal,
    handleCancel,
    loadResourcesFromConnection,
    addSemanticView,
    semanticViewError,
    setSemanticViewError,
    errorViewName,
    setErrorViewName,
    semanticViewErrorTimeoutRef,
    removeSemanticView,
    testConnection,
    loadAvailableConnections,
    handleReplaceConnection,
    loadFolders,
    handleInlineCreateFolder,
    handleTransferOwnership,
    handleUpdateCredentials,
    handleSave,
    connectionInherited,
  };
}
