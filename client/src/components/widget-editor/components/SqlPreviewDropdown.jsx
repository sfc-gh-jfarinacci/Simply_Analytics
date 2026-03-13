/**
 * SqlPreviewDropdown - Shows the generated SQL query and YAML config for the widget
 */
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiDatabase, FiX, FiFileText } from 'react-icons/fi';

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'AS',
  'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'BETWEEN', 'LIKE', 'ILIKE',
  'WITH', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'HAVING',
  'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'ASC', 'DESC', 'TRUE', 'FALSE', 'OVER', 'PARTITION', 'ROWS',
]);

const SQL_FUNCTIONS = new Set([
  'SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'YEAR', 'MONTH', 'DAY',
  'QUARTER', 'WEEK', 'HOUR', 'MINUTE', 'DATE_TRUNC', 'COALESCE',
  'CAST', 'NULLIF', 'IFF', 'LAG', 'LEAD', 'RANK', 'ROW_NUMBER',
  'DENSE_RANK', 'FIRST_VALUE', 'LAST_VALUE', 'NTILE',
  'CONCAT', 'UPPER', 'LOWER', 'TRIM', 'LENGTH', 'ROUND', 'ABS',
  'FLOOR', 'CEIL', 'CEILING', 'EXTRACT', 'DATEDIFF', 'DATEADD',
  'SEMANTIC_VIEW', 'DIMENSIONS', 'METRICS',
]);

/**
 * Pretty-print a SQL string with line breaks and indentation
 */
const formatSql = (raw) => {
  if (!raw || raw.startsWith('--')) return raw;

  let sql = raw.replace(/\s+/g, ' ').trim();

  // CTE: WITH base AS (...) SELECT ...
  // Pull apart CTE wrapper first
  const cteMatch = sql.match(/^WITH\s+(\w+)\s+AS\s*\((.+)\)\s*(SELECT\s+.+)$/i);
  if (cteMatch) {
    const [, alias, inner, outer] = cteMatch;
    const formattedInner = formatSql(inner);
    const indentedInner = formattedInner.split('\n').map(l => '  ' + l).join('\n');
    const formattedOuter = formatSql(outer);
    return `WITH ${alias} AS (\n${indentedInner}\n)\n${formattedOuter}`;
  }

  // Major clause boundaries — newline before each keyword
  sql = sql.replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT)\b/gi, '\n$1');

  // SEMANTIC_VIEW(...) — put DIMENSIONS / METRICS on their own lines
  sql = sql.replace(/\bSEMANTIC_VIEW\(\s*/gi, 'SEMANTIC_VIEW(\n    ');
  sql = sql.replace(/\b(DIMENSIONS)\b/gi, '\n    $1');
  sql = sql.replace(/\b(METRICS)\b/gi, '\n    $1');
  sql = sql.replace(/\)\s*\n/g, match => match); // keep close paren

  // AND / OR on separate lines, indented
  sql = sql.replace(/\bAND\b/gi, '\n  AND');
  sql = sql.replace(/\bOR\b/gi, '\n  OR');

  // Indent the body of each clause
  const lines = sql.split('\n').map(l => l.trim()).filter(Boolean);
  const result = [];
  const clauseKeywords = /^(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT)\b/i;

  for (const line of lines) {
    if (clauseKeywords.test(line)) {
      result.push(line);
    } else if (/^\d+$/.test(line)) {
      // LIMIT value — keep on same line as LIMIT
      const last = result.length - 1;
      if (last >= 0 && /^LIMIT$/i.test(result[last].trim())) {
        result[last] = result[last] + ' ' + line;
      } else {
        result.push('  ' + line);
      }
    } else {
      result.push('  ' + line);
    }
  }

  return result.join('\n');
};

/**
 * Tokenize and syntax-highlight a formatted SQL string into React elements
 */
