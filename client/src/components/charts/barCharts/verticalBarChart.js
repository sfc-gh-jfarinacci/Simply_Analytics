/**
 * D3.js Vertical Bar Chart
 * 
 * Supports:
 * - Simple bar chart
 * - Grouped/Clustered bar chart
 * - Stacked bar chart
 * - Grouped + Stacked bar chart
 * - Trellis (small multiples) on any option
 * 
 * Features:
 * - Interactive zoom and pan
 * - Click focus on series
 * - Custom tooltip
 * - Configurable legends
 * - Label angle control
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
  bar: {
    borderRadius: 2,
    hoverOpacity: 0.8,
    dimmedOpacity: 0.2,
  },
  label: {
    color: '#a0a0b0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get a value from a row with case-insensitive key matching
 */
const getRowValue = (row, key) => {
  if (!row || key == null) return undefined;
  const keyStr = typeof key === 'string' ? key : String(key);
  
  // Direct match
  if (row[keyStr] !== undefined) return row[keyStr];
  
  // Case-insensitive match
  const keyUpper = keyStr.toUpperCase();
  const matchedKey = Object.keys(row).find(k => k.toUpperCase() === keyUpper);
  if (matchedKey) return row[matchedKey];
  
  // Normalized match (without underscores)
  const keyNormalized = keyUpper.replace(/_/g, '');
  const matchedNorm = Object.keys(row).find(k => k.toUpperCase().replace(/_/g, '') === keyNormalized);
  return matchedNorm ? row[matchedNorm] : undefined;
};

/**
 * Extract a displayable primitive from a value that might be an object.
 */
const toPrimitive = (v) => {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Date) return v;
  if (v.name != null) return v.name;
  if (v.value != null) return v.value;
  if (v.label != null) return v.label;
  const vals = Object.values(v).filter(x => x != null && typeof x !== 'object');
  return vals.length > 0 ? vals[0] : String(v);
};

/**
 * Get unique values for a field.
 * Coerces non-primitive values so labels never render as [object Object].
 */
const getUniqueValues = (data, field) => {
  if (!field) return [];
  const values = data.map(d => toPrimitive(getRowValue(d, field))).filter(v => v != null);
  return [...new Set(values)];
};

/**
 * Get the D3 aggregation function based on aggregation type
 * @param {string} aggregationType - The aggregation type (sum, avg, min, max, count, etc.)
 * @param {string} fieldName - The field name to aggregate
 * @returns {Function} A function that takes an array of data and returns the aggregated value
 */
const getAggregationFunction = (aggregationType, fieldName) => {
  const type = (aggregationType || 'sum').toLowerCase();
  
  switch (type) {
    case 'avg':
    case 'average':
      return (values) => d3.mean(values, d => getRowValue(d, fieldName) || 0);
    case 'min':
      return (values) => d3.min(values, d => getRowValue(d, fieldName) || 0);
    case 'max':
      return (values) => d3.max(values, d => getRowValue(d, fieldName) || 0);
    case 'count':
      return (values) => values.length;
    case 'median':
      return (values) => d3.median(values, d => getRowValue(d, fieldName) || 0);
    case 'sum':
    default:
      return (values) => d3.sum(values, d => getRowValue(d, fieldName) || 0);
  }
};

/**
 * Get aggregation type for a field from config
 * @param {Object} config - Chart config
 * @param {string} fieldName - Field name to look up
 * @returns {string|null} The aggregation type or null if not specified
 */
const getFieldAggregation = (config, fieldName) => {
  if (!config || !fieldName) return null;
  
  // Check fieldAggregations map
  if (config.fieldAggregations) {
    const agg = config.fieldAggregations[fieldName];
    if (agg) return agg;
    
    // Case-insensitive lookup
    const upperField = fieldName.toUpperCase();
    const matchedKey = Object.keys(config.fieldAggregations).find(
      k => k.toUpperCase() === upperField
    );
    if (matchedKey) return config.fieldAggregations[matchedKey];
  }
  
  return null;
};

/**
 * Process and sort data based on config
 */
const processData = (data, config) => {
  if (!data || !Array.isArray(data)) return [];
  let processed = [...data];
  
  if (config.sorts) {
    const sortEntries = Object.entries(config.sorts);
    if (sortEntries.length > 0) {
      processed.sort((a, b) => {
        for (const [field, direction] of sortEntries) {
          const aVal = a[field];
          const bVal = b[field];
          if (aVal === bVal) continue;
          
          const isAsc = direction?.toLowerCase() === 'asc';
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return isAsc ? aVal - bVal : bVal - aVal;
          }
          const strA = String(aVal || '');
          const strB = String(bVal || '');
          return isAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
        }
        return 0;
      });
    }
  }
  return processed;
};

/**
 * Determine chart mode from config
 */
const getChartMode = (config) => {
  const hasColorMark = !!config.marks?.color;
  const hasClusterMark = !!config.marks?.cluster || !!config.clusterField;
  const detailValue = config.marks?.detail;
  const hasDetailMark = Array.isArray(detailValue) ? detailValue.length > 0 : !!detailValue;
  const hasMultipleSeries = (config.series?.length || 0) > 1;
  
  if (hasDetailMark) {
    if (hasColorMark && hasClusterMark) return 'trellis-clustered-stacked';
    if (hasColorMark) return 'trellis-stacked';
    if (hasClusterMark) return 'trellis-clustered';
    return 'trellis';
  }
  
  if (hasColorMark && hasClusterMark) return 'clustered-stacked';
  if (hasColorMark) return 'stacked';
  if (hasClusterMark || hasMultipleSeries) return 'clustered';
  return 'simple';
};

// ============================================================================
// LABEL HELPERS
// ============================================================================

/**
 * Get text anchor based on label angle.
 * Negative angles rotate the text's start to the bottom, so anchor at 'start'.
 * Positive angles rotate the text's end to the bottom, so anchor at 'end'.
 * This keeps the bottom-most point of the rotated text at the anchor position
 * and prevents the label from overlapping the bar.
 */
const getTextAnchor = (angle) => {
  if (angle < 0) return 'end';
  if (angle > 0) return 'start';
  return 'middle';
};

/**
 * Get dominant-baseline for label angle.
 * At ±90° the text's cross-axis is purely horizontal, so 'central' is needed
 * to keep the label visually centered over the bar.
 */
const getDominantBaseline = (angle) => {
  if (Math.abs(angle) === 90) return 'central';
  return 'auto';
};

/**
 * Get label Y offset — constant so the closest point to the bar is always
 * at the same distance regardless of rotation angle.
 */
const getLabelYOffset = () => 5;

/**
 * Get dynamic font size based on bar width
 */
const getLabelFontSize = (barWidth) => {
  if (barWidth < 20) return '7px';
  if (barWidth < 30) return '8px';
  if (barWidth < 50) return '9px';
  return '10px';
};

/**
 * Truncate label to max length.
 * Safely coerces any value to a displayable string first.
 */
const truncateLabel = (label, maxLen) => {
  const safe = toPrimitive(label);
  const str = safe == null ? '' : String(safe);
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '...' : str;
};

// ============================================================================
// FORMAT HELPERS
// ============================================================================

/**
 * Create a value formatter based on field settings
 */
