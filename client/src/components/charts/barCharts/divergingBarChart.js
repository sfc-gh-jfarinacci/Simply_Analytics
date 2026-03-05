/**
 * D3.js Diverging Bar Chart
 * 
 * Horizontal bars extending left/right from a center zero axis.
 * 
 * Modes:
 * - Natural: Positive values go right, negative values go left
 * - Two-measure (butterfly): First measure extends right, second extends left
 * 
 * Supports color, cluster, and trellis marks same as other bar charts,
 * with bars positioned relative to the zero center line.
 */

import * as d3 from 'd3';

const DEFAULT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1'
];

const STYLES = {
  axis: { textColor: '#a0a0b0', lineColor: 'rgba(100, 100, 120, 0.3)', fontSize: '11px', smallFontSize: '9px' },
  grid: { lineColor: 'rgba(100, 100, 120, 0.15)', dashArray: '3,3' },
  tooltip: { background: 'rgba(30, 30, 40, 0.95)', border: '1px solid rgba(100, 100, 120, 0.3)', borderRadius: '6px', padding: '10px 14px', fontSize: '12px', color: '#e0e0e0', shadow: '0 4px 12px rgba(0,0,0,0.3)' },
  bar: { borderRadius: 2, hoverOpacity: 0.8, dimmedOpacity: 0.2 },
  label: { color: '#a0a0b0', fontFamily: 'system-ui, -apple-system, sans-serif' },
};

// ============================================================================
// UTILITIES
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
  return [...new Set(data.map(d => toPrimitive(getRowValue(d, field))).filter(v => v != null))];
};

const getAggregationFunction = (aggregationType, fieldName) => {
  const type = (aggregationType || 'sum').toLowerCase();
  switch (type) {
    case 'avg': case 'average': return (values) => d3.mean(values, d => getRowValue(d, fieldName) || 0);
    case 'min': return (values) => d3.min(values, d => getRowValue(d, fieldName) || 0);
    case 'max': return (values) => d3.max(values, d => getRowValue(d, fieldName) || 0);
    case 'count': return (values) => values.length;
    case 'median': return (values) => d3.median(values, d => getRowValue(d, fieldName) || 0);
    case 'sum': default: return (values) => d3.sum(values, d => getRowValue(d, fieldName) || 0);
  }
};

