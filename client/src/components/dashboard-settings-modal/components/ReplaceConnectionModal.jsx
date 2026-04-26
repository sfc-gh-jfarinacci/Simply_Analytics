import React from 'react';
import { FiDatabase, FiX, FiAlertCircle, FiRefreshCw, FiCheck, FiLayers } from 'react-icons/fi';

export function ReplaceConnectionModal({
  dashboard,
  showReplaceConnection,
  setShowReplaceConnection,
  loadingConnections,
  availableConnections,
  selectedConnectionId,
  setSelectedConnectionId,
  handleReplaceConnection,
  error,
}) {
  if (!showReplaceConnection) return null;

  const connections = Array.isArray(availableConnections) ? availableConnections : [];
  const currentConnectionId = dashboard?.connection_id;

  return (
    <div className="replace-connection-overlay">
      <div className="replace-connection-modal">
        <div className="modal-header">
          <h3>
            <FiDatabase /> Replace Connection
          </h3>
          <button
            className="close-btn"
            onClick={() => {
              setShowReplaceConnection(false);
              setSelectedConnectionId(null);
            }}
          >
            <FiX />
          </button>
        </div>
        <div className="modal-body">
          <p className="replace-warning">
            <FiAlertCircle /> The new connection must have the same semantic views assigned to it in this workspace.
          </p>

          {error && (
            <div className="settings-error" style={{ marginBottom: 12 }}>{error}</div>
          )}

          <div className="form-group">
            <label className="form-label">Workspace Connections</label>
            {loadingConnections ? (
              <div className="loading-connections">
                <FiRefreshCw className="spin" /> Loading connections...
              </div>
            ) : connections.length === 0 ? (
              <p className="no-connections">No connections allocated to this workspace.</p>
            ) : (
              <div className="connections-list">
                {connections.map((wc) => {
                  const isCurrent = wc.connection_id === currentConnectionId;
                  const isSelected = selectedConnectionId === wc.id;
                  return (
                    <label
                      key={wc.id}
                      className={`connection-option ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''}`}
                    >
                      <input
                        type="radio"
                        name="connection"
                        value={wc.id}
                        checked={isSelected}
                        onChange={() => setSelectedConnectionId(wc.id)}
                        disabled={isCurrent}
                      />
                      <div className="connection-option-info">
                        <span className="connection-name">{wc.connection_name}</span>
                        <span className="connection-account">
                          {[wc.connection_account, wc.role, wc.warehouse].filter(Boolean).join(' · ')}
                        </span>
                        {wc.views?.length > 0 && (
                          <span className="connection-resources">
                            <FiLayers size={11} /> {wc.views.length} view{wc.views.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {isCurrent && <span className="current-badge">Current</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-secondary"
            onClick={() => {
              setShowReplaceConnection(false);
              setSelectedConnectionId(null);
            }}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleReplaceConnection}
            disabled={!selectedConnectionId || connections.find(c => c.id === selectedConnectionId)?.connection_id === currentConnectionId}
          >
            <FiCheck /> Replace Connection
          </button>
        </div>
      </div>
    </div>
  );
}
