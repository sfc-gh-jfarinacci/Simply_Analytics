import * as d3 from 'd3';

export const DEFAULT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1'
];

export const STYLES = {
  axis: { textColor: '#a0a0b0', lineColor: 'rgba(100, 100, 120, 0.3)', fontSize: '11px', smallFontSize: '9px' },
  grid: { lineColor: 'rgba(100, 100, 120, 0.15)', dashArray: '3,3' },
  tooltip: { background: 'rgba(30, 30, 40, 0.95)', border: '1px solid rgba(100, 100, 120, 0.3)', borderRadius: '6px', padding: '10px 14px', fontSize: '12px', color: '#e0e0e0', shadow: '0 4px 12px rgba(0,0,0,0.3)' },
  bar: { borderRadius: 2, hoverOpacity: 0.8, dimmedOpacity: 0.2 },
  label: { color: '#a0a0b0', fontFamily: 'system-ui, -apple-system, sans-serif' },
};

export const getRowValue = (row, key) => {
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

export const toPrimitive = (v) => {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Date) return v;
  if (v.name != null) return v.name;
  if (v.value != null) return v.value;
  if (v.label != null) return v.label;
  const vals = Object.values(v).filter(x => x != null && typeof x !== 'object');
  return vals.length > 0 ? vals[0] : String(v);
};

export const getUniqueValues = (data, field) => {
  if (!field) return [];
  return [...new Set(data.map(d => toPrimitive(getRowValue(d, field))).filter(v => v != null))];
};

