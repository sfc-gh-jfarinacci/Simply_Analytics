import React, { useState, useEffect, useRef } from 'react';
import {
  FiDatabase, FiX, FiLoader, FiCheck, FiRefreshCw,
  FiAlertCircle, FiCheckCircle, FiArrowRight, FiArrowLeft,
} from 'react-icons/fi';
import { sfConnectionApi } from '../api/modules/sfConnectionApi';
import '../styles/ConnectionModal.css';

const EMPTY_FORM = {
  name: '',
  description: '',
  account: '',
  username: '',
  authType: 'pat',
  token: '',
  privateKey: '',
  passphrase: '',
};

/**
 * Two-step modal for Snowflake connections:
 *   Step 1 — Create or edit credentials
 *   Step 2 — Pick role and warehouse (sustained session, no reconnect per switch)
 *
 * @param {object}   props.connection          - existing SF connection to edit (null = create)
 * @param {object}   props.workspaceConnection - workspace_connection row ({ id, role, warehouse })
 * @param {boolean}  props.showConfig          - if true, include the role/warehouse step
 * @param {function} props.onClose
 * @param {function} props.onSaved             - (connection, { role, warehouse }) => void
 */
export default function ConnectionModal({
  connection,
  workspaceConnection,
  showConfig = false,
  onClose,
  onSaved,
}) {
  const isEdit = !!connection;
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [step, setStep] = useState('credentials');
  const [activeConn, setActiveConn] = useState(null);

  // Config session state
  const [roles, setRoles] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);

  // Track whether session is open to avoid duplicate calls
  const sessionConnId = useRef(null);

  // Close the config session when the modal unmounts
  useEffect(() => {
    return () => {
      if (sessionConnId.current) {
        sfConnectionApi.closeConfigSession(sessionConnId.current);
        sessionConnId.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (connection) {
      setForm({
        name: connection.name,
        description: connection.description || '',
        account: connection.account,
        username: connection.username,
        authType: connection.auth_type || 'pat',
        token: '',
        privateKey: '',
        passphrase: '',
      });
      setActiveConn(connection);
    } else {
      setForm(EMPTY_FORM);
      setActiveConn(null);
    }
    setError(null);
    setTestResult(null);
    setStep('credentials');
    setSelectedRole(workspaceConnection?.role || '');
    setSelectedWarehouse(workspaceConnection?.warehouse || '');
    setRoles([]);
    setWarehouses([]);
    sessionConnId.current = null;
  }, [connection, workspaceConnection]);

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  // Open a config session and load roles
  const openSession = async (connId) => {
    if (sessionConnId.current === connId) return;
    sessionConnId.current = connId;
    setLoadingRoles(true);
    setError(null);
    try {
      const res = await sfConnectionApi.openConfigSession(connId);
      setRoles(res.roles || []);
    } catch (err) {
      setRoles([]);
      setError(`Failed to load roles: ${err.message}`);
      setLoadingRoles(false);
      return;
    } finally {
      setLoadingRoles(false);
    }

    // If there's a pre-selected role, load warehouses for it right away
    const role = workspaceConnection?.role || '';
    if (role) {
      setLoadingWarehouses(true);
      try {
        const wRes = await sfConnectionApi.configSessionWarehouses(connId, role);
        setWarehouses(wRes.warehouses || []);
      } catch (err) {
        setWarehouses([]);
        setError(`Failed to load warehouses: ${err.message}`);
      } finally {
        setLoadingWarehouses(false);
      }
    }
  };

  // Switch role on the sustained session — loads warehouses
  const handleRoleChange = async (newRole) => {
    setSelectedRole(newRole);
    setSelectedWarehouse('');
    setWarehouses([]);
    setError(null);
    if (!activeConn?.id || !newRole) return;
    setLoadingWarehouses(true);
    try {
      const res = await sfConnectionApi.configSessionWarehouses(activeConn.id, newRole);
      setWarehouses(res.warehouses || []);
    } catch (err) {
      setWarehouses([]);
      setError(`Failed to load warehouses: ${err.message}`);
    } finally {
      setLoadingWarehouses(false);
    }
  };

  const handleSaveCredentials = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setTestResult(null);

    try {
      const credentials = form.authType === 'pat'
        ? { token: form.token }
        : { privateKey: form.privateKey, passphrase: form.passphrase };

      // For new connections (or edits with new credentials), test before saving
      const needsTest = !isEdit || form.token || form.privateKey;
      if (needsTest) {
        const testRes = await sfConnectionApi.testRaw({
          account: form.account,
          username: form.username,
          authType: form.authType,
          credentials,
        });

        if (!testRes.success) {
          setTestResult(testRes);
          setError(`Connection failed: ${testRes.error}`);
          return;
        }

        if (testRes.roles?.length) {
          setRoles(testRes.roles);
        }
      }

      // Connection verified — now save to database
      const data = {
        name: form.name,
        description: form.description,
        account: form.account,
        username: form.username,
        authType: form.authType,
        credentials,
      };

      let result;
      if (isEdit) {
        result = await sfConnectionApi.update(connection.id, data);
      } else {
        result = await sfConnectionApi.create(data);
      }

      const conn = result.connection || result;
      setActiveConn(conn);
      const connId = conn.id || (isEdit ? connection.id : null);

      if (showConfig) {
        sessionConnId.current = null;
        try {
          const res = await sfConnectionApi.openConfigSession(connId);
          if (res.roles?.length) setRoles(res.roles);
          sessionConnId.current = connId;
        } catch {
          // Roles already loaded from test
        }

        setTestResult({ success: true });
        setStep('config');

        const role = workspaceConnection?.role || '';
        if (role) {
          setLoadingWarehouses(true);
          try {
            const wRes = await sfConnectionApi.configSessionWarehouses(connId, role);
            setWarehouses(wRes.warehouses || []);
          } catch {
            setWarehouses([]);
          } finally {
            setLoadingWarehouses(false);
          }
        }
      } else {
        onSaved(conn, {});
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = () => {
    onSaved(activeConn, {
      role: selectedRole,
      warehouse: selectedWarehouse,
    });
  };

  // ── Step 2: Role & Warehouse (sustained session) ──
  if (step === 'config') {
    return (
      <div className="conn-modal-overlay" onClick={onClose}>
        <div className="conn-modal" onClick={e => e.stopPropagation()}>
          <div className="conn-modal-header">
            <h2><FiDatabase /> Role &amp; Warehouse</h2>
            <button className="conn-modal-close" onClick={onClose}><FiX /></button>
          </div>

          <div className="conn-modal-body">
            {error && (
              <div className="conn-alert conn-alert-error">
                <FiAlertCircle /> {error}
              </div>
            )}

            <div className="conn-config-banner">
              <FiCheckCircle />
              <span>Connection <strong>{activeConn?.name}</strong> {isEdit ? 'verified' : 'created'} successfully.</span>
            </div>

            <p className="conn-config-hint">
              Select the role and warehouse for this connection in the workspace.
              Changing the role will update the available warehouses.
            </p>

            <div className="conn-field">
              <label>Role *</label>
              {loadingRoles ? (
                <div className="conn-loading"><FiLoader className="spinner" /> Loading roles...</div>
              ) : (
                <select value={selectedRole} onChange={e => handleRoleChange(e.target.value)} disabled={loadingWarehouses}>
                  <option value="" disabled>Select a role</option>
                  {roles.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </div>

            <div className="conn-field">
              <label>Warehouse *</label>
              {loadingWarehouses ? (
                <div className="conn-loading"><FiLoader className="spinner" /> Loading warehouses...</div>
              ) : !selectedRole ? (
                <select disabled><option>Select a role first</option></select>
              ) : (
                <select value={selectedWarehouse} onChange={e => setSelectedWarehouse(e.target.value)}>
                  <option value="" disabled>Select a warehouse</option>
                  {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              )}
            </div>
          </div>

          <div className="conn-modal-footer">
            <button type="button" className="conn-modal-btn conn-btn-secondary" onClick={() => setStep('credentials')}>
              <FiArrowLeft /> Back
            </button>
            {error && roles.length === 0 && (
              <button type="button" className="conn-modal-btn conn-btn-secondary" onClick={() => { sessionConnId.current = null; openSession(activeConn?.id); }}>
                <FiRefreshCw /> Retry
              </button>
            )}
            <button type="button" className="conn-modal-btn conn-btn-primary" onClick={handleFinish} disabled={!selectedRole || !selectedWarehouse}>
              <FiCheck /> Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: Credentials ──
  return (
    <div className="conn-modal-overlay" onClick={onClose}>
      <div className="conn-modal" onClick={e => e.stopPropagation()}>
        <div className="conn-modal-header">
          <h2><FiDatabase /> {isEdit ? 'Edit Connection' : 'New Connection'}</h2>
          <button className="conn-modal-close" onClick={onClose}><FiX /></button>
        </div>

        <form onSubmit={handleSaveCredentials}>
          <div className="conn-modal-body">
            {error && (
              <div className="conn-alert conn-alert-error">
                <FiAlertCircle /> {error}
              </div>
            )}

            <div className="conn-field">
              <label>Connection Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="My Snowflake Connection"
                required
                autoFocus
              />
            </div>

            <div className="conn-field">
              <label>Description</label>
              <input
                type="text"
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div className="conn-field-row">
              <div className="conn-field">
                <label>Account *</label>
                <input
                  type="text"
                  value={form.account}
                  onChange={e => set('account', e.target.value)}
                  placeholder="account.region"
                  required
                />
              </div>
              <div className="conn-field">
                <label>Username *</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => set('username', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="conn-field">
              <label>Authentication Type</label>
              <div className="conn-auth-toggle">
                <button
                  type="button"
                  className={`conn-auth-btn ${form.authType === 'pat' ? 'active' : ''}`}
                  onClick={() => set('authType', 'pat')}
                >
                  Access Token (PAT)
                </button>
                <button
                  type="button"
                  className={`conn-auth-btn ${form.authType === 'keypair' ? 'active' : ''}`}
                  onClick={() => set('authType', 'keypair')}
                >
                  Key Pair
                </button>
              </div>
            </div>

            {form.authType === 'pat' ? (
              <div className="conn-field">
                <label>Access Token {!isEdit && '*'}</label>
                <input
                  type="password"
                  value={form.token}
                  onChange={e => set('token', e.target.value)}
                  placeholder={isEdit ? 'Leave blank to keep current' : 'Paste your PAT here'}
                  required={!isEdit}
                />
              </div>
            ) : (
              <>
                <div className="conn-field">
                  <label>Private Key (PEM) {!isEdit && '*'}</label>
                  <textarea
                    value={form.privateKey}
                    onChange={e => set('privateKey', e.target.value)}
                    placeholder={isEdit ? 'Leave blank to keep current' : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
                    rows={4}
                    required={!isEdit}
                  />
                </div>
                <div className="conn-field">
                  <label>Passphrase (if encrypted)</label>
                  <input
                    type="password"
                    value={form.passphrase}
                    onChange={e => set('passphrase', e.target.value)}
                    placeholder="Optional passphrase"
                  />
                </div>
              </>
            )}

            {testResult && !testResult.success && (
              <div className="conn-test-section">
                <div className={`conn-test-result error`}>
                  <FiAlertCircle /> {testResult.error}
                </div>
              </div>
            )}
          </div>

          <div className="conn-modal-footer">
            <button type="button" className="conn-modal-btn conn-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="conn-modal-btn conn-btn-primary" disabled={saving}>
              {saving ? <><FiLoader className="spinner" /> Connecting...</> : <><FiArrowRight /> {isEdit ? 'Save & Connect' : 'Create & Connect'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
