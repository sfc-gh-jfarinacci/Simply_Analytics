import React, { useMemo, useRef, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  flexRender,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAppStore } from '../../store/appStore';
import '../../styles/DataTable.css';

/**
 * TanStack Table based component for dashboards
 * Supports regular tables and cross-tab (pivot) views
 * No in-place sorting/filtering - that's handled via SQL
 */
const DataTable = ({ data, config, query, pivot = false }) => {
  const theme = useAppStore(state => state.theme);
  const tableContainerRef = useRef(null);
  
  // Extract query info for row/column organization
  const rowFields = query?.rowFields || [];
  const columnFields = query?.columnFields || [];
  const measureFields = query?.measureFields || [];
  const markFields = query?.markFields || {};
  
  // Column aliases from config
  const columnAliases = config?.columnAliases || {};
  
  // Per-field formatting from config
  const fieldFormats = config?.fieldFormats || {};
  
  // Fallback number format from config
  const defaultNumberFormat = config?.numberFormat || 'auto';
  const defaultDecimals = config?.decimalPlaces ?? 2;
  
  // Value formatter helper with per-field support
  const numFormatter = useCallback((value, fieldName) => {
    if (value === null || value === undefined) return '—';
    if (typeof value !== 'number') return value;
    
    const fieldConfig = fieldFormats[fieldName] || {};
    const format = fieldConfig.format || defaultNumberFormat;
    const decimals = fieldConfig.decimals ?? defaultDecimals;
    
    switch (format) {
      case 'number':
        return value.toLocaleString('en-US', { 
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals 
        });
      case 'compact':
        if (Math.abs(value) >= 1000) {
          return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: decimals });
        }
        return value.toLocaleString('en-US', { maximumFractionDigits: decimals });
      case 'currency':
        return '$' + value.toLocaleString('en-US', { 
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals 
        });
      case 'percent':
        return (value * 100).toFixed(decimals) + '%';
      case 'auto':
      default:
        if (Math.abs(value) >= 10000) {
          return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: decimals });
        }
        return value.toLocaleString('en-US', { maximumFractionDigits: decimals });
    }
  }, [fieldFormats, defaultNumberFormat, defaultDecimals]);
  
  const isCrossTab = pivot && rowFields.length > 0 && columnFields.length > 0;
  
  // Helper to get actual column name (case-insensitive, handles date part naming)
  const getActualColName = useCallback((fieldName) => {
    const name = typeof fieldName === 'object' ? fieldName?.name : fieldName;
    if (!name || !data?.columns?.length) return name || fieldName;
    
    const upperName = String(name).toUpperCase();
    
    let col = data.columns.find(c => c.name.toUpperCase() === upperName);
    if (col) return col.name;
    
    // Handle date part naming variations
    const normalizedName = upperName.replace(/__/g, '_');
    col = data.columns.find(c => c.name.toUpperCase() === normalizedName);
    if (col) return col.name;
    
    const doubleUnderscoreName = upperName.replace(/_([A-Z]+)$/, '__$1');
    col = data.columns.find(c => c.name.toUpperCase() === doubleUnderscoreName);
    if (col) return col.name;
    
    return name;
  }, [data?.columns]);
  
  // Get display name with alias support
  const getDisplayName = useCallback((colName) => {
    if (colName == null) return '';
    const str = String(colName);
    const aliasKey = Object.keys(columnAliases).find(k => k.toUpperCase() === str.toUpperCase());
    if (aliasKey && columnAliases[aliasKey]) {
      return columnAliases[aliasKey];
    }
    return str;
  }, [columnAliases]);
  
  // Helper to extract field name from string or object
  const getFieldName = useCallback((field) => {
    if (typeof field === 'object' && field !== null) {
      return field.name;
    }
    return field;
  }, []);
  
  // Transform data for cross-tab mode with hierarchical column groups
  const MAX_PIVOT_COLUMNS = 500;
  const MAX_PIVOT_CELLS = 100000;

  const { pivotedData, pivotColumns, pivotError } = useMemo(() => {
    if (!isCrossTab || !data?.rows?.length) {
      return { pivotedData: null, pivotColumns: null, pivotError: null };
    }

    try {
    
    const actualRowFields = rowFields.map(getActualColName);
    const actualColFields = columnFields.map(getActualColName);
    const actualMeasureFields = measureFields.map(getActualColName);
    const hasMeasures = actualMeasureFields.length > 0;
    
    // Build unique value sets for each column field (for hierarchical grouping)
    const colFieldValues = actualColFields.map(field => {
      const uniqueVals = [...new Set(data.rows.map(r => r[field]))].sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b));
      });
      return { field, values: uniqueVals };
    });

    // Guard 1: total leaf columns
    const leafMultiplier = hasMeasures ? Math.max(actualMeasureFields.length, 1) : 1;
    const totalLeafColumns = colFieldValues.reduce((acc, cv) => acc * cv.values.length, 1) * leafMultiplier;
    if (totalLeafColumns > MAX_PIVOT_COLUMNS) {
      const biggest = colFieldValues.reduce((a, b) => b.values.length > a.values.length ? b : a);
      return {
        pivotedData: null,
        pivotColumns: null,
        pivotError: `Too many pivot columns (${totalLeafColumns.toLocaleString()} would be generated). The field "${biggest.field}" has ${biggest.values.length.toLocaleString()} distinct values. Add a filter to reduce cardinality, or switch to a table/bar chart.`,
      };
    }

    // Guard 2: total unique row groups × columns (total cells)
    const uniqueRowKeys = new Set(data.rows.map(row => actualRowFields.map(f => row[f]).join('|||')));
    const estimatedCells = uniqueRowKeys.size * totalLeafColumns;
    if (estimatedCells > MAX_PIVOT_CELLS) {
      return {
        pivotedData: null,
        pivotColumns: null,
        pivotError: `Pivot would generate ~${estimatedCells.toLocaleString()} cells (${uniqueRowKeys.size.toLocaleString()} rows × ${totalLeafColumns.toLocaleString()} columns). Add filters to reduce the data, or switch to a table or chart.`,
      };
    }
    
    // Group data by row fields
    const rowGroups = new Map();
    data.rows.forEach(row => {
      const rowKey = actualRowFields.map(f => row[f]).join('|||');
      const colKey = actualColFields.map(f => row[f]).join('|||');
      
      if (!rowGroups.has(rowKey)) {
        const rowValues = {};
        actualRowFields.forEach(f => { rowValues[f] = row[f]; });
        rowGroups.set(rowKey, { ...rowValues, _pivotData: {} });
      }
      
      const group = rowGroups.get(rowKey);
      if (hasMeasures) {
        actualMeasureFields.forEach(m => {
          const pivotKey = `${colKey}|||${m}`;
          group._pivotData[pivotKey] = row[m];
        });
      } else {
        group._pivotData[colKey] = (group._pivotData[colKey] || 0) + 1;
      }
    });
    
    // Flatten pivot data into row objects
    const flattenedRows = [...rowGroups.values()].map(row => {
      const flatRow = { ...row };
      delete flatRow._pivotData;
      Object.entries(row._pivotData).forEach(([key, value]) => {
        flatRow[key] = value;
      });
      return flatRow;
    });
    
    // Build TanStack column definitions with hierarchical groups
    const buildColumnGroups = (fieldIndex, parentPath = []) => {
      if (fieldIndex >= actualColFields.length) {
        const colKey = parentPath.map(p => p.value).join('|||');
        
        if (hasMeasures) {
          return actualMeasureFields.map(m => ({
            id: `${colKey}|||${m}`,
            accessorKey: `${colKey}|||${m}`,
            header: getDisplayName(m),
            cell: info => {
              const val = info.getValue();
              return <span className="cell-measure">{numFormatter(val, m)}</span>;
            },
            meta: { isMeasure: true, fieldName: m },
          }));
        } else {
          return [{
            id: colKey,
            accessorKey: colKey,
            header: 'Count',
            cell: info => {
              const val = info.getValue();
              return <span className="cell-measure">{numFormatter(val, 'count')}</span>;
            },
            meta: { isMeasure: true },
          }];
        }
      }
      
      const currentField = colFieldValues[fieldIndex];
      return currentField.values.map(val => {
        const newPath = [...parentPath, { field: currentField.field, value: val }];
        const children = buildColumnGroups(fieldIndex + 1, newPath);
        
        return {
          id: `group_${newPath.map(p => p.value).join('_')}`,
          header: String(val),
          columns: children,
          meta: { level: fieldIndex },
        };
      });
    };
    
    // Build column definitions
    const columns = [];
    
    // Add row field columns (pinned left conceptually)
    actualRowFields.forEach((f, idx) => {
      columns.push({
        id: f,
        accessorKey: f,
        header: getDisplayName(f),
        cell: info => {
          const value = info.getValue();
          const rowIndex = info.row.index;
          
          // Suppress duplicate values for grouping effect
          if (rowIndex > 0 && idx >= 0) {
            const prevRow = flattenedRows[rowIndex - 1];
            if (prevRow) {
              let allPrevSame = true;
              for (let i = 0; i <= idx; i++) {
                if (flattenedRows[rowIndex][actualRowFields[i]] !== prevRow[actualRowFields[i]]) {
                  allPrevSame = false;
                  break;
                }
              }
              if (allPrevSame) {
                return <span className="cell-suppressed"></span>;
              }
            }
          }
          return <span className={`cell-row-header level-${idx}`}>{value}</span>;
        },
        meta: { isRowField: true, level: idx },
      });
    });
    
    // Add hierarchical pivot column groups
    if (actualColFields.length === 1 && !hasMeasures) {
      // Simple case: single column field, no measures
      colFieldValues[0].values.forEach(val => {
        const colKey = String(val);
        columns.push({
          id: colKey,
          accessorKey: colKey,
          header: colKey,
          cell: info => {
            const val = info.getValue();
            return <span className="cell-measure">{numFormatter(val, 'count')}</span>;
          },
          meta: { isMeasure: true },
        });
      });
    } else {
      columns.push(...buildColumnGroups(0));
    }
    
    return { pivotedData: flattenedRows, pivotColumns: columns, pivotError: null };

    } catch (err) {
      console.error('Pivot computation failed:', err);
      return {
        pivotedData: null,
        pivotColumns: null,
        pivotError: `Failed to build pivot: ${err.message || 'unexpected error'}. Try reducing the data with filters or switching to a table view.`,
      };
    }
  }, [isCrossTab, data, rowFields, columnFields, measureFields, getActualColName, getDisplayName, numFormatter]);
  
  // Server-side sorts from widget config
  const serverSorts = config?.sorts || [];
  
  // Sort data for display:
  // - If server-side sorts exist, respect that order (data arrives pre-sorted from SQL)
  // - Otherwise, do a local grouping sort by row/column fields for clean display
  const sortedRowData = useMemo(() => {
    if (!data?.rows?.length || isCrossTab) return data?.rows || [];
    
    // If server already sorted the data, preserve that order
    if (serverSorts.length > 0) return data.rows;
    
    // No server sorts - apply local grouping sort for clean display
    const allSortFields = [...rowFields, ...columnFields];
    if (allSortFields.length === 0) return data.rows;
    
    return [...data.rows].sort((a, b) => {
      for (const field of allSortFields) {
        const actualField = getActualColName(field);
        const aVal = a[actualField];
        const bVal = b[actualField];
        
        if (aVal === bVal) continue;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return aVal - bVal;
        }
        return String(aVal).localeCompare(String(bVal));
      }
      return 0;
    });
  }, [data?.rows, rowFields, columnFields, isCrossTab, getActualColName, serverSorts]);
  
  // Build standard column definitions (non-pivot mode)
  const standardColumns = useMemo(() => {
    const hasColumns = data?.columns?.length > 0;
    const hasRows = data?.rows?.length > 0;
    if ((!hasColumns && !hasRows) || isCrossTab) return [];
    
    const findDataColumn = (field) => {
      const fieldName = getFieldName(field);
      if (!fieldName) return null;
      const upperName = fieldName.toUpperCase();
      
      if (data.rows?.length > 0) {
        const firstRow = data.rows[0];
        const matchingKey = Object.keys(firstRow).find(k => k.toUpperCase() === upperName);
        if (matchingKey) {
          return { name: matchingKey };
        }
      }
      
      if (hasColumns) {
        let col = data.columns.find(c => c.name.toUpperCase() === upperName);
        if (col) return col;
      }
      
      return null;
    };
    
    // Build ordered list of columns
    const orderedColumns = [];
    const addedNames = new Set();
    const measureNamesUpper = new Set(measureFields.map(f => getFieldName(f)?.toUpperCase()).filter(Boolean));
    
    // Add columnFields first
    columnFields.forEach(f => {
      const col = findDataColumn(f);
      if (col && !addedNames.has(col.name.toUpperCase())) {
        orderedColumns.push(col);
        addedNames.add(col.name.toUpperCase());
      }
    });
    
    // Add dimension marks (color, detail)
    const markDimensions = [];
    if (markFields.color) markDimensions.push(markFields.color);
    if (markFields.detail) {
      const details = Array.isArray(markFields.detail) ? markFields.detail : [markFields.detail];
      details.forEach(d => { if (d) markDimensions.push(d); });
    }
    
    markDimensions.forEach(f => {
      const col = findDataColumn(f);
      if (col && !addedNames.has(col.name.toUpperCase())) {
        orderedColumns.push(col);
        addedNames.add(col.name.toUpperCase());
      }
    });
    
    // Add rowFields that are dimensions
    rowFields.forEach(f => {
      const fieldName = getFieldName(f);
      if (fieldName && !measureNamesUpper.has(fieldName.toUpperCase())) {
        const col = findDataColumn(f);
        if (col && !addedNames.has(col.name.toUpperCase())) {
          orderedColumns.push(col);
          addedNames.add(col.name.toUpperCase());
        }
      }
    });
    
    // Add measureFields last
    measureFields.forEach(f => {
      const col = findDataColumn(f);
      if (col && !addedNames.has(col.name.toUpperCase())) {
        orderedColumns.push(col);
        addedNames.add(col.name.toUpperCase());
      }
    });
    
    // If no shelf fields, show all columns
    const hasShelfFields = columnFields.length > 0 || rowFields.length > 0 || measureFields.length > 0 || markDimensions.length > 0;
    
    if (!hasShelfFields) {
      if (hasColumns) {
        data.columns.forEach(col => {
          if (!addedNames.has(col.name.toUpperCase())) {
            orderedColumns.push(col);
            addedNames.add(col.name.toUpperCase());
          }
        });
      }
      
      if (hasRows) {
        const firstRow = data.rows[0];
        Object.keys(firstRow).forEach(key => {
          if (!addedNames.has(key.toUpperCase())) {
            orderedColumns.push({ name: key });
            addedNames.add(key.toUpperCase());
          }
        });
      }
    }
    
    return orderedColumns.map((col, colIndex) => {
      const isRowField = rowFields.some(f => getFieldName(f)?.toUpperCase() === col.name.toUpperCase());
      const isMeasure = measureFields.some(f => getFieldName(f)?.toUpperCase() === col.name.toUpperCase());
      const rowFieldIndex = rowFields.findIndex(f => getFieldName(f)?.toUpperCase() === col.name.toUpperCase());
      
      return {
        id: col.name,
        accessorKey: col.name,
        header: getDisplayName(col.name),
        cell: info => {
          const value = info.getValue();
          const rowIndex = info.row.index;
          
          // Suppress duplicate row field values
          if (isRowField && rowIndex > 0 && rowFieldIndex >= 0) {
            const prevRowData = sortedRowData[rowIndex - 1];
            if (prevRowData) {
              let allPrevSame = true;
              for (let i = 0; i <= rowFieldIndex; i++) {
                const f = getActualColName(rowFields[i]);
                if (sortedRowData[rowIndex]?.[f] !== prevRowData[f]) {
                  allPrevSame = false;
                  break;
                }
              }
              if (allPrevSame) {
                return <span className="cell-suppressed"></span>;
              }
            }
          }
          
          if (typeof value === 'number') {
            return <span className="cell-measure">{numFormatter(value, col.name)}</span>;
          }
          if (value === null || value === undefined) {
            return <span className="cell-null">—</span>;
          }
          
          if (isRowField) {
            return <span className={`cell-row-header level-${rowFieldIndex}`}>{value}</span>;
          }
          
          return <span className="cell-text">{value}</span>;
        },
        meta: { isRowField, isMeasure, rowFieldIndex },
      };
    });
  }, [data, rowFields, columnFields, measureFields, markFields, isCrossTab, getActualColName, getDisplayName, getFieldName, numFormatter, sortedRowData]);
  
  // Choose columns and data based on mode
  const columns = isCrossTab ? pivotColumns : standardColumns;
  const tableData = isCrossTab ? pivotedData : sortedRowData;

  if (pivotError) {
    return (
      <div className={`data-table-container ${theme}`}>
        <div className="data-table-pivot-error">
          <div className="pivot-error-icon">⚠️</div>
          <div className="pivot-error-title">Pivot too large</div>
          <div className="pivot-error-message">{pivotError}</div>
        </div>
      </div>
    );
  }
  
  const showTotals = config?.showTotals === true;
  
  // Compute totals row for measure columns (handles both flat and hierarchical pivot columns)
  const totalsRow = useMemo(() => {
    if (!showTotals || !tableData?.length || !columns?.length) return null;
    
    // Collect all leaf columns (pivot columns nest measures inside group columns)
    const leafCols = [];
    const collectLeaves = (cols) => {
      cols.forEach(col => {
        if (col.columns && col.columns.length > 0) {
          collectLeaves(col.columns);
        } else {
          leafCols.push(col);
        }
      });
    };
    collectLeaves(columns);
    
    const totals = {};
    let hasTotals = false;
    
    leafCols.forEach(col => {
      const key = col.accessorKey || col.id;
      if (col.meta?.isMeasure) {
        let sum = 0;
        tableData.forEach(row => {
          const v = row[key];
          if (typeof v === 'number') sum += v;
        });
        totals[key] = sum;
        hasTotals = true;
      } else if (!col.meta?.isRowField) {
        const allNumeric = tableData.every(row => {
          const v = row[key];
          return v === null || v === undefined || typeof v === 'number';
        });
        const hasAnyNumber = tableData.some(row => typeof row[key] === 'number');
        if (allNumeric && hasAnyNumber) {
          let sum = 0;
          tableData.forEach(row => {
            const v = row[key];
            if (typeof v === 'number') sum += v;
          });
          totals[key] = sum;
          hasTotals = true;
        }
      }
    });
    
    return hasTotals ? totals : null;
  }, [showTotals, tableData, columns]);
  
  // Create table instance
  const table = useReactTable({
    data: tableData || [],
    columns: columns || [],
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });
  
  // Virtualization for large datasets
  const { rows } = table.getRowModel();
  
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36, // Estimated row height
    overscan: 10,
  });
  
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
  const paddingBottom = virtualRows.length > 0
    ? totalSize - (virtualRows[virtualRows.length - 1]?.end || 0)
    : 0;

  if (!tableData?.length) {
    return (
      <div className={`data-table-container ${theme}`}>
        <div className="data-table-empty">
          <p>No data available</p>
        </div>
      </div>
    );
  }

  // Render header groups recursively for hierarchical columns
  const renderHeaderGroups = () => {
    return table.getHeaderGroups().map(headerGroup => (
      <tr key={headerGroup.id} className="data-table-header-row">
        {headerGroup.headers.map(header => {
          const meta = header.column.columnDef.meta || {};
          const isGroup = header.subHeaders.length > 0;
          const level = meta.level ?? 0;
          
          return (
            <th
              key={header.id}
              colSpan={header.colSpan}
              className={`data-table-header-cell ${
                meta.isRowField ? 'header-row-field' : ''
              } ${meta.isMeasure ? 'header-measure' : ''} ${
                isGroup ? `header-group level-${level}` : ''
              }`}
            >
              {header.isPlaceholder
                ? null
                : flexRender(header.column.columnDef.header, header.getContext())}
            </th>
          );
        })}
      </tr>
    ));
  };

  return (
    <div className={`data-table-container ${theme}`}>
      <div className="data-table-wrapper" ref={tableContainerRef}>
        <table className="data-table">
          <thead className="data-table-head">
            {renderHeaderGroups()}
          </thead>
          <tbody className="data-table-body">
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {virtualRows.map(virtualRow => {
              const row = rows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  className={`data-table-row ${virtualRow.index % 2 === 0 ? 'even' : 'odd'}`}
                >
                  {row.getVisibleCells().map(cell => {
                    const meta = cell.column.columnDef.meta || {};
                    return (
                      <td
                        key={cell.id}
                        className={`data-table-cell ${
                          meta.isRowField ? 'cell-row-field' : ''
                        } ${meta.isMeasure ? 'cell-measure-col' : ''}`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
          {totalsRow && (
            <tfoot className="data-table-totals">
              <tr className="data-table-totals-row">
                {table.getAllLeafColumns().map((col, idx) => {
                  const key = col.columnDef.accessorKey || col.id;
                  const hasTotalValue = totalsRow[key] !== undefined;
                  return (
                    <td
                      key={col.id}
                      className={`data-table-cell data-table-totals-cell ${hasTotalValue ? 'cell-measure-col' : ''}`}
                    >
                      {hasTotalValue
                        ? <span className="cell-measure">{numFormatter(totalsRow[key], key)}</span>
                        : idx === 0
                          ? <span className="cell-row-header totals-label">Total</span>
                          : null
                      }
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="data-table-footer">
        {tableData.length} rows {isCrossTab && '(pivoted)'}
      </div>
    </div>
  );
};

export default DataTable;
