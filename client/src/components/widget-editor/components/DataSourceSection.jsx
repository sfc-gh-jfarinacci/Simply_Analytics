/**
 * DataSourceSection - Data source and chart type selectors
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiLayers, FiBarChart2, FiChevronDown } from 'react-icons/fi';
import { CHART_CATEGORIES, WIDGET_TYPES } from '../constants';

const ChartTypePicker = ({ widgetType, setWidgetType }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const handleClick = (e) => {
      if (
        triggerRef.current?.contains(e.target) ||
        popupRef.current?.contains(e.target)
      ) return;
      setOpen(false);
    };
    const handleScroll = () => updatePos();
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  const current = WIDGET_TYPES.find(t => t.type === widgetType);
  const CurrentIcon = current?.icon || FiBarChart2;

  return (
    <div className="chart-type-picker">
      <button
        ref={triggerRef}
        className="chart-type-trigger"
        onClick={() => setOpen(!open)}
        title={current?.label || 'Select chart type'}
      >
        <CurrentIcon className="chart-type-trigger-icon" />
        <span className="chart-type-trigger-label">{current?.label || 'Chart'}</span>
        <FiChevronDown className="chart-type-trigger-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          className="chart-type-popup"
          style={{ top: pos.top, left: pos.left }}
        >
          {CHART_CATEGORIES.map(category => {
            const CatIcon = category.icon;
            return (
              <div key={category.category} className="chart-type-category">
                <div className="chart-type-category-label">
                  <CatIcon />
                  {category.category}
                </div>
                <div className="chart-type-grid">
                  {category.types.map(({ type, icon: Icon, label }) => (
                    <button
                      key={type}
                      className={`chart-type-tile${widgetType === type ? ' active' : ''}`}
                      onClick={() => { setWidgetType(type); setOpen(false); }}
                      title={label}
                    >
                      <Icon className="chart-type-tile-icon" />
                      <span className="chart-type-tile-label">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
};

const DataSourceSection = ({
  semanticViewId,
  setSemanticViewId,
  semanticViews,
  widgetType,
  setWidgetType,
  onViewChange,
}) => {
  const handleViewChange = (e) => {
    const newViewId = e.target.value;
    if (newViewId !== semanticViewId) {
      onViewChange?.();
    }
    setSemanticViewId(newViewId);
  };

  return (
    <div className="embedded-config-row">
      <div className="embedded-config-item">
        <label className="embedded-label"><FiLayers /> Data</label>
        <select
          className="embedded-select compact"
          value={semanticViewId}
          onChange={handleViewChange}
        >
          <option value="">Select...</option>
          {semanticViews.map(view => {
            const name = typeof view === 'string' ? view : view.name;
            return <option key={name} value={name}>{name}</option>;
          })}
        </select>
      </div>
      <div className="embedded-config-item">
        <label className="embedded-label"><FiBarChart2 /> Chart</label>
        <ChartTypePicker widgetType={widgetType} setWidgetType={setWidgetType} />
      </div>
    </div>
  );
};

export default DataSourceSection;
