import React, { useState, useEffect, useRef, useMemo } from 'react';
import yaml from 'js-yaml';
import { 
  FiX, 
  FiSettings, 
  FiDatabase, 
  FiServer,
  FiLayout,
  FiLock,
  FiUsers,
  FiUser,
  FiEye,
  FiEdit,
  FiTrash2,
  FiPlus,
  FiCheck,
  FiChevronDown,
  FiRefreshCw,
  FiDownload,
  FiUpload,
  FiCode,
  FiCopy,
  FiAlertCircle,
  FiLayers,
  FiKey,
  FiShield,
  FiZap,
  FiUserCheck,
  FiSearch,
  FiFolder,
  FiHome,
  FiMoreVertical,
  FiWifi,
} from 'react-icons/fi';
import { useAppStore } from '../store/appStore';
import { groupApi, sfConnectionApi, folderApi } from '../api/apiClient';
import './DashboardSettings.css';

const DashboardSettings = ({ dashboard, isOpen, onClose, onSave }) => {
  const { 
    currentRole,
    currentDashboard,
    updateDashboard,
    isAuthenticated,
  } = useAppStore();
  
  // Store original values when modal opens for cancel/revert
  const originalValuesRef = useRef(null);
  
  // Connection-based resources
  const [availableWarehouses, setAvailableWarehouses] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [availableSemanticViews, setAvailableSemanticViews] = useState([]);
  const [availableCortexAgents, setAvailableCortexAgents] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);

  // Settings state
  const [name, setName] = useState(dashboard?.name || '');
  const [description, setDescription] = useState(dashboard?.description || '');
  const [warehouse, setWarehouse] = useState(dashboard?.warehouse || '');
  const [role, setRole] = useState(dashboard?.role || '');
  const [isPublished, setIsPublished] = useState(dashboard?.isPublished || false);
  
  // Sharing state
  const [visibility, setVisibility] = useState(dashboard?.visibility || 'private');
  const [sharedGroups, setSharedGroups] = useState(dashboard?.sharedGroups || []);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');
  
  // Semantic views referenced
  const [semanticViewsReferenced, setSemanticViewsReferenced] = useState(dashboard?.semanticViewsReferenced || []);
  const [selectedSemanticView, setSelectedSemanticView] = useState('');
  
  // Cortex agents
  const [cortexAgentsEnabled, setCortexAgentsEnabled] = useState(dashboard?.cortexAgentsEnabled || false);
  const [cortexAgents, setCortexAgents] = useState(dashboard?.cortexAgents || []);
  const [selectedCortexAgent, setSelectedCortexAgent] = useState('');
  
  // Folder state
  const [folderId, setFolderId] = useState(dashboard?.folder_id || null);
  const [folders, setFolders] = useState([]);
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const [showInlineCreateFolder, setShowInlineCreateFolder] = useState(false);
  const [inlineFolderName, setInlineFolderName] = useState('');
  const [creatingInlineFolder, setCreatingInlineFolder] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  
  // Access control
  const [accessList, setAccessList] = useState(dashboard?.access || []);
  const [newRole, setNewRole] = useState('');
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const groupSearchRef = useRef(null);
  
  // Active tab
  const [activeTab, setActiveTab] = useState('general');
  
  // Loading/saving state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  
  // YAML Import/Export state
  const [yamlContent, setYamlContent] = useState('');
  const [yamlCopied, setYamlCopied] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [pendingYamlImport, setPendingYamlImport] = useState(null); // Stores parsed YAML until Save
  const fileInputRef = useRef(null);
  
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
  
  // Get admin roles for ownership transfer
  const adminRoles = accessList.filter(a => a.permission === 'admin').map(a => a.role);
  
  // Sync state with dashboard prop when modal opens or dashboard data changes
  useEffect(() => {
    if (isOpen && dashboard) {
      // Set current values from dashboard
      setName(dashboard.name || '');
      setDescription(dashboard.description || '');
      setWarehouse(dashboard.warehouse || '');
      setRole(dashboard.role || '');
      setIsPublished(dashboard.isPublished || false);
      setVisibility(dashboard.visibility || 'private');
      setSharedGroups(dashboard.sharedGroups ? [...dashboard.sharedGroups] : []);
      setSemanticViewsReferenced(dashboard.semanticViewsReferenced ? [...dashboard.semanticViewsReferenced] : []);
      setCortexAgentsEnabled(dashboard.cortexAgentsEnabled || false);
      setCortexAgents(dashboard.cortexAgents ? [...dashboard.cortexAgents] : []);
      setAccessList(dashboard.access ? [...dashboard.access] : []);
      setFolderId(dashboard.folder_id || null);
      
      // Also cache original values for cancel/revert
      originalValuesRef.current = {
        name: dashboard.name || '',
        description: dashboard.description || '',
        warehouse: dashboard.warehouse || '',
        isPublished: dashboard.isPublished || false,
        visibility: dashboard.visibility || 'private',
        sharedGroups: dashboard.sharedGroups ? [...dashboard.sharedGroups] : [],
        semanticViewsReferenced: dashboard.semanticViewsReferenced ? [...dashboard.semanticViewsReferenced] : [],
        cortexAgentsEnabled: dashboard.cortexAgentsEnabled || false,
        cortexAgents: dashboard.cortexAgents ? [...dashboard.cortexAgents] : [],
        accessList: dashboard.access ? [...dashboard.access] : [],
        folderId: dashboard.folder_id || null,
      };
    }
  }, [isOpen, dashboard?.id, dashboard?.access?.length, dashboard?.visibility, dashboard?.isPublished]);
  
  // Revert to original values
  const revertToOriginal = () => {
    if (originalValuesRef.current) {
      setName(originalValuesRef.current.name);
      setDescription(originalValuesRef.current.description);
      setWarehouse(originalValuesRef.current.warehouse);
      setIsPublished(originalValuesRef.current.isPublished);
      setVisibility(originalValuesRef.current.visibility);
      setSharedGroups([...originalValuesRef.current.sharedGroups]);
      setSemanticViewsReferenced([...originalValuesRef.current.semanticViewsReferenced]);
      setCortexAgentsEnabled(originalValuesRef.current.cortexAgentsEnabled);
      setCortexAgents([...originalValuesRef.current.cortexAgents]);
      setAccessList([...originalValuesRef.current.accessList]);
      setFolderId(originalValuesRef.current.folderId);
    }
    // Clear temporary states
    setError(null);
    setNewRole('');
    setSelectedSemanticView('');
    setSelectedCortexAgent('');
    setSelectedGroupToAdd('');
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
    setPendingYamlImport(null);
    setImportSuccess(false);
    setImportError(null);
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

  // Load resources from the dashboard's connection
  const loadResourcesFromConnection = async () => {
    if (!dashboard?.connection_id || !dashboard?.role) return;
    
    setLoadingResources(true);
    try {
      const resources = await sfConnectionApi.getResources(dashboard.connection_id, dashboard.role);
      setAvailableWarehouses(resources.warehouses || []);
      setAvailableRoles(resources.roles || []);
      setAvailableSemanticViews(resources.semanticViews || []);
      setAvailableCortexAgents(resources.cortexAgents || []);
    } catch (err) {
      console.error('Failed to load resources:', err);
    } finally {
      setLoadingResources(false);
    }
  };

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      loadResourcesFromConnection();
      loadAvailableGroups();
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
      setAccessList(dashboard.access || []);
      setSemanticViewsReferenced(dashboard.semanticViewsReferenced || []);
      setCortexAgentsEnabled(dashboard.cortexAgentsEnabled || false);
      setCortexAgents(dashboard.cortexAgents || []);
      setFolderId(dashboard.folder_id || null);
    }
  }, [dashboard]);

  // Add semantic view to list
  const addSemanticView = () => {
    if (!selectedSemanticView) return;
    
    // Check if already added
    const viewName = typeof selectedSemanticView === 'string' 
      ? selectedSemanticView 
      : selectedSemanticView.name;
    
    if (semanticViewsReferenced.some(v => (typeof v === 'string' ? v : v.name) === viewName)) {
      return; // Already added
    }
    
    // Find the full view object from available views
    const viewObj = availableSemanticViews.find(v => 
      (v.name || v) === viewName || v === viewName
    );
    
    const newView = viewObj ? {
      name: viewObj.name || viewObj,
      fullyQualifiedName: viewObj.fullyQualifiedName || viewObj.fqn || `${viewObj.database || ''}.${viewObj.schema || ''}.${viewObj.name || viewObj}`.replace(/^\.+/, ''),
    } : { name: viewName, fullyQualifiedName: null };
    
    setSemanticViewsReferenced([...semanticViewsReferenced, newView]);
    setSelectedSemanticView('');
    // Clear any semantic view related error
    setSemanticViewError(null);
    setErrorViewName(null);
  };

  // State for tracking which semantic view has error
  const [semanticViewError, setSemanticViewError] = useState(null);
  const [errorViewName, setErrorViewName] = useState(null);
  const semanticViewErrorTimeoutRef = useRef(null);

  // Remove semantic view from list (with dependency check)
  const removeSemanticView = (viewName) => {
    // Clear any existing timeout
    if (semanticViewErrorTimeoutRef.current) {
      clearTimeout(semanticViewErrorTimeoutRef.current);
    }
    
    // Check if any widget in the dashboard is using this semantic view
    const widgetsUsingView = [];
    
    if (dashboard?.tabs) {
      dashboard.tabs.forEach(tab => {
        if (tab.widgets) {
          tab.widgets.forEach(widget => {
            const widgetViewRefs = widget.semanticViewsReferenced || [];
            const usesView = widgetViewRefs.some(ref => {
              const refName = typeof ref === 'string' ? ref : ref.name;
              return refName === viewName;
            });
            if (usesView) {
              widgetsUsingView.push({ 
                widgetTitle: widget.title || widget.id, 
                tabTitle: tab.title || tab.id 
              });
            }
          });
        }
      });
    }
    
    if (widgetsUsingView.length > 0) {
      const widgetNames = widgetsUsingView
        .map(w => `"${w.widgetTitle}" (${w.tabTitle})`)
        .join(', ');
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
    setSemanticViewsReferenced(semanticViewsReferenced.filter(v => 
      (typeof v === 'string' ? v : v.name) !== viewName
    ));
    setSemanticViewError(null);
    setErrorViewName(null);
  };
  
  // Add cortex agent to list (keyed by FQN)
  const addCortexAgent = () => {
    if (!selectedCortexAgent) return;
    
    const agentObj = availableCortexAgents.find(a => a.fullyQualifiedName === selectedCortexAgent);
    if (!agentObj) return;
    
    const fqn = agentObj.fullyQualifiedName;
    if (cortexAgents.some(a => (typeof a === 'object' ? a.fullyQualifiedName : a) === fqn)) {
      return;
    }
    
    setCortexAgents([...cortexAgents, {
      name: agentObj.name,
      database: agentObj.database,
      schema: agentObj.schema,
      fullyQualifiedName: fqn,
    }]);
    setSelectedCortexAgent('');
  };

  // Remove cortex agent from list (by FQN)
  const removeCortexAgent = (fqn) => {
    setCortexAgents(cortexAgents.filter(a => 
      (typeof a === 'object' ? a.fullyQualifiedName : a) !== fqn
    ));
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

  // Load available connections for replacement
  const loadAvailableConnections = async () => {
    setLoadingConnections(true);
    try {
      const connections = await sfConnectionApi.list();
      setAvailableConnections(connections || []);
    } catch (error) {
      console.error('Failed to load connections:', error);
      setAvailableConnections([]);
    } finally {
      setLoadingConnections(false);
    }
  };

  // Handle replace connection
  const handleReplaceConnection = async () => {
    if (!selectedConnectionId || selectedConnectionId === dashboard?.connection_id) {
      return;
    }
    
    // Update the dashboard with the new connection
    const selectedConn = availableConnections.find(c => c.id === selectedConnectionId);
    if (selectedConn) {
      updateDashboard(currentDashboard.id, {
        connection_id: selectedConnectionId,
        connection_name: selectedConn.name,
      });
      setShowReplaceConnection(false);
      setSelectedConnectionId(null);
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

  // Load available groups
  const loadAvailableGroups = async () => {
    setLoadingGroups(true);
    try {
      const response = await groupApi.getAll();
      setAvailableGroups(response.groups || []);
    } catch (err) {
      console.error('Failed to load groups:', err);
    } finally {
      setLoadingGroups(false);
    }
  };

  // Load folders
  const loadFolders = async () => {
    try {
      const response = await folderApi.getContents(null);
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
      const newFolder = await folderApi.create({
        name: inlineFolderName.trim(),
        parentId: null
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

  // Add group to shared list
  const handleAddGroup = () => {
    if (!selectedGroupToAdd) return;
    
    const group = availableGroups.find(g => g.id === selectedGroupToAdd);
    if (group && !sharedGroups.find(g => g.id === group.id)) {
      setSharedGroups([...sharedGroups, group]);
    }
    setSelectedGroupToAdd('');
  };

  // Remove group from shared list
  const handleRemoveGroup = (groupId) => {
    setSharedGroups(sharedGroups.filter(g => g.id !== groupId));
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
          passphrase: newPrivateKeyPassphrase 
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

  // Generate YAML content from current dashboard state (including unsaved changes)
  // Watch for changes in tabs, widgets, and semantic views (including calculated fields)
  const currentTabs = currentDashboard?.tabs;
  const tabsJson = JSON.stringify(currentTabs);
  const semanticViewsJson = JSON.stringify(currentDashboard?.semanticViewsReferenced);
  const cortexAgentsJson = JSON.stringify(currentDashboard?.cortexAgents);
  
  useEffect(() => {
    if (activeTab === 'yaml' && currentDashboard) {
      const yamlData = generateYamlFromDashboard(currentDashboard);
      setYamlContent(yamlData);
    }
  }, [activeTab, currentDashboard, tabsJson, semanticViewsJson, cortexAgentsJson]);

  // Generate YAML string from dashboard object
  const generateYamlFromDashboard = (db) => {
    const indent = (level) => '  '.repeat(level);
    let yaml = '';
    
    // Version header
    yaml += `version: "1.0"\n\n`;
    
    // Dashboard metadata
    yaml += `# Dashboard: ${db.title || db.name || 'Untitled'}\n`;
    yaml += `# Generated: ${new Date().toISOString()}\n`;
    yaml += `# Note: This reflects the current state including unsaved changes\n\n`;
    
    yaml += `dashboard:\n`;
    yaml += `${indent(1)}id: ${db.id || 'new'}\n`;
    yaml += `${indent(1)}title: "${(db.title || db.name || '').replace(/"/g, '\\"')}"\n`;
    yaml += `${indent(1)}description: "${(db.description || '').replace(/"/g, '\\"')}"\n`;
    yaml += `${indent(1)}warehouse: ${db.warehouse || 'null'}\n`;
    yaml += `${indent(1)}isPublished: ${db.isPublished || false}\n`;
    yaml += `${indent(1)}ownerRole: ${db.ownerRole || db.owner_role || currentRole || 'null'}\n`;
    yaml += `${indent(1)}creator: ${db.creator || db.createdBy || currentRole || 'null'}\n`;
    yaml += `${indent(1)}lastUpdatedBy: ${db.lastUpdatedBy || db.last_updated_by || currentRole || 'null'}\n\n`;
    
    // Filters
    yaml += `${indent(1)}filters:\n`;
    if (db.filters && db.filters.length > 0) {
      db.filters.forEach((filter, i) => {
        yaml += `${indent(2)}- id: ${filter.id || `filter-${i}`}\n`;
        yaml += `${indent(3)}field: ${filter.field || ''}\n`;
        yaml += `${indent(3)}type: ${filter.type || 'select'}\n`;
      });
    } else {
      yaml += `${indent(2)}[] # No filters defined\n`;
    }
    yaml += '\n';
    
    // Semantic views referenced (dashboard level)
    yaml += `${indent(1)}semanticViewsReferenced:\n`;
    if (db.semanticViewsReferenced && db.semanticViewsReferenced.length > 0) {
      db.semanticViewsReferenced.forEach(view => {
        const viewName = typeof view === 'string' ? view : view.name;
        const viewFqn = typeof view === 'object' ? view.fullyQualifiedName : null;
        const rawCalcFields = typeof view === 'object' ? view.calculatedFields : null;
        const calculatedFields = rawCalcFields?.map(cf => cf.id ? cf : { ...cf, id: crypto.randomUUID() }) || null;
        
        yaml += `${indent(2)}- name: "${viewName}"\n`;
        if (viewFqn) {
          yaml += `${indent(3)}fullyQualifiedName: "${viewFqn}"\n`;
        }
        
        // Calculated fields for this semantic view
        yaml += `${indent(3)}calculatedFields:\n`;
        if (calculatedFields && calculatedFields.length > 0) {
          calculatedFields.forEach(cf => {
            yaml += `${indent(4)}- id: "${cf.id}"\n`;
            yaml += `${indent(5)}name: "${cf.name}"\n`;
            yaml += `${indent(5)}displayName: "${cf.displayName || cf.name}"\n`;
            yaml += `${indent(5)}expression: |\n`;
            const exprLines = cf.expression.split('\n');
            exprLines.forEach(line => {
              yaml += `${indent(6)}${line}\n`;
            });
            if (cf.referencedFields?.length > 0) {
              yaml += `${indent(5)}referencedFields: [${cf.referencedFields.map(r => `"${r}"`).join(', ')}]\n`;
            }
            if (cf.isAggregate != null) {
              yaml += `${indent(5)}isAggregate: ${cf.isAggregate}\n`;
            }
          });
        } else {
          yaml += `${indent(4)}[] # No calculated fields\n`;
        }
        
        // Column aliases for this semantic view
        const columnAliases = typeof view === 'object' ? view.columnAliases : null;
        yaml += `${indent(3)}columnAliases:\n`;
        if (columnAliases && Object.keys(columnAliases).length > 0) {
          Object.entries(columnAliases).forEach(([originalName, alias]) => {
            yaml += `${indent(4)}${originalName}: "${alias}"\n`;
          });
        } else {
          yaml += `${indent(4)}{} # No column aliases\n`;
        }
      });
    } else {
      yaml += `${indent(2)}[] # No semantic views referenced\n`;
    }
    yaml += '\n';
    
    // Cortex Agents
    yaml += `${indent(1)}cortexAgentsEnabled: ${db.cortexAgentsEnabled || false}\n`;
    yaml += `${indent(1)}cortexAgents:\n`;
    if (db.cortexAgentsEnabled && db.cortexAgents && db.cortexAgents.length > 0) {
      db.cortexAgents.forEach(agent => {
        const agentName = typeof agent === 'string' ? agent : agent.name;
        const agentFqn = typeof agent === 'object' ? agent.fullyQualifiedName : null;
        yaml += `${indent(2)}- name: "${agentName}"\n`;
        if (agentFqn) {
          yaml += `${indent(3)}fullyQualifiedName: "${agentFqn}"\n`;
        }
      });
    } else {
      yaml += `${indent(2)}[] # No cortex agents\n`;
    }
    yaml += '\n';
    
    // Custom Color Schemes
    yaml += `${indent(1)}customColorSchemes:\n`;
    if (db.customColorSchemes && db.customColorSchemes.length > 0) {
      db.customColorSchemes.forEach(scheme => {
        yaml += `${indent(2)}- id: "${scheme.id}"\n`;
        yaml += `${indent(3)}name: "${(scheme.name || '').replace(/"/g, '\\"')}"\n`;
        yaml += `${indent(3)}type: ${scheme.type || 'categorical'}\n`;
        yaml += `${indent(3)}colors:\n`;
        if (scheme.colors && scheme.colors.length > 0) {
          scheme.colors.forEach(color => {
            yaml += `${indent(4)}- "${color}"\n`;
          });
        } else {
          yaml += `${indent(4)}[]\n`;
        }
        if (scheme.createdAt) {
          yaml += `${indent(3)}createdAt: ${scheme.createdAt}\n`;
        }
        if (scheme.updatedAt) {
          yaml += `${indent(3)}updatedAt: ${scheme.updatedAt}\n`;
        }
      });
    } else {
      yaml += `${indent(2)}[] # No custom color schemes\n`;
    }
    yaml += '\n';
    
    // Tabs and widgets
    yaml += `${indent(1)}tabs:\n`;
    if (db.tabs && db.tabs.length > 0) {
      db.tabs.forEach((tab, tabIndex) => {
        yaml += `${indent(2)}- id: ${tab.id}\n`;
        yaml += `${indent(3)}title: "${(tab.title || `Tab ${tabIndex + 1}`).replace(/"/g, '\\"')}"\n`;
        yaml += `${indent(3)}tabColor: ${tab.backgroundColor || tab.tabColor || 'null'}\n`;
        yaml += `${indent(3)}canvasColor: ${tab.canvasColor || 'null'}\n`;
        yaml += `${indent(3)}widgets:\n`;
        
        if (tab.widgets && tab.widgets.length > 0) {
          tab.widgets.forEach((widget, widgetIndex) => {
            yaml += `${indent(4)}- id: ${widget.id}\n`;
            yaml += `${indent(5)}type: ${widget.type || 'chart'}\n`;
            yaml += `${indent(5)}title: "${(widget.title || '').replace(/"/g, '\\"')}"\n`;
            yaml += `${indent(5)}order: ${widgetIndex}\n`;
            
            // Semantic view
            const svName = widget.semanticView || widget.semanticViewsReferenced?.[0]?.fullyQualifiedName || widget.semanticViewsReferenced?.[0]?.name || null;
            yaml += `${indent(5)}semanticView: ${svName ? `"${svName}"` : 'null'}\n`;
            
            // Creator and timestamps
            yaml += `${indent(5)}creator: ${widget.creator || widget.createdBy || db.creator || currentRole || 'null'}\n`;
            yaml += `${indent(5)}createdAt: ${widget.createdAt || 'null'}\n`;
            yaml += `${indent(5)}lastUpdatedBy: ${widget.lastUpdatedBy || db.lastUpdatedBy || currentRole || 'null'}\n`;
            yaml += `${indent(5)}lastUpdatedAt: ${widget.lastUpdatedAt || 'null'}\n`;
            
            // Position
            const posX = widget.x ?? widget.position?.x ?? 0;
            const posY = widget.y ?? widget.position?.y ?? 0;
            const posW = widget.width ?? widget.w ?? widget.position?.w ?? widget.size?.width ?? 4;
            const posH = widget.height ?? widget.h ?? widget.position?.h ?? widget.size?.height ?? 3;
            yaml += `${indent(5)}position:\n`;
            yaml += `${indent(6)}x: ${posX}\n`;
            yaml += `${indent(6)}y: ${posY}\n`;
            yaml += `${indent(6)}width: ${posW}\n`;
            yaml += `${indent(6)}height: ${posH}\n`;
            
            // Fields — the core widget definition (shelf assignments)
            yaml += `${indent(5)}fields:\n`;
            const fields = widget.fields || [];
            if (fields.length > 0) {
              fields.forEach(field => {
                yaml += `${indent(6)}- name: "${(typeof field === 'string' ? field : field.name || '').replace(/"/g, '\\"')}"\n`;
                if (field.shelf) yaml += `${indent(7)}shelf: ${field.shelf}\n`;
                if (field.semanticType) yaml += `${indent(7)}semanticType: ${field.semanticType}\n`;
                if (field.markType) yaml += `${indent(7)}markType: ${field.markType}\n`;
                if (field.aggregation) yaml += `${indent(7)}aggregation: ${field.aggregation}\n`;
                if (field.sortDirection) yaml += `${indent(7)}sortDirection: ${field.sortDirection}\n`;
              });
            } else {
              yaml += `${indent(6)}[]\n`;
            }
            
            // Marks (color, detail, cluster, tooltip assignments)
            const marks = widget.marks || {};
            const markEntries = Object.entries(marks).filter(([, v]) => v != null);
            yaml += `${indent(5)}marks:\n`;
            if (markEntries.length > 0) {
              markEntries.forEach(([markType, fieldName]) => {
                yaml += `${indent(6)}${markType}: "${fieldName}"\n`;
              });
            } else {
              yaml += `${indent(6)}{}\n`;
            }
            
            // Config — formatting, colors, display options
            yaml += `${indent(5)}config:\n`;
            const cfg = widget.config || {};
            const cfgEntries = Object.entries(cfg).filter(([, v]) => v != null && v !== '');
            if (cfgEntries.length > 0) {
              cfgEntries.forEach(([key, val]) => {
                if (Array.isArray(val)) {
                  yaml += `${indent(6)}${key}:\n`;
                  val.forEach(item => {
                    yaml += `${indent(7)}- ${typeof item === 'string' ? `"${item}"` : item}\n`;
                  });
                } else if (typeof val === 'object') {
                  yaml += `${indent(6)}${key}:\n`;
                  Object.entries(val).forEach(([k2, v2]) => {
                    if (v2 != null) yaml += `${indent(7)}${k2}: ${typeof v2 === 'string' ? `"${v2}"` : v2}\n`;
                  });
                } else {
                  yaml += `${indent(6)}${key}: ${typeof val === 'string' ? `"${val}"` : val}\n`;
                }
              });
            } else {
              yaml += `${indent(6)}{}\n`;
            }
            
            // Custom columns — only IDs actually used by this widget's fields (+ transitive refs)
            const allCustomCols = widget.customColumns || [];
            const widgetFieldNames = new Set(
              (widget.fields || []).map(f => (typeof f === 'string' ? f : f.name || '').toUpperCase())
            );
            const calcByName = new Map(allCustomCols.map(cc => [cc.name.toUpperCase(), cc]));
            const usedNames = new Set();
            allCustomCols.forEach(cc => {
              if (widgetFieldNames.has(cc.name.toUpperCase())) usedNames.add(cc.name.toUpperCase());
            });
            let didExpand = true;
            while (didExpand) {
              didExpand = false;
              for (const name of usedNames) {
                const cc = calcByName.get(name);
                if (!cc?.expression) continue;
                for (const m of cc.expression.matchAll(/\[([^\]]+)\]/g)) {
                  const ref = m[1].toUpperCase();
                  if (calcByName.has(ref) && !usedNames.has(ref)) {
                    usedNames.add(ref);
                    didExpand = true;
                  }
                }
              }
            }
            const usedCustomCols = allCustomCols.filter(cc => usedNames.has(cc.name.toUpperCase()));
            yaml += `${indent(5)}customColumnIds:\n`;
            if (usedCustomCols.length > 0) {
              usedCustomCols.forEach(col => {
                yaml += `${indent(6)}- "${col.id}"\n`;
              });
            } else {
              yaml += `${indent(6)}[]\n`;
            }
            
            // Semantic views referenced
            yaml += `${indent(5)}semanticViewsReferenced:\n`;
            const semanticViews = widget.semanticViewsReferenced || [];
            if (semanticViews.length > 0) {
              semanticViews.forEach(view => {
                yaml += `${indent(6)}- name: "${view.name || view}"\n`;
                if (view.fullyQualifiedName) {
                  yaml += `${indent(7)}fullyQualifiedName: "${view.fullyQualifiedName}"\n`;
                }
              });
            } else {
              yaml += `${indent(6)}[]\n`;
            }
            
            // Filters applied
            yaml += `${indent(5)}filters:\n`;
            const filtersApplied = widget.filtersApplied || widget.filters || [];
            if (filtersApplied.length > 0) {
              filtersApplied.forEach(filter => {
                yaml += `${indent(6)}- field: "${filter.field}"\n`;
                yaml += `${indent(7)}operator: "${filter.operator || '='}"\n`;
                const fVal = Array.isArray(filter.value) ? filter.value.join(', ') : filter.value;
                yaml += `${indent(7)}value: "${fVal ?? ''}"\n`;
              });
            } else {
              yaml += `${indent(6)}[]\n`;
            }
            
            // Sorts applied
            yaml += `${indent(5)}sorts:\n`;
            const sortsApplied = widget.sortsApplied || widget.sorts || [];
            if (sortsApplied.length > 0) {
              sortsApplied.forEach(sort => {
                yaml += `${indent(6)}- field: "${sort.field}"\n`;
                yaml += `${indent(7)}direction: ${sort.direction || 'asc'}\n`;
              });
            } else {
              yaml += `${indent(6)}[]\n`;
            }
            
            // Query dimensions/measures (resolved field names for the query)
            const qDims = widget.queryDimensions || [];
            const qMeas = widget.queryMeasures || [];
            if (qDims.length > 0 || qMeas.length > 0) {
              yaml += `${indent(5)}queryDimensions: [${qDims.map(d => `"${d}"`).join(', ')}]\n`;
              yaml += `${indent(5)}queryMeasures: [${qMeas.map(m => `"${m}"`).join(', ')}]\n`;
            }
          });
        } else {
          yaml += `${indent(4)}[] # No widgets in this tab\n`;
        }
      });
    } else {
      yaml += `${indent(2)}[] # No tabs defined\n`;
    }
    
    return yaml;
  };

  // Copy YAML to clipboard
  const handleCopyYaml = async () => {
    try {
      await navigator.clipboard.writeText(yamlContent);
      setYamlCopied(true);
      setTimeout(() => setYamlCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Download YAML file
  const handleDownloadYaml = () => {
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(currentDashboard?.title || currentDashboard?.name || 'dashboard').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle file upload
  const handleFileUpload = (event) => {
    event.preventDefault();
    event.stopPropagation();
    
    const file = event.target.files?.[0];
    if (!file) return;
    
    setImportError(null);
    setImportSuccess(false);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result;
        if (typeof content !== 'string') {
          throw new Error('Invalid file content');
        }
        
        // Parse the YAML content using js-yaml
        const parsed = parseYamlContent(content);
        
        if (parsed) {
          // Store the parsed content locally - will be applied when Save is clicked
          const pendingUpdates = {};
          if (parsed.tabs && parsed.tabs.length > 0) {
            pendingUpdates.tabs = parsed.tabs;
          }
          if (parsed.filters) {
            pendingUpdates.filters = parsed.filters;
          }
          if (parsed.semanticViewsReferenced) {
            pendingUpdates.semanticViewsReferenced = parsed.semanticViewsReferenced;
          }
          if (parsed.cortexAgentsEnabled != null) {
            pendingUpdates.cortexAgentsEnabled = parsed.cortexAgentsEnabled;
          }
          if (parsed.cortexAgents) {
            pendingUpdates.cortexAgents = parsed.cortexAgents;
          }
          
          if (Object.keys(pendingUpdates).length > 0) {
            setPendingYamlImport(pendingUpdates);
            setImportSuccess(true);
            // Don't auto-clear success message - user needs to see it until they save
          } else {
            setImportError('No valid dashboard content found in YAML file');
          }
        } else {
          setImportError('Failed to parse YAML or no dashboard loaded');
        }
      } catch (err) {
        console.error('YAML import error:', err);
        setImportError(err.message || 'Failed to parse YAML file');
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read file');
    };
    reader.readAsText(file);
    
    // Reset file input
    event.target.value = '';
  };

  // Parse YAML content using js-yaml library — unified schema
  const parseYamlContent = (content) => {
    try {
      const parsed = yaml.load(content);
      
      if (!parsed) {
        throw new Error('Empty or invalid YAML content');
      }
      
      const dashboardData = parsed.dashboard || parsed;
      const semanticViewsReferenced = dashboardData.semanticViewsReferenced || [];

      // Build a lookup of calculated fields by ID from dashboard-level definitions
      const calcFieldsById = new Map();
      semanticViewsReferenced.forEach(sv => {
        if (typeof sv === 'object' && sv.calculatedFields) {
          sv.calculatedFields.forEach(cf => {
            if (cf.id) calcFieldsById.set(cf.id, cf);
          });
        }
      });

      // Map tabs — resolve customColumnIds → customColumns on each widget
      let tabs = dashboardData.tabs || [];
      tabs = tabs.map(tab => ({
        ...tab,
        backgroundColor: tab.tabColor || tab.backgroundColor || null,
        widgets: (tab.widgets || []).map(w => ({
          ...w,
          customColumns: (w.customColumnIds || w.customColumns || [])
            .map(ref => typeof ref === 'string' ? calcFieldsById.get(ref) : ref)
            .filter(Boolean),
        })),
      }));
      
      return {
        tabs,
        filters: dashboardData.filters || [],
        semanticViewsReferenced,
        cortexAgentsEnabled: dashboardData.cortexAgentsEnabled || false,
        cortexAgents: dashboardData.cortexAgents || [],
        customColorSchemes: dashboardData.customColorSchemes || [],
      };
    } catch (err) {
      console.error('YAML parse error:', err);
      throw new Error(`Failed to parse YAML: ${err.message}`);
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
      // Build the settings object
      const settings = {
        name: name.trim(),
        description: description.trim(),
        warehouse,
        role,
        isPublished,
        visibility,
        access: accessList,
        semanticViewsReferenced,
        cortexAgentsEnabled,
        cortexAgents: cortexAgentsEnabled ? cortexAgents : [],
        folder_id: folderId,
      };
      
      // Include pending YAML import if present
      if (pendingYamlImport) {
        if (pendingYamlImport.tabs) settings.tabs = pendingYamlImport.tabs;
        if (pendingYamlImport.filters) settings.filters = pendingYamlImport.filters;
        if (pendingYamlImport.semanticViewsReferenced) settings.semanticViewsReferenced = pendingYamlImport.semanticViewsReferenced;
        if (pendingYamlImport.cortexAgentsEnabled != null) settings.cortexAgentsEnabled = pendingYamlImport.cortexAgentsEnabled;
        if (pendingYamlImport.cortexAgents) settings.cortexAgents = pendingYamlImport.cortexAgents;
        if (pendingYamlImport.customColorSchemes) settings.customColorSchemes = pendingYamlImport.customColorSchemes;
      }
      
      await onSave(settings);
      
      // Clear pending import after successful save
      setPendingYamlImport(null);
      setImportSuccess(false);
      // Note: onSave handler closes the modal, no need to call onClose() here
    } catch (err) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Filtered groups for the searchable dropdown
  const filteredGroupsForAccess = useMemo(() => {
    return availableGroups
      .filter(g => !accessList.some(a => a.groupId === g.id)) // Exclude already added
      .filter(g => g.name.toLowerCase().includes(groupSearchQuery.toLowerCase())); // Search filter
  }, [availableGroups, accessList, groupSearchQuery]);

  const selectGroupForAccess = (group) => {
    setNewRole(group.id);
    setGroupSearchQuery(group.name);
    setShowGroupDropdown(false);
  };

  const addAccessRole = () => {
    if (!newRole) return;
    
    // Find the selected group
    const selectedGroup = availableGroups.find(g => g.id === newRole);
    if (!selectedGroup) return;
    
    // Check if group is already in the list
    if (accessList.some(a => a.groupId === newRole)) {
      setError('This group already has access');
      return;
    }
    
    // Groups just grant access - no permission level
    // User's app role determines what they can do
    setAccessList([...accessList, { 
      groupId: selectedGroup.id, 
      groupName: selectedGroup.name
    }]);
    setNewRole('');
    setGroupSearchQuery('');
    setError(null);
  };
  
  // Close group dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (groupSearchRef.current && !groupSearchRef.current.contains(e.target)) {
        setShowGroupDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const removeAccessRole = (groupId) => {
    setAccessList(accessList.filter(a => (a.groupId || a.role) !== groupId));
  };

  const getPermissionIcon = (permission) => {
    switch (permission) {
      case 'owner': return <FiLock />;
      case 'admin': return <FiSettings />;
      case 'edit': return <FiEdit />;
      case 'view': return <FiEye />;
      default: return <FiEye />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">
            <FiSettings />
            <h2>Dashboard Settings</h2>
          </div>
          <button className="close-btn" onClick={handleCancel}>
            <FiX />
          </button>
        </div>

        <div className="settings-tabs">
          <button 
            className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            <FiLayout /> General
          </button>
          <button 
            className={`settings-tab ${activeTab === 'access' ? 'active' : ''}`}
            onClick={() => setActiveTab('access')}
          >
            <FiDatabase /> Connection & Access
          </button>
          <button 
            className={`settings-tab ${activeTab === 'yaml' ? 'active' : ''}`}
            onClick={() => setActiveTab('yaml')}
          >
            <FiCode /> Import/Export
          </button>
        </div>

        <div className="settings-body">
          {error && (
            <div className="settings-error">
              {error}
            </div>
          )}

          {activeTab === 'general' && (
            <div className="settings-section">
              <div className="form-group">
                <label className="form-label">Dashboard Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter dashboard name"
                  maxLength={100}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-input form-textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe this dashboard..."
                  rows={3}
                  maxLength={500}
                />
                <span className="char-count">{description.length}/500</span>
              </div>

              {/* Folder */}
              <div className="form-group">
                <label className="form-label">
                  <FiFolder className="label-icon" />
                  Folder
                </label>
                <div className="folder-selector">
                  <button 
                    type="button"
                    className="folder-selector-btn"
                    onClick={() => setFolderDropdownOpen(!folderDropdownOpen)}
                  >
                    {folderId ? (
                      <>
                        <FiFolder /> {folders.find(f => f.id === folderId)?.name || 'Selected Folder'}
                      </>
                    ) : (
                      <>
                        <FiHome /> Root (No folder)
                      </>
                    )}
                  </button>
                  {folderDropdownOpen && (
                    <div className="folder-dropdown">
                      <div className="folder-search-container">
                        <FiSearch className="folder-search-icon" />
                        <input
                          type="text"
                          className="folder-search-input"
                          placeholder="Search folders..."
                          value={folderSearchQuery}
                          onChange={(e) => setFolderSearchQuery(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      </div>
                      <div className="folder-options-list">
                        {(!folderSearchQuery || 'root'.includes(folderSearchQuery.toLowerCase()) || 'no folder'.includes(folderSearchQuery.toLowerCase())) && (
                          <button
                            type="button"
                            className={`folder-option ${!folderId ? 'selected' : ''}`}
                            onClick={() => {
                              setFolderId(null);
                              setFolderDropdownOpen(false);
                              setFolderSearchQuery('');
                            }}
                          >
                            <FiHome /> Root (No folder)
                          </button>
                        )}
                        {folders
                          .filter(folder => !folderSearchQuery || folder.name.toLowerCase().includes(folderSearchQuery.toLowerCase()))
                          .map(folder => (
                          <button
                            key={folder.id}
                            type="button"
                            className={`folder-option ${folderId === folder.id ? 'selected' : ''}`}
                            onClick={() => {
                              setFolderId(folder.id);
                              setFolderDropdownOpen(false);
                              setFolderSearchQuery('');
                            }}
                          >
                            <FiFolder style={{ color: folder.color || '#6366f1' }} /> {folder.name}
                          </button>
                        ))}
                      </div>
                      
                      {/* Create new folder inline */}
                      {showInlineCreateFolder ? (
                        <div className="inline-create-folder">
                          <input
                            type="text"
                            placeholder="New folder name..."
                            value={inlineFolderName}
                            onChange={(e) => setInlineFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleInlineCreateFolder();
                              }
                              if (e.key === 'Escape') {
                                setShowInlineCreateFolder(false);
                                setInlineFolderName('');
                              }
                            }}
                            autoFocus
                            disabled={creatingInlineFolder}
                          />
                          <button 
                            type="button"
                            className="inline-create-btn"
                            onClick={handleInlineCreateFolder}
                            disabled={!inlineFolderName.trim() || creatingInlineFolder}
                          >
                            {creatingInlineFolder ? '...' : <FiPlus />}
                          </button>
                          <button 
                            type="button"
                            className="inline-cancel-btn"
                            onClick={() => {
                              setShowInlineCreateFolder(false);
                              setInlineFolderName('');
                            }}
                          >
                            <FiX />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="folder-option create-new-folder"
                          onClick={() => setShowInlineCreateFolder(true)}
                        >
                          <FiPlus /> Create New Folder <span className="folder-hint">(at root)</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Semantic Views Referenced */}
              <div className="form-group semantic-views-section">
                <label className="form-label">
                  <FiLayers className="label-icon" />
                  Semantic Views
                </label>
                <p className="form-hint" style={{ marginBottom: '12px' }}>
                  Select semantic views that this dashboard can use for widgets.
                </p>
                
                {/* Add semantic view */}
                <div className="semantic-view-add">
                  <div className="select-wrapper" style={{ flex: 1 }}>
                    <select
                      className="form-input"
                      value={selectedSemanticView}
                      onChange={(e) => setSelectedSemanticView(e.target.value)}
                    >
                      <option value="">Select semantic view...</option>
                      {availableSemanticViews
                        .filter(v => !semanticViewsReferenced.some(ref => 
                          (typeof ref === 'string' ? ref : ref.name) === (v.name || v)
                        ))
                        .map((view) => (
                          <option key={view.name || view} value={view.name || view}>
                            {view.name || view}
                          </option>
                        ))}
                    </select>
                    <FiChevronDown className="select-icon" />
                  </div>
                  <button 
                    className="btn btn-secondary add-btn"
                    onClick={addSemanticView}
                    disabled={!selectedSemanticView}
                  >
                    <FiPlus /> Add
                  </button>
                </div>

                {/* List of added semantic views */}
                <div className="semantic-views-list">
                  {semanticViewsReferenced.length === 0 ? (
                    <div className="semantic-views-empty">
                      <FiLayers />
                      <span>No semantic views added</span>
                    </div>
                  ) : (
                    semanticViewsReferenced.map((view, index) => {
                      const viewName = typeof view === 'string' ? view : view.name;
                      const viewFqn = typeof view === 'object' ? view.fullyQualifiedName : null;
                      const hasError = errorViewName === viewName;
                      return (
                        <div 
                          key={viewName || index} 
                          className={`semantic-view-item ${hasError ? 'semantic-view-item-error' : ''}`}
                        >
                          <div className="semantic-view-info">
                            <FiLayers className="view-icon" />
                            <div className="view-details">
                              <span className="view-name">{viewName}</span>
                              {viewFqn && <span className="view-fqn">{viewFqn}</span>}
                            </div>
                          </div>
                          <button
                            className="remove-view-btn"
                            onClick={() => removeSemanticView(viewName)}
                            title="Remove semantic view"
                          >
                            <FiTrash2 />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                
                {/* Error message for semantic view removal */}
                {semanticViewError && (
                  <div className="semantic-view-error shake">
                    <FiAlertCircle />
                    <span>{semanticViewError}</span>
                  </div>
                )}
              </div>

              {/* Cortex Agents */}
              <div className="form-group cortex-agents-section">
                <div className="cortex-agents-header">
                  <label className="form-label" style={{ margin: 0 }}>
                    <FiZap className="label-icon" />
                    Cortex Agents
                  </label>
                  <label className="cortex-toggle">
                    <input
                      type="checkbox"
                      checked={cortexAgentsEnabled}
                      onChange={(e) => setCortexAgentsEnabled(e.target.checked)}
                    />
                    <span className="cortex-toggle-track" />
                  </label>
                </div>

                {cortexAgentsEnabled && (
                  <div className="cortex-agents-content">
                    {/* Add cortex agent */}
                    <div className="semantic-view-add">
                      <div className="select-wrapper" style={{ flex: 1 }}>
                        <select
                          className="form-input"
                          value={selectedCortexAgent}
                          onChange={(e) => setSelectedCortexAgent(e.target.value)}
                        >
                          <option value="">Select cortex agent...</option>
                          {availableCortexAgents
                            .filter(a => !cortexAgents.some(ref => 
                              (typeof ref === 'object' ? ref.fullyQualifiedName : ref) === a.fullyQualifiedName
                            ))
                            .map((agent) => (
                              <option key={agent.fullyQualifiedName} value={agent.fullyQualifiedName}>
                                {agent.fullyQualifiedName}
                              </option>
                            ))}
                        </select>
                        <FiChevronDown className="select-icon" />
                      </div>
                      <button 
                        className="btn btn-secondary add-btn"
                        onClick={addCortexAgent}
                        disabled={!selectedCortexAgent}
                      >
                        <FiPlus /> Add
                      </button>
                    </div>

                    {/* List of added cortex agents */}
                    <div className="semantic-views-list">
                      {cortexAgents.length === 0 ? (
                        <div className="semantic-views-empty">
                          <FiZap />
                          <span>No cortex agents added</span>
                        </div>
                      ) : (
                        cortexAgents.map((agent, index) => {
                          const agentName = typeof agent === 'string' ? agent : agent.name;
                          const agentFqn = typeof agent === 'object' ? agent.fullyQualifiedName : agent;
                          return (
                            <div key={agentFqn || index} className="semantic-view-item">
                              <div className="semantic-view-info">
                                <FiZap className="view-icon" />
                                <div className="view-details">
                                  <span className="view-name">{agentName}</span>
                                  {agentFqn && <span className="view-fqn">{agentFqn}</span>}
                                </div>
                              </div>
                              <button
                                className="remove-view-btn"
                                onClick={() => removeCortexAgent(agentFqn)}
                                title="Remove cortex agent"
                              >
                                <FiTrash2 />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'access' && (
            <div className="settings-section">
              {/* Connection Settings */}
              <div className="settings-subsection">
                <h3 className="subsection-title">
                  <FiDatabase /> Connection
                </h3>
                
                {/* Connection Name with Menu */}
                <div className="form-group">
                  <label className="form-label">Connection</label>
                  <div className="connection-row">
                    <div className="immutable-value">
                      <FiDatabase className="immutable-icon" />
                      <span>{dashboard?.connection_name || 'Not configured'}</span>
                    </div>
                    
                    {/* Connection Menu */}
                    <div className="connection-menu-container" ref={connectionMenuRef}>
                      <button 
                        type="button"
                        ref={connectionMenuBtnRef}
                        className="btn btn-icon btn-secondary connection-menu-btn"
                        onClick={() => {
                          if (!showConnectionMenu && connectionMenuBtnRef.current) {
                            const rect = connectionMenuBtnRef.current.getBoundingClientRect();
                            setConnectionMenuPos({
                              top: rect.bottom + 4,
                              left: rect.right - 180, // dropdown width
                            });
                          }
                          setShowConnectionMenu(!showConnectionMenu);
                        }}
                        title="Connection options"
                      >
                        <FiMoreVertical />
                      </button>
                      
                      {showConnectionMenu && (
                        <div 
                          className="connection-menu-dropdown"
                          style={{ top: connectionMenuPos.top, left: connectionMenuPos.left }}
                        >
                          <button 
                            className="connection-menu-item"
                            onClick={() => {
                              setShowConnectionMenu(false);
                              testConnection();
                            }}
                            disabled={testingConnection || !dashboard?.connection_id}
                          >
                            {testingConnection ? (
                              <><FiRefreshCw className="spin" /> Testing...</>
                            ) : (
                              <><FiWifi /> Test Connection</>
                            )}
                          </button>
                          {isOwner && (
                            <button 
                              className="connection-menu-item"
                              onClick={() => {
                                setShowConnectionMenu(false);
                                loadAvailableConnections();
                                setSelectedConnectionId(dashboard?.connection_id || null);
                                setShowReplaceConnection(true);
                              }}
                            >
                              <FiRefreshCw /> Replace Connection
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Connection Test Result */}
                  {connectionTestResult && (
                    <div className={`connection-test-result ${connectionTestResult.success ? 'success' : 'error'}`}>
                      {connectionTestResult.success ? <FiCheck /> : <FiAlertCircle />}
                      <span>{connectionTestResult.message}</span>
                    </div>
                  )}
                </div>
                
                {/* Warehouse Selection */}
                <div className="form-group">
                  <label className="form-label">
                    <FiServer className="label-icon" />
                    Warehouse
                  </label>
                  <div className="select-wrapper">
                    <select
                      className="form-input"
                      value={warehouse}
                      onChange={(e) => setWarehouse(e.target.value)}
                      disabled={loadingResources}
                    >
                      {warehouse && (
                        <option value={warehouse}>{warehouse}</option>
                      )}
                      {availableWarehouses
                        .filter(wh => (wh.name || wh) !== warehouse)
                        .map((wh) => (
                          <option key={wh.name || wh} value={wh.name || wh}>
                            {wh.name || wh}
                          </option>
                        ))}
                    </select>
                    <FiChevronDown className="select-icon" />
                    {loadingResources && (
                      <FiRefreshCw className="loading-icon spin" />
                    )}
                  </div>
                </div>
                
                {/* Role Selection */}
                <div className="form-group">
                  <label className="form-label">
                    <FiUser className="label-icon" />
                    Role
                  </label>
                  <div className="select-wrapper">
                    <select
                      className="form-input"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      disabled={loadingResources}
                    >
                      {role && (
                        <option value={role}>{role}</option>
                      )}
                      {availableRoles
                        .filter(r => (r.name || r) !== role)
                        .map((r) => (
                          <option key={r.name || r} value={r.name || r}>
                            {r.name || r}
                          </option>
                        ))}
                    </select>
                    <FiChevronDown className="select-icon" />
                    {loadingResources && (
                      <FiRefreshCw className="loading-icon spin" />
                    )}
                  </div>
                </div>
              </div>

              {/* Publication Status */}
              <div className="settings-subsection">
                <h3 className="subsection-title">
                  <FiEye /> Publication Status
                </h3>
                <div className="published-toggle">
                  <button
                    type="button"
                    className={`toggle-option ${!isPublished ? 'active' : ''}`}
                    onClick={() => setIsPublished(false)}
                  >
                    <FiEdit size={14} />
                    Draft
                  </button>
                  <button
                    type="button"
                    className={`toggle-option ${isPublished ? 'active' : ''}`}
                    onClick={() => setIsPublished(true)}
                  >
                    <FiEye size={14} />
                    Published
                  </button>
                </div>
                <p className="form-hint">
                  {isPublished 
                    ? 'This dashboard is published and visible to permitted users.'
                    : 'Draft mode — only you can see this dashboard while editing.'}
                </p>
              </div>

              {/* Access Type: Private/Public */}
              <div className="settings-subsection">
                <h3 className="subsection-title">
                  <FiLock /> Access Type
                </h3>
                <div className="published-toggle">
                  <button
                    type="button"
                    className={`toggle-option ${visibility === 'private' ? 'active' : ''}`}
                    onClick={() => setVisibility('private')}
                  >
                    <FiLock size={14} />
                    Private
                  </button>
                  <button
                    type="button"
                    className={`toggle-option ${visibility === 'public' ? 'active' : ''}`}
                    onClick={() => setVisibility('public')}
                  >
                    <FiUsers size={14} />
                    Public
                  </button>
                </div>
                <p className="form-hint">
                  {visibility === 'public' 
                    ? 'All users in the organization can view this dashboard when published.'
                    : 'Only user groups added below can access this dashboard.'}
                </p>
              </div>

              {/* Access Control - Group Based (only for private dashboards) */}
              {visibility === 'private' && (
              <div className="settings-subsection">
                <h3 className="subsection-title">
                  <FiUsers /> Group Access
                </h3>
                <p className="section-description">
                  Add groups that can access this private dashboard. Users' permissions are determined by their app role (Admin, Editor, Viewer).
                </p>

                <div className="access-list">
                  {/* Owner - always shown first */}
                  <div className="access-item owner">
                    <div className="access-role">
                      <FiLock className="role-icon owner" />
                      <span>{dashboard?.ownerUsername || dashboard?.owner_username || 'Owner'}</span>
                      <span className="role-badge owner">Owner</span>
                    </div>
                    <div className="access-permission">
                      <span className="permission-text">Full Control</span>
                    </div>
                  </div>

                  {/* Groups with access */}
                  {accessList.map((access) => (
                    <div key={access.groupId || access.role} className="access-item">
                      <div className="access-role">
                        <FiUsers className="role-icon" />
                        <span>{access.groupName || access.role}</span>
                      </div>
                      <div className="access-permission">
                        <span className="permission-text group-access">Has Access</span>
                        <button 
                          className="remove-access-btn"
                          onClick={() => removeAccessRole(access.groupId || access.role)}
                          title="Remove access"
                        >
                          <FiTrash2 />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add group access */}
                <div className="add-access">
                  <h4>Add Group Access</h4>
                  <div className="add-access-form">
                    <div className="group-search-wrapper" ref={groupSearchRef} style={{ flex: 1 }}>
                      <div className="search-input-container">
                        <FiSearch className="search-icon" />
                        <input
                          type="text"
                          className="form-input search-input"
                          placeholder="Search groups..."
                          value={groupSearchQuery}
                          onChange={(e) => {
                            setGroupSearchQuery(e.target.value);
                            setNewRole(''); // Clear selection when typing
                            setShowGroupDropdown(true);
                          }}
                          onFocus={() => setShowGroupDropdown(true)}
                        />
                        {groupSearchQuery && (
                          <button 
                            className="clear-search-btn"
                            onClick={() => {
                              setGroupSearchQuery('');
                              setNewRole('');
                            }}
                          >
                            <FiX />
                          </button>
                        )}
                      </div>
                      {showGroupDropdown && (
                        <div className="group-search-dropdown">
                          {filteredGroupsForAccess.length === 0 ? (
                            <div className="no-results">
                              {groupSearchQuery 
                                ? 'No groups match your search'
                                : 'All groups already have access'}
                            </div>
                          ) : (
                            filteredGroupsForAccess.map(group => (
                              <button
                                key={group.id}
                                className={`group-option ${newRole === group.id ? 'selected' : ''}`}
                                onClick={() => selectGroupForAccess(group)}
                              >
                                <FiUsers className="group-icon" />
                                <span className="group-name">{group.name}</span>
                                <span className="member-count">{group.memberCount || 0} members</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    <button 
                      className="btn btn-secondary add-btn"
                      onClick={addAccessRole}
                      disabled={!newRole}
                    >
                      <FiPlus /> Add Group
                    </button>
                  </div>
                  <p className="form-hint">
                    Search for a group to grant access. User permissions are based on their app role.
                  </p>
                </div>
              </div>
              )}
              
              {/* Transfer Ownership - Owner Only */}
              {isOwner && adminRoles.length > 0 && (
                <div className="transfer-ownership-section">
                  <h4>
                    <FiUserCheck /> Transfer Ownership
                  </h4>
                  <p className="section-description warning">
                    Transfer dashboard ownership to another admin. This action cannot be undone.
                  </p>
                  
                  {!showTransferConfirm ? (
                    <div className="transfer-form">
                      <div className="select-wrapper">
                        <select
                          className="form-input"
                          value={transferOwnerTo}
                          onChange={(e) => setTransferOwnerTo(e.target.value)}
                        >
                          <option value="">Select admin role...</option>
                          {adminRoles.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                        <FiChevronDown className="select-icon" />
                      </div>
                      <button 
                        className="btn btn-danger"
                        onClick={() => setShowTransferConfirm(true)}
                        disabled={!transferOwnerTo}
                      >
                        Transfer Ownership
                      </button>
                    </div>
                  ) : (
                    <div className="transfer-confirm">
                      <p className="confirm-message">
                        Are you sure you want to transfer ownership to <strong>{transferOwnerTo}</strong>?
                        You will lose owner privileges.
                      </p>
                      <div className="confirm-actions">
                        <button 
                          className="btn btn-danger"
                          onClick={handleTransferOwnership}
                        >
                          Confirm Transfer
                        </button>
                        <button 
                          className="btn btn-secondary"
                          onClick={() => setShowTransferConfirm(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'yaml' && (
            <div className="settings-section yaml-section">
              <p className="section-description">
                Export the dashboard configuration as YAML or import from a file.
                <strong className="yaml-live-notice"> The preview below reflects the current state including any unsaved changes.</strong>
              </p>

              {/* Import/Export buttons */}
              <div className="yaml-actions">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".yaml,.yml"
                  style={{ display: 'none' }}
                />
                <button 
                  type="button"
                  className="btn btn-secondary yaml-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FiUpload /> Import YAML
                </button>
                <button 
                  type="button"
                  className="btn btn-secondary yaml-btn"
                  onClick={handleDownloadYaml}
                >
                  <FiDownload /> Export YAML
                </button>
                <button 
                  type="button"
                  className="btn btn-secondary yaml-btn"
                  onClick={handleCopyYaml}
                >
                  {yamlCopied ? <><FiCheck /> Copied!</> : <><FiCopy /> Copy to Clipboard</>}
                </button>
              </div>

              {/* Status messages */}
              {importError && (
                <div className="yaml-message error">
                  <FiAlertCircle /> {importError}
                </div>
              )}
              {importSuccess && pendingYamlImport && (
                <div className="yaml-message success">
                  <FiCheck /> YAML parsed successfully! Click "Save Settings" to apply changes.
                </div>
              )}

              {/* YAML Preview */}
              <div className="yaml-preview-container">
                <div className="yaml-preview-header">
                  <span className="yaml-preview-title">
                    <FiCode /> Dashboard YAML Preview
                  </span>
                  <span className="yaml-live-badge">Live Preview</span>
                </div>
                <pre className="yaml-preview">
                  <code>{yamlContent || '# Loading...'}</code>
                </pre>
              </div>

              <div className="yaml-info">
                <h4>About YAML Import/Export</h4>
                <ul>
                  <li><strong>Export:</strong> Download the current dashboard configuration including all tabs, widgets, and settings.</li>
                  <li><strong>Import:</strong> Upload a YAML file to replace the current dashboard configuration. Changes will be applied locally and must be saved.</li>
                  <li><strong>Live Preview:</strong> The preview above shows the current state in real-time, including any unsaved edits you've made.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn btn-secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button 
            className="btn btn-primary" 
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
          >
            {isSaving ? (
              <>
                <FiRefreshCw className="spin" /> Saving...
              </>
            ) : (
              <>
                <FiCheck /> Save Settings
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* Replace Connection Modal */}
      {showReplaceConnection && (
        <div className="replace-connection-overlay">
          <div className="replace-connection-modal">
            <div className="modal-header">
              <h3><FiDatabase /> Replace Connection</h3>
              <button 
                className="close-btn" 
                onClick={() => {
                  setShowReplaceConnection(false);
                  setSelectedConnectionId(null);
                }}
              >
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p className="replace-warning">
                <FiAlertCircle /> Changing the connection may affect widget queries and data access.
              </p>
              
              <div className="form-group">
                <label className="form-label">Select Connection</label>
                {loadingConnections ? (
                  <div className="loading-connections">
                    <FiRefreshCw className="spin" /> Loading connections...
                  </div>
                ) : availableConnections.length === 0 ? (
                  <p className="no-connections">No connections available. Create a connection in Settings first.</p>
                ) : (
                  <div className="connections-list">
                    {availableConnections.map(conn => (
                      <label 
                        key={conn.id} 
                        className={`connection-option ${selectedConnectionId === conn.id ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="connection"
                          value={conn.id}
                          checked={selectedConnectionId === conn.id}
                          onChange={() => setSelectedConnectionId(conn.id)}
                        />
                        <div className="connection-option-info">
                          <span className="connection-name">{conn.name}</span>
                          <span className="connection-account">{conn.account}</span>
                        </div>
                        {conn.id === dashboard?.connection_id && (
                          <span className="current-badge">Current</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  setShowReplaceConnection(false);
                  setSelectedConnectionId(null);
                }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleReplaceConnection}
                disabled={!selectedConnectionId || selectedConnectionId === dashboard?.connection_id}
              >
                <FiCheck /> Replace Connection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardSettings;
