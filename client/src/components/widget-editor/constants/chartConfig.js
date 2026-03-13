/**
 * Chart format options and configuration helpers
 */

// Date part extraction options for date/timestamp fields
export const DATE_PARTS = [
  { value: 'YEAR', label: 'Year' },
  { value: 'QUARTER', label: 'Quarter' },
  { value: 'MONTH', label: 'Month' },
  { value: 'WEEK', label: 'Week' },
  { value: 'DAY', label: 'Day' },
  { value: 'DAYOFWEEK', label: 'Day of Week' },
  { value: 'HOUR', label: 'Hour' },
];

/**
 * Chart format options and configuration helpers
 * 
 * SMART CHART LOGIC:
 * Following Tableau/Power BI star schema approach:
 * 
 * SHELVES:
 *   - Columns: X-axis dimension (categories across the top)
 *   - Rows: Series/grouping dimension (creates multiple lines/bars) or additional measures
 *   - Values (Marks): Measures to aggregate (Y-axis values)
 * 
 * SQL GENERATION:
 *   - GROUP BY all dimensions (columns + rows)
 *   - Aggregate all measures
 *   - NO server-side pivoting - visualization handles layout
 * 
 * VISUALIZATION:
 *   - Chart types interpret shelves differently:
 *     Bar/Line: columns=X-axis, rows=color/series, values=Y-height
 *     Pie/Donut: columns=slices, values=size
 *     Table: flat display of all fields
 *     Pivot/Crosstab: columns=column headers, rows=row headers (CLIENT-SIDE pivot)
 */