const highlightSql = (formatted) => {
  if (!formatted) return null;

  // Regex tokenizer: strings → quoted identifiers → numbers → words → symbols
  const tokenPattern = /'(?:[^'\\]|\\.)*'/g;

  return formatted.split('\n').map((line, li) => {
    const parts = [];
    let lastIdx = 0;

    // Match quoted strings
    const processSegment = (text) => {
      const segs = [];
      // Split on: 'string', "identifier", numbers, words
      const re = /('(?:[^'\\]|\\.)*')|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|(\b[A-Z_][\w]*\b)|([^\s\w'"]+|\s+)/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[1]) {
          // String literal
          segs.push(<span key={`${li}-${m.index}`} className="sql-string">{m[0]}</span>);
        } else if (m[2]) {
          // Quoted identifier ("FIELD_NAME")
          segs.push(<span key={`${li}-${m.index}`} className="sql-identifier">{m[0]}</span>);
        } else if (m[3]) {
          // Number
          segs.push(<span key={`${li}-${m.index}`} className="sql-number">{m[0]}</span>);
        } else if (m[4]) {
          const upper = m[0].toUpperCase();
          if (SQL_KEYWORDS.has(upper)) {
            segs.push(<span key={`${li}-${m.index}`} className="sql-keyword">{m[0].toUpperCase()}</span>);
          } else if (SQL_FUNCTIONS.has(upper)) {
            segs.push(<span key={`${li}-${m.index}`} className="sql-function">{m[0]}</span>);
          } else {
            segs.push(<span key={`${li}-${m.index}`}>{m[0]}</span>);
          }
        } else {
          segs.push(<span key={`${li}-${m.index}`}>{m[0]}</span>);
        }
      }
      return segs;
    };

    parts.push(...processSegment(line));

    return (
      <div key={li} className="sql-line">
        <span className="sql-line-number">{li + 1}</span>
        <span className="sql-line-content">{parts}</span>
      </div>
    );
  });
};

/**
 * Convert widget config to YAML-like text for preview
 */
const configToYaml = (config) => {
  if (!config) return '# No configuration available';
  
  const lines = [];
  
  if (config.semanticView) {
    lines.push(`semanticView: ${config.semanticView}`);
    lines.push('');
  }
  
  if (config.fields && config.fields.length > 0) {
    lines.push('fields:');
    const shelves = ['columns', 'rows', 'marks'];
    shelves.forEach(shelf => {
      const shelfFields = config.fields.filter(f => f.shelf === shelf);
      if (shelfFields.length > 0) {
        lines.push(`  ${shelf}:`);
        shelfFields.forEach(f => {
          lines.push(`    - name: ${f.name}`);
          lines.push(`      type: ${f.semanticType}`);
          lines.push(`      dataType: ${f.dataType}`);
          if (f.aggregation) lines.push(`      aggregation: ${f.aggregation}`);
          if (f.markType) lines.push(`      markType: ${f.markType}`);
          if (f.alias) lines.push(`      alias: "${f.alias}"`);
        });
      }
    });
    lines.push('');
  } else {
    lines.push('fields: []');
    lines.push('');
  }
  
  if (config.filters && config.filters.length > 0) {
    lines.push('filters:');
    config.filters.forEach(f => {
      lines.push(`  - field: ${f.field}`);
      lines.push(`    operator: ${f.operator}`);
      if (f.operator === 'CUSTOM' && f.customExpression) {
        lines.push(`    expression: ${f.customExpression}`);
      } else if (f.values && f.values.length > 0) {
        lines.push(`    values: [${f.values.join(', ')}]`);
      } else if (f.value !== undefined) {
        lines.push(`    value: ${f.value}`);
      }
      if (f.dataType) lines.push(`    dataType: ${f.dataType}`);
    });
    lines.push('');
  }
  
  if (config.sorts && config.sorts.length > 0) {
    lines.push('sorts:');
    config.sorts.forEach(s => {
      lines.push(`  - field: ${s.field}`);
      lines.push(`    direction: ${s.direction || 'ASC'}`);
    });
    lines.push('');
  }
  
  if (config.customColumns && config.customColumns.length > 0) {
    lines.push('customColumnIds:');
    config.customColumns.forEach(c => {
      lines.push(`  - ${c.id || c.name}  # ${c.name}`);
    });
  }
  
  return lines.join('\n');
};

