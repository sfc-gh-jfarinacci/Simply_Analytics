/**
 * AggregationDropdown - Field aggregation selector (SUM, AVG, COUNT, etc.)
 */
import React from 'react';
import { createPortal } from 'react-dom';

const AGGREGATION_OPTIONS = [
  { value: null, label: 'None (raw)', icon: '−' },
  { value: 'COUNT', label: 'Count', icon: '#' },
  { value: 'COUNT_DISTINCT', label: 'Count Distinct', icon: '#!' },
  { value: 'SUM', label: 'Sum', icon: 'Σ' },
  { value: 'AVG', label: 'Average', icon: 'x̄' },
  { value: 'MIN', label: 'Minimum', icon: '↓' },
  { value: 'MAX', label: 'Maximum', icon: '↑' },
];

const AggregationDropdown = ({
  aggDropdown,
  setAggDropdown,
  columns,
  rows,
  getFieldAggregation,
  updateFieldAggregation,
}) => {
  if (!aggDropdown.open) return null;

  const closeDropdown = () => setAggDropdown({ open: false, shelf: null, idx: null, x: 0, y: 0 });

  const currentField = aggDropdown.shelf === 'columns' ? columns[aggDropdown.idx] : rows[aggDropdown.idx];
  const currentAggregation = getFieldAggregation(currentField);

  return createPortal(
    <div className="agg-dropdown-overlay" onClick={closeDropdown}>
      <div 
        className="agg-dropdown"
        style={{ left: aggDropdown.x, top: aggDropdown.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agg-dropdown-header">Select Aggregation</div>
        {AGGREGATION_OPTIONS.map(opt => (
          <button
            key={opt.value || 'none'}
            className={`agg-dropdown-item ${currentAggregation === opt.value ? 'selected' : ''}`}
            onClick={() => updateFieldAggregation(aggDropdown.shelf, aggDropdown.idx, opt.value)}
          >
            {opt.icon && <span className="agg-icon">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
};

export { AGGREGATION_OPTIONS };
export default AggregationDropdown;
