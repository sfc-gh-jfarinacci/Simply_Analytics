import React from 'react';
import {
  FiFolder,
  FiHome,
  FiSearch,
  FiPlus,
  FiX,
  FiLayers,
  FiChevronDown,
  FiTrash2,
  FiAlertCircle,
} from 'react-icons/fi';

export function GeneralTab({
  name,
  setName,
  description,
  setDescription,
  folderId,
  setFolderId,
  folders,
  folderDropdownOpen,
  setFolderDropdownOpen,
  folderSearchQuery,
  setFolderSearchQuery,
  showInlineCreateFolder,
  setShowInlineCreateFolder,
  inlineFolderName,
  setInlineFolderName,
  creatingInlineFolder,
  handleInlineCreateFolder,
  availableSemanticViews,
  semanticViewsReferenced,
  selectedSemanticView,
  setSelectedSemanticView,
  addSemanticView,
  removeSemanticView,
  semanticViewError,
  errorViewName,
}) {
  return (
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
          <button type="button" className="folder-selector-btn" onClick={() => setFolderDropdownOpen(!folderDropdownOpen)}>
            {folderId ? (
              <>
                <FiFolder /> {folders.find((f) => f.id === folderId)?.name || 'Selected Folder'}
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
                {(!folderSearchQuery ||
                  'root'.includes(folderSearchQuery.toLowerCase()) ||
                  'no folder'.includes(folderSearchQuery.toLowerCase())) && (
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
                  .filter((folder) => !folderSearchQuery || folder.name.toLowerCase().includes(folderSearchQuery.toLowerCase()))
                  .map((folder) => (
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
                <button type="button" className="folder-option create-new-folder" onClick={() => setShowInlineCreateFolder(true)}>
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
            <select className="form-input" value={selectedSemanticView} onChange={(e) => setSelectedSemanticView(e.target.value)}>
              <option value="">Select semantic view...</option>
              {availableSemanticViews
                .filter((v) => !semanticViewsReferenced.some((ref) => (typeof ref === 'string' ? ref : ref.name) === (v.name || v)))
                .map((view) => (
                  <option key={view.name || view} value={view.name || view}>
                    {view.name || view}
                  </option>
                ))}
            </select>
            <FiChevronDown className="select-icon" />
          </div>
          <button className="btn btn-secondary add-btn" onClick={addSemanticView} disabled={!selectedSemanticView}>
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
                <div key={viewName || index} className={`semantic-view-item ${hasError ? 'semantic-view-item-error' : ''}`}>
                  <div className="semantic-view-info">
                    <FiLayers className="view-icon" />
                    <div className="view-details">
                      <span className="view-name">{viewName}</span>
                      {viewFqn && <span className="view-fqn">{viewFqn}</span>}
                    </div>
                  </div>
                  <button className="remove-view-btn" onClick={() => removeSemanticView(viewName)} title="Remove semantic view">
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

    
    </div>
  );
}