export const getAggregationFunction = (aggregationType, fieldName) => {
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

export const getFieldAggregation = (config, fieldName) => {
  if (!config?.fieldAggregations || !fieldName) return null;
  const agg = config.fieldAggregations[fieldName];
  if (agg) return agg;
  const upperField = fieldName.toUpperCase();
  const matchedKey = Object.keys(config.fieldAggregations).find(k => k.toUpperCase() === upperField);
  return matchedKey ? config.fieldAggregations[matchedKey] : null;
};

export const processData = (data, config) => {
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

export const truncateLabel = (label, maxLen) => {
  const safe = toPrimitive(label);
  const str = safe == null ? '' : String(safe);
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '...' : str;
};

export const getChartMode = (config) => {
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

export const createValueFormatter = (fieldFormats = {}) => (value, fieldName) => {
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

export const createDisplayNameGetter = (columnAliases = {}) => (fieldName) => {
  if (fieldName == null) return '';
  const str = String(fieldName);
  const k = Object.keys(columnAliases).find(k => k.toUpperCase() === str.toUpperCase());
  return (k && columnAliases[k]) || str;
};

export const createTextColorGetter = (fieldFormats = {}) => (fieldName) => {
  if (!fieldName) return null;
  const color = fieldFormats[fieldName]?.textColor;
  return (!color || color === 'default') ? null : color;
};

export const createTooltip = () => d3.select(document.body).append('div').attr('class', 'chart-tooltip')
  .style('position', 'fixed').style('visibility', 'hidden')
  .style('background', STYLES.tooltip.background).style('border', STYLES.tooltip.border)
  .style('border-radius', STYLES.tooltip.borderRadius).style('padding', STYLES.tooltip.padding)
  .style('font-size', STYLES.tooltip.fontSize).style('color', STYLES.tooltip.color)
  .style('pointer-events', 'none').style('z-index', '99999')
  .style('box-shadow', STYLES.tooltip.shadow)
  .style('backdrop-filter', 'blur(8px)').style('-webkit-backdrop-filter', 'blur(8px)')
  .style('transition', 'opacity 0.15s ease, visibility 0.15s ease').style('opacity', '0');

export const createTooltipFormatter = (categoryField, tooltipFields, formatValue, getDisplayName) =>
  (d, seriesName, value) => {
    let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">${d[categoryField]}</div>`;
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

export const createBarHandlers = (tooltip, formatTooltip, categoryField, clusterField, focusState) => ({
  onMouseOver: function(event, d) {
    d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
    const data = d._data || { [categoryField]: d._yVal || d._xVal, [clusterField]: d._clusterValue };
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

export const applyBarHandlers = (bars, handlers) => {
  bars.on('mouseover', handlers.onMouseOver).on('mousemove', handlers.onMouseMove)
    .on('mouseout', handlers.onMouseOut).on('click', handlers.onClick);
};

export const styleAxisLines = (g) => { g.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor); };

export const renderAxisTitles = (g, xAxisTitle, yAxisTitle, width, height) => {
  g.selectAll('.axis-title').remove();
  if (xAxisTitle) g.append('text').attr('class', 'axis-title').attr('x', width / 2).attr('y', height + 38)
    .attr('text-anchor', 'middle').style('font-size', '12px').style('font-weight', '500')
    .style('fill', STYLES.axis.textColor).style('font-family', STYLES.label.fontFamily).text(xAxisTitle);
  if (yAxisTitle) g.append('text').attr('class', 'axis-title').attr('transform', 'rotate(-90)')
    .attr('x', -height / 2).attr('y', -40).attr('text-anchor', 'middle')
    .style('font-size', '12px').style('font-weight', '500')
    .style('fill', STYLES.axis.textColor).style('font-family', STYLES.label.fontFamily).text(yAxisTitle);
};

export const renderYCategoryAxis = (axisGroup, scale, options = {}) => {
  const { categoryHeight = 50, showEveryNth = 1, maxLabelLen = 20, atX = 0 } = options;
  const fontSize = categoryHeight < 20 ? STYLES.axis.smallFontSize : STYLES.axis.fontSize;
  axisGroup.attr('transform', `translate(${atX}, 0)`)
    .call(d3.axisLeft(scale)).selectAll('text')
    .style('fill', STYLES.axis.textColor).style('font-size', fontSize)
    .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0)
    .text(d => truncateLabel(d, maxLabelLen));
};

export const renderClusteredYAxis = (axisGroup, y0, y1, groupKeys, options = {}) => {
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

export const renderVerticalGrid = (gridGroup, xScale, height, showGrid) => {
  gridGroup.selectAll('*').remove();
  if (!showGrid || !xScale) return;
  gridGroup.selectAll('.grid-line').data(xScale.ticks(5)).enter().append('line')
    .attr('class', 'grid-line').attr('x1', d => xScale(d)).attr('x2', d => xScale(d))
    .attr('y1', 0).attr('y2', height).style('stroke', STYLES.grid.lineColor).style('stroke-dasharray', STYLES.grid.dashArray);
};

export const renderHorizontalGrid = (gridGroup, yScale, width, showGrid) => {
  gridGroup.selectAll('*').remove();
  if (!showGrid || !yScale) return;
  gridGroup.selectAll('.grid-line').data(yScale.ticks(5)).enter().append('line')
    .attr('class', 'grid-line').attr('x1', 0).attr('x2', width)
    .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
    .style('stroke', STYLES.grid.lineColor).style('stroke-dasharray', STYLES.grid.dashArray);
};

export const addLegend = (svg, colorScale, options) => {
  const { showLegend, legendPosition, width, height, margin, getDisplayName, onItemClick } = options;
  if (!showLegend) return;
  const items = colorScale.domain();
  if (items.length === 0) return;
  const isH = legendPosition === 'top' || legendPosition === 'bottom';
  const sw = 10, itemGap = isH ? 16 : 6, ih = 18;

  const legend = svg.append('g').attr('class', 'legend');

  const tempText = svg.append('text').style('font-size', '11px').style('visibility', 'hidden');
  const itemWidths = items.map(item => {
    tempText.text(truncateLabel(item, 12));
    return tempText.node().getComputedTextLength() + sw + 6;
  });
  tempText.remove();

  let lx, ly;
  switch (legendPosition) {
    case 'top': lx = margin.left; ly = 6; break;
    case 'bottom': lx = margin.left; ly = margin.top + height + margin.bottom - 20; break;
    case 'left': lx = 8; ly = margin.top; break;
    case 'right': default: lx = margin.left + width + 10; ly = margin.top;
  }
  legend.attr('transform', `translate(${lx}, ${ly})`);

  const totalW = itemWidths.reduce((sum, w) => sum + w + itemGap, 0) - itemGap;
  let currentPage = 0;
  let pages = [items];
  let needsPagination = false;

  if (isH && totalW > width - 40) {
    needsPagination = true;
    pages = [];
    let page = [], pw = 0;
    items.forEach((item, i) => {
      const iw = itemWidths[i] + itemGap;
      if (pw + iw > width - 40 && page.length > 0) { pages.push(page); page = [item]; pw = iw; }
      else { page.push(item); pw += iw; }
    });
    if (page.length > 0) pages.push(page);
  } else if (!isH && items.length * ih > height) {
    needsPagination = true;
    const maxItems = Math.max(1, Math.floor(height / ih));
    pages = [];
    for (let i = 0; i < items.length; i += maxItems) pages.push(items.slice(i, i + maxItems));
  }

  const ig = legend.append('g').attr('class', 'legend-items');
  let prevNav, nextNav;

  const renderPage = () => {
    ig.selectAll('*').remove();
    const pageItems = pages[currentPage] || [];
    let pos = 0;
    pageItems.forEach((item, i) => {
      const g = ig.append('g').style('cursor', 'pointer')
        .on('click', (e) => { e.stopPropagation(); onItemClick(item); })
        .on('mouseover', function() { d3.select(this).select('text').style('fill', '#fff'); })
        .on('mouseout', function() { d3.select(this).select('text').style('fill', '#b0b0b8'); });
      if (isH) { g.attr('transform', `translate(${pos}, 0)`); pos += itemWidths[items.indexOf(item)] + itemGap; }
      else { g.attr('transform', `translate(0, ${i * ih})`); }
      g.append('rect').attr('width', sw).attr('height', sw).attr('rx', 2).attr('fill', colorScale(item));
      g.append('text').attr('x', sw + 4).attr('y', sw - 1).style('font-size', '11px').style('fill', '#b0b0b8')
        .style('font-family', STYLES.label.fontFamily).text(truncateLabel(getDisplayName(item), isH ? 50 : 9));
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
    if (isH) {
      prevNav.attr('transform', 'translate(-16, 0)').append('text').style('font-size', '12px').style('fill', '#888').text('\u25C2');
      const pw = pages[0].reduce((sum, item) => sum + itemWidths[items.indexOf(item)] + itemGap, 0);
      nextNav.attr('transform', `translate(${pw + 4}, 0)`).append('text').style('font-size', '12px').style('fill', '#888').text('\u25B8');
    } else {
      prevNav.attr('transform', `translate(30, -12)`).append('text').attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#888').text('\u25B2');
      const ph = pages[0].length * ih;
      nextNav.attr('transform', `translate(30, ${ph + 4})`).append('text').attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#888').text('\u25BC');
    }
  }

  renderPage();
};

export const buildTrellisLegend = (container, data, config, options, sharedColorScale, updateAllChartsFocus) => {
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const hasMultipleSeries = seriesFields.length > 1 || colorField;
  const legendPosition = options.legendPosition || 'top';

  if (options.showLegend === false || !hasMultipleSeries) return;

  const legendItems = colorField
    ? [...new Set(data.map(d => d[colorField]))]
    : seriesFields;
  if (legendItems.length === 0) return;

  const isVertical = legendPosition === 'left' || legendPosition === 'right';
  const containerEl = d3.select(container);

  const createItem = (parent, item) => {
    const li = parent.append('div')
      .attr('class', 'trellis-legend-item').attr('data-series', String(item))
      .style('display', 'flex').style('align-items', 'center').style('gap', '6px')
      .style('font-size', '11px').style('color', '#a0a0b0').style('cursor', 'pointer')
      .on('click', () => updateAllChartsFocus(String(item)))
      .on('mouseenter', function() { d3.select(this).style('color', '#e0e0e0'); })
      .on('mouseleave', function() { d3.select(this).style('color', '#a0a0b0'); });
    li.append('div').style('width', '10px').style('height', '10px').style('border-radius', '2px')
      .style('background', sharedColorScale(String(item))).style('flex-shrink', '0');
    li.append('span').style('white-space', 'nowrap').style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis').text(String(item));
  };

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
    legendItems.forEach(item => createItem(legendContainer, item));
  } else {
    const legendContainer = containerEl.insert('div', legendPosition === 'top' ? ':first-child' : null)
      .attr('class', 'trellis-legend')
      .style('display', 'flex').style('flex-wrap', 'wrap').style('justify-content', 'center')
      .style('gap', '12px').style('padding', '8px 12px')
      .style('border-' + (legendPosition === 'top' ? 'bottom' : 'top'), '1px solid rgba(255, 255, 255, 0.06)');
    legendItems.forEach(item => createItem(legendContainer, item));
  }
};

export const buildSharedColorScale = (data, config, colors) => {
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const clusterField = config.marks?.cluster || config.clusterField;

  let domain = [];
  if (colorField) domain = [...new Set(data.map(d => d[colorField]))].filter(v => v != null);
  else if (clusterField) domain = [...new Set(data.map(d => d[clusterField]))].filter(v => v != null);
  else if (seriesFields.length > 0) domain = seriesFields;

  return d3.scaleOrdinal().domain(domain).range(colors);
};

export const createTrellisWrapper = (container) => {
  d3.select(container).selectAll('*').remove();
  return d3.select(container).append('div')
    .style('display', 'grid')
    .style('grid-template-columns', 'repeat(auto-fit, minmax(280px, 1fr))')
    .style('gap', '16px').style('width', '100%').style('height', '100%')
    .style('overflow', 'auto').style('padding', '8px');
};

export const createTrellisPanel = (wrapper, trellisVal, onTrellisFocus) => {
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
  return chartArea;
};

export const createTrellisFocusUpdater = (container) => {
  let focusedSeries = null;
  return (series) => {
    focusedSeries = focusedSeries === series ? null : series;
    d3.select(container).selectAll('.bar').each(function() {
      const bar = d3.select(this);
      const barData = bar.datum();
      const barSeries = barData?._seriesName || barData?.key;
      bar.style('opacity', focusedSeries === null ? 1 : (barSeries === focusedSeries ? 1 : 0.15));
    });
  };
};

export const parseChartOptions = (container, options, overrides = {}) => {
  const {
    showLegend = true, legendPosition = 'right',
    xAxisTitle = '', yAxisTitle = '',
    showGrid = true, showLabels = false, animate = true,
    fieldFormats = {}, columnAliases = {},
    colors = DEFAULT_COLORS,
    sharedColorScale = null,
    margin: baseMargin = overrides.defaultMargin || { top: 20, right: 30, bottom: 35, left: 80 },
  } = options;

  const formatValue = createValueFormatter(fieldFormats);
  const getDisplayName = createDisplayNameGetter(columnAliases);
  const getTextColor = createTextColorGetter(fieldFormats);

  const legendWidth = 90, legendHeight = 26;
  const isVLegend = showLegend && (legendPosition === 'left' || legendPosition === 'right');
  const isHLegend = showLegend && (legendPosition === 'top' || legendPosition === 'bottom');

  const extraTop = overrides.extraTop || 0;
  const extraBottom = overrides.extraBottom || 0;
  const extraLeft = overrides.extraLeft || 0;
  const extraRight = overrides.extraRight || 0;

  const margin = {
    top: Math.max(5, baseMargin.top + extraTop + (isHLegend && legendPosition === 'top' ? legendHeight : 0)),
    right: Math.max(5, baseMargin.right + extraRight + (isVLegend && legendPosition === 'right' ? legendWidth : 0)),
    bottom: Math.max(5, baseMargin.bottom + extraBottom + (xAxisTitle ? 20 : 0) + (isHLegend && legendPosition === 'bottom' ? legendHeight : 0)),
    left: Math.max(5, baseMargin.left + extraLeft + (isVLegend && legendPosition === 'left' ? legendWidth : 0) + (yAxisTitle ? 20 : 0)),
  };

  const containerRect = container.getBoundingClientRect();
  const width = (options.width || containerRect.width || 400) - margin.left - margin.right;
  const height = (options.height || containerRect.height || 300) - margin.top - margin.bottom;

  return {
    showLegend, legendPosition, xAxisTitle, yAxisTitle,
    showGrid, showLabels, animate, fieldFormats, columnAliases,
    colors, sharedColorScale, formatValue, getDisplayName, getTextColor,
    margin, width, height,
  };
};

export const parseChartConfig = (data, config) => {
  const processedData = processData(data, config);
  const mode = getChartMode(config);
  const categoryField = config.x_axis;
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const clusterField = config.marks?.cluster || config.clusterField;
  const tooltipFields = config.marks?.tooltip || [];
  return { processedData, mode, categoryField, seriesFields, colorField, clusterField, tooltipFields };
};

export const createChartScaffold = (container, width, height, margin) => {
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
  return { svg, g, chartArea, gridGroup, barsGroup, labelsGroup, xAxisGroup, yAxisGroup };
};

export const initFocusState = (getBarsGroup) => {
  const focusState = { focused: null, updateFn: null };
  focusState.updateFn = () => {
    getBarsGroup().selectAll('.bar').transition().duration(200)
      .style('opacity', d => !focusState.focused ? 1 : d._seriesName === focusState.focused ? 1 : STYLES.bar.dimmedOpacity);
  };
  return focusState;
};

export const resolveGroupKeys = (processedData, config, seriesFields, clusterField) => {
  let groupKeys, useClusterField = false;
  if (clusterField) { groupKeys = getUniqueValues(processedData, clusterField); useClusterField = true; }
  else if (seriesFields.length > 0) { groupKeys = seriesFields; }
  else { groupKeys = ['value']; }
  return { groupKeys, useClusterField };
};

export const computeClusteredAggData = (processedData, config, seriesFields, categoryField, clusterField) => {
  const mf = seriesFields[0] || 'value';
  const aggType = getFieldAggregation(config, mf) || 'sum';
  const aggFn = getAggregationFunction(aggType, mf);
  return d3.rollup(processedData, v => aggFn(v) || 0, d => getRowValue(d, categoryField), d => getRowValue(d, clusterField));
};

export const computeClusteredMaxVal = (processedData, config, seriesFields, categoryField, clusterField, groupKeys, useClusterField, opts = {}) => {
  const { absolute = false } = opts;
  const wrap = absolute ? Math.abs : (v => v);
  if (useClusterField) {
    const mf = seriesFields[0] || 'value';
    const aggType = getFieldAggregation(config, mf) || 'sum';
    const aggFn = getAggregationFunction(aggType, mf);
    const agg = d3.rollup(processedData, v => wrap(aggFn(v) || 0), d => getRowValue(d, categoryField), d => getRowValue(d, clusterField));
    return d3.max(Array.from(agg.values()), m => d3.max(Array.from(m.values()))) || 0;
  }
  return d3.max(processedData, d => d3.max(groupKeys, key => wrap(getRowValue(d, key) || 0))) || 0;
};

export const buildStackData = (processedData, categories, categoryField, colorField, seriesFields, categoryKey) => {
  const stackKeys = colorField ? getUniqueValues(processedData, colorField) : seriesFields;
  if (stackKeys.length === 0) return { stackKeys, stackData: [], stackedData: null };

  const grouped = d3.group(processedData, d => getRowValue(d, categoryField));
  const stackData = categories.map(catVal => {
    const group = grouped.get(catVal) || [];
    const obj = { [categoryKey]: catVal };
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

  return { stackKeys, stackData };
};

export const applyStackedBarHandlers = (bars, tooltip, formatTooltip, categoryField, categoryKey, focusState) => {
  bars.on('mouseover', function(event, d) {
      d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
      tooltip.html(formatTooltip({ ...d.data, [categoryField]: d[categoryKey] || d._xCategory || d._yCategory }, d.key, d.data[d.key]))
        .style('visibility', 'visible').style('opacity', '1');
    })
    .on('mousemove', function(event) { tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`); })
    .on('mouseout', function() {
      d3.select(this).attr('opacity', focusState.focused && this.__data__._seriesName !== focusState.focused ? STYLES.bar.dimmedOpacity : 1);
      tooltip.style('visibility', 'hidden').style('opacity', '0');
    })
    .on('click', function(event, d) { event.stopPropagation(); focusState.focused = focusState.focused === d.key ? null : d.key; focusState.updateFn(); });
};

export const finalizeChart = (ctx) => {
  const {
    svg, g, scales, showLegend, legendPosition, width, height, margin,
    getDisplayName, xAxisTitle, yAxisTitle, focusState, tooltip,
    createChartFn, container, config, data, options,
  } = ctx;

  if (scales?.colorScale) {
    addLegend(svg, scales.colorScale, {
      showLegend, legendPosition, width, height, margin, getDisplayName,
      onItemClick: (item) => { focusState.focused = focusState.focused === item ? null : item; focusState.updateFn(); }
    });
  }

  renderAxisTitles(g, xAxisTitle, yAxisTitle, width, height);
  svg.on('click', () => { if (focusState.focused) { focusState.focused = null; focusState.updateFn(); } });

  return {
    update: (nc, nd) => createChartFn(container, nc || config, nd || data, options),
    destroy: () => { tooltip.remove(); d3.select(container).selectAll('*').remove(); },
    getFocusedSeries: () => focusState.focused,
    setFocusedSeries: (n) => { focusState.focused = n; focusState.updateFn(); },
    resetZoom: () => svg.transition().duration(300).call(d3.zoom().transform, d3.zoomIdentity),
  };
};

export const createTrellisChart = (container, config, data, options, createSingleChart, trellisOpts = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const trellisField = config.marks?.detail;
  if (!trellisField) return createSingleChart(container, config, data, options);

  const trellisValues = getUniqueValues(data, trellisField);
  const onTrellisFocus = options.onTrellisFocus;
  const defaultColors = options.colors || DEFAULT_COLORS;
  const sharedColorScale = buildSharedColorScale(data, config, defaultColors);

  const wrapper = createTrellisWrapper(container);
  if (trellisOpts.gridColumns) wrapper.style('grid-template-columns', trellisOpts.gridColumns);
  const charts = [];

  const panelWidth = trellisOpts.panelWidth || 280;
  const panelHeight = trellisOpts.panelHeight || 200;
  const panelMargin = trellisOpts.panelMargin || { top: 15, right: 20, bottom: 30, left: 70 };

  trellisValues.forEach(trellisVal => {
    const trellisData = data.filter(d => d[trellisField] === trellisVal);
    const chartArea = createTrellisPanel(wrapper, trellisVal, onTrellisFocus);
    const trellisConfig = { ...config, marks: { ...config.marks, detail: undefined } };
    const chart = createSingleChart(chartArea.node(), trellisConfig, trellisData, {
      ...options, width: panelWidth, height: panelHeight,
      margin: panelMargin, showLegend: false, sharedColorScale,
    });
    charts.push(chart);
  });

  const updateAllChartsFocus = createTrellisFocusUpdater(container);
  buildTrellisLegend(container, data, config, options, sharedColorScale, updateAllChartsFocus);

  return {
    update: (nc, nd) => createTrellisChart(container, nc || config, nd || data, options, createSingleChart, trellisOpts),
    destroy: () => { charts.forEach(c => c.destroy()); d3.select(container).selectAll('*').remove(); },
  };
};
