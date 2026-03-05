/**
 * DataSourceSection - Data source and chart type selectors
 */
import React from 'react';
import { FiLayers, FiBarChart2 } from 'react-icons/fi';
import { CHART_CATEGORIES } from '../constants';

const DataSourceSection = ({
  semanticViewId,
  setSemanticViewId,
  semanticViews,
  widgetType,
  setWidgetType,
  // Callbacks to clear fields when view changes
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
        <select
          className="embedded-select compact"
          value={widgetType}
          onChange={(e) => setWidgetType(e.target.value)}
        >
          {CHART_CATEGORIES.map(category => (
            <optgroup key={category.category} label={category.category}>
              {category.types.map(({ type, label }) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
};

export default DataSourceSection;
