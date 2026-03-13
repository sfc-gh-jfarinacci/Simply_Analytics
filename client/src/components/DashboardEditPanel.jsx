import React, { useEffect, useRef, useState } from 'react';
import WidgetEditor from './widget-editor';
import '../styles/DashboardEditPanel.css';

/**
 * DashboardEditPanel - A slide-in left panel for editing widgets
 * 
 * Instead of inline editing within the widget, this provides a 
 * consistent editing experience regardless of widget size.
 * The widget itself serves as the live preview.
 */
const DashboardEditPanel = ({
  widget,
  dashboardId,
  isOpen,
  onClose,
  onSave,
  onAutoSave,
  isNew = false,
}) => {
  const panelRef = useRef(null);
  const [isFormulaEditing, setIsFormulaEditing] = useState(false);

  // Handle escape key to close - but not if formula is being edited
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isFormulaEditing) {
        onClose();
      }
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isFormulaEditing]);

  
  if (!widget) return null;

  return (
    <div className={`dashboard-edit-panel ${isOpen ? 'open' : ''}`} ref={panelRef}>
      {/* WidgetEditor - Key forces remount when switching widgets, ensuring clean state */}
      <WidgetEditor
        key={widget.id}
        widget={widget}
        dashboardId={dashboardId}
        onClose={isFormulaEditing ? undefined : onClose}
        onSave={onSave}
        onAutoSave={onAutoSave}
        isNew={isNew}
        onFormulaEditingChange={setIsFormulaEditing}
      />
    </div>
  );
};

export default DashboardEditPanel;