const createValueFormatter = (fieldFormats = {}) => (value, fieldName) => {
  if (value == null || isNaN(value)) return '';
  
  const fieldConfig = fieldFormats[fieldName] || {};
  const format = fieldConfig.format || 'auto';
  const decimals = fieldConfig.decimals;
  const getDecimals = (fallback) => decimals != null ? decimals : fallback;
  
  switch (format) {
    case 'number':
      return value.toLocaleString('en-US', { 
        minimumFractionDigits: getDecimals(0),
        maximumFractionDigits: getDecimals(0) 
      });
    case 'compact':
      return d3.format(`.${getDecimals(2)}s`)(value).replace('G', 'B');
    case 'currency':
      return '$' + value.toLocaleString('en-US', { 
        minimumFractionDigits: getDecimals(0),
        maximumFractionDigits: getDecimals(0) 
      });
    case 'percent':
      return (value * 100).toFixed(getDecimals(1)) + '%';
    default:
      if (Math.abs(value) >= 10000) {
        return d3.format(`.${getDecimals(2)}s`)(value).replace('G', 'B');
      }
      return value.toLocaleString('en-US', { 
        minimumFractionDigits: getDecimals(2),
        maximumFractionDigits: getDecimals(2) 
      });
  }
};

/**
 * Create display name getter (with alias support)
 */
const createDisplayNameGetter = (columnAliases = {}) => (fieldName) => {
  if (!fieldName) return '';
  const aliasKey = Object.keys(columnAliases).find(k => k.toUpperCase() === fieldName.toUpperCase());
  return (aliasKey && columnAliases[aliasKey]) || fieldName;
};

/**
 * Create text color getter from field formats
 */
const createTextColorGetter = (fieldFormats = {}) => (fieldName) => {
  if (!fieldName) return null;
  const color = fieldFormats[fieldName]?.textColor;
  return (!color || color === 'default') ? null : color;
};

// ============================================================================
// TOOLTIP HELPER
// ============================================================================

/**
 * Create tooltip element — appended to document.body with position:fixed
 * so it floats above all containers regardless of overflow clipping.
 */
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

/**
 * Create tooltip content formatter
 */
const createTooltipFormatter = (xField, tooltipFields, formatValue, getDisplayName) => 
  (d, seriesName, value) => {
    let html = `<div style="font-weight: 600; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">`;
    html += `${d[xField]}</div>`;
    
    const formattedValue = typeof value === 'number' ? formatValue(value, seriesName) : value;
    html += `<div style="display: flex; align-items: center; gap: 8px; margin: 4px 0;">`;
    html += `<span style="color: #a0a0b0;">${getDisplayName(seriesName)}:</span>`;
    html += `<span style="font-weight: 600; margin-left: auto;">${formattedValue}</span></div>`;
    
    tooltipFields.forEach(field => {
      const val = d[field];
      if (val != null) {
        const formatted = typeof val === 'number' ? formatValue(val, field) : val;
        html += `<div style="display: flex; align-items: center; gap: 8px; margin: 2px 0; color: #888;">`;
        html += `<span>${getDisplayName(field)}:</span>`;
        html += `<span style="margin-left: auto;">${formatted}</span></div>`;
      }
    });
    
    return html;
  };

// ============================================================================
// BAR EVENT HANDLERS
// ============================================================================

/**
 * Create bar event handlers
 */
const createBarHandlers = (tooltip, formatTooltip, xField, clusterField, focusState) => ({
  onMouseOver: function(event, d) {
    d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
    const tooltipData = d._data || { [xField]: d._xVal, [clusterField]: d._clusterValue };
    tooltip.html(formatTooltip(tooltipData, d.key, d.value))
      .style('visibility', 'visible').style('opacity', '1');
  },
  
  onMouseMove: function(event) {
    tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
  },
  
  onMouseOut: function() {
    const opacity = focusState.focused && this.__data__._seriesName !== focusState.focused 
      ? STYLES.bar.dimmedOpacity : 1;
    d3.select(this).attr('opacity', opacity);
    tooltip.style('visibility', 'hidden').style('opacity', '0');
  },
  
  onClick: function(event, d) {
    event.stopPropagation();
    focusState.focused = focusState.focused === d.key ? null : d.key;
    focusState.updateFn();
  }
});

/**
 * Apply event handlers to bars
 */
const applyBarHandlers = (bars, handlers) => {
  bars
    .on('mouseover', handlers.onMouseOver)
    .on('mousemove', handlers.onMouseMove)
    .on('mouseout', handlers.onMouseOut)
    .on('click', handlers.onClick);
};

// ============================================================================
// AXIS RENDERING
// ============================================================================

/**
 * Render X axis with smart label handling
 */
const renderXAxis = (axisGroup, scale, options = {}) => {
  const { categoryWidth = 50, showEveryNth = 1, rotate = true, maxLabelLen = 20 } = options;
  const fontSize = categoryWidth < 30 ? STYLES.axis.smallFontSize : STYLES.axis.fontSize;
  
  axisGroup.call(d3.axisBottom(scale))
    .selectAll('text')
    .style('fill', STYLES.axis.textColor)
    .style('font-size', fontSize)
    .attr('transform', rotate ? 'rotate(-45)' : null)
    .style('text-anchor', rotate ? 'end' : 'middle')
    .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0)
    .text(d => truncateLabel(d, maxLabelLen));
};

/**
 * Render Y axis
 */
const renderYAxis = (axisGroup, scale) => {
  axisGroup.call(d3.axisLeft(scale).ticks(5).tickFormat(d3.format('.2s')))
    .selectAll('text')
    .style('fill', STYLES.axis.textColor)
    .style('font-size', STYLES.axis.fontSize);
};

/**
 * Style axis lines
 */
const styleAxisLines = (g) => {
  g.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor);
};

/**
 * Render dual-level axis for clustered charts
 * Reference style: Category labels ABOVE the chart (horizontal), cluster labels BELOW (angled under each bar)
 * 
 * @param {Object} topLabelGroup - Group for top labels (above chart, passed separately)
 * @param {Object} axisGroup - Group for bottom axis (cluster labels)
 */
const renderClusteredXAxis = (axisGroup, x0, x1, groupKeys, options = {}) => {
  const { categoryWidth, showEveryNth = 1, showClusterLabels = true, topLabelGroup, height, labelFormatter } = options;
  
  axisGroup.selectAll('*').remove();
  
  // Category groups for bottom axis
  const categoryTicks = axisGroup.selectAll('.category-tick')
    .data(x0.domain())
    .enter()
    .append('g')
    .attr('class', 'category-tick')
    .attr('transform', d => `translate(${x0(d) + x0.bandwidth() / 2}, 0)`);
  
  // LEVEL 1: Category labels ABOVE the chart (horizontal, prominent) - like "Arizona", "California"
  // These go in a separate group positioned above the chart area
  if (topLabelGroup) {
    topLabelGroup.selectAll('.top-category-label').remove();
    
    const categoryFontSize = categoryWidth < 50 ? '10px' : '11px';
    const categoryMaxLen = categoryWidth < 50 ? 10 : 20;
    
    topLabelGroup.selectAll('.top-category-label')
      .data(x0.domain())
      .enter()
      .append('text')
      .attr('class', 'top-category-label')
      .attr('x', d => x0(d) + x0.bandwidth() / 2)
      .attr('y', -8) // Position above the chart
      .attr('text-anchor', 'middle')
      .style('fill', STYLES.axis.textColor)
      .style('font-size', categoryFontSize)
      .style('font-weight', '600')
      .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0)
      .text(d => truncateLabel(d, categoryMaxLen));
  }
  
  // LEVEL 2: Cluster labels at BOTTOM (angled, under each bar) - like "Furniture", "Office Supplies"
  if (showClusterLabels) {
    const clusterBarWidth = x1.bandwidth();
    const clusterFontSize = clusterBarWidth < 15 ? '8px' : clusterBarWidth < 25 ? '9px' : '10px';
    const maxLabelLength = clusterBarWidth < 15 ? 10 : clusterBarWidth < 25 ? 14 : 20;
    
    categoryTicks.selectAll('.cluster-label')
      .data(d => groupKeys.map(k => ({ category: d, cluster: k })))
      .enter()
      .append('text')
      .attr('class', 'cluster-label')
      .attr('x', d => x1(d.cluster) - x0.bandwidth() / 2 + x1.bandwidth() / 2)
      .attr('y', 12)
      .attr('text-anchor', 'end')
      .attr('transform', d => {
        const labelX = x1(d.cluster) - x0.bandwidth() / 2 + x1.bandwidth() / 2;
        return `rotate(-45, ${labelX}, 12)`;
      })
      .style('fill', '#9ca3af')
      .style('font-size', clusterFontSize)
      .style('font-weight', '500')
      .text(d => truncateLabel(labelFormatter ? labelFormatter(d.cluster) : d.cluster, maxLabelLength));
  }
  
  // Separator lines between category groups (at bottom)
  if (categoryWidth > 30) {
    categoryTicks.append('line')
      .attr('x1', -x0.bandwidth() / 2)
      .attr('x2', -x0.bandwidth() / 2)
      .attr('y1', 0)
      .attr('y2', showClusterLabels ? 55 : 15)
      .style('stroke', 'rgba(100, 100, 120, 0.15)')
      .style('stroke-width', 1)
      .style('opacity', (d, i) => i === 0 ? 0 : 1);
  }
};

