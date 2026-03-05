/**
 * ColorSchemeDropdown - Color palette selector with custom scheme support
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiChevronDown, FiCheck, FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { useAppStore } from '../../../store/appStore';
import { useClickOutside } from '../../../hooks';
import CustomColorSchemeModal from './CustomColorSchemeModal';

const ColorSchemeDropdown = ({ 
  presets, 
  selectedIndex, 
  onChange, 
  customScheme, 
  onCustomSchemeChange 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customModalType, setCustomModalType] = useState('categorical');
  const [editingScheme, setEditingScheme] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  
  // Get saved color schemes from current dashboard
  const currentDashboard = useAppStore(state => state.currentDashboard);
  const savedColorSchemes = currentDashboard?.customColorSchemes || [];
  const saveColorScheme = useAppStore(state => state.saveColorScheme);
  const deleteColorSchemeFromStore = useAppStore(state => state.deleteColorScheme);
  const isColorSchemeInUse = useAppStore(state => state.isColorSchemeInUse);
  
  // Calculate menu position - aware of available screen space in all directions
  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) return;
    
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 360;
    const gap = 6; // space between trigger and menu
    const edgePadding = 10; // minimum distance from viewport edges
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxAllowedHeight = 500;
    const minUsableHeight = 200;
    
    // --- Horizontal positioning ---
    const spaceRight = viewportWidth - rect.left - edgePadding;
    const spaceLeft = rect.right - edgePadding;
    
    let left;
    if (spaceRight >= menuWidth) {
      // Align left edge of menu with left edge of trigger
      left = rect.left;
    } else if (spaceLeft >= menuWidth) {
      // Align right edge of menu with right edge of trigger
      left = rect.right - menuWidth;
    } else {
      // Center in viewport as fallback
      left = Math.max(edgePadding, (viewportWidth - menuWidth) / 2);
    }
    // Clamp to viewport
    left = Math.max(edgePadding, Math.min(left, viewportWidth - menuWidth - edgePadding));
    
    // --- Vertical positioning - pick direction with more room ---
    const spaceBelow = viewportHeight - rect.bottom - gap - edgePadding;
    const spaceAbove = rect.top - gap - edgePadding;
    
    let top, maxHeight, openDirection;
    
    if (spaceBelow >= minUsableHeight || spaceBelow >= spaceAbove) {
      // Open downward
      openDirection = 'down';
      top = rect.bottom + gap;
      maxHeight = Math.max(minUsableHeight, Math.min(spaceBelow, maxAllowedHeight));
    } else {
      // Open upward
      openDirection = 'up';
      maxHeight = Math.max(minUsableHeight, Math.min(spaceAbove, maxAllowedHeight));
      top = rect.top - gap - Math.min(spaceAbove, maxAllowedHeight);
      // Don't let it go above the viewport
      if (top < edgePadding) {
        top = edgePadding;
        maxHeight = rect.top - gap - edgePadding;
      }
    }
    
    setMenuPosition({ top, left, width: menuWidth, maxHeight, openDirection });
  }, []);
  
  // Update position when opening and keep updated on resize
  useEffect(() => {
    if (!isOpen) return;
    
    updateMenuPosition();
    
    const handleResize = () => updateMenuPosition();
    window.addEventListener('resize', handleResize);
    
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen, updateMenuPosition]);
  
  // Close dropdown when clicking outside (with delay to prevent immediate close)
  useClickOutside([triggerRef, menuRef], () => setIsOpen(false), isOpen, 10);
  
  // Close immediately when mouse leaves the menu
  const handleMenuMouseLeave = useCallback(() => {
    setIsOpen(false);
  }, []);
  
  const isCustomSelected = selectedIndex === -1;
  const safePresets = presets || [];
  const defaultPreset = { name: 'Default', colors: ['#3b82f6', '#22c55e', '#f59e0b'] };
  const selectedPreset = isCustomSelected 
    ? { name: customScheme?.name || 'Custom', colors: customScheme?.colors || ['#888'] }
    : (safePresets[selectedIndex] || safePresets[0] || defaultPreset);
  
  // Group presets by type
  const groupedPresets = {
    categorical: safePresets.map((p, i) => ({ ...p, index: i })).filter(p => p.type === 'categorical'),
    sequential: safePresets.map((p, i) => ({ ...p, index: i })).filter(p => p.type === 'sequential'),
    diverging: safePresets.map((p, i) => ({ ...p, index: i })).filter(p => p.type === 'diverging'),
  };
  
  const handleSelect = (index) => {
    onChange(index);
    setIsOpen(false);
  };
  
  const handleSelectSaved = (scheme) => {
    onCustomSchemeChange(scheme);
    onChange(-1);
    setIsOpen(false);
  };
  
  const openCustomModal = (type = 'categorical', schemeToEdit = null) => {
    setCustomModalType(type);
    setEditingScheme(schemeToEdit);
    setShowCustomModal(true);
    setIsOpen(false);
  };
  
  const handleCustomSchemeSave = (scheme) => {
    const savedScheme = saveColorScheme({
      ...scheme,
      id: editingScheme?.id,
    });
    onCustomSchemeChange(savedScheme);
    onChange(-1);
    setEditingScheme(null);
  };
  
  const handleDeleteScheme = (e, schemeId) => {
    e.stopPropagation();
    
    if (isColorSchemeInUse(schemeId)) {
      alert('Cannot delete: this color scheme is in use by one or more widgets. Remove it from those widgets first.');
      return;
    }
    
    const result = deleteColorSchemeFromStore(schemeId);
    if (!result.success) {
      alert(result.error);
      return;
    }
    
    if (customScheme?.id === schemeId) {
      onChange(0);
    }
  };
  
  const handleEditScheme = (e, scheme) => {
    e.stopPropagation();
    openCustomModal(scheme.type || 'categorical', scheme);
  };
  
  return (
    <>
      <div className="color-scheme-dropdown-container">
        <button 
          ref={triggerRef}
          className={`color-scheme-trigger ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
        >
          <div className="color-scheme-option-content">
            <div className="color-scheme-colors">
              {selectedPreset?.colors.slice(0, 6).map((c, i) => (
                <div key={i} className="color-dot" style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className="color-scheme-name">{selectedPreset?.name}</span>
          </div>
          <FiChevronDown className={`dropdown-arrow ${isOpen ? 'rotated' : ''}`} />
        </button>
      </div>
        
      {/* Dropdown menu - rendered via portal to escape sidebar overflow */}
      {isOpen && createPortal(
        <div className="color-scheme-dropdown-backdrop" onClick={() => setIsOpen(false)}>
          <div 
            ref={menuRef}
            className="color-scheme-menu-popup"
            data-direction={menuPosition.openDirection || 'down'}
            style={{
              position: 'fixed',
              top: menuPosition.top,
              left: menuPosition.left,
              width: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
            }}
            onClick={(e) => e.stopPropagation()}
          >
          {/* Saved custom schemes */}
          {savedColorSchemes.length > 0 && (
            <div className="color-scheme-group">
              <div className="color-scheme-group-label">Saved Custom</div>
              {savedColorSchemes.map((scheme) => (
                <div 
                  key={scheme.id} 
                  className={`color-scheme-option ${customScheme?.id === scheme.id && isCustomSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectSaved(scheme)}
                >
                  <div className="color-scheme-colors">
                    {scheme.colors.slice(0, 6).map((c, i) => (
                      <div key={i} className="color-dot" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <span className="color-scheme-name">{scheme.name}</span>
                  <div className="scheme-actions">
                    <button 
                      className="scheme-action-btn" 
                      onClick={(e) => handleEditScheme(e, scheme)}
                      title="Edit"
                      type="button"
                    >
                      <FiEdit2 />
                    </button>
                    <button 
                      className="scheme-action-btn delete" 
                      onClick={(e) => handleDeleteScheme(e, scheme.id)}
                      title="Delete"
                      type="button"
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Create new custom */}
          <div className="color-scheme-group">
            <div className="color-scheme-group-label">Custom</div>
            <button
              className="color-scheme-option create-custom"
              onClick={() => openCustomModal('categorical')}
              type="button"
            >
              <FiPlus className="plus-icon" />
              <span className="color-scheme-name">Create Custom Scheme...</span>
            </button>
          </div>
          
          {/* Categorical */}
          <div className="color-scheme-group">
            <div className="color-scheme-group-label">Categorical</div>
            {groupedPresets.categorical.map((preset) => (
              <button
                key={preset.name}
                className={`color-scheme-option ${preset.index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSelect(preset.index)}
                type="button"
              >
                <div className="color-scheme-colors">
                  {preset.colors.slice(0, 6).map((c, i) => (
                    <div key={i} className="color-dot" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className="color-scheme-name">{preset.name}</span>
                {preset.index === selectedIndex && <FiCheck className="check-icon" />}
              </button>
            ))}
          </div>
          
          {/* Sequential */}
          <div className="color-scheme-group">
            <div className="color-scheme-group-label">Sequential</div>
            {groupedPresets.sequential.map((preset) => (
              <button
                key={preset.name}
                className={`color-scheme-option ${preset.index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSelect(preset.index)}
                type="button"
              >
                <div className="color-scheme-colors gradient">
                  {preset.colors.slice(0, 8).map((c, i) => (
                    <div key={i} className="color-bar" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className="color-scheme-name">{preset.name}</span>
                {preset.index === selectedIndex && <FiCheck className="check-icon" />}
              </button>
            ))}
          </div>
          
          {/* Diverging */}
          <div className="color-scheme-group">
            <div className="color-scheme-group-label">Diverging</div>
            {groupedPresets.diverging.map((preset) => (
              <button
                key={preset.name}
                className={`color-scheme-option ${preset.index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSelect(preset.index)}
                type="button"
              >
                <div className="color-scheme-colors gradient">
                  {preset.colors.slice(0, 9).map((c, i) => (
                    <div key={i} className="color-bar" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className="color-scheme-name">{preset.name}</span>
                {preset.index === selectedIndex && <FiCheck className="check-icon" />}
              </button>
            ))}
          </div>
        </div>
        </div>,
        document.body
      )}
      
      {/* Custom Color Scheme Modal - also via portal */}
      <CustomColorSchemeModal
        isOpen={showCustomModal}
        onClose={() => { setShowCustomModal(false); setEditingScheme(null); }}
        onSave={handleCustomSchemeSave}
        initialColors={editingScheme?.colors}
        initialType={editingScheme?.type || customModalType}
        initialName={editingScheme?.name}
        editMode={!!editingScheme}
      />
    </>
  );
};

export default ColorSchemeDropdown;
