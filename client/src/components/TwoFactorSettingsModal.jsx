/**
 * Multi-Factor Authentication Settings Component
 * 
 * Allows users to set up and manage TOTP and Passkey authentication.
 */

import React, { useState, useEffect } from 'react';
import { 
  FiShield, FiSmartphone, FiKey, FiCheck, FiX, FiLoader, 
  FiAlertCircle, FiCheckCircle, FiTrash2, FiPlus, FiCopy,
  FiAlertTriangle
} from 'react-icons/fi';
import { twoFactorApi } from '../api/apiClient';
import '../styles/TwoFactorSettingsModal.css';

// Helper functions for WebAuthn - browser independent
function base64urlToArrayBuffer(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Native WebAuthn registration - works across all browsers
async function nativeStartRegistration(options) {
  // Convert the server options to the format expected by navigator.credentials.create()
  const publicKeyOptions = {
    challenge: base64urlToArrayBuffer(options.challenge),
    rp: {
      name: options.rp.name,
      id: options.rp.id,
    },
    user: {
      id: base64urlToArrayBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout || 60000,
    attestation: options.attestation || 'none',
    authenticatorSelection: options.authenticatorSelection,
  };
  
  // Convert excludeCredentials if present
  if (options.excludeCredentials && options.excludeCredentials.length > 0) {
    publicKeyOptions.excludeCredentials = options.excludeCredentials.map(cred => ({
      type: cred.type || 'public-key',
      id: base64urlToArrayBuffer(cred.id),
      transports: cred.transports,
    }));
  }
  
  // Call the native WebAuthn API
  const credential = await navigator.credentials.create({
    publicKey: publicKeyOptions,
  });
  
  // Convert the response to the format expected by the server
  const response = {
    id: credential.id,
    rawId: arrayBufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: arrayBufferToBase64url(credential.response.clientDataJSON),
      attestationObject: arrayBufferToBase64url(credential.response.attestationObject),
      transports: credential.response.getTransports ? credential.response.getTransports() : ['internal'],
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  
  return response;
}

const TwoFactorSettingsModal = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // TOTP Setup State
  const [showTotpSetup, setShowTotpSetup] = useState(false);
  const [totpSetupData, setTotpSetupData] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpVerifying, setTotpVerifying] = useState(false);
  const [backupCodes, setBackupCodes] = useState(null);
  const [totpError, setTotpError] = useState(null);
  
  // TOTP Disable State
  const [showDisableTotp, setShowDisableTotp] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  
  // Passkey State
  const [passkeys, setPasskeys] = useState([]);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  
  // Passkey Delete State
  const [passkeyToDelete, setPasskeyToDelete] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingPasskey, setDeletingPasskey] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const [statusData, passkeysData] = await Promise.all([
        twoFactorApi.getStatus(),
        twoFactorApi.getPasskeys(),
      ]);
      setStatus(statusData);
      setPasskeys(passkeysData.passkeys || []);
    } catch (err) {
      console.error('Failed to load MFA status:', err);
      setError('Failed to load MFA status');
    } finally {
      setLoading(false);
    }
  };

  // TOTP Functions
  const startTotpSetup = async () => {
    try {
      setError(null);
      setShowTotpSetup(true);
      const data = await twoFactorApi.setupTotp();
      setTotpSetupData(data);
    } catch (err) {
      setError(err.message);
      setShowTotpSetup(false);
    }
  };

  const verifyTotpCode = async () => {
    try {
      setTotpVerifying(true);
      setTotpError(null);
      const result = await twoFactorApi.verifyTotp(totpCode);
      
      if (result.success) {
        setBackupCodes(result.backupCodes);
        await loadStatus();
      }
    } catch (err) {
      setTotpError(err.message);
    } finally {
      setTotpVerifying(false);
    }
  };

  const handleDisableTotp = async () => {
    try {
      setDisabling(true);
      setError(null);
      await twoFactorApi.disableTotp(disablePassword);
      setShowDisableTotp(false);
      setDisablePassword('');
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setDisabling(false);
    }
  };

  const closeTotpSetup = () => {
    setShowTotpSetup(false);
    setTotpSetupData(null);
    setTotpCode('');
    setTotpError(null);
    setBackupCodes(null);
  };

  // Passkey Functions
  const addPasskey = async () => {
    try {
      setAddingPasskey(true);
      setError(null);
      
      // Get registration options from server
      const options = await twoFactorApi.getPasskeyRegistrationOptions();
      
      // Start WebAuthn registration using native API for cross-browser compatibility
      const attResp = await nativeStartRegistration(options);
      
      // Verify with server
      await twoFactorApi.verifyPasskeyRegistration(attResp, passkeyName || undefined);
      
      setShowPasskeyModal(false);
      setPasskeyName('');
      await loadStatus();
    } catch (err) {
      console.error('Passkey registration error:', err.message);
      if (err.name === 'NotAllowedError') {
        setError('Passkey registration was cancelled or failed. Make sure you complete the Touch ID/Face ID prompt.');
      } else if (err.name === 'NotSupportedError') {
        setError('WebAuthn is not supported in this browser. Try using Chrome, Firefox, or Edge.');
      } else if (err.name === 'InvalidStateError') {
        setError('A passkey already exists for this account on this device.');
      } else if (err.message?.includes('HTTPS') || err.message?.includes('secure')) {
        setError('Passkeys require HTTPS. Please access the app over HTTPS or use localhost.');
      } else {
        setError(err.message || 'Failed to register passkey');
      }
    } finally {
      setAddingPasskey(false);
    }
  };

  const handleDeletePasskey = async () => {
    if (!passkeyToDelete) return;
    
    try {
      setDeletingPasskey(true);
      setError(null);
      await twoFactorApi.removePasskey(passkeyToDelete.id, deletePassword);
      setPasskeyToDelete(null);
      setDeletePassword('');
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingPasskey(false);
    }
  };

  const copyBackupCodes = () => {
    if (backupCodes) {
      navigator.clipboard.writeText(backupCodes.join('\n'));
    }
  };

  if (loading) {
    return (
      <div className="two-factor-settings loading">
        <FiLoader className="spinner" />
        <span>Loading security settings...</span>
      </div>

    );
  }

  return (
    <div className="two-factor-settings">
      <div className="section-header">
        <div>
          <h2><FiShield /> Multi-Factor Authentication</h2>
          <p>Protect your account with authenticator apps and passkeys</p>
        </div>
      </div>

      <div className="section-card tfa-card">
        {error && (
          <div className="alert error">
            <FiAlertCircle />
            {error}
            <button onClick={() => setError(null)}><FiX /></button>
          </div>
        )}

        {/* Grace Period Warning */}
        {status?.twoFactorRequired && !status?.has2FA && status?.gracePeriodDaysRemaining && (
          <div className="alert warning">
            <FiAlertTriangle />
            <div>
              <strong>2FA Required</strong>
              <p>You have {status.gracePeriodDaysRemaining} days to set up Multi-Factor Authentication. 
                 Your account will be locked after this period.</p>
            </div>
          </div>
        )}

        {/* Status Overview */}
        <div className="security-status">
          <div className={`status-item ${status?.totpEnabled ? 'enabled' : ''}`}>
            <FiSmartphone />
            <span>Authenticator App</span>
            {status?.totpEnabled ? (
              <span className="status-badge enabled"><FiCheck /> Enabled</span>
            ) : (
              <span className="status-badge disabled">Not Set Up</span>
            )}
          </div>
          <div className={`status-item ${status?.passkeyEnabled ? 'enabled' : ''}`}>
            <FiKey />
            <span>Passkeys</span>
            {status?.passkeyEnabled ? (
              <span className="status-badge enabled"><FiCheck /> {passkeys.length} registered</span>
            ) : (
              <span className="status-badge disabled">Not Set Up</span>
            )}
          </div>
        </div>

      {/* TOTP Section */}
      <div className="auth-method-section">
        <div className="method-header">
          <div className="method-info">
            <FiSmartphone className="method-icon" />
            <div>
              <h3>Authenticator App (TOTP)</h3>
              <p>Use an app like Google Authenticator, Authy, or 1Password</p>
            </div>
          </div>
          {status?.totpEnabled ? (
            <button 
              className="btn-danger"
              onClick={() => setShowDisableTotp(true)}
            >
              <FiTrash2 /> Remove
            </button>
          ) : (
            <button 
              className="btn-primary"
              onClick={startTotpSetup}
            >
              <FiPlus /> Set Up
            </button>
          )}
        </div>
      </div>

      {/* Passkey Section */}
      <div className="auth-method-section">
        <div className="method-header">
          <div className="method-info">
            <FiKey className="method-icon" />
            <div>
              <h3>Passkeys (WebAuthn)</h3>
              <p>Use biometrics or security keys for passwordless authentication</p>
            </div>
          </div>
          <button 
            className="btn-primary"
            onClick={() => setShowPasskeyModal(true)}
          >
            <FiPlus /> Add Passkey
          </button>
        </div>

        {passkeys.length > 0 && (
          <div className="passkey-list">
            {passkeys.map(pk => (
              <div key={pk.id} className="passkey-item">
                <FiKey className="passkey-icon" />
                <div className="passkey-info">
                  <span className="passkey-name">{pk.name}</span>
                  <span className="passkey-date">Added {new Date(pk.createdAt).toLocaleDateString()}</span>
                </div>
                <button 
                  className="btn-icon danger"
                  onClick={() => setPasskeyToDelete(pk)}
                  title="Remove passkey"
                >
                  <FiTrash2 />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* End of section-card */}
      </div>

      {/* TOTP Setup Modal */}
      {showTotpSetup && (
        <div className="modal-overlay" onClick={closeTotpSetup}>
          <div className="modal totp-setup-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiSmartphone /> Set Up Authenticator</h2>
              <button className="close-btn" onClick={closeTotpSetup}><FiX /></button>
            </div>

            <div className="modal-body">
              {backupCodes ? (
                // Show backup codes after successful setup
                <div className="backup-codes-section">
                  <div className="success-message">
                    <FiCheckCircle />
                    <span>Authenticator app enabled!</span>
                  </div>
                  
                  <h3>Save Your Backup Codes</h3>
                  <p>Store these codes securely. You can use them to sign in if you lose access to your authenticator app.</p>
                  
                  <div className="backup-codes-grid">
                    {backupCodes.map((code, i) => (
                      <code key={i}>{code}</code>
                    ))}
                  </div>
                  
                  <button className="copy-codes-btn" onClick={copyBackupCodes}>
                    <FiCopy /> Copy Codes
                  </button>
                  
                  <p className="warning-text">
                    <FiAlertTriangle /> These codes will only be shown once!
                  </p>
                </div>
              ) : totpSetupData ? (
                // Show QR code and verification
                <>
                  <div className="setup-steps">
                    <div className="step">
                      <span className="step-number">1</span>
                      <span>Scan this QR code with your authenticator app</span>
                    </div>
                  </div>
                  
                  <div className="qr-code-container">
                    <img src={totpSetupData.qrCode} alt="TOTP QR Code" />
                  </div>
                  
                  <div className="manual-entry">
                    <p>Or enter this code manually:</p>
                    <code>{totpSetupData.secret}</code>
                  </div>
                  
                  <div className="setup-steps">
                    <div className="step">
                      <span className="step-number">2</span>
                      <span>Enter the 6-digit code from your app</span>
                    </div>
                  </div>
                  
                  <div className="verify-code-input">
                    <input
                      type="text"
                      value={totpCode}
                      onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                      autoComplete="one-time-code"
                    />
                    {totpCode.length === 6 && (
                      <button 
                        className="verify-btn-inline"
                        onClick={verifyTotpCode}
                        disabled={totpVerifying}
                      >
                        {totpVerifying ? <FiLoader className="spinner" /> : <FiCheck />}
                      </button>
                    )}
                  </div>
                  {totpError && (
                    <div className="totp-inline-error">
                      <FiAlertCircle />
                      <span>{totpError}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="loading-setup">
                  <FiLoader className="spinner" />
                  <span>Generating setup code...</span>
                </div>
              )}
            </div>

            {backupCodes && (
              <div className="modal-footer">
                <button className="btn-primary" onClick={closeTotpSetup}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Disable TOTP Modal */}
      {showDisableTotp && (
        <div className="modal-overlay" onClick={() => setShowDisableTotp(false)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiAlertTriangle /> Remove Authenticator</h2>
              <button className="close-btn" onClick={() => setShowDisableTotp(false)}><FiX /></button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to remove your authenticator app? This will make your account less secure.</p>
              <div className="form-group">
                <label>Enter your password to confirm:</label>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={e => setDisablePassword(e.target.value)}
                  placeholder="Your password"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowDisableTotp(false)}>
                Cancel
              </button>
              <button 
                className="btn-danger" 
                onClick={handleDisableTotp}
                disabled={!disablePassword || disabling}
              >
                {disabling ? <FiLoader className="spinner" /> : <FiTrash2 />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Passkey Modal */}
      {showPasskeyModal && (
        <div className="modal-overlay" onClick={() => setShowPasskeyModal(false)}>
          <div className="modal passkey-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiKey /> Add Passkey</h2>
              <button className="close-btn" onClick={() => setShowPasskeyModal(false)}><FiX /></button>
            </div>
            <div className="modal-body">
              <div className="passkey-form-group">
                <label>Passkey Name <span className="label-hint">(optional)</span></label>
                <input
                  type="text"
                  value={passkeyName}
                  onChange={e => setPasskeyName(e.target.value)}
                  placeholder="e.g., MacBook Pro"
                  autoFocus
                />
              </div>
              <p className="passkey-hint">
                <FiShield />
                Your browser will prompt for fingerprint, face, or security key.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowPasskeyModal(false)}>
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={addPasskey}
                disabled={addingPasskey}
              >
                {addingPasskey ? <FiLoader className="spinner" /> : <FiKey />}
                Register
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Passkey Modal */}
      {passkeyToDelete && (
        <div className="modal-overlay" onClick={() => setPasskeyToDelete(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><FiAlertTriangle /> Remove Passkey</h2>
              <button className="close-btn" onClick={() => setPasskeyToDelete(null)}><FiX /></button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to remove "{passkeyToDelete.name}"?</p>
              <div className="form-group">
                <label>Enter your password to confirm:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  placeholder="Your password"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setPasskeyToDelete(null)}>
                Cancel
              </button>
              <button 
                className="btn-danger" 
                onClick={handleDeletePasskey}
                disabled={!deletePassword || deletingPasskey}
              >
                {deletingPasskey ? <FiLoader className="spinner" /> : <FiTrash2 />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TwoFactorSettingsModal;
