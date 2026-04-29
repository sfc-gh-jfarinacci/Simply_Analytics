import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiSearch, FiFolder, FiGrid, FiPlus, FiX,
  FiEdit2, FiTrash2, FiMoreVertical, FiMove,
  FiArrowLeft,
} from 'react-icons/fi';
import { useAppStore } from '../store/appStore';
import CreateDashboardModal from '../components/CreateDashboardModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import '../styles/DashboardBrowser.css';

import { useBrowserData } from '../components/dashboard-browser/hooks/useBrowserData';
import { useFolderActions } from '../components/dashboard-browser/hooks/useFolderActions';
import {
  Breadcrumb, SearchResults, FolderCard, DashboardCard, EmptyState,
} from '../components/dashboard-browser/components/BrowserContent';
import {
  CreateFolderModal, MoveDashboardModal,
} from '../components/dashboard-browser/components/BrowserModals';

export default function DashboardBrowser() {
  const { currentRole, isAuthenticated, isInitialized, activeWorkspace } = useAppStore();
  const navigate = useNavigate();

  const bd = useBrowserData(isInitialized, isAuthenticated);
  const fa = useFolderActions(bd.currentFolderId, bd.loadContents);

  const [showCreateDashboard, setShowCreateDashboard] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef(null);

  const canCreateDashboards = ['owner', 'admin', 'developer'].includes(currentRole);
  const canManageFolders = ['owner', 'admin', 'developer'].includes(currentRole);

  const handleContextMenu = (e, item) => {
    setContextMenu({ x: e.clientX, y: e.clientY, ...item });
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setShowAddMenu(false);
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
          <button className="btn btn-icon btn-back" onClick={() => navigate(`/workspaces/${activeWorkspace?.id || ''}`)} title="Back to workspace">
            <FiArrowLeft />
          </button>
          {!bd.currentFolderId ? (
            <h1>Dashboards</h1>
          ) : (
            <Breadcrumb currentFolderId={bd.currentFolderId} folderPath={bd.folderPath} navigateToFolder={bd.navigateToFolder} />
          )}
        </div>
        <div className="header-right">
          <div className="search-container">
            <FiSearch className="search-icon" />
            <input type="text" placeholder="Search dashboards and folders..." value={bd.searchQuery} onChange={(e) => bd.setSearchQuery(e.target.value)} className="search-input" />
            {bd.searchQuery && (
              <button className="search-clear" onClick={() => { bd.setSearchQuery(''); bd.setSearchResults(null); }}><FiX /></button>
            )}
          </div>
          {(canCreateDashboards || canManageFolders) && (
            <div className="add-menu-container" ref={addMenuRef}>
              <button className="btn btn-primary" onClick={() => setShowAddMenu(!showAddMenu)}>
                <FiPlus /> <span>New</span>
              </button>
              {showAddMenu && (
                <div className="add-menu-dropdown">
                  {canCreateDashboards && (
                    <button className="add-menu-item" onClick={() => { setShowAddMenu(false); setShowCreateDashboard(true); }}>
                      <FiGrid /><span>Dashboard</span>
                    </button>
                  )}
                  {canManageFolders && !bd.currentFolderId && (
                    <button className="add-menu-item" onClick={() => { setShowAddMenu(false); fa.setShowCreateFolder(true); }}>
                      <FiFolder /><span>Folder</span>
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
        {bd.loading ? (
          <div className="browser-loading"><div className="loading-spinner"></div><p>Loading...</p></div>
        ) : bd.error ? (
          <div className="browser-error"><p>{bd.error}</p><button onClick={() => bd.loadContents(bd.currentFolderId)}>Retry</button></div>
        ) : bd.searchResults ? (
          <SearchResults
            searchResults={bd.searchResults} isSearching={bd.isSearching} searchQuery={bd.searchQuery}
            onClear={() => { bd.setSearchQuery(''); bd.setSearchResults(null); }}
            navigateToFolder={bd.navigateToFolder} openDashboard={bd.openDashboard}
          />
        ) : (
          <>
            {bd.folders.length > 0 && (
              <section className="browser-section">
                <h3 className="section-title"><FiFolder /> Folders</h3>
                <div className="items-grid">
                  {bd.folders.map(folder => (
                    <FolderCard key={folder.id} folder={folder} canManageFolders={canManageFolders} navigateToFolder={bd.navigateToFolder} onContextMenu={handleContextMenu} />
                  ))}
                </div>
              </section>
            )}
            {bd.dashboards.length > 0 && (
              <section className="browser-section">
                <h3 className="section-title"><FiGrid /> Dashboards</h3>
                <div className="items-grid">
                  {bd.dashboards.map(dashboard => (
                    <DashboardCard key={dashboard.id} dashboard={dashboard} canManageFolders={canManageFolders} openDashboard={bd.openDashboard} onContextMenu={handleContextMenu} formatDate={bd.formatDate} />
                  ))}
                </div>
              </section>
            )}
            {bd.folders.length === 0 && bd.dashboards.length === 0 && (
              <EmptyState currentFolderId={bd.currentFolderId} canCreateDashboards={canCreateDashboards} onCreateDashboard={() => setShowCreateDashboard(true)} />
            )}
          </>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {contextMenu.folder ? (
            <>
              {(contextMenu.folder.is_owner || ['owner', 'admin'].includes(currentRole)) && (
                <button onClick={() => setContextMenu(null)}><FiEdit2 /> Rename</button>
              )}
              {(contextMenu.folder.is_owner || ['owner', 'admin'].includes(currentRole)) && (
                <button className="danger" onClick={() => { fa.setDeletingFolder(contextMenu.folder); setContextMenu(null); }}>
                  <FiTrash2 /> Delete
                </button>
              )}
            </>
          ) : contextMenu.dashboard ? (
            <>
              <button onClick={() => { bd.openDashboard(contextMenu.dashboard.id); setContextMenu(null); }}>
                <FiEdit2 /> Open
              </button>
              <button onClick={() => { fa.openMoveDashboardModal(contextMenu.dashboard); setContextMenu(null); }}>
                <FiMove /> Move to Folder
              </button>
              {(contextMenu.dashboard.is_owner || ['owner', 'admin'].includes(currentRole)) && (
                <button className="danger" onClick={() => { fa.setDeletingDashboard(contextMenu.dashboard); setContextMenu(null); }}>
                  <FiTrash2 /> Delete
                </button>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Modals */}
      {fa.showCreateFolder && (
        <CreateFolderModal
          folderName={fa.newFolderName} setFolderName={fa.setNewFolderName}
          error={fa.newFolderError} setError={fa.setNewFolderError}
          creating={fa.creatingFolder} onCreate={fa.handleCreateFolder}
          onClose={() => fa.setShowCreateFolder(false)}
        />
      )}

      {showCreateDashboard && (
        <CreateDashboardModal
          isOpen={showCreateDashboard} onClose={() => setShowCreateDashboard(false)}
          folderId={bd.currentFolderId}
          onSuccess={(dashboard) => { setShowCreateDashboard(false); bd.openDashboard(dashboard.id); }}
        />
      )}

      {fa.deletingFolder && (
        <ConfirmDeleteModal isOpen={true} itemName={fa.deletingFolder.name} itemType="folder"
          onConfirm={fa.handleDeleteFolder} onCancel={() => { fa.setDeletingFolder(null); fa.setDeleteError(''); }}
          error={fa.deleteError}
        />
      )}

      {fa.deletingDashboard && (
        <ConfirmDeleteModal isOpen={true} itemName={fa.deletingDashboard.name} itemType="dashboard"
          onConfirm={fa.handleDeleteDashboard} onCancel={() => { fa.setDeletingDashboard(null); fa.setDeleteDashboardError(''); }}
          error={fa.deleteDashboardError}
        />
      )}

      {fa.movingDashboard && (
        <MoveDashboardModal
          dashboard={fa.movingDashboard} allFolders={fa.allFolders} loadingFolders={fa.loadingFolders}
          selectedMoveFolder={fa.selectedMoveFolder} setSelectedMoveFolder={fa.setSelectedMoveFolder}
          movingError={fa.movingError} dropdownOpen={fa.moveFolderDropdownOpen} setDropdownOpen={fa.setMoveFolderDropdownOpen}
          showInlineCreate={fa.showInlineCreateFolder} setShowInlineCreate={fa.setShowInlineCreateFolder}
          inlineFolderName={fa.inlineFolderName} setInlineFolderName={fa.setInlineFolderName}
          creatingInlineFolder={fa.creatingInlineFolder}
          folderSearchQuery={fa.folderSearchQuery} setFolderSearchQuery={fa.setFolderSearchQuery}
          onMove={fa.handleMoveDashboard} onInlineCreate={fa.handleInlineCreateFolder} onClose={fa.closeMoveDashboardModal}
        />
      )}

    </div>
  );
}
