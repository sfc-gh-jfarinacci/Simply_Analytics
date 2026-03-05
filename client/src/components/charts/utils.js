import { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';

/**
 * Format a number according to the specified format type and decimal places
 * @param {number} value - The number to format
 * @param {string} format - Format type: 'auto', 'number', 'decimal', 'currency', 'percent', 'compact'
 * @param {number} decimals - Number of decimal places (for decimal, currency, percent)
 * @returns {string} Formatted number string
 */
export const formatNumber = (value, format = 'auto', decimals = 2) => {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  
  switch (format) {
    case 'number':
      return Math.round(value).toLocaleString();
    
    case 'decimal':
      return value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    
    case 'currency':
      return value.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    
    case 'percent':
      // Assume value is already a percentage (e.g., 12.5 means 12.5%)
      return value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) + '%';
    
    case 'compact':
      if (Math.abs(value) >= 1e12) {
        return (value / 1e12).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'T';
      }
      if (Math.abs(value) >= 1e9) {
        return (value / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'B';
      }
      if (Math.abs(value) >= 1e6) {
        return (value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'M';
      }
      if (Math.abs(value) >= 1e3) {
        return (value / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'K';
      }
      return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    
    case 'auto':
    default:
      // Auto: use compact for large numbers, decimal for decimals, integer for integers
      if (Math.abs(value) >= 1e6) {
        // Use compact for very large numbers
        if (Math.abs(value) >= 1e9) {
          return (value / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'B';
        }
        return (value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'M';
      }
      if (Number.isInteger(value)) {
        return value.toLocaleString();
      }
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
  }
};

/**
 * Apply zoom and pan behavior to a D3 chart
 * Double-click to reset zoom
 * @param {Object} svgEl - D3 selection of the SVG element
 * @param {Object} chartGroup - D3 selection of the chart content group to transform
 * @param {Object} options - Configuration options
 */
export const applyChartZoom = (svgEl, chartGroup, options = {}) => {
  const {
    minZoom = 0.5,
    maxZoom = 5,
  } = options;
  
  const zoom = d3.zoom()
    .scaleExtent([minZoom, maxZoom])
    .on('zoom', (event) => {
      chartGroup.attr('transform', event.transform);
    });
  
  svgEl.call(zoom);
  
  // Double-click to reset
  svgEl.on('dblclick.zoom', () => {
    svgEl.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
  });
  
  return zoom;
};

/**
 * Helper hook for stable ResizeObserver that ignores minor changes
 * Prevents hover jitter by only updating if dimensions change by more than 2px
 */
export const useStableResize = (containerRef) => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const lastDimensions = useRef({ width: 0, height: 0 });
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Force initial measurement immediately
    const measureAndSet = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const widthDiff = Math.abs(rect.width - lastDimensions.current.width);
        const heightDiff = Math.abs(rect.height - lastDimensions.current.height);
        if (widthDiff > 2 || heightDiff > 2) {
          lastDimensions.current = { width: rect.width, height: rect.height };
          setDimensions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
        }
      }
    };
    
    // Measure immediately
    measureAndSet();
    
    // Also measure after a frame (for modals/portals that need layout to settle)
    const rafId = requestAnimationFrame(() => {
      measureAndSet();
    });
    
    // And after a short delay for slower renders
    const timeoutId = setTimeout(measureAndSet, 100);
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // Only update if dimensions changed by more than 2 pixels (prevents hover jitter)
        const widthDiff = Math.abs(width - lastDimensions.current.width);
        const heightDiff = Math.abs(height - lastDimensions.current.height);
        if (width > 0 && height > 0 && (widthDiff > 2 || heightDiff > 2)) {
          lastDimensions.current = { width, height };
          setDimensions({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });
    
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [containerRef]);
  
  return dimensions;
};

/**
 * D3 color scheme configurations
 * Each scheme has a name, type, and either a fixed array or an interpolator
 * 
 * Types:
 * - categorical: Distinct colors for different categories
 * - sequential: Light→Dark gradients for showing magnitude (single or multi-hue)
 * - diverging: Two colors with neutral midpoint (for positive/negative, above/below)
 */
export const COLOR_SCHEMES = {
  // Categorical schemes - best for distinct categories
  tableau10: { name: 'Tableau 10', type: 'categorical', scheme: d3.schemeTableau10 },
  category10: { name: 'Category 10', type: 'categorical', scheme: d3.schemeCategory10 },
  set1: { name: 'Set 1', type: 'categorical', scheme: d3.schemeSet1 },
  set2: { name: 'Set 2', type: 'categorical', scheme: d3.schemeSet2 },
  set3: { name: 'Set 3', type: 'categorical', scheme: d3.schemeSet3 },
  paired: { name: 'Paired', type: 'categorical', scheme: d3.schemePaired },
  dark2: { name: 'Dark 2', type: 'categorical', scheme: d3.schemeDark2 },
  pastel1: { name: 'Pastel 1', type: 'categorical', scheme: d3.schemePastel1 },
  pastel2: { name: 'Pastel 2', type: 'categorical', scheme: d3.schemePastel2 },
  accent: { name: 'Accent', type: 'categorical', scheme: d3.schemeAccent },
  
  // Sequential schemes - light→dark gradients for showing magnitude
  // Single-hue (great for heatmaps, treemaps)
  blues: { name: 'Blues', type: 'sequential', interpolator: d3.interpolateBlues },
  greens: { name: 'Greens', type: 'sequential', interpolator: d3.interpolateGreens },
  oranges: { name: 'Oranges', type: 'sequential', interpolator: d3.interpolateOranges },
  purples: { name: 'Purples', type: 'sequential', interpolator: d3.interpolatePurples },
  reds: { name: 'Reds', type: 'sequential', interpolator: d3.interpolateReds },
  greys: { name: 'Greys', type: 'sequential', interpolator: d3.interpolateGreys },
  // Multi-hue sequential
  viridis: { name: 'Viridis', type: 'sequential', interpolator: d3.interpolateViridis },
  plasma: { name: 'Plasma', type: 'sequential', interpolator: d3.interpolatePlasma },
  inferno: { name: 'Inferno', type: 'sequential', interpolator: d3.interpolateInferno },
  magma: { name: 'Magma', type: 'sequential', interpolator: d3.interpolateMagma },
  turbo: { name: 'Turbo', type: 'sequential', interpolator: d3.interpolateTurbo },
  warm: { name: 'Warm', type: 'sequential', interpolator: d3.interpolateWarm },
  cool: { name: 'Cool', type: 'sequential', interpolator: d3.interpolateCool },
  // Two-hue sequential
  blueGreen: { name: 'Blue-Green', type: 'sequential', interpolator: d3.interpolateBuGn },
  bluePurple: { name: 'Blue-Purple', type: 'sequential', interpolator: d3.interpolateBuPu },
  greenBlue: { name: 'Green-Blue', type: 'sequential', interpolator: d3.interpolateGnBu },
  orangeRed: { name: 'Orange-Red', type: 'sequential', interpolator: d3.interpolateOrRd },
  purpleBlue: { name: 'Purple-Blue', type: 'sequential', interpolator: d3.interpolatePuBu },
  purpleRed: { name: 'Purple-Red', type: 'sequential', interpolator: d3.interpolatePuRd },
  redPurple: { name: 'Red-Purple', type: 'sequential', interpolator: d3.interpolateRdPu },
  yellowGreen: { name: 'Yellow-Green', type: 'sequential', interpolator: d3.interpolateYlGn },
  yellowOrangeBrown: { name: 'Yellow-Orange-Brown', type: 'sequential', interpolator: d3.interpolateYlOrBr },
  yellowOrangeRed: { name: 'Yellow-Orange-Red', type: 'sequential', interpolator: d3.interpolateYlOrRd },
  
  // Diverging schemes - two colors with neutral midpoint
  // Perfect for showing positive/negative, above/below average, hot/cold
  rdBu: { name: 'Red-Blue', type: 'diverging', interpolator: d3.interpolateRdBu },
  rdYlGn: { name: 'Red-Yellow-Green', type: 'diverging', interpolator: d3.interpolateRdYlGn },
  prGn: { name: 'Purple-Green', type: 'diverging', interpolator: d3.interpolatePRGn },
  piYG: { name: 'Pink-Green', type: 'diverging', interpolator: d3.interpolatePiYG },
  brBG: { name: 'Brown-Teal', type: 'diverging', interpolator: d3.interpolateBrBG },
  puOr: { name: 'Purple-Orange', type: 'diverging', interpolator: d3.interpolatePuOr },
  rdGy: { name: 'Red-Grey', type: 'diverging', interpolator: d3.interpolateRdGy },
  rdYlBu: { name: 'Red-Yellow-Blue', type: 'diverging', interpolator: d3.interpolateRdYlBu },
  spectral: { name: 'Spectral', type: 'diverging', interpolator: d3.interpolateSpectral },
};

/**
 * Default color scheme key
 */
export const DEFAULT_COLOR_SCHEME = 'tableau10';

/**
 * Legacy fallback colors (for backwards compatibility)
 */
export const DEFAULT_COLORS = d3.schemeTableau10;

/**
 * Create a color scale for a given number of data points
 * This dynamically generates the right number of distinct colors
 * 
 * @param {string} schemeKey - Key from COLOR_SCHEMES (default: 'tableau10')
 * @param {number} count - Number of distinct colors needed
 * @param {Array} domain - Optional domain values for the scale
 * @returns {Function} D3 color scale function
 */
export const createColorScale = (schemeKey = DEFAULT_COLOR_SCHEME, count = 10, domain = null) => {
  const schemeConfig = COLOR_SCHEMES[schemeKey] || COLOR_SCHEMES[DEFAULT_COLOR_SCHEME];
  
  if (schemeConfig.type === 'categorical') {
    // For categorical, use ordinal scale with the scheme
    const scale = d3.scaleOrdinal(schemeConfig.scheme);
    if (domain) {
      scale.domain(domain);
    }
    return scale;
  } else {
    // For sequential/interpolated schemes, generate N distinct colors
    // Use d3.quantize to sample N colors evenly from the interpolator
    const colors = d3.quantize(schemeConfig.interpolator, Math.max(count, 2));
    const scale = d3.scaleOrdinal(colors);
    if (domain) {
      scale.domain(domain);
    }
    return scale;
  }
};

/**
 * Get an array of colors for a given scheme and count
 * Useful when you need raw color arrays instead of a scale
 * 
 * @param {string} schemeKey - Key from COLOR_SCHEMES (default: 'tableau10')
 * @param {number} count - Number of colors to generate
 * @returns {Array} Array of color strings
 */
export const getColorArray = (schemeKey = DEFAULT_COLOR_SCHEME, count = 10) => {
  const schemeConfig = COLOR_SCHEMES[schemeKey] || COLOR_SCHEMES[DEFAULT_COLOR_SCHEME];
  
  if (schemeConfig.type === 'categorical') {
    // For categorical, return the scheme (may cycle if count > scheme length)
    const scheme = schemeConfig.scheme;
    if (count <= scheme.length) {
      return scheme.slice(0, count);
    }
    // Cycle through colors if we need more than the scheme provides
    return Array.from({ length: count }, (_, i) => scheme[i % scheme.length]);
  } else {
    // For sequential/intensity, sample N colors evenly from the interpolator
    return d3.quantize(schemeConfig.interpolator, Math.max(count, 2));
  }
};

/**
 * Create an intensity scale that maps numeric values to color intensity
 * Darker colors represent higher values (like a heatmap)
 * 
 * @param {string} schemeKey - Key from COLOR_SCHEMES (should be an 'intensity' type scheme)
 * @param {number} minValue - Minimum value in the data range
 * @param {number} maxValue - Maximum value in the data range
 * @param {boolean} invertScale - If true, lighter = higher value (default: false, darker = higher)
 * @returns {Function} D3 sequential scale function that takes a value and returns a color
 */
export const createIntensityScale = (schemeKey = 'blues', minValue = 0, maxValue = 100, invertScale = false) => {
  const schemeConfig = COLOR_SCHEMES[schemeKey] || COLOR_SCHEMES['blues'];
  
  // For intensity scales, use scaleSequential with the interpolator
  const interpolator = schemeConfig.interpolator || d3.interpolateBlues;
  
  // Create the scale
  let scale;
  if (invertScale) {
    // Invert: lighter colors for higher values
    scale = d3.scaleSequential(t => interpolator(1 - t))
      .domain([minValue, maxValue]);
  } else {
    // Normal: darker colors for higher values
    // Start at 0.1 to avoid completely white for low values
    scale = d3.scaleSequential(t => interpolator(0.1 + t * 0.9))
      .domain([minValue, maxValue]);
  }
  
  return scale;
};

/**
 * Create a diverging color scale for values with a meaningful midpoint
 * Useful for showing positive/negative values, above/below average, etc.
 * 
 * @param {string} schemeKey - Key for diverging scheme (e.g., 'rdBu', 'rdYlGn')
 * @param {number} minValue - Minimum value
 * @param {number} midValue - Midpoint value (e.g., 0 for positive/negative)
 * @param {number} maxValue - Maximum value
 * @returns {Function} D3 diverging scale function
 */
export const createDivergingScale = (schemeKey = 'rdBu', minValue = -100, midValue = 0, maxValue = 100) => {
  // Map of diverging interpolators
  const divergingInterpolators = {
    rdBu: d3.interpolateRdBu,
    rdYlBu: d3.interpolateRdYlBu,
    rdYlGn: d3.interpolateRdYlGn,
    brBG: d3.interpolateBrBG,
    piYG: d3.interpolatePiYG,
    prGn: d3.interpolatePRGn,
    puOr: d3.interpolatePuOr,
    spectral: d3.interpolateSpectral,
  };
  
  const interpolator = divergingInterpolators[schemeKey] || d3.interpolateRdBu;
  
  return d3.scaleDiverging(interpolator)
    .domain([minValue, midValue, maxValue]);
};

/**
 * Check if a color scheme is an intensity-based scheme
 * @param {string} schemeKey - Key from COLOR_SCHEMES
 * @returns {boolean} True if this is an intensity scheme
 */
/**
 * Check if a scheme is sequential (suitable for magnitude-based coloring)
 */
export const isSequentialScheme = (schemeKey) => {
  const schemeConfig = COLOR_SCHEMES[schemeKey];
  return schemeConfig?.type === 'sequential';
};

/**
 * Check if a scheme is diverging (suitable for above/below midpoint coloring)
 */
export const isDivergingScheme = (schemeKey) => {
  const schemeConfig = COLOR_SCHEMES[schemeKey];
  return schemeConfig?.type === 'diverging';
};

/**
 * Legacy alias for isSequentialScheme (backwards compatibility)
 */
export const isIntensityScheme = isSequentialScheme;

/**
 * Common chart margin presets
 */
export const CHART_MARGINS = {
  default: { top: 20, right: 20, bottom: 60, left: 60 },
  withLegend: { top: 20, right: 120, bottom: 60, left: 60 },
  horizontal: { top: 20, right: 30, bottom: 40, left: 100 },
  horizontalWithLegend: { top: 20, right: 120, bottom: 40, left: 100 },
  compact: { top: 10, right: 10, bottom: 30, left: 40 },
};

/**
 * Common label styling
 */
export const LABEL_STYLES = {
  fontFamily: 'Outfit',
  fontSize: 11,
  color: '#a0a0b0',
};

/**
 * Grid line styling
 */
export const GRID_STYLES = {
  stroke: 'rgba(128,128,128,0.25)',
  strokeDasharray: '3,3',
};

/**
 * Axis styling
 */
export const AXIS_STYLES = {
  domainStroke: '#2a2a3a',
  tickStroke: '#2a2a3a',
};

/**
 * Helper to find column name in data - handles semantic naming like ORDER_DATE__YEAR -> ORDER_DATE_YEAR
 * @param {Array} columns - Array of column objects with name property
 * @param {string} name - The column name to find (may include __ semantic parts)
 * @returns {string|null} The matched column name or the original name
 */
export const findColumnName = (columns, name) => {
  if (!name || !columns || !columns.length) return name;
  
  // Ensure name is a string
  const searchName = typeof name === 'string' ? name : String(name);
  
  // Helper to get column name (handles both string arrays and object arrays)
  const getColName = (c) => typeof c === 'string' ? c : (c?.name || String(c));
  
  // Direct match first (case-insensitive)
  let col = columns.find(c => {
    const colName = getColName(c);
    return colName && colName.toUpperCase() === searchName.toUpperCase();
  });
  if (col) return getColName(col);
  
  // Try matching with __ replaced by _ (semantic notation ORDER_DATE__YEAR -> ORDER_DATE_YEAR)
  if (searchName.includes('__')) {
    const normalizedName = searchName.replace(/__/g, '_');
    col = columns.find(c => {
      const colName = getColName(c);
      return colName && colName.toUpperCase() === normalizedName.toUpperCase();
    });
    if (col) return getColName(col);
    
    // Also try just the suffix after __ (ORDER_DATE__YEAR -> YEAR)
    const suffix = searchName.split('__').pop();
    col = columns.find(c => {
      const colName = getColName(c);
      return colName && colName.toUpperCase() === suffix.toUpperCase();
    });
    if (col) return getColName(col);
  }
  
  // Try matching if data column ends with our name (or normalized version)
  col = columns.find(c => {
    const colName = getColName(c);
    return colName && colName.toUpperCase().endsWith(searchName.toUpperCase());
  });
  if (col) return getColName(col);
  
  // Try matching if our name ends with data column
  col = columns.find(c => {
    const colName = getColName(c);
    return colName && searchName.toUpperCase().endsWith(colName.toUpperCase());
  });
  if (col) return getColName(col);
  
  return searchName; // Return original if no match
};

/**
 * Helper to get row value - handles semantic naming and case-insensitive matching
 * @param {Object} row - Data row object
 * @param {string} name - The column name to get (may include __ semantic parts)
 * @returns {*} The value or undefined
 */
export const getRowValue = (row, name) => {
  if (!name || !row) return undefined;
  
  // Ensure name is a string
  const searchName = typeof name === 'string' ? name : (name?.name || String(name));
  if (!searchName) return undefined;
  
  // Direct match
  if (row[searchName] !== undefined) return row[searchName];
  
  const keys = Object.keys(row);
  
  // Case-insensitive match
  let key = keys.find(k => k.toUpperCase() === searchName.toUpperCase());
  if (key) return row[key];
  
  // Try with __ replaced by _ (semantic notation ORDER_DATE__YEAR -> ORDER_DATE_YEAR)
  if (searchName.includes('__')) {
    const normalizedName = searchName.replace(/__/g, '_');
    key = keys.find(k => k.toUpperCase() === normalizedName.toUpperCase());
    if (key) return row[key];
    
    // Also try just the suffix after __ (ORDER_DATE__YEAR -> YEAR)
    const suffix = searchName.split('__').pop();
    key = keys.find(k => k.toUpperCase() === suffix.toUpperCase());
    if (key) return row[key];
  }
  
  // Try if row key ends with our name
  key = keys.find(k => k.toUpperCase().endsWith(searchName.toUpperCase()));
  if (key) return row[key];
  
  // Try if our name ends with row key
  key = keys.find(k => searchName.toUpperCase().endsWith(k.toUpperCase()));
  if (key) return row[key];
  
  return undefined;
};

/**
 * Apply focus/highlight behavior to chart elements
 * Click on an element to focus it (dims others), click again to unfocus
 * 
 * @param {Object} svg - D3 selection of the SVG element
 * @param {Object} options - Configuration options
 * @param {string} options.elementSelector - CSS selector for focusable elements (e.g., '.line', '.bar')
 * @param {string} options.groupAttribute - Attribute that identifies the group (e.g., 'data-series')
 * @param {number} options.dimOpacity - Opacity for dimmed elements (default: 0.15)
 * @param {number} options.focusOpacity - Opacity for focused element (default: 1)
 * @param {Function} options.onFocus - Callback when element is focused (receives group name)
 * @param {Function} options.onUnfocus - Callback when focus is cleared
 */
export const applyChartFocus = (svg, options = {}) => {
  const {
    dimOpacity = 0.15,
    focusOpacity = 1,
    transitionDuration = 200,
    onFocus = null,
    onUnfocus = null,
  } = options;
  
  let focusedGroup = null;
  
  // Function to focus on a specific group
  const focusOn = (groupName, elements) => {
    if (focusedGroup === groupName) {
      // Already focused on this - unfocus
      clearFocus(elements);
      return;
    }
    
    focusedGroup = groupName;
    
    elements.each(function() {
      const el = d3.select(this);
      const elGroup = el.attr('data-series') || el.attr('data-group');
      
      el.transition()
        .duration(transitionDuration)
        .style('opacity', elGroup === groupName ? focusOpacity : dimOpacity);
    });
    
    if (onFocus) onFocus(groupName);
  };
  
  // Function to clear focus (show all)
  const clearFocus = (elements) => {
    focusedGroup = null;
    
    elements.transition()
      .duration(transitionDuration)
      .style('opacity', focusOpacity);
    
    if (onUnfocus) onUnfocus();
  };
  
  // Function to check if currently focused
  const isFocused = () => focusedGroup !== null;
  const getFocusedGroup = () => focusedGroup;
  
  return { focusOn, clearFocus, isFocused, getFocusedGroup };
};

/**
 * Apply interactive focus behavior to a legend
 * Clicking legend items focuses/unfocuses the corresponding chart elements
 * 
 * @param {Object} legendGroup - D3 selection of the legend group
 * @param {Object} chartElements - D3 selection of chart elements to control
 * @param {Object} options - Configuration options
 */
export const applyLegendFocus = (legendGroup, chartElements, options = {}) => {
  const {
    dimOpacity = 0.15,
    focusOpacity = 1,
    transitionDuration = 200,
  } = options;
  
  let focusedKey = null;
  
  legendGroup.selectAll('.legend-item')
    .style('cursor', 'pointer')
    .on('click', function(event, d) {
      event.stopPropagation();
      const key = d3.select(this).attr('data-key') || d;
      
      if (focusedKey === key) {
        // Unfocus - show all
        focusedKey = null;
        chartElements.transition()
          .duration(transitionDuration)
          .style('opacity', focusOpacity);
        legendGroup.selectAll('.legend-item')
          .transition()
          .duration(transitionDuration)
          .style('opacity', 1);
      } else {
        // Focus on this key
        focusedKey = key;
        chartElements.each(function() {
          const el = d3.select(this);
          const elKey = el.attr('data-series') || el.attr('data-key');
          el.transition()
            .duration(transitionDuration)
            .style('opacity', elKey === key ? focusOpacity : dimOpacity);
        });
        legendGroup.selectAll('.legend-item').each(function() {
          const item = d3.select(this);
          const itemKey = item.attr('data-key');
          item.transition()
            .duration(transitionDuration)
            .style('opacity', itemKey === key ? 1 : 0.4);
        });
      }
    });
  
  return { getFocusedKey: () => focusedKey };
};

/**
 * Add axis titles to a chart
 * @param {Object} svg - D3 selection of the SVG element
 * @param {Object} options - Configuration options
 * @param {string} options.xAxisTitle - Title for X-axis
 * @param {string} options.yAxisTitle - Title for Y-axis
 * @param {number} options.width - Chart width (inner, without margins)
 * @param {number} options.height - Chart height (inner, without margins)
 * @param {Object} options.margin - Chart margins { top, right, bottom, left }
 * @param {string} options.labelColor - Color for axis titles (default: '#a0a0b0')
 * @param {number} options.fontSize - Font size for axis titles (default: 11)
 */
export const addAxisTitles = (svg, options = {}) => {
  const {
    xAxisTitle,
    yAxisTitle,
    width,
    height,
    margin,
    labelColor = '#a0a0b0',
    fontSize = 11,
  } = options;

  // Remove any existing axis titles
  svg.selectAll('.axis-title').remove();

  // Add X-axis title
  if (xAxisTitle) {
    svg.append('text')
      .attr('class', 'axis-title x-axis-title')
      .attr('x', margin.left + width / 2)
      .attr('y', margin.top + height + margin.bottom - 8)
      .attr('text-anchor', 'middle')
      .attr('fill', labelColor)
      .attr('font-size', `${fontSize + 1}px`)
      .attr('font-weight', '500')
      .attr('font-family', 'Outfit, sans-serif')
      .text(xAxisTitle);
  }

  // Add Y-axis title (rotated)
  if (yAxisTitle) {
    svg.append('text')
      .attr('class', 'axis-title y-axis-title')
      .attr('x', -(margin.top + height / 2))
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .attr('fill', labelColor)
      .attr('font-size', `${fontSize + 1}px`)
      .attr('font-weight', '500')
      .attr('font-family', 'Outfit, sans-serif')
      .text(yAxisTitle);
  }
};
