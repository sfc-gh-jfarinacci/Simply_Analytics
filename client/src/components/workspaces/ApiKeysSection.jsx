import React from 'react';
import {
  FiKey, FiPlus, FiTrash2, FiCopy, FiLoader,
  FiChevronDown, FiChevronUp,
} from 'react-icons/fi';

export default function ApiKeysSection({
  isOpen, onToggle, wsApiKeys, isAdmin, toast,
  revealedKey, setRevealedKey,
  showCreateKey, setShowCreateKey, newKeyName, setNewKeyName,
  creatingKey, handleCreateApiKey, handleRevokeApiKey,
}) {
  return (
    <div className="ws-flat-section">
      <button className="ws-flat-section-toggle" onClick={onToggle}>
        <span className="ws-flat-section-label"><FiKey size={14} /> API Keys <span className="ws-flat-count">{wsApiKeys.length}</span></span>
        {isOpen ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
      </button>
      {isOpen && (
        <div className="ws-flat-section-body">
          {revealedKey && (
            <div className="ws-apikey-reveal">
              <p className="ws-apikey-reveal-label">Your new API key (copy it now — it won't be shown again):</p>
              <div className="ws-apikey-reveal-box">
                <code>{revealedKey}</code>
                <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => { navigator.clipboard.writeText(revealedKey); toast.success('API key copied'); }}>
                  <FiCopy size={12} /> Copy
                </button>
              </div>
              <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => setRevealedKey(null)}>Dismiss</button>
            </div>
          )}

          {wsApiKeys.length > 0 ? (
            <table className="ws-table">
              <thead>
                <tr><th>Name</th><th>Prefix</th><th>Status</th><th>Last Used</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {wsApiKeys.map(k => (
                  <tr key={k.id} className={!k.is_active ? 'ws-row-revoked' : ''}>
                    <td className="ws-table-name">{k.name}</td>
                    <td className="ws-table-meta ws-mono">{k.key_prefix}...</td>
                    <td className="ws-table-meta">
                      <span className={`ws-ep-badge ${k.is_active ? 'ws-ep-public' : 'ws-ep-revoked'}`}>
                        {k.is_active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="ws-table-meta">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</td>
                    <td className="ws-table-meta">{new Date(k.created_at).toLocaleDateString()}</td>
                    <td className="ws-table-actions">
                      {isAdmin && k.is_active && (
                        <button className="ws-btn-icon-sm ws-btn-danger-icon" onClick={() => handleRevokeApiKey(k.id)} title="Revoke">
                          <FiTrash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ws-muted">{isAdmin ? 'No API keys yet. Create one to allow programmatic access.' : 'No API keys configured.'}</p>
          )}

          {isAdmin && (
            <div className="ws-flat-add-row">
              {showCreateKey ? (
                <div className="ws-apikey-create-row">
                  <input
                    className="ws-apikey-name-input"
                    placeholder="Key name (e.g. Production API)"
                    value={newKeyName}
                    onChange={e => setNewKeyName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateApiKey(); if (e.key === 'Escape') setShowCreateKey(false); }}
                    autoFocus
                  />
                  <button className="ws-btn ws-btn-primary ws-btn-sm" disabled={!newKeyName.trim() || creatingKey} onClick={handleCreateApiKey}>
                    {creatingKey ? <FiLoader className="spinner" /> : 'Create'}
                  </button>
                  <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => { setShowCreateKey(false); setNewKeyName(''); }}>Cancel</button>
                </div>
              ) : (
                <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => setShowCreateKey(true)}>
                  <FiPlus /> New API Key
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
