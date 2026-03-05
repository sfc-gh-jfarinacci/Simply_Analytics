/**
 * Filter operators configuration
 * Date parts are no longer auto-generated - users can create custom fields for date manipulation
 */

// Advanced filter operators by data type category
export const FILTER_OPERATORS = {
    numeric: [
      { value: '=', label: 'equals', symbol: '=' },
      { value: '!=', label: 'not equals', symbol: '≠' },
      { value: '>', label: 'greater than', symbol: '>' },
      { value: '>=', label: 'greater than or equal', symbol: '≥' },
      { value: '<', label: 'less than', symbol: '<' },
      { value: '<=', label: 'less than or equal', symbol: '≤' },
      { value: 'BETWEEN', label: 'between', symbol: '↔' },
      { value: 'IN', label: 'in list', symbol: '∈' },
      { value: 'NOT IN', label: 'not in list (exclude)', symbol: '∉' },
      { value: 'IS NULL', label: 'is empty', symbol: '∅' },
      { value: 'IS NOT NULL', label: 'is not empty', symbol: '∃' },
      { value: 'CUSTOM', label: 'custom expression', symbol: '{ }' },
    ],
    string: [
      { value: 'IN', label: 'is one of', symbol: '∈' },
      { value: 'NOT IN', label: 'is not one of (exclude)', symbol: '∉' },
      { value: '=', label: 'equals', symbol: '=' },
      { value: '!=', label: 'not equals', symbol: '≠' },
      { value: 'LIKE', label: 'contains', symbol: '⊃' },
      { value: 'STARTS_WITH', label: 'starts with', symbol: '⊳' },
      { value: 'ENDS_WITH', label: 'ends with', symbol: '⊲' },
      { value: 'NOT_LIKE', label: 'does not contain', symbol: '⊅' },
      { value: 'IS NULL', label: 'is empty', symbol: '∅' },
      { value: 'IS NOT NULL', label: 'is not empty', symbol: '∃' },
      { value: 'CUSTOM', label: 'custom expression', symbol: '{ }' },
    ],
    date: [
      { value: '=', label: 'equals', symbol: '=' },
      { value: '!=', label: 'not equals', symbol: '≠' },
      { value: '>', label: 'after', symbol: '>' },
      { value: '>=', label: 'on or after', symbol: '≥' },
      { value: '<', label: 'before', symbol: '<' },
      { value: '<=', label: 'on or before', symbol: '≤' },
      { value: 'BETWEEN', label: 'between', symbol: '↔' },
      { value: 'IS NULL', label: 'is empty', symbol: '∅' },
      { value: 'IS NOT NULL', label: 'is not empty', symbol: '∃' },
      { value: 'CUSTOM', label: 'custom expression', symbol: '{ }' },
    ],
    datetime: [
      { value: '=', label: 'equals', symbol: '=' },
      { value: '!=', label: 'not equals', symbol: '≠' },
      { value: '>', label: 'after', symbol: '>' },
      { value: '>=', label: 'on or after', symbol: '≥' },
      { value: '<', label: 'before', symbol: '<' },
      { value: '<=', label: 'on or before', symbol: '≤' },
      { value: 'BETWEEN', label: 'between', symbol: '↔' },
      { value: 'IS NULL', label: 'is empty', symbol: '∅' },
      { value: 'IS NOT NULL', label: 'is not empty', symbol: '∃' },
      { value: 'CUSTOM', label: 'custom expression', symbol: '{ }' },
    ],
    boolean: [
      { value: '=', label: 'equals', symbol: '=' },
      { value: 'IS TRUE', label: 'is true', symbol: '✓' },
      { value: 'IS FALSE', label: 'is false', symbol: '✗' },
      { value: 'IS NULL', label: 'is unknown', symbol: '∅' },
      { value: 'CUSTOM', label: 'custom expression', symbol: '{ }' },
    ],
  };
  