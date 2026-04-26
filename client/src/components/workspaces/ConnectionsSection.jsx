import React from 'react';
import {
  FiDatabase, FiPlus, FiMoreVertical, FiRefreshCw, FiEdit2,
  FiLayers, FiTrash2, FiCheck, FiLoader, FiX, FiChevronDown, FiChevronUp,
} from 'react-icons/fi';

export default function ConnectionsSection({
  isOpen, onToggle, wsConnections, allSemanticViews, isAdmin,
  connMenuOpen, setConnMenuOpen, connMenuRef,
  handleTestConnection, handleEditConnection, openAssignModal, handleRequestDeleteConnection,
  testingConnId, connTestResults,
  onNewConnection,
}) {
  return (
    <div className="ws-flat-section">
      <button className="ws-flat-section-toggle" onClick={onToggle}>
        <span className="ws-flat-section-label"><FiDatabase size={14} /> Connections <span className="ws-flat-count">{wsConnections.length}</span></span>
        {isOpen ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
      </button>
      {isOpen && (
        <div className="ws-flat-section-body">
          {wsConnections.length > 0 ? (
            <table className="ws-table">
              <thead>
                <tr><th>Name</th><th>Account</th><th>Role / Warehouse</th><th>Resources</th><th></th></tr>
              </thead>
              <tbody>
                {wsConnections.map(wc => {
                  const connViews = allSemanticViews.filter(v => v.workspace_connection_id === wc.id);
                  const menuOpen = connMenuOpen === wc.id;
                  return (
                    <tr key={wc.id}>
                      <td className="ws-table-name">{wc.connection_name}</td>
                      <td className="ws-table-meta">{wc.connection_account}</td>
                      <td className="ws-table-meta">{[wc.role, wc.warehouse].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="ws-table-meta">{connViews.length} views</td>
                      <td className="ws-table-actions">
                        <div className="ws-kebab-wrap" ref={menuOpen ? connMenuRef : undefined}>
                          <button className="ws-kebab-btn" onClick={() => setConnMenuOpen(menuOpen ? null : wc.id)}>
                            <FiMoreVertical />
                          </button>
                          {menuOpen && (
                            <div className="ws-kebab-menu">
                              <button onClick={() => { setConnMenuOpen(null); handleTestConnection(wc.connection_id); }}>
                                <FiRefreshCw size={13} /> Test Connection
                              </button>
                              {isAdmin && (
                                <>
                                  <button onClick={() => { setConnMenuOpen(null); handleEditConnection(wc); }}>
                                    <FiEdit2 size={13} /> Edit
                                  </button>
                                  <button onClick={() => openAssignModal(wc, 'views')}>
                                    <FiLayers size={13} /> Assign Semantic Views
                                  </button>
                                  <button className="ws-kebab-danger" onClick={() => handleRequestDeleteConnection(wc)}>
                                    <FiTrash2 size={13} /> Remove
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        {connTestResults[wc.connection_id] && (
                          <span className={`ws-table-test-badge ${connTestResults[wc.connection_id].success ? 'success' : 'error'}`}>
                            {connTestResults[wc.connection_id].success ? <FiCheck size={12} /> : <FiX size={12} />}
                          </span>
                        )}
                        {testingConnId === wc.connection_id && <FiLoader className="spinner" size={14} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="ws-muted">{isAdmin ? 'No connections configured.' : 'No connections configured. Ask an admin to add one.'}</p>
          )}
          {isAdmin && (
            <div className="ws-flat-add-row">
              <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={onNewConnection}><FiPlus /> New Connection</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
