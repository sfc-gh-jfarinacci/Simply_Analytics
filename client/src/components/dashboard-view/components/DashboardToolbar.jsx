import React from 'react';
import {
  FiArrowLeft, FiEdit3, FiEye, FiRotateCcw, FiRotateCw,
  FiSave, FiCheck, FiSettings, FiZap, FiType, FiFilter,
  FiPlus, FiMoreVertical, FiX,
} from 'react-icons/fi';

export function DashboardToolbar({
  currentDashboard,
  currentWidgets,
  isEditMode, setIsEditMode,
  canEdit, canManageSettings,
  hasUnsavedChanges, isSaving, saveSuccess,
  handleSaveWithAnimation, saveDashboard,
  canUndo, canRedo, undo, redo,
  editingTitle, editedTitle, titleInputRef,
  handleTitleDoubleClick, handleTitleChange, handleTitleBlur, handleTitleKeyDown, cancelTitleEdit,
  compactToolbar, toolbarMenuOpen, setToolbarMenuOpen, toolbarMenuRef,
  setShowSettings, showAiChat, setShowAiChat,
  handleAddSpecialWidget, handleOpenNewWidget, handleDeselectWidget,
  setExitEditConfirm, setBackConfirm,
  navigate,
  showFilterPanel, onToggleFilterPanel, filterFieldCount,
}) {
  return (
    <div className={`dashboard-toolbar${isEditMode ? ' edit-mode' : ''}`}>
      <div className="toolbar-left">
        <button
          className="btn btn-icon btn-back"
          onClick={() => {
            if (hasUnsavedChanges) {
              setBackConfirm(true);
            } else {
              const folderId = currentDashboard?.folder_id;
              navigate(folderId ? `/dashboards?folder=${folderId}` : '/dashboards');
            }
          }}
          title="Back to dashboards"
        >
          <FiArrowLeft />
        </button>

        <div className="toolbar-title-group">
          {editingTitle ? (
            <div className="inline-edit-title">
              <input
                ref={titleInputRef}
                type="text"
                value={editedTitle}
                onChange={handleTitleChange}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                className="title-input"
              />
              <button className="cancel-edit-btn" onClick={cancelTitleEdit} title="Cancel">
                <FiX />
              </button>
            </div>
          ) : (
            <h2
              onDoubleClick={isEditMode ? handleTitleDoubleClick : undefined}
              className={`editable-title ${isEditMode ? 'can-edit' : ''}`}
              title={isEditMode ? "Double-click to edit" : undefined}
            >
              {currentDashboard.name}
            </h2>
          )}

          <div className="toolbar-meta">
            <span className="widget-count">{currentWidgets.length} widget{currentWidgets.length !== 1 ? 's' : ''}</span>
            {hasUnsavedChanges && (
              <span className="unsaved-indicator" title="Unsaved changes (⌘S to save)">
                <span className="unsaved-dot"></span>
                Unsaved
              </span>
            )}
          </div>
        </div>
      </div>

      {!compactToolbar && (
        <div className="toolbar-right">
          <button
            className={`toolbar-btn${showFilterPanel ? ' active' : ''}`}
            onClick={onToggleFilterPanel}
            title="Dashboard filters"
          >
            <FiFilter />
            {filterFieldCount > 0 && <span className="toolbar-filter-badge">{filterFieldCount}</span>}
          </button>

          {!isEditMode && canEdit && (
            <button className="toolbar-btn toolbar-btn-edit" onClick={() => setIsEditMode(true)} title="Edit dashboard (E)">
              <FiEdit3 /><span>Edit</span>
            </button>
          )}

          {!isEditMode && !canEdit && (
            <span className="toolbar-badge view-only"><FiEye /><span>View Only</span></span>
          )}

          {isEditMode && (
            <>
              <div className="toolbar-group toolbar-history">
                <button className={`toolbar-btn ${!canUndo() ? 'disabled' : ''}`} onClick={() => canUndo() && undo()} disabled={!canUndo()} title="Undo (⌘Z)"><FiRotateCcw /></button>
                <button className={`toolbar-btn ${!canRedo() ? 'disabled' : ''}`} onClick={() => canRedo() && redo()} disabled={!canRedo()} title="Redo (⌘⇧Z)"><FiRotateCw /></button>
              </div>

              {(hasUnsavedChanges || saveSuccess) && (
                <button className={`toolbar-btn toolbar-btn-save ${isSaving ? 'saving' : ''} ${saveSuccess ? 'success' : ''}`} onClick={() => { handleDeselectWidget?.(); handleSaveWithAnimation(); }} disabled={isSaving} title="Save changes (⌘S)">
                  {saveSuccess ? <FiCheck /> : <FiSave />}
                  <span>{saveSuccess ? 'Saved!' : isSaving ? 'Saving...' : 'Save'}</span>
                </button>
              )}

              {canManageSettings && (
                <button className="toolbar-btn" onClick={() => setShowSettings(true)} title="Dashboard Settings"><FiSettings /></button>
              )}

              <button className={`toolbar-btn toolbar-btn-ai${showAiChat ? ' active' : ''}`} onClick={() => setShowAiChat(!showAiChat)} title="AI Assistant">
                <FiZap /><span>AI</span>
              </button>

              <button className="toolbar-btn" onClick={() => handleAddSpecialWidget('title')} title="Add title / header"><FiType /></button>

              <button className="toolbar-btn toolbar-btn-primary" onClick={handleOpenNewWidget}>
                <FiPlus /><span>Add Widget</span>
              </button>

              <button
                className="toolbar-btn toolbar-btn-done"
                onClick={() => {
                  handleDeselectWidget?.();
                  if (hasUnsavedChanges) setExitEditConfirm(true);
                  else setIsEditMode(false);
                }}
                title="Exit edit mode"
              >
                <FiCheck /><span>Done</span>
              </button>
            </>
          )}
        </div>
      )}

      {compactToolbar && (
        <div className="toolbar-compact" ref={toolbarMenuRef}>
          {!isEditMode && canEdit && (
            <button className="btn btn-primary btn-icon" onClick={() => setIsEditMode(true)} title="Edit dashboard"><FiEdit3 /></button>
          )}

          {isEditMode && (
            <>
              <button className="btn btn-icon mobile-menu-btn" onClick={() => setToolbarMenuOpen(!toolbarMenuOpen)}><FiMoreVertical /></button>

              {toolbarMenuOpen && (
                <div className="toolbar-dropdown">
                  {canManageSettings && (
                    <>
                      <div className="dropdown-divider" />
                      <button className="dropdown-btn" onClick={() => { setShowSettings(true); setToolbarMenuOpen(false); }}><FiSettings /> Settings</button>
                    </>
                  )}
                  <button className="dropdown-btn primary" onClick={() => { handleOpenNewWidget(); setToolbarMenuOpen(false); }}><FiPlus /> Add Widget</button>
                  <div className="dropdown-divider" />
                  {hasUnsavedChanges && (
                    <button className="dropdown-btn save" onClick={() => { handleDeselectWidget?.(); saveDashboard(); setToolbarMenuOpen(false); }} disabled={isSaving}>
                      <FiSave /> {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  )}
                  <button className="dropdown-btn" onClick={() => {
                    handleDeselectWidget?.();
                    setToolbarMenuOpen(false);
                    if (hasUnsavedChanges) setExitEditConfirm(true);
                    else setIsEditMode(false);
                  }}>Done</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
