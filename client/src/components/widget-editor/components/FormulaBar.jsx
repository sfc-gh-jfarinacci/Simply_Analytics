import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FiX,
  FiCheck,
  FiHash,
  FiTrendingUp,
  FiCalendar,
  FiType,
  FiZap,
} from 'react-icons/fi';
import '../../../styles/FormulaBar.css';

// SQL/Snowflake functions for autocomplete
const FORMULA_FUNCTIONS = [
  // Snowflake Cortex AI (at the top for visibility)
  { name: 'SNOWFLAKE.CORTEX.SENTIMENT', category: '✨ AI', syntax: 'SNOWFLAKE.CORTEX.SENTIMENT(text)', description: 'Analyze sentiment (-1 to 1)' },
  { name: 'SNOWFLAKE.CORTEX.SUMMARIZE', category: '✨ AI', syntax: 'SNOWFLAKE.CORTEX.SUMMARIZE(text)', description: 'Summarize long text' },
  { name: 'SNOWFLAKE.CORTEX.TRANSLATE', category: '✨ AI', syntax: "SNOWFLAKE.CORTEX.TRANSLATE(text, 'en', 'es')", description: 'Translate to another language' },
  { name: 'SNOWFLAKE.CORTEX.COMPLETE', category: '✨ AI', syntax: "SNOWFLAKE.CORTEX.COMPLETE('llama3.1-8b', prompt)", description: 'Generate AI text response' },
  { name: 'SNOWFLAKE.CORTEX.CLASSIFY_TEXT', category: '✨ AI', syntax: "SNOWFLAKE.CORTEX.CLASSIFY_TEXT(text, ARRAY_CONSTRUCT('cat1', 'cat2'))", description: 'Classify text into categories' },
  { name: 'SNOWFLAKE.CORTEX.EXTRACT_ANSWER', category: '✨ AI', syntax: "SNOWFLAKE.CORTEX.EXTRACT_ANSWER(text, 'question')", description: 'Extract answer from text' },
  // Aggregate
  { name: 'SUM', category: 'Aggregate', syntax: 'SUM(field)', description: 'Sum of values' },
  { name: 'AVG', category: 'Aggregate', syntax: 'AVG(field)', description: 'Average of values' },
  { name: 'COUNT', category: 'Aggregate', syntax: 'COUNT(field)', description: 'Count of values' },
  { name: 'COUNT_DISTINCT', category: 'Aggregate', syntax: 'COUNT(DISTINCT field)', description: 'Count of unique values' },
  { name: 'MIN', category: 'Aggregate', syntax: 'MIN(field)', description: 'Minimum value' },
  { name: 'MAX', category: 'Aggregate', syntax: 'MAX(field)', description: 'Maximum value' },
  { name: 'MEDIAN', category: 'Aggregate', syntax: 'MEDIAN(field)', description: 'Median value' },
  { name: 'STDDEV', category: 'Aggregate', syntax: 'STDDEV(field)', description: 'Standard deviation' },
  { name: 'VARIANCE', category: 'Aggregate', syntax: 'VARIANCE(field)', description: 'Variance of values' },
  // Text
  { name: 'CONCAT', category: 'Text', syntax: "CONCAT(a, b)", description: 'Join text values' },
  { name: 'UPPER', category: 'Text', syntax: 'UPPER(text)', description: 'Convert to uppercase' },
  { name: 'LOWER', category: 'Text', syntax: 'LOWER(text)', description: 'Convert to lowercase' },
  { name: 'TRIM', category: 'Text', syntax: 'TRIM(text)', description: 'Remove whitespace' },
  { name: 'LENGTH', category: 'Text', syntax: 'LENGTH(text)', description: 'Character count' },
  { name: 'REPLACE', category: 'Text', syntax: "REPLACE(text, 'find', 'replace')", description: 'Replace text' },
  { name: 'SUBSTRING', category: 'Text', syntax: 'SUBSTRING(text, start, length)', description: 'Extract portion of text' },
  { name: 'LEFT', category: 'Text', syntax: 'LEFT(text, n)', description: 'First n characters' },
  { name: 'RIGHT', category: 'Text', syntax: 'RIGHT(text, n)', description: 'Last n characters' },
  { name: 'SPLIT_PART', category: 'Text', syntax: "SPLIT_PART(text, ',', 1)", description: 'Split and get part' },
  { name: 'INITCAP', category: 'Text', syntax: 'INITCAP(text)', description: 'Capitalize first letters' },
  // Math
  { name: 'ROUND', category: 'Math', syntax: 'ROUND(number, decimals)', description: 'Round to decimals' },
  { name: 'FLOOR', category: 'Math', syntax: 'FLOOR(number)', description: 'Round down' },
  { name: 'CEIL', category: 'Math', syntax: 'CEIL(number)', description: 'Round up' },
  { name: 'ABS', category: 'Math', syntax: 'ABS(number)', description: 'Absolute value' },
  { name: 'POWER', category: 'Math', syntax: 'POWER(base, exponent)', description: 'Raise to power' },
  { name: 'SQRT', category: 'Math', syntax: 'SQRT(number)', description: 'Square root' },
  { name: 'MOD', category: 'Math', syntax: 'MOD(number, divisor)', description: 'Remainder/modulo' },
  { name: 'LOG', category: 'Math', syntax: 'LOG(base, number)', description: 'Logarithm' },
  { name: 'LN', category: 'Math', syntax: 'LN(number)', description: 'Natural logarithm' },
  // Date
  { name: 'YEAR', category: 'Date', syntax: 'YEAR(date)', description: 'Extract year' },
  { name: 'MONTH', category: 'Date', syntax: 'MONTH(date)', description: 'Extract month' },
  { name: 'DAY', category: 'Date', syntax: 'DAY(date)', description: 'Extract day' },
  { name: 'DAYOFWEEK', category: 'Date', syntax: 'DAYOFWEEK(date)', description: 'Day of week (0-6)' },
  { name: 'QUARTER', category: 'Date', syntax: 'QUARTER(date)', description: 'Extract quarter (1-4)' },
  { name: 'WEEK', category: 'Date', syntax: 'WEEK(date)', description: 'Week of year' },
  { name: 'DATEDIFF', category: 'Date', syntax: "DATEDIFF('day', start, end)", description: 'Difference between dates' },
  { name: 'DATEADD', category: 'Date', syntax: "DATEADD('day', n, date)", description: 'Add to date' },
  { name: 'DATE_TRUNC', category: 'Date', syntax: "DATE_TRUNC('month', date)", description: 'Truncate date' },
  { name: 'CURRENT_DATE', category: 'Date', syntax: 'CURRENT_DATE()', description: 'Today\'s date' },
  { name: 'CURRENT_TIMESTAMP', category: 'Date', syntax: 'CURRENT_TIMESTAMP()', description: 'Current timestamp' },
  // Logic
  { name: 'IFF', category: 'Logic', syntax: 'IFF(condition, true_value, false_value)', description: 'If-then-else' },
  { name: 'CASE', category: 'Logic', syntax: 'CASE WHEN condition THEN value ELSE default END', description: 'Multiple conditions' },
  { name: 'COALESCE', category: 'Logic', syntax: 'COALESCE(a, b, c)', description: 'First non-null value' },
  { name: 'NULLIF', category: 'Logic', syntax: 'NULLIF(a, b)', description: 'Return null if equal' },
  { name: 'ZEROIFNULL', category: 'Logic', syntax: 'ZEROIFNULL(value)', description: 'Replace null with 0' },
  { name: 'NVL', category: 'Logic', syntax: 'NVL(value, default)', description: 'Replace null with default' },
  { name: 'DECODE', category: 'Logic', syntax: "DECODE(expr, 'val1', 'result1', 'default')", description: 'Simple value mapping' },
  // Window
  { name: 'ROW_NUMBER', category: 'Window', syntax: 'ROW_NUMBER() OVER (ORDER BY field)', description: 'Row number in partition' },
  { name: 'RANK', category: 'Window', syntax: 'RANK() OVER (ORDER BY field)', description: 'Rank with gaps' },
  { name: 'DENSE_RANK', category: 'Window', syntax: 'DENSE_RANK() OVER (ORDER BY field)', description: 'Rank without gaps' },
  { name: 'LAG', category: 'Window', syntax: 'LAG(field, 1) OVER (ORDER BY date)', description: 'Previous row value' },
  { name: 'LEAD', category: 'Window', syntax: 'LEAD(field, 1) OVER (ORDER BY date)', description: 'Next row value' },
  { name: 'FIRST_VALUE', category: 'Window', syntax: 'FIRST_VALUE(field) OVER (PARTITION BY group)', description: 'First value in group' },
  { name: 'LAST_VALUE', category: 'Window', syntax: 'LAST_VALUE(field) OVER (PARTITION BY group)', description: 'Last value in group' },
];

