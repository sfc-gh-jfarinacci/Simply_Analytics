/**
 * ShelfPopup - Field picker popup for adding fields to columns/rows/marks shelves
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiTrendingUp, FiCpu, FiColumns, FiList, FiTarget } from 'react-icons/fi';
import { getDataTypeIcon } from '../utils';

// Group fields by parentEntity for sectioned display.
// Returns [{ entity, label, fields }]. Fields without an entity go last as "Other".
// If only one entity exists (or none), returns a single group with no label.
const groupByEntity = (fields) => {
  const groups = new Map();
  fields.forEach(f => {
    const entity = f.parentEntity || '';
    if (!groups.has(entity)) groups.set(entity, []);
    groups.get(entity).push(f);
  });
  // If all fields share the same (or no) entity, skip headers
  if (groups.size <= 1) return [{ entity: '', label: null, fields }];
  const result = [];
  groups.forEach((items, entity) => {
    const label = entity
      ? entity.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Other';
    result.push({ entity, label, fields: items });
  });
  return result;
};

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

// Shared checkbox field renderer for columns/rows lists
const CheckboxField = ({ field, fieldType, isChecked, isDisabled, disabledLabel, onToggle }) => {
  const isDimension = fieldType === 'dimension' || fieldType === 'fact';
  const isCalc = fieldType === 'calculated';
  const DimIcon = isDimension ? getDataTypeIcon(field.type || field.dataType || field.data_type) : null;
  return (
    <label
      key={field.qualifiedName || field.name}
      className={`shelf-popup-item ${isCalc ? 'calculated' : ''} ${isDisabled ? 'used-elsewhere' : ''}`}
    >
      <input type="checkbox" checked={isChecked} disabled={isDisabled} onChange={onToggle} />
      {isCalc ? <FiCpu className="item-icon calculated" /> :
       isDimension ? <DimIcon className="item-icon dimension" /> :
       <FiTrendingUp className="item-icon measure" />}
      <span className="item-name">{field.displayName || field.name}</span>
      {isDisabled && <span className="item-used">{disabledLabel}</span>}
    </label>
  );
};

// Field list for columns shelf — grouped by entity, dimensions first then measures
const ColumnsFieldList = ({
  allDimensions,
  measures,
  customColumns,
  searchTerm,
  pendingColumns,
  setPendingColumns,
  rows,
}) => {
  const filterBySearch = (item) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return item.name.toLowerCase().includes(s) ||
      (item.parentEntity && item.parentEntity.toLowerCase().includes(s)) ||
      (item.displayName && item.displayName.toLowerCase().includes(s));
  };

  const filteredDims = allDimensions.filter(filterBySearch);
  const filteredMeas = (measures || []).filter(filterBySearch);
  const allFields = [
    ...filteredDims.map(f => ({ ...f, _ft: 'dimension' })),
    ...filteredMeas.map(f => ({ ...f, _ft: 'measure' })),
  ];
  const entityGroups = groupByEntity(allFields);

  return (
    <>
      {entityGroups.map(group => (
        <React.Fragment key={group.entity || '__all'}>
          {group.label && <div className="shelf-popup-group-label entity">{group.label}</div>}
          {group.fields.map(field => {
            const isInPending = pendingColumns.some(c => (c.name || c) === field.name);
            const isInRows = rows.some(r => (r.name || r) === field.name);
            return (
              <CheckboxField
                key={field.qualifiedName || field.name}
                field={field}
                fieldType={field._ft}
                isChecked={isInPending}
                isDisabled={isInRows}
                disabledLabel="in rows"
                onToggle={(e) => {
                  if (e.target.checked) {
                    setPendingColumns([...pendingColumns, { ...field, fieldType: field._ft }]);
                  } else {
                    setPendingColumns(pendingColumns.filter(c => (c.name || c) !== field.name));
                  }
                }}
              />
            );
          })}
        </React.Fragment>
      ))}

      {/* Calculated Fields */}
      {customColumns.filter(filterBySearch).length > 0 && (
        <div className="shelf-popup-group-label">Calculated</div>
      )}
      {customColumns.filter(filterBySearch).map(calc => {
        const isInPending = pendingColumns.some(c => (c.name || c) === calc.name);
        const isInRows = rows.some(r => (r.name || r) === calc.name);
        return (
          <CheckboxField
            key={calc.name}
            field={calc}
            fieldType="calculated"
            isChecked={isInPending}
            isDisabled={isInRows}
            disabledLabel="in rows"
            onToggle={(e) => {
              if (e.target.checked) {
                setPendingColumns([...pendingColumns, { ...calc, fieldType: calc.isAggregate ? 'measure' : 'dimension' }]);
              } else {
                setPendingColumns(pendingColumns.filter(c => (c.name || c) !== calc.name));
              }
            }}
          />
        );
      })}
    </>
  );
};

