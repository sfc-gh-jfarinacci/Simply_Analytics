import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiPlus, FiMinus } from 'react-icons/fi';
import * as d3 from 'd3';
import './CustomColorSchemeModal.css';

/**
 * Modern color scheme creator modal
 * Adapts UI based on scheme type: categorical, sequential, or diverging
 */
const CustomColorSchemeModal = ({ 
  isOpen, 
  onClose, 
  onSave, 
  initialColors, 
  initialType = 'categorical',
  initialName,
  editMode = false
}) => {
  const defaultColors = ['#00d4ff', '#7c3aed', '#10b981', '#f59e0b', '#ef4444'];
  const [schemeName, setSchemeName] = useState(initialName || 'My Custom Scheme');
  const [schemeType, setSchemeType] = useState(initialType);
  
  // Categorical: array of distinct colors
  const [categoricalColors, setCategoricalColors] = useState(defaultColors);
  
  // Sequential: start and end colors + steps
  const [seqStart, setSeqStart] = useState('#e0f2fe');
  const [seqEnd, setSeqEnd] = useState('#0369a1');
  const [seqSteps, setSeqSteps] = useState(7);
  
  // Diverging: low, mid, high colors + steps
  const [divLow, setDivLow] = useState('#ef4444');
  const [divMid, setDivMid] = useState('#fafafa');
  const [divHigh, setDivHigh] = useState('#3b82f6');
  const [divSteps, setDivSteps] = useState(9);
  
  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setSchemeName(initialName || 'My Custom Scheme');
      setSchemeType(initialType);
      
      if (initialColors && initialColors.length > 0) {
        // If editing, populate based on type
        if (initialType === 'categorical') {
          setCategoricalColors(initialColors);
        } else if (initialType === 'sequential' && initialColors.length >= 2) {
          setSeqStart(initialColors[0]);
          setSeqEnd(initialColors[initialColors.length - 1]);
          setSeqSteps(initialColors.length);
        } else if (initialType === 'diverging' && initialColors.length >= 3) {
          setDivLow(initialColors[0]);
          setDivMid(initialColors[Math.floor(initialColors.length / 2)]);
          setDivHigh(initialColors[initialColors.length - 1]);
          setDivSteps(initialColors.length);
        } else {
          setCategoricalColors(initialColors);
        }
      } else {
        // Reset to defaults
        setCategoricalColors(defaultColors);
        setSeqStart('#e0f2fe');
        setSeqEnd('#0369a1');
        setSeqSteps(7);
        setDivLow('#ef4444');
        setDivMid('#fafafa');
        setDivHigh('#3b82f6');
        setDivSteps(9);
      }
    }
  }, [isOpen, initialType, initialColors, initialName]);
  
  // Generate preview colors based on type
  const previewColors = useMemo(() => {
    switch (schemeType) {
      case 'sequential': {
        const interpolator = d3.interpolateRgb(seqStart, seqEnd);
        return d3.quantize(interpolator, seqSteps);
      }
      case 'diverging': {
        const half = Math.floor(divSteps / 2);
        const lowToMid = d3.quantize(d3.interpolateRgb(divLow, divMid), half + 1);
        const midToHigh = d3.quantize(d3.interpolateRgb(divMid, divHigh), half + 1);
        // Remove duplicate mid color
        return [...lowToMid.slice(0, -1), ...midToHigh];
      }
      case 'categorical':
      default:
        return categoricalColors;
    }
  }, [schemeType, categoricalColors, seqStart, seqEnd, seqSteps, divLow, divMid, divHigh, divSteps]);
  
  const handleSave = () => {
    onSave({ 
      name: schemeName, 
      colors: previewColors,
      type: schemeType
    });
    onClose();
  };
  
  const addCategoricalColor = () => {
    if (categoricalColors.length < 12) {
      setCategoricalColors([...categoricalColors, '#6b7280']);
    }
  };
  
  const removeCategoricalColor = (index) => {
    if (categoricalColors.length > 2) {
      setCategoricalColors(categoricalColors.filter((_, i) => i !== index));
    }
  };
  
  const updateCategoricalColor = (index, color) => {
    const updated = [...categoricalColors];
    updated[index] = color;
    setCategoricalColors(updated);
  };
  
  if (!isOpen) return null;
  
  return createPortal(
    <div className="color-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="color-modal">
        {/* Header */}
        <div className="color-modal-header">
          <h3>{editMode ? 'Edit Color Scheme' : 'Create Color Scheme'}</h3>
          <button className="close-btn" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>
        
        <div className="color-modal-content">
          {/* Scheme Name */}
          <div className="form-field">
            <label>Name</label>
            <input 
              type="text" 
              value={schemeName} 
              onChange={(e) => setSchemeName(e.target.value)}
              placeholder="My Custom Scheme"
            />
          </div>
          
          {/* Scheme Type Selector */}
          <div className="form-field">
            <label>Type</label>
            <div className="type-selector">
              <button 
                className={`type-btn ${schemeType === 'categorical' ? 'active' : ''}`}
                onClick={() => setSchemeType('categorical')}
                type="button"
              >
                <span className="type-icon categorical-icon" />
                Categorical
              </button>
              <button 
                className={`type-btn ${schemeType === 'sequential' ? 'active' : ''}`}
                onClick={() => setSchemeType('sequential')}
                type="button"
              >
                <span className="type-icon sequential-icon" />
                Sequential
              </button>
              <button 
                className={`type-btn ${schemeType === 'diverging' ? 'active' : ''}`}
                onClick={() => setSchemeType('diverging')}
                type="button"
              >
                <span className="type-icon diverging-icon" />
                Diverging
              </button>
            </div>
          </div>
          
          {/* Type-specific controls */}
          <div className="color-controls">
            {schemeType === 'categorical' && (
              <div className="categorical-picker">
                <label>Colors ({categoricalColors.length}/12)</label>
                <div className="color-chips">
                  {categoricalColors.map((color, i) => (
                    <div key={i} className="color-chip-wrapper">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => updateCategoricalColor(i, e.target.value)}
                        className="color-chip"
                      />
                      {categoricalColors.length > 2 && (
                        <button 
                          className="chip-remove" 
                          onClick={() => removeCategoricalColor(i)}
                          type="button"
                        >
                          <FiMinus />
                        </button>
                      )}
                    </div>
                  ))}
                  {categoricalColors.length < 12 && (
                    <button className="add-chip" onClick={addCategoricalColor} type="button">
                      <FiPlus />
                    </button>
                  )}
                </div>
              </div>
            )}
            
            {schemeType === 'sequential' && (
              <div className="gradient-picker">
                <div className="gradient-endpoints">
                  <div className="endpoint">
                    <label>Start</label>
                    <input
                      type="color"
                      value={seqStart}
                      onChange={(e) => setSeqStart(e.target.value)}
                      className="endpoint-color"
                    />
                  </div>
                  <div className="gradient-arrow">→</div>
                  <div className="endpoint">
                    <label>End</label>
                    <input
                      type="color"
                      value={seqEnd}
                      onChange={(e) => setSeqEnd(e.target.value)}
                      className="endpoint-color"
                    />
                  </div>
                </div>
                <div className="steps-control">
                  <label>Steps</label>
                  <input
                    type="range"
                    min="3"
                    max="12"
                    value={seqSteps}
                    onChange={(e) => setSeqSteps(Number(e.target.value))}
                  />
                  <span className="steps-value">{seqSteps}</span>
                </div>
              </div>
            )}
            
            {schemeType === 'diverging' && (
              <div className="gradient-picker">
                <div className="gradient-endpoints diverging">
                  <div className="endpoint">
                    <label>Low</label>
                    <input
                      type="color"
                      value={divLow}
                      onChange={(e) => setDivLow(e.target.value)}
                      className="endpoint-color"
                    />
                  </div>
                  <div className="gradient-arrow">→</div>
                  <div className="endpoint">
                    <label>Mid</label>
                    <input
                      type="color"
                      value={divMid}
                      onChange={(e) => setDivMid(e.target.value)}
                      className="endpoint-color"
                    />
                  </div>
                  <div className="gradient-arrow">→</div>
                  <div className="endpoint">
                    <label>High</label>
                    <input
                      type="color"
                      value={divHigh}
                      onChange={(e) => setDivHigh(e.target.value)}
                      className="endpoint-color"
                    />
                  </div>
                </div>
                <div className="steps-control">
                  <label>Steps</label>
                  <input
                    type="range"
                    min="5"
                    max="13"
                    step="2"
                    value={divSteps}
                    onChange={(e) => setDivSteps(Number(e.target.value))}
                  />
                  <span className="steps-value">{divSteps}</span>
                </div>
              </div>
            )}
          </div>
          
          {/* Preview */}
          <div className="preview-section">
            <label>Preview</label>
            <div className="preview-bar">
              {previewColors.map((color, i) => (
                <div 
                  key={i} 
                  className="preview-segment"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="color-modal-footer">
          <button className="btn-cancel" onClick={onClose} type="button">Cancel</button>
          <button className="btn-apply" onClick={handleSave} type="button">Apply</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CustomColorSchemeModal;
