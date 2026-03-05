/**
 * Query Builder - Frontend utilities
 * 
 * NOTE: SQL generation has moved to the backend for consistency.
 * The backend is now the SINGLE SOURCE OF TRUTH for query generation.
 * 
 * This file only exports minimal utilities that may be needed for UI purposes.
 */

// Date part functions for UI display (not for query generation)
export const DATE_PART_FUNCTIONS = {
  YEAR: 'year',
  QUARTER: 'quarter', 
  MONTH: 'month',
  WEEK: 'week',
  DAY: 'day',
  HOUR: 'hour',
};

// Check if a field name includes a date part suffix
export function isDatePartField(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') return false;
  const parts = Object.keys(DATE_PART_FUNCTIONS);
  return parts.some(part => fieldName.toUpperCase().endsWith(`__${part}`));
}

// Extract base field name without date part suffix
export function getBaseFieldName(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') return fieldName;
  const parts = Object.keys(DATE_PART_FUNCTIONS);
  for (const part of parts) {
    const suffix = `__${part}`;
    if (fieldName.toUpperCase().endsWith(suffix)) {
      return fieldName.substring(0, fieldName.length - suffix.length);
    }
  }
  return fieldName;
}
