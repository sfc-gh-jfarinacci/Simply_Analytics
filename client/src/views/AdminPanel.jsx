import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiDatabase, FiLock, FiKey, FiServer, FiUsers, FiShield,
  FiRefreshCw, FiSave, FiAlertTriangle, FiCheck, FiCopy,
  FiPlay, FiArrowLeft, FiArrowRight, FiDownload, FiUpload,
  FiLoader, FiUser, FiGlobe, FiHardDrive, FiTrash2,
} from 'react-icons/fi';
import { useAppStore } from '../store/appStore';
import '../styles/AdminPanel.css';

const NORMAL_TABS = [
  { id: 'database', label: 'Database', icon: FiDatabase },
  { id: 'backups', label: 'Backups & Migration', icon: FiHardDrive },
  { id: 'security', label: 'Security', icon: FiLock },
  { id: 'sso', label: 'SSO & Provisioning', icon: FiGlobe },
  { id: 'system', label: 'System', icon: FiServer },
];

const PROVISION_TABS = [
  { id: 'database', label: 'Database', icon: FiDatabase },
  { id: 'security', label: 'Security', icon: FiLock },
  { id: 'migrations', label: 'Migrations', icon: FiPlay },
  { id: 'owner', label: 'Create Owner', icon: FiUser },
];

function generateHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function AdminPanel() {
  const navigate = useNavigate();
  const {
    currentRole, signOut,
    // Admin config (normal mode)
    adminConfig, adminSystemInfo, adminLoading, adminError,
    loadAdminConfig, loadAdminConfigSection, updateAdminConfig,
    testAdminConnection, runAdminMigrations, rotateAdminKey,
    loadSystemInfo, adminMigrationLogs, adminMigrationResult,
    clearAdminError,
    // Setup / provisioning
    setupProgress, fetchSetupProgress,
    detectBundledPg, bundledPg,
    downloadRecoveryKey, restoreFromBackup,
    testSetupDatabase, provisionDatabase,
    saveSetupConfig, runSetupMigrations,
    createSetupOwner, completeSetup,
    setupMigrationLogs, setupMigrationResult,
    setupLoading, setupError, clearSetupError,
    // Backups
    backups, backupStats, backupLoading,
    loadBackups, triggerBackup, downloadBackup, removeBackup,
    adminRestoreBackup,
    // Recovery key & master key rotation
    adminDownloadRecoveryKey, adminRotateMasterKey,
    // PG password rotation
    rotatePgPassword,
    emergencyMode,
    emergencyDbStatus, checkDbStatus, emergencyCreateOwner,
  } = useAppStore();

  const isProvisioning = currentRole === 'bootstrap_admin';

  const tabs = isProvisioning ? PROVISION_TABS : NORMAL_TABS;
  const [tab, setTab] = useState(tabs[0].id);

  // Normal-mode state
  const [editValues, setEditValues] = useState({});
  const [testResult, setTestResult] = useState(null);
  const [confirmRotate, setConfirmRotate] = useState(null);
  const [rotateResult, setRotateResult] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const logRef = useRef(null);

  // Provisioning state
  const [setupMode, setSetupMode] = useState(null); // null | 'fresh' | 'restore'
  const [pgHost, setPgHost] = useState('');
  const [pgPort, setPgPort] = useState('5432');
  const [pgDb, setPgDb] = useState('');
  const [pgUser, setPgUser] = useState('');
  const [pgPass, setPgPass] = useState('');
  const [dbTestResult, setDbTestResult] = useState(null);
  const [jwtSecret, setJwtSecret] = useState(() => generateHex(64));
  const [encKey, setEncKey] = useState(() => generateHex(32));
  const [jwtExpiry, setJwtExpiry] = useState('8h');
  const [ownerUsername, setOwnerUsername] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerConfirm, setOwnerConfirm] = useState('');
  const [ownerResult, setOwnerResult] = useState(null);
  const [setupComplete, setSetupComplete] = useState(false);
  const [restoreBackupFile, setRestoreBackupFile] = useState(null);
  const [restoreKeyFile, setRestoreKeyFile] = useState(null);
  const [restoreResult, setRestoreResult] = useState(null);

  // PG password rotation (normal mode)
  const [pgCurrentPass, setPgCurrentPass] = useState('');
  const [pgNewPass, setPgNewPass] = useState('');
  const [pgNewPassConfirm, setPgNewPassConfirm] = useState('');
  const [pgPassResult, setPgPassResult] = useState(null);

  // Backup restore (normal mode)
  const [adminRestoreFile, setAdminRestoreFile] = useState(null);
  const [adminRestoreKeyFile, setAdminRestoreKeyFile] = useState(null);

  // Emergency owner creation state
  const [emOwnerUsername, setEmOwnerUsername] = useState('');
  const [emOwnerEmail, setEmOwnerEmail] = useState('');
  const [emOwnerPassword, setEmOwnerPassword] = useState('');
  const [emOwnerConfirm, setEmOwnerConfirm] = useState('');
  const [emOwnerResult, setEmOwnerResult] = useState(null);
  const [emOwnerComplete, setEmOwnerComplete] = useState(false);

  const dbIsReachable = emergencyDbStatus?.dbReachable;
  const dbIsEmpty = dbIsReachable && emergencyDbStatus?.userCount === 0;
  const existingOwner = emergencyDbStatus?.owner;
  const canCreateEmOwner = emOwnerUsername && emOwnerEmail && emOwnerPassword && emOwnerPassword.length >= 8 && emOwnerPassword === emOwnerConfirm;

  // Load on mount
  useEffect(() => {
    if (isProvisioning) {
      fetchSetupProgress();
      detectBundledPg();
    } else if (emergencyMode) {
      checkDbStatus();
      loadAdminConfig();
    } else {
      loadAdminConfig();
    }
  }, []);

  // Pre-fill bundled PG when detected
  useEffect(() => {
    if (bundledPg?.detected && !pgHost) {
      setPgHost(bundledPg.host);
      setPgPort(bundledPg.port);
      setPgDb(bundledPg.database);
      setPgUser(bundledPg.user);
    }
  }, [bundledPg]);

  // Pre-fill owner fields when existing owner is detected
  useEffect(() => {
    if (existingOwner && !emOwnerUsername && !emOwnerEmail) {
      setEmOwnerUsername(existingOwner.username);
      setEmOwnerEmail(existingOwner.email);
    }
  }, [existingOwner]);

  // Auto-navigate to current provisioning step
  useEffect(() => {
    if (isProvisioning && setupProgress) {
      const current = PROVISION_TABS[setupProgress.currentStep];
      if (current) setTab(current.id);
    }
  }, [setupProgress]);

  // Normal mode: load section data when tab changes
  useEffect(() => {
    if (!isProvisioning && tab === 'backups') {
      loadBackups();
    } else if (!isProvisioning && tab === 'system') {
      loadSystemInfo();
      handleLoadSection('server');
    } else if (!isProvisioning && tab !== 'backups') {
      handleLoadSection(tab);
    }
  }, [tab, isProvisioning]);

  // Auto-scroll migration logs
  useEffect(() => {
    logRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [setupMigrationLogs, adminMigrationLogs]);


  // --- Normal mode helpers ---
  const handleLoadSection = async (section) => {
    if (section === 'sso') {
      const ssoData = await loadAdminConfigSection('sso');
      const scimData = await loadAdminConfigSection('scim');
      setEditValues({ ...ssoData, ...scimData });
    } else {
      const data = await loadAdminConfigSection(section);
      if (data) setEditValues(data);
    }
    setTestResult(null);
    setSaveResult(null);
  };

  const handleFieldChange = (key, value) => {
    setEditValues(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async (overrideSection) => {
    setSaveResult(null);
    const section = overrideSection || (tab === 'system' ? 'server' : tab);
    const result = await updateAdminConfig(section, editValues);
    if (result?.success) {
      setSaveResult({ type: 'success', message: `Saved. Changed: ${result.changedKeys?.join(', ') || 'none'}` });
    } else {
      setSaveResult({ type: 'error', message: result?.error || 'Failed to save' });
    }
  };

  const handleTestDb = async () => {
    setTestResult(null);
    const result = await testAdminConnection('database', editValues);
    setTestResult(result);
  };




  const handleRotate = async (keyType) => {
    setConfirmRotate(null);
    setRotateResult(null);
    const result = await rotateAdminKey(keyType);
    setRotateResult(result);
  };

  // --- Provisioning helpers ---
  const stepIndex = useCallback((id) => PROVISION_TABS.findIndex(t => t.id === id), []);
  const isStepDone = useCallback((id) => {
    if (!setupProgress) return false;
    const s = setupProgress.steps.find(s => s.id === id);
    return s?.done || false;
  }, [setupProgress]);
  const isStepAccessible = useCallback((id) => {
    const idx = stepIndex(id);
    if (idx === 0) return true;
    const prev = PROVISION_TABS[idx - 1];
    return isStepDone(prev.id);
  }, [stepIndex, isStepDone]);

  const handleProvisionTestDb = async () => {
    setDbTestResult(null);
    const config = { host: pgHost, port: pgPort, database: pgDb, user: pgUser, password: pgPass };
    if (bundledPg?.detected) {
      const result = await provisionDatabase(config);
      setDbTestResult(result);
      if (result?.success) {
        setTimeout(() => setTab('security'), 800);
      }
    } else {
      const result = await testSetupDatabase(config);
      setDbTestResult(result);
      if (result?.success) {
        setTimeout(() => setTab('security'), 800);
      }
    }
  };



  const handleSaveAndMigrate = async () => {
    const config = {
      POSTGRES_HOST: pgHost, POSTGRES_PORT: pgPort, POSTGRES_DB: pgDb,
      POSTGRES_USER: pgUser, POSTGRES_PASSWORD: pgPass,
      DISABLE_REDIS: 'true',
      JWT_SECRET: jwtSecret,
      CREDENTIALS_ENCRYPTION_KEY: encKey,
      JWT_EXPIRY: jwtExpiry,
      NODE_ENV: 'production',
      PORT: '3001',
      CORS_ORIGINS: window.location.origin,
      FRONTEND_URL: window.location.origin,
    };
    await saveSetupConfig(config);
    setTab('migrations');
    await runSetupMigrations();
    fetchSetupProgress();
  };

  const handleCreateOwner = async () => {
    if (ownerPassword !== ownerConfirm) {
      setOwnerResult({ error: 'Passwords do not match' });
      return;
    }
    const result = await createSetupOwner({
      username: ownerUsername,
      email: ownerEmail,
      password: ownerPassword,
      displayName: ownerUsername,
    });
    setOwnerResult(result);
    if (result?.success) {
      await completeSetup();
      await downloadRecoveryKey();
      setSetupComplete(true);
      fetchSetupProgress();
    }
  };

  const handleFinishSetup = () => {
    signOut();
    navigate('/');
  };

  const handleEmergencyCreateOwner = async () => {
    if (emOwnerPassword !== emOwnerConfirm) {
      setEmOwnerResult({ error: 'Passwords do not match' });
      return;
    }
    const result = await emergencyCreateOwner({
      username: emOwnerUsername,
      email: emOwnerEmail,
      password: emOwnerPassword,
      displayName: emOwnerUsername,
    });
    setEmOwnerResult(result);
    if (result?.success) setEmOwnerComplete(true);
  };

  const handleRotatePgPassword = async () => {
    setPgPassResult(null);
    if (pgNewPass !== pgNewPassConfirm) {
      setPgPassResult({ error: 'New passwords do not match' });
      return;
    }
    const result = await rotatePgPassword(pgCurrentPass, pgNewPass);
    setPgPassResult(result);
    if (result?.success) {
      setPgCurrentPass('');
      setPgNewPass('');
      setPgNewPassConfirm('');
    }
  };

  const handleSetupRestore = async () => {
    if (!restoreBackupFile || !restoreKeyFile) return;
    setRestoreResult(null);
    const result = await restoreFromBackup(restoreBackupFile, restoreKeyFile);
    setRestoreResult(result);
    if (result?.success) {
      setSetupComplete(true);
    }
  };

  const canNextDb = pgHost && pgDb && pgUser && pgPass;
  const canNextOwner = ownerUsername && ownerEmail && ownerPassword && ownerPassword.length >= 8 && ownerPassword === ownerConfirm;

  const formatUptime = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  };
  const formatBytes = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <div className="admin-header-content">
          <div>
            <h1>{isProvisioning ? 'Initial Setup' : emergencyMode ? 'Emergency Administration' : 'Administration'}</h1>
            <p>{isProvisioning ? 'Configure your Simply Analytics deployment' : emergencyMode ? (dbIsReachable ? 'Authenticated via recovery key. Manage your owner account below.' : 'Database may be unreachable. Only configuration changes are available.') : 'Server configuration and management'}</p>
          </div>
        </div>
      </header>

      {emergencyMode && !emergencyDbStatus && (
        <div className="admin-emergency-banner info">
          <FiLoader className="spinner" />
          <div>Checking database status...</div>
        </div>
      )}
      {emergencyMode && emergencyDbStatus && (
        <div className={`admin-emergency-banner${dbIsReachable ? ' info' : ''}`}>
          {dbIsReachable ? <FiDatabase /> : <FiAlertTriangle />}
          <div>
            {dbIsEmpty ? (
              <><strong>No Users Found</strong> — The database is reachable but empty. Create an owner account below, then sign out and sign in normally.</>
            ) : dbIsReachable ? (
              <><strong>Owner Recovery</strong> — The database is reachable. You can reset the owner account credentials below, then sign out and sign in normally.</>
            ) : (
              <><strong>Emergency Mode</strong> — You are authenticated via recovery key because the database is unreachable. Update your database credentials below, then sign out and back in normally.</>
            )}
          </div>
        </div>
      )}

      {/* Setup mode chooser (provisioning only, before wizard) */}
      {isProvisioning && !setupMode && !setupComplete && (
        <div className="admin-setup-chooser">
          <div className="admin-setup-card" onClick={() => setSetupMode('fresh')}>
            <FiDatabase style={{ fontSize: 32, marginBottom: 8 }} />
            <h3>Fresh Setup</h3>
            <p>Set up a new Simply Analytics instance from scratch.</p>
          </div>
          <div className="admin-setup-card" onClick={() => setSetupMode('restore')}>
            <FiUpload style={{ fontSize: 32, marginBottom: 8 }} />
            <h3>Restore from Backup</h3>
            <p>Restore from an existing environment's backup.</p>
          </div>
        </div>
      )}

      {/* Restore from Backup (provisioning) */}
      {isProvisioning && setupMode === 'restore' && !setupComplete && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiUpload /> Restore from Backup</h2>
              <p>Upload a backup archive and the recovery key file from your previous environment.</p>
            </div>
          </div>
          <div className="admin-section-card">
            <div className="admin-field">
              <label>Backup Archive (.tar.gz)</label>
              <input type="file" accept=".tar.gz,.gz" onChange={e => setRestoreBackupFile(e.target.files[0])} />
            </div>
            <div className="admin-field">
              <label>Recovery Key File (.key)</label>
              <input type="file" accept=".key" onChange={e => setRestoreKeyFile(e.target.files[0])} />
            </div>
            {restoreResult?.error && <div className="admin-result error"><FiAlertTriangle /> {restoreResult.error}</div>}
            <div className="admin-btn-row">
              <button className="admin-btn admin-btn-secondary" onClick={() => setSetupMode(null)}><FiArrowLeft /> Back</button>
              <button className="admin-btn admin-btn-primary" disabled={!restoreBackupFile || !restoreKeyFile || setupLoading} onClick={handleSetupRestore}>
                {setupLoading ? <><FiLoader className="spinner" /> Restoring...</> : <><FiUpload /> Restore</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Provisioning stepper */}
      {isProvisioning && setupMode === 'fresh' && setupProgress && !setupComplete && (
        <div className="provisioning-stepper">
          {PROVISION_TABS.map((s, i) => {
            const done = isStepDone(s.id);
            const active = tab === s.id;
            const accessible = isStepAccessible(s.id);
            return (
              <React.Fragment key={s.id}>
                {i > 0 && <div className={`provisioning-step-connector ${isStepDone(PROVISION_TABS[i - 1].id) ? 'done' : ''}`} />}
                <div
                  className={`provisioning-step ${done ? 'done' : ''} ${active ? 'active' : ''} ${accessible ? 'clickable' : ''}`}
                  onClick={() => accessible && setTab(s.id)}
                >
                  <div className="provisioning-step-dot">
                    {done ? '\u2713' : i + 1}
                  </div>
                  <span>{s.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Tabs (normal mode — also shown in emergency when DB is reachable for config access) */}
      {!isProvisioning && !(emergencyMode && !dbIsReachable) && !emOwnerComplete && (
        <div className="admin-tabs">
          {NORMAL_TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                className={`admin-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <Icon /> {t.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="admin-content">

      {/* ===================== EMERGENCY OWNER MANAGEMENT ===================== */}
      {emergencyMode && dbIsReachable && !emOwnerComplete && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiUser /> {existingOwner ? 'Reset Owner Account' : 'Create Owner Account'}</h2>
              <p>{existingOwner
                ? `Current owner: ${existingOwner.username} (${existingOwner.email}). Update the credentials below to regain access.`
                : 'The database has no users. Create the initial owner account to get started.'}</p>
            </div>
          </div>
          <div className="admin-section-card">
            <div className="admin-field"><label>Username</label><input value={emOwnerUsername} onChange={e => setEmOwnerUsername(e.target.value)} placeholder={existingOwner?.username || ''} /></div>
            <div className="admin-field"><label>Email</label><input type="email" value={emOwnerEmail} onChange={e => setEmOwnerEmail(e.target.value)} placeholder={existingOwner?.email || ''} /></div>
            <div className="admin-field-row">
              <div className="admin-field"><label>{existingOwner ? 'New Password' : 'Password'}</label><input type="password" value={emOwnerPassword} onChange={e => setEmOwnerPassword(e.target.value)} /></div>
              <div className="admin-field"><label>Confirm Password</label><input type="password" value={emOwnerConfirm} onChange={e => setEmOwnerConfirm(e.target.value)} /></div>
            </div>

            {emOwnerPassword && emOwnerPassword.length < 8 && <div className="admin-result error">Password must be at least 8 characters</div>}
            {emOwnerConfirm && emOwnerPassword !== emOwnerConfirm && <div className="admin-result error">Passwords do not match</div>}
            {emOwnerResult?.error && <div className="admin-result error">{emOwnerResult.error}</div>}

            <div className="admin-btn-row">
              <div />
              <button className="admin-btn admin-btn-primary" disabled={!canCreateEmOwner || adminLoading} onClick={handleEmergencyCreateOwner}>
                {adminLoading ? <><FiLoader className="spinner" /> Saving...</> : <><FiCheck /> {existingOwner ? 'Reset Owner Account' : 'Create Owner Account'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {emergencyMode && emOwnerComplete && (
        <div className="admin-section-wrapper">
          <div className="admin-section-card">
            <div className="provisioning-complete-card">
              <div className="provisioning-complete-icon"><FiCheck /></div>
              <h2>{emOwnerResult?.action === 'reset' ? 'Owner Account Reset' : 'Owner Account Created'}</h2>
              <p>Sign out and log in with your {emOwnerResult?.action === 'reset' ? 'updated' : 'new'} owner credentials.</p>
              <button className="admin-btn admin-btn-success" onClick={handleFinishSetup}>
                Sign Out & Sign In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== SETUP COMPLETE CARD ===================== */}
      {setupComplete && (
        <div className="admin-section-wrapper">
          <div className="admin-section-card">
            <div className="provisioning-complete-card">
              <div className="provisioning-complete-icon"><FiCheck /></div>
              <h2>Setup Complete</h2>
              <p>Your Simply Analytics instance is ready. You'll be signed out so you can log in with your new owner account.</p>
              <button className="admin-btn admin-btn-success" onClick={handleFinishSetup}>
                Sign In as Owner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== DATABASE TAB ===================== */}
      {tab === 'database' && !setupComplete && setupMode === 'fresh' && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiDatabase /> Database Connection</h2>
              <p>{isProvisioning ? 'Configure your PostgreSQL connection.' : 'PostgreSQL metadata backend'}</p>
            </div>
          </div>
          <div className="admin-section-card">

          {isProvisioning ? (
            <>
              {bundledPg?.detected ? (
                <>
                  <div className="admin-result success" style={{ marginBottom: 12 }}>
                    <FiCheck /> Bundled PostgreSQL detected. Set the database credentials the server will use to connect.
                  </div>
                  <div className="admin-field-row">
                    <div className="admin-field"><label>Host</label><input value={pgHost} readOnly className="admin-input-readonly" /></div>
                    <div className="admin-field"><label>Port</label><input value={pgPort} readOnly className="admin-input-readonly" /></div>
                  </div>
                  <div className="admin-field"><label>Database</label><input value={pgDb} readOnly className="admin-input-readonly" /></div>
                  <span className="admin-field-hint">Host, port, and database are managed by Docker and cannot be changed here.</span>
                  <div className="admin-field-row">
                    <div className="admin-field"><label>Database Username</label><input value={pgUser} onChange={e => setPgUser(e.target.value)} placeholder="e.g. simply" /></div>
                    <div className="admin-field"><label>Database Password</label><input type="password" value={pgPass} onChange={e => setPgPass(e.target.value)} placeholder="Choose a secure password" /></div>
                  </div>
                  <span className="admin-field-hint">These are PostgreSQL credentials — not your application login. Your app login is created in a later step.</span>
                  {pgPass && pgPass.length < 8 && <div className="admin-result error"><FiAlertTriangle /> Password must be at least 8 characters</div>}
                </>
              ) : (
                <>
                  <div className="admin-field-row">
                    <div className="admin-field"><label>Host</label><input value={pgHost} onChange={e => setPgHost(e.target.value)} /></div>
                    <div className="admin-field"><label>Port</label><input value={pgPort} onChange={e => setPgPort(e.target.value)} /></div>
                  </div>
                  <div className="admin-field"><label>Database</label><input value={pgDb} onChange={e => setPgDb(e.target.value)} /></div>
                  <div className="admin-field-row">
                    <div className="admin-field"><label>Username</label><input value={pgUser} onChange={e => setPgUser(e.target.value)} /></div>
                    <div className="admin-field"><label>Password</label><input type="password" value={pgPass} onChange={e => setPgPass(e.target.value)} /></div>
                  </div>
                </>
              )}

              <div className="admin-btn-row">
                <button className="admin-btn admin-btn-primary" onClick={handleProvisionTestDb} disabled={setupLoading || !canNextDb || (pgPass && pgPass.length < 8)}>
                  {setupLoading ? <><FiLoader className="spinner" /> {bundledPg?.detected ? 'Provisioning...' : 'Testing...'}</> : <><FiCheck /> {bundledPg?.detected ? 'Save & Continue' : 'Test Connection'}</>}
                </button>
              </div>
              {dbTestResult && (
                <div className={`admin-result ${dbTestResult.success ? 'success' : 'error'}`}>
                  {dbTestResult.success ? <FiCheck /> : <FiAlertTriangle />}{dbTestResult.message}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="admin-field-row">
                <div className="admin-field"><label>Host</label><input value={editValues.POSTGRES_HOST || ''} readOnly className="admin-input-readonly" /></div>
                <div className="admin-field"><label>Port</label><input value={editValues.POSTGRES_PORT || ''} readOnly className="admin-input-readonly" /></div>
              </div>
              <div className="admin-field"><label>Database</label><input value={editValues.POSTGRES_DB || ''} readOnly className="admin-input-readonly" /></div>
              <div className="admin-field-row">
                <div className="admin-field"><label>Username</label><input value={editValues.POSTGRES_USER || ''} onChange={e => handleFieldChange('POSTGRES_USER', e.target.value)} /></div>
                <div className="admin-field"><label>Password</label><input type="password" value={editValues.POSTGRES_PASSWORD || ''} onChange={e => handleFieldChange('POSTGRES_PASSWORD', e.target.value)} /></div>
              </div>
              <div className="admin-btn-row">
                <button className="admin-btn admin-btn-secondary" onClick={handleTestDb} disabled={adminLoading}><FiRefreshCw /> Test Connection</button>
                <button className="admin-btn admin-btn-primary" onClick={handleSave} disabled={adminLoading}><FiSave /> Save Changes</button>
              </div>
              {testResult && <div className={`admin-result ${testResult.success ? 'success' : 'error'}`}>{testResult.success ? <FiCheck /> : <FiAlertTriangle />}{testResult.message}</div>}
              {saveResult && <div className={`admin-result ${saveResult.type}`}>{saveResult.type === 'success' ? <FiCheck /> : <FiAlertTriangle />}{saveResult.message}</div>}

              <div className="admin-divider" />
              <div className="admin-subsection-title"><FiRefreshCw /> Schema Updates</div>
              <div className="admin-subsection-subtitle">Run schema migrations to apply any pending database updates.</div>
              <button className="admin-btn admin-btn-primary" onClick={runAdminMigrations} disabled={adminLoading}>
                {adminLoading ? <><FiLoader className="spinner" /> Running...</> : <><FiPlay /> Run Schema Migrations</>}
              </button>
              {adminMigrationLogs.length > 0 && (
                <div className="admin-migration-log">
                  {adminMigrationLogs.map((line, i) => <div key={i} className="log-line">{line}</div>)}
                  <div ref={logRef} />
                </div>
              )}
              {adminMigrationResult && (
                <div className={`admin-result ${adminMigrationResult.success ? 'success' : 'error'}`}>
                  {adminMigrationResult.success ? <><FiCheck /> Schema is up to date</> : <><FiAlertTriangle /> Errors: {adminMigrationResult.errors?.join(', ')}</>}
                </div>
              )}

              <div className="admin-divider" />
              <div className="admin-subsection-title"><FiKey /> Change Database Password</div>
              <div className="admin-subsection-subtitle">Update the PostgreSQL password used by the application.</div>
              <div className="admin-field"><label>Current Password</label><input type="password" value={pgCurrentPass} onChange={e => setPgCurrentPass(e.target.value)} /></div>
              <div className="admin-field-row">
                <div className="admin-field"><label>New Password</label><input type="password" value={pgNewPass} onChange={e => setPgNewPass(e.target.value)} /></div>
                <div className="admin-field"><label>Confirm New Password</label><input type="password" value={pgNewPassConfirm} onChange={e => setPgNewPassConfirm(e.target.value)} /></div>
              </div>
              {pgNewPass && pgNewPassConfirm && pgNewPass !== pgNewPassConfirm && <div className="admin-result error">Passwords do not match</div>}
              <button className="admin-btn admin-btn-primary" disabled={!pgCurrentPass || !pgNewPass || pgNewPass !== pgNewPassConfirm || adminLoading} onClick={handleRotatePgPassword}>
                <FiRefreshCw /> Update Password
              </button>
              {pgPassResult && (
                <div className={`admin-result ${pgPassResult.success ? 'success' : 'error'}`}>
                  {pgPassResult.success ? <><FiCheck /> {pgPassResult.message}</> : <><FiAlertTriangle /> {pgPassResult.error}</>}
                </div>
              )}
            </>
          )}
          </div>
        </div>
      )}

      {/* ===================== DATABASE TAB (normal mode) ===================== */}
      {tab === 'database' && !isProvisioning && (
        <>
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiKey /> Database Credentials</h2>
              <p>Update the PostgreSQL credentials used by the application</p>
            </div>
          </div>
          <div className="admin-section-card">
            <div className="admin-field"><label>Current Password</label><input type="password" value={pgCurrentPass} onChange={e => setPgCurrentPass(e.target.value)} /></div>
            <div className="admin-field-row">
              <div className="admin-field"><label>New Password</label><input type="password" value={pgNewPass} onChange={e => setPgNewPass(e.target.value)} /></div>
              <div className="admin-field"><label>Confirm New Password</label><input type="password" value={pgNewPassConfirm} onChange={e => setPgNewPassConfirm(e.target.value)} /></div>
            </div>
            {pgNewPass && pgNewPassConfirm && pgNewPass !== pgNewPassConfirm && <div className="admin-result error">Passwords do not match</div>}
            <div className="admin-btn-row">
              <button className="admin-btn admin-btn-secondary" onClick={handleTestDb} disabled={adminLoading}><FiRefreshCw /> Test Connection</button>
              <button className="admin-btn admin-btn-primary" disabled={!pgCurrentPass || !pgNewPass || pgNewPass !== pgNewPassConfirm || adminLoading} onClick={handleRotatePgPassword}>
                <FiRefreshCw /> Update Password
              </button>
            </div>
            {testResult && <div className={`admin-result ${testResult.success ? 'success' : 'error'}`}>{testResult.success ? <FiCheck /> : <FiAlertTriangle />}{testResult.message}</div>}
            {pgPassResult && (
              <div className={`admin-result ${pgPassResult.success ? 'success' : 'error'}`}>
                {pgPassResult.success ? <><FiCheck /> {pgPassResult.message}</> : <><FiAlertTriangle /> {pgPassResult.error}</>}
              </div>
            )}
          </div>
        </div>

        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiRefreshCw /> Schema Updates</h2>
              <p>Apply pending database migrations</p>
            </div>
          </div>
          <div className="admin-section-card">
            <button className="admin-btn admin-btn-primary" onClick={runAdminMigrations} disabled={adminLoading}>
              {adminLoading ? <><FiLoader className="spinner" /> Running...</> : <><FiPlay /> Run Schema Migrations</>}
            </button>
            {adminMigrationLogs.length > 0 && (
              <div className="admin-migration-log">
                {adminMigrationLogs.map((line, i) => <div key={i} className="log-line">{line}</div>)}
                <div ref={logRef} />
              </div>
            )}
            {adminMigrationResult && (
              <div className={`admin-result ${adminMigrationResult.success ? 'success' : 'error'}`}>
                {adminMigrationResult.success ? <><FiCheck /> Schema is up to date</> : <><FiAlertTriangle /> Errors: {adminMigrationResult.errors?.join(', ')}</>}
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {/* ===================== BACKUPS & MIGRATION TAB ===================== */}
      {tab === 'backups' && !isProvisioning && (
        <>
          <div className="admin-section-wrapper">
            <div className="admin-section-header">
              <div>
                <h2><FiHardDrive /> Automated Backups</h2>
                <p>
                  {backupStats
                    ? `Last backup: ${backupStats.lastBackupAt ? new Date(backupStats.lastBackupAt).toLocaleString() : 'never'} | ${backupStats.count} backup(s) stored (${backupStats.totalSizeMB} MB)`
                    : 'Loading backup status...'}
                </p>
              </div>
              <button className="admin-btn admin-btn-primary" onClick={triggerBackup} disabled={backupLoading}>
                {backupLoading ? <><FiLoader className="spinner" /> Working...</> : <><FiHardDrive /> Back Up Now</>}
              </button>
            </div>
            <div className="admin-section-card">
              {backups.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>No backups yet. Click "Back Up Now" to create one.</p>
              ) : (
                <table className="admin-backup-table">
                  <thead>
                    <tr><th>Date</th><th>Size</th><th>App Version</th><th>Schema</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {backups.map(b => (
                      <tr key={b.id}>
                        <td>{new Date(b.createdAt).toLocaleString()}</td>
                        <td>{(b.size / 1024 / 1024).toFixed(1)} MB</td>
                        <td>{b.appVersion}</td>
                        <td>v{b.schemaVersion}</td>
                        <td>
                          <button className="admin-btn admin-btn-sm" onClick={() => downloadBackup(b.id, b.filename)}><FiDownload /></button>
                          <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => removeBackup(b.id)}><FiTrash2 /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="admin-divider" />
              <div className="admin-subsection-title"><FiUpload /> Restore from Backup</div>
              <div className="admin-subsection-subtitle">Upload a backup archive and the recovery key file to restore.</div>
              <div className="admin-field-row">
                <div className="admin-field">
                  <label>Backup Archive (.tar.gz)</label>
                  <input type="file" accept=".tar.gz,.gz" onChange={e => setAdminRestoreFile(e.target.files[0])} />
                </div>
                <div className="admin-field">
                  <label>Recovery Key File (.key)</label>
                  <input type="file" accept=".key" onChange={e => setAdminRestoreKeyFile(e.target.files[0])} />
                </div>
              </div>
              <button className="admin-btn admin-btn-danger" disabled={!adminRestoreFile || !adminRestoreKeyFile || adminLoading}
                onClick={async () => {
                  const result = await adminRestoreBackup(adminRestoreFile, adminRestoreKeyFile);
                  if (result?.success) alert('Backup restored successfully. The app will reload.');
                  else alert(result?.error || 'Restore failed');
                }}>
                <FiUpload /> Restore
              </button>
            </div>
          </div>

          <div className="admin-section-wrapper">
            <div className="admin-section-header">
              <div>
                <h2><FiGlobe /> Migrate to a New Environment</h2>
                <p>Move your entire Simply Analytics instance to a different cloud, region, or server.</p>
              </div>
            </div>
            <div className="admin-section-card">
              <div className="admin-migration-steps">
                <div className="admin-migration-step">
                  <div className="admin-step-number">1</div>
                  <div>
                    <h4>Create Migration Package</h4>
                    <p>Create a fresh backup and download it along with your recovery key.</p>
                    <div className="admin-btn-row" style={{ marginTop: 8 }}>
                      <button className="admin-btn admin-btn-primary" onClick={async () => { await triggerBackup(); }} disabled={backupLoading}>
                        <FiHardDrive /> Back Up Now
                      </button>
                      <button className="admin-btn admin-btn-secondary" onClick={adminDownloadRecoveryKey}>
                        <FiDownload /> Download Recovery Key
                      </button>
                    </div>
                    <span className="admin-field-hint">You will need both files to restore on the new server.</span>
                  </div>
                </div>
                <div className="admin-migration-step">
                  <div className="admin-step-number">2</div>
                  <div>
                    <h4>Deploy New Environment</h4>
                    <p>Run <code>docker-compose up</code> on your new server. Open the app — you'll see the setup wizard.</p>
                  </div>
                </div>
                <div className="admin-migration-step">
                  <div className="admin-step-number">3</div>
                  <div>
                    <h4>Restore on New Server</h4>
                    <p>In the setup wizard, choose "Restore from Backup", upload both files. Your new instance will be fully restored with a new recovery key.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===================== SECURITY TAB ===================== */}
      {tab === 'security' && !setupComplete && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiLock /> Security Keys</h2>
              <p>{isProvisioning ? 'Cryptographic keys have been auto-generated. You can regenerate them if needed.' : 'JWT signing and credential encryption'}</p>
            </div>
          </div>
          <div className="admin-section-card">

          {isProvisioning ? (
            <>
              <div className="admin-field">
                <label>JWT Signing Secret</label>
                <div className="admin-field-row">
                  <input value={jwtSecret} readOnly style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
                  <button className="admin-btn admin-btn-secondary" onClick={() => setJwtSecret(generateHex(64))} style={{ whiteSpace: 'nowrap' }}>Regenerate</button>
                </div>
              </div>
              <div className="admin-field">
                <label>Credential Encryption Key (AES-256)</label>
                <div className="admin-field-row">
                  <input value={encKey} readOnly style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
                  <button className="admin-btn admin-btn-secondary" onClick={() => setEncKey(generateHex(32))} style={{ whiteSpace: 'nowrap' }}>Regenerate</button>
                </div>
              </div>
              <div className="admin-field">
                <label>JWT Token Expiry</label>
                <select value={jwtExpiry} onChange={e => setJwtExpiry(e.target.value)}>
                  <option value="1h">1 hour</option>
                  <option value="4h">4 hours</option>
                  <option value="8h">8 hours</option>
                  <option value="24h">24 hours</option>
                </select>
              </div>
              <div className="admin-btn-row">
                <button className="admin-btn admin-btn-secondary" onClick={() => setTab('database')}><FiArrowLeft /> Back</button>
                <button className="admin-btn admin-btn-primary" onClick={handleSaveAndMigrate} disabled={setupLoading}>
                  {setupLoading ? <><FiLoader className="spinner" /> Saving...</> : <><FiSave /> Save & Run Migrations</>}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="admin-field">
                <label>JWT Expiry</label>
                <select value={editValues.JWT_EXPIRY || '8h'} onChange={e => handleFieldChange('JWT_EXPIRY', e.target.value)}>
                  <option value="1h">1 hour</option>
                  <option value="4h">4 hours</option>
                  <option value="8h">8 hours</option>
                  <option value="24h">24 hours</option>
                </select>
              </div>
              <div className="admin-field"><label>Session Timeout (minutes, inactivity)</label><input value={editValues.SESSION_TIMEOUT_MINUTES || '20'} onChange={e => handleFieldChange('SESSION_TIMEOUT_MINUTES', e.target.value)} placeholder="20" /></div>
              <div className="admin-divider" />
              <div className="admin-subsection-title"><FiKey /> Key Management</div>
              <div className="admin-btn-row">
                <button className="admin-btn admin-btn-secondary" onClick={adminDownloadRecoveryKey}>
                  <FiDownload /> Download Recovery Key
                </button>
              </div>
              <div className="admin-btn-row" style={{ marginTop: 8 }}>
                <button className="admin-btn admin-btn-danger" onClick={() => setConfirmRotate('jwt')}><FiRefreshCw /> Rotate JWT Secret</button>
                <button className="admin-btn admin-btn-danger" onClick={() => setConfirmRotate('encryption')}><FiRefreshCw /> Rotate Encryption Key</button>
                <button className="admin-btn admin-btn-danger" onClick={() => setConfirmRotate('recovery')}><FiRefreshCw /> Rotate Recovery Key</button>
              </div>
              {rotateResult && <div className={`admin-result ${rotateResult.success ? 'success' : 'error'}`}>{rotateResult.success ? <FiCheck /> : <FiAlertTriangle />}{rotateResult.message || rotateResult.error}</div>}
            </>
          )}
          </div>
        </div>
      )}

      {tab === 'security' && !setupComplete && !isProvisioning && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiShield /> Password Policy</h2>
              <p>Default rules for all non-SSO password creation and changes</p>
            </div>
          </div>
          <div className="admin-section-card">
            <div className="admin-policy-grid">
              <div className="admin-policy-field">
                <label>Minimum Length</label>
                <div className="admin-length-input">
                  <input
                    type="number"
                    min={8}
                    max={128}
                    value={editValues.PASSWORD_MIN_LENGTH || '14'}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      handleFieldChange('PASSWORD_MIN_LENGTH', String(isNaN(v) ? 14 : Math.max(8, v)));
                    }}
                  />
                  <span className="admin-length-suffix">characters</span>
                </div>
                <span className="admin-field-hint">Cannot be less than 8</span>
              </div>
              <div className="admin-policy-field">
                <label>Character Requirements</label>
                <div className="admin-toggle-list">
                  <label className="admin-toggle-row">
                    <span>Uppercase letter (A–Z)</span>
                    <input type="checkbox" className="admin-toggle" checked={editValues.PASSWORD_REQUIRE_UPPERCASE !== 'false'} onChange={e => handleFieldChange('PASSWORD_REQUIRE_UPPERCASE', e.target.checked ? 'true' : 'false')} />
                  </label>
                  <label className="admin-toggle-row">
                    <span>Lowercase letter (a–z)</span>
                    <input type="checkbox" className="admin-toggle" checked={editValues.PASSWORD_REQUIRE_LOWERCASE !== 'false'} onChange={e => handleFieldChange('PASSWORD_REQUIRE_LOWERCASE', e.target.checked ? 'true' : 'false')} />
                  </label>
                  <label className="admin-toggle-row">
                    <span>Number (0–9)</span>
                    <input type="checkbox" className="admin-toggle" checked={editValues.PASSWORD_REQUIRE_NUMBER !== 'false'} onChange={e => handleFieldChange('PASSWORD_REQUIRE_NUMBER', e.target.checked ? 'true' : 'false')} />
                  </label>
                  <label className="admin-toggle-row">
                    <span>Special character (!@#$...)</span>
                    <input type="checkbox" className="admin-toggle" checked={editValues.PASSWORD_REQUIRE_SPECIAL !== 'false'} onChange={e => handleFieldChange('PASSWORD_REQUIRE_SPECIAL', e.target.checked ? 'true' : 'false')} />
                  </label>
                </div>
              </div>
            </div>
            <div className="admin-btn-row">
              <button className="admin-btn admin-btn-primary" onClick={handleSave} disabled={adminLoading}><FiSave /> Save Changes</button>
            </div>
            {saveResult && <div className={`admin-result ${saveResult.type}`}>{saveResult.type === 'success' ? <FiCheck /> : <FiAlertTriangle />}{saveResult.message}</div>}
          </div>
        </div>
      )}

      {/* ===================== RATE LIMITING (normal mode security) ===================== */}
      {tab === 'security' && !isProvisioning && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiShield /> Rate Limiting</h2>
              <p>Control the maximum number of API requests per client</p>
            </div>
          </div>
          <div className="admin-section-card">
            <div className="admin-field">
              <label>Rate Limit (requests / 15 min)</label>
              <input type="number" value={editValues.RATE_LIMIT_MAX || '1000'} onChange={e => handleFieldChange('RATE_LIMIT_MAX', e.target.value)} />
              <span className="admin-field-hint">Maximum number of API requests allowed per IP address in a 15-minute window.</span>
            </div>
            <div className="admin-btn-row"><button className="admin-btn admin-btn-primary" onClick={handleSave} disabled={adminLoading}><FiSave /> Save Changes</button></div>
            {saveResult && <div className={`admin-result ${saveResult.type}`}>{saveResult.type === 'success' ? <FiCheck /> : <FiAlertTriangle />}{saveResult.message}</div>}
          </div>
        </div>
      )}


      {/* ===================== MIGRATIONS STEP (provisioning only) ===================== */}
      {tab === 'migrations' && isProvisioning && !setupComplete && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiPlay /> Running Migrations</h2>
              <p>Creating database schema and tables...</p>
            </div>
          </div>
          <div className="admin-section-card">

          {setupMigrationLogs.length > 0 && (
            <div className="admin-migration-log">
              {setupMigrationLogs.map((line, i) => <div key={i} className="log-line">{line}</div>)}
              <div ref={logRef} />
            </div>
          )}
          {setupMigrationResult && (
            <div className={`admin-result ${setupMigrationResult.success ? 'success' : 'error'}`}>
              {setupMigrationResult.success ? 'Migrations completed successfully' : `Migration errors: ${setupMigrationResult.errors?.join(', ')}`}
            </div>
          )}
          <div className="admin-btn-row">
            <div />
            <button className="admin-btn admin-btn-primary" disabled={!setupMigrationResult?.success} onClick={() => setTab('owner')}>
              Next <FiArrowRight />
            </button>
          </div>
          </div>
        </div>
      )}

      {/* ===================== CREATE OWNER TAB (provisioning only) ===================== */}
      {tab === 'owner' && isProvisioning && !setupComplete && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiUser /> Create Owner Account</h2>
              <p>This will be the system owner with full admin access. After creation, the bootstrap admin (admin/admin123) will be permanently disabled.</p>
            </div>
          </div>
          <div className="admin-section-card">

          <div className="admin-field"><label>Username</label><input value={ownerUsername} onChange={e => setOwnerUsername(e.target.value)} /></div>
          <div className="admin-field"><label>Email</label><input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} /></div>
          <div className="admin-field-row">
            <div className="admin-field"><label>Password</label><input type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} /></div>
            <div className="admin-field"><label>Confirm Password</label><input type="password" value={ownerConfirm} onChange={e => setOwnerConfirm(e.target.value)} /></div>
          </div>

          {ownerPassword && ownerPassword.length < 8 && <div className="admin-result error">Password must be at least 8 characters</div>}
          {ownerConfirm && ownerPassword !== ownerConfirm && <div className="admin-result error">Passwords do not match</div>}
          {ownerResult?.error && <div className="admin-result error">{ownerResult.error}</div>}

          <div className="admin-btn-row">
            <button className="admin-btn admin-btn-secondary" onClick={() => setTab('migrations')}><FiArrowLeft /> Back</button>
            <button className="admin-btn admin-btn-primary" disabled={!canNextOwner || setupLoading} onClick={handleCreateOwner}>
              {setupLoading ? <><FiLoader className="spinner" /> Creating...</> : <><FiCheck /> Create Account & Finish</>}
            </button>
          </div>
          </div>
        </div>
      )}

      {/* ===================== SSO & PROVISIONING TAB (normal only) ===================== */}
      {tab === 'sso' && !isProvisioning && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiGlobe /> SSO / SAML Configuration</h2>
              <p>Single sign-on via SAML 2.0</p>
            </div>
          </div>
          <div className="admin-section-card">
            <div className="admin-toggle-wrapper"><label>Enable SSO</label><input type="checkbox" className="admin-toggle" checked={editValues.SSO_ENABLED === 'true'} onChange={e => handleFieldChange('SSO_ENABLED', e.target.checked ? 'true' : 'false')} /></div>
            <div className="admin-field"><label>SAML Entrypoint URL</label><input value={editValues.SAML_ENTRYPOINT || ''} onChange={e => handleFieldChange('SAML_ENTRYPOINT', e.target.value)} placeholder="https://your-idp.example.com/sso/saml" /></div>
            <div className="admin-field"><label>SAML Issuer</label><input value={editValues.SAML_ISSUER || ''} onChange={e => handleFieldChange('SAML_ISSUER', e.target.value)} /></div>
            <div className="admin-field"><label>SAML Certificate (PEM)</label><input value={editValues.SAML_CERT || ''} onChange={e => handleFieldChange('SAML_CERT', e.target.value)} /></div>
            <div className="admin-field"><label>SAML Callback URL</label><input value={editValues.SAML_CALLBACK_URL || ''} onChange={e => handleFieldChange('SAML_CALLBACK_URL', e.target.value)} /></div>

            <div className="admin-btn-row"><button className="admin-btn admin-btn-primary" onClick={() => handleSave('sso')} disabled={adminLoading}><FiSave /> Save Changes</button></div>
            {saveResult && <div className={`admin-result ${saveResult.type}`}>{saveResult.type === 'success' ? <FiCheck /> : <FiAlertTriangle />}{saveResult.message}</div>}
          </div>
        </div>
      )}

      {tab === 'sso' && !isProvisioning && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiUsers /> SCIM Provisioning</h2>
              <p>Automated user provisioning via SCIM 2.0</p>
            </div>
          </div>
          <div className="admin-section-card">
            <div className="admin-toggle-wrapper"><label>Enable SCIM</label><input type="checkbox" className="admin-toggle" checked={editValues.SCIM_ENABLED === 'true'} onChange={e => handleFieldChange('SCIM_ENABLED', e.target.checked ? 'true' : 'false')} /></div>

            <div className="admin-field">
              <label>SCIM Endpoint URL</label>
              <div className="admin-field-row">
                <input value={`${adminConfig?.server?.FRONTEND_URL || window.location.origin}/scim/v2`} readOnly className="admin-input-readonly" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                <button className="admin-btn admin-btn-secondary" onClick={() => navigator.clipboard.writeText(`${adminConfig?.server?.FRONTEND_URL || window.location.origin}/scim/v2`)} style={{ whiteSpace: 'nowrap' }}><FiCopy /> Copy</button>
              </div>
              <span className="admin-field-hint">Provide this URL to your identity provider (Okta, Azure AD, etc.)</span>
            </div>

            <div className="admin-field">
              <label>Bearer Token</label>
              <div className="admin-field-row">
                <input value={editValues.SCIM_BEARER_TOKEN || ''} readOnly className="admin-input-readonly" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                <button className="admin-btn admin-btn-secondary" onClick={() => {
                  if (editValues.SCIM_BEARER_TOKEN) navigator.clipboard.writeText(editValues.SCIM_BEARER_TOKEN);
                }} style={{ whiteSpace: 'nowrap' }}><FiCopy /> Copy</button>
              </div>
              <span className="admin-field-hint">Copy this token into your identity provider's SCIM configuration.</span>
            </div>

            <div className="admin-btn-row">
              <button className="admin-btn admin-btn-secondary" onClick={() => {
                handleFieldChange('SCIM_BEARER_TOKEN', generateHex(32));
              }}><FiRefreshCw /> Generate New Token</button>
              <button className="admin-btn admin-btn-primary" onClick={() => handleSave('scim')} disabled={adminLoading}><FiSave /> Save Changes</button>
            </div>
            <span className="admin-field-hint">Generating a new token will invalidate the previous one. Update your identity provider after saving.</span>
            {saveResult && <div className={`admin-result ${saveResult.type}`}>{saveResult.type === 'success' ? <FiCheck /> : <FiAlertTriangle />}{saveResult.message}</div>}
          </div>
        </div>
      )}

      {/* ===================== SYSTEM TAB (normal only) ===================== */}
      {tab === 'system' && !isProvisioning && adminSystemInfo && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiServer /> System Information</h2>
              <p>Server health and runtime details</p>
            </div>
            <button className="admin-btn admin-btn-secondary" onClick={loadSystemInfo}><FiRefreshCw /> Refresh</button>
          </div>
          <div className="admin-section-card">
            <div className="admin-system-grid">
              <div className="admin-system-stat"><div className="stat-label">Uptime</div><div className="stat-value">{formatUptime(adminSystemInfo.uptime)}</div></div>
              <div className="admin-system-stat"><div className="stat-label">Node Version</div><div className="stat-value">{adminSystemInfo.nodeVersion}</div></div>
              <div className="admin-system-stat"><div className="stat-label">Database</div><div className="stat-value">PostgreSQL (bundled)</div></div>
              <div className="admin-system-stat"><div className="stat-label">Active Sessions</div><div className="stat-value">{adminSystemInfo.activeSessions}</div></div>
              <div className="admin-system-stat"><div className="stat-label">Session Timeout</div><div className="stat-value">{adminSystemInfo.sessionTimeoutMinutes || 20} min (inactivity)</div></div>
              <div className="admin-system-stat"><div className="stat-label">Heap Used</div><div className="stat-value">{formatBytes(adminSystemInfo.memoryUsage?.heapUsed || 0)}</div></div>
              <div className="admin-system-stat"><div className="stat-label">Platform</div><div className="stat-value">{adminSystemInfo.platform} ({adminSystemInfo.arch})</div></div>
              <div className="admin-system-stat"><div className="stat-label">Server Time</div><div className="stat-value">{new Date(adminSystemInfo.serverTime).toLocaleTimeString()}</div></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'system' && !isProvisioning && (
        <div className="admin-section-wrapper">
          <div className="admin-section-header">
            <div>
              <h2><FiGlobe /> Application URL</h2>
              <p>The public URL used for CORS, SAML redirects, and SCIM endpoints</p>
            </div>
          </div>
          <div className="admin-section-card">
            <div className="admin-field">
              <label>Frontend URL</label>
              <input value={editValues.FRONTEND_URL || ''} onChange={e => handleFieldChange('FRONTEND_URL', e.target.value)} placeholder="https://analytics.company.com" />
              <span className="admin-field-hint">Auto-detected during setup. Update this if you migrate to a new domain or add a custom URL.</span>
            </div>
            <div className="admin-btn-row">
              <button className="admin-btn admin-btn-secondary" onClick={() => { handleFieldChange('FRONTEND_URL', window.location.origin); handleFieldChange('CORS_ORIGINS', window.location.origin); }}>
                <FiRefreshCw /> Detect from Browser
              </button>
              <button className="admin-btn admin-btn-primary" onClick={() => {
                if (!editValues.CORS_ORIGINS || editValues.CORS_ORIGINS !== editValues.FRONTEND_URL) {
                  handleFieldChange('CORS_ORIGINS', editValues.FRONTEND_URL);
                }
                handleSave('server');
              }} disabled={adminLoading}><FiSave /> Save</button>
            </div>
            {saveResult && <div className={`admin-result ${saveResult.type}`}>{saveResult.type === 'success' ? <FiCheck /> : <FiAlertTriangle />}{saveResult.message}</div>}
          </div>
        </div>
      )}

      {/* Error display */}
      {(adminError || setupError) && !setupComplete && (
        <div className="admin-result error"><FiAlertTriangle />{adminError || setupError}</div>
      )}
      </div>

      {/* Rotation confirmation modal */}
      {confirmRotate && (
        <div className="admin-confirm-overlay" onClick={() => setConfirmRotate(null)}>
          <div className="admin-confirm-box" onClick={e => e.stopPropagation()}>
            <h3><FiAlertTriangle /> Rotate {confirmRotate === 'jwt' ? 'JWT Secret' : confirmRotate === 'encryption' ? 'Encryption Key' : 'Recovery Key'}?</h3>
            <p>
              {confirmRotate === 'jwt'
                ? 'This is irreversible. All active sessions will be invalidated and every user will need to sign in again.'
                : confirmRotate === 'encryption'
                ? 'This is irreversible. All stored connection credentials will be re-encrypted with a new key. Ensure the application is not under heavy load.'
                : 'This is irreversible. All configuration and backup archives will be re-encrypted. A new recovery key file will be downloaded automatically. The previous recovery key will stop working.'}
            </p>
            <div className="admin-confirm-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setConfirmRotate(null)}>Cancel</button>
              <button className="admin-btn admin-btn-danger" onClick={async () => {
                if (confirmRotate === 'recovery') {
                  setConfirmRotate(null);
                  await adminRotateMasterKey();
                } else {
                  handleRotate(confirmRotate);
                }
              }}><FiRefreshCw /> Rotate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