// Chart format options config - defines which options each chart type supports
export const CHART_FORMAT_OPTIONS = {
    // Bar charts
    bar: { showGrid: true, showLabels: true, animate: true, labelColor: true, showLegend: true, legendPosition: true, axisTitles: true, numberFormat: true, showTotals: true },
    'horizontal-bar': { showGrid: true, showLabels: true, animate: true, labelColor: true, showLegend: true, legendPosition: true, axisTitles: true, numberFormat: true, showTotals: true },
    'diverging-bar': { showGrid: true, showLabels: true, animate: true, labelColor: true, showLegend: true, legendPosition: true, axisTitles: true, numberFormat: true, showTotals: true },
    // Line charts
    line: { showGrid: true, showLabels: true, animate: true, labelColor: true, showDots: true, showLegend: true, legendPosition: true, axisTitles: true, numberFormat: true, showTotals: true },
    area: { showGrid: true, showLabels: true, animate: true, labelColor: true, showLegend: true, legendPosition: true, axisTitles: true, numberFormat: true, showTotals: true },
    // Circular charts
    pie: { showLegend: true, legendPosition: true, showLabels: true, animate: true, labelColor: true, numberFormat: true, showTotals: true },
    donut: { showLegend: true, legendPosition: true, showLabels: true, animate: true, labelColor: true, numberFormat: true, showTotals: true },
    radial: { showLegend: true, legendPosition: true, showLabels: true, animate: true, labelColor: true, showTotals: true },
    // Hierarchy
    treemap: { showLabels: true, animate: true, labelColor: true, numberFormat: true, showTotals: true },
    icicle: { showLabels: true, animate: true, labelColor: true, showTotals: true },
    // Scatter
    scatter: { showGrid: true, showLabels: true, animate: true, labelColor: true, showLegend: true, legendPosition: true, axisTitles: true, showTotals: true },
   // Flow
    sankey: { showLabels: true, animate: true, labelColor: true, numberFormat: true, showTotals: true },
    funnel: { showLabels: true, animate: true, labelColor: true, numberFormat: true, showTotals: true },

    // Data display
    table: { fontSize: true, numberFormat: true, showTotals: true },
    pivot: { fontSize: true, showTotals: true, heatmapColors: true, numberFormat: true },
    metric: { fontSize: true, textColor: true, showLabels: true, animate: true, numberFormat: true, metricIcon: true, showSparkline: true, comparisonLabel: true },
  };
  
  // Legend position options
  export const LEGEND_POSITIONS = [
    { value: 'top', label: 'Top' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
  ];
  
  // Default format values per chart type
  export const CHART_FORMAT_DEFAULTS = {
    bar: { showGrid: true, showLabels: false, showLegend: true, legendPosition: 'right', animate: true, labelColor: '#a0a0b0', xAxisTitle: '', yAxisTitle: '', showTotals: false },
    'horizontal-bar': { showGrid: true, showLabels: true, showLegend: true, legendPosition: 'right', animate: true, labelColor: '#a0a0b0', xAxisTitle: '', yAxisTitle: '', showTotals: false },
    'diverging-bar': { showGrid: true, showLabels: false, showLegend: true, legendPosition: 'right', animate: true, labelColor: '#a0a0b0', xAxisTitle: '', yAxisTitle: '', showTotals: false },
    line: { showGrid: true, showLabels: false, showLegend: true, legendPosition: 'right', animate: true, showDots: true, labelColor: '#a0a0b0', xAxisTitle: '', yAxisTitle: '', showTotals: false },
    area: { showGrid: true, showLabels: false, showLegend: true, legendPosition: 'right', animate: true, labelColor: '#a0a0b0', xAxisTitle: '', yAxisTitle: '', showTotals: false },
    pie: { showLegend: true, legendPosition: 'right', showLabels: true, animate: true, labelColor: '#a0a0b0', showTotals: false },
    donut: { showLegend: true, legendPosition: 'right', showLabels: true, animate: true, labelColor: '#a0a0b0', showTotals: false },
    radial: { showLegend: true, legendPosition: 'right', showLabels: false, animate: true, labelColor: '#a0a0b0', showTotals: false },
    treemap: { showLabels: true, animate: true, labelColor: '#ffffff', showTotals: false },
    icicle: { showLabels: true, animate: true, labelColor: '#ffffff', showTotals: false },
    scatter: { showGrid: true, showLabels: false, showLegend: true, legendPosition: 'right', animate: true, labelColor: '#a0a0b0', xAxisTitle: '', yAxisTitle: '', showTotals: false },
    histogram: { showGrid: true, showLabels: false, animate: true, labelColor: '#a0a0b0', xAxisTitle: '', yAxisTitle: '', showTotals: false },
    boxplot: { showGrid: true, showLabels: false, animate: true, labelColor: '#a0a0b0', xAxisTitle: '', yAxisTitle: '', showTotals: false },
    sankey: { showLabels: true, animate: true, labelColor: '#a0a0b0', showTotals: false },
    funnel: { showLabels: true, animate: true, labelColor: '#a0a0b0', showTotals: false },
    table: { fontSize: 12, showTotals: false },
    pivot: { fontSize: 12, showTotals: true, heatmapColors: false },
    metric: { fontSize: 14, textColor: 'var(--text-primary)', showLabels: true, animate: true, metricIcon: '', showSparkline: true, comparisonLabel: 'Prior Period' },
  };
  
  // Get format options for a chart type, applying defaults
  export const getFormatDefaults = (chartType) => {
    return {
      colorPreset: 0,
      fontSize: 12,
      textColor: 'var(--text-primary)',
      labelColor: '#a0a0b0',
      showGrid: true,
      showLabels: false,
      showLegend: true,
      legendPosition: 'right',
      showDots: true,
      animate: true,
      xAxisTitle: '',
      yAxisTitle: '',
      ...CHART_FORMAT_DEFAULTS[chartType],
    };
  };
  
  /**
   * Determine how shelves should be interpreted for a given chart type
   * This is the "smart" logic that knows when to pivot vs when not to
   */
  export const getChartDataMapping = (chartType) => {
    // Default: no pivoting, columns=xAxis, rows=series
    const defaultMapping = {
      // How to interpret shelf fields
      columnsRole: 'xAxis',      // X-axis categories
      rowsRole: 'series',        // Color/series grouping
      valuesRole: 'yAxis',       // Y-axis values
      
      // SQL behavior
      shouldPivot: false,        // Whether to pivot data client-side
      groupByAllDimensions: true, // GROUP BY all dimensions
      
      // Visualization behavior
      xAxisField: 'columns',     // Which shelf provides X-axis
      seriesField: 'rows',       // Which shelf provides series/color
      valueField: 'values',      // Which shelf provides values
    };
  
    switch (chartType) {
      // Cartesian charts: X-axis, series, Y-values
      case 'bar':
      case 'horizontal-bar':
      case 'line':
      case 'area':
      case 'diverging-bar':
        return {
          ...defaultMapping,
          columnsRole: 'xAxis',    // Categories on X
          rowsRole: 'series',      // Additional dimension = color/grouping
          valuesRole: 'yAxis',     // Measures on Y
        };
      
      // Circular charts: single dimension = slices, measure = size
      case 'pie':
      case 'donut':
      case 'radial':
        return {
          ...defaultMapping,
          columnsRole: 'category', // Slice categories
          rowsRole: 'ignored',     // Not used (or could be sub-categories)
          valuesRole: 'size',      // Slice size
        };
      
      // Hierarchical: dimensions create hierarchy, measure = size
      case 'treemap':
      case 'icicle':
        return {
          ...defaultMapping,
          columnsRole: 'hierarchy', // Multiple dimensions = hierarchy levels
          rowsRole: 'hierarchy',    // Additional hierarchy levels
          valuesRole: 'size',       // Node size
        };
      
      // Flow charts: source/target dimensions, measure = flow
      case 'sankey':
        return {
          ...defaultMapping,
          columnsRole: 'sourceTarget', // First = source, second = target
          rowsRole: 'ignored',
          valuesRole: 'flow',         // Flow thickness
        };
      
   
      
      // Table: flat display, no transformation
      case 'table':
        return {
          ...defaultMapping,
          columnsRole: 'display',  // Just columns to display
          rowsRole: 'display',     // Just columns to display
          valuesRole: 'display',   // Just columns to display
          shouldPivot: false,
        };
      
      // Pivot/Crosstab: CLIENT-SIDE pivoting
      case 'pivot':
      case 'crosstab':
        return {
          ...defaultMapping,
          columnsRole: 'columnHeaders', // Create column headers
          rowsRole: 'rowHeaders',       // Create row headers
          valuesRole: 'cells',          // Cell values at intersection
          shouldPivot: true,            // Enable client-side pivoting
        };
      
      // Single metric: just one measure
      case 'metric':
  
      
      // Scatter: X measure, Y measure, optional size/color
      case 'scatter':
        return {
          ...defaultMapping,
          columnsRole: 'xMeasure',  // X-axis measure
          rowsRole: 'yMeasure',     // Y-axis measure
          valuesRole: 'size',       // Optional size
        };
      
      default:
        return defaultMapping;
    }
  };
  
  // Tableau-style shelf configuration with smart hints
  export const getChartConfig = (type) => {
    const defaultConfig = {
      columnsLabel: 'Columns',
      columnsPlaceholder: 'Dimensions for X-axis',
      columnsHint: 'Creates categories across the chart',
      rowsLabel: 'Rows', 
      rowsPlaceholder: 'Dimensions for series/grouping',
      rowsHint: 'Creates multiple series or facets',
      valuesLabel: 'Values',
      valuesPlaceholder: 'Measures to aggregate',
      valuesHint: 'Numeric values for Y-axis',
      // Constraints
      minColumns: 0,
      maxColumns: 10,
      minRows: 0,
      maxRows: 10,
      minValues: 0,
      maxValues: 10,
      // Smart behavior flags
      allowMeasuresInColumns: false,  // Can measures go in Columns shelf?
      allowDimensionsInRows: true,    // Can dimensions go in Rows shelf?
      autoGroupBy: true,              // Automatically GROUP BY all dimensions
      clientSidePivot: false,         // Should we pivot client-side?
    };
  
    switch (type) {
      // BAR/LINE/AREA - Classic X/Y charts
      case 'bar':
      case 'horizontal-bar':
      case 'line':
      case 'area':
        return {
          ...defaultConfig,
          columnsLabel: 'X-Axis',
          columnsPlaceholder: 'Category dimension',
          columnsHint: 'Dimension for X-axis labels (e.g., Region, Month)',
          rowsLabel: 'Series',
          rowsPlaceholder: 'Grouping dimension (optional)',
          rowsHint: 'Creates multiple bars/lines per X value (e.g., Product)',
          valuesLabel: 'Y-Axis',
          valuesPlaceholder: 'Measure(s)',
          valuesHint: 'Aggregated values for bar height/line position',
          minColumns: 1,
          maxColumns: 2,
          minRows: 0,
          maxRows: 1,
          minValues: 1,
          maxValues: 5,
        };
      
      case 'diverging-bar':
        return {
          ...defaultConfig,
          columnsLabel: 'Category',
          columnsHint: 'Main grouping dimension',
          rowsLabel: 'Split By',
          rowsHint: 'Dimension to split positive/negative',
          valuesHint: 'Measure (positive/negative values)',
          minColumns: 1,
          maxColumns: 1,
          minRows: 1,
          maxRows: 1,
          minValues: 1,
          maxValues: 1,
        };
      
      // PIE/DONUT - Circular proportions
      case 'pie':
      case 'donut':
      case 'radial':
        return {
          ...defaultConfig,
          columnsLabel: 'Slices',
          columnsPlaceholder: 'Category dimension',
          columnsHint: 'Each unique value becomes a slice',
          rowsLabel: 'Not Used',
          rowsPlaceholder: '',
          rowsHint: 'Not applicable for pie charts',
          valuesLabel: 'Size',
          valuesPlaceholder: 'Measure',
          valuesHint: 'Determines slice size',
          minColumns: 1,
          maxColumns: 1,
          minRows: 0,
          maxRows: 0,
          minValues: 1,
          maxValues: 1,
        };
      
      // TREEMAP/ICICLE - Hierarchical
      case 'treemap':
      case 'icicle':
        return {
          ...defaultConfig,
          columnsLabel: 'Hierarchy',
          columnsPlaceholder: 'Dimension levels',
          columnsHint: 'Multiple dimensions create nested hierarchy',
          rowsLabel: 'Sub-levels',
          rowsPlaceholder: 'Additional hierarchy',
          rowsHint: 'More dimensions = deeper nesting',
          valuesLabel: 'Size',
          valuesHint: 'Determines rectangle/segment size',
          minColumns: 1,
          maxColumns: 5,
          minRows: 0,
          maxRows: 5,
          minValues: 1,
          maxValues: 1,
        };
      
      // SANKEY - Flow diagram
      case 'sankey':
        return {
          ...defaultConfig,
          columnsLabel: 'Source → Target',
          columnsPlaceholder: 'Two dimensions required',
          columnsHint: 'First = source nodes, Second = target nodes',
          rowsLabel: 'Not Used',
          rowsHint: 'Not applicable for sankey',
          valuesLabel: 'Flow',
          valuesHint: 'Measure for link thickness',
          minColumns: 2,
          maxColumns: 2,
          minRows: 0,
          maxRows: 0,
          minValues: 1,
          maxValues: 1,
        };
      
      // FUNNEL - Stages narrow top to bottom
      case 'funnel':
        return {
          ...defaultConfig,
          columnsLabel: 'Stages',
          columnsPlaceholder: 'Stage dimension',
          columnsHint: 'Category field for each funnel stage',
          rowsLabel: 'Not Used',
          rowsHint: 'Not applicable for funnel',
          valuesLabel: 'Value',
          valuesHint: 'Measure for stage size',
          minColumns: 1,
          maxColumns: 1,
          minRows: 0,
          maxRows: 0,
          minValues: 1,
          maxValues: 1,
        };

      // SCATTER - X/Y measures with optional dimensions
      case 'scatter':
        return {
          ...defaultConfig,
          columnsLabel: 'X-Axis',
          columnsPlaceholder: 'X measure or dimension',
          columnsHint: 'Position on horizontal axis',
          rowsLabel: 'Y-Axis',
          rowsPlaceholder: 'Y measure',
          rowsHint: 'Position on vertical axis',
          valuesLabel: 'Size (optional)',
          valuesHint: 'Bubble size measure',
          allowMeasuresInColumns: true,
          minColumns: 1,
          maxColumns: 1,
          minRows: 1,
          maxRows: 1,
          minValues: 0,
          maxValues: 1,
        };
      
      // METRIC/GAUGE - Single value
      case 'metric':
  
      // TABLE - Flat display
      case 'table':
        return {
          ...defaultConfig,
          columnsLabel: 'Columns',
          columnsPlaceholder: 'Fields to display',
          columnsHint: 'Any fields - displayed as columns',
          rowsLabel: 'Row Fields',
          rowsPlaceholder: 'Additional fields',
          rowsHint: 'More columns for the table',
          valuesLabel: 'Measures',
          valuesHint: 'Numeric columns',
          allowMeasuresInColumns: true,
          minColumns: 0,
          maxColumns: 20,
          minRows: 0,
          maxRows: 20,
          minValues: 0,
          maxValues: 20,
        };
      
      // PIVOT/CROSSTAB - Client-side pivot
      case 'pivot':
      case 'crosstab':
        return {
          ...defaultConfig,
          columnsLabel: 'Column Headers',
          columnsPlaceholder: 'Pivot column dimension',
          columnsHint: 'Values become column headers',
          rowsLabel: 'Row Headers',
          rowsPlaceholder: 'Pivot row dimension',
          rowsHint: 'Values become row labels',
          valuesLabel: 'Cell Values',
          valuesHint: 'Measure shown at intersections',
          clientSidePivot: true,
          minColumns: 1,
          maxColumns: 2,
          minRows: 1,
          maxRows: 2,
          minValues: 1,
          maxValues: 3,
        };
      
      default:
        return defaultConfig;
    }
  };
  