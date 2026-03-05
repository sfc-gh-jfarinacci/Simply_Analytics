/**
 * FiltersSortsSection - Collapsible section with tabbed filter/sort UI
 */
import React, { useState } from 'react';
import { 
  FiFilter, FiPlus, FiX, 
  FiChevronDown, FiChevronRight,
  FiArrowUp, FiArrowDown,
  FiSearch,
} from 'react-icons/fi';
import { TbArrowsSort } from 'react-icons/tb';
import { formatFilterDisplay } from '../utils';

const FiltersSortsSection = ({
  expanded,
  toggleSection,
  filters,
  showFilterPanel,
  setShowFilterPanel,
  openFilterPopup,
  removeFilter,
  getFilterForField,
  sorts,
  showSortPanel,
  setShowSortPanel,
  addSort,
  removeSort,
  updateSortDirection,
  moveSortUp,
  moveSortDown,
  allDimensions,
  measures,
  customColumns,
  columns,
  rows,
}) => {
  const totalCount = filters.length + sorts.length;
  const [activeTab, setActiveTab] = useState('filters');
  const [filterFieldSearch, setFilterFieldSearch] = useState('');

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'filters') {
      setShowSortPanel(false);
    } else {
      setShowFilterPanel(false);
    }
  };

  return (
    <div className={`embedded-section collapsible ${expanded ? 'expanded' : ''}`}>
      <button className="section-toggle" onClick={() => toggleSection('filters')}>
        <FiFilter /> Filters & Sorts
        {totalCount > 0 && <span className="section-badge">{totalCount}</span>}
        <span className="toggle-icon">{expanded ? <FiChevronDown /> : <FiChevronRight />}</span>
      </button>
      
      {expanded && (
        <div className="section-content fs-section">
          {/* Tab Bar */}
          <div className="fs-tabs">
            <button 
              className={`fs-tab ${activeTab === 'filters' ? 'active' : ''}`}
              onClick={() => handleTabChange('filters')}
            >
              <FiFilter size={11} />
              <span>Filters</span>
              {filters.length > 0 && <span className="fs-tab-count">{filters.length}</span>}
            </button>
            <button 
              className={`fs-tab ${activeTab === 'sorts' ? 'active' : ''}`}
              onClick={() => handleTabChange('sorts')}
            >
              <TbArrowsSort size={11} />
              <span>Sorts</span>
              {sorts.length > 0 && <span className="fs-tab-count">{sorts.length}</span>}
            </button>
          </div>

          {/* Tab Content */}
          <div className="fs-tab-content">
            {activeTab === 'filters' ? (
              <FiltersPanel
                filters={filters}
                showFilterPanel={showFilterPanel}
                setShowFilterPanel={setShowFilterPanel}
                setShowSortPanel={setShowSortPanel}
                openFilterPopup={openFilterPopup}
                removeFilter={removeFilter}
                getFilterForField={getFilterForField}
                allDimensions={allDimensions}
                measures={measures}
                customColumns={customColumns}
                filterFieldSearch={filterFieldSearch}
                setFilterFieldSearch={setFilterFieldSearch}
              />
            ) : (
              <SortsPanel
                sorts={sorts}
                showSortPanel={showSortPanel}
                setShowSortPanel={setShowSortPanel}
                setShowFilterPanel={setShowFilterPanel}
                addSort={addSort}
                removeSort={removeSort}
                updateSortDirection={updateSortDirection}
                moveSortUp={moveSortUp}
                moveSortDown={moveSortDown}
                columns={columns}
                rows={rows}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Filters Panel
const FiltersPanel = ({
  filters,
  showFilterPanel,
  setShowFilterPanel,
  setShowSortPanel,
  openFilterPopup,
  removeFilter,
  getFilterForField,
  allDimensions,
  measures,
  customColumns,
  filterFieldSearch,
  setFilterFieldSearch,
}) => {
  const filteredDimensions = allDimensions.filter(d =>
    !filterFieldSearch || d.name.toLowerCase().includes(filterFieldSearch.toLowerCase())
  );
  const filteredMeasures = (measures || []).filter(m =>
    !filterFieldSearch || m.name.toLowerCase().includes(filterFieldSearch.toLowerCase())
  );
  const filteredCalcFields = customColumns.filter(c =>
    !filterFieldSearch || c.name.toLowerCase().includes(filterFieldSearch.toLowerCase())
  );
  const hasFields = allDimensions.length > 0 || (measures || []).length > 0 || customColumns.length > 0;

  return (
    <div className="fs-panel">
      {/* Active Filters */}
      {filters.length > 0 ? (
        <div className="fs-active-list">
          {filters.map((filter, idx) => (
            <ActiveFilterChip
              key={idx}
              filter={filter}
              onEdit={(e) => openFilterPopup({ name: filter.field }, e)}
              onRemove={() => removeFilter(filter.field)}
            />
          ))}
        </div>
      ) : (
        <div className="fs-empty-state">
          <FiFilter size={16} className="fs-empty-icon" />
          <span>No filters applied</span>
        </div>
      )}

      {/* Add Filter Action */}
      <button
        className={`fs-add-btn ${showFilterPanel ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setShowFilterPanel(!showFilterPanel);
          setShowSortPanel(false);
        }}
      >
        {showFilterPanel ? <FiX size={12} /> : <FiPlus size={12} />}
        <span>{showFilterPanel ? 'Close' : 'Add Filter'}</span>
      </button>

      {/* Field Picker */}
      {showFilterPanel && (
        <div className="fs-field-picker">
          {!hasFields ? (
            <div className="fs-picker-empty">Select a semantic view first</div>
          ) : (
            <>
              {/* Search */}
              <div className="fs-picker-search">
                <FiSearch size={12} />
                <input
                  type="text"
                  placeholder="Search fields..."
                  value={filterFieldSearch}
                  onChange={(e) => setFilterFieldSearch(e.target.value)}
                  autoFocus
                />
                {filterFieldSearch && (
                  <button className="fs-search-clear" onClick={() => setFilterFieldSearch('')}>
                    <FiX size={10} />
                  </button>
                )}
              </div>

              {/* Field Groups */}
              <div className="fs-picker-list">
                {filteredDimensions.length > 0 && (
                  <FieldGroup
                    label="Dimensions"
                    fields={filteredDimensions}
                    type="dimension"
                    getFilter={getFilterForField}
                    onFieldClick={(field, e) => openFilterPopup({ ...field, fieldCategory: 'dimension' }, e)}
                  />
                )}
                {filteredMeasures.length > 0 && (
                  <FieldGroup
                    label="Measures"
                    fields={filteredMeasures.map(m => ({ ...m, type: 'NUMBER' }))}
                    type="measure"
                    getFilter={getFilterForField}
                    onFieldClick={(field, e) => openFilterPopup({ ...field, fieldCategory: 'measure' }, e)}
                  />
                )}
                {filteredCalcFields.length > 0 && (
                  <FieldGroup
                    label="Calculated"
                    fields={filteredCalcFields.map(c => ({ name: c.name, type: 'VARCHAR' }))}
                    type="calculated"
                    getFilter={getFilterForField}
                    onFieldClick={(field, e) => openFilterPopup({ ...field, fieldCategory: 'calculated' }, e)}
                  />
                )}
                {filteredDimensions.length === 0 && filteredMeasures.length === 0 && filteredCalcFields.length === 0 && (
                  <div className="fs-picker-empty">No matching fields</div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Field group in the picker
const FieldGroup = ({ label, fields, type, getFilter, onFieldClick }) => (
  <div className="fs-field-group">
    <div className="fs-group-label">{label}</div>
    {fields.map((field) => {
      const filter = getFilter(field.name);
      return (
        <div
          key={field.name}
          className={`fs-field-item ${type} ${filter ? 'has-filter' : ''}`}
          onClick={(e) => onFieldClick(field, e)}
        >
          <span className={`fs-field-dot ${type}`} />
          <span className="fs-field-name">{field.name}</span>
          {filter ? (
            <span className="fs-field-status active">
              {filter.operator === 'IN' && filter.values?.length 
                ? `${filter.values.length} sel.`
                : formatFilterDisplay(filter)
              }
            </span>
          ) : (
            <span className="fs-field-status">Add</span>
          )}
        </div>
      );
    })}
  </div>
);

// Active filter chip
const ActiveFilterChip = ({ filter, onEdit, onRemove }) => {
  const displayValue = filter.operator === 'IN' 
    ? `${filter.values?.length || 0} values`
    : formatFilterDisplay(filter);

  return (
    <div className="fs-chip filter-chip" onClick={onEdit}>
      <span className="fs-chip-name">{filter.field}</span>
      <span className="fs-chip-value">{displayValue}</span>
      <button 
        className="fs-chip-remove" 
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
      >
        <FiX size={10} />
      </button>
    </div>
  );
};

// Sorts Panel
const SortsPanel = ({
  sorts,
  showSortPanel,
  setShowSortPanel,
  setShowFilterPanel,
  addSort,
  removeSort,
  updateSortDirection,
  moveSortUp,
  moveSortDown,
  columns,
  rows,
}) => {
  const availableFields = [...columns, ...rows].filter(f => {
    const fieldName = typeof f === 'string' ? f : f.name;
    return !sorts.find(s => s.field === fieldName);
  });

  return (
    <div className="fs-panel">
      {/* Active Sorts */}
      {sorts.length > 0 ? (
        <div className="fs-sort-list">
          {sorts.map((sort, idx) => (
            <SortRow
              key={sort.field}
              sort={sort}
              index={idx}
              total={sorts.length}
              onMoveUp={() => moveSortUp(idx)}
              onMoveDown={() => moveSortDown(idx)}
              onDirectionChange={(dir) => updateSortDirection(sort.field, dir)}
              onRemove={() => removeSort(sort.field)}
            />
          ))}
        </div>
      ) : (
        <div className="fs-empty-state">
          <TbArrowsSort size={16} className="fs-empty-icon" />
          <span>No sort order defined</span>
        </div>
      )}

      {/* Add Sort Action */}
      <button
        className={`fs-add-btn ${showSortPanel ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setShowSortPanel(!showSortPanel);
          setShowFilterPanel(false);
        }}
      >
        {showSortPanel ? <FiX size={12} /> : <FiPlus size={12} />}
        <span>{showSortPanel ? 'Close' : 'Add Sort'}</span>
      </button>

      {/* Add Sort Panel */}
      {showSortPanel && (
        <div className="fs-field-picker">
          {availableFields.length === 0 ? (
            <div className="fs-picker-empty">
              {sorts.length > 0 ? 'All fields already sorted' : 'Add fields to Data Layout first'}
            </div>
          ) : (
            <div className="fs-picker-list">
              {availableFields.map((f) => {
                const fieldName = typeof f === 'string' ? f : f.name;
                return (
                  <div
                    key={fieldName}
                    className="fs-field-item sort-candidate"
                    onClick={() => addSort(fieldName)}
                  >
                    <TbArrowsSort size={12} className="fs-sort-icon" />
                    <span className="fs-field-name">{fieldName}</span>
                    <span className="fs-field-status">Add</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Sort row with reorder/direction controls
const SortRow = ({ sort, index, total, onMoveUp, onMoveDown, onDirectionChange, onRemove }) => {
  const isAsc = sort.direction === 'ASC' || sort.direction === 'asc';
  const isDesc = sort.direction === 'DESC' || sort.direction === 'desc';

  return (
    <div className="fs-sort-row">
      <div className="fs-sort-reorder">
        <button 
          className="fs-reorder-btn"
          onClick={onMoveUp}
          disabled={index === 0}
          title="Move up"
        >
          <FiArrowUp size={10} />
        </button>
        <button 
          className="fs-reorder-btn"
          onClick={onMoveDown}
          disabled={index === total - 1}
          title="Move down"
        >
          <FiArrowDown size={10} />
        </button>
      </div>
      <span className="fs-sort-rank">{index + 1}</span>
      <span className="fs-sort-name">{sort.field}</span>
      <div className="fs-sort-dir-toggle">
        <button
          className={`fs-dir-btn ${isAsc ? 'active' : ''}`}
          onClick={() => onDirectionChange('ASC')}
          title="Ascending"
        >
          <FiArrowUp size={10} />
          <span>Asc</span>
        </button>
        <button
          className={`fs-dir-btn ${isDesc ? 'active' : ''}`}
          onClick={() => onDirectionChange('DESC')}
          title="Descending"
        >
          <FiArrowDown size={10} />
          <span>Desc</span>
        </button>
      </div>
      <button className="fs-sort-remove" onClick={onRemove} title="Remove sort">
        <FiX size={11} />
      </button>
    </div>
  );
};

export default FiltersSortsSection;
