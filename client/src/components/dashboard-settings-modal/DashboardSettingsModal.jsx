import React, { useRef } from 'react';
import { FiX, FiSettings, FiLayout, FiDatabase, FiCode, FiCheck, FiRefreshCw } from 'react-icons/fi';
import { useSettingsState, useYamlExport } from './hooks';
import { GeneralTab, AccessTab, YamlTab, ReplaceConnectionModal } from './components';
import '../../styles/DashboardSettingsModal.css';

const DashboardSettingsModal = ({ dashboard, isOpen, onClose, onSave }) => {
  const yamlBridgeRef = useRef({});
  const s = useSettingsState(dashboard, isOpen, onClose, onSave, yamlBridgeRef);
  const y = useYamlExport(s.activeTab, s.currentDashboard, s.currentRole);

  yamlBridgeRef.current = {
    pendingYamlImport: y.pendingYamlImport,
    setPendingYamlImport: y.setPendingYamlImport,
    setImportSuccess: y.setImportSuccess,
    setImportError: y.setImportError,
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">
            <FiSettings />
            <h2>Dashboard Settings</h2>
          </div>
          <button className="close-btn" onClick={s.handleCancel}>
            <FiX />
          </button>
        </div>

        <div className="settings-tabs">
          <button className={`settings-tab ${s.activeTab === 'general' ? 'active' : ''}`} onClick={() => s.setActiveTab('general')}>
            <FiLayout /> General
          </button>
          <button className={`settings-tab ${s.activeTab === 'access' ? 'active' : ''}`} onClick={() => s.setActiveTab('access')}>
            <FiDatabase /> Connection & Access
          </button>
          <button className={`settings-tab ${s.activeTab === 'yaml' ? 'active' : ''}`} onClick={() => s.setActiveTab('yaml')}>
            <FiCode /> Import/Export
          </button>
        </div>

        <div className="settings-body">
          {s.error && <div className="settings-error">{s.error}</div>}

          {s.activeTab === 'general' && (
            <GeneralTab
              name={s.name}
              setName={s.setName}
              description={s.description}
              setDescription={s.setDescription}
              folderId={s.folderId}
              setFolderId={s.setFolderId}
              folders={s.folders}
              folderDropdownOpen={s.folderDropdownOpen}
              setFolderDropdownOpen={s.setFolderDropdownOpen}
              folderSearchQuery={s.folderSearchQuery}
              setFolderSearchQuery={s.setFolderSearchQuery}
              showInlineCreateFolder={s.showInlineCreateFolder}
              setShowInlineCreateFolder={s.setShowInlineCreateFolder}
              inlineFolderName={s.inlineFolderName}
              setInlineFolderName={s.setInlineFolderName}
              creatingInlineFolder={s.creatingInlineFolder}
              handleInlineCreateFolder={s.handleInlineCreateFolder}
              availableSemanticViews={s.availableSemanticViews}
              semanticViewsReferenced={s.semanticViewsReferenced}
              selectedSemanticView={s.selectedSemanticView}
              setSelectedSemanticView={s.setSelectedSemanticView}
              addSemanticView={s.addSemanticView}
              removeSemanticView={s.removeSemanticView}
              semanticViewError={s.semanticViewError}
              errorViewName={s.errorViewName}
            />
          )}

          {s.activeTab === 'access' && (
            <AccessTab
              dashboard={dashboard}
              connectionMenuRef={s.connectionMenuRef}
              connectionMenuBtnRef={s.connectionMenuBtnRef}
              showConnectionMenu={s.showConnectionMenu}
              setShowConnectionMenu={s.setShowConnectionMenu}
              connectionMenuPos={s.connectionMenuPos}
              setConnectionMenuPos={s.setConnectionMenuPos}
              testConnection={s.testConnection}
              testingConnection={s.testingConnection}
              connectionTestResult={s.connectionTestResult}
              isOwner={s.isOwner}
              loadAvailableConnections={s.loadAvailableConnections}
              selectedConnectionId={s.selectedConnectionId}
              setSelectedConnectionId={s.setSelectedConnectionId}
              setShowReplaceConnection={s.setShowReplaceConnection}
              warehouse={s.warehouse}
              role={s.role}
              isPublished={s.isPublished}
              setIsPublished={s.setIsPublished}
              adminRoles={s.adminRoles}
              transferOwnerTo={s.transferOwnerTo}
              setTransferOwnerTo={s.setTransferOwnerTo}
              showTransferConfirm={s.showTransferConfirm}
              setShowTransferConfirm={s.setShowTransferConfirm}
              handleTransferOwnership={s.handleTransferOwnership}
              connectionInherited={s.connectionInherited}
            />
          )}

          {s.activeTab === 'yaml' && (
            <YamlTab
              yamlContent={y.yamlContent}
              yamlCopied={y.yamlCopied}
              importError={y.importError}
              importSuccess={y.importSuccess}
              pendingYamlImport={y.pendingYamlImport}
              fileInputRef={y.fileInputRef}
              handleCopyYaml={y.handleCopyYaml}
              handleDownloadYaml={y.handleDownloadYaml}
              handleFileUpload={y.handleFileUpload}
            />
          )}
        </div>

        <div className="settings-footer">
          <button className="btn btn-secondary" onClick={s.handleCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={s.handleSave} disabled={s.isSaving || !s.name.trim()}>
            {s.isSaving ? (
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

      <ReplaceConnectionModal
        dashboard={dashboard}
        showReplaceConnection={s.showReplaceConnection}
        setShowReplaceConnection={s.setShowReplaceConnection}
        loadingConnections={s.loadingConnections}
        availableConnections={s.availableConnections}
        selectedConnectionId={s.selectedConnectionId}
        setSelectedConnectionId={s.setSelectedConnectionId}
        handleReplaceConnection={s.handleReplaceConnection}
        error={s.error}
      />
    </div>
  );
};

export default DashboardSettingsModal;
