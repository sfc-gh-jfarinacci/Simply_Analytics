/**
 * FormattingSection - Collapsible section for chart formatting options
 * With tabs for Chart format and Fields format
 * Features: Animated transitions, accordion cards for sections
 */
import React, { useState, useCallback } from 'react';
import { FiDroplet, FiChevronDown, FiChevronRight, FiHash, FiType, FiLayout, FiSliders, FiGrid, FiAlignLeft, FiRotateCw, FiMove } from 'react-icons/fi';
import ColorSchemeDropdown from './ColorSchemeDropdown';
import { COLOR_PRESETS, NUMBER_FORMATS, CHART_FORMAT_OPTIONS, LEGEND_POSITIONS } from '../constants';

// Data type options for fields
const DATA_TYPE_OPTIONS = [
  { value: 'auto', label: 'Auto (from database)' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
];

// Number format options
const NUMBER_FORMAT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'number', label: 'Number (1,234)' },
  { value: 'decimal', label: 'Decimal (1,234.56)' },
  { value: 'currency', label: 'Currency ($1,234.56)' },
  { value: 'percent', label: 'Percent (12.34%)' },
  { value: 'compact', label: 'Compact (1.2K)' },
];

// Date format options
const DATE_FORMAT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'short', label: 'Short (1/1/24)' },
  { value: 'medium', label: 'Medium (Jan 1, 2024)' },
  { value: 'long', label: 'Long (January 1, 2024)' },
  { value: 'iso', label: 'ISO (2024-01-01)' },
];

// Text color presets
const TEXT_COLOR_PRESETS = [
  { value: 'default', label: 'Default', color: null },
  { value: 'primary', label: 'Primary', color: '#3b82f6' },
  { value: 'success', label: 'Success', color: '#10b981' },
  { value: 'warning', label: 'Warning', color: '#f59e0b' },
  { value: 'danger', label: 'Danger', color: '#ef4444' },
  { value: 'muted', label: 'Muted', color: '#6b7280' },
];

// Label angle options with arrows and degree values
const LABEL_ANGLE_OPTIONS = [
  { value: 0, label: '0°', arrow: '→' },
  { value: -45, label: '-45°', arrow: '↘' },
  { value: 45, label: '45°', arrow: '↗' },
  { value: -90, label: '-90°', arrow: '↓' },
  { value: 90, label: '90°', arrow: '↑' },
];

// Title position options
const TITLE_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right'
];

