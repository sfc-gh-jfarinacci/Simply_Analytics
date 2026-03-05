/**
 * FieldTooltip - Tooltip displayed when hovering over fields in the editor
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { FiHash, FiTrendingUp, FiCalendar } from 'react-icons/fi';

const FieldTooltip = ({ fieldTooltip }) => {
  if (!fieldTooltip.visible) return null;

  return createPortal(
    <div 
      className="embedded-field-tooltip"
      style={{ 
        position: 'fixed', 
        left: fieldTooltip.x, 
        top: fieldTooltip.y,
        zIndex: 99999,
        pointerEvents: 'none'
      }}
    >
      {fieldTooltip.type === 'action' ? (
        <>
          <div className="tooltip-name">{fieldTooltip.name}</div>
          {fieldTooltip.description && (
            <div className="tooltip-description">{fieldTooltip.description}</div>
          )}
        </>
      ) : (
        <>
          <div className="tooltip-header">
            <span className={`tooltip-type ${fieldTooltip.type}`}>
              {fieldTooltip.type === 'dimension' ? <FiHash /> : 
               fieldTooltip.type === 'measure' ? <FiTrendingUp /> : <FiCalendar />}
              {fieldTooltip.type}
            </span>
            {fieldTooltip.dataType && <span className="tooltip-datatype">{fieldTooltip.dataType}</span>}
          </div>
          <div className="tooltip-name">{fieldTooltip.name}</div>
          {fieldTooltip.description && (
            <div className="tooltip-description">{fieldTooltip.description}</div>
          )}
        </>
      )}
    </div>,
    document.body
  );
};

export default FieldTooltip;
