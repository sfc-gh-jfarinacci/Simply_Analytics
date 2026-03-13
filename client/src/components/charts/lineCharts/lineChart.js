/**
 * D3.js Line & Area Chart
 *
 * Supports:
 * - Single line
 * - Multi-line (multiple measures or color-split)
 * - Area fill (solid or gradient)
 * - Stacked area
 * - Trellis (small multiples)
 *
 * Features:
 * - Animated path drawing
 * - Hover crosshair with tooltip
 * - Click focus on series
 * - Interactive data points
 * - Configurable curve interpolation
 * - Legends with pagination
 */

import * as d3 from 'd3';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1'
];

const STYLES = {
  axis: {
    textColor: '#a0a0b0',
    lineColor: 'rgba(100, 100, 120, 0.3)',
    fontSize: '11px',
    smallFontSize: '9px',
  },
  grid: {
    lineColor: 'rgba(100, 100, 120, 0.15)',
    dashArray: '3,3',
  },
  tooltip: {
    background: 'rgba(30, 30, 40, 0.95)',
    border: '1px solid rgba(100, 100, 120, 0.3)',
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '12px',
    color: '#e0e0e0',
    shadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  line: {
    strokeWidth: 2,
    hoverStrokeWidth: 3,
    dimmedOpacity: 0.15,
    dotRadius: 3.5,
    dotHoverRadius: 5,
    activeDotRadius: 4,
  },
  area: {
    fillOpacity: 0.2,
    stackedFillOpacity: 0.5,
  },
  label: {
    color: '#a0a0b0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
};

const CURVES = {
  linear: d3.curveLinear,
  monotone: d3.curveMonotoneX,
  cardinal: d3.curveCardinal.tension(0.5),
  catmullRom: d3.curveCatmullRom.alpha(0.5),
  step: d3.curveStep,
  natural: d3.curveNatural,
  basis: d3.curveBasis,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getRowValue = (row, key) => {
  if (!row || key == null) return undefined;
  const keyStr = typeof key === 'string' ? key : String(key);
  if (row[keyStr] !== undefined) return row[keyStr];
  const keyUpper = keyStr.toUpperCase();
  const matchedKey = Object.keys(row).find(k => k.toUpperCase() === keyUpper);
  if (matchedKey) return row[matchedKey];
  const keyNormalized = keyUpper.replace(/_/g, '');
  const matchedNorm = Object.keys(row).find(k => k.toUpperCase().replace(/_/g, '') === keyNormalized);
  return matchedNorm ? row[matchedNorm] : undefined;
};

const toPrimitive = (v) => {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Date) return v;
  if (v.name != null) return v.name;
  if (v.value != null) return v.value;
  if (v.label != null) return v.label;
  const vals = Object.values(v).filter(x => x != null && typeof x !== 'object');
  return vals.length > 0 ? vals[0] : String(v);
};

const getUniqueValues = (data, field) => {
  if (!field) return [];
  const values = data.map(d => toPrimitive(getRowValue(d, field))).filter(v => v != null);
  return [...new Set(values)];
};

const getAggregationFunction = (aggregationType, fieldName) => {
  const type = (aggregationType || 'sum').toLowerCase();
  switch (type) {
    case 'avg': case 'average':
      return (values) => d3.mean(values, d => getRowValue(d, fieldName) || 0);
    case 'min':
      return (values) => d3.min(values, d => getRowValue(d, fieldName) || 0);
    case 'max':
      return (values) => d3.max(values, d => getRowValue(d, fieldName) || 0);
    case 'count':
      return (values) => values.length;
    case 'median':
      return (values) => d3.median(values, d => getRowValue(d, fieldName) || 0);
    case 'sum': default:
      return (values) => d3.sum(values, d => getRowValue(d, fieldName) || 0);
  }
};

const getFieldAggregation = (config, fieldName) => {
  if (!config || !fieldName) return null;
  if (config.fieldAggregations) {
    const agg = config.fieldAggregations[fieldName];
    if (agg) return agg;
    const upperField = fieldName.toUpperCase();
    const matchedKey = Object.keys(config.fieldAggregations).find(k => k.toUpperCase() === upperField);
    if (matchedKey) return config.fieldAggregations[matchedKey];
  }
  return null;
};

const processData = (data, config) => {
  if (!data || !Array.isArray(data)) return [];
  let processed = [...data];
  if (config.sorts) {
    const sortEntries = Object.entries(config.sorts);
    if (sortEntries.length > 0) {
      processed.sort((a, b) => {
        for (const [field, direction] of sortEntries) {
          const aVal = a[field], bVal = b[field];
          if (aVal === bVal) continue;
          const isAsc = direction?.toLowerCase() === 'asc';
          if (typeof aVal === 'number' && typeof bVal === 'number') return isAsc ? aVal - bVal : bVal - aVal;
          return isAsc ? String(aVal || '').localeCompare(String(bVal || '')) : String(bVal || '').localeCompare(String(aVal || ''));
        }
        return 0;
      });
    }
  }
  return processed;
};

const truncateLabel = (label, maxLen) => {
  const safe = toPrimitive(label);
  const str = safe == null ? '' : String(safe);
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
};

/**
 * Try to parse x-values as dates. Returns true if most values look like dates.
 * Rejects plain numbers and short numeric strings (years like "1997") — those
 * are better treated as ordinal categories with a linear or point scale.
 */
const detectDateAxis = (values) => {
  if (values.length === 0) return false;
  let dateCount = 0;
  for (const v of values.slice(0, 20)) {
    if (v instanceof Date) { dateCount++; continue; }
    if (typeof v === 'number') continue;
    const s = String(v).trim();
    // Skip bare year strings like "1997" or "2024" — treat as ordinal
    if (/^\d{4}$/.test(s)) continue;
    // Need at least a separator to qualify as a date string (e.g. 2024-01, Jan 2024)
    if (/^\d+$/.test(s)) continue;
    const d = new Date(s);
    if (!isNaN(d.getTime())) dateCount++;
  }
  return dateCount / Math.min(values.length, 20) > 0.6;
};

// ============================================================================
// FORMAT HELPERS
// ============================================================================

const createValueFormatter = (fieldFormats = {}) => (value, fieldName) => {
  if (value == null || isNaN(value)) return '';
  const fieldConfig = fieldFormats[fieldName] || {};
  const format = fieldConfig.format || 'auto';
  const decimals = fieldConfig.decimals;
  const getDecimals = (fallback) => decimals != null ? decimals : fallback;

  switch (format) {
    case 'number':
      return value.toLocaleString('en-US', { minimumFractionDigits: getDecimals(0), maximumFractionDigits: getDecimals(0) });
    case 'compact':
      return d3.format(`.${getDecimals(2)}s`)(value).replace('G', 'B');
    case 'currency':
      return '$' + value.toLocaleString('en-US', { minimumFractionDigits: getDecimals(0), maximumFractionDigits: getDecimals(0) });
    case 'percent':
      return (value * 100).toFixed(getDecimals(1)) + '%';
    default:
      if (Math.abs(value) >= 10000) return d3.format(`.${getDecimals(2)}s`)(value).replace('G', 'B');
      return value.toLocaleString('en-US', { minimumFractionDigits: getDecimals(2), maximumFractionDigits: getDecimals(2) });
  }
};

const createDisplayNameGetter = (columnAliases = {}) => (fieldName) => {
  if (!fieldName) return '';
  const aliasKey = Object.keys(columnAliases).find(k => k.toUpperCase() === fieldName.toUpperCase());
  return (aliasKey && columnAliases[aliasKey]) || fieldName;
};

// ============================================================================
// TOOLTIP
// ============================================================================

const createTooltip = () => {
  return d3.select(document.body)
    .append('div')
    .attr('class', 'chart-tooltip')
    .style('position', 'fixed')
    .style('visibility', 'hidden')
    .style('background', STYLES.tooltip.background)
    .style('border', STYLES.tooltip.border)
    .style('border-radius', STYLES.tooltip.borderRadius)
    .style('padding', STYLES.tooltip.padding)
    .style('font-size', STYLES.tooltip.fontSize)
    .style('color', STYLES.tooltip.color)
    .style('pointer-events', 'none')
    .style('z-index', '99999')
    .style('box-shadow', STYLES.tooltip.shadow)
    .style('backdrop-filter', 'blur(8px)')
    .style('-webkit-backdrop-filter', 'blur(8px)')
    .style('transition', 'opacity 0.15s ease, visibility 0.15s ease')
    .style('opacity', '0');
};

// ============================================================================
// LEGEND
// ============================================================================

const addLegend = (svg, colorScale, options) => {
  const { showLegend, legendPosition, width, height, margin, getDisplayName, onItemClick } = options;
  if (!showLegend) return;

  const legendItems = colorScale.domain();
  if (legendItems.length === 0) return;

  const isHorizontal = legendPosition === 'top' || legendPosition === 'bottom';
  const swatchSize = 10;
  const itemGap = isHorizontal ? 16 : 6;
  const itemHeight = 18;

  const legend = svg.append('g').attr('class', 'legend');

  const tempText = svg.append('text').style('font-size', '11px').style('visibility', 'hidden');
  const itemWidths = legendItems.map(item => {
    tempText.text(truncateLabel(item, 12));
    return tempText.node().getComputedTextLength() + swatchSize + 6;
  });
  tempText.remove();

  let legendX, legendY;
  switch (legendPosition) {
    case 'top': legendX = margin.left; legendY = 6; break;
    case 'bottom': legendX = margin.left; legendY = margin.top + height + margin.bottom - 20; break;
    case 'left': legendX = 8; legendY = margin.top; break;
    case 'right': default: legendX = margin.left + width + 10; legendY = margin.top;
  }
  legend.attr('transform', `translate(${legendX}, ${legendY})`);

  const totalLegendWidth = itemWidths.reduce((sum, w) => sum + w + itemGap, 0) - itemGap;
  let currentPage = 0;
  let pages = [legendItems];
  let needsPagination = false;

  if (isHorizontal && totalLegendWidth > width - 40) {
    needsPagination = true;
    pages = [];
    let page = [], pageWidth = 0;
    legendItems.forEach((item, i) => {
      const itemW = itemWidths[i] + itemGap;
      if (pageWidth + itemW > width - 40 && page.length > 0) {
        pages.push(page); page = [item]; pageWidth = itemW;
      } else { page.push(item); pageWidth += itemW; }
    });
    if (page.length > 0) pages.push(page);
  } else if (!isHorizontal && legendItems.length * itemHeight > height) {
    needsPagination = true;
    const maxItems = Math.max(1, Math.floor(height / itemHeight));
    pages = [];
    for (let i = 0; i < legendItems.length; i += maxItems) pages.push(legendItems.slice(i, i + maxItems));
  }

  const itemsGroup = legend.append('g').attr('class', 'legend-items');
  let prevNav, nextNav;

  const renderPage = () => {
    itemsGroup.selectAll('*').remove();
    const pageItems = pages[currentPage] || [];
    let pos = 0;

    pageItems.forEach((item, i) => {
      const itemGroup = itemsGroup.append('g')
        .attr('class', 'legend-item').style('cursor', 'pointer')
        .on('click', (event) => { event.stopPropagation(); onItemClick(item); })
        .on('mouseover', function() { d3.select(this).select('text').style('fill', '#fff'); })
        .on('mouseout', function() { d3.select(this).select('text').style('fill', '#b0b0b8'); });

      if (isHorizontal) {
        itemGroup.attr('transform', `translate(${pos}, 0)`);
        pos += itemWidths[legendItems.indexOf(item)] + itemGap;
      } else {
        itemGroup.attr('transform', `translate(0, ${i * itemHeight})`);
      }

      // Line swatch instead of square
      itemGroup.append('line')
        .attr('x1', 0).attr('y1', swatchSize / 2)
        .attr('x2', swatchSize).attr('y2', swatchSize / 2)
        .style('stroke', colorScale(item))
        .style('stroke-width', 2.5)
        .style('stroke-linecap', 'round');

      const maxLen = isHorizontal ? 50 : 9;
      itemGroup.append('text')
        .attr('x', swatchSize + 4).attr('y', swatchSize - 1)
        .style('font-size', '11px').style('fill', '#b0b0b8')
        .style('font-family', STYLES.label.fontFamily)
        .text(truncateLabel(getDisplayName(item), maxLen));
    });

    if (needsPagination && prevNav && nextNav) {
      prevNav.style('opacity', currentPage > 0 ? 1 : 0.3);
      nextNav.style('opacity', currentPage < pages.length - 1 ? 1 : 0.3);
    }
  };

  if (needsPagination && pages.length > 1) {
    prevNav = legend.append('g').attr('class', 'legend-nav-prev').style('cursor', 'pointer')
      .on('click', () => { if (currentPage > 0) { currentPage--; renderPage(); } });
    nextNav = legend.append('g').attr('class', 'legend-nav-next').style('cursor', 'pointer')
      .on('click', () => { if (currentPage < pages.length - 1) { currentPage++; renderPage(); } });

    if (isHorizontal) {
      prevNav.attr('transform', 'translate(-16, 0)').append('text').style('font-size', '12px').style('fill', '#888').text('\u25C2');
      const pageWidth = pages[0].reduce((sum, item) => sum + itemWidths[legendItems.indexOf(item)] + itemGap, 0);
      nextNav.attr('transform', `translate(${pageWidth + 4}, 0)`).append('text').style('font-size', '12px').style('fill', '#888').text('\u25B8');
    } else {
      prevNav.attr('transform', 'translate(30, -12)').append('text').attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#888').text('\u25B2');
      const pageHeight = pages[0].length * itemHeight;
      nextNav.attr('transform', `translate(30, ${pageHeight + 4})`).append('text').attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#888').text('\u25BC');
    }
  }

  renderPage();
};

// ============================================================================
// MAIN CHART FUNCTION
// ============================================================================

/**
 * @param {HTMLElement} container
 * @param {Object} config   - { x_axis, series, marks, sorts, fieldAggregations }
 * @param {Array}  data     - Array of row objects
 * @param {Object} options  - Rendering options
 * @param {boolean} options.showArea - If true, render as area chart
 */
export const createLineChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) {
    return { update: () => {}, destroy: () => {} };
  }

  const {
    showLegend = true,
    legendPosition = 'right',
    xAxisTitle = '',
    yAxisTitle = '',
    showGrid = true,
    showLabels = false,
    showDots = false,
    showArea = false,
    stacked = false,
    curveType = 'monotone',
    animate = true,
    fieldFormats = {},
    columnAliases = {},
    colors = DEFAULT_COLORS,
    sharedColorScale = null,
    margin: baseMargin = { top: 20, right: 20, bottom: 45, left: 50 },
  } = options;

  const formatValue = createValueFormatter(fieldFormats);
  const getDisplayName = createDisplayNameGetter(columnAliases);

  // Margins
  const legendWidth = 90;
  const legendHeight = 26;
  const isVerticalLegend = showLegend && (legendPosition === 'left' || legendPosition === 'right');
  const isHorizontalLegend = showLegend && (legendPosition === 'top' || legendPosition === 'bottom');

  const margin = {
    top: Math.max(5, baseMargin.top + (isHorizontalLegend && legendPosition === 'top' ? legendHeight : 0)),
    right: Math.max(5, baseMargin.right + (isVerticalLegend && legendPosition === 'right' ? legendWidth : 0)),
    bottom: Math.max(5, baseMargin.bottom + (xAxisTitle ? 20 : 0) + (isHorizontalLegend && legendPosition === 'bottom' ? legendHeight : 0)),
    left: Math.max(5, baseMargin.left + (isVerticalLegend && legendPosition === 'left' ? legendWidth : 0) + (yAxisTitle ? 20 : 0)),
  };

  const containerRect = container.getBoundingClientRect();
  const width = (options.width || containerRect.width || 400) - margin.left - margin.right;
  const height = (options.height || containerRect.height || 300) - margin.top - margin.bottom;

  const processedData = processData(data, config);
  const xField = config.x_axis;
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const tooltipFields = config.marks?.tooltip || [];
  const curve = CURVES[curveType] || CURVES.monotone;

  // ========================================
  // BUILD SERIES DATA
  // ========================================

  // Determine x values and whether the axis is temporal
  let rawXValues = getUniqueValues(processedData, xField);
  const isDate = detectDateAxis(rawXValues);

  // Sort x values — critical for lines to connect in order
  if (isDate) {
    rawXValues.sort((a, b) => new Date(a) - new Date(b));
  } else {
    // Numeric-aware sort: numbers first ascending, then strings alphabetically
    rawXValues.sort((a, b) => {
      const aNum = Number(a), bNum = Number(b);
      const aIsNum = !isNaN(aNum), bIsNum = !isNaN(bNum);
      if (aIsNum && bIsNum) return aNum - bNum;
      if (aIsNum) return -1;
      if (bIsNum) return 1;
      return String(a).localeCompare(String(b));
    });
  }

  const parseX = isDate ? (v) => new Date(v) : (v) => v;
  const xValues = rawXValues.map(parseX);

  // Build series array: [{ key, values: [{x, y}] }]
  let seriesData = [];

  if (colorField) {
    // Color-split: one line per unique color value
    const colorValues = getUniqueValues(processedData, colorField);
    const measureField = seriesFields[0];
    if (!measureField) return { update: () => {}, destroy: () => {} };

    const aggType = getFieldAggregation(config, measureField) || 'sum';
    const aggFn = getAggregationFunction(aggType, measureField);
    const grouped = d3.group(processedData, d => getRowValue(d, colorField));

    colorValues.forEach(colorVal => {
      const rows = grouped.get(colorVal) || [];
      const byX = d3.group(rows, d => String(getRowValue(d, xField)));

      const values = rawXValues.map(xRaw => {
        const xGroup = byX.get(String(xRaw)) || [];
        return { x: parseX(xRaw), y: xGroup.length > 0 ? (aggFn(xGroup) || 0) : 0 };
      });

      seriesData.push({ key: String(colorVal), values });
    });
  } else if (seriesFields.length > 0) {
    // Multiple measures: one line per measure
    const grouped = d3.group(processedData, d => String(getRowValue(d, xField)));

    seriesFields.forEach(field => {
      const aggType = getFieldAggregation(config, field) || 'sum';
      const aggFn = getAggregationFunction(aggType, field);

      const values = rawXValues.map(xRaw => {
        const xGroup = grouped.get(String(xRaw)) || [];
        return { x: parseX(xRaw), y: xGroup.length > 0 ? (aggFn(xGroup) || 0) : 0 };
      });

      seriesData.push({ key: field, values });
    });
  } else {
    return { update: () => {}, destroy: () => {} };
  }

  if (seriesData.length === 0) return { update: () => {}, destroy: () => {} };

  // ========================================
  // STACKED AREA
  // ========================================
  let stackedSeries = null;
  if (showArea && stacked && seriesData.length > 1) {
    const stackKeys = seriesData.map(s => s.key);
    const tableData = xValues.map((xVal, i) => {
      const obj = { _x: xVal };
      seriesData.forEach(s => { obj[s.key] = s.values[i]?.y || 0; });
      return obj;
    });

    stackedSeries = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetNone)(tableData);
  }

  // ========================================
  // SCALES
  // ========================================

  // For non-date axes, stringify domain values so lookups are consistent
  const xDomain = isDate ? null : rawXValues.map(String);
  const xScale = isDate
    ? d3.scaleTime().domain(d3.extent(xValues)).range([0, width])
    : d3.scalePoint().domain(xDomain).range([0, width]).padding(0.3);

  let yMax, yMin;
  if (stackedSeries) {
    yMax = d3.max(stackedSeries, layer => d3.max(layer, d => d[1])) || 0;
    yMin = 0;
  } else {
    yMax = d3.max(seriesData, s => d3.max(s.values, d => d.y)) || 0;
    yMin = d3.min(seriesData, s => d3.min(s.values, d => d.y)) || 0;
    if (yMin > 0) yMin = 0;
  }

  const yScale = d3.scaleLinear().domain([yMin, yMax * 1.1]).nice().range([height, 0]);
  const colorScale = sharedColorScale || d3.scaleOrdinal().domain(seriesData.map(s => s.key)).range(colors);

  // Focus state
  const focusState = {
    focused: null,
    updateFn: () => {
      g.selectAll('.line-path, .area-path, .dot-group')
        .transition().duration(200)
        .style('opacity', function() {
          if (!focusState.focused) return 1;
          const series = d3.select(this).attr('data-series');
          return series === focusState.focused ? 1 : STYLES.line.dimmedOpacity;
        });
    }
  };

  // ========================================
  // RENDER
  // ========================================

  d3.select(container).selectAll('*').remove();

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .style('overflow', 'visible');

  const clipId = `clip-${Math.random().toString(36).substr(2, 9)}`;
  svg.append('defs').append('clipPath').attr('id', clipId)
    .append('rect').attr('width', width).attr('height', height);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const chartArea = g.append('g').attr('clip-path', `url(#${clipId})`);
  const gridGroup = g.append('g').attr('class', 'grid-group');

  // Mutable zoomed scales — updated by zoom handler, read by hover handler
  let currentXScale = xScale.copy();
  let currentYScale = yScale.copy();

  const renderGrid = (ys) => {
    gridGroup.selectAll('*').remove();
    if (!showGrid) return;
    gridGroup.selectAll('.grid-line').data(ys.ticks(5)).enter().append('line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', d => ys(d)).attr('y2', d => ys(d))
      .style('stroke', STYLES.grid.lineColor).style('stroke-dasharray', STYLES.grid.dashArray);
  };
  renderGrid(yScale);

  const tooltip = createTooltip();

  const lineSource = stackedSeries
    ? stackedSeries.map(layer => ({
        key: layer.key,
        values: layer.map((d, i) => ({ x: xValues[i], y: d[1] })),
      }))
    : seriesData;

  // Helper: build line generator for given scales
  const makeLineGen = (xs, ys) => d3.line()
    .x(d => isDate ? xs(d.x) : xs(String(d.x)))
    .y(d => ys(d.y))
    .curve(curve);

  // Helper: build area generator for given scales
  const makeAreaGen = (xs, ys) => {
    if (stackedSeries) {
      return d3.area()
        .x((d, i) => isDate ? xs(d.data._x) : xs(String(rawXValues[i])))
        .y0(d => ys(d[0])).y1(d => ys(d[1])).curve(curve);
    }
    return d3.area()
      .x(d => isDate ? xs(d.x) : xs(String(d.x)))
      .y0(ys(yMin)).y1(d => ys(d.y)).curve(curve);
  };

  // ========================================
  // DRAW AREAS
  // ========================================

  if (showArea) {
    if (stackedSeries) {
      const areaGen = makeAreaGen(xScale, yScale);
      chartArea.selectAll('.area-path')
        .data(stackedSeries).enter().append('path')
        .attr('class', 'area-path').attr('data-series', d => d.key)
        .attr('d', areaGen)
        .attr('fill', d => colorScale(d.key))
        .attr('fill-opacity', STYLES.area.stackedFillOpacity)
        .style('cursor', 'pointer')
        .on('click', function(event, d) { event.stopPropagation(); focusState.focused = focusState.focused === d.key ? null : d.key; focusState.updateFn(); });
    } else {
      const areaGen = makeAreaGen(xScale, yScale);
      const defs = svg.select('defs');
      seriesData.forEach((s, i) => {
        const gradId = `area-grad-${clipId}-${i}`;
        const grad = defs.append('linearGradient').attr('id', gradId)
          .attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%');
        grad.append('stop').attr('offset', '0%').attr('stop-color', colorScale(s.key)).attr('stop-opacity', 0.3);
        grad.append('stop').attr('offset', '100%').attr('stop-color', colorScale(s.key)).attr('stop-opacity', 0.02);
        chartArea.append('path').datum(s.values)
          .attr('class', 'area-path').attr('data-series', s.key)
          .attr('d', areaGen).attr('fill', `url(#${gradId})`);
      });
    }
  }

  // ========================================
  // DRAW LINES
  // ========================================

  const lineGen = makeLineGen(xScale, yScale);

  const linePaths = chartArea.selectAll('.line-path')
    .data(lineSource).enter().append('path')
    .attr('class', 'line-path').attr('data-series', d => d.key)
    .attr('d', d => lineGen(d.values))
    .attr('fill', 'none').attr('stroke', d => colorScale(d.key))
    .attr('stroke-width', STYLES.line.strokeWidth)
    .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
    .style('cursor', 'pointer')
    .on('click', function(event, d) { event.stopPropagation(); focusState.focused = focusState.focused === d.key ? null : d.key; focusState.updateFn(); });

  if (animate) {
    linePaths.each(function() {
      const pathLength = this.getTotalLength();
      d3.select(this)
        .attr('stroke-dasharray', pathLength).attr('stroke-dashoffset', pathLength)
        .transition().duration(800).ease(d3.easeQuadOut).attr('stroke-dashoffset', 0)
        .on('end', function() { d3.select(this).attr('stroke-dasharray', null); });
    });
  }

  // ========================================
  // DATA DOTS
  // ========================================

  if (showDots) {
    lineSource.forEach(series => {
      chartArea.append('g').attr('class', 'dot-group').attr('data-series', series.key)
        .selectAll('.dot').data(series.values).enter().append('circle').attr('class', 'dot')
        .attr('cx', d => isDate ? xScale(d.x) : xScale(String(d.x)))
        .attr('cy', d => yScale(d.y)).attr('r', STYLES.line.dotRadius)
        .attr('fill', colorScale(series.key)).attr('stroke', STYLES.tooltip.background).attr('stroke-width', 1.5);
    });
  }

  // ========================================
  // HOVER CROSSHAIR + INTERACTIVE DOTS
  // ========================================

  const crosshairLine = chartArea.append('line').attr('class', 'crosshair')
    .attr('y1', 0).attr('y2', height)
    .style('stroke', 'rgba(160, 160, 176, 0.4)').style('stroke-width', 1)
    .style('stroke-dasharray', '4,3').style('visibility', 'hidden');

  const hoverDotsGroup = chartArea.append('g').attr('class', 'hover-dots');

  // Find the closest X index for a given mouse X position
  const findClosestX = (mx) => {
    const xs = currentXScale;
    let closestIdx;
    if (isDate) {
      const hoveredDate = xs.invert(mx);
      const bisect = d3.bisector(d => d).left;
      const idx = bisect(xValues, hoveredDate, 1);
      const d0 = xValues[idx - 1], d1 = xValues[idx];
      closestIdx = (!d1 || (hoveredDate - d0) < (d1 - hoveredDate)) ? idx - 1 : idx;
      closestIdx = Math.max(0, Math.min(closestIdx, xValues.length - 1));
    } else {
      const domain = xs.domain();
      const positions = domain.map(d => xs(d));
      let minDist = Infinity; closestIdx = 0;
      positions.forEach((pos, i) => { const dist = Math.abs(pos - mx); if (dist < minDist) { minDist = dist; closestIdx = i; } });
    }
    return closestIdx;
  };

  const handleHover = (event) => {
    const [mx] = d3.pointer(event);
    const xs = currentXScale;
    const ys = currentYScale;
    const closestIdx = findClosestX(mx);
    const closestXVal = isDate ? xValues[closestIdx] : xs.domain()[closestIdx];
    const xPos = xs(isDate ? closestXVal : closestXVal);

    crosshairLine.attr('x1', xPos).attr('x2', xPos).style('visibility', 'visible');
    hoverDotsGroup.selectAll('*').remove();

    let tooltipHtml = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">`;
    tooltipHtml += (isDate && closestXVal instanceof Date) ? d3.timeFormat('%b %d, %Y')(closestXVal) : closestXVal;
    tooltipHtml += '</div>';

    lineSource.forEach(series => {
      const pt = series.values[closestIdx];
      if (!pt) return;
      const isFocused = !focusState.focused || focusState.focused === series.key;

      hoverDotsGroup.append('circle')
        .attr('cx', xPos).attr('cy', ys(pt.y))
        .attr('r', isFocused ? STYLES.line.activeDotRadius : 2.5)
        .attr('fill', colorScale(series.key))
        .attr('stroke', isFocused ? '#fff' : 'none')
        .attr('stroke-width', isFocused ? 2 : 0)
        .style('opacity', isFocused ? 1 : 0.3);

      if (isFocused) {
        tooltipHtml += `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;">`;
        tooltipHtml += `<span style="width:8px;height:8px;border-radius:50%;background:${colorScale(series.key)};flex-shrink:0;"></span>`;
        tooltipHtml += `<span style="color:#a0a0b0;">${getDisplayName(series.key)}:</span>`;
        tooltipHtml += `<span style="font-weight:600;margin-left:auto;">${formatValue(pt.y, series.key)}</span></div>`;
      }
    });

    if (tooltipFields.length > 0) {
      const matchRow = processedData.find(d => String(getRowValue(d, xField)) === String(rawXValues[closestIdx]));
      if (matchRow) {
        tooltipFields.forEach(field => {
          const val = getRowValue(matchRow, field);
          if (val != null) {
            tooltipHtml += `<div style="display:flex;gap:8px;margin:2px 0;color:#888;">`;
            tooltipHtml += `<span>${getDisplayName(field)}:</span>`;
            tooltipHtml += `<span style="margin-left:auto;">${typeof val === 'number' ? formatValue(val, field) : val}</span></div>`;
          }
        });
      }
    }

    tooltip.html(tooltipHtml).style('visibility', 'visible').style('opacity', '1')
      .style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
  };

  const handleHoverLeave = () => {
    crosshairLine.style('visibility', 'hidden');
    hoverDotsGroup.selectAll('*').remove();
    tooltip.style('visibility', 'hidden').style('opacity', '0');
  };

  const handleClick = (event) => {
    event.stopPropagation();
    const [mx, my] = d3.pointer(event);
    const xs = currentXScale;
    const ys = currentYScale;
    const closestIdx = findClosestX(mx);

    // Find the series whose data point is closest to the click position
    let bestSeries = null, bestDist = Infinity;
    lineSource.forEach(series => {
      const pt = series.values[closestIdx];
      if (!pt) return;
      const xPos = isDate ? xs(pt.x) : xs(String(pt.x));
      const yPos = ys(pt.y);
      const dist = Math.sqrt((mx - xPos) ** 2 + (my - yPos) ** 2);
      if (dist < bestDist) { bestDist = dist; bestSeries = series.key; }
    });

    if (bestSeries && bestDist < 50) {
      focusState.focused = focusState.focused === bestSeries ? null : bestSeries;
    } else {
      focusState.focused = null;
    }
    focusState.updateFn();
    handleHover(event);
  };

  chartArea.append('rect').attr('class', 'overlay')
    .attr('width', width).attr('height', height)
    .style('fill', 'none').style('pointer-events', 'all')
    .on('mousemove', handleHover).on('mouseleave', handleHoverLeave)
    .on('click', handleClick);

  // ========================================
  // AXES
  // ========================================

  const xAxisGroup = g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`);
  const yAxisGroup = g.append('g').attr('class', 'y-axis');

  const renderXAxis = (xs) => {
    if (isDate) {
      xAxisGroup.call(d3.axisBottom(xs).ticks(Math.min(width / 80, 10)));
    } else {
      const tickCount = rawXValues.length;
      const maxLabels = Math.floor(width / 40);
      const showEveryNth = Math.ceil(tickCount / maxLabels);
      xAxisGroup.call(d3.axisBottom(xs))
        .selectAll('text')
        .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0)
        .attr('transform', tickCount > 12 ? 'rotate(-45)' : null)
        .style('text-anchor', tickCount > 12 ? 'end' : 'middle')
        .text(d => truncateLabel(d, 14));
    }
    xAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
    xAxisGroup.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor);
  };

  const renderYAxis = (ys) => {
    yAxisGroup.call(d3.axisLeft(ys).ticks(5).tickFormat(d3.format('.2s')))
      .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
    yAxisGroup.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor);
  };

  renderXAxis(xScale);
  renderYAxis(yScale);
  g.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor);

  // Axis titles
  g.selectAll('.axis-title').remove();
  if (xAxisTitle) {
    g.append('text').attr('class', 'axis-title')
      .attr('x', width / 2).attr('y', height + 38).attr('text-anchor', 'middle')
      .style('font-size', '12px').style('font-weight', '500')
      .style('fill', STYLES.axis.textColor).style('font-family', STYLES.label.fontFamily).text(xAxisTitle);
  }
  if (yAxisTitle) {
    g.append('text').attr('class', 'axis-title').attr('transform', 'rotate(-90)')
      .attr('x', -height / 2).attr('y', -40).attr('text-anchor', 'middle')
      .style('font-size', '12px').style('font-weight', '500')
      .style('fill', STYLES.axis.textColor).style('font-family', STYLES.label.fontFamily).text(yAxisTitle);
  }

  // ========================================
  // LABELS (values at line end)
  // ========================================

  if (showLabels && !stackedSeries) {
    lineSource.forEach(series => {
      const last = series.values[series.values.length - 1];
      if (!last) return;
      chartArea.append('text').attr('class', 'line-label')
        .attr('x', (isDate ? xScale(last.x) : xScale(String(last.x))) + 6)
        .attr('y', yScale(last.y)).attr('dominant-baseline', 'central')
        .style('font-size', '10px').style('fill', colorScale(series.key))
        .style('font-weight', '600').style('pointer-events', 'none')
        .text(formatValue(last.y, series.key));
    });
  }

  // ========================================
  // ZOOM & PAN
  // ========================================

  const redrawWithScales = (xs, ys) => {
    const lg = makeLineGen(xs, ys);
    chartArea.selectAll('.line-path').attr('d', d => lg(d.values));

    if (showArea) {
      const ag = makeAreaGen(xs, ys);
      if (stackedSeries) {
        chartArea.selectAll('.area-path').attr('d', ag);
      } else {
        chartArea.selectAll('.area-path').each(function(d) { d3.select(this).attr('d', ag(d)); });
      }
    }

    if (showDots) {
      chartArea.selectAll('.dot')
        .attr('cx', d => isDate ? xs(d.x) : xs(String(d.x)))
        .attr('cy', d => ys(d.y));
    }

    if (showLabels && !stackedSeries) {
      chartArea.selectAll('.line-label').each(function(_, i) {
        const series = lineSource[i];
        if (!series) return;
        const last = series.values[series.values.length - 1];
        if (!last) return;
        d3.select(this)
          .attr('x', (isDate ? xs(last.x) : xs(String(last.x))) + 6)
          .attr('y', ys(last.y));
      });
    }
  };

  const zoomBehavior = d3.zoom()
    .scaleExtent([1, 20])
    .translateExtent([[0, 0], [width, height]])
    .extent([[0, 0], [width, height]])
    .on('zoom', (event) => {
      const t = event.transform;

      currentXScale = isDate ? t.rescaleX(xScale) : xScale.copy().range([t.applyX(0), t.applyX(width)]);
      currentYScale = t.rescaleY(yScale);

      redrawWithScales(currentXScale, currentYScale);
      renderXAxis(currentXScale);
      renderYAxis(currentYScale);
      renderGrid(currentYScale);

      const labelOp = t.k > 2 ? Math.max(0, 1 - (t.k - 2) / 3) : 1;
      chartArea.selectAll('.line-label').style('opacity', labelOp);
    });

  svg.call(zoomBehavior);
  svg.on('dblclick.zoom', () => {
    svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity);
  });

  // ========================================
  // LEGEND
  // ========================================

  if (seriesData.length > 1 || colorField) {
    addLegend(svg, colorScale, {
      showLegend, legendPosition, width, height, margin, getDisplayName,
      onItemClick: (item) => {
        focusState.focused = focusState.focused === item ? null : item;
        focusState.updateFn();
      }
    });
  }

  svg.on('click', () => {
    if (focusState.focused) {
      focusState.focused = null;
      focusState.updateFn();
    }
  });

  return {
    update: (newConfig, newData) => createLineChart(container, newConfig || config, newData || data, options),
    destroy: () => { tooltip.remove(); d3.select(container).selectAll('*').remove(); },
    getFocusedSeries: () => focusState.focused,
    setFocusedSeries: (name) => { focusState.focused = name; focusState.updateFn(); },
    resetZoom: () => svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity),
  };
};

// ============================================================================
// TRELLIS
// ============================================================================

export const createTrellisLineChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) {
    return { update: () => {}, destroy: () => {} };
  }

  const trellisField = config.marks?.detail;
  if (!trellisField) return createLineChart(container, config, data, options);

  const trellisValues = getUniqueValues(data, trellisField);
  const onTrellisFocus = options.onTrellisFocus;
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const defaultColors = options.colors || DEFAULT_COLORS;

  let sharedColorDomain = [];
  if (colorField) {
    sharedColorDomain = [...new Set(data.map(d => d[colorField]))].filter(v => v != null);
  } else if (seriesFields.length > 0) {
    sharedColorDomain = seriesFields;
  }
  const sharedColorScale = d3.scaleOrdinal().domain(sharedColorDomain).range(defaultColors);

  d3.select(container).selectAll('*').remove();

  const wrapper = d3.select(container)
    .append('div')
    .style('display', 'grid')
    .style('grid-template-columns', 'repeat(auto-fit, minmax(250px, 1fr))')
    .style('gap', '16px')
    .style('width', '100%').style('height', '100%')
    .style('overflow', 'auto').style('padding', '8px');

  const charts = [];

  trellisValues.forEach(trellisVal => {
    const trellisData = data.filter(d => d[trellisField] === trellisVal);

    const chartContainer = wrapper.append('div')
      .style('padding', '8px').style('min-height', '200px')
      .style('background', 'rgba(255, 255, 255, 0.02)')
      .style('border-radius', '8px')
      .style('border', '1px solid rgba(255, 255, 255, 0.06)');

    const titleRow = chartContainer.append('div')
      .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center')
      .style('gap', '6px').style('margin-bottom', '8px')
      .style('padding', '4px 8px').style('border-radius', '4px')
      .style('cursor', onTrellisFocus ? 'pointer' : 'default')
      .style('transition', 'background 0.15s ease');

    if (onTrellisFocus) {
      titleRow
        .on('mouseenter', function() { d3.select(this).style('background', 'rgba(59, 130, 246, 0.1)'); })
        .on('mouseleave', function() { d3.select(this).style('background', 'transparent'); })
        .on('click', () => onTrellisFocus(trellisVal));
    }

    titleRow.append('span')
      .style('font-weight', '600').style('font-size', '12px').style('color', '#e0e0e0')
      .text(trellisVal);

    const chartArea = chartContainer.append('div')
      .style('width', '100%').style('height', 'calc(100% - 30px)');

    const trellisConfig = { ...config, marks: { ...config.marks, detail: undefined } };

    const chart = createLineChart(chartArea.node(), trellisConfig, trellisData, {
      ...options,
      width: 250, height: 180,
      margin: { top: 15, right: 15, bottom: 35, left: 45 },
      showLegend: false,
      sharedColorScale,
    });

    charts.push(chart);
  });

  return {
    update: (newConfig, newData) => createTrellisLineChart(container, newConfig || config, newData || data, options),
    destroy: () => { charts.forEach(c => c.destroy()); d3.select(container).selectAll('*').remove(); },
  };
};