const FormattingSection = ({
  expanded,
  toggleSection,
  widgetType,
  // Color scheme
  colorPreset,
  setColorPreset,
  customScheme,
  setCustomScheme,
  // Number format
  numberFormat,
  setNumberFormat,
  decimalPlaces,
  setDecimalPlaces,
  // Custom config
  customConfig,
  setCustomConfig,
  // Fields for the Fields tab
  allFields = [],
  fieldConfigs = {},
  setFieldConfigs,
}) => {
  const formatOptions = CHART_FORMAT_OPTIONS[widgetType] || {};
  const [activeTab, setActiveTab] = useState('chart');
  const [expandedFields, setExpandedFields] = useState({});
  
  // Chart tab accordion sections
  const [expandedChartSections, setExpandedChartSections] = useState({
    title: false,
    colors: true,
    axes: false,
    labels: false,
    legend: false,
    display: false,
    layout: false,
  });
  
  // Toggle chart section accordion
  const toggleChartSection = useCallback((section) => {
    setExpandedChartSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Toggle field accordion
  const toggleFieldExpanded = useCallback((fieldName) => {
    setExpandedFields(prev => ({ ...prev, [fieldName]: !prev[fieldName] }));
  }, []);

  // Get config for a field
  const getFieldConfig = useCallback((fieldName) => {
    return fieldConfigs?.[fieldName] || {};
  }, [fieldConfigs]);

  // Update config for a field
  const updateFieldConfig = useCallback((fieldName, updates) => {
    if (setFieldConfigs) {
      setFieldConfigs(prev => ({
        ...prev,
        [fieldName]: { ...(prev?.[fieldName] || {}), ...updates },
      }));
    }
  }, [setFieldConfigs]);

  // Get icon for field type
  const getFieldIcon = (field) => {
    const type = typeof field === 'object' ? field.type : null;
    if (type === 'measure' || type === 'number') return FiHash;
    return FiType;
  };


  return (
    <div className={`embedded-section collapsible ${expanded ? 'expanded' : ''}`}>
      <button className="section-toggle" onClick={() => toggleSection('format')}>
        <FiDroplet /> Format & Style
        <span className="toggle-icon">{expanded ? <FiChevronDown /> : <FiChevronRight />}</span>
      </button>
      
      {expanded && (
        <div className="section-content format-content">
          {/* Tabs */}
          <div className="format-tabs">
            <button 
              className={`format-tab ${activeTab === 'chart' ? 'active' : ''}`}
              onClick={() => setActiveTab('chart')}
            >
              Chart
            </button>
            <button 
              className={`format-tab ${activeTab === 'fields' ? 'active' : ''}`}
              onClick={() => setActiveTab('fields')}
            >
              Fields
            </button>
          </div>
          
          {/* Chart Format Tab */}
          {activeTab === 'chart' && (
            <div className="format-tab-content format-tab-animate">
              {/* Widget Title Card */}
              <div className={`format-card ${expandedChartSections.title ? 'expanded' : ''}`}>
                <div className="format-card-header" onClick={() => toggleChartSection('title')}>
                  <FiAlignLeft size={14} className="format-card-icon" />
                  <span className="format-card-title">Widget Title</span>
                  <FiChevronRight className={`format-card-chevron ${expandedChartSections.title ? 'rotated' : ''}`} size={14} />
                </div>
                <div className={`format-card-content ${expandedChartSections.title ? 'show' : ''}`}>
                  <div className="format-card-body">
                    <div className="format-row-inline">
                      <label className="format-toggle">
                        <input
                          type="checkbox"
                          checked={customConfig.showTitle !== false}
                          onChange={(e) => setCustomConfig(prev => ({ ...prev, showTitle: e.target.checked }))}
                        />
                        <span>Show Title</span>
                      </label>
                    </div>
                    {customConfig.showTitle !== false && (
                      <>
                      <div className="format-option-row">
                        <label className="format-option-label">Subtitle</label>
                        <input
                          type="text"
                          className="format-option-input"
                          value={customConfig.subtitle || ''}
                          onChange={e => setCustomConfig(prev => ({ ...prev, subtitle: e.target.value }))}
                          placeholder="e.g. By Region, All Time"
                          style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--border-subtle)', borderRadius: 4, background: 'var(--bg-surface)', color: 'var(--text-primary)', width: '100%' }}
                        />
                      </div>
                      <div className="format-option-row">
                        <label className="format-option-label">Position</label>
                        <div className="title-position-preview">
                          {/* Chart preview with title indicator */}
                          <div className="chart-preview-box">
                            <div className="chart-preview-bars">
                              <div className="preview-bar" style={{ height: '60%' }}></div>
                              <div className="preview-bar" style={{ height: '80%' }}></div>
                              <div className="preview-bar" style={{ height: '45%' }}></div>
                              <div className="preview-bar" style={{ height: '70%' }}></div>
                            </div>
                            <div className={`title-indicator ${customConfig.titlePosition || 'top-left'}`}>
                              <span>Title</span>
                            </div>
                          </div>
                          {/* Position buttons grid */}
                          <div className="position-buttons-grid">
                            {TITLE_POSITIONS.map(pos => (
                              <button
                                key={pos}
                                className={`position-btn ${(customConfig.titlePosition || 'top-left') === pos ? 'active' : ''}`}
                                onClick={() => setCustomConfig(prev => ({ ...prev, titlePosition: pos }))}
                                title={pos.replace('-', ' ')}
                              >
                                {pos.split('-').map(w => w[0].toUpperCase()).join('')}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Colors Card */}
              <div className={`format-card ${expandedChartSections.colors ? 'expanded' : ''}`}>
                <div className="format-card-header" onClick={() => toggleChartSection('colors')}>
                  <FiDroplet size={14} className="format-card-icon" />
                  <span className="format-card-title">Colors</span>
                  <FiChevronRight className={`format-card-chevron ${expandedChartSections.colors ? 'rotated' : ''}`} size={14} />
                </div>
                <div className={`format-card-content ${expandedChartSections.colors ? 'show' : ''}`}>
                  <div className="format-card-body">
                    <label className="format-option-label">Color Scheme</label>
                    <div className="color-scheme-wrapper">
                      <ColorSchemeDropdown
                        presets={COLOR_PRESETS}
                        selectedIndex={colorPreset}
                        onChange={setColorPreset}
                        customScheme={customScheme}
                        onCustomSchemeChange={setCustomScheme}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Axes Card */}
              {formatOptions.axisTitles && (
                <div className={`format-card ${expandedChartSections.axes ? 'expanded' : ''}`}>
                  <div className="format-card-header" onClick={() => toggleChartSection('axes')}>
                    <FiSliders size={14} className="format-card-icon" />
                    <span className="format-card-title">Axis Titles</span>
                    <FiChevronRight className={`format-card-chevron ${expandedChartSections.axes ? 'rotated' : ''}`} size={14} />
                  </div>
                  <div className={`format-card-content ${expandedChartSections.axes ? 'show' : ''}`}>
                    <div className="format-card-body">
                      <div className="axis-title-row">
                        <label>X-Axis</label>
                        <input
                          type="text"
                          className="format-text-input"
                          placeholder="Enter title..."
                          maxLength={32}
                          value={customConfig.xAxisTitle || ''}
                          onChange={(e) => setCustomConfig(prev => ({ ...prev, xAxisTitle: e.target.value }))}
                        />
                      </div>
                      <div className="axis-title-row">
                        <label>Y-Axis</label>
                        <input
                          type="text"
                          className="format-text-input"
                          placeholder="Enter title..."
                          maxLength={32}
                          value={customConfig.yAxisTitle || ''}
                          onChange={(e) => setCustomConfig(prev => ({ ...prev, yAxisTitle: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Data Labels Card */}
              {formatOptions.showLabels && (
                <div className={`format-card ${expandedChartSections.labels ? 'expanded' : ''}`}>
                  <div className="format-card-header" onClick={() => toggleChartSection('labels')}>
                    <FiRotateCw size={14} className="format-card-icon" />
                    <span className="format-card-title">Data Labels</span>
                    <FiChevronRight className={`format-card-chevron ${expandedChartSections.labels ? 'rotated' : ''}`} size={14} />
                  </div>
                  <div className={`format-card-content ${expandedChartSections.labels ? 'show' : ''}`}>
                    <div className="format-card-body">
                      <div className="format-row-inline">
                        <label className="format-toggle">
                          <input
                            type="checkbox"
                            checked={customConfig.showLabels === true}
                            onChange={(e) => setCustomConfig(prev => ({ ...prev, showLabels: e.target.checked }))}
                          />
                          <span>Show Labels</span>
                        </label>
                      </div>
                      {customConfig.showLabels && (
                        <div className="format-option-row">
                          <label className="format-option-label">Angle</label>
                          <div className="format-angle-btns">
                            {LABEL_ANGLE_OPTIONS.map(opt => (
                              <button
                                key={opt.value}
                                className={`format-angle-btn ${(customConfig.labelAngle ?? 0) === opt.value ? 'active' : ''}`}
                                onClick={() => setCustomConfig(prev => ({ ...prev, labelAngle: opt.value }))}
                                title={`Rotate ${opt.label}`}
                              >
                                <span className="angle-arrow">{opt.arrow}</span>
                                <span className="angle-value">{opt.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Legend Card */}
              {formatOptions.showLegend && (
                <div className={`format-card ${expandedChartSections.legend ? 'expanded' : ''}`}>
                  <div className="format-card-header" onClick={() => toggleChartSection('legend')}>
                    <FiLayout size={14} className="format-card-icon" />
                    <span className="format-card-title">Legend</span>
                    <FiChevronRight className={`format-card-chevron ${expandedChartSections.legend ? 'rotated' : ''}`} size={14} />
                  </div>
                  <div className={`format-card-content ${expandedChartSections.legend ? 'show' : ''}`}>
                    <div className="format-card-body">
                      <div className="format-row-inline">
                        <label className="format-toggle">
                          <input
                            type="checkbox"
                            checked={customConfig.showLegend !== false}
                            onChange={(e) => setCustomConfig(prev => ({ ...prev, showLegend: e.target.checked }))}
                          />
                          <span>Show Legend</span>
                        </label>
                        
                        {formatOptions.legendPosition && customConfig.showLegend !== false && (
                          <select
                            className="format-select format-select-small"
                            value={customConfig.legendPosition || 'right'}
                            onChange={(e) => setCustomConfig(prev => ({ ...prev, legendPosition: e.target.value }))}
                          >
                            {LEGEND_POSITIONS.map(pos => (
                              <option key={pos.value} value={pos.value}>{pos.label}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Display Options Card */}
              {(formatOptions.showGrid || formatOptions.showDots || formatOptions.animate || formatOptions.showTotals) && (
                <div className={`format-card ${expandedChartSections.display ? 'expanded' : ''}`}>
                  <div className="format-card-header" onClick={() => toggleChartSection('display')}>
                    <FiGrid size={14} className="format-card-icon" />
                    <span className="format-card-title">Display Options</span>
                    <FiChevronRight className={`format-card-chevron ${expandedChartSections.display ? 'rotated' : ''}`} size={14} />
                  </div>
                  <div className={`format-card-content ${expandedChartSections.display ? 'show' : ''}`}>
                    <div className="format-card-body format-toggles-grid">
                      {formatOptions.showGrid && (
                        <label className="format-toggle">
                          <input
                            type="checkbox"
                            checked={customConfig.showGrid !== false}
                            onChange={(e) => setCustomConfig(prev => ({ ...prev, showGrid: e.target.checked }))}
                          />
                          <span>Show Grid</span>
                        </label>
                      )}

                      {formatOptions.showDots && (
                        <label className="format-toggle">
                          <input
                            type="checkbox"
                            checked={customConfig.showDots !== false}
                            onChange={(e) => setCustomConfig(prev => ({ ...prev, showDots: e.target.checked }))}
                          />
                          <span>Show Dots</span>
                        </label>
                      )}

                      {formatOptions.animate && (
                        <label className="format-toggle">
                          <input
                            type="checkbox"
                            checked={customConfig.animate !== false}
                            onChange={(e) => setCustomConfig(prev => ({ ...prev, animate: e.target.checked }))}
                          />
                          <span>Animate</span>
                        </label>
                      )}

                      {formatOptions.showTotals && (
                        <label className="format-toggle">
                          <input
                            type="checkbox"
                            checked={customConfig.showTotals === true}
                            onChange={(e) => setCustomConfig(prev => ({ ...prev, showTotals: e.target.checked }))}
                          />
                          <span>Show Totals</span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Metric Layout Card */}
              {formatOptions.metricLayout && (
                <div className={`format-card ${expandedChartSections.layout ? 'expanded' : ''}`}>
                  <div className="format-card-header" onClick={() => toggleChartSection('layout')}>
                    <FiMove size={14} className="format-card-icon" />
                    <span className="format-card-title">Metric Layout</span>
                    <FiChevronRight className={`format-card-chevron ${expandedChartSections.layout ? 'rotated' : ''}`} size={14} />
                  </div>
                  <div className={`format-card-content ${expandedChartSections.layout ? 'show' : ''}`}>
                    <div className="format-card-body">
                      <div className="format-option-row">
                        <label className="format-option-label">Horizontal Align</label>
                        <div className="format-btn-group">
                          {[{ v: 'left', l: 'Left' }, { v: 'center', l: 'Center' }, { v: 'right', l: 'Right' }].map(o => (
                            <button key={o.v}
                              className={`format-btn-option ${(customConfig.metricAlign || 'left') === o.v ? 'active' : ''}`}
                              onClick={() => setCustomConfig(prev => ({ ...prev, metricAlign: o.v }))}
                            >{o.l}</button>
                          ))}
                        </div>
                      </div>
                      <div className="format-option-row">
                        <label className="format-option-label">Vertical Align</label>
                        <div className="format-btn-group">
                          {[{ v: 'top', l: 'Top' }, { v: 'center', l: 'Center' }, { v: 'bottom', l: 'Bottom' }].map(o => (
                            <button key={o.v}
                              className={`format-btn-option ${(customConfig.metricVerticalAlign || 'center') === o.v ? 'active' : ''}`}
                              onClick={() => setCustomConfig(prev => ({ ...prev, metricVerticalAlign: o.v }))}
                            >{o.l}</button>
                          ))}
                        </div>
                      </div>
                      <div className="format-option-row">
                        <label className="format-option-label">Padding</label>
                        <div className="format-slider-row">
                          <input type="range" min="0" max="40" step="2"
                            value={customConfig.metricPadding ?? 12}
                            onChange={e => setCustomConfig(prev => ({ ...prev, metricPadding: parseInt(e.target.value) }))}
                            className="format-range-slider"
                          />
                          <span className="format-slider-value">{customConfig.metricPadding ?? 12}px</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Fields Format Tab */}
          {activeTab === 'fields' && (
            <div className="format-tab-content format-tab-animate">
              {allFields.length === 0 ? (
                <div className="format-empty-state">
                  Add fields to shelves to configure formatting
                </div>
              ) : (
                <div className="field-accordions">
                  {allFields.map((field, index) => {
                    const fieldName = typeof field === 'string' ? field : field.name;
                    const fieldConfig = getFieldConfig(fieldName);
                    const isExpanded = expandedFields[fieldName];
                    const FieldIcon = getFieldIcon(field);
                    const dataType = fieldConfig.dataType || 'auto';
                    
                    return (
                      <div 
                        key={fieldName}
                        className={`field-accordion ${isExpanded ? 'expanded' : ''}`}
                      >
                        <div className="field-accordion-header" onClick={() => toggleFieldExpanded(fieldName)}>
                          <FieldIcon size={12} className="field-type-icon" />
                          <span className="field-accordion-name" title={fieldName}>
                            {fieldName.length > 22 ? fieldName.substring(0, 22) + '...' : fieldName}
                          </span>
                          <FiChevronRight className={`field-accordion-chevron ${isExpanded ? 'rotated' : ''}`} size={14} />
                        </div>
                        
                        {isExpanded && (
                          <div className="field-accordion-content">
                            {/* Data Type */}
                            <div className="field-format-option">
                              <label>Data Type</label>
                              <select
                                className="format-select"
                                value={dataType}
                                onChange={(e) => updateFieldConfig(fieldName, { dataType: e.target.value })}
                              >
                                {DATA_TYPE_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            
                            {/* Number Format (for number type) */}
                            {(dataType === 'number' || dataType === 'auto') && (
                              <div className="field-format-option">
                                <label>Number Format</label>
                                <select
                                  className="format-select"
                                  value={fieldConfig.format || 'auto'}
                                  onChange={(e) => updateFieldConfig(fieldName, { format: e.target.value })}
                                >
                                  {NUMBER_FORMAT_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            
                            {/* Date Format (for date type) */}
                            {dataType === 'date' && (
                              <div className="field-format-option">
                                <label>Date Format</label>
                                <select
                                  className="format-select"
                                  value={fieldConfig.dateFormat || 'auto'}
                                  onChange={(e) => updateFieldConfig(fieldName, { dateFormat: e.target.value })}
                                >
                                  {DATE_FORMAT_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            
                            {/* Text Color */}
                            <div className="field-format-option">
                              <label>Text Color</label>
                              <div className="text-color-picker">
                                {TEXT_COLOR_PRESETS.map(preset => (
                                  <button
                                    key={preset.value}
                                    className={`color-preset-btn ${(fieldConfig.textColor || 'default') === preset.value ? 'active' : ''}`}
                                    style={{ 
                                      backgroundColor: preset.color || 'var(--bg-tertiary)',
                                      borderColor: preset.color || 'var(--border-primary)'
                                    }}
                                    title={preset.label}
                                    onClick={() => updateFieldConfig(fieldName, { textColor: preset.value })}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FormattingSection;
