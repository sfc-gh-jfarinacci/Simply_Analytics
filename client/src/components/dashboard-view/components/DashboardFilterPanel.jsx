import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FiFilter, FiX, FiPlus, FiTrash2, FiSearch, FiChevronDown } from 'react-icons/fi';
import { useAppStore } from '../../../store/appStore';
import { semanticApi } from '../../../api/apiClient';
import { parseColumnsToMetadata } from '../../widget-editor/utils/parseColumnsToMetadata';
import '../../../styles/DashboardFilterPanel.css';

const DATA_TYPE_CATEGORY = (raw) => {
  const t = (raw || '').toUpperCase();
  if (t.includes('DATE') || t.includes('TIMESTAMP') || t.includes('TIME')) return 'date';
  if (t.includes('BOOL')) return 'boolean';
  if (t.includes('NUMBER') || t.includes('INT') || t.includes('FLOAT') ||
      t.includes('DECIMAL') || t.includes('DOUBLE') || t.includes('NUMERIC') ||
      t.includes('REAL') || t.includes('BIGINT') || t.includes('SMALLINT')) return 'numeric';
  return 'text';
};

const FILTER_TYPES_BY_CATEGORY = {
  text:    [
    { value: 'dropdown', label: 'Dropdown (Multi-select)' },
    { value: 'list',     label: 'List (Single-select)' },
    { value: 'search',   label: 'Search' },
  ],
  numeric: [
    { value: 'slider',   label: 'Range Slider' },
    { value: 'dropdown', label: 'Dropdown (Multi-select)' },
  ],
  date:    [
    { value: 'date-range', label: 'Date Range' },
    { value: 'dropdown',   label: 'Dropdown (Multi-select)' },
  ],
  boolean: [
    { value: 'toggle',   label: 'Toggle' },
  ],
};

const DEFAULT_TYPE_FOR = {
  text: 'dropdown',
  numeric: 'slider',
  date: 'date-range',
  boolean: 'toggle',
};

