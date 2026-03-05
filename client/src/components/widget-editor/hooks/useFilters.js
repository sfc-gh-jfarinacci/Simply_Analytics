/**
 * useFilters - Custom hook for filter state and operations
 */
import { useState, useRef, useMemo, useCallback } from 'react';
import { semanticApi } from '../../../api/apiClient';
import { getDataTypeCategory } from '../utils';

const BATCH_SIZE = 100;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const useFilters = ({
  initialFilters = [],
  allDimensions = [],
  measures = [],
  customColumns = [],
  getFullyQualifiedNameRef, // Pass a ref that will be updated with the function
  currentDashboard,
}) => {
  // Use the ref to get the current function value
  const getFullyQualifiedName = () => getFullyQualifiedNameRef?.current?.();
  // Filter state
  const [filters, setFilters] = useState(initialFilters);
  const [filterPopup, setFilterPopup] = useState({ 
    open: false, 
    field: null, 
    values: [], 
    loading: false,
    loadingMore: false,
    totalCount: 0,
    hasMore: false,
    mode: 'simple',
    advancedOperator: 'IN',
    advancedValue: '',
    advancedValue2: '',
    customExpression: '',
    x: 0,
    y: 0,
    openUp: false,
  });
  const [filterSearch, setFilterSearch] = useState('');
  const filterSearchTimeoutRef = useRef(null);
  const filterValuesCache = useRef(new Map());
  const filterPopupRef = useRef(null);

  // Custom expression autocomplete state
  const [exprAutocomplete, setExprAutocomplete] = useState({
    show: false,
    suggestions: [],
    selectedIndex: 0,
    position: { top: 0, left: 0 },
  });
  const customExprRef = useRef(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Cache key helper
  const getCacheKey = (fieldName, search = '') => `${fieldName}:${search}`;

  // Fetch filter values from API
  const fetchFilterValues = useCallback(async (field, search = '', offset = 0) => {
    try {
      const fqn = getFullyQualifiedName();
      if (!fqn) return { values: [], totalCount: 0, hasMore: false };
      
      const result = await semanticApi.getDistinctValues({
        semanticView: fqn,
        field: field.name,
        search,
        limit: BATCH_SIZE,
        offset,
        connectionId: currentDashboard?.connection_id,
        role: currentDashboard?.role,
        warehouse: currentDashboard?.warehouse,
      });
      
      return result;
    } catch (error) {
      console.error('Failed to fetch filter values:', error);
      return { values: [], totalCount: 0, hasMore: false };
    }
  }, [getFullyQualifiedName, currentDashboard]);

  // Open filter popup
  const openFilterPopup = useCallback(async (field, event) => {
    const existingFilter = filters.find(f => f.field === field.name);
    const isAdvancedFilter = existingFilter && existingFilter.operator !== 'IN';
    
    // Measures and calculated fields can't have distinct values fetched,
    // so they always open in advanced/expression mode
    const category = field.fieldCategory;
    const skipValueFetch = category === 'measure' || category === 'calculated';
    const defaultMode = skipValueFetch ? 'advanced' : 'simple';
    
    let advancedValue = existingFilter?.value || '';
    if (existingFilter?.operator === 'IN' && existingFilter?.values?.length) {
      advancedValue = existingFilter.values.join(', ');
    }
    
    // Calculate position
    let x = 360, y = 200, openUp = false;
    
    if (event?.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      const popupHeight = 400;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      openUp = spaceBelow < popupHeight && spaceAbove > spaceBelow;
      x = rect.right + 8;
      y = openUp ? rect.bottom : rect.top;
      
      if (x + 380 > window.innerWidth) {
        x = rect.left - 388;
      }
    }
    
    // For measures/calculated fields, open directly in advanced mode without fetching
    if (skipValueFetch) {
      setFilterPopup({ 
        open: true, field, values: [], 
        loading: false, loadingMore: false,
        totalCount: 0, hasMore: false,
        mode: isAdvancedFilter ? 'advanced' : defaultMode,
        advancedOperator: existingFilter?.operator || (category === 'measure' ? '>' : 'IN'),
        advancedValue,
        advancedValue2: existingFilter?.value2 || '',
        customExpression: existingFilter?.customExpression || '',
        x, y, openUp,
      });
      setFilterSearch('');
      return;
    }
    
    // Check cache
    const cacheKey = getCacheKey(field.name, '');
    const cached = filterValuesCache.current.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      setFilterPopup({ 
        open: true, field, 
        values: cached.values, 
        loading: false, loadingMore: false,
        totalCount: cached.totalCount,
        hasMore: cached.hasMore,
        mode: isAdvancedFilter ? 'advanced' : 'simple',
        advancedOperator: existingFilter?.operator || 'IN',
        advancedValue,
        advancedValue2: existingFilter?.value2 || '',
        customExpression: existingFilter?.customExpression || '',
        x, y, openUp,
      });
      setFilterSearch('');
      return;
    }
    
    // Show loading state
    setFilterPopup({ 
      open: true, field, values: [], 
      loading: true, loadingMore: false,
      totalCount: 0, hasMore: false,
      mode: isAdvancedFilter ? 'advanced' : 'simple',
      advancedOperator: existingFilter?.operator || 'IN',
      advancedValue,
      advancedValue2: existingFilter?.value2 || '',
      customExpression: existingFilter?.customExpression || '',
      x, y, openUp,
    });
    setFilterSearch('');
    
    // Fetch values
    const result = await fetchFilterValues(field, '');
    
    filterValuesCache.current.set(cacheKey, {
      values: result.values,
      totalCount: result.totalCount,
      hasMore: result.hasMore,
      timestamp: now,
    });
    
    setFilterPopup(prev => ({ 
      ...prev, 
      values: result.values, 
      totalCount: result.totalCount,
      hasMore: result.hasMore,
      loading: false 
    }));
  }, [filters, fetchFilterValues]);

  // Load more values
  const handleLoadMore = useCallback(async () => {
    if (!filterPopup.field || filterPopup.loadingMore || !filterPopup.hasMore) return;
    
    setFilterPopup(prev => ({ ...prev, loadingMore: true }));
    
    const result = await fetchFilterValues(
      filterPopup.field, 
      filterSearch, 
      filterPopup.values.length
    );
    
    const newValues = [...filterPopup.values, ...result.values];
    const hasMore = newValues.length < result.totalCount;
    
    const cacheKey = getCacheKey(filterPopup.field.name, filterSearch);
    filterValuesCache.current.set(cacheKey, {
      values: newValues,
      totalCount: result.totalCount,
      hasMore,
      timestamp: Date.now(),
    });
    
    setFilterPopup(prev => ({ 
      ...prev, 
      values: newValues,
      hasMore,
      loadingMore: false 
    }));
  }, [filterPopup, filterSearch, fetchFilterValues]);

  // Handle scroll to load more
  const handleFilterListScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollTop + clientHeight >= scrollHeight * 0.8) {
      handleLoadMore();
    }
  }, [handleLoadMore]);

  // Handle search with debouncing
  const handleFilterSearchChange = useCallback(async (value) => {
    setFilterSearch(value);
    
    if (filterSearchTimeoutRef.current) {
      clearTimeout(filterSearchTimeoutRef.current);
    }
    
    const cacheKey = getCacheKey(filterPopup.field?.name, value);
    const cached = filterValuesCache.current.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      setFilterPopup(prev => ({ 
        ...prev, 
        values: cached.values, 
        totalCount: cached.totalCount,
        hasMore: cached.hasMore,
      }));
      return;
    }
    
    filterSearchTimeoutRef.current = setTimeout(async () => {
      if (!filterPopup.field) return;
      
      setFilterPopup(prev => ({ ...prev, loading: true }));
      const result = await fetchFilterValues(filterPopup.field, value);
      
      filterValuesCache.current.set(cacheKey, {
        values: result.values,
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        timestamp: Date.now(),
      });
      
      setFilterPopup(prev => ({ 
        ...prev, 
        values: result.values, 
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        loading: false 
      }));
    }, 300);
  }, [filterPopup.field, fetchFilterValues]);

  // Close filter popup
  const closeFilterPopup = useCallback(() => {
    if (filterSearchTimeoutRef.current) {
      clearTimeout(filterSearchTimeoutRef.current);
    }
    setFilterPopup({ 
      open: false, field: null, values: [], 
      loading: false, totalCount: 0, hasMore: false,
      mode: 'simple', advancedOperator: 'IN',
      advancedValue: '', advancedValue2: '', customExpression: '',
      x: 0, y: 0, openUp: false,
    });
    setFilterSearch('');
    setExprAutocomplete({ show: false, suggestions: [], selectedIndex: 0, position: { top: 0, left: 0 } });
  }, []);

  // All filterable fields for autocomplete
  const allFilterableFields = useMemo(() => {
    const fields = [];
    allDimensions.forEach(d => fields.push({ name: d.name, type: 'dimension' }));
    (measures || []).forEach(m => fields.push({ name: m.name, type: 'measure' }));
    customColumns.forEach(c => fields.push({ name: c.name, type: 'calculated' }));
    return fields;
  }, [allDimensions, measures, customColumns]);

  // Handle custom expression input with autocomplete
  // Uses [[field_name]] syntax consistent with formula bar's bracket notation
  const handleCustomExpressionChange = useCallback((e) => {
    const value = e.target.value;
    const pos = e.target.selectionStart;
    
    setFilterPopup(prev => ({ ...prev, customExpression: value }));
    
    const textBeforeCursor = value.slice(0, pos);
    const lastOpen = textBeforeCursor.lastIndexOf('[[');
    const lastClose = textBeforeCursor.lastIndexOf(']]');
    
    if (lastOpen > lastClose) {
      const filterText = textBeforeCursor.slice(lastOpen + 2).toLowerCase();
      const suggestions = allFilterableFields.filter(f => 
        f.name.toLowerCase().includes(filterText)
      ).slice(0, 10);
      
      if (suggestions.length > 0) {
        const textarea = customExprRef.current;
        if (textarea) {
          const rect = textarea.getBoundingClientRect();
          setExprAutocomplete({
            show: true,
            suggestions,
            selectedIndex: 0,
            position: { top: rect.bottom + 4, left: rect.left, width: rect.width },
          });
        }
      } else {
        setExprAutocomplete(prev => ({ ...prev, show: false }));
      }
    } else {
      setExprAutocomplete(prev => ({ ...prev, show: false }));
    }
  }, [allFilterableFields]);

  // Insert autocomplete selection using [[field_name]] syntax
  const insertExprAutocomplete = useCallback((suggestion) => {
    const textarea = customExprRef.current;
    if (!textarea) return;
    
    const value = filterPopup.customExpression || '';
    const pos = textarea.selectionStart;
    const textBeforeCursor = value.slice(0, pos);
    const textAfterCursor = value.slice(pos);
    
    const lastOpen = textBeforeCursor.lastIndexOf('[[');
    const beforeOpen = textBeforeCursor.slice(0, lastOpen);
    
    const newValue = `${beforeOpen}[[${suggestion.name}]]${textAfterCursor}`;
    const newCursorPos = beforeOpen.length + suggestion.name.length + 4;
    
    setFilterPopup(prev => ({ ...prev, customExpression: newValue }));
    setExprAutocomplete(prev => ({ ...prev, show: false }));
    
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }, [filterPopup.customExpression]);

  // Handle keyboard navigation
  const handleExprKeyDown = useCallback((e) => {
    if (!exprAutocomplete.show) return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setExprAutocomplete(prev => ({
          ...prev,
          selectedIndex: Math.min(prev.selectedIndex + 1, prev.suggestions.length - 1)
        }));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setExprAutocomplete(prev => ({
          ...prev,
          selectedIndex: Math.max(prev.selectedIndex - 1, 0)
        }));
        break;
      case 'Tab':
      case 'Enter':
        if (exprAutocomplete.suggestions.length > 0) {
          e.preventDefault();
          insertExprAutocomplete(exprAutocomplete.suggestions[exprAutocomplete.selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setExprAutocomplete(prev => ({ ...prev, show: false }));
        break;
    }
  }, [exprAutocomplete, insertExprAutocomplete]);

  // Apply advanced filter
  const applyAdvancedFilter = useCallback(() => {
    const field = filterPopup.field?.name;
    const fieldType = filterPopup.field?.type;
    const operator = filterPopup.advancedOperator;
    const value = filterPopup.advancedValue;
    const value2 = filterPopup.advancedValue2;
    const customExpression = filterPopup.customExpression;
    
    if (!field) return;
    
    if (operator === 'CUSTOM') {
      if (!customExpression?.trim()) return;
      setFilters(prev => {
        const filtered = prev.filter(f => f.field !== field);
        return [...filtered, { field, operator: 'CUSTOM', customExpression: customExpression.trim() }];
      });
      closeFilterPopup();
      return;
    }
    
    if (['IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE'].includes(operator)) {
      setFilters(prev => {
        const filtered = prev.filter(f => f.field !== field);
        return [...filtered, { field, operator }];
      });
      closeFilterPopup();
      return;
    }
    
    if (operator === 'IN' || operator === 'NOT IN') {
      if (!value) return;
      const isNumeric = getDataTypeCategory(fieldType) === 'numeric';
      const values = value.split(',')
        .map(v => v.trim())
        .filter(v => v !== '')
        .map(v => isNumeric ? (isNaN(Number(v)) ? v : Number(v)) : v);
      
      if (values.length === 0) return;
      
      setFilters(prev => {
        const filtered = prev.filter(f => f.field !== field);
        return [...filtered, { field, operator, values }];
      });
      closeFilterPopup();
      return;
    }
    
    if (operator === 'BETWEEN') {
      if (!value || !value2) return;
      setFilters(prev => {
        const filtered = prev.filter(f => f.field !== field);
        return [...filtered, { field, operator, value, value2 }];
      });
      closeFilterPopup();
      return;
    }
    
    if (!value && value !== 0) return;
    
    setFilters(prev => {
      const filtered = prev.filter(f => f.field !== field);
      return [...filtered, { field, operator, value }];
    });
    closeFilterPopup();
  }, [filterPopup, closeFilterPopup]);

  // Toggle filter value
  const toggleFilterValue = useCallback((value) => {
    const field = filterPopup.field?.name;
    if (!field) return;

    setFilters(prev => {
      const existingFilter = prev.find(f => f.field === field);
      
      if (existingFilter) {
        const values = existingFilter.values || [];
        const newValues = values.includes(value)
          ? values.filter(v => v !== value)
          : [...values, value];
        
        if (newValues.length === 0) {
          return prev.filter(f => f.field !== field);
        }
        
        return prev.map(f => 
          f.field === field 
            ? { ...f, values: newValues, operator: 'IN' }
            : f
        );
      } else {
        return [...prev, { field, operator: 'IN', values: [value] }];
      }
    });
  }, [filterPopup.field]);

  // Check if value is selected
  const isValueSelected = useCallback((value) => {
    const field = filterPopup.field?.name;
    const filter = filters.find(f => f.field === field);
    return filter?.values?.includes(value) || false;
  }, [filterPopup.field, filters]);

  // Remove filter
  const removeFilter = useCallback((fieldName) => {
    setFilters(prev => prev.filter(f => f.field !== fieldName));
  }, []);

  // Get filter for field
  const getFilterForField = useCallback((fieldName) => {
    return filters.find(f => f.field === fieldName);
  }, [filters]);

  return {
    // State
    filters,
    setFilters,
    filterPopup,
    setFilterPopup,
    filterSearch,
    filterPopupRef,
    showFilterPanel,
    setShowFilterPanel,
    // Autocomplete
    exprAutocomplete,
    setExprAutocomplete,
    customExprRef,
    // Actions
    openFilterPopup,
    closeFilterPopup,
    handleFilterListScroll,
    handleFilterSearchChange,
    handleCustomExpressionChange,
    handleExprKeyDown,
    insertExprAutocomplete,
    applyAdvancedFilter,
    toggleFilterValue,
    isValueSelected,
    removeFilter,
    getFilterForField,
  };
};

export default useFilters;
