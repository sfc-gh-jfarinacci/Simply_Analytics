/**
 * useSorts - Custom hook for sort state and operations
 */
import { useState, useCallback } from 'react';

export const useSorts = (initialSorts = []) => {
  const [sorts, setSorts] = useState(initialSorts);
  const [showSortPanel, setShowSortPanel] = useState(false);

  // Add a new sort
  const addSort = useCallback((fieldName) => {
    if (sorts.find(s => s.field === fieldName)) return;
    setSorts(prev => [...prev, { field: fieldName, direction: 'ASC' }]);
  }, [sorts]);

  // Remove a sort
  const removeSort = useCallback((fieldName) => {
    setSorts(prev => prev.filter(s => s.field !== fieldName));
  }, []);

  // Update sort direction
  const updateSortDirection = useCallback((fieldName, direction) => {
    setSorts(prev => prev.map(s => 
      s.field === fieldName ? { ...s, direction } : s
    ));
  }, []);

  // Toggle sort direction
  const toggleSortDirection = useCallback((fieldName) => {
    setSorts(prev => prev.map(s => 
      s.field === fieldName 
        ? { ...s, direction: s.direction === 'ASC' ? 'DESC' : 'ASC' } 
        : s
    ));
  }, []);

  // Move sort up in priority
  const moveSortUp = useCallback((index) => {
    if (index === 0) return;
    setSorts(prev => {
      const newSorts = [...prev];
      [newSorts[index - 1], newSorts[index]] = [newSorts[index], newSorts[index - 1]];
      return newSorts;
    });
  }, []);

  // Move sort down in priority
  const moveSortDown = useCallback((index) => {
    setSorts(prev => {
      if (index === prev.length - 1) return prev;
      const newSorts = [...prev];
      [newSorts[index], newSorts[index + 1]] = [newSorts[index + 1], newSorts[index]];
      return newSorts;
    });
  }, []);

  // Get sort for a specific field
  const getSortForField = useCallback((fieldName) => {
    return sorts.find(s => s.field === fieldName);
  }, [sorts]);

  return {
    sorts,
    setSorts,
    showSortPanel,
    setShowSortPanel,
    addSort,
    removeSort,
    updateSortDirection,
    toggleSortDirection,
    moveSortUp,
    moveSortDown,
    getSortForField,
  };
};

export default useSorts;
