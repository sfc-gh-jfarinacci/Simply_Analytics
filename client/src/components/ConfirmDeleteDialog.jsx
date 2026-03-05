import React, { useState } from 'react';
import { FiAlertTriangle, FiX } from 'react-icons/fi';
import './ConfirmDeleteDialog.css';

/**
 * Confirmation dialog that requires typing the name verbatim to delete
 * @param {string} itemName - The name of the item to delete
 * @param {string} itemType - Type of item (e.g., "widget", "dashboard", "tab")
 * @param {function} onConfirm - Called when deletion is confirmed
 * @param {function} onCancel - Called when dialog is cancelled
 * @param {string} error - Error message to display (optional)
 */
const ConfirmDeleteDialog = ({ itemName, itemType = 'item', onConfirm, onCancel, error }) => {
  const [inputValue, setInputValue] = useState('');
  
  const isMatch = inputValue === itemName;

  const handleConfirm = () => {
    if (isMatch) {
      onConfirm();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && isMatch) {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="confirm-delete-overlay">
      <div className="confirm-delete-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="dialog-close" onClick={onCancel}>
          <FiX />
        </button>
        
        <div className="dialog-icon">
          <FiAlertTriangle />
        </div>
        
        <h2 className="dialog-title">Delete {itemType}?</h2>
        
        <p className="dialog-message">
          This action cannot be undone. To confirm, type the {itemType} name exactly as shown:
        </p>
        
        <div className="item-name-display">
          <code>{itemName}</code>
        </div>
        
        <input
          type="text"
          className={`confirm-input ${inputValue && (isMatch ? 'match' : 'no-match')}`}
          placeholder={`Type "${itemName}" to confirm`}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        
        {inputValue && !isMatch && (
          <p className="match-hint">Names must match exactly (case-sensitive)</p>
        )}

        {error && (
          <div className="delete-error">
            <FiAlertTriangle />
            <span>{error}</span>
          </div>
        )}
        
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button 
            className="btn btn-danger" 
            onClick={handleConfirm}
            disabled={!isMatch}
          >
            Delete {itemType}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteDialog;
