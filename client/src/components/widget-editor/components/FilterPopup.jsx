/**
 * FilterPopup - Filter configuration popup with simple and advanced modes
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { FiFilter, FiX, FiSearch, FiDatabase } from 'react-icons/fi';
import { getDataTypeIcon, getDataTypeCategory, getOperatorsForType } from '../utils';

const FilterPopup = ({
  filterPopup,
  setFilterPopup,
  filterPopupRef,
  closeFilterPopup,
  filterSearch,
  handleFilterSearchChange,
  handleFilterListScroll,
  isValueSelected,
  toggleFilterValue,
  filters,
  removeFilter,
  applyAdvancedFilter,
  // Custom expression autocomplete
  customExprRef,
  handleCustomExpressionChange,
  handleExprKeyDown,
  exprAutocomplete,
  setExprAutocomplete,
  insertExprAutocomplete,
}) => {
  if (!filterPopup.open) return null;

  return createPortal(
    <div className="filter-popup-overlay positioned" onClick={closeFilterPopup}>
      <div 
        className={`filter-popup positioned ${filterPopup.openUp ? 'open-up' : ''}`}
        ref={filterPopupRef}
        style={{
          position: 'fixed',
          left: filterPopup.x,
          top: filterPopup.openUp ? 'auto' : filterPopup.y,
          bottom: filterPopup.openUp ? (window.innerHeight - filterPopup.y) : 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="filter-popup-header">
          <h4>
            <FiFilter />
            {filterPopup.field?.name}
          </h4>
          <div className="filter-mode-toggle">
            <button 
              className={`mode-btn ${filterPopup.mode === 'simple' ? 'active' : ''}`}
              onClick={() => setFilterPopup(prev => ({ ...prev, mode: 'simple' }))}
            >
              Select
            </button>
            <button 
              className={`mode-btn ${filterPopup.mode === 'advanced' ? 'active' : ''}`}
              onClick={() => setFilterPopup(prev => ({ ...prev, mode: 'advanced' }))}
            >
              Expression
            </button>
          </div>
          <button className="close-btn" onClick={closeFilterPopup}>
            <FiX />
          </button>
        </div>
        {/* Loading bar - same blue bar as dashboard widgets */}
        {filterPopup.loading && (
          <div className="filter-popup-loading-bar" />
        )}
        
        {filterPopup.mode === 'simple' ? (
          <SimpleFilterMode
            filterPopup={filterPopup}
            filterSearch={filterSearch}
            handleFilterSearchChange={handleFilterSearchChange}
            handleFilterListScroll={handleFilterListScroll}
            isValueSelected={isValueSelected}
            toggleFilterValue={toggleFilterValue}
            filters={filters}
            removeFilter={removeFilter}
            closeFilterPopup={closeFilterPopup}
          />
        ) : (
          <AdvancedFilterMode
            filterPopup={filterPopup}
            setFilterPopup={setFilterPopup}
            removeFilter={removeFilter}
            applyAdvancedFilter={applyAdvancedFilter}
            customExprRef={customExprRef}
            handleCustomExpressionChange={handleCustomExpressionChange}
            handleExprKeyDown={handleExprKeyDown}
            exprAutocomplete={exprAutocomplete}
            setExprAutocomplete={setExprAutocomplete}
            insertExprAutocomplete={insertExprAutocomplete}
          />
        )}
      </div>
    </div>,
    document.body
  );
};

