import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiUser, FiLock, FiLoader, FiEye, FiEyeOff, FiLogIn, FiSmartphone, FiKey, FiArrowLeft, FiShield, FiAlertCircle, FiExternalLink } from 'react-icons/fi';
import { useAppStore } from '../store/appStore';
import { twoFactorApi } from '../api/apiClient';
import '../styles/SignInModal.css';

// Helper functions for WebAuthn - browser independent
function base64urlToArrayBuffer(base64url) {
  // Convert base64url to base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding
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

// Native WebAuthn authentication - works across all browsers
async function nativeStartAuthentication(options) {

  
  // First, try without allowCredentials to let browser show all passkeys for this rpId
  // This works better with discoverable credentials (passkeys)
  const publicKeyOptions = {
    challenge: base64urlToArrayBuffer(options.challenge),
    timeout: options.timeout || 60000,
    rpId: options.rpId,
    userVerification: options.userVerification || 'preferred',
    // Don't specify allowCredentials - let browser show all available passkeys
  };
  

  
  try {
    // Call the native WebAuthn API
    const credential = await navigator.credentials.get({
      publicKey: publicKeyOptions,
    });
    
  
    
    // Convert the response to the format expected by the server
    // Safely serialize clientExtensionResults to avoid circular references
    let extensionResults = {};
    try {
      extensionResults = JSON.parse(JSON.stringify(credential.getClientExtensionResults() || {}));
    } catch (e) {
      console.warn('[WebAuthn] Could not serialize clientExtensionResults:', e);
    }
    
    const response = {
      id: credential.id,
      rawId: arrayBufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: arrayBufferToBase64url(credential.response.clientDataJSON),
        authenticatorData: arrayBufferToBase64url(credential.response.authenticatorData),
        signature: arrayBufferToBase64url(credential.response.signature),
        userHandle: credential.response.userHandle 
          ? arrayBufferToBase64url(credential.response.userHandle) 
          : null,
      },
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: extensionResults,
    };
    

    return response;
  } catch (firstError) {

    
    // If that fails, try with allowCredentials as fallback
    if (options.allowCredentials && options.allowCredentials.length > 0) {

      
      publicKeyOptions.allowCredentials = options.allowCredentials.map(cred => ({
        type: cred.type || 'public-key',
        id: base64urlToArrayBuffer(cred.id),
        transports: cred.transports || ['internal', 'hybrid'],
      }));
      
      const credential = await navigator.credentials.get({
        publicKey: publicKeyOptions,
      });
      
      // Safely serialize clientExtensionResults to avoid circular references
      let fallbackExtensionResults = {};
      try {
        fallbackExtensionResults = JSON.parse(JSON.stringify(credential.getClientExtensionResults() || {}));
      } catch (e) {
        console.warn('[WebAuthn] Could not serialize clientExtensionResults:', e);
      }
      
      const response = {
        id: credential.id,
        rawId: arrayBufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: arrayBufferToBase64url(credential.response.clientDataJSON),
          authenticatorData: arrayBufferToBase64url(credential.response.authenticatorData),
          signature: arrayBufferToBase64url(credential.response.signature),
          userHandle: credential.response.userHandle 
            ? arrayBufferToBase64url(credential.response.userHandle) 
            : null,
        },
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: fallbackExtensionResults,
      };
      
      return response;
    }
    
    throw firstError;
  }
}