// ============================================================================
// GRID RENDERING
// ============================================================================

/**
 * Render horizontal grid lines
 */
const renderGrid = (gridGroup, yScale, width, showGrid) => {
  gridGroup.selectAll('*').remove();
  if (!showGrid || !yScale) return;
  
  gridGroup.selectAll('.grid-line')
    .data(yScale.ticks(5))
    .enter()
    .append('line')
    .attr('class', 'grid-line')
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', d => yScale(d))
    .attr('y2', d => yScale(d))
    .style('stroke', STYLES.grid.lineColor)
    .style('stroke-dasharray', STYLES.grid.dashArray);
};

// ============================================================================
// AXIS TITLES
// ============================================================================

/**
 * Render axis titles
 */
const renderAxisTitles = (g, xAxisTitle, yAxisTitle, width, height) => {
  g.selectAll('.axis-title').remove();
  
  if (xAxisTitle) {
    g.append('text')
      .attr('class', 'axis-title x-axis-title')
      .attr('x', width / 2)
      .attr('y', height + 38)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('font-weight', '500')
      .style('fill', STYLES.axis.textColor)
      .style('font-family', STYLES.label.fontFamily)
      .text(xAxisTitle);
  }
  
  if (yAxisTitle) {
    g.append('text')
      .attr('class', 'axis-title y-axis-title')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2)
      .attr('y', -40)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('font-weight', '500')
      .style('fill', STYLES.axis.textColor)
      .style('font-family', STYLES.label.fontFamily)
      .text(yAxisTitle);
  }
};

// ============================================================================
// BAR LABELS
// ============================================================================

/**
 * Render bar labels with angle support
 */
const renderBarLabels = (container, labelsData, options) => {
  const { x, y, barWidth, labelAngle, formatValue, getTextColor } = options;
  
  const minBarWidthForLabel = 12;
  const minBarHeightForLabel = 14;

  if (barWidth < minBarWidthForLabel) return;

  const useAngle = labelAngle !== 0;
  const textAnchor = getTextAnchor(labelAngle);
  const yOffset = getLabelYOffset(labelAngle);
  const fontSize = getLabelFontSize(barWidth);
  const yMax = y(0);
  
  labelsData.forEach(({ xPos, value, fieldName }) => {
    if (value <= 0) return;

    const barTop = y(value);
    if (yMax - barTop < minBarHeightForLabel) return;
    
    const labelX = xPos;
    const labelY = barTop - yOffset;
    
    container.append('text')
      .attr('class', 'bar-label')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', textAnchor)
      .attr('dominant-baseline', getDominantBaseline(labelAngle))
      .attr('transform', useAngle ? `rotate(${-labelAngle}, ${labelX}, ${labelY})` : null)
      .style('font-size', fontSize)
      .style('fill', getTextColor(fieldName) || STYLES.label.color)
      .style('pointer-events', 'none')
      .text(formatValue(value, fieldName));
  });
};

// ============================================================================
// LEGEND
// ============================================================================

/**
 * Add legend to chart
 */
const addLegend = (svg, colorScale, options) => {
  const { showLegend, legendPosition, width, height, margin, getDisplayName, onItemClick } = options;
  
  if (!showLegend) return;
  
  const legendItems = colorScale.domain();
  if (legendItems.length === 0) return;
  
  const isHorizontal = legendPosition === 'top' || legendPosition === 'bottom';
  const swatchSize = 10;
  const itemGap = isHorizontal ? 16 : 6;
  const itemHeight = 18;
  const legendWidth = 90;
  
  const legend = svg.append('g').attr('class', 'legend');
  
  // Measure text widths
  const tempText = svg.append('text').style('font-size', '11px').style('visibility', 'hidden');
  const itemWidths = legendItems.map(item => {
    const label = truncateLabel(item, 12);
    tempText.text(label);
    return tempText.node().getComputedTextLength() + swatchSize + 6;
  });
  tempText.remove();
  
  // Position legend outside the chart area within the reserved margin
  let legendX, legendY;
  switch (legendPosition) {
    case 'top':
      legendX = margin.left;
      legendY = 6;
      break;
    case 'bottom':
      legendX = margin.left;
      legendY = margin.top + height + margin.bottom - 20;
      break;
    case 'left':
      legendX = 8;
      legendY = margin.top;
      break;
    case 'right':
    default:
      legendX = margin.left + width + 10;
      legendY = margin.top;
  }
  
  legend.attr('transform', `translate(${legendX}, ${legendY})`);
  
  // Pagination setup
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
        pages.push(page);
        page = [item];
        pageWidth = itemW;
      } else {
        page.push(item);
        pageWidth += itemW;
      }
    });
    if (page.length > 0) pages.push(page);
  } else if (!isHorizontal && legendItems.length * itemHeight > height) {
    needsPagination = true;
    const maxItems = Math.max(1, Math.floor(height / itemHeight));
    pages = [];
    for (let i = 0; i < legendItems.length; i += maxItems) {
      pages.push(legendItems.slice(i, i + maxItems));
    }
  }
  
  const itemsGroup = legend.append('g').attr('class', 'legend-items');
  let prevNav, nextNav;
  
  const renderPage = () => {
    itemsGroup.selectAll('*').remove();
    const pageItems = pages[currentPage] || [];
    let pos = 0;
    
    pageItems.forEach((item, i) => {
      const itemGroup = itemsGroup.append('g')
        .attr('class', 'legend-item')
        .style('cursor', 'pointer')
        .on('click', (event) => { event.stopPropagation(); onItemClick(item); })
        .on('mouseover', function() { d3.select(this).select('text').style('fill', '#fff'); })
        .on('mouseout', function() { d3.select(this).select('text').style('fill', '#b0b0b8'); });
      
      if (isHorizontal) {
        itemGroup.attr('transform', `translate(${pos}, 0)`);
        pos += itemWidths[legendItems.indexOf(item)] + itemGap;
      } else {
        itemGroup.attr('transform', `translate(0, ${i * itemHeight})`);
      }
      
      itemGroup.append('rect')
        .attr('width', swatchSize)
        .attr('height', swatchSize)
        .attr('rx', 2)
        .attr('fill', colorScale(item));
      
      const displayItem = getDisplayName(item);
      const maxLen = isHorizontal ? 50 : 9;
      
      itemGroup.append('text')
        .attr('x', swatchSize + 4)
        .attr('y', swatchSize - 1)
        .style('font-size', '11px')
        .style('fill', '#b0b0b8')
        .style('font-family', STYLES.label.fontFamily)
        .text(truncateLabel(displayItem, maxLen));
    });
    
    if (needsPagination && prevNav && nextNav) {
      prevNav.style('opacity', currentPage > 0 ? 1 : 0.3);
      nextNav.style('opacity', currentPage < pages.length - 1 ? 1 : 0.3);
    }
  };
  
  // Navigation arrows
  if (needsPagination && pages.length > 1) {
    prevNav = legend.append('g')
      .attr('class', 'legend-nav-prev')
      .style('cursor', 'pointer')
      .on('click', () => { if (currentPage > 0) { currentPage--; renderPage(); } });
    
    nextNav = legend.append('g')
      .attr('class', 'legend-nav-next')
      .style('cursor', 'pointer')
      .on('click', () => { if (currentPage < pages.length - 1) { currentPage++; renderPage(); } });
    
    if (isHorizontal) {
      prevNav.attr('transform', 'translate(-16, 0)')
        .append('text').style('font-size', '12px').style('fill', '#888').text('\u25C2');
      const pageWidth = pages[0].reduce((sum, item) => sum + itemWidths[legendItems.indexOf(item)] + itemGap, 0);
      nextNav.attr('transform', `translate(${pageWidth + 4}, 0)`)
        .append('text').style('font-size', '12px').style('fill', '#888').text('\u25B8');
    } else {
      prevNav.attr('transform', `translate(${legendWidth / 2 - 10}, -12)`)
        .append('text').attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#888').text('\u25B2');
      const pageHeight = pages[0].length * itemHeight;
      nextNav.attr('transform', `translate(${legendWidth / 2 - 10}, ${pageHeight + 4})`)
        .append('text').attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#888').text('\u25BC');
    }
  }
  
  renderPage();
};

