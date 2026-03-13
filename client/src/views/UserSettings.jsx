/**
 * User Settings Component
 * 
 * Single-page settings with all sections visible
 * - Profile overview
 * - Snowflake connections
 * - Security/Password
 */

import React, { useState, useEffect } from 'react';
import { 
  FiSettings, FiUser, FiDatabase, FiPlus, FiEdit2, FiTrash2, 
  FiCheck, FiX, FiLoader, FiKey, FiEye, FiEyeOff, FiRefreshCw,
  FiAlertCircle, FiCheckCircle, FiShield, FiMail
} from 'react-icons/fi';
import { useAppStore } from '../store/appStore';
import { sfConnectionApi as connectionApi, userApi, dashboardApi } from '../api/apiClient';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import TwoFactorSettingsModal from '../components/TwoFactorSettingsModal';
import '../styles/UserSettings.css';

const UserSettings = () => {
  const { currentUser, currentRole } = useAppStore();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Only admins and owners can add/edit/delete connections
  const canManageConnections = ['owner', 'admin'].includes(currentRole);
  
  // Connection form
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState(null);
  const [connectionForm, setConnectionForm] = useState({
    name: '',
    description: '',
    account: '',
    username: '',
    authType: 'pat',
    token: '',
    privateKey: '',
    passphrase: '',
  });
  const [connectionError, setConnectionError] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  
  // Inline test for connection list
  const [testingConnectionId, setTestingConnectionId] = useState(null);
  const [connectionTestResults, setConnectionTestResults] = useState({});
  
  // Delete connection state
  const [connectionToDelete, setConnectionToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  // Password form
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Email form state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailForm, setEmailForm] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState(null);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      setLoading(true);
      const response = await connectionApi.getAll();
      setConnections(response.connections || []);
    } catch (err) {
      console.error('Failed to load connections:', err);
    } finally {
      setLoading(false);
    }
  };

  const resetConnectionForm = () => {
    setConnectionForm({
      name: '',
      description: '',
      account: '',
      username: '',
      authType: 'pat',
      token: '',
      privateKey: '',
      passphrase: '',
    });
    setConnectionError(null);
    setTestResult(null);
    setEditingConnection(null);
  };

  const openConnectionModal = (connection = null) => {
    if (connection) {
      setEditingConnection(connection);
      setConnectionForm({
        name: connection.name,
        description: connection.description || '',
        account: connection.account,
        username: connection.username,
        authType: connection.auth_type,
        token: '',
        privateKey: '',
        passphrase: '',
      });
    } else {
      resetConnectionForm();
    }
    setShowConnectionModal(true);
  };

  const handleSaveConnection = async (e) => {
    e.preventDefault();
    setConnectionLoading(true);
    setConnectionError(null);

    try {
      const credentials = connectionForm.authType === 'pat'
        ? { token: connectionForm.token }
        : { privateKey: connectionForm.privateKey, passphrase: connectionForm.passphrase };

      const data = {
        name: connectionForm.name,
        description: connectionForm.description,
        account: connectionForm.account,
        username: connectionForm.username,
        authType: connectionForm.authType,
      };

      if (connectionForm.token || connectionForm.privateKey) {
        data.credentials = credentials;
      }

      if (editingConnection) {
        await connectionApi.update(editingConnection.id, data);
      } else {
        data.credentials = credentials;
        await connectionApi.create(data);
      }

      await loadConnections();
      setShowConnectionModal(false);
      resetConnectionForm();
    } catch (err) {
      setConnectionError(err.message);
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!editingConnection) return;
    
    setTestLoading(true);
    setTestResult(null);

    try {
      const result = await connectionApi.test(editingConnection.id);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTestLoading(false);
    }
  };

  // Test connection from the list (inline)
  const handleTestConnectionInline = async (connectionId) => {
    setTestingConnectionId(connectionId);
    setConnectionTestResults(prev => ({ ...prev, [connectionId]: null }));

    try {
      const result = await connectionApi.test(connectionId);
      setConnectionTestResults(prev => ({ 
        ...prev, 
        [connectionId]: result.success 
          ? { success: true, message: `Connected as ${result.user}` }
          : { success: false, message: result.error || 'Failed' }
      }));
      
      // Clear result after 4 seconds
      setTimeout(() => {
        setConnectionTestResults(prev => ({ ...prev, [connectionId]: null }));
      }, 4000);
    } catch (err) {
      setConnectionTestResults(prev => ({ 
        ...prev, 
        [connectionId]: { success: false, message: err.message || 'Failed' }
      }));
      
      setTimeout(() => {
        setConnectionTestResults(prev => ({ ...prev, [connectionId]: null }));
      }, 4000);
    } finally {
      setTestingConnectionId(null);
    }
  };

  const initiateDeleteConnection = async (connection) => {
    setDeleteError(null);
    
    // Check if any dashboards are using this connection
    try {
      const dashboardsResponse = await dashboardApi.getAll();
      const dashboards = dashboardsResponse.dashboards || [];
      const dependentDashboards = dashboards.filter(d => d.connection_id === connection.id);
      
      if (dependentDashboards.length > 0) {
        const names = dependentDashboards.map(d => d.name).join(', ');
        setDeleteError(`Cannot delete this connection. It is used by ${dependentDashboards.length} dashboard(s): ${names}`);
        return;
      }
      
      // No dependencies, show confirmation dialog
      setConnectionToDelete(connection);
    } catch (err) {
      console.error('Error checking dashboard dependencies:', err);
      // If we can't check, still allow deletion attempt
      setConnectionToDelete(connection);
    }
  };

  const handleDeleteConnection = async () => {
    if (!connectionToDelete) return;

    try {
      await connectionApi.delete(connectionToDelete.id);
      await loadConnections();
      setConnectionToDelete(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(err.message);
      setConnectionToDelete(null);
    }
  };

  // Password validation helper
  // Requirements: 14+ chars, 1 uppercase, 1 lowercase, 1 number, 1 special character
  const validatePassword = (password) => {
    const errors = [];
    if (password.length < 14) errors.push('at least 14 characters');
    if (!/[A-Z]/.test(password)) errors.push('1 uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('1 lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('1 number');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('1 special character');
    return errors;
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    const validationErrors = validatePassword(passwordForm.newPassword);
    if (validationErrors.length > 0) {
      setPasswordError(`Password must have: ${validationErrors.join(', ')}`);
      return;
    }

    setPasswordLoading(true);

    try {
      await userApi.changePassword(
        currentUser.id,
        passwordForm.currentPassword,
        passwordForm.newPassword
      );
      setPasswordSuccess(true);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        setShowPasswordForm(false);
        setPasswordSuccess(false);
      }, 2000);
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    setEmailError(null);
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailForm)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setEmailLoading(true);
    try {
      await userApi.updateEmail(currentUser.id, emailForm);
      // Update the user in the store
      useAppStore.getState().setCurrentUser({ ...currentUser, email: emailForm });
      setShowEmailModal(false);
      setEmailForm('');
    } catch (err) {
      setEmailError(err.message);
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="user-settings">
      <header className="settings-header">
        <div className="header-content">
          <div>
            <h1>Settings</h1>
            <p>Manage your account, connections, and security</p>
          </div>
        </div>
      </header>

      <div className="settings-content">
        <section className="settings-section">
          <div className="section-header">
            <div>
              <h2><FiUser /> Profile</h2>
              <p>Your account information and credentials</p>
            </div>
          </div>
          <div className="section-card profile-card">
            <div className="profile-row">
              <div className="profile-avatar">
                {(currentUser?.display_name || currentUser?.username || 'U')[0].toUpperCase()}
              </div>
              <div className="profile-info">
                <h2>{currentUser?.display_name || currentUser?.username}</h2>
                <span className="profile-username">@{currentUser?.username}</span>
              </div>
              <span className="role-badge">{currentRole}</span>
            </div>
            
            <div className="profile-details">
              <div className="detail-item">
                <FiMail />
                {currentUser?.email ? (
                  <span>{currentUser.email}</span>
                ) : (
                  <button 
                    className="text-btn"
                    onClick={() => setShowEmailModal(true)}
                  >
                    No email set - Click to add
                  </button>
                )}
              </div>
              <div className="detail-item">
                <FiDatabase />
                <span>{connections.length} connection{connections.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="detail-item">
                <FiShield />
                {showPasswordForm ? (
                  <button 
                    className="text-btn cancel"
                    onClick={() => setShowPasswordForm(false)}
                  >
                    Cancel
                  </button>
                ) : (
                  <button 
                    className="text-btn"
                    onClick={() => setShowPasswordForm(true)}
                  >
                    Change Password
                  </button>
                )}
              </div>
            </div>

            {/* Inline Password Form */}
            {showPasswordForm && (
              <form onSubmit={handleChangePassword} className="inline-password-form">
                {passwordError && (
                  <div className="form-alert error">
                    <FiAlertCircle />
                    {passwordError}
                  </div>
                )}
                {passwordSuccess && (
                  <div className="form-alert success">
                    <FiCheckCircle />
                    Password updated!
                  </div>
                )}
                
                <div className="password-fields">
                  <div className="password-field">
                    <input
                      type={showPasswords.current ? 'text' : 'password'}
                      value={passwordForm.currentPassword}
                      onChange={e => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                      placeholder="Current password"
                      required
                    />
                    <button
                      type="button"
                      className="visibility-toggle"
                      onClick={() => setShowPasswords({...showPasswords, current: !showPasswords.current})}
                    >
                      {showPasswords.current ? <FiEyeOff /> : <FiEye />}
                    </button>
                  </div>
                  
                  <div className="password-field">
                    <input
                      type={showPasswords.new ? 'text' : 'password'}
                      value={passwordForm.newPassword}
                      onChange={e => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                      placeholder="New password"
                      required
                      minLength={14}
                    />
                    <button
                      type="button"
                      className="visibility-toggle"
                      onClick={() => setShowPasswords({...showPasswords, new: !showPasswords.new})}
                    >
                      {showPasswords.new ? <FiEyeOff /> : <FiEye />}
                    </button>
                  </div>
                  
                  <div className="password-field">
                    <input
                      type={showPasswords.confirm ? 'text' : 'password'}
                      value={passwordForm.confirmPassword}
                      onChange={e => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                      placeholder="Confirm new password"
                      required
                      minLength={14}
                    />
                    <button
                      type="button"
                      className="visibility-toggle"
                      onClick={() => setShowPasswords({...showPasswords, confirm: !showPasswords.confirm})}
                    >
                      {showPasswords.confirm ? <FiEyeOff /> : <FiEye />}
                    </button>
                  </div>
                </div>
                
                <p className="password-requirements">
                  Must be 14+ characters with uppercase, lowercase, number, and special character.
                </p>
                
                <button type="submit" className="save-password-btn" disabled={passwordLoading}>
                  {passwordLoading ? <FiLoader className="spinner" /> : <FiCheck />}
                  Update Password
                </button>
              </form>
            )}
          </div>
        </section>

        <section className="settings-section">
          <TwoFactorSettingsModal />
        </section>

        {canManageConnections && (
        <section className="settings-section">
          <div className="section-header">
            <div>
              <h2><FiDatabase /> Snowflake Connections</h2>
              <p>Manage your data warehouse connections for dashboards</p>
            </div>
            {canManageConnections && (
              <button className="add-btn" onClick={() => openConnectionModal()}>
                <FiPlus />
                Add Connection
              </button>
            )}
          </div>

          {loading ? (
            <div className="loading-state">
              <FiLoader className="spinner" />
              <span>Loading...</span>
            </div>
          ) : connections.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><FiDatabase /></div>
              <h3>No connections yet</h3>
              <p>{canManageConnections 
                ? 'Add a Snowflake connection to start creating dashboards'
                : 'Contact an admin to add Snowflake connections'}</p>
              {canManageConnections && (
                <button className="add-btn" onClick={() => openConnectionModal()}>
                  <FiPlus /> Add Connection
                </button>
              )}
            </div>
          ) : (
            <>
              {deleteError && (
                <div className="form-alert error" style={{ marginBottom: '16px' }}>
                  <FiAlertCircle />
                  {deleteError}
                  <button 
                    className="dismiss-btn"
                    onClick={() => setDeleteError(null)}
                  >
                    <FiX />
                  </button>
                </div>
              )}
              <div className="connections-list">
                {connections.map(conn => (
                <div key={conn.id} className="connection-row">
                  <div className="connection-icon">
                    <FiDatabase />
                  </div>
                  <div className="connection-main">
                    <div className="connection-name">
                      <strong>{conn.name}</strong>
                      <span className={`status-dot ${conn.is_valid ? 'active' : 'inactive'}`} />
                    </div>
                    <div className="connection-meta">
                      <span>{conn.account}</span>
                      <span>•</span>
                      <span>{conn.username}</span>
                      <span>•</span>
                      <span className="auth-tag">{conn.auth_type.toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="connection-actions-col">
                    {canManageConnections && (
                      <div className="connection-actions">
                        <button 
                          className="icon-btn"
                          onClick={() => openConnectionModal(conn)}
                          title="Edit"
                        >
                          <FiEdit2 />
                        </button>
                        <button 
                          className="icon-btn danger"
                          onClick={() => initiateDeleteConnection(conn)}
                          title="Delete"
                        >
                          <FiTrash2 />
                        </button>
                      </div>
                    )}
                    <button 
                      className={`test-connection-btn-small ${testingConnectionId === conn.id ? 'testing' : ''} ${connectionTestResults[conn.id]?.success ? 'success' : ''} ${connectionTestResults[conn.id]?.success === false ? 'error' : ''}`}
                      onClick={() => handleTestConnectionInline(conn.id)}
                      disabled={testingConnectionId === conn.id}
                      title="Test Connection"
                    >
                      {testingConnectionId === conn.id ? (
                        <><FiRefreshCw className="spinner" /> Testing</>
                      ) : connectionTestResults[conn.id]?.success ? (
                        <><FiCheck /> Connected</>
                      ) : connectionTestResults[conn.id]?.success === false ? (
                        <><FiAlertCircle /> Failed</>
                      ) : (
                        <><FiRefreshCw /> Test</>
                      )}
                    </button>
                  </div>
                </div>
              ))}
              </div>
            </>
          )}
        </section>
        )}
      </div>

      {/* Delete Connection Confirmation */}
      {canManageConnections && connectionToDelete && (
        <ConfirmDeleteModal
          itemName={connectionToDelete.name}
          itemType="connection"
          onConfirm={handleDeleteConnection}
          onCancel={() => setConnectionToDelete(null)}
        />
      )}

      {/* Connection Modal */}
      {canManageConnections && showConnectionModal && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <FiDatabase />
                {editingConnection ? 'Edit Connection' : 'New Connection'}
              </h2>
              <button className="modal-close" onClick={() => setShowConnectionModal(false)}>
                <FiX />
              </button>
            </div>

            <form onSubmit={handleSaveConnection}>
              <div className="modal-body">
                {connectionError && (
                  <div className="form-alert error">
                    <FiAlertCircle />
                    {connectionError}
                  </div>
                )}

                <div className="form-group">
                  <label>Connection Name *</label>
                  <input
                    type="text"
                    value={connectionForm.name}
                    onChange={e => setConnectionForm({...connectionForm, name: e.target.value})}
                    placeholder="My Snowflake Connection"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <input
                    type="text"
                    value={connectionForm.description}
                    onChange={e => setConnectionForm({...connectionForm, description: e.target.value})}
                    placeholder="Optional description"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Account *</label>
                    <input
                      type="text"
                      value={connectionForm.account}
                      onChange={e => setConnectionForm({...connectionForm, account: e.target.value})}
                      placeholder="account.region"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Username *</label>
                    <input
                      type="text"
                      value={connectionForm.username}
                      onChange={e => setConnectionForm({...connectionForm, username: e.target.value})}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Authentication Type</label>
                  <div className="auth-toggle">
                    <button
                      type="button"
                      className={`auth-toggle-btn ${connectionForm.authType === 'pat' ? 'active' : ''}`}
                      onClick={() => setConnectionForm({...connectionForm, authType: 'pat'})}
                    >
                      Access Token (PAT)
                    </button>
                    <button
                      type="button"
                      className={`auth-toggle-btn ${connectionForm.authType === 'keypair' ? 'active' : ''}`}
                      onClick={() => setConnectionForm({...connectionForm, authType: 'keypair'})}
                    >
                      Key Pair
                    </button>
                  </div>
                </div>

                {connectionForm.authType === 'pat' ? (
                  <div className="form-group">
                    <label>Access Token {!editingConnection && '*'}</label>
                    <input
                      type="password"
                      value={connectionForm.token}
                      onChange={e => setConnectionForm({...connectionForm, token: e.target.value})}
                      placeholder={editingConnection ? 'Leave blank to keep current' : 'Paste your PAT here'}
                      required={!editingConnection}
                    />
                  </div>
                ) : (
                  <>
                    <div className="form-group">
                      <label>Private Key (PEM) {!editingConnection && '*'}</label>
                      <textarea
                        value={connectionForm.privateKey}
                        onChange={e => setConnectionForm({...connectionForm, privateKey: e.target.value})}
                        placeholder={editingConnection ? 'Leave blank to keep current' : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
                        rows={4}
                        required={!editingConnection}
                      />
                    </div>
                    <div className="form-group">
                      <label>Passphrase (if encrypted)</label>
                      <input
                        type="password"
                        value={connectionForm.passphrase}
                        onChange={e => setConnectionForm({...connectionForm, passphrase: e.target.value})}
                        placeholder="Optional passphrase"
                      />
                    </div>
                  </>
                )}

                {editingConnection && (
                  <div className="test-section">
                    <button
                      type="button"
                      className="test-btn"
                      onClick={handleTestConnection}
                      disabled={testLoading}
                    >
                      {testLoading ? <FiLoader className="spinner" /> : <FiRefreshCw />}
                      Test Connection
                    </button>
                    
                    {testResult && (
                      <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                        {testResult.success ? (
                          <>
                            <FiCheckCircle />
                            <span>Connected as {testResult.user} with role {testResult.role}</span>
                          </>
                        ) : (
                          <>
                            <FiAlertCircle />
                            <span>{testResult.error}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  className="modal-btn secondary" 
                  onClick={() => setShowConnectionModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="modal-btn primary" disabled={connectionLoading}>
                  {connectionLoading ? <FiLoader className="spinner" /> : <FiCheck />}
                  {editingConnection ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Email Modal */}
      {showEmailModal && (
        <div className="modal-overlay" onClick={() => setShowEmailModal(false)}>
          <div className="modal email-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <FiMail />
                Set Email Address
              </h2>
              <button className="modal-close" onClick={() => setShowEmailModal(false)}>
                <FiX />
              </button>
            </div>

            <form onSubmit={handleUpdateEmail}>
              <div className="modal-body">
                {emailError && (
                  <div className="form-alert error">
                    <FiAlertCircle />
                    {emailError}
                  </div>
                )}

                <div className="form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={emailForm}
                    onChange={e => setEmailForm(e.target.value)}
                    placeholder="you@example.com"
                    autoFocus
                    required
                  />
                </div>

                <p className="email-info">
                  Your email will be used for account recovery and important notifications.
                </p>
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  className="modal-btn secondary" 
                  onClick={() => setShowEmailModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="modal-btn primary" disabled={emailLoading}>
                  {emailLoading ? <FiLoader className="spinner" /> : <FiCheck />}
                  Save Email
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserSettings;