// Get icon for field type
const getFieldIcon = (field) => {
  if (field.fieldType === 'measure') return FiTrendingUp;
  if (field.isDatePart || field.type?.includes('DATE') || field.type?.includes('TIME')) return FiCalendar;
  if (field.type?.includes('VARCHAR') || field.type?.includes('STRING') || field.type?.includes('TEXT')) return FiType;
  return FiHash;
};

const FormulaBar = ({
  isOpen,
  onClose,
  onSave,
  availableFields = [],
  editingField = null,
  existingFields = [], // Existing calculated fields to check for duplicates
  inline = false, // If true, renders inline without portal/overlay
  bottomPanel = false, // If true, renders as bottom panel over dashboard
}) => {
  const [nameError, setNameError] = useState(null);
  // Combined formula: "field_name = expression"
  const [formulaText, setFormulaText] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteType, setAutocompleteType] = useState('field'); // 'field' or 'function'
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] = useState(0);
  const [autocompletePosition, setAutocompletePosition] = useState({ top: 0, left: 0, width: 0 });
  const [error, setError] = useState(null);
  
  const formulaInputRef = useRef(null);
  const highlightRef = useRef(null);
  const autocompleteRef = useRef(null);
  const inputWrapperRef = useRef(null);
  
  // Update autocomplete position when showing
  useEffect(() => {
    if (showAutocomplete && inputWrapperRef.current) {
      const rect = inputWrapperRef.current.getBoundingClientRect();
      setAutocompletePosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.min(rect.width, 500),
      });
    }
  }, [showAutocomplete]);
  
  // Reset state when opened/closed or editing field changes
  useEffect(() => {
    if (isOpen) {
      if (editingField) {
        // Format: field_name = expression
        setFormulaText(`${editingField.name} = ${editingField.expression || ''}`);
      } else {
        setFormulaText('new_field = ');
      }
      setError(null);
      setShowAutocomplete(false);
      // Focus and select the field name part
      setTimeout(() => {
        if (formulaInputRef.current) {
          formulaInputRef.current.focus();
          // Select "new_field" part for easy replacement
          if (!editingField) {
            formulaInputRef.current.setSelectionRange(0, 9);
          }
        }
      }, 100);
    }
  }, [isOpen, editingField]);
  
  // Parse formula text into name and expression
  const parseFormula = (text) => {
    const eqIndex = text.indexOf('=');
    if (eqIndex === -1) {
      return { name: text.trim(), expression: '' };
    }
    return {
      name: text.slice(0, eqIndex).trim(),
      expression: text.slice(eqIndex + 1).trim(),
    };
  };
  
  // Get the expression part (after =) for highlighting
  const { name: fieldName, expression } = parseFormula(formulaText);
  const eqIndex = formulaText.indexOf('=');
  
  // Parse formula to find field references and highlight them
  const highlightedFormula = useMemo(() => {
    const parts = [];
    
    // Add the field name part
    if (eqIndex > -1) {
      parts.push({ type: 'fieldname', content: formulaText.slice(0, eqIndex + 1) });
      
      const afterEq = formulaText.slice(eqIndex + 1);
      if (!afterEq) {
        parts.push({ type: 'placeholder', content: ' [field] + [field]...' });
        return parts;
      }
      
      // Parse the expression part for field references
      let lastIndex = 0;
      const regex = /\[([^\]]+)\]/g;
      let match;
      
      while ((match = regex.exec(afterEq)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', content: afterEq.slice(lastIndex, match.index) });
        }
        const refName = match[1];
        const field = availableFields.find(f => f.name === refName);
        const isCalcField = existingFields.some(f => f.name.toLowerCase() === refName.toLowerCase());
        parts.push({
          type: 'field',
          content: match[0],
          fieldName: refName,
          exists: !!field || isCalcField,
          fieldType: isCalcField ? 'calculated' : (field?.fieldType || 'dimension'),
        });
        lastIndex = match.index + match[0].length;
      }
      
      if (lastIndex < afterEq.length) {
        parts.push({ type: 'text', content: afterEq.slice(lastIndex) });
      }
    } else {
      parts.push({ type: 'fieldname', content: formulaText });
    }
    
    return parts;
  }, [formulaText, availableFields, existingFields, eqIndex]);
  
  // Get autocomplete suggestions — include other calc fields (exclude self to prevent circular ref)
  const autocompleteSuggestions = useMemo(() => {
    if (autocompleteType === 'field') {
      const filter = autocompleteFilter.toLowerCase();
      const currentName = fieldName.toUpperCase();
      const calcFieldItems = existingFields
        .filter(f => f.name.toUpperCase() !== currentName)
        .map(f => ({ name: f.name, fieldType: 'calculated', type: 'CALCULATED' }));
      return [...availableFields, ...calcFieldItems]
        .filter(f => f.name.toLowerCase().includes(filter))
        .slice(0, 25);
    } else {
      const filter = autocompleteFilter.toLowerCase();
      const filtered = filter 
        ? FORMULA_FUNCTIONS.filter(f => 
            f.name.toLowerCase().includes(filter) || 
            f.category.toLowerCase().includes(filter) ||
            f.description.toLowerCase().includes(filter)
          )
        : FORMULA_FUNCTIONS;
      return filtered;
    }
  }, [autocompleteType, autocompleteFilter, availableFields, existingFields, fieldName]);
  
  // Handle formula input changes
  const handleFormulaChange = (e) => {
    const value = e.target.value;
    const pos = e.target.selectionStart;
    setFormulaText(value);
    setCursorPosition(pos);
    
    // Only check for autocomplete after the = sign
    const eqPos = value.indexOf('=');
    if (eqPos === -1 || pos <= eqPos + 1) {
      setShowAutocomplete(false);
      return;
    }
    
    const textBeforeCursor = value.slice(eqPos + 1, pos);
    
    // Check for field reference start
    const lastBracket = textBeforeCursor.lastIndexOf('[');
    const lastCloseBracket = textBeforeCursor.lastIndexOf(']');
    
    if (lastBracket > lastCloseBracket) {
      const fieldFilter = textBeforeCursor.slice(lastBracket + 1);
      setAutocompleteType('field');
      setAutocompleteFilter(fieldFilter);
      setShowAutocomplete(true);
      setSelectedAutocompleteIndex(0);
    } else {
      const wordMatch = textBeforeCursor.match(/[A-Z_][A-Z0-9_]*$/i);
      if (wordMatch && wordMatch[0].length >= 2) {
        setAutocompleteType('function');
        setAutocompleteFilter(wordMatch[0]);
        setShowAutocomplete(true);
        setSelectedAutocompleteIndex(0);
      } else {
        setShowAutocomplete(false);
      }
    }
  };
  
  // Handle keyboard navigation in autocomplete
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (showAutocomplete) {
        setShowAutocomplete(false);
      } else {
        onClose();
      }
      return;
    }
    
    if (!showAutocomplete) return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedAutocompleteIndex(prev => 
          Math.min(prev + 1, autocompleteSuggestions.length - 1)
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedAutocompleteIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Tab':
      case 'Enter':
        if (autocompleteSuggestions.length > 0) {
          e.preventDefault();
          insertAutocomplete(autocompleteSuggestions[selectedAutocompleteIndex]);
        }
        break;
    }
  };
  
  // Insert autocomplete selection
  const insertAutocomplete = useCallback((suggestion) => {
    const input = formulaInputRef.current;
    if (!input) return;
    
    const value = formulaText;
    const pos = cursorPosition;
    const eqPos = value.indexOf('=');
    const textBeforeCursor = value.slice(eqPos + 1, pos);
    const textAfterCursor = value.slice(pos);
    const beforeEq = value.slice(0, eqPos + 1);
    
    let newValue, newCursorPos;
    
    if (autocompleteType === 'field') {
      const lastBracket = textBeforeCursor.lastIndexOf('[');
      const beforeBracket = textBeforeCursor.slice(0, lastBracket);
      newValue = `${beforeEq}${beforeBracket}[${suggestion.name}]${textAfterCursor}`;
      newCursorPos = beforeEq.length + beforeBracket.length + suggestion.name.length + 2;
    } else {
      const wordMatch = textBeforeCursor.match(/[A-Z_][A-Z0-9_]*$/i);
      const beforeWord = textBeforeCursor.slice(0, textBeforeCursor.length - (wordMatch?.[0].length || 0));
      newValue = `${beforeEq}${beforeWord}${suggestion.name}(${textAfterCursor}`;
      newCursorPos = beforeEq.length + beforeWord.length + suggestion.name.length + 1;
    }
    
    setFormulaText(newValue);
    setCursorPosition(newCursorPos);
    setShowAutocomplete(false);
    
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [formulaText, cursorPosition, autocompleteType]);
  
  // Handle save
  const handleSave = () => {
    const { name, expression: expr } = parseFormula(formulaText);
    const trimmedName = name.trim();
    
    // Clear previous errors
    setNameError(null);
    setError(null);
    
    if (!trimmedName) {
      setError('Please enter a field name before the = sign');
      return;
    }
    if (!expr.trim()) {
      setError('Please enter an expression after the = sign');
      return;
    }
    
    // Check for duplicate names (exclude the field being edited)
    const isDuplicate = existingFields.some(f => 
      f.name.toLowerCase() === trimmedName.toLowerCase() && 
      f.name !== editingField?.name
    );
    
    // Also check against available fields (dimensions/measures)
    const conflictsWithField = availableFields.some(f => 
      f.name.toLowerCase() === trimmedName.toLowerCase()
    );
    
    if (isDuplicate) {
      setNameError('A calculated field with this name already exists');
      // Focus on the input and select the name part
      if (formulaInputRef.current) {
        formulaInputRef.current.focus();
        formulaInputRef.current.setSelectionRange(0, trimmedName.length);
      }
      return;
    }
    
    if (conflictsWithField) {
      setNameError('This name conflicts with an existing field');
      if (formulaInputRef.current) {
        formulaInputRef.current.focus();
        formulaInputRef.current.setSelectionRange(0, trimmedName.length);
      }
      return;
    }
    
    // Validate field references — allow references to semantic fields AND other calc fields
    const regex = /\[([^\]]+)\]/g;
    let match;
    const referencedFields = [];
    const referencedCalcFieldNames = [];
    
    while ((match = regex.exec(expr)) !== null) {
      const refName = match[1];
      const semanticField = availableFields.find(f => f.name === refName);
      const calcField = existingFields.find(f =>
        f.name.toLowerCase() === refName.toLowerCase() &&
        f.name !== editingField?.name
      );
      if (!semanticField && !calcField) {
        setError(`Field "${refName}" not found`);
        return;
      }
      if (semanticField) referencedFields.push(semanticField);
      if (calcField) referencedCalcFieldNames.push(calcField.name);
    }
    
    // Circular dependency detection: walk the reference graph
    if (referencedCalcFieldNames.length > 0) {
      const calcByName = new Map(
        existingFields.map(f => [f.name.toUpperCase(), f])
      );
      const visited = new Set();
      const stack = [...referencedCalcFieldNames.map(n => n.toUpperCase())];
      const currentName = trimmedName.toUpperCase();
      
      while (stack.length > 0) {
        const name = stack.pop();
        if (name === currentName) {
          setError('Circular dependency detected — a field cannot reference itself or create a reference loop');
          return;
        }
        if (visited.has(name)) continue;
        visited.add(name);
        const cf = calcByName.get(name);
        if (cf?.expression) {
          const innerRefs = cf.expression.matchAll(/\[([^\]]+)\]/g);
          for (const m of innerRefs) {
            const inner = m[1].toUpperCase();
            if (calcByName.has(inner) && !visited.has(inner)) {
              stack.push(inner);
            }
          }
        }
      }
    }
    
    const isAggregate = /\b(SUM|AVG|COUNT|MIN|MAX|COUNT_DISTINCT)\s*\(/i.test(expr);
    
    const calculatedField = {
      id: editingField?.id || crypto.randomUUID(),
      name: trimmedName,
      expression: expr,
      referencedFields: referencedFields.map(f => f.name),
      isAggregate,
      isCalculated: true,
    };
    
    onSave(calculatedField, editingField);
    onClose();
  };
  
  // Sync scroll between input and highlight overlay
  const handleScroll = () => {
    if (highlightRef.current && formulaInputRef.current) {
      highlightRef.current.scrollLeft = formulaInputRef.current.scrollLeft;
    }
  };
  
  if (!isOpen) return null;
  
  // Bottom panel mode - slides up from bottom of screen
  if (bottomPanel) {
    return createPortal(
      <div className="formula-bottom-panel">
        {/* Blocking overlay - prevents interaction with dashboard while editing */}
        <div className="formula-blocking-overlay" onClick={(e) => e.stopPropagation()} />
        <div className="formula-bottom-panel-content">
          <div className="formula-bottom-header">
            <span className="formula-bottom-title">
              <FiZap /> {editingField ? 'Edit Calculated Field' : 'New Calculated Field'}
            </span>
            <div className="formula-bottom-actions">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>
                <FiCheck /> Save
              </button>
            </div>
          </div>
          
          <div className="formula-bottom-body">
            <button 
              className="formula-fx"
              onClick={() => {
                setAutocompleteType('function');
                setAutocompleteFilter('');
                setShowAutocomplete(true);
                setSelectedAutocompleteIndex(0);
                formulaInputRef.current?.focus();
              }}
              title="Browse all functions"
            >
              fx
            </button>
            
            <div className={`formula-input-wrapper ${nameError ? 'has-name-error' : ''}`} ref={inputWrapperRef}>
              <input
                ref={formulaInputRef}
                type="text"
                className={`formula-input ${nameError ? 'name-error' : ''}`}
                value={formulaText}
                onChange={(e) => {
                  handleFormulaChange(e);
                  // Clear name error when user types
                  if (nameError) setNameError(null);
                }}
                onKeyDown={handleKeyDown}
                onScroll={handleScroll}
                placeholder="field_name = [REVENUE] - [COST]"
                spellCheck={false}
              />
            </div>
          </div>
          
          {(error || nameError) && (
            <div className={`formula-error-inline ${nameError ? 'name-error' : ''}`}>
              <FiX /> {nameError || error}
            </div>
          )}
          
          {/* Autocomplete dropdown - positioned above the input */}
          {showAutocomplete && autocompleteSuggestions.length > 0 && (
            <div 
              className="formula-autocomplete bottom-panel-autocomplete" 
              ref={autocompleteRef}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '100%',
                left: autocompletePosition.left - 360 > 0 ? autocompletePosition.left - 360 : 16,
                width: Math.min(400, window.innerWidth - 32),
                marginBottom: 8,
              }}
            >
              <div className="autocomplete-header">
                {autocompleteType === 'field' ? (
                  <><FiHash /> Select a field</>
                ) : (
                  <><FiZap /> Select a function</>
                )}
              </div>
              <div className="autocomplete-list">
                {autocompleteSuggestions.map((suggestion, idx) => {
                  if (autocompleteType === 'field') {
                    const Icon = getFieldIcon(suggestion);
                    return (
                      <div
                        key={suggestion.name}
                        className={`autocomplete-item ${idx === selectedAutocompleteIndex ? 'selected' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          insertAutocomplete(suggestion);
                        }}
                        onMouseEnter={() => setSelectedAutocompleteIndex(idx)}
                      >
                        <Icon className={`field-icon ${suggestion.fieldType || 'dimension'}`} />
                        <span className="field-name">{suggestion.name}</span>
                        <span className="field-type">{suggestion.fieldType || 'dimension'}</span>
                      </div>
                    );
                  } else {
                    return (
                      <div
                        key={suggestion.name}
                        className={`autocomplete-item function ${idx === selectedAutocompleteIndex ? 'selected' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          insertAutocomplete(suggestion);
                        }}
                        onMouseEnter={() => setSelectedAutocompleteIndex(idx)}
                      >
                        <FiZap className={`function-icon ${suggestion.category.includes('AI') ? 'ai' : ''}`} />
                        <div className="function-info">
                          <span className="function-name">{suggestion.name}</span>
                          <span className="function-syntax">{suggestion.syntax}</span>
                        </div>
                        <span className={`function-category ${suggestion.category.includes('AI') ? 'ai-category' : ''}`}>{suggestion.category}</span>
                      </div>
                    );
                  }
                })}
              </div>
              <div className="autocomplete-hint">
                <kbd>↑↓</kbd> Navigate <kbd>Tab</kbd> Select <kbd>Esc</kbd> Close
              </div>
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  }
  
  // Inline mode - renders directly in sidebar
  const formulaBarContent = (
    <div className={`formula-bar-inline ${inline ? 'sidebar-inline' : ''}`}>
      <div className="formula-bar-content">
        <button 
          className="formula-fx"
          onClick={() => {
            setAutocompleteType('function');
            setAutocompleteFilter('');
            setShowAutocomplete(true);
            setSelectedAutocompleteIndex(0);
            formulaInputRef.current?.focus();
          }}
          title="Browse all functions"
        >
          fx
        </button>
        
        <div className="formula-input-wrapper" ref={inputWrapperRef}>
          <input
            ref={formulaInputRef}
            type="text"
            className="formula-input"
            value={formulaText}
            onChange={handleFormulaChange}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            placeholder="name = [FIELD] + [FIELD]"
            spellCheck={false}
          />
        </div>
        
        <div className="formula-bar-actions">
          <button className="formula-cancel-btn" onClick={onClose} title="Cancel (Esc)">
            <FiX />
          </button>
          <button className="formula-save-btn" onClick={handleSave} title="Save">
            <FiCheck />
          </button>
        </div>
      </div>
      
      {error && (
        <div className="formula-error-inline">
          <FiX /> {error}
        </div>
      )}
    </div>
  );
  
  // Autocomplete dropdown - always via portal for proper positioning
  const autocompleteDropdown = showAutocomplete && autocompleteSuggestions.length > 0 && createPortal(
    <div 
      className="formula-autocomplete" 
      ref={autocompleteRef}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: autocompletePosition.top,
        left: autocompletePosition.left,
        width: Math.min(autocompletePosition.width, 350),
        zIndex: 100001,
      }}
    >
      <div className="autocomplete-header">
        {autocompleteType === 'field' ? (
          <><FiHash /> Select a field</>
        ) : (
          <><FiZap /> Select a function</>
        )}
      </div>
      <div className="autocomplete-list">
        {autocompleteSuggestions.map((suggestion, idx) => {
          if (autocompleteType === 'field') {
            const Icon = getFieldIcon(suggestion);
            return (
              <div
                key={suggestion.name}
                className={`autocomplete-item ${idx === selectedAutocompleteIndex ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  insertAutocomplete(suggestion);
                }}
                onMouseEnter={() => setSelectedAutocompleteIndex(idx)}
              >
                <Icon className={`field-icon ${suggestion.fieldType || 'dimension'}`} />
                <span className="field-name">{suggestion.name}</span>
              </div>
            );
          } else {
            return (
              <div
                key={suggestion.name}
                className={`autocomplete-item function ${idx === selectedAutocompleteIndex ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  insertAutocomplete(suggestion);
                }}
                onMouseEnter={() => setSelectedAutocompleteIndex(idx)}
              >
                <FiZap className={`function-icon ${suggestion.category.includes('AI') ? 'ai' : ''}`} />
                <span className="function-name">{suggestion.name}</span>
                <span className={`function-category ${suggestion.category.includes('AI') ? 'ai-category' : ''}`}>{suggestion.category}</span>
              </div>
            );
          }
        })}
      </div>
      <div className="autocomplete-hint">
        <kbd>↑↓</kbd> <kbd>Tab</kbd> <kbd>Esc</kbd>
      </div>
    </div>,
    document.body
  );
  
  // If inline mode, render directly without portal
  if (inline) {
    return (
      <>
        {formulaBarContent}
        {autocompleteDropdown}
      </>
    );
  }
  
  // Otherwise use portal (legacy behavior)
  return createPortal(
    <>
      <div className="formula-bar-backdrop" onClick={onClose} />
      {formulaBarContent}
      {autocompleteDropdown}
    </>,
    document.body
  );
};

export default FormulaBar;