// ── Slider control (numeric range) ──
const SliderControl = ({ values, min, max, onChange }) => {
  const lo = values[0] ?? min;
  const hi = values[1] ?? max;
  const range = max - min || 1;
  const pctLo = ((lo - min) / range) * 100;
  const pctHi = ((hi - min) / range) * 100;

  const fmt = (v) => {
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };

  return (
    <div className="fp-slider">
      <div className="fp-slider-track">
        <div className="fp-slider-fill" style={{ left: `${pctLo}%`, width: `${pctHi - pctLo}%` }} />
        <input type="range" min={min} max={max} step={(max - min) > 100 ? 1 : 0.1}
          value={lo} onChange={e => onChange([Number(e.target.value), hi])} className="fp-slider-input" />
        <input type="range" min={min} max={max} step={(max - min) > 100 ? 1 : 0.1}
          value={hi} onChange={e => onChange([lo, Number(e.target.value)])} className="fp-slider-input" />
      </div>
      <div className="fp-slider-labels">
        <span>{fmt(lo)}</span>
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
};

// ── Toggle control (boolean) ──
const ToggleControl = ({ value, onChange }) => (
  <div className="fp-toggle-row">
    {[{ v: null, l: 'All' }, { v: true, l: 'True' }, { v: false, l: 'False' }].map(opt => (
      <button key={String(opt.v)} className={`fp-toggle-btn${value === opt.v ? ' active' : ''}`}
        onClick={() => onChange(opt.v)}>{opt.l}</button>
    ))}
  </div>
);

// ── List control (single-select radio) ──
const ListControl = ({ values: distinctValues, selected, onSelect, loading }) => {
  const [search, setSearch] = useState('');
  const filtered = search
    ? distinctValues.filter(v => String(v).toLowerCase().includes(search.toLowerCase()))
    : distinctValues;
  return (
    <div className="fp-list-control">
      {distinctValues.length > 8 && (
        <div className="fp-dropdown-search">
          <FiSearch />
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}
      <div className="fp-list-options">
        <label className="fp-option">
          <input type="radio" checked={selected === null} onChange={() => onSelect(null)} />
          <span>All</span>
        </label>
        {loading && <div className="fp-option-empty">Loading...</div>}
        {filtered.map(val => (
          <label key={String(val)} className="fp-option">
            <input type="radio" checked={selected === val} onChange={() => onSelect(val)} />
            <span>{String(val)}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

// ── Search control (type-ahead) ──
const SearchControl = ({ onApply, onClear, currentValue }) => {
  const [text, setText] = useState(currentValue || '');
  return (
    <div className="fp-search-control">
      <div className="fp-search-input-row">
        <FiSearch />
        <input type="text" placeholder="Type to filter..." value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && text.trim()) onApply(text.trim()); }} />
        {text && <button className="fp-clear-btn" onClick={() => { setText(''); onClear(); }}><FiX /></button>}
      </div>
      {text.trim() && (
        <button className="fp-btn fp-btn-primary fp-btn-sm" onClick={() => onApply(text.trim())}>Apply</button>
      )}
    </div>
  );
};

// ── Main per-field control ──
const FilterFieldControl = ({ field, semanticViewFQN, dashboard, onRemove, isEditMode }) => {
  const { setDashboardFilter, removeDashboardFilter } = useAppStore();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [distinctValues, setDistinctValues] = useState([]);
  const [numericRange, setNumericRange] = useState([0, 100]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [toggleValue, setToggleValue] = useState(null);
  const dropdownRef = useRef(null);

  const fieldName = String(field.name || '');
  const filterType = field.type || 'dropdown';
  const filterKey = `global_${fieldName}`;
  const label = field.label || fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  useEffect(() => {
    if (!fieldName || !semanticViewFQN) return;
    let cancelled = false;
    setLoading(true);

    if (filterType === 'slider') {
      Promise.all([
        semanticApi.query({
          semanticView: semanticViewFQN, dimensions: [], measures: [fieldName],
          filters: [], orderBy: [], limit: 1,
          connectionId: dashboard?.connection_id, role: dashboard?.role, warehouse: dashboard?.warehouse,
          customAggregation: { [fieldName]: 'MIN' },
        }),
        semanticApi.query({
          semanticView: semanticViewFQN, dimensions: [], measures: [fieldName],
          filters: [], orderBy: [], limit: 1,
          connectionId: dashboard?.connection_id, role: dashboard?.role, warehouse: dashboard?.warehouse,
          customAggregation: { [fieldName]: 'MAX' },
        }),
      ]).then(([minRes, maxRes]) => {
        if (cancelled) return;
        const extractVal = (res) => {
          const row = res?.data?.[0];
          if (!row) return 0;
          const key = Object.keys(row).find(k => k.toUpperCase() === fieldName.toUpperCase()) || Object.keys(row)[0];
          return Number(row[key]) || 0;
        };
        const mn = extractVal(minRes);
        const mx = extractVal(maxRes);
        setNumericRange([mn, mx]);
        setSelected([mn, mx]);
        setLoading(false);
      }).catch(() => { if (!cancelled) { setNumericRange([0, 100]); setSelected([0, 100]); setLoading(false); } });
    } else if (filterType !== 'search') {
      semanticApi.query({
        semanticView: semanticViewFQN, dimensions: [fieldName], measures: [],
        filters: [], orderBy: [{ field: fieldName, direction: 'ASC' }], limit: 500,
        connectionId: dashboard?.connection_id, role: dashboard?.role, warehouse: dashboard?.warehouse,
      }).then(result => {
        if (cancelled) return;
        const vals = [...new Set((result?.data || []).map(r => {
          const key = Object.keys(r).find(k => k.toUpperCase() === fieldName.toUpperCase());
          return key ? r[key] : null;
        }).filter(v => v != null))];
        setDistinctValues(vals);
        setLoading(false);
      }).catch(() => { if (!cancelled) setLoading(false); });
    } else {
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [fieldName, filterType, semanticViewFQN, dashboard?.connection_id]);

  // Push filter state to global store
  useEffect(() => {
    if (!fieldName) return;

    if (filterType === 'toggle') {
      if (toggleValue !== null) {
        setDashboardFilter(filterKey, { field: fieldName, operator: 'eq', values: [toggleValue] });
      } else { removeDashboardFilter(filterKey); }
      return;
    }
    if (filterType === 'search') {
      if (selected.length > 0 && selected[0]) {
        setDashboardFilter(filterKey, { field: fieldName, operator: 'like', values: selected });
      } else { removeDashboardFilter(filterKey); }
      return;
    }
    if (filterType === 'slider') {
      const [lo, hi] = selected;
      const [mn, mx] = numericRange;
      if (lo !== mn || hi !== mx) {
        setDashboardFilter(filterKey, { field: fieldName, operator: 'between', values: [lo, hi] });
      } else { removeDashboardFilter(filterKey); }
      return;
    }
    if (filterType === 'date-range') {
      if (selected.some(Boolean)) {
        setDashboardFilter(filterKey, { field: fieldName, operator: 'between', values: selected });
      } else { removeDashboardFilter(filterKey); }
      return;
    }
    if (filterType === 'list') {
      if (selected.length > 0 && selected[0] !== null) {
        setDashboardFilter(filterKey, { field: fieldName, operator: 'eq', values: selected });
      } else { removeDashboardFilter(filterKey); }
      return;
    }
    // dropdown (multi-select)
    if (selected.length > 0) {
      setDashboardFilter(filterKey, { field: fieldName, operator: 'in', values: selected });
    } else { removeDashboardFilter(filterKey); }
  }, [selected, toggleValue, fieldName, filterType, filterKey, numericRange, setDashboardFilter, removeDashboardFilter]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const filtered = search
    ? distinctValues.filter(v => String(v).toLowerCase().includes(search.toLowerCase()))
    : distinctValues;

  const typeBadge = filterType === 'dropdown' ? null
    : filterType === 'slider' ? 'Range'
    : filterType === 'list' ? 'List'
    : filterType === 'search' ? 'Search'
    : filterType === 'date-range' ? 'Date'
    : filterType === 'toggle' ? 'Toggle' : null;

  const hasValue = filterType === 'toggle' ? toggleValue !== null
    : filterType === 'slider' ? (selected[0] !== numericRange[0] || selected[1] !== numericRange[1])
    : filterType === 'search' ? selected.length > 0 && selected[0]
    : selected.length > 0 && (filterType !== 'list' || selected[0] !== null);

  const handleClear = () => {
    if (filterType === 'toggle') setToggleValue(null);
    else if (filterType === 'slider') setSelected([...numericRange]);
    else setSelected([]);
  };

  const header = (
    <div className="fp-field-header">
      <div className="fp-field-label-row">
        <span className="fp-field-label">{label}</span>
        {typeBadge && <span className="fp-type-badge">{typeBadge}</span>}
      </div>
      <div className="fp-field-actions">
        {hasValue && <button className="fp-clear-btn" onClick={handleClear} title="Clear"><FiX /></button>}
        {isEditMode && <button className="fp-field-remove" onClick={onRemove}><FiTrash2 /></button>}
      </div>
    </div>
  );

  // Toggle
  if (filterType === 'toggle') {
    return (
      <div className="fp-field">
        {header}
        <ToggleControl value={toggleValue} onChange={setToggleValue} />
      </div>
    );
  }

  // Date range
  if (filterType === 'date-range') {
    return (
      <div className="fp-field">
        {header}
        <div className="fp-date-range">
          <input type="date" value={selected[0] || ''} onChange={e => setSelected([e.target.value, selected[1] || ''])} />
          <span className="fp-date-sep">to</span>
          <input type="date" value={selected[1] || ''} onChange={e => setSelected([selected[0] || '', e.target.value])} />
        </div>
      </div>
    );
  }

  // Slider
  if (filterType === 'slider') {
    return (
      <div className="fp-field">
        {header}
        {loading ? <div className="fp-option-empty">Loading range...</div> :
          <SliderControl values={selected} min={numericRange[0]} max={numericRange[1]}
            onChange={setSelected} />}
      </div>
    );
  }

  // Search
  if (filterType === 'search') {
    return (
      <div className="fp-field">
        {header}
        <SearchControl currentValue={selected[0] || ''} onApply={v => setSelected([v])} onClear={() => setSelected([])} />
      </div>
    );
  }

  // List (single-select)
  if (filterType === 'list') {
    return (
      <div className="fp-field" ref={dropdownRef}>
        {header}
        <ListControl values={distinctValues} selected={selected[0] ?? null} loading={loading}
          onSelect={v => setSelected(v === null ? [] : [v])} />
      </div>
    );
  }

  // Dropdown (multi-select) – default
  return (
    <div className="fp-field" ref={dropdownRef}>
      {header}
      <button className={`fp-dropdown-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <span>{selected.length === 0 ? 'All' : selected.length === 1 ? String(selected[0]) : `${selected.length} selected`}</span>
        <FiChevronDown className={open ? 'rotated' : ''} />
      </button>
      {open && (
        <div className="fp-dropdown-menu">
          <div className="fp-dropdown-search">
            <FiSearch />
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="fp-dropdown-options">
            {selected.length > 0 && (
              <button className="fp-option fp-option-clear" onClick={() => { setSelected([]); setOpen(false); }}>Clear all</button>
            )}
            {loading && <div className="fp-option-empty">Loading...</div>}
            {!loading && filtered.length === 0 && <div className="fp-option-empty">No values found</div>}
            {filtered.map(val => (
              <label key={String(val)} className="fp-option">
                <input type="checkbox" checked={selected.includes(val)}
                  onChange={() => setSelected(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val])} />
                <span>{String(val)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main panel ──
const DashboardFilterPanel = ({ open, onClose, isEditMode, dashboard, filterFields, onUpdateFilterFields }) => {
  const { getCachedViewMetadata, setCachedViewMetadata } = useAppStore();
  const [availableFields, setAvailableFields] = useState([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('');

  const semanticViewRef = dashboard?.semanticViewsReferenced?.[0];
  const semanticViewFQN = useMemo(() => {
    if (!semanticViewRef) return '';
    if (typeof semanticViewRef === 'string') return semanticViewRef;
    if (semanticViewRef.fullyQualifiedName) return semanticViewRef.fullyQualifiedName;
    if (semanticViewRef.full_name) return semanticViewRef.full_name;
    if (semanticViewRef.database && semanticViewRef.schema && semanticViewRef.name)
      return `${semanticViewRef.database}.${semanticViewRef.schema}.${semanticViewRef.name}`;
    if (semanticViewRef.databaseName && semanticViewRef.schemaName && semanticViewRef.name)
      return `${semanticViewRef.databaseName}.${semanticViewRef.schemaName}.${semanticViewRef.name}`;
    return semanticViewRef.name || '';
  }, [semanticViewRef]);

  const extractFields = useCallback((metadata) => {
    const dims = [...(metadata.dimensions || []), ...(metadata.measures || [])];
    return dims
      .map(d => ({ name: d.name, dataType: d.type || 'string', displayName: d.displayName || d.name }))
      .filter(d => d.name);
  }, []);

  useEffect(() => {
    if (!open || !semanticViewFQN || !dashboard?.connection_id) return;

    const cached = getCachedViewMetadata(semanticViewFQN);
    if (cached) {
      setAvailableFields(extractFields(cached));
      return;
    }

    let cancelled = false;
    setLoadingFields(true);
    const parts = semanticViewFQN.split('.');
    if (parts.length === 3) {
      semanticApi.getView(parts[0], parts[1], parts[2], {
        connectionId: dashboard.connection_id, role: dashboard.role, warehouse: dashboard.warehouse,
      }).then(data => {
        if (cancelled) return;
        let metadata;
        if (data?.columns?.length > 0) {
          metadata = parseColumnsToMetadata(data.columns);
        } else if (data?.dimensions || data?.measures) {
          metadata = { dimensions: data.dimensions || [], measures: data.measures || [] };
        } else {
          metadata = { dimensions: [], measures: [] };
        }
        setCachedViewMetadata(semanticViewFQN, metadata);
        setAvailableFields(extractFields(metadata));
        setLoadingFields(false);
      }).catch(() => { if (!cancelled) setLoadingFields(false); });
    } else { setLoadingFields(false); }
    return () => { cancelled = true; };
  }, [open, semanticViewFQN, dashboard?.connection_id, getCachedViewMetadata, setCachedViewMetadata, extractFields]);

  // When a field is selected, auto-set the best filter type for its data type
  const selectedFieldMeta = useMemo(
    () => availableFields.find(f => f.name === newFieldName),
    [availableFields, newFieldName],
  );
  const selectedCategory = selectedFieldMeta ? DATA_TYPE_CATEGORY(selectedFieldMeta.dataType) : 'text';
  const typeOptions = FILTER_TYPES_BY_CATEGORY[selectedCategory] || FILTER_TYPES_BY_CATEGORY.text;

  useEffect(() => {
    if (newFieldName && selectedFieldMeta) {
      setNewFieldType(DEFAULT_TYPE_FOR[selectedCategory] || 'dropdown');
    }
  }, [newFieldName, selectedFieldMeta, selectedCategory]);

  const handleAddField = useCallback(() => {
    if (!newFieldName) return;
    if (filterFields.some(f => f.name === newFieldName)) return;
    const meta = availableFields.find(f => f.name === newFieldName);
    onUpdateFilterFields([...filterFields, {
      name: newFieldName,
      type: newFieldType || 'dropdown',
      label: '',
      dataType: meta?.dataType || 'string',
    }]);
    setNewFieldName('');
    setNewFieldType('');
    setAddingField(false);
  }, [newFieldName, newFieldType, filterFields, onUpdateFilterFields, availableFields]);

  const handleRemoveField = useCallback((fieldName) => {
    onUpdateFilterFields(filterFields.filter(f => f.name !== fieldName));
    useAppStore.getState().removeDashboardFilter(`global_${fieldName}`);
  }, [filterFields, onUpdateFilterFields]);

  const unusedFields = availableFields.filter(f => !filterFields.some(ff => ff.name === f.name));

  return (
    <div className={`dashboard-filter-panel ${open ? 'open' : ''}`}>
      <div className="fp-header">
        <div className="fp-header-left">
          <FiFilter />
          <span className="fp-title">Filters</span>
          {filterFields.length > 0 && <span className="fp-count">{filterFields.length}</span>}
        </div>
        <button className="fp-close" onClick={onClose}><FiX /></button>
      </div>

      <div className="fp-body">
        {filterFields.length === 0 && !isEditMode && (
          <div className="fp-empty">
            <FiFilter style={{ fontSize: 24, opacity: 0.3 }} />
            <span>No filters configured</span>
            <span className="fp-empty-hint">Enter edit mode to add filter fields</span>
          </div>
        )}
        {filterFields.length === 0 && isEditMode && (
          <div className="fp-empty">
            <FiFilter style={{ fontSize: 24, opacity: 0.3 }} />
            <span>Add fields to filter your dashboard</span>
          </div>
        )}

        {filterFields.map(field => (
          <FilterFieldControl key={field.name} field={field} semanticViewFQN={semanticViewFQN}
            dashboard={dashboard} isEditMode={isEditMode} onRemove={() => handleRemoveField(field.name)} />
        ))}

        {isEditMode && (
          <div className="fp-add-section">
            {!addingField ? (
              <button className="fp-add-btn" onClick={() => setAddingField(true)}>
                <FiPlus /> Add Filter Field
              </button>
            ) : (
              <div className="fp-add-form">
                <select className="fp-select" value={newFieldName} onChange={e => setNewFieldName(e.target.value)} autoFocus>
                  <option value="">Select field...</option>
                  {unusedFields.map(f => (
                    <option key={f.name} value={f.name}>
                      {f.displayName || f.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      {' '}({DATA_TYPE_CATEGORY(f.dataType)})
                    </option>
                  ))}
                  {loadingFields && <option disabled>Loading fields...</option>}
                </select>
                {newFieldName && (
                  <select className="fp-select fp-select-sm" value={newFieldType} onChange={e => setNewFieldType(e.target.value)}>
                    {typeOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
                <div className="fp-add-actions">
                  <button className="fp-btn fp-btn-primary" onClick={handleAddField} disabled={!newFieldName}>Add</button>
                  <button className="fp-btn" onClick={() => { setAddingField(false); setNewFieldName(''); setNewFieldType(''); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardFilterPanel;