const getFieldAggregation = (config, fieldName) => {
  if (!config?.fieldAggregations || !fieldName) return null;
  const agg = config.fieldAggregations[fieldName];
  if (agg) return agg;
  const upperField = fieldName.toUpperCase();
  const matchedKey = Object.keys(config.fieldAggregations).find(k => k.toUpperCase() === upperField);
  return matchedKey ? config.fieldAggregations[matchedKey] : null;
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

const getChartMode = (config) => {
  const hasColor = !!config.marks?.color;
  const hasCluster = !!config.marks?.cluster || !!config.clusterField;
  const detail = config.marks?.detail;
  const hasDetail = Array.isArray(detail) ? detail.length > 0 : !!detail;
  const hasMultiSeries = (config.series?.length || 0) > 1;

  if (hasDetail) {
    if (hasColor && hasCluster) return 'trellis-clustered-stacked';
    if (hasColor) return 'trellis-stacked';
    if (hasCluster) return 'trellis-clustered';
    return 'trellis';
  }
  if (hasColor && hasCluster) return 'clustered-stacked';
  if (hasColor) return 'stacked';
  if (hasCluster || hasMultiSeries) return 'clustered';
  return 'simple';
};

// ============================================================================
// FORMAT HELPERS
// ============================================================================

const createValueFormatter = (fieldFormats = {}) => (value, fieldName) => {
  if (value == null || isNaN(value)) return '';
  const fc = fieldFormats[fieldName] || {};
  const format = fc.format || 'auto';
  const decimals = fc.decimals;
  const getD = (fb) => decimals != null ? decimals : fb;
  switch (format) {
    case 'number': return value.toLocaleString('en-US', { minimumFractionDigits: getD(0), maximumFractionDigits: getD(0) });
    case 'compact': return d3.format(`.${getD(2)}s`)(value).replace('G', 'B');
    case 'currency': return '$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: getD(0), maximumFractionDigits: getD(0) });
    case 'percent': return (value * 100).toFixed(getD(1)) + '%';
    default:
      if (Math.abs(value) >= 10000) return d3.format(`.${getD(2)}s`)(value).replace('G', 'B');
      return value.toLocaleString('en-US', { minimumFractionDigits: getD(2), maximumFractionDigits: getD(2) });
  }
};

const createDisplayNameGetter = (columnAliases = {}) => (fieldName) => {
  if (!fieldName) return '';
  const k = Object.keys(columnAliases).find(k => k.toUpperCase() === fieldName.toUpperCase());
  return (k && columnAliases[k]) || fieldName;
};

// ============================================================================
// TOOLTIP
// ============================================================================

const createTooltip = () => d3.select(document.body).append('div').attr('class', 'chart-tooltip')
  .style('position', 'fixed').style('visibility', 'hidden')
  .style('background', STYLES.tooltip.background).style('border', STYLES.tooltip.border)
  .style('border-radius', STYLES.tooltip.borderRadius).style('padding', STYLES.tooltip.padding)
  .style('font-size', STYLES.tooltip.fontSize).style('color', STYLES.tooltip.color)
  .style('pointer-events', 'none').style('z-index', '99999')
  .style('box-shadow', STYLES.tooltip.shadow)
  .style('backdrop-filter', 'blur(8px)').style('-webkit-backdrop-filter', 'blur(8px)')
  .style('transition', 'opacity 0.15s ease, visibility 0.15s ease').style('opacity', '0');

const createTooltipFormatter = (yField, tooltipFields, formatValue, getDisplayName) =>
  (d, seriesName, value) => {
    let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">${d[yField]}</div>`;
    html += `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">`;
    html += `<span style="color:#a0a0b0;">${getDisplayName(seriesName)}:</span>`;
    html += `<span style="font-weight:600;margin-left:auto;">${typeof value === 'number' ? formatValue(value, seriesName) : value}</span></div>`;
    tooltipFields.forEach(field => {
      const val = d[field];
      if (val != null) {
        html += `<div style="display:flex;align-items:center;gap:8px;margin:2px 0;color:#888;">`;
        html += `<span>${getDisplayName(field)}:</span>`;
        html += `<span style="margin-left:auto;">${typeof val === 'number' ? formatValue(val, field) : val}</span></div>`;
      }
    });
    return html;
  };

// ============================================================================
// BAR HANDLERS
// ============================================================================

const createBarHandlers = (tooltip, formatTooltip, yField, clusterField, focusState) => ({
  onMouseOver: function(event, d) {
    d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
    const data = d._data || { [yField]: d._yVal, [clusterField]: d._clusterValue };
    tooltip.html(formatTooltip(data, d.key, d.value)).style('visibility', 'visible').style('opacity', '1');
  },
  onMouseMove: function(event) { tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`); },
  onMouseOut: function() {
    const op = focusState.focused && this.__data__._seriesName !== focusState.focused ? STYLES.bar.dimmedOpacity : 1;
    d3.select(this).attr('opacity', op);
    tooltip.style('visibility', 'hidden').style('opacity', '0');
  },
  onClick: function(event, d) { event.stopPropagation(); focusState.focused = focusState.focused === d.key ? null : d.key; focusState.updateFn(); }
});

const applyBarHandlers = (bars, handlers) => {
  bars.on('mouseover', handlers.onMouseOver).on('mousemove', handlers.onMouseMove)
    .on('mouseout', handlers.onMouseOut).on('click', handlers.onClick);
};

// ============================================================================
// AXIS RENDERING
// ============================================================================

const renderYCategoryAxis = (axisGroup, scale, options = {}) => {
  const { categoryHeight = 50, showEveryNth = 1, maxLabelLen = 20, atX = 0 } = options;
  const fontSize = categoryHeight < 20 ? STYLES.axis.smallFontSize : STYLES.axis.fontSize;
  axisGroup.attr('transform', `translate(${atX}, 0)`)
    .call(d3.axisLeft(scale)).selectAll('text')
    .style('fill', STYLES.axis.textColor).style('font-size', fontSize)
    .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0)
    .text(d => truncateLabel(d, maxLabelLen));
};

const renderClusteredYAxis = (axisGroup, y0, y1, groupKeys, options = {}) => {
  const { categoryHeight, showEveryNth = 1, showClusterLabels = true, labelFormatter, atX = 0 } = options;
  axisGroup.attr('transform', `translate(${atX}, 0)`);
  axisGroup.selectAll('*').remove();
  const categoryTicks = axisGroup.selectAll('.category-tick').data(y0.domain()).enter().append('g')
    .attr('class', 'category-tick').attr('transform', d => `translate(0, ${y0(d) + y0.bandwidth() / 2})`);
  const catFont = categoryHeight < 40 ? '9px' : '11px';
  const catMaxLen = categoryHeight < 40 ? 8 : 18;
  categoryTicks.append('text').attr('x', -8).attr('y', 0).attr('text-anchor', 'end').attr('dominant-baseline', 'central')
    .style('fill', STYLES.axis.textColor).style('font-size', catFont).style('font-weight', '600')
    .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0).text(d => truncateLabel(d, catMaxLen));
  if (showClusterLabels) {
    const bh = y1.bandwidth();
    const cf = bh < 12 ? '7px' : bh < 20 ? '8px' : '9px';
    const ml = bh < 12 ? 6 : bh < 20 ? 10 : 16;
    categoryTicks.selectAll('.cluster-label').data(d => groupKeys.map(k => ({ category: d, cluster: k })))
      .enter().append('text').attr('class', 'cluster-label').attr('x', -4)
      .attr('y', d => y1(d.cluster) - y0.bandwidth() / 2 + y1.bandwidth() / 2)
      .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
      .style('fill', '#9ca3af').style('font-size', cf).style('font-weight', '500')
      .text(d => truncateLabel(labelFormatter ? labelFormatter(d.cluster) : d.cluster, ml));
  }
  if (categoryHeight > 20) {
    categoryTicks.append('line').attr('x1', -60).attr('x2', 0)
      .attr('y1', -y0.bandwidth() / 2).attr('y2', -y0.bandwidth() / 2)
      .style('stroke', 'rgba(100, 100, 120, 0.15)').style('stroke-width', 1)
      .style('opacity', (d, i) => i === 0 ? 0 : 1);
  }
};

const styleAxisLines = (g) => { g.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor); };

const renderGrid = (gridGroup, xScale, height, showGrid) => {
  gridGroup.selectAll('*').remove();
  if (!showGrid || !xScale) return;
  gridGroup.selectAll('.grid-line').data(xScale.ticks(7)).enter().append('line')
    .attr('class', 'grid-line').attr('x1', d => xScale(d)).attr('x2', d => xScale(d))
    .attr('y1', 0).attr('y2', height).style('stroke', STYLES.grid.lineColor).style('stroke-dasharray', STYLES.grid.dashArray);
};

const renderAxisTitles = (g, xAxisTitle, yAxisTitle, width, height) => {
  g.selectAll('.axis-title').remove();
  if (xAxisTitle) g.append('text').attr('class', 'axis-title').attr('x', width / 2).attr('y', height + 38)
    .attr('text-anchor', 'middle').style('font-size', '12px').style('font-weight', '500')
    .style('fill', STYLES.axis.textColor).style('font-family', STYLES.label.fontFamily).text(xAxisTitle);
  if (yAxisTitle) g.append('text').attr('class', 'axis-title').attr('transform', 'rotate(-90)')
    .attr('x', -height / 2).attr('y', -60).attr('text-anchor', 'middle')
    .style('font-size', '12px').style('font-weight', '500')
    .style('fill', STYLES.axis.textColor).style('font-family', STYLES.label.fontFamily).text(yAxisTitle);
};

// ============================================================================
// LEGEND
// ============================================================================

const addLegend = (svg, colorScale, options) => {
  const { showLegend, legendPosition, width, height, margin, getDisplayName, onItemClick } = options;
  if (!showLegend) return;
  const items = colorScale.domain();
  if (items.length === 0) return;
  const isH = legendPosition === 'top' || legendPosition === 'bottom';
  const sw = 10, ih = 18;
  const legend = svg.append('g').attr('class', 'legend');
  let lx, ly;
  switch (legendPosition) {
    case 'top': lx = margin.left; ly = 6; break;
    case 'bottom': lx = margin.left; ly = margin.top + height + margin.bottom - 20; break;
    case 'left': lx = 8; ly = margin.top; break;
    case 'right': default: lx = margin.left + width + 10; ly = margin.top;
  }
  legend.attr('transform', `translate(${lx}, ${ly})`);
  const ig = legend.append('g');
  let pos = 0;
  items.forEach((item, i) => {
    const g = ig.append('g').style('cursor', 'pointer')
      .on('click', (e) => { e.stopPropagation(); onItemClick(item); })
      .on('mouseover', function() { d3.select(this).select('text').style('fill', '#fff'); })
      .on('mouseout', function() { d3.select(this).select('text').style('fill', '#b0b0b8'); });
    if (isH) { g.attr('transform', `translate(${pos}, 0)`); pos += 80; }
    else { g.attr('transform', `translate(0, ${i * ih})`); }
    g.append('rect').attr('width', sw).attr('height', sw).attr('rx', 2).attr('fill', colorScale(item));
    g.append('text').attr('x', sw + 4).attr('y', sw - 1).style('font-size', '11px').style('fill', '#b0b0b8')
      .style('font-family', STYLES.label.fontFamily).text(truncateLabel(getDisplayName(item), isH ? 50 : 9));
  });
};

// ============================================================================
// DIVERGING BAR HELPERS
// ============================================================================

/** Position a bar relative to x(0) based on its value sign */
const barX = (x, value) => value >= 0 ? x(0) : x(value);
const barW = (x, value) => Math.abs(x(value) - x(0));

// ============================================================================
// MAIN CHART
// ============================================================================

export const createDivergingBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const {
    showLegend = true, legendPosition = 'right',
    xAxisTitle = '', yAxisTitle = '',
    showGrid = true, showLabels = false, animate = true,
    fieldFormats = {}, columnAliases = {},
    colors = DEFAULT_COLORS,
    sharedColorScale = null,
    hideYAxis = false,
    margin: baseMargin = { top: 20, right: 30, bottom: 35, left: 100 },
  } = options;

  const formatValue = createValueFormatter(fieldFormats);
  const getDisplayName = createDisplayNameGetter(columnAliases);

  const legendWidth = 90, legendHeight = 26;
  const isVLegend = showLegend && (legendPosition === 'left' || legendPosition === 'right');
  const isHLegend = showLegend && (legendPosition === 'top' || legendPosition === 'bottom');

  const margin = {
    top: Math.max(5, baseMargin.top + (isHLegend && legendPosition === 'top' ? legendHeight : 0)),
    right: Math.max(5, baseMargin.right + (isVLegend && legendPosition === 'right' ? legendWidth : 0)),
    bottom: Math.max(5, baseMargin.bottom + (xAxisTitle ? 20 : 0) + (isHLegend && legendPosition === 'bottom' ? legendHeight : 0)),
    left: Math.max(5, baseMargin.left + (isVLegend && legendPosition === 'left' ? legendWidth : 0) + (yAxisTitle ? 20 : 0)),
  };

  const containerRect = container.getBoundingClientRect();
  const width = (options.width || containerRect.width || 400) - margin.left - margin.right;
  const height = (options.height || containerRect.height || 300) - margin.top - margin.bottom;

  const processedData = processData(data, config);
  const mode = getChartMode(config);
  const yField = config.x_axis;
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const clusterField = config.marks?.cluster || config.clusterField;
  const tooltipFields = config.marks?.tooltip || [];
  const isTwoMeasure = seriesFields.length >= 2;

  const focusState = {
    focused: null,
    updateFn: () => {
      barsGroup.selectAll('.bar').transition().duration(200)
        .style('opacity', d => !focusState.focused ? 1 : d._seriesName === focusState.focused ? 1 : STYLES.bar.dimmedOpacity);
    }
  };

  d3.select(container).selectAll('*').remove();
  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom).style('overflow', 'visible');
  const clipId = `clip-${Math.random().toString(36).substr(2, 9)}`;
  svg.append('defs').append('clipPath').attr('id', clipId).append('rect').attr('width', width).attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const chartArea = g.append('g').attr('clip-path', `url(#${clipId})`);
  const gridGroup = g.append('g').attr('class', 'grid-group');
  const barsGroup = chartArea.append('g').attr('class', 'bars-group');
  const labelsGroup = chartArea.append('g').attr('class', 'labels-group');
  const xAxisGroup = g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`);
  const yAxisGroup = g.append('g').attr('class', 'y-axis');

  const tooltip = createTooltip();
  const formatTooltip = createTooltipFormatter(yField, tooltipFields, formatValue, getDisplayName);
  const barHandlers = createBarHandlers(tooltip, formatTooltip, yField, clusterField, focusState);

  // ========================================
  // RENDER: CLUSTERED / GROUPED
  // ========================================
  const renderClustered = () => {
    const yCategories = getUniqueValues(processedData, yField);
    const y0 = d3.scaleBand().domain(yCategories).range([0, height]).padding(0.2);

    let groupKeys, useClusterField = false;
    if (clusterField) { groupKeys = getUniqueValues(processedData, clusterField); useClusterField = true; }
    else if (seriesFields.length > 0) { groupKeys = seriesFields; }
    else { groupKeys = ['value']; }

    const y1 = d3.scaleBand().domain(groupKeys).range([0, y0.bandwidth()]).padding(0.05);

    // Find max absolute value for symmetric domain
    let maxAbsVal;
    if (useClusterField) {
      const mf = seriesFields[0] || 'value';
      const aggType = getFieldAggregation(config, mf) || 'sum';
      const aggFn = getAggregationFunction(aggType, mf);
      const agg = d3.rollup(processedData, v => Math.abs(aggFn(v) || 0), d => getRowValue(d, yField), d => getRowValue(d, clusterField));
      maxAbsVal = d3.max(Array.from(agg.values()), m => d3.max(Array.from(m.values()))) || 0;
    } else if (isTwoMeasure) {
      // Butterfly: find max across both measures
      maxAbsVal = d3.max(processedData, d => Math.max(...seriesFields.map(k => Math.abs(getRowValue(d, k) || 0)))) || 0;
    } else {
      maxAbsVal = d3.max(processedData, d => d3.max(groupKeys, key => Math.abs(getRowValue(d, key) || 0))) || 0;
    }

    const x = d3.scaleLinear().domain([-maxAbsVal * 1.1, maxAbsVal * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(groupKeys).range(colors);

    renderGrid(gridGroup, x, height, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

    // Center line
    g.selectAll('.center-line').remove();
    g.append('line').attr('class', 'center-line')
      .attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', height)
      .style('stroke', STYLES.axis.lineColor).style('stroke-width', 1.5);

    let bars;
    if (useClusterField) {
      const mf = seriesFields[0] || 'value';
      const aggType = getFieldAggregation(config, mf) || 'sum';
      const aggFn = getAggregationFunction(aggType, mf);
      const aggData = d3.rollup(processedData, v => aggFn(v) || 0, d => getRowValue(d, yField), d => getRowValue(d, clusterField));

      const catGroups = barsGroup.selectAll('.category-group')
        .data(yCategories).enter().append('g').attr('class', 'category-group')
        .attr('transform', d => `translate(0,${y0(d)})`);

      bars = catGroups.selectAll('.bar')
        .data(yVal => groupKeys.map(cv => ({
          key: cv, value: (aggData.get(yVal) || new Map()).get(cv) || 0,
          _yVal: yVal, _seriesName: cv, _clusterValue: cv,
        })))
        .enter().append('rect').attr('class', 'bar')
        .attr('y', d => y1(d.key)).attr('height', y1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');

    } else if (isTwoMeasure) {
      // Butterfly: first measure RIGHT, second measure LEFT
      const catGroups = barsGroup.selectAll('.category-group')
        .data(processedData).enter().append('g').attr('class', 'category-group')
        .attr('transform', d => `translate(0,${y0(getRowValue(d, yField))})`);

      bars = catGroups.selectAll('.bar')
        .data(d => seriesFields.map((key, i) => {
          const raw = getRowValue(d, key) || 0;
          const value = i === 0 ? Math.abs(raw) : -Math.abs(raw);
          return { key, value, _data: d, _seriesName: key, _yVal: getRowValue(d, yField) };
        }))
        .enter().append('rect').attr('class', 'bar')
        .attr('y', d => y1(d.key)).attr('height', y1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');

    } else {
      const catGroups = barsGroup.selectAll('.category-group')
        .data(processedData).enter().append('g').attr('class', 'category-group')
        .attr('transform', d => `translate(0,${y0(getRowValue(d, yField))})`);

      bars = catGroups.selectAll('.bar')
        .data(d => groupKeys.map(key => ({
          key, value: getRowValue(d, key) || 0,
          _data: d, _seriesName: key, _yVal: getRowValue(d, yField),
        })))
        .enter().append('rect').attr('class', 'bar')
        .attr('y', d => y1(d.key)).attr('height', y1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');
    }

    // Position bars from center
    if (animate) {
      bars.attr('x', x(0)).attr('width', 0)
        .transition().duration(600).delay((d, i) => i * 25)
        .attr('x', d => barX(x, d.value)).attr('width', d => barW(x, d.value));
    } else {
      bars.attr('x', d => barX(x, d.value)).attr('width', d => barW(x, d.value));
    }

    applyBarHandlers(bars, barHandlers);

    // Labels
    if (showLabels) {
      bars.each(function(d) {
        if (d.value === 0) return;
        const bx = d.value >= 0 ? x(d.value) + 4 : x(d.value) - 4;
        const anchor = d.value >= 0 ? 'start' : 'end';
        labelsGroup.append('text').attr('class', 'bar-label')
          .attr('x', bx).attr('y', y0(d._yVal) + y1(d.key) + y1.bandwidth() / 2)
          .attr('dominant-baseline', 'central').attr('text-anchor', anchor)
          .style('font-size', y1.bandwidth() < 20 ? '8px' : '10px')
          .style('fill', STYLES.label.color).style('pointer-events', 'none')
          .text(formatValue(Math.abs(d.value), d.key));
      });
    }

    // Axes
    const catH = y0.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) {
      if (groupKeys.length > 1) {
        renderClusteredYAxis(yAxisGroup, y0, y1, groupKeys, {
          categoryHeight: catH, showEveryNth: showEvN, showClusterLabels: y1.bandwidth() >= 12,
          labelFormatter: useClusterField ? null : (k) => getDisplayName(k), atX: x(0),
        });
      } else {
        renderYCategoryAxis(yAxisGroup, y0, { categoryHeight: catH, showEveryNth: showEvN, maxLabelLen: 18, atX: x(0) });
      }
    }

    xAxisGroup.call(d3.axisBottom(x).ticks(7).tickFormat(d3.format('.2s')))
      .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
    styleAxisLines(g);

    return { y0, y1, x, colorScale, isClustered: groupKeys.length > 1 };
  };

  // ========================================
  // RENDER: STACKED
  // ========================================
  const renderStacked = () => {
    const yCategories = getUniqueValues(processedData, yField);
    if (yCategories.length === 0) return { y: null, x: null, colorScale: null };
    const y = d3.scaleBand().domain(yCategories).range([0, height]).padding(0.2);
    const stackKeys = colorField ? getUniqueValues(processedData, colorField) : seriesFields;
    if (stackKeys.length === 0) return renderClustered();

    const groupedByY = d3.group(processedData, d => getRowValue(d, yField));
    const stackData = yCategories.map(yVal => {
      const group = groupedByY.get(yVal) || [];
      const obj = { _yVal: yVal };
      if (colorField) {
        const mf = seriesFields[0];
        stackKeys.forEach(ck => {
          const item = group.find(d => getRowValue(d, colorField) === ck);
          obj[ck] = item ? (getRowValue(item, mf) || 0) : 0;
        });
      } else {
        const row = group[0] || {};
        stackKeys.forEach(key => { obj[key] = getRowValue(row, key) || 0; });
      }
      return obj;
    });

    // Use diverging stack offset so positive and negative values split naturally
    const stackedData = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetDiverging)(stackData);
    const extMin = d3.min(stackedData, layer => d3.min(layer, d => d[0])) || 0;
    const extMax = d3.max(stackedData, layer => d3.max(layer, d => d[1])) || 0;
    const maxExt = Math.max(Math.abs(extMin), Math.abs(extMax));
    const x = d3.scaleLinear().domain([-maxExt * 1.1, maxExt * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);

    renderGrid(gridGroup, x, height, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

    g.selectAll('.center-line').remove();
    g.append('line').attr('class', 'center-line')
      .attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', height)
      .style('stroke', STYLES.axis.lineColor).style('stroke-width', 1.5);

    const layers = barsGroup.selectAll('.layer').data(stackedData).enter().append('g')
      .attr('class', 'layer').attr('fill', d => colorScale(d.key));
    const bars = layers.selectAll('.bar')
      .data(d => d.map((item, i) => ({ ...item, key: d.key, _seriesName: d.key, _yCategory: yCategories[i] })))
      .enter().append('rect').attr('class', 'bar')
      .attr('y', d => y(d._yCategory)).attr('height', y.bandwidth())
      .attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');

    if (animate) {
      bars.attr('x', x(0)).attr('width', 0).transition().duration(600).delay((d, i) => i * 20)
        .attr('x', d => x(Math.min(d[0], d[1]))).attr('width', d => Math.abs(x(d[1]) - x(d[0])));
    } else {
      bars.attr('x', d => x(Math.min(d[0], d[1]))).attr('width', d => Math.abs(x(d[1]) - x(d[0])));
    }

    bars.on('mouseover', function(event, d) {
        d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
        tooltip.html(formatTooltip({ ...d.data, [yField]: d._yCategory }, d.key, d.data[d.key]))
          .style('visibility', 'visible').style('opacity', '1');
      })
      .on('mousemove', function(event) { tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`); })
      .on('mouseout', function() {
        d3.select(this).attr('opacity', focusState.focused && this.__data__._seriesName !== focusState.focused ? STYLES.bar.dimmedOpacity : 1);
        tooltip.style('visibility', 'hidden').style('opacity', '0');
      })
      .on('click', function(event, d) { event.stopPropagation(); focusState.focused = focusState.focused === d.key ? null : d.key; focusState.updateFn(); });

    const catH = y.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) renderYCategoryAxis(yAxisGroup, y, { categoryHeight: catH, showEveryNth: showEvN, maxLabelLen: 18, atX: x(0) });
    xAxisGroup.call(d3.axisBottom(x).ticks(7).tickFormat(d3.format('.2s')))
      .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
    styleAxisLines(g);
    return { y, x, colorScale };
  };

  // ========================================
  // RENDER: CLUSTERED + STACKED
  // ========================================
  const renderClusteredStacked = () => {
    const groupField = clusterField || config.marks?.detail || seriesFields[1];
    const stackField = colorField || seriesFields[0];
    const measureField = seriesFields[0];
    if (!groupField || !stackField) return renderStacked();

    const yCategories = getUniqueValues(processedData, yField);
    if (yCategories.length === 0) return { y0: null, y1: null, x: null, colorScale: null };
    const y0 = d3.scaleBand().domain(yCategories).range([0, height]).padding(0.2);
    const groupKeys = getUniqueValues(processedData, groupField);
    if (groupKeys.length === 0) return renderStacked();
    const y1 = d3.scaleBand().domain(groupKeys).range([0, y0.bandwidth()]).padding(0.05);
    const stackKeys = getUniqueValues(processedData, stackField);
    if (stackKeys.length === 0) return renderStacked();

    let maxAbsVal = 0;
    yCategories.forEach(yVal => {
      const yGroup = processedData.filter(d => getRowValue(d, yField) === yVal);
      groupKeys.forEach(gKey => {
        const gGroup = yGroup.filter(d => getRowValue(d, groupField) === gKey);
        const sum = stackKeys.reduce((acc, sKey) => {
          const item = gGroup.find(d => getRowValue(d, stackField) === sKey);
          return acc + Math.abs(item ? (getRowValue(item, measureField) || 0) : 0);
        }, 0);
        if (sum > maxAbsVal) maxAbsVal = sum;
      });
    });

    const x = d3.scaleLinear().domain([-maxAbsVal * 1.1, maxAbsVal * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);
    const stack = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetDiverging);

    renderGrid(gridGroup, x, height, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

    g.selectAll('.center-line').remove();
    g.append('line').attr('class', 'center-line')
      .attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', height)
      .style('stroke', STYLES.axis.lineColor).style('stroke-width', 1.5);

    let barIdx = 0;
    yCategories.forEach(yVal => {
      const yGroup = processedData.filter(d => getRowValue(d, yField) === yVal);
      const yG = barsGroup.append('g').attr('transform', `translate(0,${y0(yVal)})`);
      groupKeys.forEach(gKey => {
        const gGroup = yGroup.filter(d => getRowValue(d, groupField) === gKey);
        const stackObj = { _groupKey: gKey };
        stackKeys.forEach(sKey => {
          const item = gGroup.find(d => getRowValue(d, stackField) === sKey);
          stackObj[sKey] = item ? (getRowValue(item, measureField) || 0) : 0;
        });
        const stackedGroup = stack([stackObj]);
        const gG = yG.append('g').attr('transform', `translate(0,${y1(gKey)})`);
        stackedGroup.forEach(layer => {
          const d = layer[0];
          const bw = Math.abs(x(d[1]) - x(d[0]));
          if (bw > 0) {
            const bar = gG.append('rect').attr('class', 'bar').attr('y', 0).attr('height', y1.bandwidth())
              .attr('fill', colorScale(layer.key)).attr('rx', STYLES.bar.borderRadius)
              .datum({ ...d, key: layer.key, _groupKey: gKey, _yVal: yVal, _seriesName: layer.key })
              .style('cursor', 'pointer');
            if (animate) {
              bar.attr('x', x(0)).attr('width', 0).transition().duration(600).delay(barIdx * 15)
                .attr('x', x(Math.min(d[0], d[1]))).attr('width', bw);
            } else { bar.attr('x', x(Math.min(d[0], d[1]))).attr('width', bw); }
            bar.on('mouseover', function(event, d) {
                d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
                tooltip.html(`<div style="font-weight:600;margin-bottom:6px;">${d._yVal}</div>
                  <div style="color:#a0a0b0;margin-bottom:4px;">${groupField}: ${d._groupKey}</div>
                  <div style="display:flex;gap:8px;"><span>${d.key}:</span>
                  <span style="font-weight:600;margin-left:auto;">${(d[1] - d[0]).toLocaleString()}</span></div>`)
                  .style('visibility', 'visible').style('opacity', '1');
              })
              .on('mousemove', function(event) { tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`); })
              .on('mouseout', function() { d3.select(this).attr('opacity', 1); tooltip.style('visibility', 'hidden').style('opacity', '0'); })
              .on('click', function(event, d) { event.stopPropagation(); focusState.focused = focusState.focused === d.key ? null : d.key; focusState.updateFn(); });
            barIdx++;
          }
        });
      });
    });

    const catH = y0.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) renderClusteredYAxis(yAxisGroup, y0, y1, groupKeys, { categoryHeight: catH, showEveryNth: showEvN, showClusterLabels: y1.bandwidth() >= 12, atX: x(0) });
    xAxisGroup.call(d3.axisBottom(x).ticks(7).tickFormat(d3.format('.2s')))
      .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
    styleAxisLines(g);
    return { y0, y1, x, colorScale, isClustered: true };
  };

  // ========================================
  // RENDER
  // ========================================
  let scales;
  switch (mode) {
    case 'stacked': case 'trellis-stacked': scales = renderStacked(); break;
    case 'clustered-stacked': case 'trellis-clustered-stacked': scales = renderClusteredStacked(); break;
    default: scales = renderClustered();
  }

  // Capture active scales for zoom rescaling
  let activeYScale = scales?.y0 || scales?.y || null;
  let activeY1Scale = scales?.y1 || null;
  let activeXScale = scales?.x || null;
  let hasClusteredAxis = !!scales?.isClustered;

  // Legend
  if (scales?.colorScale) {
    addLegend(svg, scales.colorScale, {
      showLegend, legendPosition, width, height, margin, getDisplayName,
      onItemClick: (item) => { focusState.focused = focusState.focused === item ? null : item; focusState.updateFn(); }
    });
  }

  renderAxisTitles(g, xAxisTitle, yAxisTitle, width, height);

  // ========================================
  // ZOOM
  // ========================================
  const yAxisBaseX = activeXScale ? activeXScale(0) : 0;

  const setupZoom = () => {
    const zoom = d3.zoom().scaleExtent([1, 8])
      .translateExtent([[0, 0], [width, height]]).extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
        const t = event.transform;
        barsGroup.attr('transform', t);
        labelsGroup.attr('transform', t);

        if (activeYScale) {
          const zoomedY = activeYScale.copy().range([t.applyY(0), t.applyY(height)]);

          if (hasClusteredAxis) {
            // Reposition each category-tick to match zoomed bar positions
            const newBW = zoomedY.bandwidth();
            yAxisGroup.selectAll('.category-tick')
              .attr('transform', d => `translate(0, ${zoomedY(d) + newBW / 2})`)
              .style('opacity', d => {
                const pos = zoomedY(d) + newBW / 2;
                if (pos < -40 || pos > height + 40) return 0;
                if (pos < 0 || pos > height) return 0.3;
                return 1;
              });
            // Reposition cluster sub-labels within each category
            if (activeY1Scale) {
              const zoomedY1 = activeY1Scale.copy().range([0, newBW]);
              yAxisGroup.selectAll('.cluster-label')
                .attr('y', d => zoomedY1(d.cluster) - newBW / 2 + zoomedY1.bandwidth() / 2);
            }
            // Reposition separator lines
            yAxisGroup.selectAll('.category-tick line')
              .attr('y1', -newBW / 2).attr('y2', -newBW / 2);
          } else {
            yAxisGroup.attr('transform', `translate(${yAxisBaseX}, 0)`);
            yAxisGroup.call(d3.axisLeft(zoomedY).tickSizeOuter(0));
            yAxisGroup.selectAll('text')
              .style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize)
              .text(d => truncateLabel(d, 20));
            yAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);
          }
        }

        if (activeXScale) {
          const zx = t.rescaleX(activeXScale);
          xAxisGroup.call(d3.axisBottom(zx).ticks(7).tickFormat(d3.format('.2s')));
          xAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
          xAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);

          g.selectAll('.center-line')
            .attr('x1', zx(0)).attr('x2', zx(0));

          gridGroup.selectAll('*').remove();
          if (showGrid) {
            gridGroup.selectAll('.grid-line').data(zx.ticks(7)).enter().append('line')
              .attr('class', 'grid-line').attr('x1', d => zx(d)).attr('x2', d => zx(d))
              .attr('y1', 0).attr('y2', height).style('stroke', STYLES.grid.lineColor).style('stroke-dasharray', STYLES.grid.dashArray);
          }
        }

        const labelOp = t.k > 1.5 ? Math.max(0, 1 - (t.k - 1.5) / 2) : 1;
        labelsGroup.style('opacity', labelOp);
      });

    svg.call(zoom);
    svg.on('dblclick.zoom', () => svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity));
  };

  setupZoom();

  svg.on('click', () => { if (focusState.focused) { focusState.focused = null; focusState.updateFn(); } });

  return {
    update: (nc, nd) => createDivergingBarChart(container, nc || config, nd || data, options),
    destroy: () => { tooltip.remove(); d3.select(container).selectAll('*').remove(); },
    getFocusedSeries: () => focusState.focused,
    setFocusedSeries: (n) => { focusState.focused = n; focusState.updateFn(); },
    resetZoom: () => svg.transition().duration(300).call(d3.zoom().transform, d3.zoomIdentity),
  };
};

// ============================================================================
// TRELLIS CHART
// ============================================================================

export const createTrellisDivergingBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const trellisField = config.marks?.detail;
  if (!trellisField) return createDivergingBarChart(container, config, data, options);

  const trellisValues = getUniqueValues(data, trellisField);
  const onTrellisFocus = options.onTrellisFocus;
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

  d3.select(container).selectAll('*').remove();

  const wrapper = d3.select(container).append('div')
    .style('display', 'grid')
    .style('grid-template-columns', 'repeat(auto-fit, minmax(280px, 1fr))')
    .style('gap', '16px').style('width', '100%').style('height', '100%')
    .style('overflow', 'auto').style('padding', '8px');

  const charts = [];

  trellisValues.forEach(trellisVal => {
    const trellisData = data.filter(d => d[trellisField] === trellisVal);

    const chartContainer = wrapper.append('div')
      .style('padding', '8px').style('min-height', '200px')
      .style('background', 'rgba(255, 255, 255, 0.02)')
      .style('border-radius', '8px').style('border', '1px solid rgba(255, 255, 255, 0.06)');

    const titleRow = chartContainer.append('div')
      .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center')
      .style('gap', '6px').style('margin-bottom', '8px').style('padding', '4px 8px')
      .style('border-radius', '4px')
      .style('cursor', onTrellisFocus ? 'pointer' : 'default')
      .style('transition', 'background 0.15s ease');

    if (onTrellisFocus) {
      titleRow
        .on('mouseenter', function() { d3.select(this).style('background', 'rgba(59, 130, 246, 0.1)'); })
        .on('mouseleave', function() { d3.select(this).style('background', 'transparent'); })
        .on('click', () => onTrellisFocus(trellisVal));
    }

    titleRow.append('span').style('font-weight', '600').style('font-size', '12px').style('color', '#e0e0e0').text(trellisVal);

    const chartArea = chartContainer.append('div').style('width', '100%').style('height', 'calc(100% - 30px)');

    const trellisConfig = { ...config, marks: { ...config.marks, detail: undefined } };

    const chart = createDivergingBarChart(chartArea.node(), trellisConfig, trellisData, {
      ...options,
      width: 280, height: 200,
      margin: { top: 15, right: 20, bottom: 30, left: 70 },
      showLegend: false,
      sharedColorScale,
    });

    charts.push(chart);
  });

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
          .style('display', 'flex').style('width', '100%').style('height', '100%')
          .style('flex-direction', legendPosition === 'left' ? 'row' : 'row-reverse');
        existingContent.each(function() { flexWrapper.node().appendChild(this); });

        const legendContainer = flexWrapper.insert('div', legendPosition === 'left' ? ':first-child' : null)
          .attr('class', 'trellis-legend')
          .style('display', 'flex').style('flex-direction', 'column').style('gap', '8px')
          .style('padding', '12px').style('min-width', '100px')
          .style('border-' + (legendPosition === 'left' ? 'right' : 'left'), '1px solid rgba(255, 255, 255, 0.06)');

        legendItems.forEach(item => {
          const li = legendContainer.append('div').attr('class', 'trellis-legend-item').attr('data-series', String(item))
            .style('display', 'flex').style('align-items', 'center').style('gap', '6px')
            .style('font-size', '11px').style('color', '#a0a0b0').style('cursor', 'pointer')
            .on('click', () => updateAllChartsFocus(String(item)))
            .on('mouseenter', function() { d3.select(this).style('color', '#e0e0e0'); })
            .on('mouseleave', function() { d3.select(this).style('color', '#a0a0b0'); });
          li.append('div').style('width', '10px').style('height', '10px').style('border-radius', '2px')
            .style('background', sharedColorScale(String(item))).style('flex-shrink', '0');
          li.append('span').style('white-space', 'nowrap').style('overflow', 'hidden')
            .style('text-overflow', 'ellipsis').text(String(item));
        });
      } else {
        const legendContainer = containerEl.insert('div', legendPosition === 'top' ? ':first-child' : null)
          .attr('class', 'trellis-legend')
          .style('display', 'flex').style('flex-wrap', 'wrap').style('justify-content', 'center')
          .style('gap', '12px').style('padding', '8px 12px')
          .style('border-' + (legendPosition === 'top' ? 'bottom' : 'top'), '1px solid rgba(255, 255, 255, 0.06)');

        legendItems.forEach(item => {
          const li = legendContainer.append('div').attr('class', 'trellis-legend-item').attr('data-series', String(item))
            .style('display', 'flex').style('align-items', 'center').style('gap', '6px')
            .style('font-size', '11px').style('color', '#a0a0b0').style('cursor', 'pointer')
            .on('click', () => updateAllChartsFocus(String(item)))
            .on('mouseenter', function() { d3.select(this).style('color', '#e0e0e0'); })
            .on('mouseleave', function() { d3.select(this).style('color', '#a0a0b0'); });
          li.append('div').style('width', '10px').style('height', '10px').style('border-radius', '2px')
            .style('background', sharedColorScale(String(item)));
          li.append('span').text(String(item));
        });
      }
    }
  }

  return {
    update: (nc, nd) => createTrellisDivergingBarChart(container, nc || config, nd || data, options),
    destroy: () => { charts.forEach(c => c.destroy()); d3.select(container).selectAll('*').remove(); },
  };
};
