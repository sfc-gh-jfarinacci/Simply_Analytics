/**
 * Toast Notification Component
 * 
 * Provides non-intrusive notifications for success, error, warning, and info messages.
 * Supports action buttons (e.g., "Undo") for recoverable actions.
 */

import React, { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { FiCheck, FiX, FiAlertTriangle, FiInfo, FiRotateCcw, FiTrash2 } from 'react-icons/fi';
import '../styles/Toast.css';

// Toast Context
const ToastContext = createContext(null);

// Toast types and their icons
const TOAST_CONFIG = {
  success: { icon: FiCheck, className: 'toast-success' },
  error: { icon: FiX, className: 'toast-error' },
  warning: { icon: FiAlertTriangle, className: 'toast-warning' },
  info: { icon: FiInfo, className: 'toast-info' },
  undo: { icon: FiTrash2, className: 'toast-undo' }, // Special type for undo-able actions
};

// Individual Toast Component
const ToastItem = ({ id, type, message, onDismiss, duration = 5000, action, actionLabel, onAction }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const config = TOAST_CONFIG[type] || TOAST_CONFIG.info;
  const Icon = config.icon;
  const intervalRef = useRef(null);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    if (duration > 0) {
      // Update progress bar
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
        setProgress(remaining);
        
        if (remaining <= 0) {
          clearInterval(intervalRef.current);
          handleDismiss();
        }
      }, 50);
      
      return () => clearInterval(intervalRef.current);
    }
  }, [duration]);

  const handleDismiss = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsExiting(true);
    setTimeout(() => onDismiss(id), 300);
  };

  const handleAction = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (onAction) onAction();
    setIsExiting(true);
    setTimeout(() => onDismiss(id), 300);
  };

  return (
    <div className={`toast-item ${config.className} ${isExiting ? 'toast-exit' : ''} ${action ? 'has-action' : ''}`}>
      <div className="toast-icon">
        <Icon />
      </div>
      <div className="toast-content">
        <p>{message}</p>
      </div>
      {action && (
        <button className="toast-action" onClick={handleAction}>
          <FiRotateCcw /> {actionLabel || 'Undo'}
        </button>
      )}
      <button className="toast-close" onClick={handleDismiss}>
        <FiX />
      </button>
      {/* Progress bar for undo toasts */}
      {type === 'undo' && (
        <div className="toast-progress">
          <div className="toast-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
};

// Toast Container Component
export const ToastContainer = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((type, message, options = {}) => {
    const id = Date.now() + Math.random();
    const { duration = 5000, action, actionLabel, onAction } = typeof options === 'number' 
      ? { duration: options } 
      : options;
    setToasts(prev => [...prev, { id, type, message, duration, action, actionLabel, onAction }]);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (message, options) => addToast('success', message, options),
    error: (message, options) => addToast('error', message, typeof options === 'number' ? options : { duration: 8000, ...options }),
    warning: (message, options) => addToast('warning', message, options),
    info: (message, options) => addToast('info', message, options),
    // Special undo toast - shows progress bar and action button
    undo: (message, onUndo, duration = 6000) => addToast('undo', message, { 
      duration, 
      action: true, 
      actionLabel: 'Undo', 
      onAction: onUndo 
    }),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <ToastItem
            key={t.id}
            id={t.id}
            type={t.type}
            message={t.message}
            duration={t.duration}
            action={t.action}
            actionLabel={t.actionLabel}
            onAction={t.onAction}
            onDismiss={removeToast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// Hook to use toast
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    // Return no-op functions if not wrapped in ToastContainer
    return {
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    };
  }
  return context;
};

export default ToastContainer;
