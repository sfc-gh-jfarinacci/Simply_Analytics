import React from 'react';
import { FiLayers, FiLoader, FiSearch, FiX } from 'react-icons/fi';

export default function AssignViewsModal({
  assignModal, setAssignModal, assignSearch, setAssignSearch,
  assignPending, handleTogglePending, assignSaving, handleApplyAssignment,
}) {
  if (!assignModal) return null;

  const filtered = assignModal.available.filter(item => {
    if (!assignSearch.trim()) return true;
    const s = assignSearch.toLowerCase();
    return item.label.toLowerCase().includes(s) || item.fqn.toLowerCase().includes(s);
  });
  const pendingCount = assignPending.size;
  const hasChanges = assignModal.available.some(a =>
    (assignPending.has(a.fqn) && !a.assigned) || (!assignPending.has(a.fqn) && a.assigned),
  );

  const close = () => { if (!assignSaving) { setAssignModal(null); setAssignSearch(''); } };

  return (
    <div className="ws-create-overlay" onClick={close}>
      <div className="ws-assign-modal" onClick={e => e.stopPropagation()}>
        <div className="ws-assign-header">
          <span className="ws-assign-title">
            <FiLayers />
            Semantic Views — {assignModal.connectionName}
          </span>
          <button className="ws-assign-close" onClick={close}><FiX /></button>
        </div>

        {assignSaving && <div className="ws-assign-progress"><div className="ws-assign-progress-bar" /></div>}

        <div className="ws-assign-search">
          <FiSearch className="ws-assign-search-icon" />
          <input type="text" placeholder="Search views..." value={assignSearch} onChange={e => setAssignSearch(e.target.value)} autoFocus />
        </div>

        {assignModal.loading && <div className="ws-assign-progress"><div className="ws-assign-progress-bar" /></div>}

        {assignModal.loading ? (
          <div className="ws-assign-loading-hint">Fetching available resources...</div>
        ) : filtered.length > 0 ? (
          <>
            <div className="ws-assign-list">
              {filtered.map(item => {
                const isChecked = assignPending.has(item.fqn);
                const fqnParts = item.fqn.split('.');
                const path = fqnParts.length > 1 ? fqnParts.slice(0, -1).join('.') : '';
                return (
                  <label key={item.fqn} className={`ws-assign-item ${isChecked ? 'checked' : ''}`}>
                    <input type="checkbox" checked={isChecked} onChange={() => handleTogglePending(item.fqn)} disabled={assignSaving} />
                    <FiLayers className="ws-assign-item-icon" />
                    <div className="ws-assign-item-info">
                      <span className="ws-assign-item-name">{item.label}</span>
                      {path && <span className="ws-assign-item-path">{path}</span>}
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="ws-assign-footer">
              <button className="ws-assign-btn cancel" onClick={() => { setAssignModal(null); setAssignSearch(''); }} disabled={assignSaving}>Cancel</button>
              <button className="ws-assign-btn apply" onClick={handleApplyAssignment} disabled={assignSaving || !hasChanges}>
                {assignSaving ? <><FiLoader className="spinner" /> Saving...</> : `Apply (${pendingCount})`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ws-assign-empty">
              {assignSearch.trim() ? `No views match "${assignSearch}"` : 'No semantic views found for this connection.'}
            </div>
            <div className="ws-assign-footer">
              <button className="ws-assign-btn cancel" onClick={() => { setAssignModal(null); setAssignSearch(''); }}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
