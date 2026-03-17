/**
 * ShelfPopup - Field picker popup for adding fields to columns/rows/marks shelves
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiTrendingUp, FiCpu, FiColumns, FiList, FiTarget } from 'react-icons/fi';
import { getDataTypeIcon } from '../utils';

const ShelfPopup = ({
  shelfPopup,
  setShelfPopup,
  setFieldTooltip,
  // Field data
  allDimensions,
  measures,
  customColumns,
  // Current shelf state
  columns,
  rows,
  pendingColumns,
  setPendingColumns,
  pendingRows,
  setPendingRows,
  // Apply handlers
  setColumns,
  setRows,
  // Marks state (optional - only needed when marks popup is used)
  markFields,
  setMarkFields,
}) => {
  // Only render for columns/rows/marks
  if (!shelfPopup.open || shelfPopup.open.startsWith('mark-')) return null;
  
  const isMarksPopup = shelfPopup.open === 'marks';

  const closePopup = () => setShelfPopup({ open: null, search: '', x: 0, y: 0, openUp: false });

  const handleApply = () => {
    if (shelfPopup.open === 'columns') {
      setColumns(pendingColumns);
    } else if (shelfPopup.open === 'rows') {
      setRows(pendingRows);
    }
    // Marks doesn't need apply - each click adds immediately
    closePopup();
  };
  
  // For marks, add field immediately on click
  const handleAddToMarks = (fieldName) => {
    if (!markFields?.some(m => m.field === fieldName)) {
      setMarkFields([...markFields, { field: fieldName, type: null }]);
    }
  };
  
  const getTitle = () => {
    switch (shelfPopup.open) {
      case 'columns': return <><FiColumns /> Columns</>;
      case 'rows': return <><FiList /> Rows</>;
      case 'marks': return <><FiTarget /> Add to Marks</>;
      default: return 'Select Fields';
    }
  };

  return createPortal(
    <div className="shelf-popup-overlay" onClick={closePopup}>
      <div 
        className={`shelf-popup ${shelfPopup.openUp ? 'open-up' : ''}`}
        style={{ 
          left: shelfPopup.x, 
          top: shelfPopup.openUp ? 'auto' : shelfPopup.y,
          bottom: shelfPopup.openUp ? (window.innerHeight - shelfPopup.y) : 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseEnter={() => setFieldTooltip?.({ visible: false })}
      >
        <div className="shelf-popup-header">
          <span className="shelf-popup-title">{getTitle()}</span>
          <button className="shelf-popup-close" onClick={closePopup}>
            <FiX />
          </button>
        </div>
        
        <div className="shelf-popup-search">
          <input
            type="text"
            placeholder="Search fields..."
            value={shelfPopup.search}
            onChange={(e) => setShelfPopup(prev => ({ ...prev, search: e.target.value }))}
            autoFocus
          />
        </div>
        
        <div className="shelf-popup-list">
          {shelfPopup.open === 'columns' && (
            <ColumnsFieldList
              allDimensions={allDimensions}
              measures={measures}
              customColumns={customColumns}
              searchTerm={shelfPopup.search}
              pendingColumns={pendingColumns}
              setPendingColumns={setPendingColumns}
              rows={rows}
            />
          )}
          {shelfPopup.open === 'rows' && (
            <RowsFieldList
              allDimensions={allDimensions}
              measures={measures}
              customColumns={customColumns}
              searchTerm={shelfPopup.search}
              pendingRows={pendingRows}
              setPendingRows={setPendingRows}
              columns={columns}
            />
          )}
          {shelfPopup.open === 'marks' && (
            <MarksFieldList
              allDimensions={allDimensions}
              measures={measures}
              customColumns={customColumns}
              searchTerm={shelfPopup.search}
              markFields={markFields}
              onAddField={handleAddToMarks}
            />
          )}
        </div>
        
        {/* Only show footer with Apply/Cancel for columns/rows, not marks */}
        {!isMarksPopup && (
          <div className="shelf-popup-footer">
            <button className="shelf-popup-btn cancel" onClick={closePopup}>
              Cancel
            </button>
            <button className="shelf-popup-btn apply" onClick={handleApply}>
              Apply
            </button>
          </div>
        )}
        
        {/* For marks, show a hint */}
        {isMarksPopup && (
          <div className="shelf-popup-footer marks-hint">
            Click fields to add • Right-click marks to set type
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

// Field list for columns shelf (dimensions first, then measures, then calculated)
const ColumnsFieldList = ({
  allDimensions,
  measures,
  customColumns,
  searchTerm,
  pendingColumns,
  setPendingColumns,
  rows,
}) => {
  const filterBySearch = (item) => 
    !searchTerm || item.name.toLowerCase().includes(searchTerm.toLowerCase());

  return (
    <>
      {/* Dimensions */}
      {allDimensions.filter(filterBySearch).map(dim => {
        const isInPending = pendingColumns.some(c => (c.name || c) === dim.name);
        const isInRows = rows.some(r => (r.name || r) === dim.name);
        const DimIcon = getDataTypeIcon(dim.type || dim.dataType || dim.data_type);
        return (
          <label key={dim.name} className={`shelf-popup-item ${isInRows ? 'used-elsewhere' : ''}`}>
            <input
              type="checkbox"
              checked={isInPending}
              disabled={isInRows}
              onChange={(e) => {
                if (e.target.checked) {
                  setPendingColumns([...pendingColumns, { ...dim, fieldType: 'dimension' }]);
                } else {
                  setPendingColumns(pendingColumns.filter(c => (c.name || c) !== dim.name));
                }
              }}
            />
            <DimIcon className="item-icon dimension" />
            <span className="item-name">{dim.name}</span>
            {isInRows && <span className="item-used">in rows</span>}
          </label>
        );
      })}
      
      {/* Measures */}
      {(measures || []).filter(filterBySearch).map(measure => {
        const isInPending = pendingColumns.some(c => (c.name || c) === measure.name);
        const isInRows = rows.some(r => (r.name || r) === measure.name);
        return (
          <label key={measure.name} className={`shelf-popup-item ${isInRows ? 'used-elsewhere' : ''}`}>
            <input
              type="checkbox"
              checked={isInPending}
              disabled={isInRows}
              onChange={(e) => {
                if (e.target.checked) {
                  setPendingColumns([...pendingColumns, { ...measure, fieldType: 'measure' }]);
                } else {
                  setPendingColumns(pendingColumns.filter(c => (c.name || c) !== measure.name));
                }
              }}
            />
            <FiTrendingUp className="item-icon measure" />
            <span className="item-name">{measure.name}</span>
            {isInRows && <span className="item-used">in rows</span>}
          </label>
        );
      })}
      
      {/* Calculated Fields */}
      {customColumns.filter(filterBySearch).map(calc => {
        const isInPending = pendingColumns.some(c => (c.name || c) === calc.name);
        const isInRows = rows.some(r => (r.name || r) === calc.name);
        return (
          <label key={calc.name} className={`shelf-popup-item calculated ${isInRows ? 'used-elsewhere' : ''}`}>
            <input
              type="checkbox"
              checked={isInPending}
              disabled={isInRows}
              onChange={(e) => {
                if (e.target.checked) {
                  setPendingColumns([...pendingColumns, { ...calc, fieldType: calc.isAggregate ? 'measure' : 'dimension' }]);
                } else {
                  setPendingColumns(pendingColumns.filter(c => (c.name || c) !== calc.name));
                }
              }}
            />
            <FiCpu className="item-icon calculated" />
            <span className="item-name">{calc.name}</span>
            {isInRows && <span className="item-used">in rows</span>}
          </label>
        );
      })}
    </>
  );
};

// Field list for rows shelf (measures first, then dimensions, then calculated)
const RowsFieldList = ({
  allDimensions,
  measures,
  customColumns,
  searchTerm,
  pendingRows,
  setPendingRows,
  columns,
}) => {
  const filterBySearch = (item) => 
    !searchTerm || item.name.toLowerCase().includes(searchTerm.toLowerCase());

  return (
    <>
      {/* Measures */}
      {(measures || []).filter(filterBySearch).map(measure => {
        const isInPending = pendingRows.some(r => (r.name || r) === measure.name);
        const isInColumns = columns.some(c => (c.name || c) === measure.name);
        return (
          <label key={measure.name} className={`shelf-popup-item ${isInColumns ? 'used-elsewhere' : ''}`}>
            <input
              type="checkbox"
              checked={isInPending}
              disabled={isInColumns}
              onChange={(e) => {
                if (e.target.checked) {
                  setPendingRows([...pendingRows, { ...measure, fieldType: 'measure' }]);
                } else {
                  setPendingRows(pendingRows.filter(r => (r.name || r) !== measure.name));
                }
              }}
            />
            <FiTrendingUp className="item-icon measure" />
            <span className="item-name">{measure.name}</span>
            {isInColumns && <span className="item-used">in columns</span>}
          </label>
        );
      })}
      
      {/* Dimensions */}
      {allDimensions.filter(filterBySearch).map(dim => {
        const isInPending = pendingRows.some(r => (r.name || r) === dim.name);
        const isInColumns = columns.some(c => (c.name || c) === dim.name);
        const DimIcon = getDataTypeIcon(dim.type || dim.dataType || dim.data_type);
        return (
          <label key={dim.name} className={`shelf-popup-item ${isInColumns ? 'used-elsewhere' : ''}`}>
            <input
              type="checkbox"
              checked={isInPending}
              disabled={isInColumns}
              onChange={(e) => {
                if (e.target.checked) {
                  setPendingRows([...pendingRows, { ...dim, fieldType: 'dimension' }]);
                } else {
                  setPendingRows(pendingRows.filter(r => (r.name || r) !== dim.name));
                }
              }}
            />
            <DimIcon className="item-icon dimension" />
            <span className="item-name">{dim.name}</span>
            {isInColumns && <span className="item-used">in columns</span>}
          </label>
        );
      })}
      
      {/* Calculated Fields */}
      {customColumns.filter(filterBySearch).map(calc => {
        const isInPending = pendingRows.some(r => (r.name || r) === calc.name);
        const isInColumns = columns.some(c => (c.name || c) === calc.name);
        return (
          <label key={calc.name} className={`shelf-popup-item calculated ${isInColumns ? 'used-elsewhere' : ''}`}>
            <input
              type="checkbox"
              checked={isInPending}
              disabled={isInColumns}
              onChange={(e) => {
                if (e.target.checked) {
                  setPendingRows([...pendingRows, { ...calc, fieldType: calc.isAggregate ? 'measure' : 'dimension' }]);
                } else {
                  setPendingRows(pendingRows.filter(r => (r.name || r) !== calc.name));
                }
              }}
            />
            <FiCpu className="item-icon calculated" />
            <span className="item-name">{calc.name}</span>
            {isInColumns && <span className="item-used">in columns</span>}
          </label>
        );
      })}
    </>
  );
};

// Field list for marks - shows ALL fields regardless of columns/rows
// Only filters by what's already in marks
const MarksFieldList = ({
  allDimensions,
  measures,
  customColumns,
  searchTerm,
  markFields,
  onAddField,
}) => {
  const filterBySearch = (item) => 
    !searchTerm || item.name.toLowerCase().includes(searchTerm.toLowerCase());
  
  // Check if field is already in marks
  const isInMarks = (fieldName) => markFields?.some(m => m.field === fieldName);

  return (
    <>
      {/* Dimensions - show all, no restriction by cols/rows */}
      {allDimensions.filter(filterBySearch).length > 0 && (
        <div className="shelf-popup-group-label">Dimensions</div>
      )}
      {allDimensions.filter(filterBySearch).map(dim => {
        const alreadyAdded = isInMarks(dim.name);
        const DimIcon = getDataTypeIcon(dim.type || dim.dataType || dim.data_type);
        return (
          <button 
            key={dim.name} 
            className={`shelf-popup-item clickable ${alreadyAdded ? 'already-added' : ''}`}
            onClick={() => !alreadyAdded && onAddField(dim.name)}
            disabled={alreadyAdded}
          >
            <DimIcon className="item-icon dimension" />
            <span className="item-name">{dim.name}</span>
            {alreadyAdded && <span className="item-used">added</span>}
          </button>
        );
      })}
      
      {/* Measures - show all */}
      {(measures || []).filter(filterBySearch).length > 0 && (
        <div className="shelf-popup-group-label">Measures</div>
      )}
      {(measures || []).filter(filterBySearch).map(measure => {
        const alreadyAdded = isInMarks(measure.name);
        return (
          <button 
            key={measure.name} 
            className={`shelf-popup-item clickable ${alreadyAdded ? 'already-added' : ''}`}
            onClick={() => !alreadyAdded && onAddField(measure.name)}
            disabled={alreadyAdded}
          >
            <FiTrendingUp className="item-icon measure" />
            <span className="item-name">{measure.name}</span>
            {alreadyAdded && <span className="item-used">added</span>}
          </button>
        );
      })}
      
      {/* Calculated Fields - show all */}
      {customColumns.filter(filterBySearch).length > 0 && (
        <div className="shelf-popup-group-label">Calculated</div>
      )}
      {customColumns.filter(filterBySearch).map(calc => {
        const alreadyAdded = isInMarks(calc.name);
        return (
          <button 
            key={calc.name} 
            className={`shelf-popup-item clickable calculated ${alreadyAdded ? 'already-added' : ''}`}
            onClick={() => !alreadyAdded && onAddField(calc.name)}
            disabled={alreadyAdded}
          >
            <FiCpu className="item-icon calculated" />
            <span className="item-name">{calc.name}</span>
            {alreadyAdded && <span className="item-used">added</span>}
          </button>
        );
      })}
    </>
  );
};

export default ShelfPopup;