const DROPDOWN_WIDTH = 480;
const DROPDOWN_MAX_HEIGHT = 420;
const VIEWPORT_PADDING = 12;

const SqlPreviewDropdown = ({
  sqlPreviewDropdown,
  setSqlPreviewDropdown,
  liveQueryPreview,
  copiedSql,
  setCopiedSql,
  widgetConfig,
}) => {
  const [activeTab, setActiveTab] = useState('sql');
  
  const yamlPreview = useMemo(() => configToYaml(widgetConfig), [widgetConfig]);
  
  const formattedSql = useMemo(() => formatSql(liveQueryPreview), [liveQueryPreview]);
  const highlightedSql = useMemo(() => highlightSql(formattedSql), [formattedSql]);
  
  // Compute viewport-aware position
  const position = useMemo(() => {
    if (!sqlPreviewDropdown.open) return {};
    const anchor = sqlPreviewDropdown.anchorRect;
    if (!anchor) return { left: sqlPreviewDropdown.x || 0, top: sqlPreviewDropdown.y || 0 };

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(DROPDOWN_WIDTH, vw - VIEWPORT_PADDING * 2);

    // Horizontal: try to right-align with button, then left-align, then center
    let left = anchor.right - w;
    if (left < VIEWPORT_PADDING) left = anchor.left;
    if (left + w > vw - VIEWPORT_PADDING) left = Math.max(VIEWPORT_PADDING, vw - w - VIEWPORT_PADDING);

    // Vertical: prefer below button, flip above if not enough space
    const spaceBelow = vh - anchor.bottom - VIEWPORT_PADDING;
    const spaceAbove = anchor.top - VIEWPORT_PADDING;
    let top, maxH;
    if (spaceBelow >= Math.min(DROPDOWN_MAX_HEIGHT, 200) || spaceBelow >= spaceAbove) {
      top = anchor.bottom + 8;
      maxH = Math.min(DROPDOWN_MAX_HEIGHT, vh - top - VIEWPORT_PADDING);
    } else {
      maxH = Math.min(DROPDOWN_MAX_HEIGHT, spaceAbove - 8);
      top = anchor.top - maxH - 8;
    }

    return { left, top, width: w, maxHeight: maxH };
  }, [sqlPreviewDropdown]);
  
  if (!sqlPreviewDropdown.open) return null;

  const closeDropdown = () => setSqlPreviewDropdown({ open: false, x: 0, y: 0 });
  
  const handleCopy = () => {
    const text = activeTab === 'sql' ? formattedSql : yamlPreview;
    navigator.clipboard.writeText(text);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return createPortal(
    <div className="sql-preview-dropdown-backdrop" onClick={closeDropdown}>
      <div 
        className="sql-preview-dropdown" 
        style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sql-preview-dropdown-header">
          <div className="sql-preview-tabs">
            <button 
              className={`tab-btn ${activeTab === 'sql' ? 'active' : ''}`}
              onClick={() => setActiveTab('sql')}
            >
              <FiDatabase /> SQL
            </button>
            <button 
              className={`tab-btn ${activeTab === 'yaml' ? 'active' : ''}`}
              onClick={() => setActiveTab('yaml')}
            >
              <FiFileText /> Config
            </button>
          </div>
          <button className="close-btn" onClick={closeDropdown}><FiX /></button>
        </div>
        <div className="sql-preview-dropdown-content">
          {activeTab === 'sql' ? (
            <pre className="sql-highlighted"><code>{highlightedSql}</code></pre>
          ) : (
            <pre><code className="yaml">{yamlPreview}</code></pre>
          )}
        </div>
        <div className="sql-preview-dropdown-footer">
          <button 
            className={`btn btn-sm ${copiedSql ? 'btn-success' : 'btn-secondary'}`}
            onClick={handleCopy}
          >
            {copiedSql ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SqlPreviewDropdown;
