/**
 * useDragDrop - Custom hook for drag and drop field handling
 */
import { useState, useCallback } from 'react';

export const useDragDrop = ({
  columns,
  rows,
  values,
  setColumns,
  setRows,
  setValues,
  setMarkFields,
  customColumns,
  sorts,
  setSorts,
}) => {
  const [draggedField, setDraggedField] = useState(null);
  const [dragSource, setDragSource] = useState(null);
  const [dragOverZone, setDragOverZone] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dragOverShelf, setDragOverShelf] = useState(null);

  // Drag handlers - for dragging from field list
  const handleFieldDragStart = useCallback((e, field, fieldType) => {
    setDraggedField({ name: field, type: fieldType });
    setDragSource('list');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(field));
  }, []);

  const handleFieldDragEnd = useCallback(() => {
    setDraggedField(null);
    setDragSource(null);
    setDragOverShelf(null);
  }, []);

  // Inline config panel shelf handlers
  const handleShelfDragOver = useCallback((e, shelf) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverShelf(shelf);
  }, []);

  const handleShelfDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverShelf(null);
    }
  }, []);

  const handleShelfDrop = useCallback((e, shelf) => {
    e.preventDefault();
    setDragOverShelf(null);
    
    try {
      const fieldData = JSON.parse(e.dataTransfer.getData('text/plain'));
      const field = typeof fieldData === 'object' ? fieldData : { name: fieldData };
      
      if (shelf === 'columns') {
        setColumns(prev => [...prev, field]);
      } else if (shelf === 'rows') {
        setRows(prev => [...prev, field]);
      } else if (shelf === 'values') {
        setValues(prev => [...prev, field]);
      }
    } catch (err) {
      const fieldName = e.dataTransfer.getData('text/plain');
      if (fieldName) {
        const field = { name: fieldName };
        if (shelf === 'columns') {
          setColumns(prev => [...prev, field]);
        } else if (shelf === 'rows') {
          setRows(prev => [...prev, field]);
        } else if (shelf === 'values') {
          setValues(prev => [...prev, field]);
        }
      }
    }
  }, [setColumns, setRows, setValues]);

  const removeFromShelf = useCallback((shelf, index) => {
    console.log('[removeFromShelf] Called with:', { shelf, index });
    
    // Get the field being removed so we can clean up its sort
    let removedFieldName = null;
    
    if (shelf === 'columns') {
      removedFieldName = columns[index]?.name || columns[index];
      console.log('[removeFromShelf] Removing from columns:', { removedFieldName, columnsLength: columns.length });
      setColumns(prev => {
        const newColumns = prev.filter((_, i) => i !== index);
        console.log('[removeFromShelf] Columns after filter:', newColumns);
        return newColumns;
      });
    } else if (shelf === 'rows') {
      removedFieldName = rows[index]?.name || rows[index];
      console.log('[removeFromShelf] Removing from rows:', { removedFieldName, rowsLength: rows.length });
      setRows(prev => {
        const newRows = prev.filter((_, i) => i !== index);
        console.log('[removeFromShelf] Rows after filter:', newRows);
        return newRows;
      });
    } else if (shelf === 'values') {
      removedFieldName = values[index]?.name || values[index];
      console.log('[removeFromShelf] Removing from values:', { removedFieldName, valuesLength: values.length });
      setValues(prev => {
        const newValues = prev.filter((_, i) => i !== index);
        console.log('[removeFromShelf] Values after filter:', newValues);
        return newValues;
      });
    }
    
    // Remove any sorts that reference the removed field
    if (removedFieldName && setSorts) {
      setSorts(prevSorts => prevSorts.filter(s => s.field !== removedFieldName));
    }
  }, [columns, rows, values, setColumns, setRows, setValues, setSorts]);

  // Drag handlers - for dragging pills within/between shelves
  const handlePillDragStart = useCallback((e, field, fieldType, sourceZone) => {
    setDraggedField({ name: field, type: fieldType });
    setDragSource(sourceZone);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', field);
    e.currentTarget.classList.add('dragging');
  }, []);

  const handlePillDragEnd = useCallback((e) => {
    e.currentTarget.classList.remove('dragging');
    setDraggedField(null);
    setDragSource(null);
    setDragOverZone(null);
    setDragOverIndex(null);
  }, []);

  const handleDragOver = useCallback((e, zone, index = null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverZone(zone);
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback((e) => {
    const relatedTarget = e.relatedTarget;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverZone(null);
      setDragOverIndex(null);
    }
  }, []);

  const handleDrop = useCallback((e, zone, dropIndex = null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverZone(null);
    setDragOverIndex(null);
    
    if (!draggedField) return;

    const { name } = draggedField;
    
    const getZoneSetter = (z) => {
      if (z === 'columns') return setColumns;
      if (z === 'rows') return setRows;
      if (z === 'values') return setValues;
      return null;
    };

    const getZoneArray = (z) => {
      if (z === 'columns') return columns;
      if (z === 'rows') return rows;
      if (z === 'values') return values;
      return [];
    };

    const isValidDrop = (targetZone) => {
      return targetZone === 'columns' || targetZone === 'rows' || targetZone === 'values';
    };

    // If reordering within the same zone
    if (dragSource === zone && dragSource !== 'list') {
      const currentArray = getZoneArray(zone);
      
      // Find the item - could be a string or an object with .name
      const fromIndex = currentArray.findIndex(item => {
        const itemName = typeof item === 'string' ? item : item?.name;
        return itemName === name;
      });
      
      const toIndex = dropIndex !== null ? dropIndex : currentArray.length;
      
      // Also check if dropping at adjacent position (no actual move needed)
      // Drop zone idx+1 is right after item at idx, so toIndex === fromIndex+1 means no move
      const isNoOpMove = fromIndex === toIndex || (toIndex === fromIndex + 1);
      
      if (fromIndex !== -1 && !isNoOpMove) {
        const newArray = [...currentArray];
        const [movedItem] = newArray.splice(fromIndex, 1);
        // Adjust insert index if we removed an item before the insert point
        const insertIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
        newArray.splice(insertIndex, 0, movedItem);
        getZoneSetter(zone)(newArray);
      }
    }
    // Moving between zones or from list
    else if (isValidDrop(zone)) {
      // Helper to check if an item matches by name
      const itemMatchesName = (item) => {
        const itemName = typeof item === 'string' ? item : item?.name;
        return itemName === name;
      };
      
      if (dragSource === 'marks') {
        setMarkFields(prev => prev.filter(mf => mf.field !== name));
      } else if (dragSource !== 'list') {
        getZoneSetter(dragSource)(prev => prev.filter(f => !itemMatchesName(f)));
      } else {
        setColumns(prev => prev.filter(f => !itemMatchesName(f)));
        setRows(prev => prev.filter(f => !itemMatchesName(f)));
        setValues(prev => prev.filter(f => !itemMatchesName(f)));
        setMarkFields(prev => prev.filter(mf => mf.field !== name));
      }

      const targetArray = getZoneArray(zone).filter(f => !itemMatchesName(f));
      const insertIndex = dropIndex !== null ? Math.min(dropIndex, targetArray.length) : targetArray.length;
      const newArray = [...targetArray];
      newArray.splice(insertIndex, 0, name);
      getZoneSetter(zone)(newArray);
    }

    setDraggedField(null);
    setDragSource(null);
  }, [draggedField, dragSource, columns, rows, values, setColumns, setRows, setValues, setMarkFields]);

  const removeFromZone = useCallback((field, zone) => {
    const fieldName = typeof field === 'string' ? field : field?.name;
    const filterFn = (f) => {
      const fName = typeof f === 'string' ? f : f?.name;
      return fName !== fieldName;
    };
    if (zone === 'columns') setColumns(prev => prev.filter(filterFn));
    if (zone === 'rows') setRows(prev => prev.filter(filterFn));
    if (zone === 'values') setValues(prev => prev.filter(filterFn));
    if (zone === 'marks') setMarkFields(prev => prev.filter(mf => mf.field !== fieldName));
  }, [setColumns, setRows, setValues, setMarkFields]);

  return {
    // State
    draggedField,
    dragSource,
    dragOverZone,
    dragOverIndex,
    dragOverShelf,
    // State setters (for child components)
    setDragOverZone,
    setDragOverIndex,
    // Handlers
    handleFieldDragStart,
    handleFieldDragEnd,
    handleShelfDragOver,
    handleShelfDragLeave,
    handleShelfDrop,
    removeFromShelf,
    handlePillDragStart,
    handlePillDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeFromZone,
  };
};

export default useDragDrop;
