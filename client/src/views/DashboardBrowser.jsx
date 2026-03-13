/**
 * Dashboard Browser - Tableau-style folder navigation for dashboards
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  FiSearch, FiFolder, FiGrid, FiPlus, FiChevronRight, 
  FiHome, FiEdit2, FiTrash2, FiMoreVertical, FiX,
  FiClock, FiUser, FiGlobe, FiLock, FiMove, FiCornerUpLeft, FiUsers
} from 'react-icons/fi';
import { folderApi, groupApi, dashboardApi } from '../api/apiClient';
import { useAppStore } from '../store/appStore';
import CreateDashboardModal from '../components/CreateDashboardModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import '../styles/DashboardBrowser.css';

export default function DashboardBrowser() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const { currentRole, isAuthenticated, isInitialized } = useAppStore();
  
  // State
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [folderPath, setFolderPath] = useState([]);
  const [folders, setFolders] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  
  // Modals
  const [showCreateDashboard, setShowCreateDashboard] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderError, setNewFolderError] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  
  // Delete folder
  const [deletingFolder, setDeletingFolder] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  
  // Delete dashboard
  const [deletingDashboard, setDeletingDashboard] = useState(null);
  const [deleteDashboardError, setDeleteDashboardError] = useState('');
  
  // Move dashboard
  const [movingDashboard, setMovingDashboard] = useState(null);
  const [allFolders, setAllFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [selectedMoveFolder, setSelectedMoveFolder] = useState(null);
  const [movingError, setMovingError] = useState('');
  
  // Move folder dropdown
  const [moveFolderDropdownOpen, setMoveFolderDropdownOpen] = useState(false);
  const [showInlineCreateFolder, setShowInlineCreateFolder] = useState(false);
  const [inlineFolderName, setInlineFolderName] = useState('');
  const [creatingInlineFolder, setCreatingInlineFolder] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  
  // Context menu
  const [contextMenu, setContextMenu] = useState(null);
  
  // Add menu dropdown
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef(null);
  
  // Folder access management
  const [managingAccessFolder, setManagingAccessFolder] = useState(null);
  const [folderGroups, setFolderGroups] = useState([]);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [loadingFolderAccess, setLoadingFolderAccess] = useState(false);
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');
  const [folderAccessError, setFolderAccessError] = useState('');
  
  const canCreateDashboards = ['owner', 'admin', 'creator', 'editor'].includes(currentRole);
  const canManageFolders = ['owner', 'admin', 'creator', 'editor'].includes(currentRole);
  
  // Load folder contents
  const loadContents = useCallback(async (folderId = null) => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await folderApi.getContents(folderId);
      setFolders(data.folders || []);
      setDashboards(data.dashboards || []);
      setCurrentFolder(data.folder || null);
      setFolderPath(data.path || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Initial load - only when authenticated
  useEffect(() => {
    // Don't load until app is initialized and user is authenticated
    if (!isInitialized || !isAuthenticated) {
      return;
    }
    
    const folderId = searchParams.get('folder');
    setCurrentFolderId(folderId);
    loadContents(folderId);
  }, [searchParams, loadContents, isInitialized, isAuthenticated]);
  
  // Search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    
    const timer = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        setIsSearching(true);
        try {
          console.log('Searching for:', searchQuery);
          const results = await folderApi.search(searchQuery);
          console.log('Search results:', results);
          // Ensure we have valid arrays
          setSearchResults({
            folders: results?.folders || [],
            dashboards: results?.dashboards || []
          });
        } catch (err) {
          console.error('Search error:', err);
          setSearchResults({ folders: [], dashboards: [] });
        } finally {
          setIsSearching(false);
        }
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [searchQuery]);
  
  // Navigate to folder
  const navigateToFolder = (folderId) => {
    setSearchQuery('');
    setSearchResults(null);
    if (folderId) {
      setSearchParams({ folder: folderId });
    } else {
      setSearchParams({});
    }
  };
  
  // Open dashboard
  const openDashboard = (dashboardId) => {
    navigate(`/dashboards?id=${dashboardId}`);
  };
  
  // Create folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setNewFolderError('Folder name is required');
      return;
    }
    
    setCreatingFolder(true);
    setNewFolderError('');
    
    try {
      await folderApi.create({
        name: newFolderName.trim(),
        parentId: currentFolderId,
      });
      
      setNewFolderName('');
      setShowCreateFolder(false);
      loadContents(currentFolderId);
    } catch (err) {
      setNewFolderError(err.message);
    } finally {
      setCreatingFolder(false);
    }
  };
  
  // Delete folder
  const handleDeleteFolder = async () => {
    if (!deletingFolder) return;
    
    try {
      await folderApi.delete(deletingFolder.id);
      setDeletingFolder(null);
      setDeleteError('');
      loadContents(currentFolderId);
    } catch (err) {
      setDeleteError(err.message);
    }
  };
  
  // Delete dashboard
  const handleDeleteDashboard = async () => {
    if (!deletingDashboard) return;
    
    try {
      await dashboardApi.delete(deletingDashboard.id);
      setDeletingDashboard(null);
      setDeleteDashboardError('');
      loadContents(currentFolderId);
    } catch (err) {
      setDeleteDashboardError(err.message);
    }
  };
  
  // Open move dashboard modal
  const openMoveDashboardModal = async (dashboard) => {
    setMovingDashboard(dashboard);
    setSelectedMoveFolder(dashboard.folder_id || 'root');
    setMovingError('');
    setMoveFolderDropdownOpen(false);
    setShowInlineCreateFolder(false);
    setInlineFolderName('');
    setFolderSearchQuery('');
    setLoadingFolders(true);
    
    try {
      const allFoldersData = await folderApi.getContents(null);
      // Build a flat list of all folders by recursively fetching
      // For simplicity, we'll just show root folders for now
      setAllFolders(allFoldersData.folders || []);
    } catch (err) {
      console.error('Failed to load folders:', err);
    } finally {
      setLoadingFolders(false);
    }
  };
  
  // Move dashboard to folder
  const handleMoveDashboard = async () => {
    if (!movingDashboard) return;
    
    const targetFolderId = selectedMoveFolder === 'root' ? null : selectedMoveFolder;
    
    try {
      await folderApi.moveDashboard(movingDashboard.id, targetFolderId);
      setMovingDashboard(null);
      setMovingError('');
      setShowInlineCreateFolder(false);
      setInlineFolderName('');
      loadContents(currentFolderId);
    } catch (err) {
      setMovingError(err.message);
    }
  };
  
  // Create folder inline (from move modal)
  const handleInlineCreateFolder = async () => {
    if (!inlineFolderName.trim()) return;
    
    setCreatingInlineFolder(true);
    try {
      const newFolder = await folderApi.create({
        name: inlineFolderName.trim(),
        parentId: null // Create at root level
      });
      // Add to folder list and select it (API returns folder directly, not wrapped)
      setAllFolders([...allFolders, newFolder]);
      setSelectedMoveFolder(newFolder.id);
      setShowInlineCreateFolder(false);
      setInlineFolderName('');
      setFolderSearchQuery('');
      setMoveFolderDropdownOpen(false);
    } catch (err) {
      setMovingError(err.message);
    } finally {
      setCreatingInlineFolder(false);
    }
  };
  
  // Open folder access management modal
  const openFolderAccessModal = async (folder) => {
    setManagingAccessFolder(folder);
    setLoadingFolderAccess(true);
    setFolderAccessError('');
    setSelectedGroupToAdd('');
    
    try {
      // Load folder's current group access
      const accessData = await folderApi.getAccess(folder.id);
      setFolderGroups(accessData.groups || []);
      
      // Load all available groups
      const allGroups = await groupApi.getAll();
      setAvailableGroups(allGroups.groups || []);
    } catch (err) {
      console.error('Failed to load folder access:', err);
      setFolderAccessError('Failed to load access settings');
    } finally {
      setLoadingFolderAccess(false);
    }
  };
  
  // Add group access to folder
  const handleAddFolderAccess = async () => {
    if (!selectedGroupToAdd || !managingAccessFolder) return;
    
    try {
      await folderApi.grantAccess(managingAccessFolder.id, selectedGroupToAdd);
      // Refresh the groups list
      const accessData = await folderApi.getAccess(managingAccessFolder.id);
      setFolderGroups(accessData.groups || []);
      setSelectedGroupToAdd('');
    } catch (err) {
      console.error('Failed to add group access:', err);
      setFolderAccessError(err.message || 'Failed to add group access');
    }
  };
  
  // Remove group access from folder
  const handleRemoveFolderAccess = async (groupId) => {
    if (!managingAccessFolder) return;
    
    try {
      await folderApi.revokeAccess(managingAccessFolder.id, groupId);
      setFolderGroups(folderGroups.filter(g => g.id !== groupId));
    } catch (err) {
      console.error('Failed to remove group access:', err);
      setFolderAccessError(err.message || 'Failed to remove group access');
    }
  };
  
  // Close folder access modal
  const closeFolderAccessModal = () => {
    setManagingAccessFolder(null);
    setFolderGroups([]);
    setFolderAccessError('');
    setSelectedGroupToAdd('');
  };
  
  // Get groups that aren't already added to the folder
  const getAvailableGroupsForFolder = () => {
    const addedGroupIds = folderGroups.map(g => g.id);
    return availableGroups.filter(g => !addedGroupIds.includes(g.id));
  };
  
  // Format date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    
    return date.toLocaleDateString();
  };
  
  // Render breadcrumb
  const renderBreadcrumb = () => (
    <nav className="browser-breadcrumb">
      <button 
        className={`breadcrumb-item ${!currentFolderId ? 'active' : ''}`}
        onClick={() => navigateToFolder(null)}
      >
        <FiHome />
        <span>All Dashboards</span>
      </button>
      
      {folderPath.map((folder, index) => (
        <span key={folder.id} className="breadcrumb-segment">
          <FiChevronRight className="breadcrumb-separator" />
          <button
            className={`breadcrumb-item ${index === folderPath.length - 1 ? 'active' : ''}`}
            onClick={() => navigateToFolder(folder.id)}
          >
            <span>{folder.name}</span>
          </button>
        </span>
      ))}
    </nav>
  );
  
  // Render search results
  const renderSearchResults = () => {
    if (!searchResults) return null;
    
    const searchFolders = searchResults.folders || [];
    const searchDashboards = searchResults.dashboards || [];
    const hasResults = searchFolders.length > 0 || searchDashboards.length > 0;
    
    return (
      <div className="search-results">
        <div className="search-results-header">
          <h3>Search Results</h3>
          <button className="clear-search" onClick={() => { setSearchQuery(''); setSearchResults(null); }}>
            <FiX /> Clear
          </button>
        </div>
        
        {!hasResults && !isSearching && (
          <p className="no-results">No results found for "{searchQuery}"</p>
        )}
        
        {searchFolders.length > 0 && (
          <div className="search-section">
            <h4>Folders</h4>
            <div className="items-grid">
              {searchFolders.map(folder => (
                <div
                  key={folder.id}
                  className="item-card folder-card"
                  onClick={() => navigateToFolder(folder.id)}
                >
                  <div className="item-icon" style={{ backgroundColor: folder.color || '#6366f1' }}>
                    <FiFolder />
                  </div>
                  <div className="item-info">
                    <h4>{folder.name}</h4>
                    <p>{folder.description || 'Folder'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {searchDashboards.length > 0 && (
          <div className="search-section">
            <h4>Dashboards</h4>
            <div className="items-grid">
              {searchDashboards.map(dashboard => (
                <div
                  key={dashboard.id}
                  className="item-card dashboard-card"
                  onClick={() => openDashboard(dashboard.id)}
                >
                  <div className="item-icon dashboard-icon">
                    <FiGrid />
                  </div>
                  <div className="item-info">
                    <h4>{dashboard.name}</h4>
                    <p>{dashboard.description || 'Dashboard'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };
  
  // Render folder card
  const renderFolderCard = (folder) => (
    <div
      key={folder.id}
      className="item-card folder-card"
      onClick={() => navigateToFolder(folder.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (canManageFolders) {
          setContextMenu({ x: e.clientX, y: e.clientY, folder });
        }
      }}
    >
      <div className="item-icon" style={{ backgroundColor: folder.color || '#6366f1' }}>
        <FiFolder />
      </div>
      <div className="item-info">
        <h4>{folder.name}</h4>
        <div className="item-meta">
          <span><FiFolder /> {folder.subfolder_count || 0}</span>
          <span><FiGrid /> {folder.dashboard_count || 0}</span>
        </div>
      </div>
      {canManageFolders && (
        <button 
          className="item-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, folder });
          }}
        >
          <FiMoreVertical />
        </button>
      )}
    </div>
  );
  
  // Render dashboard card
  const renderDashboardCard = (dashboard) => (
    <div
      key={dashboard.id}
      className="item-card dashboard-card"
      onClick={() => openDashboard(dashboard.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (canManageFolders) {
          setContextMenu({ x: e.clientX, y: e.clientY, dashboard });
        }
      }}
    >
      <div className="item-icon dashboard-icon">
        <FiGrid />
      </div>
      <div className="item-info">
        <h4>{dashboard.name}</h4>
        <div className="item-meta">
          <span className="meta-item">
            <FiUser /> {dashboard.owner_name}
          </span>
          <span className="meta-item">
            <FiClock /> {formatDate(dashboard.updated_at)}
          </span>
          <span className={`visibility-badge ${dashboard.visibility}`}>
            {dashboard.visibility === 'public' ? <FiGlobe /> : <FiLock />}
            {dashboard.visibility}
          </span>
        </div>
      </div>
      {canManageFolders && (
        <button 
          className="item-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, dashboard });
          }}
        >
          <FiMoreVertical />
        </button>
      )}
    </div>
  );
  
  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);
  
  // Close add menu on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setShowAddMenu(false);
      }
    };
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAddMenu]);
  
  return (
    <div className="dashboard-browser">
      {/* Header */}
      <div className="browser-header">
        <div className="header-left">
          {!currentFolderId ? (
            <h1>Dashboards</h1>
          ) : (
            renderBreadcrumb()
          )}
        </div>
        
        <div className="header-right">
          {/* Search */}
          <div className="search-container">
            <FiSearch className="search-icon" />
            <input
              type="text"
              placeholder="Search dashboards and folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button 
                className="search-clear"
                onClick={() => { setSearchQuery(''); setSearchResults(null); }}
              >
                <FiX />
              </button>
            )}
          </div>
          
          {/* Add New dropdown */}
          {(canCreateDashboards || canManageFolders) && (
            <div className="add-menu-container" ref={addMenuRef}>
              <button 
                className="btn btn-primary"
                onClick={() => setShowAddMenu(!showAddMenu)}
              >
                <FiPlus /> <span>New</span>
              </button>
              
              {showAddMenu && (
                <div className="add-menu-dropdown">
                  {canCreateDashboards && (
                    <button 
                      className="add-menu-item"
                      onClick={() => {
                        setShowAddMenu(false);
                        setShowCreateDashboard(true);
                      }}
                    >
                      <FiGrid />
                      <span>Dashboard</span>
                    </button>
                  )}
                  {canManageFolders && !currentFolderId && (
                    <button 
                      className="add-menu-item"
                      onClick={() => {
                        setShowAddMenu(false);
                        setShowCreateFolder(true);
                      }}
                    >
                      <FiFolder />
                      <span>Folder</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Content */}
      <div className="browser-content">
        {loading ? (
          <div className="browser-loading">
            <div className="loading-spinner"></div>
            <p>Loading...</p>
          </div>
        ) : error ? (
          <div className="browser-error">
            <p>{error}</p>
            <button onClick={() => loadContents(currentFolderId)}>Retry</button>
          </div>
        ) : searchResults ? (
          renderSearchResults()
        ) : (
          <>
            {/* Folders */}
            {folders.length > 0 && (
              <section className="browser-section">
                <h3 className="section-title">
                  <FiFolder /> Folders
                </h3>
                <div className="items-grid">
                  {folders.map(renderFolderCard)}
                </div>
              </section>
            )}
            
            {/* Dashboards */}
            {dashboards.length > 0 && (
              <section className="browser-section">
                <h3 className="section-title">
                  <FiGrid /> Dashboards
                </h3>
                <div className="items-grid">
                  {dashboards.map(renderDashboardCard)}
                </div>
              </section>
            )}
            
            {/* Empty state */}
            {folders.length === 0 && dashboards.length === 0 && (
              <div className="browser-empty">
                <div className="empty-icon-wrapper">
                  <FiGrid />
                </div>
                <h2>
                  {currentFolderId ? 'This folder is empty' : 'No dashboards yet'}
                </h2>
                <p>
                  {canCreateDashboards 
                    ? (currentFolderId 
                        ? 'Add a dashboard or folder to organize your work'
                        : 'Create your first dashboard to start visualizing and analyzing your data.')
                    : 'You don\'t have access to any dashboards yet. Contact an admin to get access.'
                  }
                </p>
                {canCreateDashboards && (
                  <button 
                    className="btn btn-primary"
                    onClick={() => setShowCreateDashboard(true)}
                  >
                    <FiPlus /> Create Dashboard
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.folder ? (
            <>
              {/* Only show manage access for folder owner or admin */}
              {(contextMenu.folder.is_owner || ['owner', 'admin'].includes(currentRole)) && (
                <button onClick={() => {
                  openFolderAccessModal(contextMenu.folder);
                  setContextMenu(null);
                }}>
                  <FiUsers /> Manage Access
                </button>
              )}
              {/* Only show rename for folder owner or admin */}
              {(contextMenu.folder.is_owner || ['owner', 'admin'].includes(currentRole)) && (
                <button onClick={() => {
                  // TODO: Implement rename folder
                  setContextMenu(null);
                }}>
                  <FiEdit2 /> Rename
                </button>
              )}
              {/* Only show delete for folder owner or admin */}
              {(contextMenu.folder.is_owner || ['owner', 'admin'].includes(currentRole)) && (
                <button 
                  className="danger"
                  onClick={() => {
                    setDeletingFolder(contextMenu.folder);
                    setContextMenu(null);
                  }}
                >
                  <FiTrash2 /> Delete
                </button>
              )}
            </>
          ) : contextMenu.dashboard ? (
            <>
              <button onClick={() => {
                openDashboard(contextMenu.dashboard.id);
                setContextMenu(null);
              }}>
                <FiEdit2 /> Open
              </button>
              <button onClick={() => {
                openMoveDashboardModal(contextMenu.dashboard);
                setContextMenu(null);
              }}>
                <FiMove /> Move to Folder
              </button>
              {/* Only show delete for dashboard owner or app admin/owner */}
              {(contextMenu.dashboard.is_owner || ['owner', 'admin'].includes(currentRole)) && (
                <button 
                  className="danger"
                  onClick={() => {
                    setDeletingDashboard(contextMenu.dashboard);
                    setContextMenu(null);
                  }}
                >
                  <FiTrash2 /> Delete
                </button>
              )}
            </>
          ) : null}
        </div>
      )}
      
      {/* Create Folder Modal */}
      {showCreateFolder && (
        <div className="modal-overlay">
          <div className="modal create-folder-modal">
            <div className="modal-header">
              <h2><FiFolder /> New Folder</h2>
              <button className="close-btn" onClick={() => {
                setShowCreateFolder(false);
                setNewFolderName('');
                setNewFolderError('');
              }}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <label>Folder Name</label>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => {
                  setNewFolderName(e.target.value);
                  setNewFolderError('');
                }}
                placeholder="Enter folder name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                }}
              />
              {newFolderError && (
                <p className="error-text">{newFolderError}</p>
              )}
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-secondary"
                onClick={() => {
                  setShowCreateFolder(false);
                  setNewFolderName('');
                  setNewFolderError('');
                }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
              >
                {creatingFolder ? 'Creating...' : 'Create Folder'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Create Dashboard Modal */}
      {showCreateDashboard && (
        <CreateDashboardModal
          isOpen={showCreateDashboard}
          onClose={() => setShowCreateDashboard(false)}
          folderId={currentFolderId}
          onSuccess={(dashboard) => {
            setShowCreateDashboard(false);
            openDashboard(dashboard.id);
          }}
        />
      )}
      
      {/* Delete Folder Confirmation */}
      {deletingFolder && (
        <ConfirmDeleteModal
          isOpen={true}
          itemName={deletingFolder.name}
          itemType="folder"
          onConfirm={handleDeleteFolder}
          onCancel={() => {
            setDeletingFolder(null);
            setDeleteError('');
          }}
          error={deleteError}
        />
      )}
      
      {/* Delete Dashboard Confirmation */}
      {deletingDashboard && (
        <ConfirmDeleteModal
          isOpen={true}
          itemName={deletingDashboard.name}
          itemType="dashboard"
          onConfirm={handleDeleteDashboard}
          onCancel={() => {
            setDeletingDashboard(null);
            setDeleteDashboardError('');
          }}
          error={deleteDashboardError}
        />
      )}
      
      {/* Move Dashboard Modal */}
      {movingDashboard && (
        <div className="modal-overlay">
          <div className="modal move-dashboard-modal">
            <div className="modal-header">
              <h2><FiMove /> Move Dashboard</h2>
              <button className="close-btn" onClick={() => {
                setMovingDashboard(null);
                setMovingError('');
                setMoveFolderDropdownOpen(false);
                setShowInlineCreateFolder(false);
                setInlineFolderName('');
                setFolderSearchQuery('');
              }}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p className="move-dashboard-info">
                Moving <strong>{movingDashboard.name}</strong> to:
              </p>
              
              {loadingFolders ? (
                <div className="loading-folders">Loading folders...</div>
              ) : (
                <div className="folder-selector">
                  <button 
                    type="button"
                    className="folder-selector-btn"
                    onClick={() => setMoveFolderDropdownOpen(!moveFolderDropdownOpen)}
                  >
                    {selectedMoveFolder && selectedMoveFolder !== 'root' ? (
                      <>
                        <FiFolder style={{ color: allFolders.find(f => f.id === selectedMoveFolder)?.color || '#6366f1' }} /> 
                        {allFolders.find(f => f.id === selectedMoveFolder)?.name || 'Selected Folder'}
                      </>
                    ) : (
                      <>
                        <FiHome /> Root (No folder)
                      </>
                    )}
                  </button>
                  {moveFolderDropdownOpen && (
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
                            className={`folder-option ${!selectedMoveFolder || selectedMoveFolder === 'root' ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedMoveFolder('root');
                              setMoveFolderDropdownOpen(false);
                              setFolderSearchQuery('');
                            }}
                          >
                            <FiHome /> Root (No folder)
                          </button>
                        )}
                        {allFolders
                          .filter(folder => !folderSearchQuery || folder.name.toLowerCase().includes(folderSearchQuery.toLowerCase()))
                          .map(folder => (
                          <button
                            key={folder.id}
                            type="button"
                            className={`folder-option ${selectedMoveFolder === folder.id ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedMoveFolder(folder.id);
                              setMoveFolderDropdownOpen(false);
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
                              if (e.key === 'Enter') handleInlineCreateFolder();
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
              )}
              
              {movingError && (
                <p className="error-text">{movingError}</p>
              )}
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-secondary"
                onClick={() => {
                  setMovingDashboard(null);
                  setMovingError('');
                  setMoveFolderDropdownOpen(false);
                  setShowInlineCreateFolder(false);
                  setInlineFolderName('');
                  setFolderSearchQuery('');
                }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleMoveDashboard}
                disabled={loadingFolders}
              >
                Move Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Folder Access Management Modal */}
      {managingAccessFolder && (
        <div className="modal-overlay">
          <div className="modal folder-access-modal">
            <div className="modal-header">
              <h2><FiUsers /> Manage Folder Access</h2>
              <button className="close-btn" onClick={closeFolderAccessModal}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <p className="folder-access-info">
                Managing access for: <strong>{managingAccessFolder.name}</strong>
              </p>
              
              {loadingFolderAccess ? (
                <div className="loading-access">Loading access settings...</div>
              ) : (
                <>
                  {/* Add Group Section */}
                  <div className="add-group-section">
                    <label>Add Group Access</label>
                    <div className="add-group-row">
                      <select
                        value={selectedGroupToAdd}
                        onChange={(e) => setSelectedGroupToAdd(e.target.value)}
                        className="group-select"
                      >
                        <option value="">Select a group...</option>
                        {getAvailableGroupsForFolder().map(group => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary btn-small"
                        onClick={handleAddFolderAccess}
                        disabled={!selectedGroupToAdd}
                      >
                        <FiPlus /> Add
                      </button>
                    </div>
                    {getAvailableGroupsForFolder().length === 0 && availableGroups.length > 0 && (
                      <p className="no-groups-hint">All groups have been added to this folder</p>
                    )}
                    {availableGroups.length === 0 && (
                      <p className="no-groups-hint">No groups available. Create groups in User Management.</p>
                    )}
                  </div>
                  
                  {/* Current Groups List */}
                  <div className="current-groups-section">
                    <label>Groups with Access</label>
                    {folderGroups.length === 0 ? (
                      <p className="no-groups-message">No groups have access to this folder yet.</p>
                    ) : (
                      <ul className="groups-list">
                        {folderGroups.map(group => (
                          <li key={group.id} className="group-item">
                            <div className="group-info">
                              <FiUsers className="group-icon" />
                              <span className="group-name">{group.name}</span>
                              {group.granted_by_name && (
                                <span className="granted-by">Added by {group.granted_by_name}</span>
                              )}
                            </div>
                            <button
                              className="remove-group-btn"
                              onClick={() => handleRemoveFolderAccess(group.id)}
                              title="Remove access"
                            >
                              <FiX />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  
                  {folderAccessError && (
                    <p className="error-text">{folderAccessError}</p>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeFolderAccessModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