// Field list for rows shelf — grouped by entity, measures first then dimensions
const RowsFieldList = ({
  allDimensions,
  measures,
  customColumns,
  searchTerm,
  pendingRows,
  setPendingRows,
  columns,
}) => {
  const filterBySearch = (item) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return item.name.toLowerCase().includes(s) ||
      (item.parentEntity && item.parentEntity.toLowerCase().includes(s)) ||
      (item.displayName && item.displayName.toLowerCase().includes(s));
  };

  const filteredMeas = (measures || []).filter(filterBySearch);
  const filteredDims = allDimensions.filter(filterBySearch);
  const allFields = [
    ...filteredMeas.map(f => ({ ...f, _ft: 'measure' })),
    ...filteredDims.map(f => ({ ...f, _ft: 'dimension' })),
  ];
  const entityGroups = groupByEntity(allFields);

  return (
    <>
      {entityGroups.map(group => (
        <React.Fragment key={group.entity || '__all'}>
          {group.label && <div className="shelf-popup-group-label entity">{group.label}</div>}
          {group.fields.map(field => {
            const isInPending = pendingRows.some(r => (r.name || r) === field.name);
            const isInColumns = columns.some(c => (c.name || c) === field.name);
            return (
              <CheckboxField
                key={field.qualifiedName || field.name}
                field={field}
                fieldType={field._ft}
                isChecked={isInPending}
                isDisabled={isInColumns}
                disabledLabel="in columns"
                onToggle={(e) => {
                  if (e.target.checked) {
                    setPendingRows([...pendingRows, { ...field, fieldType: field._ft }]);
                  } else {
                    setPendingRows(pendingRows.filter(r => (r.name || r) !== field.name));
                  }
                }}
              />
            );
          })}
        </React.Fragment>
      ))}

      {/* Calculated Fields */}
      {customColumns.filter(filterBySearch).length > 0 && (
        <div className="shelf-popup-group-label">Calculated</div>
      )}
      {customColumns.filter(filterBySearch).map(calc => {
        const isInPending = pendingRows.some(r => (r.name || r) === calc.name);
        const isInColumns = columns.some(c => (c.name || c) === calc.name);
        return (
          <CheckboxField
            key={calc.name}
            field={calc}
            fieldType="calculated"
            isChecked={isInPending}
            isDisabled={isInColumns}
            disabledLabel="in columns"
            onToggle={(e) => {
              if (e.target.checked) {
                setPendingRows([...pendingRows, { ...calc, fieldType: calc.isAggregate ? 'measure' : 'dimension' }]);
              } else {
                setPendingRows(pendingRows.filter(r => (r.name || r) !== calc.name));
              }
            }}
          />
        );
      })}
    </>
  );
};

// Field list for marks — grouped by entity, shows ALL fields
const MarksFieldList = ({
  allDimensions,
  measures,
  customColumns,
  searchTerm,
  markFields,
  onAddField,
}) => {
  const filterBySearch = (item) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return item.name.toLowerCase().includes(s) ||
      (item.parentEntity && item.parentEntity.toLowerCase().includes(s)) ||
      (item.displayName && item.displayName.toLowerCase().includes(s));
  };
  
  const isInMarks = (fieldName) => markFields?.some(m => m.field === fieldName);

  const filteredDims = allDimensions.filter(filterBySearch);
  const filteredMeas = (measures || []).filter(filterBySearch);
  const allFields = [
    ...filteredDims.map(f => ({ ...f, _ft: 'dimension' })),
    ...filteredMeas.map(f => ({ ...f, _ft: 'measure' })),
  ];
  const entityGroups = groupByEntity(allFields);

  return (
    <>
      {entityGroups.map(group => (
        <React.Fragment key={group.entity || '__all'}>
          {group.label && <div className="shelf-popup-group-label entity">{group.label}</div>}
          {group.fields.map(field => {
            const alreadyAdded = isInMarks(field.name);
            const isDim = field._ft === 'dimension' || field._ft === 'fact';
            const Icon = isDim
              ? getDataTypeIcon(field.type || field.dataType || field.data_type)
              : FiTrendingUp;
            return (
              <button
                key={field.qualifiedName || field.name}
                className={`shelf-popup-item clickable ${alreadyAdded ? 'already-added' : ''}`}
                onClick={() => !alreadyAdded && onAddField(field.name)}
                disabled={alreadyAdded}
              >
                <Icon className={`item-icon ${isDim ? 'dimension' : 'measure'}`} />
                <span className="item-name">{field.displayName || field.name}</span>
                {alreadyAdded && <span className="item-used">added</span>}
              </button>
            );
          })}
        </React.Fragment>
      ))}

      {/* Calculated Fields */}
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