// ============================================================================
// MAIN CHART FUNCTION
// ============================================================================

/**
 * Create the vertical bar chart
 */
export const createVerticalBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) {
    return { update: () => {}, destroy: () => {} };
  }
  
  // Extract options
  const {
    showLegend = true,
    legendPosition = 'right',
    xAxisTitle = '',
    yAxisTitle = '',
    showGrid = true,
    showLabels = false,
    labelAngle = 0,
    animate = true,
    fieldFormats = {},
    columnAliases = {},
    colors = DEFAULT_COLORS,
    sharedColorScale = null,
    hideXAxis = false, // For measure rows - hide X-axis on non-last rows
    compactMargins = false, // For measure rows - reduce margins
    margin: baseMargin = { top: 20, right: 20, bottom: 45, left: 50 },
  } = options;
  
  // Create formatters
  const formatValue = createValueFormatter(fieldFormats);
  const getDisplayName = createDisplayNameGetter(columnAliases);
  const getTextColor = createTextColorGetter(fieldFormats);
  
  // Calculate dimensions
  const legendWidth = 90;
  const legendHeight = 26;
  const isVerticalLegend = showLegend && (legendPosition === 'left' || legendPosition === 'right');
  const isHorizontalLegend = showLegend && (legendPosition === 'top' || legendPosition === 'bottom');
  const hasClusterField = !!(config.marks?.cluster || config.clusterField);
  const clusterAxisPadding = hasClusterField ? 45 : 0;
  const clusterTopPadding = hasClusterField ? 20 : 0;
  
  const compactOffset = compactMargins ? { top: -10, bottom: hideXAxis ? -30 : -10, left: -10, right: -10 } : { top: 0, bottom: 0, left: 0, right: 0 };
  
  const margin = {
    top: Math.max(5, baseMargin.top + clusterTopPadding + compactOffset.top + (isHorizontalLegend && legendPosition === 'top' ? legendHeight : 0)),
    right: Math.max(5, baseMargin.right + (isVerticalLegend && legendPosition === 'right' ? legendWidth : 0) + compactOffset.right),
    bottom: Math.max(5, (hideXAxis ? 10 : baseMargin.bottom) + (xAxisTitle && !hideXAxis ? 20 : 0) + clusterAxisPadding + compactOffset.bottom + (isHorizontalLegend && legendPosition === 'bottom' ? legendHeight : 0)),
    left: Math.max(5, baseMargin.left + (isVerticalLegend && legendPosition === 'left' ? legendWidth : 0) + (yAxisTitle ? 20 : 0) + compactOffset.left),
  };
  
  const containerRect = container.getBoundingClientRect();
  const width = (options.width || containerRect.width || 400) - margin.left - margin.right;
  const height = (options.height || containerRect.height || 300) - margin.top - margin.bottom;
  
  // Process data and determine mode
  const processedData = processData(data, config);
  const mode = getChartMode(config);
  
  // Extract field names — coerce to strings to prevent [object Object] labels
  const xField = config.x_axis;
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const clusterField = config.marks?.cluster || config.clusterField;
  const tooltipFields = config.marks?.tooltip || [];
  
  // Focus state
  const focusState = {
    focused: null,
    updateFn: () => {
      barsGroup.selectAll('.bar')
        .transition()
        .duration(200)
        .style('opacity', d => {
          if (!focusState.focused) return 1;
          return d._seriesName === focusState.focused ? 1 : STYLES.bar.dimmedOpacity;
        });
    }
  };
  
  // Clear and create SVG
  d3.select(container).selectAll('*').remove();
  
  const svg = d3.select(container)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .style('overflow', 'visible');
  
  // Clip path
  const clipId = `clip-${Math.random().toString(36).substr(2, 9)}`;
  svg.append('defs').append('clipPath').attr('id', clipId)
    .append('rect').attr('width', width).attr('height', height);
  
  // Groups
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const chartArea = g.append('g').attr('clip-path', `url(#${clipId})`);
  const gridGroup = g.append('g').attr('class', 'grid-group');
  const barsGroup = chartArea.append('g').attr('class', 'bars-group');
  const labelsGroup = chartArea.append('g').attr('class', 'labels-group');
  const xAxisGroup = g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`);
  const yAxisGroup = g.append('g').attr('class', 'y-axis');
  
  // Tooltip
  const tooltip = createTooltip();
  const formatTooltip = createTooltipFormatter(xField, tooltipFields, formatValue, getDisplayName);
  const barHandlers = createBarHandlers(tooltip, formatTooltip, xField, clusterField, focusState);
  
  // ========================================
  // RENDER: CLUSTERED/GROUPED
  // ========================================
  const renderClustered = () => {
    const xCategories = getUniqueValues(processedData, xField);
    const x0 = d3.scaleBand().domain(xCategories).range([0, width]).padding(0.2);
    
    // Determine grouping
    let groupKeys, useClusterField = false;
    if (clusterField) {
      groupKeys = getUniqueValues(processedData, clusterField);
      useClusterField = true;
    } else if (seriesFields.length > 0) {
      groupKeys = seriesFields;
    } else {
      groupKeys = ['value'];
    }
    
    const x1 = d3.scaleBand().domain(groupKeys).range([0, x0.bandwidth()]).padding(0.05);
    
    // Y scale
    let maxVal;
    if (useClusterField) {
      const measureField = seriesFields[0] || 'value';
      const measureAggType = getFieldAggregation(config, measureField) || 'sum';
      const aggregateFn = getAggregationFunction(measureAggType, measureField);
      const aggregated = d3.rollup(processedData,
        v => Math.abs(aggregateFn(v) || 0),
        d => getRowValue(d, xField), d => getRowValue(d, clusterField));
      maxVal = d3.max(Array.from(aggregated.values()), m => d3.max(Array.from(m.values()))) || 0;
    } else {
      maxVal = d3.max(processedData, d => d3.max(groupKeys, key => Math.abs(getRowValue(d, key) || 0))) || 0;
    }
    
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([height, 0]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(groupKeys).range(colors);
    
    // Render
    renderGrid(gridGroup, y, width, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();
    
    let bars;
    if (useClusterField) {
      const measureField = seriesFields[0] || 'value';
      const measureAggType = getFieldAggregation(config, measureField) || 'sum';
      const aggregateFn = getAggregationFunction(measureAggType, measureField);
      const aggregatedData = d3.rollup(processedData,
        v => aggregateFn(v) || 0,
        d => getRowValue(d, xField), d => getRowValue(d, clusterField));
      
      const categoryGroups = barsGroup.selectAll('.category-group')
        .data(xCategories).enter().append('g')
        .attr('class', 'category-group')
        .attr('transform', d => `translate(${x0(d)},0)`);
      
      bars = categoryGroups.selectAll('.bar')
        .data(xVal => groupKeys.map(clusterVal => ({
          key: clusterVal,
          value: (aggregatedData.get(xVal) || new Map()).get(clusterVal) || 0,
          _xVal: xVal, _seriesName: clusterVal, _clusterValue: clusterVal,
        })))
        .enter().append('rect').attr('class', 'bar')
        .attr('x', d => x1(d.key)).attr('width', x1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius)
        .style('cursor', 'pointer');
    } else {
      const categoryGroups = barsGroup.selectAll('.category-group')
        .data(processedData).enter().append('g')
        .attr('class', 'category-group')
        .attr('transform', d => `translate(${x0(getRowValue(d, xField))},0)`);
      
      bars = categoryGroups.selectAll('.bar')
        .data(d => groupKeys.map(key => ({
          key, value: getRowValue(d, key) || 0,
          _data: d, _seriesName: key, _xVal: getRowValue(d, xField),
        })))
        .enter().append('rect').attr('class', 'bar')
        .attr('x', d => x1(d.key)).attr('width', x1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius)
        .style('cursor', 'pointer');
    }
    
    // Animation
    if (animate) {
      bars.attr('y', height).attr('height', 0)
        .transition().duration(600).delay((d, i) => i * 30)
        .attr('y', d => y(Math.max(0, d.value)))
        .attr('height', d => Math.abs(y(0) - y(d.value)));
    } else {
      bars.attr('y', d => y(Math.max(0, d.value)))
        .attr('height', d => Math.abs(y(0) - y(d.value)));
    }
    
    applyBarHandlers(bars, barHandlers);
    
    // Labels
    if (showLabels) {
      const labelsData = [];
      if (useClusterField) {
        const measureField = seriesFields[0] || 'value';
        const measureAggType = getFieldAggregation(config, measureField) || 'sum';
        const aggregateFn = getAggregationFunction(measureAggType, measureField);
        const aggregated = d3.rollup(processedData,
          v => aggregateFn(v) || 0,
          d => getRowValue(d, xField), d => getRowValue(d, clusterField));
        
        xCategories.forEach(xVal => {
          const clusterMap = aggregated.get(xVal) || new Map();
          groupKeys.forEach(clusterVal => {
            labelsData.push({
              xPos: x0(xVal) + x1(clusterVal) + x1.bandwidth() / 2,
              value: clusterMap.get(clusterVal) || 0,
              fieldName: clusterVal
            });
          });
        });
      } else {
        processedData.forEach(d => {
          groupKeys.forEach(key => {
            labelsData.push({
              xPos: x0(getRowValue(d, xField)) + x1(key) + x1.bandwidth() / 2,
              value: getRowValue(d, key) || 0,
              fieldName: key
            });
          });
        });
      }
      
      renderBarLabels(labelsGroup, labelsData, {
        x: x0, y, barWidth: x1.bandwidth(), labelAngle, formatValue, getTextColor
      });
    }
    
    // Axes
    const categoryWidth = x0.bandwidth();
    const minCategoryWidth = 30;
    const showEveryNth = Math.ceil(minCategoryWidth / Math.max(categoryWidth, 1));
    const showClusterLabels = x1.bandwidth() >= 15;
    
    if (!hideXAxis) {
      if (groupKeys.length > 1) {
        const displayGroupKeys = useClusterField ? groupKeys : groupKeys.map(k => getDisplayName(k));
        renderClusteredXAxis(xAxisGroup, x0, x1, groupKeys, { 
          categoryWidth, showEveryNth, showClusterLabels, topLabelGroup: g, height,
          labelFormatter: useClusterField ? null : (k) => getDisplayName(k),
        });
      } else {
        renderXAxis(xAxisGroup, x0, { categoryWidth, showEveryNth, maxLabelLen: categoryWidth < 30 ? 6 : 20 });
      }
    }
    
    renderYAxis(yAxisGroup, y);
    styleAxisLines(g);
    
    return { x0, x1, y, colorScale, isClustered: groupKeys.length > 1 };
  };
  
  // ========================================
  // RENDER: STACKED
  // ========================================
  const renderStacked = () => {
    const xCategories = getUniqueValues(processedData, xField);
    if (xCategories.length === 0) return { x: null, y: null, colorScale: null };
    
    const x = d3.scaleBand().domain(xCategories).range([0, width]).padding(0.2);
    const stackKeys = colorField ? getUniqueValues(processedData, colorField) : seriesFields;
    
    if (stackKeys.length === 0) {
      if (colorField && seriesFields.length > 0) return renderClustered();
      return { x: null, y: null, colorScale: null };
    }
    
    // Prepare stack data
    const groupedByX = d3.group(processedData, d => getRowValue(d, xField));
    const stackData = xCategories.map(xVal => {
      const group = groupedByX.get(xVal) || [];
      const obj = { _xVal: xVal };
      
      if (colorField) {
        const measureField = seriesFields[0];
        stackKeys.forEach(colorKey => {
          const item = group.find(d => getRowValue(d, colorField) === colorKey);
          obj[colorKey] = item ? (getRowValue(item, measureField) || 0) : 0;
        });
      } else {
        const row = group[0] || {};
        stackKeys.forEach(key => { obj[key] = getRowValue(row, key) || 0; });
      }
      return obj;
    });
    
    const stackedData = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetNone)(stackData);
    const maxVal = d3.max(stackedData, layer => d3.max(layer, d => d[1])) || 0;
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([height, 0]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);
    
    renderGrid(gridGroup, y, width, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();
    
    const layers = barsGroup.selectAll('.layer')
      .data(stackedData).enter().append('g')
      .attr('class', 'layer').attr('fill', d => colorScale(d.key));
    
    const bars = layers.selectAll('.bar')
      .data(d => d.map((item, i) => ({ 
        ...item, key: d.key, _seriesName: d.key, _xCategory: xCategories[i]
      })))
      .enter().append('rect').attr('class', 'bar')
      .attr('x', d => x(d._xCategory)).attr('width', x.bandwidth())
      .attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');
    
    if (animate) {
      bars.attr('y', height).attr('height', 0)
        .transition().duration(600).delay((d, i) => i * 20)
        .attr('y', d => y(d[1])).attr('height', d => Math.max(0, y(d[0]) - y(d[1])));
    } else {
      bars.attr('y', d => y(d[1])).attr('height', d => Math.max(0, y(d[0]) - y(d[1])));
    }
    
    bars.on('mouseover', function(event, d) {
        d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
        tooltip.html(formatTooltip({ ...d.data, [xField]: d._xCategory }, d.key, d.data[d.key]))
          .style('visibility', 'visible').style('opacity', '1');
      })
      .on('mousemove', function(event) {
        tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', function() {
        d3.select(this).attr('opacity', focusState.focused && this.__data__._seriesName !== focusState.focused ? STYLES.bar.dimmedOpacity : 1);
        tooltip.style('visibility', 'hidden').style('opacity', '0');
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        focusState.focused = focusState.focused === d.key ? null : d.key;
        focusState.updateFn();
      });
    
    // Labels (totals)
    if (showLabels) {
      const labelsData = xCategories.map((xCat, i) => ({
        xPos: x(xCat) + x.bandwidth() / 2,
        value: stackedData[stackedData.length - 1]?.[i]?.[1] || 0,
        fieldName: seriesFields[0] || 'value'
      }));
      renderBarLabels(labelsGroup, labelsData, {
        x, y, barWidth: x.bandwidth(), labelAngle, formatValue, getTextColor
      });
    }
    
    // Axes
    const categoryWidth = x.bandwidth();
    const showEveryNth = Math.ceil(30 / Math.max(categoryWidth, 1));
    if (!hideXAxis) {
      renderXAxis(xAxisGroup, x, { categoryWidth, showEveryNth, maxLabelLen: categoryWidth < 30 ? 6 : 20 });
    }
    renderYAxis(yAxisGroup, y);
    styleAxisLines(g);
    
    return { x, y, colorScale };
  };
  
  // ========================================
  // RENDER: CLUSTERED + STACKED
  // ========================================
  const renderClusteredStacked = () => {
    const groupField = clusterField || config.marks?.detail || seriesFields[1];
    const stackField = colorField || seriesFields[0];
    const measureField = seriesFields[0];
    
    if (!groupField || !stackField) return renderStacked();
    
    const xCategories = getUniqueValues(processedData, xField);
    if (xCategories.length === 0) return { x0: null, x1: null, y: null, colorScale: null };
    
    const x0 = d3.scaleBand().domain(xCategories).range([0, width]).padding(0.2);
    const groupKeys = getUniqueValues(processedData, groupField);
    if (groupKeys.length === 0) return renderStacked();
    
    const x1 = d3.scaleBand().domain(groupKeys).range([0, x0.bandwidth()]).padding(0.05);
    const stackKeys = getUniqueValues(processedData, stackField);
    if (stackKeys.length === 0) return renderStacked();
    
    // Prepare nested data
    const nestedData = xCategories.map(xVal => {
      const xGroup = processedData.filter(d => getRowValue(d, xField) === xVal);
      const groups = groupKeys.map(gKey => {
        const gGroup = xGroup.filter(d => getRowValue(d, groupField) === gKey);
        const stackObj = { _groupKey: gKey };
        stackKeys.forEach(sKey => {
          const item = gGroup.find(d => getRowValue(d, stackField) === sKey);
          stackObj[sKey] = item ? (getRowValue(item, measureField) || 0) : 0;
        });
        return stackObj;
      });
      return { xVal, groups };
    });
    
    // Max value
    let maxVal = 0;
    nestedData.forEach(({ groups }) => {
      groups.forEach(g => {
        const sum = stackKeys.reduce((acc, key) => acc + (g[key] || 0), 0);
        if (sum > maxVal) maxVal = sum;
      });
    });
    
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([height, 0]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);
    const stack = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetNone);
    
    renderGrid(gridGroup, y, width, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();
    
    const labelsData = [];
    let barIndex = 0;
    
    nestedData.forEach(({ xVal, groups }) => {
      const xGroupG = barsGroup.append('g').attr('transform', `translate(${x0(xVal)},0)`);
      
      groups.forEach(groupData => {
        const stackedGroup = stack([groupData]);
        const groupG = xGroupG.append('g').attr('transform', `translate(${x1(groupData._groupKey)},0)`);
        let groupTotal = 0;
        
        stackedGroup.forEach(layer => {
          const d = layer[0];
          const barHeight = d[1] - d[0];
          groupTotal = d[1];
          
          if (barHeight > 0) {
            const bar = groupG.append('rect')
              .attr('class', 'bar').attr('x', 0).attr('width', x1.bandwidth())
              .attr('fill', colorScale(layer.key)).attr('rx', STYLES.bar.borderRadius)
              .datum({ ...d, key: layer.key, _groupKey: groupData._groupKey, _xVal: xVal, _seriesName: layer.key })
              .style('cursor', 'pointer');
            
            if (animate) {
              bar.attr('y', height).attr('height', 0)
                .transition().duration(600).delay(barIndex * 15)
                .attr('y', y(d[1])).attr('height', y(d[0]) - y(d[1]));
            } else {
              bar.attr('y', y(d[1])).attr('height', y(d[0]) - y(d[1]));
            }
            
            bar.on('mouseover', function(event, d) {
                d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
                const value = d[1] - d[0];
                tooltip.html(`
                  <div style="font-weight: 600; margin-bottom: 6px;">${d._xVal}</div>
                  <div style="color: #a0a0b0; margin-bottom: 4px;">${groupField}: ${d._groupKey}</div>
                  <div style="display: flex; gap: 8px;">
                    <span>${d.key}:</span>
                    <span style="font-weight: 600; margin-left: auto;">${value.toLocaleString()}</span>
                  </div>
                `).style('visibility', 'visible').style('opacity', '1');
              })
              .on('mousemove', function(event) {
                tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
              })
              .on('mouseout', function() {
                d3.select(this).attr('opacity', 1);
                tooltip.style('visibility', 'hidden').style('opacity', '0');
              })
              .on('click', function(event, d) {
                event.stopPropagation();
                focusState.focused = focusState.focused === d.key ? null : d.key;
                focusState.updateFn();
              });
            
            barIndex++;
          }
        });
        
        if (showLabels && groupTotal > 0) {
          labelsData.push({
            xPos: x0(xVal) + x1(groupData._groupKey) + x1.bandwidth() / 2,
            value: groupTotal,
            fieldName: seriesFields[0] || 'value'
          });
        }
      });
    });
    
    if (showLabels) {
      renderBarLabels(labelsGroup, labelsData, {
        x: x0, y, barWidth: x1.bandwidth(), labelAngle, formatValue, getTextColor
      });
    }
    
    // Use dual-level axis for clustered-stacked: category labels on top, cluster labels below
    const categoryWidth = x0.bandwidth();
    const minCategoryWidth = 30;
    const showEveryNth = Math.ceil(minCategoryWidth / Math.max(categoryWidth, 1));
    const showClusterLabels = x1.bandwidth() >= 15;
    
    if (!hideXAxis) {
      renderClusteredXAxis(xAxisGroup, x0, x1, groupKeys, { 
        categoryWidth, 
        showEveryNth, 
        showClusterLabels,
        topLabelGroup: g,
        height
      });
    }
    renderYAxis(yAxisGroup, y);
    styleAxisLines(g);
    
    return { x0, x1, y, colorScale, isClustered: true };
  };
  
  // ========================================
  // RENDER CHART
  // ========================================
  let scales;
  switch (mode) {
    case 'stacked':
    case 'trellis-stacked':
      scales = renderStacked();
      break;
    case 'clustered-stacked':
    case 'trellis-clustered-stacked':
      scales = renderClusteredStacked();
      break;
    default:
      scales = renderClustered();
  }
  
  // Capture active scales for zoom rescaling
  const activeXScale = scales?.x0 || scales?.x || null;
  const activeX1Scale = scales?.x1 || null;
  const activeYScale = scales?.y || null;
  const hasClusteredAxis = !!scales?.isClustered;

  // ========================================
  // ZOOM SETUP
  // ========================================
  const setupZoom = () => {
    const zoom = d3.zoom()
      .scaleExtent([1, 8])
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
        const t = event.transform;

        barsGroup.attr('transform', t);
        labelsGroup.attr('transform', t);

        if (activeXScale) {
          const zoomedX = activeXScale.copy().range([t.applyX(0), t.applyX(width)]);

          if (hasClusteredAxis) {
            // Reposition each category-tick using the zoomed scale
            const newBW = zoomedX.bandwidth();
            xAxisGroup.selectAll('.category-tick')
              .attr('transform', d => `translate(${zoomedX(d) + newBW / 2}, 0)`)
              .style('opacity', d => {
                const pos = zoomedX(d) + newBW / 2;
                if (pos < -40 || pos > width + 40) return 0;
                if (pos < 0 || pos > width) return 0.3;
                return 1;
              });
            // Reposition cluster sub-labels within each category
            if (activeX1Scale) {
              const zoomedX1 = activeX1Scale.copy().range([0, newBW]);
              xAxisGroup.selectAll('.cluster-label').each(function(d) {
                const labelX = zoomedX1(d.cluster) - newBW / 2 + zoomedX1.bandwidth() / 2;
                d3.select(this)
                  .attr('x', labelX)
                  .attr('transform', `rotate(-45, ${labelX}, 12)`);
              });
            }
            // Reposition separator lines
            xAxisGroup.selectAll('.category-tick line')
              .attr('x1', -newBW / 2).attr('x2', -newBW / 2);
            // Reposition top labels if they exist
            g.selectAll('.top-category-label')
              .attr('x', d => zoomedX(d) + newBW / 2)
              .style('opacity', d => {
                const pos = zoomedX(d) + newBW / 2;
                if (pos < -40 || pos > width + 40) return 0;
                if (pos < 0 || pos > width) return 0.3;
                return 1;
              });
          } else {
            xAxisGroup.call(d3.axisBottom(zoomedX).tickSizeOuter(0));
            xAxisGroup.selectAll('text')
              .style('fill', STYLES.axis.textColor)
              .style('font-size', STYLES.axis.fontSize)
              .text(d => truncateLabel(d, 20));
            xAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);
          }
        }

        if (activeYScale) {
          const zoomedY = t.rescaleY(activeYScale);
          yAxisGroup.call(d3.axisLeft(zoomedY).ticks(5).tickFormat(d3.format('.2s')));
          yAxisGroup.selectAll('text')
            .style('fill', STYLES.axis.textColor)
            .style('font-size', STYLES.axis.fontSize);
          yAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);

          gridGroup.selectAll('*').remove();
          if (showGrid) {
            gridGroup.selectAll('.grid-line')
              .data(zoomedY.ticks(5))
              .enter().append('line').attr('class', 'grid-line')
              .attr('x1', 0).attr('x2', width)
              .attr('y1', d => zoomedY(d)).attr('y2', d => zoomedY(d))
              .style('stroke', STYLES.grid.lineColor)
              .style('stroke-dasharray', STYLES.grid.dashArray);
          }
        }

        const labelOpacity = t.k > 1.5 ? Math.max(0, 1 - (t.k - 1.5) / 2) : 1;
        labelsGroup.style('opacity', labelOpacity);
      });

    svg.call(zoom);
    svg.on('dblclick.zoom', () => {
      svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
    });
  };

  // Legend
  if (scales?.colorScale) {
    addLegend(svg, scales.colorScale, {
      showLegend, legendPosition, width, height, margin, getDisplayName,
      onItemClick: (item) => {
        focusState.focused = focusState.focused === item ? null : item;
        focusState.updateFn();
      }
    });
  }
  
  // Axis titles
  renderAxisTitles(g, xAxisTitle, yAxisTitle, width, height);
  
  // Zoom
  setupZoom();
  
  // Click to clear focus
  svg.on('click', () => {
    if (focusState.focused) {
      focusState.focused = null;
      focusState.updateFn();
    }
  });
  
  // Return API
  return {
    update: (newConfig, newData) => createVerticalBarChart(container, newConfig || config, newData || data, options),
    destroy: () => { tooltip.remove(); d3.select(container).selectAll('*').remove(); },
    getFocusedSeries: () => focusState.focused,
    setFocusedSeries: (name) => { focusState.focused = name; focusState.updateFn(); },
    resetZoom: () => svg.transition().duration(300).call(d3.zoom().transform, d3.zoomIdentity),
  };
};

// ============================================================================
// MEASURE ROWS CHART
// ============================================================================

/**
 * Create a bar chart with multiple measures as separate rows
 * Each measure gets its own Y-axis and supports color, cluster, detail marks
 * Similar to Tableau's multiple measures layout
 */
export const createMeasureRowsBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) {
    return { update: () => {}, destroy: () => {} };
  }
  
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  if (seriesFields.length <= 1) {
    return createVerticalBarChart(container, config, data, options);
  }
  
  const {
    colors = DEFAULT_COLORS,
    columnAliases = {},
  } = options;
  
  const getDisplayName = createDisplayNameGetter(columnAliases);
  const measureCount = seriesFields.length;
  
  // Layout calculations
  const containerRect = container.getBoundingClientRect();
  const totalWidth = options.width || containerRect.width || 600;
  const totalHeight = options.height || containerRect.height || 400;
  
  const rowGap = 8;
  const measureLabelWidth = 90; // Space for measure name on left
  const rowHeight = Math.max(80, (totalHeight - (measureCount - 1) * rowGap) / measureCount);
  
  // Clear container and set up flex layout
  d3.select(container).selectAll('*').remove();
  
  const wrapper = d3.select(container)
    .append('div')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('width', '100%')
    .style('height', '100%')
    .style('gap', `${rowGap}px`);
  
  // Track all sub-chart instances for cleanup
  const subCharts = [];
  
  // Check if we have detail mark for trellis
  const detailField = config.marks?.detail;
  const hasDetailMark = detailField && (Array.isArray(detailField) ? detailField.length > 0 : true);
  
  // Create each measure row
  seriesFields.forEach((measureField, rowIndex) => {
    const isLastRow = rowIndex === measureCount - 1;
    const barColor = colors[rowIndex % colors.length];
    
    // Create row container
    const rowDiv = wrapper.append('div')
      .style('display', 'flex')
      .style('flex', '1')
      .style('min-height', `${rowHeight}px`)
      .style('align-items', 'stretch');
    
    // Measure label on left
    rowDiv.append('div')
      .style('width', `${measureLabelWidth}px`)
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'flex-end')
      .style('padding-right', '10px')
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('color', barColor)
      .style('white-space', 'nowrap')
      .style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis')
      .text(getDisplayName(measureField));
    
    // Chart container
    const chartContainer = rowDiv.append('div')
      .style('flex', '1')
      .style('position', 'relative')
      .style('min-width', '0')
      .node();
    
    // Create config for this single measure
    const rowConfig = {
      ...config,
      series: [measureField], // Single measure for this row
    };
    
    // Create options for this row
    const rowOptions = {
      ...options,
      height: rowHeight,
      width: totalWidth - measureLabelWidth,
      showLegend: rowIndex === 0 && options.showLegend !== false, // Legend only on first row
      legendPosition: options.legendPosition || 'right',
      colors: [barColor, ...colors.filter((_, i) => i !== rowIndex % colors.length)], // Row's color first
      // Only show X-axis on last row
      hideXAxis: !isLastRow,
      // Reduce margins for compact layout
      compactMargins: true,
    };
    
    // Use appropriate chart type based on marks
    let subChart;
    if (hasDetailMark) {
      // Trellis mode for this measure
      subChart = createTrellisVerticalBarChart(chartContainer, rowConfig, data, rowOptions);
    } else {
      // Normal chart (handles color, cluster internally)
      subChart = createVerticalBarChart(chartContainer, rowConfig, data, rowOptions);
    }
    
    subCharts.push(subChart);
    
    // Add separator line between rows (not after last)
    if (!isLastRow) {
      wrapper.append('div')
        .style('height', '1px')
        .style('background', 'rgba(100, 100, 120, 0.15)')
        .style('margin', '0 10px');
    }
  });
  
  return {
    update: (newConfig, newData) => createMeasureRowsBarChart(container, newConfig || config, newData || data, options),
    destroy: () => {
      subCharts.forEach(chart => chart?.destroy?.());
      d3.select(container).selectAll('*').remove();
    },
  };
};

// ============================================================================
// TRELLIS CHART
// ============================================================================

/**
 * Create trellis (small multiples) vertical bar chart
 */
export const createTrellisVerticalBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) {
    return { update: () => {}, destroy: () => {} };
  }
  
  const trellisField = config.marks?.detail;
  if (!trellisField) {
    return createVerticalBarChart(container, config, data, options);
  }
  
  const trellisValues = getUniqueValues(data, trellisField);
  const onTrellisFocus = options.onTrellisFocus;
  
  // Build shared color scale
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const clusterField = config.marks?.cluster || config.clusterField;
  const defaultColors = options.colors || DEFAULT_COLORS;
  
  let sharedColorDomain = [];
  if (colorField) {
    sharedColorDomain = [...new Set(data.map(d => d[colorField]))].filter(v => v != null);
  } else if (clusterField) {
    sharedColorDomain = [...new Set(data.map(d => d[clusterField]))].filter(v => v != null);
  } else if (seriesFields.length > 0) {
    sharedColorDomain = seriesFields;
  }
  
  const sharedColorScale = d3.scaleOrdinal().domain(sharedColorDomain).range(defaultColors);
  
  // Clear and create wrapper
  d3.select(container).selectAll('*').remove();
  
  const wrapper = d3.select(container)
    .append('div')
    .style('display', 'grid')
    .style('grid-template-columns', 'repeat(auto-fit, minmax(250px, 1fr))')
    .style('gap', '16px')
    .style('width', '100%')
    .style('height', '100%')
    .style('overflow', 'auto')
    .style('padding', '8px');
  
  const charts = [];
  
  trellisValues.forEach(trellisVal => {
    const trellisData = data.filter(d => d[trellisField] === trellisVal);
    
    const chartContainer = wrapper.append('div')
      .style('padding', '8px')
      .style('min-height', '200px')
      .style('background', 'rgba(255, 255, 255, 0.02)')
      .style('border-radius', '8px')
      .style('border', '1px solid rgba(255, 255, 255, 0.06)');
    
    // Clickable title
    const titleRow = chartContainer.append('div')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('gap', '6px')
      .style('margin-bottom', '8px')
      .style('padding', '4px 8px')
      .style('border-radius', '4px')
      .style('cursor', onTrellisFocus ? 'pointer' : 'default')
      .style('transition', 'background 0.15s ease');
    
    if (onTrellisFocus) {
      titleRow
        .on('mouseenter', function() { d3.select(this).style('background', 'rgba(59, 130, 246, 0.1)'); })
        .on('mouseleave', function() { d3.select(this).style('background', 'transparent'); })
        .on('click', () => onTrellisFocus(trellisVal));
    }
    
    titleRow.append('span')
      .style('font-weight', '600')
      .style('font-size', '12px')
      .style('color', '#e0e0e0')
      .text(trellisVal);
    
    const chartArea = chartContainer.append('div')
      .style('width', '100%')
      .style('height', 'calc(100% - 30px)');
    
    const trellisConfig = {
      ...config,
      marks: { ...config.marks, detail: undefined },
    };
    
    const chart = createVerticalBarChart(chartArea.node(), trellisConfig, trellisData, {
      ...options,
      width: 250,
      height: 180,
      margin: { top: 20, right: 15, bottom: 40, left: 45 },
      showLegend: false,
      sharedColorScale,
    });
    
    charts.push(chart);
  });
  
  // Shared legend
  const hasMultipleSeries = seriesFields.length > 1 || colorField;
  const legendPosition = options.legendPosition || 'top';
  let focusedSeries = null;
  
  const updateAllChartsFocus = (series) => {
    focusedSeries = focusedSeries === series ? null : series;
    
    d3.select(container).selectAll('.bar').each(function() {
      const bar = d3.select(this);
      const barData = bar.datum();
      const barSeries = barData?._seriesName || barData?.key;
      bar.style('opacity', focusedSeries === null ? 1 : (barSeries === focusedSeries ? 1 : 0.15));
    });
    
    d3.select(container).selectAll('.trellis-legend-item').each(function() {
      const item = d3.select(this);
      const itemSeries = item.attr('data-series');
      item.style('opacity', focusedSeries === null ? 1 : (itemSeries === focusedSeries ? 1 : 0.4));
    });
  };
  
  if (options.showLegend !== false && hasMultipleSeries) {
    const legendItems = colorField
      ? [...new Set(data.map(d => d[colorField]))]
      : seriesFields;
    
    if (legendItems.length > 0) {
      const isVertical = legendPosition === 'left' || legendPosition === 'right';
      const containerEl = d3.select(container);
      
      if (isVertical) {
        const existingContent = containerEl.selectAll(':scope > *');
        const flexWrapper = containerEl.insert('div', ':first-child')
          .style('display', 'flex')
          .style('width', '100%')
          .style('height', '100%')
          .style('flex-direction', legendPosition === 'left' ? 'row' : 'row-reverse');
        
        existingContent.each(function() { flexWrapper.node().appendChild(this); });
        
        const legendContainer = flexWrapper.insert('div', legendPosition === 'left' ? ':first-child' : null)
          .attr('class', 'trellis-legend')
          .style('display', 'flex')
          .style('flex-direction', 'column')
          .style('gap', '8px')
          .style('padding', '12px')
          .style('min-width', '100px')
          .style('border-' + (legendPosition === 'left' ? 'right' : 'left'), '1px solid rgba(255, 255, 255, 0.06)');
        
        legendItems.forEach(item => {
          const legendItem = legendContainer.append('div')
            .attr('class', 'trellis-legend-item')
            .attr('data-series', String(item))
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('gap', '6px')
            .style('font-size', '11px')
            .style('color', '#a0a0b0')
            .style('cursor', 'pointer')
            .style('transition', 'opacity 0.15s ease')
            .on('click', () => updateAllChartsFocus(String(item)))
            .on('mouseenter', function() { d3.select(this).style('color', '#e0e0e0'); })
            .on('mouseleave', function() { d3.select(this).style('color', '#a0a0b0'); });
          
          legendItem.append('div')
            .style('width', '10px')
            .style('height', '10px')
            .style('border-radius', '2px')
            .style('background', sharedColorScale(String(item)))
            .style('flex-shrink', '0');
          
          legendItem.append('span')
            .style('white-space', 'nowrap')
            .style('overflow', 'hidden')
            .style('text-overflow', 'ellipsis')
            .text(String(item));
        });
      } else {
        const legendContainer = containerEl.insert('div', legendPosition === 'top' ? ':first-child' : null)
          .attr('class', 'trellis-legend')
          .style('display', 'flex')
          .style('flex-wrap', 'wrap')
          .style('justify-content', 'center')
          .style('gap', '12px')
          .style('padding', '8px 12px')
          .style('border-' + (legendPosition === 'top' ? 'bottom' : 'top'), '1px solid rgba(255, 255, 255, 0.06)');
        
        legendItems.forEach(item => {
          const legendItem = legendContainer.append('div')
            .attr('class', 'trellis-legend-item')
            .attr('data-series', String(item))
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('gap', '6px')
            .style('font-size', '11px')
            .style('color', '#a0a0b0')
            .style('cursor', 'pointer')
            .style('transition', 'opacity 0.15s ease')
            .on('click', () => updateAllChartsFocus(String(item)))
            .on('mouseenter', function() { d3.select(this).style('color', '#e0e0e0'); })
            .on('mouseleave', function() { d3.select(this).style('color', '#a0a0b0'); });
          
          legendItem.append('div')
            .style('width', '10px')
            .style('height', '10px')
            .style('border-radius', '2px')
            .style('background', sharedColorScale(String(item)));
          
          legendItem.append('span').text(String(item));
        });
      }
    }
  }
  
  return {
    update: (newConfig, newData) => createTrellisVerticalBarChart(container, newConfig || config, newData || data, options),
    destroy: () => { charts.forEach(c => c.destroy()); d3.select(container).selectAll('*').remove(); },
  };
};
