/**
 * Field helper utilities for data type detection and formatting
 */
import {
    FiHash,
    FiType,
    FiCalendar,
    FiClock,
    FiToggleLeft,
    FiGrid,
    FiGlobe,
    FiDatabase,
  } from 'react-icons/fi';
  import { FILTER_OPERATORS } from '../constants/filterOperators';
  
  // Check if a data type is a date/timestamp type (used for filter operators)
  export const isDateType = (dataType) => {
    if (!dataType) return false;
    const type = dataType.toUpperCase();
    return type.includes('DATE') || type.includes('TIMESTAMP') || type.includes('TIME');
  };
  
  // Generate a field name for a date part extraction
  // Uses double underscore (__) to match backend's date part detection pattern
  export const getDatePartFieldName = (fieldName, datePart) => {
    return `${fieldName}__${datePart.toUpperCase()}`;
  };
  
  // Get display name for a field
  export const getFieldDisplayName = (fieldName) => {
    return typeof fieldName === 'object' ? fieldName?.name : fieldName;
  };
  
  // Get data type icon for Snowflake data types
  export const getDataTypeIcon = (dataType) => {
    if (!dataType) return FiHash;
    
    const type = dataType.toUpperCase();
    
    // Numeric types
    if (type.includes('NUMBER') || type.includes('INT') || type.includes('FLOAT') || 
        type.includes('DOUBLE') || type.includes('DECIMAL') || type.includes('NUMERIC')) {
      return FiHash;
    }
    
    // String/Text types
    if (type.includes('VARCHAR') || type.includes('STRING') || type.includes('TEXT') || 
        type.includes('CHAR')) {
      return FiType;
    }
    
    // Date/Time types
    if (type.includes('DATE') && !type.includes('TIME')) {
      return FiCalendar;
    }
    if (type.includes('TIME') || type.includes('TIMESTAMP')) {
      return FiClock;
    }
    
    // Boolean types
    if (type.includes('BOOLEAN') || type.includes('BOOL')) {
      return FiToggleLeft;
    }
    
    // Variant/Object/Array (semi-structured)
    if (type.includes('VARIANT') || type.includes('OBJECT') || type.includes('ARRAY')) {
      return FiGrid;
    }
    
    // Geography/Geometry
    if (type.includes('GEOGRAPHY') || type.includes('GEOMETRY')) {
      return FiGlobe;
    }
    
    // Binary
    if (type.includes('BINARY') || type.includes('VARBINARY')) {
      return FiDatabase;
    }
    
    return FiHash;
  };
  
  // Get data type category for filter operators
  export const getDataTypeCategory = (dataType) => {
    if (!dataType) return 'string';
    
    const type = dataType.toUpperCase();
    
    // Numeric types
    if (type.includes('NUMBER') || type.includes('INT') || type.includes('FLOAT') || 
        type.includes('DOUBLE') || type.includes('DECIMAL') || type.includes('NUMERIC')) {
      return 'numeric';
    }
    
    // Date types
    if (type.includes('DATE') && !type.includes('TIME')) {
      return 'date';
    }
    
    // Timestamp types
    if (type.includes('TIME') || type.includes('TIMESTAMP')) {
      return 'datetime';
    }
    
    // Boolean types
    if (type.includes('BOOLEAN') || type.includes('BOOL')) {
      return 'boolean';
    }
    
    return 'string';
  };
  
  // Get operators for a specific data type
  export const getOperatorsForType = (dataType) => {
    const category = getDataTypeCategory(dataType);
    return FILTER_OPERATORS[category] || FILTER_OPERATORS.string;
  };
  
  // Format filter value for display
  export const formatFilterDisplay = (filter) => {
    if (!filter) return '';
    
    const op = filter.operator || 'IN';
    
    // Custom expression
    if (op === 'CUSTOM' && filter.customExpression) {
      const expr = filter.customExpression.replace(/\{\{([^}]+)\}\}/g, '$1');
      const truncated = expr.length > 25 ? `${expr.substring(0, 22)}...` : expr;
      return `⚡ ${truncated}`;
    }
    
    // Value-based operators
    if (filter.values?.length) {
      if (filter.values.length === 1) {
        return String(filter.values[0]);
      }
      return `${filter.values.length} values`;
    }
    
    // Range operators
    if (op === 'BETWEEN' && filter.value && filter.value2) {
      return `${filter.value} - ${filter.value2}`;
    }
    
    // Single value operators
    if (filter.value !== undefined) {
      return String(filter.value);
    }
    
    // Null checks
    if (op === 'IS NULL') return 'is empty';
    if (op === 'IS NOT NULL') return 'has value';
    if (op === 'IS TRUE') return 'true';
    if (op === 'IS FALSE') return 'false';
    
    return '';
  };
  
  // Get field name from field object or string
  export const getFieldName = (field) => {
    if (!field) return '';
    return typeof field === 'object' ? field.name : field;
  };
  
  // Normalize field name for comparison
  export const normalizeFieldName = (name) => {
    const fieldName = getFieldName(name);
    return fieldName?.toUpperCase?.() || '';
  };
  