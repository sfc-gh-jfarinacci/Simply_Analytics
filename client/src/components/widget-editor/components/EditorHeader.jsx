/**
 * EditorHeader - Header with title input and action buttons
 */
import React from 'react';
import { FiPause, FiPlay, FiDatabase, FiCheck } from 'react-icons/fi';

const EditorHeader = ({
  title,
  setTitle,
  titleError,
  setTitleError,
  refreshEnabled,
  setRefreshEnabled,
  pendingRefresh,
  setPendingRefresh,
  setForceNextRefresh,
  sqlPreviewDropdown,
  setSqlPreviewDropdown,
  onClose,
}) => {
  const handleRefreshToggle = () => {
    if (!refreshEnabled) {
      setRefreshEnabled(true);
      if (pendingRefresh) {
        setForceNextRefresh(true);
        setPendingRefresh(false);
      }
    } else {
      setRefreshEnabled(false);
    }
  };

  const handleSqlPreviewClick = (e) => {
    if (sqlPreviewDropdown.open) {
      setSqlPreviewDropdown({ open: false, x: 0, y: 0 });
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setSqlPreviewDropdown({ 
      open: true, 
      anchorRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    });
  };

  return (
    <div className="embedded-editor-header">
      <input
        type="text"
        className={`embedded-title-input ${titleError ? 'has-error' : ''}`}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (titleError) setTitleError('');
        }}
        placeholder="Widget title..."
        maxLength={32}
      />
      <div className="embedded-header-actions">
        <button 
          className={`embedded-action-btn refresh-toggle ${!refreshEnabled ? 'paused' : ''}`}
          onClick={handleRefreshToggle}
          title={refreshEnabled ? 'Pause auto-refresh' : `Resume auto-refresh${pendingRefresh ? ' (pending)' : ''}`}
        >
          {refreshEnabled ? <FiPause /> : <FiPlay />}
          {!refreshEnabled && pendingRefresh && <span className="pending-dot" />}
        </button>
        <button 
          className="embedded-action-btn" 
          onClick={handleSqlPreviewClick}
          title="Preview SQL"
        >
          <FiDatabase />
        </button>
        <button className="embedded-action-btn primary" onClick={onClose} title="Done editing">
          <FiCheck /> Done
        </button>
      </div>
    </div>
  );
};

export default EditorHeader;