const SignInModal = ({ isOpen, onClose }) => {
  const { signIn, emergencySignIn, complete2FASignIn, isConnecting, connectionError } = useAppStore();
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [showForceLogin, setShowForceLogin] = useState(false);
  const usernameInputRef = useRef(null);
  const digitRefs = useRef([]);
  
  // 2FA State
  const [twoFactorStep, setTwoFactorStep] = useState(false);
  const [twoFactorData, setTwoFactorData] = useState(null);
  const [totpDigits, setTotpDigits] = useState(['', '', '', '', '', '']);
  const [verifying2FA, setVerifying2FA] = useState(false);

  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [showEmergencyLogin, setShowEmergencyLogin] = useState(false);
  const [emergencyKey, setEmergencyKey] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrors({});
      setFormData({ username: '', password: '' });
      setShowForceLogin(false);
      setTwoFactorStep(false);
      setTwoFactorData(null);
      setTotpDigits(['', '', '', '', '', '']);
      setTimeout(() => usernameInputRef.current?.focus(), 100);

      fetch('/api/v1/saml/status')
        .then(r => r.json())
        .then(data => setSsoEnabled(data.enabled === true))
        .catch(() => setSsoEnabled(false));
    }
  }, [isOpen]);

  useEffect(() => {
    if (twoFactorStep && twoFactorData?.methods?.totp) {
      setTimeout(() => digitRefs.current[0]?.focus(), 100);
    }
  }, [twoFactorStep, twoFactorData]);

  // Handle individual digit input
  const handleDigitChange = (index, value) => {
    if (verifying2FA) return;
    
    // Only allow single digit
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...totpDigits];
    newDigits[index] = digit;
    setTotpDigits(newDigits);
    
    // Move to next input if digit entered
    if (digit && index < 5) {
      digitRefs.current[index + 1]?.focus();
    }
    
    // Auto-verify when all 6 digits entered
    const fullCode = newDigits.join('');
    if (fullCode.length === 6 && !verifying2FA) {
      handleVerifyTotp(fullCode);
    }
  };

  const handleDigitKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !totpDigits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length > 0) {
      const newDigits = [...totpDigits];
      for (let i = 0; i < 6; i++) {
        newDigits[i] = pasted[i] || '';
      }
      setTotpDigits(newDigits);
      
      if (pasted.length === 6 && !verifying2FA) {
        handleVerifyTotp(pasted);
      } else {
        digitRefs.current[Math.min(pasted.length, 5)]?.focus();
      }
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
    // Clear force login option if credentials change
    if (showForceLogin) {
      setShowForceLogin(false);
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.username.trim()) newErrors.username = 'Username is required';
    if (!formData.password.trim()) newErrors.password = 'Password is required';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e, forceLogin = false) => {
    e?.preventDefault();
    if (!validateForm()) return;
    
    try {
      const result = await signIn({
        username: formData.username,
        password: formData.password,
        forceLogin,
      });
      
      // Check if 2FA is required
      if (result.requires2FA) {
        setTwoFactorStep(true);
        setTwoFactorData(result);
        setErrors({});
        return;
      }
      
      onClose();
    } catch (error) {
      if (error.message.includes('already signed in')) {
        setShowForceLogin(true);
        setErrors({ submit: error.message });
      } else if (error.message.includes('Authentication failed') || error.message.includes('ECONNREFUSED') || error.message.includes('500')) {
        setShowEmergencyLogin(true);
        setShowForceLogin(false);
        setErrors({ submit: error.message });
      } else {
        setShowForceLogin(false);
        setErrors({ submit: error.message });
      }
    }
  };

  const handleEmergencyLogin = async () => {
    if (!emergencyKey.trim()) {
      setErrors({ submit: 'Enter the master encryption key you saved during initial setup.' });
      return;
    }
    setErrors({});
    try {
      const result = await emergencySignIn(emergencyKey.trim());
      if (result.success) onClose();
    } catch (error) {
      setErrors({ submit: error.message });
    }
  };

  const handleForceLogin = () => {
    handleSubmit(null, true);
  };

  const handleVerifyTotp = async (codeToVerify, forceLogin = false) => {
    const code = codeToVerify || totpDigits.join('');
    if (code.length !== 6) return;
    
    setVerifying2FA(true);
    setErrors({});
    
    try {
      const result = await twoFactorApi.validateTotp(
        twoFactorData.userId,
        code,
        twoFactorData.pendingToken,
        forceLogin
      );
      
      await complete2FASignIn(result);
      onClose();
    } catch (error) {
      // Check if this is a "session already exists" error
      if (error.code === 'SESSION_ALREADY_EXISTS') {
        setShowForceLogin(true);
        setErrors({ submit: error.message });
      } else {
        setShowForceLogin(false);
        setErrors({ submit: error.message });
      }
    } finally {
      setVerifying2FA(false);
    }
  };

  const handlePasskeyAuth = async (forceLogin = false) => {
    setVerifying2FA(true);
    setErrors({});
    
    try {
      // Get authentication options
    
      const options = await twoFactorApi.getPasskeyAuthOptions(
        twoFactorData.userId,
        twoFactorData.pendingToken
      );
     
      
      
      const authResp = await nativeStartAuthentication(options);
     
      
      // Verify with server
      const result = await twoFactorApi.verifyPasskeyAuth(
        twoFactorData.userId,
        authResp,
        twoFactorData.pendingToken,
        forceLogin
      );
      
      await complete2FASignIn(result);
      onClose();
    } catch (error) {
      console.error('[2FA] Passkey auth error:', error);
      // Check if this is a "session already exists" error
      if (error.code === 'SESSION_ALREADY_EXISTS') {
        setShowForceLogin(true);
        setErrors({ submit: error.message });
      } else if (error.name === 'NotAllowedError') {
        setErrors({ submit: 'Passkey authentication was cancelled' });
      } else {
        setShowForceLogin(false);
        setErrors({ submit: error.message });
      }
    } finally {
      setVerifying2FA(false);
    }
  };

  const handleBack = () => {
    setTwoFactorStep(false);
    setTwoFactorData(null);
    setTotpDigits(['', '', '', '', '', '']);
    setErrors({});
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        {twoFactorStep ? (
          /* ============================================
             2FA Verification Step - Centered Design
             ============================================ */
          <div className="auth-2fa">
            <div className="auth-2fa-header">
              <h2>Two-Step Verification</h2>
              <button className="auth-link" onClick={handleBack}>
                Back to sign-in
              </button>
            </div>

            <p className="auth-2fa-user">
              Signing in as <strong>{formData.username}</strong>
            </p>

            {/* Icon */}
            <div className="auth-2fa-icon">
              <FiShield />
            </div>

            {/* Error Message */}
            {errors.submit && (
              <div className="auth-error">
                <FiAlertCircle />
                <span>{errors.submit}</span>
                {showForceLogin && (
                  <button 
                    type="button" 
                    className="auth-force-btn"
                    onClick={() => {
                      // Retry with force login
                      if (twoFactorData?.methods?.totp && totpDigits.join('').length === 6) {
                        handleVerifyTotp(totpDigits.join(''), true);
                      } else if (twoFactorData?.methods?.passkey) {
                        handlePasskeyAuth(true);
                      }
                    }}
                    disabled={verifying2FA}
                  >
                    Sign In Anyway
                  </button>
                )}
              </div>
            )}

            {/* TOTP Code Input - Individual Boxes */}
            {twoFactorData?.methods?.totp && (
              <div className="auth-code-section">
                <div className="auth-code-boxes">
                  {totpDigits.map((digit, index) => (
                    <input
                      key={index}
                      ref={el => digitRefs.current[index] = el}
                      type="text"
                      inputMode="numeric"
                      value={digit}
                      onChange={e => handleDigitChange(index, e.target.value)}
                      onKeyDown={e => handleDigitKeyDown(index, e)}
                      onPaste={index === 0 ? handleDigitPaste : undefined}
                      maxLength={1}
                      autoComplete="off"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      disabled={verifying2FA}
                      className={digit ? 'filled' : ''}
                    />
                  ))}
                </div>
                
                {verifying2FA && (
                  <div className="auth-verifying">
                    <FiLoader className="spinner" />
                    <span>Verifying...</span>
                  </div>
                )}

                <p className="auth-code-help">
                  Enter the code from your authenticator app
                </p>
              </div>
            )}

            {/* Passkey Option */}
            {twoFactorData?.methods?.passkey && (
              <>
                {twoFactorData?.methods?.totp && (
                  <div className="auth-divider">
                    <span>or</span>
                  </div>
                )}
                <button 
                  className="auth-passkey-btn"
                  onClick={() => handlePasskeyAuth()}
                  disabled={verifying2FA}
                >
                  <FiKey />
                  <span>Use Passkey</span>
                </button>
              </>
            )}
          </div>
        ) : (
          /* ============================================
             Sign In Form
             ============================================ */
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-form-header">
              <h2>Sign In</h2>
              <button type="button" className="auth-close" onClick={onClose}>
                <FiX />
              </button>
            </div>

            <div className="auth-form-body">
              {/* Username */}
              <div className="auth-field">
                <label htmlFor="username">Username</label>
                <input
                  ref={usernameInputRef}
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder="Enter your username"
                  className={errors.username ? 'error' : ''}
                  autoComplete="username"
                />
                {errors.username && <span className="auth-field-error">{errors.username}</span>}
              </div>

              {/* Password */}
              <div className="auth-field">
                <label htmlFor="password">Password</label>
                <div className="auth-password-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Enter your password"
                    className={errors.password ? 'error' : ''}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
                {errors.password && <span className="auth-field-error">{errors.password}</span>}
              </div>

              {/* Error Message */}
              {(errors.submit || connectionError) && (
                <div className="auth-error">
                  <FiAlertCircle />
                  <span>{errors.submit || connectionError}</span>
                  {showForceLogin && (
                    <button 
                      type="button" 
                      className="auth-force-btn"
                      onClick={handleForceLogin}
                      disabled={isConnecting}
                    >
                      Sign In Anyway
                    </button>
                  )}
                </div>
              )}

              {/* Emergency login option when DB is unreachable */}
              {showEmergencyLogin && (
                <div className="auth-emergency">
                  <p>Database may be unreachable. Enter the master encryption key you saved during initial setup to access the admin panel.</p>
                  <input
                    type="password"
                    className="auth-emergency-input"
                    placeholder="Master encryption key"
                    value={emergencyKey}
                    onChange={(e) => setEmergencyKey(e.target.value)}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="auth-emergency-btn"
                    onClick={handleEmergencyLogin}
                    disabled={isConnecting || !emergencyKey.trim()}
                  >
                    {isConnecting ? <FiLoader className="spinner" /> : <FiAlertCircle />}
                    <span>Emergency Admin Login</span>
                  </button>
                </div>
              )}

              {/* Submit Button */}
              <button 
                type="submit" 
                className="auth-submit-btn" 
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <>
                    <FiLoader className="spinner" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <span>Sign In</span>
                )}
              </button>

              {ssoEnabled && (
                <>
                  <div className="auth-divider">
                    <span>or</span>
                  </div>

                  <button
                    type="button"
                    className="auth-sso-btn"
                    disabled={ssoLoading}
                    onClick={() => {
                      setSsoLoading(true);
                      window.location.href = '/api/v1/saml/login';
                    }}
                  >
                    {ssoLoading ? (
                      <FiLoader className="spinner" />
                    ) : (
                      <FiExternalLink />
                    )}
                    <span>Sign in with SSO</span>
                  </button>
                </>
              )}
            </div>

            <div className="auth-form-footer">
              <p>Snowflake connections are configured after sign in.</p>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
};

export default SignInModal;
