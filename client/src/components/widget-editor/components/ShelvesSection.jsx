/**
 * ShelvesSection - Collapsible section for columns, rows, and marks shelves
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { FiColumns, FiPlus, FiX, FiMove, FiChevronDown, FiChevronRight, FiDroplet, FiMaximize2, FiType, FiGrid, FiInfo, FiFilter, FiHash, FiMenu, FiList } from 'react-icons/fi';
import { TbSum, TbGripVertical, TbArrowUp, TbArrowDown } from 'react-icons/tb';

// Mark types with their icons and labels
// All mark types
const MARK_TYPES = [
  { type: 'cluster', icon: FiColumns, label: 'Cluster', hint: 'Group bars side-by-side (columns only)' },
  { type: 'color', icon: FiDroplet, label: 'Color', hint: 'Color by this field (rows only)' },
  { type: 'size', icon: FiMaximize2, label: 'Size', hint: 'Size by this field (bubbles/points)' },
  { type: 'label', icon: FiType, label: 'Label', hint: 'Show field value as text on chart' },
  { type: 'detail', icon: FiGrid, label: 'Detail/Trellis', hint: 'Break down into small multiples' },
  { type: 'tooltip', icon: FiInfo, label: 'Tooltip', hint: 'Show in hover tooltip' },
];

// Mark types available for columns (can cluster, no color)
const COLUMN_MARK_TYPES = MARK_TYPES.filter(m => m.type !== 'color');

// Mark types available for rows (can color, no cluster)
const ROW_MARK_TYPES = MARK_TYPES.filter(m => m.type !== 'cluster');

// Aggregation options for measures
const AGGREGATION_OPTIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'count', label: 'Count' },
  { value: 'median', label: 'Median' },

];

const ShelvesSection = ({
  expanded,
  toggleSection,
  // Columns state
  columns,
  setColumns,
  // Rows state
  rows,
  setRows,
  // Aliases
  columnAliases,
  setColumnAliases,
  // Field aggregations (for chart display)
  fieldAggregations = {},
  setFieldAggregations,
  // Field mark types
  fieldMarkTypes = {},
  setFieldMarkTypes,
  // Sorts
  sorts = [],
  onToggleSort,
  // Filter
  onAddFilter,
  // Remove field (also cleans up sorts)
  removeFromShelf,
  // Shelf popup
  shelfPopup,
  setShelfPopup,
  setPendingColumns,
  setPendingRows,
  // Drag & drop state
  dragOverZone,
  setDragOverZone,
  dragOverIndex,
  setDragOverIndex,
  handleDrop,
  handlePillDragStart,
  handlePillDragEnd,
  // Chart config for smart labels
  chartConfig,
}) => {
  const totalFields = columns.length + rows.length;
  
  // Use chart-specific labels or defaults
  const columnsLabel = chartConfig?.columnsLabel || 'Columns';
  const columnsHint = chartConfig?.columnsHint || 'Dimensions for X-axis';
  const rowsLabel = chartConfig?.rowsLabel || 'Rows';
  const rowsHint = chartConfig?.rowsHint || 'Dimensions for series/grouping';
  
  // Aggregation popup state
  const [aggPopup, setAggPopup] = React.useState({ open: false, fieldName: null, currentAgg: null, x: 0, y: 0 });
  
  // Mark type popup state (includes shelfType to filter available mark types)
  const [markPopup, setMarkPopup] = React.useState({ open: false, fieldName: null, currentMark: null, shelfType: null, x: 0, y: 0 });
  
  // Open aggregation menu
  const handleOpenAggMenu = React.useCallback((fieldName, currentAgg, position) => {
    setMarkPopup({ open: false, fieldName: null, currentMark: null, x: 0, y: 0 });
    setAggPopup({ open: true, fieldName, currentAgg, x: position.x, y: position.y });
  }, []);
  
  // Open mark type menu (includes shelfType to filter available mark types)
  const handleOpenMarkMenu = React.useCallback((fieldName, currentMark, position, shelfType) => {
    setAggPopup({ open: false, fieldName: null, currentAgg: null, x: 0, y: 0 });
    setMarkPopup({ open: true, fieldName, currentMark, shelfType, x: position.x, y: position.y });
  }, []);
  
  // Close menus
  const closeAggPopup = React.useCallback(() => {
    setAggPopup({ open: false, fieldName: null, currentAgg: null, x: 0, y: 0 });
  }, []);
  
  const closeMarkPopup = React.useCallback(() => {
    setMarkPopup({ open: false, fieldName: null, currentMark: null, x: 0, y: 0 });
  }, []);
  
  // Handle aggregation selection
  const handleAggregationSelect = React.useCallback((aggType) => {
    if (setFieldAggregations && aggPopup.fieldName) {
      setFieldAggregations(prev => ({
        ...prev,
        [aggPopup.fieldName]: aggType,
      }));
    }
    closeAggPopup();
  }, [setFieldAggregations, aggPopup.fieldName, closeAggPopup]);
  
  // Handle mark type selection
  const handleMarkTypeSelect = React.useCallback((markType) => {
    if (setFieldMarkTypes && markPopup.fieldName) {
      setFieldMarkTypes(prev => ({
        ...prev,
        [markPopup.fieldName]: markType,
      }));
    }
    closeMarkPopup();
  }, [setFieldMarkTypes, markPopup.fieldName, closeMarkPopup]);

  return (
    <div className={`embedded-section collapsible ${expanded ? 'expanded' : ''}`}>
      <button className="section-toggle" onClick={() => toggleSection('shelves')}>
        <FiColumns /> Data Layout
        {totalFields > 0 && <span className="section-count">{totalFields}</span>}
        <span className="toggle-icon">{expanded ? <FiChevronDown /> : <FiChevronRight />}</span>
      </button>
      
      {expanded && (
        <div className="section-content shelves-content">
          <div className="shelves-help" title={`${columnsLabel}: ${columnsHint} | ${rowsLabel}: ${rowsHint}`}>
            Drag fields to define your chart structure
          </div>
          
          {/* Columns Shelf */}
          <ShelfPanel
            label={columnsLabel}
            hint={columnsHint}
            items={columns}
            setItems={setColumns}
            shelfType="columns"
            columnAliases={columnAliases}
            setColumnAliases={setColumnAliases}
            fieldAggregations={fieldAggregations}
            setFieldAggregations={setFieldAggregations}
            fieldMarkTypes={fieldMarkTypes}
            setFieldMarkTypes={setFieldMarkTypes}
            sorts={sorts}
            onToggleSort={onToggleSort}
            onAddFilter={onAddFilter}
            removeFromShelf={removeFromShelf}
            onOpenAggMenu={handleOpenAggMenu}
            onOpenMarkMenu={handleOpenMarkMenu}
            shelfPopup={shelfPopup}
            setShelfPopup={setShelfPopup}
            setPendingItems={setPendingColumns}
            dragOverZone={dragOverZone}
            setDragOverZone={setDragOverZone}
            dragOverIndex={dragOverIndex}
            setDragOverIndex={setDragOverIndex}
            handleDrop={handleDrop}
            handlePillDragStart={handlePillDragStart}
            handlePillDragEnd={handlePillDragEnd}
            defaultFieldType="dimension"
          />

          {/* Rows Shelf */}
          <ShelfPanel
            label={rowsLabel}
            hint={rowsHint}
            items={rows}
            setItems={setRows}
            shelfType="rows"
            columnAliases={columnAliases}
            setColumnAliases={setColumnAliases}
            fieldAggregations={fieldAggregations}
            setFieldAggregations={setFieldAggregations}
            fieldMarkTypes={fieldMarkTypes}
            setFieldMarkTypes={setFieldMarkTypes}
            sorts={sorts}
            onToggleSort={onToggleSort}
            onAddFilter={onAddFilter}
            removeFromShelf={removeFromShelf}
            onOpenAggMenu={handleOpenAggMenu}
            onOpenMarkMenu={handleOpenMarkMenu}
            shelfPopup={shelfPopup}
            setShelfPopup={setShelfPopup}
            setPendingItems={setPendingRows}
            dragOverZone={dragOverZone}
            setDragOverZone={setDragOverZone}
            dragOverIndex={dragOverIndex}
            setDragOverIndex={setDragOverIndex}
            handleDrop={handleDrop}
            handlePillDragStart={handlePillDragStart}
            handlePillDragEnd={handlePillDragEnd}
            defaultFieldType="measure"
          />
          
        </div>
      )}
      
      {/* Aggregation Popup - rendered via portal like filter popup */}
      {aggPopup.open && createPortal(
        <div className="pill-popup-overlay" onClick={closeAggPopup}>
          <div 
            className="pill-popup"
            style={{ position: 'fixed', left: aggPopup.x, top: aggPopup.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pill-popup-header">
              <TbSum size={14} />
              <span>Aggregation</span>
            </div>
            <div className="pill-popup-content">
              {AGGREGATION_OPTIONS.map(agg => (
                <button
                  key={agg.value}
                  className={`pill-popup-item ${aggPopup.currentAgg === agg.value ? 'selected' : ''}`}
                  onClick={() => handleAggregationSelect(agg.value)}
                >
                  {agg.label}
                </button>
              ))}
              {aggPopup.currentAgg && (
                <button
                  className="pill-popup-item clear"
                  onClick={() => handleAggregationSelect(null)}
                >
                  Clear Aggregation
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      
      {/* Mark Type Popup - rendered via portal like filter popup */}
      {markPopup.open && createPortal(
        <div className="pill-popup-overlay" onClick={closeMarkPopup}>
          <div 
            className="pill-popup"
            style={{ position: 'fixed', left: markPopup.x, top: markPopup.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pill-popup-header">
              <FiDroplet size={14} />
              <span>Mark Type</span>
            </div>
            <div className="pill-popup-content">
              {/* Use shelf-specific mark types: columns can cluster but not color, rows can color but not cluster */}
              {(markPopup.shelfType === 'columns' ? COLUMN_MARK_TYPES : ROW_MARK_TYPES).map(mark => {
                const Icon = mark.icon;
                return (
                  <button
                    key={mark.type}
                    className={`pill-popup-item ${(markPopup.currentMark || 'label') === mark.type ? 'selected' : ''}`}
                    onClick={() => handleMarkTypeSelect(mark.type)}
                  >
                    <Icon size={14} />
                    <span>{mark.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// Single shelf panel (Columns or Rows)
const ShelfPanel = ({
  label,
  hint,
  items,
  setItems,
  shelfType,
  columnAliases,
  setColumnAliases,
  fieldAggregations = {},
  setFieldAggregations,
  fieldMarkTypes = {},
  setFieldMarkTypes,
  sorts = [],
  onToggleSort,
  onAddFilter,
  removeFromShelf,
  onOpenAggMenu,
  onOpenMarkMenu,
  shelfPopup,
  setShelfPopup,
  setPendingItems,
  dragOverZone,
  setDragOverZone,
  dragOverIndex,
  setDragOverIndex,
  handleDrop,
  handlePillDragStart,
  handlePillDragEnd,
  defaultFieldType,
}) => {
  const handleAddClick = (e) => {
    e.stopPropagation();
    if (shelfPopup.open === shelfType) {
      setShelfPopup({ open: null, search: '', x: 0, y: 0, openUp: false });
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const popupHeight = 350;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < popupHeight && spaceAbove > spaceBelow;
      
      // Initialize pending state with current items
      setPendingItems([...items]);
      
      setShelfPopup({ 
        open: shelfType, 
        search: '', 
        x: Math.max(10, rect.left - 250),
        y: openUp ? rect.top : rect.bottom + 8,
        openUp,
      });
    }
  };

  // Get icon based on shelf type - FiMenu for columns (horizontal bars), FiList for rows (vertical stacked)
  const ShelfIcon = shelfType === 'columns' ? FiMenu : FiList;
  
  return (
    <div className="embedded-shelf">
      <div className="shelf-header" title={hint}>
        <ShelfIcon className="shelf-icon" />
        <span className="shelf-label">{label}</span>
        <span className="shelf-count">{items.length}</span>
        <button className="shelf-add-btn" onClick={handleAddClick} title="Add fields">
          <FiPlus />
        </button>
      </div>
      <div 
        className={`shelf-pills ${dragOverZone === shelfType ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverZone(shelfType);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setDragOverZone(null);
            setDragOverIndex(null);
          }
        }}
        onDrop={(e) => handleDrop(e, shelfType, dragOverIndex !== null ? dragOverIndex : items.length)}
      >
        {/* Drop zone before first item */}
        <div 
          className={`shelf-drop-zone ${dragOverZone === shelfType && dragOverIndex === 0 ? 'active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverZone(shelfType);
            setDragOverIndex(0);
          }}
          onDrop={(e) => {
            e.stopPropagation();
            handleDrop(e, shelfType, 0);
          }}
        />
        
        {items.map((item, idx) => {
          const fieldName = typeof item === 'string' ? item : item.name;
          const fieldType = item.fieldType || defaultFieldType;
          const displayName = columnAliases[fieldName] || fieldName;
          const currentAggregation = fieldAggregations[fieldName];
          const currentMarkType = fieldMarkTypes[fieldName];
          // Find sort direction for this field
          const sortEntry = sorts.find(s => s.field === fieldName);
          const sortDirection = sortEntry?.direction;
          
          return (
            <React.Fragment key={fieldName || idx}>
              <ShelfPill
                fieldName={fieldName}
                fieldType={fieldType}
                displayName={displayName}
                shelfType={shelfType}
                index={idx}
                handlePillDragStart={handlePillDragStart}
                handlePillDragEnd={handlePillDragEnd}
                currentAggregation={currentAggregation}
                currentMarkType={currentMarkType}
                sortDirection={sortDirection}
                onToggleSort={onToggleSort}
                onAddFilter={onAddFilter}
                onRemove={removeFromShelf}
                onOpenAggMenu={onOpenAggMenu}
                onOpenMarkMenu={onOpenMarkMenu}
              />
              {/* Drop zone after each item */}
              <div 
                className={`shelf-drop-zone ${dragOverZone === shelfType && dragOverIndex === idx + 1 ? 'active' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverZone(shelfType);
                  setDragOverIndex(idx + 1);
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  handleDrop(e, shelfType, idx + 1);
                }}
              />
            </React.Fragment>
          );
        })}
        {items.length === 0 && <span className="shelf-empty">Drop fields here</span>}
      </div>
    </div>
  );
};

// Single shelf pill with inline aggregation, mark type, sort/filter icons
const ShelfPill = ({
  fieldName,
  fieldType,
  displayName,
  shelfType,
  index,
  handlePillDragStart,
  handlePillDragEnd,
  currentAggregation,
  currentMarkType,
  sortDirection, // 'ASC', 'DESC', or undefined
  onToggleSort,
  onAddFilter,
  onRemove,
  onOpenAggMenu,
  onOpenMarkMenu,
}) => {
  const aggBtnRef = React.useRef(null);
  const markBtnRef = React.useRef(null);
  
  const handleSortClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onToggleSort) {
      onToggleSort(fieldName, sortDirection);
    }
  };
  
  const handleFilterClick = (e) => {
    e.stopPropagation();
    if (onAddFilter) {
      onAddFilter(fieldName, e);
    }
  };
  
  const handleRemoveClick = (e) => {
    e.stopPropagation();
    console.log('[ShelfPill] handleRemoveClick called:', { fieldName, shelfType, index, hasOnRemove: !!onRemove });
    if (onRemove) {
      onRemove(shelfType, index);
    }
  };
  
  const handleAggClick = (e) => {
    e.stopPropagation();
    if (onOpenAggMenu && aggBtnRef.current) {
      const rect = aggBtnRef.current.getBoundingClientRect();
      onOpenAggMenu(fieldName, currentAggregation, { x: rect.left, y: rect.bottom + 4 });
    }
  };
  
  const handleMarkClick = (e) => {
    e.stopPropagation();
    if (onOpenMarkMenu && markBtnRef.current) {
      const rect = markBtnRef.current.getBoundingClientRect();
      onOpenMarkMenu(fieldName, currentMarkType, { x: rect.left, y: rect.bottom + 4 }, shelfType);
    }
  };
  
  // Get display label with aggregation
  const aggLabel = currentAggregation ? AGGREGATION_OPTIONS.find(a => a.value === currentAggregation)?.label : null;
  const fullDisplayName = aggLabel ? `${aggLabel}(${displayName})` : displayName;
  
  // Get current mark type info (default to 'label')
  const markType = currentMarkType || 'label';
  const markInfo = MARK_TYPES.find(m => m.type === markType) || MARK_TYPES[0];
  const MarkIcon = markInfo.icon;

  // Determine sort state: 'ASC', 'DESC', or undefined (off)
  const hasSortApplied = !!sortDirection;
  
  // Get sort title based on current state
  const getSortTitle = () => {
    if (!sortDirection) return 'Click to sort ascending';
    if (sortDirection === 'ASC') return 'Sorted ascending - click for descending';
    return 'Sorted descending - click to remove sort';
  };

  return (
    <span className="shelf-pill-wrapper">
      <span 
        className={`shelf-pill ${fieldType} ${currentAggregation ? 'has-aggregation' : ''} ${hasSortApplied ? 'has-sort' : ''} ${sortDirection === 'ASC' ? 'sort-asc' : ''} ${sortDirection === 'DESC' ? 'sort-desc' : ''}`}
      >
        {/* Remove button - inside pill, on left, always visible */}
        <button 
          className="pill-remove-btn"
          onClick={handleRemoveClick}
          title="Remove field"
        >
          <FiX size={10} />
        </button>
        {/* Left side buttons - aggregation and mark type */}
        <span className="pill-left-icons" onClick={(e) => e.stopPropagation()}>
          {/* Aggregation button */}
          <button 
            ref={aggBtnRef}
            className={`pill-icon-btn pill-agg-btn ${currentAggregation ? 'active' : ''}`}
            onClick={handleAggClick}
            title={currentAggregation ? `Aggregation: ${aggLabel}` : 'Set aggregation'}
          >
            <TbSum size={10} />
          </button>
          
          {/* Mark type button */}
          <button 
            ref={markBtnRef}
            className={`pill-icon-btn pill-mark-btn ${markType !== 'label' ? 'active' : ''}`}
            onClick={handleMarkClick}
            title={`Mark: ${markInfo.label}`}
          >
            <MarkIcon size={10} />
          </button>
        </span>
        
        {/* Clickable area for sort - the main pill content */}
        <span 
          className="pill-sort-area"
          onClick={handleSortClick}
          title={getSortTitle()}
        >
          {/* Field name */}
          <span className="pill-name">
            {fullDisplayName}
          </span>
        </span>
        
        {/* Icons on right side */}
        <span className="pill-icons" onClick={(e) => e.stopPropagation()}>
          {/* Sort indicator - shows when sorted */}
          {hasSortApplied && (
            <span className="pill-sort-indicator" onClick={handleSortClick} title={getSortTitle()}>
              {sortDirection === 'DESC' ? <TbArrowDown size={12} /> : <TbArrowUp size={12} />}
            </span>
          )}
          
          {/* Filter button */}
          <button 
            className="pill-icon-btn pill-filter-btn"
            onClick={handleFilterClick}
            title="Filter"
          >
            <FiFilter size={12} />
          </button>
          
          {/* Drag handle */}
          <span
            className="pill-drag-handle"
            draggable={true}
            onDragStart={(e) => handlePillDragStart(e, fieldName, fieldType, shelfType)}
            onDragEnd={handlePillDragEnd}
            title="Drag to reorder"
          >
            <TbGripVertical size={14} />
          </span>
        </span>
      </span>
    </span>
  );
};

export default ShelvesSection;
