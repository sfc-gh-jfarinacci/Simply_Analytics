import React from 'react';
import {
  FiLink, FiPlus, FiMoreVertical, FiCopy, FiEdit2, FiTrash2,
  FiChevronDown, FiChevronUp, FiGrid, FiMessageSquare,
} from 'react-icons/fi';

export default function EndpointsSection({
  isOpen, onToggle, wsEndpoints, wsConnections, isAdmin,
  endpointMenuOpen, setEndpointMenuOpen, endpointMenuRef,
  copyEndpointUrl, openEndpointEdit, setEndpointToDelete,
  openEndpointCreate,
}) {
  return (
    <div className="ws-flat-section">
      <button className="ws-flat-section-toggle" onClick={onToggle}>
        <span className="ws-flat-section-label"><FiLink size={14} /> API Endpoints <span className="ws-flat-count">{wsEndpoints.length}</span></span>
        {isOpen ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
      </button>
      {isOpen && (
        <div className="ws-flat-section-body">
          {wsEndpoints.length > 0 ? (
            <table className="ws-table">
              <thead>
                <tr><th>Slug</th><th>Name</th><th>Type</th><th>Connection</th><th>Access</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {wsEndpoints.map(ep => {
                  const wc = wsConnections.find(c => c.id === ep.workspace_connection_id);
                  const menuOpen = endpointMenuOpen === ep.id;
                  return (
                    <tr key={ep.id}>
                      <td className="ws-table-name ws-mono">{ep.slug}</td>
                      <td className="ws-table-meta">{ep.name}</td>
                      <td className="ws-table-meta">
                        <span className={`ws-ep-type-badge ${ep.endpoint_type === 'analyst' ? 'ws-ep-type-analyst' : 'ws-ep-type-structured'}`}>
                          {ep.endpoint_type === 'analyst' ? <><FiMessageSquare size={11} /> Analyst</> : <><FiGrid size={11} /> Structured</>}
                        </span>
                      </td>
                      <td className="ws-table-meta">{wc?.connection_name || '—'}</td>
                      <td className="ws-table-meta">
                        <span className={`ws-ep-badge ${ep.is_public ? 'ws-ep-public' : 'ws-ep-private'}`}>
                          {ep.is_public ? 'Public' : 'Private'}
                        </span>
                      </td>
                      <td className="ws-table-meta">{new Date(ep.created_at).toLocaleDateString()}</td>
                      <td className="ws-table-actions">
                        <div className="ws-kebab-wrap" ref={menuOpen ? endpointMenuRef : undefined}>
                          <button className="ws-kebab-btn" onClick={() => setEndpointMenuOpen(menuOpen ? null : ep.id)}>
                            <FiMoreVertical />
                          </button>
                          {menuOpen && (
                            <div className="ws-kebab-menu">
                              <button onClick={() => copyEndpointUrl(ep)}><FiCopy size={13} /> Copy URL</button>
                              {isAdmin && (
                                <>
                                  <button onClick={() => openEndpointEdit(ep)}><FiEdit2 size={13} /> Edit</button>
                                  <button className="ws-kebab-danger" onClick={() => { setEndpointMenuOpen(null); setEndpointToDelete(ep); }}>
                                    <FiTrash2 size={13} /> Delete
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="ws-muted">{isAdmin ? 'No API endpoints configured.' : 'No API endpoints configured. Ask an admin to create one.'}</p>
          )}
          {isAdmin && (
            <div className="ws-flat-add-row">
              <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={openEndpointCreate}><FiPlus /> New Endpoint</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
