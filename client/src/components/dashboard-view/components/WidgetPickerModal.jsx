import React from 'react';
import { FiX, FiSearch } from 'react-icons/fi';

export function WidgetPickerModal({
  widgetTypes,
  widgetSearch,
  setWidgetSearch,
  onAddWidget,
  onAddSpecialWidget,
  onClose,
}) {
  const filtered = widgetSearch.trim()
    ? widgetTypes.filter(t =>
        t.label.toLowerCase().includes(widgetSearch.toLowerCase()) ||
        t.type.toLowerCase().includes(widgetSearch.toLowerCase()) ||
        t.category.toLowerCase().includes(widgetSearch.toLowerCase())
      )
    : widgetTypes;

  return (
    <div className="modal-overlay">
      <div className="modal widget-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Add Widget</h2>
          <button className="modal-close" onClick={() => { onClose(); setWidgetSearch(''); }}>
            <FiX />
          </button>
        </div>

        <div className="widget-picker-search">
          <FiSearch className="search-icon" />
          <input
            type="text"
            placeholder="Search charts... (bar, pie, scatter, sankey...)"
            value={widgetSearch}
            onChange={(e) => setWidgetSearch(e.target.value)}
            autoFocus
          />
          {widgetSearch && (
            <button className="search-clear" onClick={() => setWidgetSearch('')}><FiX /></button>
          )}
        </div>

        <div className="widget-types-grid">
          {filtered.length > 0 ? (
            filtered.map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                className="widget-type-card"
                onClick={() => { (type === 'title' ? onAddSpecialWidget(type) : onAddWidget(type)); setWidgetSearch(''); }}
              >
                <div className="widget-type-icon"><Icon /></div>
                <span>{label}</span>
              </button>
            ))
          ) : (
            <div className="no-results"><span>No charts match "{widgetSearch}"</span></div>
          )}
        </div>
      </div>
    </div>
  );
}