// Simple filter mode - checkbox list
const SimpleFilterMode = ({
  filterPopup,
  filterSearch,
  handleFilterSearchChange,
  handleFilterListScroll,
  isValueSelected,
  toggleFilterValue,
  filters,
  removeFilter,
  closeFilterPopup,
}) => (
  <>
    <div className="filter-popup-search">
      <FiSearch />
      <input
        type="text"
        placeholder="Type to search..."
        value={filterSearch}
        onChange={(e) => handleFilterSearchChange(e.target.value)}
        autoFocus
      />
      {filterSearch && (
        <button className="clear-search" onClick={() => handleFilterSearchChange('')}>
          <FiX />
        </button>
      )}
    </div>
    
    {/* Count info / loading status - same position */}
    {filterPopup.loading ? (
      <div className="filter-count-info">
        <FiDatabase className="filter-count-loading-icon" />
        Fetching values from database...
      </div>
    ) : filterPopup.totalCount > 0 ? (
      <div className="filter-count-info">
        {filterPopup.hasMore ? (
          <>
            Showing <strong>{filterPopup.values.length}</strong> of <strong>{filterPopup.totalCount.toLocaleString()}</strong>
          </>
        ) : (
          <>{filterPopup.values.length} value{filterPopup.values.length !== 1 ? 's' : ''}</>
        )}
      </div>
    ) : null}
    
    <div 
      className="filter-popup-content"
      onScroll={handleFilterListScroll}
    >
      {filterPopup.loading ? (
        <div className="filter-values-list">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="filter-value-item skeleton-item">
              <div className="skeleton-checkbox" />
              <div className="skeleton-text" style={{ width: `${50 + Math.sin(i * 2.1) * 35}%`, animationDelay: `${i * 80}ms` }} />
            </div>
          ))}
        </div>
      ) : filterPopup.values.length === 0 ? (
        <div className="filter-empty">
          {filterSearch ? (
            <>
              <span className="empty-icon">🔍</span>
              <span>No matches for "{filterSearch}"</span>
              <button className="clear-search-btn" onClick={() => handleFilterSearchChange('')}>
                Clear search
              </button>
            </>
          ) : (
            <span>No values available</span>
          )}
        </div>
      ) : (
        <div className="filter-values-list">
          {filterPopup.values.map((value, idx) => (
            <label key={idx} className={`filter-value-item ${isValueSelected(value) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={isValueSelected(value)}
                onChange={() => toggleFilterValue(value)}
              />
              <span className="value-text">{String(value)}</span>
            </label>
          ))}
          {filterPopup.loadingMore && (
            <div className="filter-loading-more">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          )}
          {filterPopup.hasMore && !filterPopup.loadingMore && (
            <div className="filter-scroll-hint">↓ Scroll for more</div>
          )}
        </div>
      )}
    </div>
    
    <div className="filter-popup-footer">
      <span className="selection-count">
        <strong>{filters.find(f => f.field === filterPopup.field?.name)?.values?.length || 0}</strong> selected
      </span>
      <div className="filter-actions">
        {(filters.find(f => f.field === filterPopup.field?.name)?.values?.length || 0) > 0 && (
          <button 
            className="btn btn-secondary btn-sm"
            onClick={() => removeFilter(filterPopup.field?.name)}
          >
            Clear
          </button>
        )}
        <button 
          className="btn btn-primary btn-sm"
          onClick={closeFilterPopup}
        >
          Apply
        </button>
      </div>
    </div>
  </>
);

// Advanced filter mode - operator & value inputs
const AdvancedFilterMode = ({
  filterPopup,
  setFilterPopup,
  removeFilter,
  applyAdvancedFilter,
  customExprRef,
  handleCustomExpressionChange,
  handleExprKeyDown,
  exprAutocomplete,
  setExprAutocomplete,
  insertExprAutocomplete,
}) => {
  const TypeIcon = getDataTypeIcon(filterPopup.field?.type);
  
  return (
    <>
      <div className="filter-advanced-content">
        <div className="advanced-filter-type-hint">
          <span className="type-badge">
            <TypeIcon />
            {getDataTypeCategory(filterPopup.field?.type)}
          </span>
        </div>
        
        <div className="advanced-filter-row">
          <label>Condition</label>
          <select 
            className="operator-select"
            value={filterPopup.advancedOperator}
            onChange={(e) => setFilterPopup(prev => ({ 
              ...prev, 
              advancedOperator: e.target.value,
              advancedValue: '',
              advancedValue2: '',
            }))}
          >
            {getOperatorsForType(filterPopup.field?.type).map(op => (
              <option key={op.value} value={op.value}>
                {op.symbol} {op.label}
              </option>
            ))}
          </select>
        </div>
        
        {/* Value input(s) based on operator */}
        {!['IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE', 'CUSTOM'].includes(filterPopup.advancedOperator) && (
          <div className="advanced-filter-row">
            <label>
              {filterPopup.advancedOperator === 'BETWEEN' ? 'From' : 
               filterPopup.advancedOperator === 'IN' ? 'Values (comma-separated)' : 'Value'}
            </label>
            <input 
              type="text"
              className="value-input"
              placeholder="Enter value..."
              value={filterPopup.advancedValue}
              onChange={(e) => setFilterPopup(prev => ({ ...prev, advancedValue: e.target.value }))}
            />
          </div>
        )}
        
        {/* Second value for BETWEEN */}
        {filterPopup.advancedOperator === 'BETWEEN' && (
          <div className="advanced-filter-row">
            <label>To</label>
            <input 
              type="text"
              className="value-input"
              placeholder="Enter end value..."
              value={filterPopup.advancedValue2}
              onChange={(e) => setFilterPopup(prev => ({ ...prev, advancedValue2: e.target.value }))}
            />
          </div>
        )}
        
        {/* Custom Expression input with autocomplete */}
        {filterPopup.advancedOperator === 'CUSTOM' && (
          <div className="advanced-filter-row custom-expr-container">
            <label>
              Custom SQL Expression
              <span className="label-hint">Type [[ for field autocomplete</span>
            </label>
            <div className="custom-expr-wrapper">
              <textarea 
                ref={customExprRef}
                className="value-input custom-expression-input"
                placeholder={`e.g., [[${filterPopup.field?.name}]] > 100 AND [[${filterPopup.field?.name}]] < 500`}
                value={filterPopup.customExpression || ''}
                onChange={handleCustomExpressionChange}
                onKeyDown={handleExprKeyDown}
                rows={3}
              />
              {/* Autocomplete dropdown */}
              {exprAutocomplete.show && exprAutocomplete.suggestions.length > 0 && createPortal(
                <div 
                  className="expr-autocomplete-dropdown"
                  style={{
                    position: 'fixed',
                    top: exprAutocomplete.position.top,
                    left: exprAutocomplete.position.left,
                    width: exprAutocomplete.position.width,
                  }}
                >
                  {exprAutocomplete.suggestions.map((s, idx) => (
                    <div
                      key={s.name}
                      className={`autocomplete-item ${idx === exprAutocomplete.selectedIndex ? 'selected' : ''} ${s.type}`}
                      onClick={() => insertExprAutocomplete(s)}
                      onMouseEnter={() => setExprAutocomplete(prev => ({ ...prev, selectedIndex: idx }))}
                    >
                      <span className="field-name">{s.name}</span>
                      <span className="field-type">{s.type}</span>
                    </div>
                  ))}
                </div>,
                document.body
              )}
            </div>
            <div className="expression-help">
              <span className="help-item">
                <code>[[field]]</code> → field reference
              </span>
              <span className="help-item">
                <code>YEAR(...)</code>, <code>MONTH(...)</code> → date functions
              </span>
            </div>
          </div>
        )}
        
        {/* Expression Preview */}
        <div className="advanced-filter-preview">
          <label>WHERE Clause Preview</label>
          <code className="expression-preview">
            {filterPopup.advancedOperator === 'CUSTOM' 
              ? (filterPopup.customExpression || '-- enter expression above --')
              : <>
                  {filterPopup.field?.name}{' '}
                  {filterPopup.advancedOperator}{' '}
                  {filterPopup.advancedOperator === 'IN' 
                    ? `(${filterPopup.advancedValue || '?'})`
                    : filterPopup.advancedOperator === 'BETWEEN' 
                      ? `${filterPopup.advancedValue || '?'} AND ${filterPopup.advancedValue2 || '?'}`
                      : ['IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE'].includes(filterPopup.advancedOperator)
                        ? ''
                        : filterPopup.advancedValue || '?'
                  }
                </>
            }
          </code>
        </div>
      </div>
      
      <div className="filter-popup-footer">
        <span className="selection-count">
          Advanced filter
        </span>
        <div className="filter-actions">
          <button 
            className="btn btn-secondary btn-sm"
            onClick={() => removeFilter(filterPopup.field?.name)}
          >
            Clear
          </button>
          <button 
            className="btn btn-primary btn-sm"
            onClick={applyAdvancedFilter}
            disabled={
              !['IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE'].includes(filterPopup.advancedOperator) &&
              !(filterPopup.advancedOperator === 'CUSTOM' && filterPopup.customExpression?.trim()) &&
              !filterPopup.advancedValue &&
              filterPopup.advancedValue !== 0
            }
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
};

export default FilterPopup;
