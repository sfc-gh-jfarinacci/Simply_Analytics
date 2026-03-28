/**
 * D3.js Pie / Donut / Radial Bar Chart
 *
 * Modes (controlled by `options.variant`):
 *  - "pie"    — filled pie
 *  - "donut"  — pie with a centre hole
 *  - "radial" — radial/polar bar chart (bars extend outward from centre)
 *
 * Data mapping (same as bar charts):
 *  - x_axis   → category field (slice labels)
 *  - series   → measure field(s) to aggregate
 *  - color    → optional color-split field
 *
 * Features:
 *  - Click-to-focus on a slice/bar
 *  - Hover tooltip
 *  - Legend with pagination
 *  - Animated entrance
 *  - Trellis (small multiples) via detail mark
 */

import * as d3 from 'd3';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_COLORS = [
  '#6366f1', '#f472b6', '#38bdf8', '#34d399', '#fbbf24',
  '#fb923c', '#a78bfa', '#2dd4bf', '#f87171', '#818cf8',
  '#4ade80', '#f9a8d4', '#67e8f9', '#fcd34d', '#c084fc',
  '#86efac', '#fda4af', '#7dd3fc',
];

const STYLES = {
  tooltip: {
    background: 'rgba(15, 23, 42, 0.92)',
    border: '1px solid rgba(148, 163, 184, 0.15)',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '12px',
    color: '#e2e8f0',
    shadow: '0 4px 16px rgba(0,0,0,0.2)',
  },
  label: {
    color: '#a0a0b0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
  },
  slice: {
    hoverOpacity: 0.85,
    dimmedOpacity: 0.2,
    stroke: 'rgba(20, 20, 30, 0.6)',
    strokeWidth: 1.5,
  },
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

const truncateLabel = (label, maxLen) => {
  const safe = toPrimitive(label);
  const str = safe == null ? '' : String(safe);
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
};

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
  if (fieldName == null) return '';
  const str = String(fieldName);
  const k = Object.keys(columnAliases).find(k => k.toUpperCase() === str.toUpperCase());
  return (k && columnAliases[k]) || str;
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

// ============================================================================
// LEGEND
// ============================================================================

const addLegend = (svg, colorScale, options) => {
  const { showLegend, legendPosition, width, height, margin, getDisplayName, onItemClick } = options;
  if (!showLegend) return;
  const items = colorScale.domain();
  if (items.length === 0) return;
  const isH = legendPosition === 'top' || legendPosition === 'bottom';
  const sw = 10, ih = 18, ig = isH ? 16 : 6;
  const legend = svg.append('g').attr('class', 'legend');

  const tempText = svg.append('text').style('font-size', '11px').style('visibility', 'hidden');
  const itemWidths = items.map(item => { tempText.text(truncateLabel(item, 12)); return tempText.node().getComputedTextLength() + sw + 6; });
  tempText.remove();

  let lx, ly;
  switch (legendPosition) {
    case 'top': lx = margin.left; ly = 6; break;
    case 'bottom': lx = margin.left; ly = margin.top + height + margin.bottom - 20; break;
    case 'left': lx = 8; ly = margin.top; break;
    case 'right': default: lx = margin.left + width + 10; ly = margin.top;
  }
  legend.attr('transform', `translate(${lx}, ${ly})`);

  const totalW = itemWidths.reduce((s, w) => s + w + ig, 0) - ig;
  let currentPage = 0, pages = [items], needsPag = false;

  if (isH && totalW > width - 40) {
    needsPag = true; pages = [];
    let page = [], pw = 0;
    items.forEach((item, i) => {
      const iw = itemWidths[i] + ig;
      if (pw + iw > width - 40 && page.length > 0) { pages.push(page); page = [item]; pw = iw; }
      else { page.push(item); pw += iw; }
    });
    if (page.length > 0) pages.push(page);
  } else if (!isH && items.length * ih > height) {
    needsPag = true;
    const mx = Math.max(1, Math.floor(height / ih));
    pages = [];
    for (let i = 0; i < items.length; i += mx) pages.push(items.slice(i, i + mx));
  }

  const itemsGroup = legend.append('g');
  let prevNav, nextNav;

  const renderPage = () => {
    itemsGroup.selectAll('*').remove();
    const pg = pages[currentPage] || [];
    let pos = 0;
    pg.forEach((item, i) => {
      const g = itemsGroup.append('g').style('cursor', 'pointer')
        .on('click', (e) => { e.stopPropagation(); onItemClick(item); })
        .on('mouseover', function() { d3.select(this).select('text').style('fill', '#fff'); })
        .on('mouseout', function() { d3.select(this).select('text').style('fill', '#b0b0b8'); });
      if (isH) { g.attr('transform', `translate(${pos}, 0)`); pos += itemWidths[items.indexOf(item)] + ig; }
      else { g.attr('transform', `translate(0, ${i * ih})`); }
      g.append('rect').attr('width', sw).attr('height', sw).attr('rx', 2).attr('fill', colorScale(item));
      g.append('text').attr('x', sw + 4).attr('y', sw - 1).style('font-size', '11px').style('fill', '#b0b0b8')
        .style('font-family', STYLES.label.fontFamily).text(truncateLabel(getDisplayName(item), isH ? 50 : 9));
    });
    if (needsPag && prevNav && nextNav) {
      prevNav.style('opacity', currentPage > 0 ? 1 : 0.3);
      nextNav.style('opacity', currentPage < pages.length - 1 ? 1 : 0.3);
    }
  };

  if (needsPag && pages.length > 1) {
    prevNav = legend.append('g').style('cursor', 'pointer').on('click', () => { if (currentPage > 0) { currentPage--; renderPage(); } });
    nextNav = legend.append('g').style('cursor', 'pointer').on('click', () => { if (currentPage < pages.length - 1) { currentPage++; renderPage(); } });
    if (isH) {
      prevNav.attr('transform', 'translate(-16, 0)').append('text').style('font-size', '12px').style('fill', '#888').text('\u25C2');
      const pw = pages[0].reduce((s, item) => s + itemWidths[items.indexOf(item)] + ig, 0);
      nextNav.attr('transform', `translate(${pw + 4}, 0)`).append('text').style('font-size', '12px').style('fill', '#888').text('\u25B8');
    } else {
      prevNav.attr('transform', 'translate(30, -12)').append('text').attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#888').text('\u25B2');
      nextNav.attr('transform', `translate(30, ${pages[0].length * ih + 4})`).append('text').attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#888').text('\u25BC');
    }
  }
  renderPage();
};

// ============================================================================
// MAIN CHART
// ============================================================================

export const createPieChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  let {
    variant = 'pie',
    showLegend = true,
    legendPosition = 'right',
    showLabels = true,
    animate = true,
    fieldFormats = {},
    columnAliases = {},
    colors = DEFAULT_COLORS,
    sharedColorScale = null,
    margin: baseMargin = { top: 20, right: 20, bottom: 20, left: 20 },
  } = options;

  const formatValue = createValueFormatter(fieldFormats);
  const getDisplayName = createDisplayNameGetter(columnAliases);

  const containerRect = container.getBoundingClientRect();
  const totalW = (options.width || containerRect.width || 400);
  const totalH = (options.height || containerRect.height || 300);

  const isCompact = totalW < 250 || totalH < 180;
  const isTiny = totalW < 160 || totalH < 120;
  if (isCompact) {
    showLegend = false;
    baseMargin = { top: 5, right: 5, bottom: 5, left: 5 };
  }
  if (isTiny) {
    showLabels = false;
  }

  const legendWidth = 100, legendHeight = 26;
  const isVLeg = showLegend && (legendPosition === 'left' || legendPosition === 'right');
  const isHLeg = showLegend && (legendPosition === 'top' || legendPosition === 'bottom');

  const margin = {
    top: Math.max(5, baseMargin.top + (isHLeg && legendPosition === 'top' ? legendHeight : 0)),
    right: Math.max(5, baseMargin.right + (isVLeg && legendPosition === 'right' ? legendWidth : 0)),
    bottom: Math.max(5, baseMargin.bottom + (isHLeg && legendPosition === 'bottom' ? legendHeight : 0)),
    left: Math.max(5, baseMargin.left + (isVLeg && legendPosition === 'left' ? legendWidth : 0)),
  };
  const width = totalW - margin.left - margin.right;
  const height = totalH - margin.top - margin.bottom;
  const radius = Math.min(width, height) / 2;

  // ========================================
  // BUILD SLICE DATA
  // ========================================

  const categoryField = config.x_axis;
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const tooltipFields = config.marks?.tooltip || [];
  const measureField = seriesFields[0] || 'value';
  const aggType = getFieldAggregation(config, measureField) || 'sum';
  const aggFn = getAggregationFunction(aggType, measureField);

  let sliceField = colorField || categoryField;
  if (!sliceField) return { update: () => {}, destroy: () => {} };

  const categories = getUniqueValues(data, sliceField);
  const grouped = d3.group(data, d => toPrimitive(getRowValue(d, sliceField)));

  const sliceData = categories.map(cat => {
    const rows = grouped.get(cat) || [];
    const value = Math.abs(aggFn(rows) || 0);
    return { category: String(cat), value };
  }).filter(d => d.value > 0);

  if (sliceData.length === 0) return { update: () => {}, destroy: () => {} };

  const total = d3.sum(sliceData, d => d.value);
  const colorScale = sharedColorScale || d3.scaleOrdinal().domain(sliceData.map(d => d.category)).range(colors);

  // Focus state
  const focusState = {
    focused: null,
    updateFn: () => {
      chartG.selectAll('.slice, .radial-bar')
        .transition().duration(200)
        .style('opacity', function() {
          if (!focusState.focused) return 1;
          return d3.select(this).attr('data-category') === focusState.focused ? 1 : STYLES.slice.dimmedOpacity;
        });
    }
  };

  // ========================================
  // RENDER
  // ========================================

  d3.select(container).selectAll('*').remove();

  const svg = d3.select(container).append('svg')
    .attr('width', totalW).attr('height', totalH).style('overflow', 'visible');

  const chartG = svg.append('g')
    .attr('transform', `translate(${margin.left + width / 2}, ${margin.top + height / 2})`);

  const tooltip = createTooltip();

  const showTooltip = (event, cat, value) => {
    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
    let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">`;
    html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorScale(cat)};margin-right:6px;"></span>`;
    html += `${getDisplayName(cat)}</div>`;
    html += `<div style="display:flex;gap:8px;margin:3px 0;">`;
    html += `<span style="color:#a0a0b0;">${getDisplayName(measureField)}:</span>`;
    html += `<span style="font-weight:600;margin-left:auto;">${formatValue(value, measureField)}</span></div>`;
    html += `<div style="display:flex;gap:8px;margin:3px 0;">`;
    html += `<span style="color:#a0a0b0;">Share:</span>`;
    html += `<span style="font-weight:600;margin-left:auto;">${pct}%</span></div>`;
    tooltip.html(html).style('visibility', 'visible').style('opacity', '1')
      .style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
  };

  const hideTooltip = () => { tooltip.style('visibility', 'hidden').style('opacity', '0'); };

  // ========================================
  // PIE / DONUT
  // ========================================

  if (variant === 'pie' || variant === 'donut') {
    const innerRadius = variant === 'donut' ? radius * 0.55 : 0;
    const outerRadius = radius * 0.92;

    const pie = d3.pie().value(d => d.value).sort(null).padAngle(0.015);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius).cornerRadius(3);
    const hoverArc = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius + 6).cornerRadius(3);
    const labelArc = d3.arc().innerRadius(outerRadius * 0.7).outerRadius(outerRadius * 0.7);

    const arcs = pie(sliceData);

    const slices = chartG.selectAll('.slice')
      .data(arcs).enter().append('path')
      .attr('class', 'slice')
      .attr('data-category', d => d.data.category)
      .attr('fill', d => colorScale(d.data.category))
      .attr('stroke', STYLES.slice.stroke)
      .attr('stroke-width', STYLES.slice.strokeWidth)
      .style('cursor', 'pointer');

    if (animate) {
      slices.attr('d', d3.arc().innerRadius(innerRadius).outerRadius(innerRadius).cornerRadius(3))
        .transition().duration(700).ease(d3.easeCubicOut)
        .attrTween('d', function(d) {
          const interp = d3.interpolate({ startAngle: d.startAngle, endAngle: d.startAngle }, d);
          return (t) => arc(interp(t));
        });
    } else {
      slices.attr('d', arc);
    }

    slices
      .on('mouseover', function(event, d) {
        d3.select(this).transition().duration(150).attr('d', hoverArc);
        showTooltip(event, d.data.category, d.data.value);
      })
      .on('mousemove', function(event) {
        tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', function(event, d) {
        d3.select(this).transition().duration(150).attr('d', arc);
        hideTooltip();
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        focusState.focused = focusState.focused === d.data.category ? null : d.data.category;
        focusState.updateFn();
      });

    // Slice labels
    if (showLabels && outerRadius > 60) {
      const minAngle = 0.25;
      chartG.selectAll('.slice-label')
        .data(arcs.filter(d => (d.endAngle - d.startAngle) > minAngle))
        .enter().append('text')
        .attr('class', 'slice-label')
        .attr('transform', d => `translate(${labelArc.centroid(d)})`)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .style('font-size', outerRadius < 100 ? '9px' : '11px')
        .style('font-weight', '600')
        .style('fill', '#fff')
        .style('pointer-events', 'none')
        .style('text-shadow', '0 1px 3px rgba(0,0,0,0.5)')
        .text(d => {
          const pct = ((d.data.value / total) * 100).toFixed(0);
          return pct >= 5 ? `${pct}%` : '';
        })
        .style('opacity', 0)
        .transition().delay(animate ? 500 : 0).duration(300).style('opacity', 1);
    }

    // Donut centre label
    if (variant === 'donut' && innerRadius > 30 && !isTiny) {
      chartG.append('text').attr('class', 'donut-total')
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .style('font-size', innerRadius < 50 ? '14px' : '18px')
        .style('font-weight', '700').style('fill', '#e0e0e0')
        .style('font-family', STYLES.label.fontFamily)
        .text(formatValue(total, measureField));
      chartG.append('text')
        .attr('text-anchor', 'middle').attr('y', innerRadius < 50 ? 16 : 20)
        .style('font-size', '10px').style('fill', '#888')
        .style('font-family', STYLES.label.fontFamily)
        .text('Total');
    }
  }

  // ========================================
  // RADIAL BAR
  // ========================================

  if (variant === 'radial') {
    const innerRadius = radius * 0.2;
    const maxOuterRadius = radius * 0.92;
    const maxVal = d3.max(sliceData, d => d.value) || 1;

    const angleScale = d3.scaleBand()
      .domain(sliceData.map(d => d.category))
      .range([0, 2 * Math.PI])
      .padding(0.12);

    const radiusScale = d3.scaleLinear()
      .domain([0, maxVal]).range([innerRadius, maxOuterRadius]);

    const radialArc = d3.arc()
      .innerRadius(innerRadius)
      .startAngle(d => angleScale(d.category))
      .endAngle(d => angleScale(d.category) + angleScale.bandwidth())
      .cornerRadius(3);

    const bars = chartG.selectAll('.radial-bar')
      .data(sliceData).enter().append('path')
      .attr('class', 'radial-bar')
      .attr('data-category', d => d.category)
      .attr('fill', d => colorScale(d.category))
      .attr('stroke', STYLES.slice.stroke)
      .attr('stroke-width', STYLES.slice.strokeWidth)
      .style('cursor', 'pointer');

    if (animate) {
      bars.attr('d', d => radialArc.outerRadius(innerRadius)(d))
        .transition().duration(700).ease(d3.easeCubicOut)
        .attrTween('d', function(d) {
          const interpR = d3.interpolate(innerRadius, radiusScale(d.value));
          return (t) => radialArc.outerRadius(interpR(t))(d);
        });
    } else {
      bars.attr('d', d => radialArc.outerRadius(radiusScale(d.value))(d));
    }

    bars
      .on('mouseover', function(event, d) {
        d3.select(this).transition().duration(150)
          .attr('d', radialArc.outerRadius(radiusScale(d.value) + 4)(d));
        showTooltip(event, d.category, d.value);
      })
      .on('mousemove', function(event) {
        tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', function(event, d) {
        d3.select(this).transition().duration(150)
          .attr('d', radialArc.outerRadius(radiusScale(d.value))(d));
        hideTooltip();
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        focusState.focused = focusState.focused === d.category ? null : d.category;
        focusState.updateFn();
      });

    // Radial grid rings
    const ringTicks = radiusScale.ticks(4);
    chartG.selectAll('.radial-grid').data(ringTicks).enter().append('circle')
      .attr('class', 'radial-grid').attr('r', d => radiusScale(d))
      .style('fill', 'none').style('stroke', 'rgba(100,100,120,0.15)')
      .style('stroke-dasharray', '3,3');

    // Category labels around the outside
    if (showLabels) {
      chartG.selectAll('.radial-label')
        .data(sliceData).enter().append('text')
        .attr('class', 'radial-label')
        .attr('text-anchor', 'middle')
        .attr('transform', d => {
          const angle = angleScale(d.category) + angleScale.bandwidth() / 2;
          const r = maxOuterRadius + 14;
          const x = r * Math.sin(angle);
          const y = -r * Math.cos(angle);
          const rotation = (angle * 180 / Math.PI);
          const flip = rotation > 90 && rotation < 270;
          return `translate(${x},${y}) rotate(${flip ? rotation - 180 : rotation})`;
        })
        .style('font-size', '9px').style('fill', STYLES.label.color)
        .style('font-family', STYLES.label.fontFamily)
        .text(d => truncateLabel(d.category, 12));
    }

    // Ring tick labels
    chartG.selectAll('.ring-label').data(ringTicks).enter().append('text')
      .attr('class', 'ring-label')
      .attr('x', 0).attr('y', d => -radiusScale(d))
      .attr('text-anchor', 'middle').attr('dy', -3)
      .style('font-size', '8px').style('fill', '#888')
      .style('font-family', STYLES.label.fontFamily)
      .text(d => formatValue(d, measureField));
  }

  // ========================================
  // LEGEND
  // ========================================

  addLegend(svg, colorScale, {
    showLegend, legendPosition, width, height, margin, getDisplayName,
    onItemClick: (item) => { focusState.focused = focusState.focused === item ? null : item; focusState.updateFn(); }
  });

  // Click background to clear focus
  svg.on('click', () => { if (focusState.focused) { focusState.focused = null; focusState.updateFn(); } });

  return {
    update: (nc, nd) => createPieChart(container, nc || config, nd || data, options),
    destroy: () => { tooltip.remove(); d3.select(container).selectAll('*').remove(); },
    getFocusedSeries: () => focusState.focused,
    setFocusedSeries: (n) => { focusState.focused = n; focusState.updateFn(); },
  };
};

// ============================================================================
// TRELLIS
// ============================================================================

export const createTrellisPieChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const trellisField = config.marks?.detail;
  if (!trellisField) return createPieChart(container, config, data, options);

  const trellisValues = getUniqueValues(data, trellisField);
  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const colorField = config.marks?.color;
  const categoryField = config.x_axis;
  const defaultColors = options.colors || DEFAULT_COLORS;

  const sliceField = colorField || categoryField;
  let sharedColorDomain = sliceField ? getUniqueValues(data, sliceField) : seriesFields;
  const sharedColorScale = d3.scaleOrdinal().domain(sharedColorDomain).range(defaultColors);

  d3.select(container).selectAll('*').remove();

  const wrapper = d3.select(container).append('div')
    .style('display', 'grid')
    .style('grid-template-columns', 'repeat(auto-fit, minmax(220px, 1fr))')
    .style('gap', '16px').style('width', '100%').style('height', '100%')
    .style('overflow', 'auto').style('padding', '8px');

  const charts = [];

  trellisValues.forEach(trellisVal => {
    const trellisData = data.filter(d => d[trellisField] === trellisVal);

    const cc = wrapper.append('div')
      .style('padding', '8px').style('min-height', '200px')
      .style('background', 'rgba(255, 255, 255, 0.02)')
      .style('border-radius', '8px').style('border', '1px solid rgba(255, 255, 255, 0.06)');

    cc.append('div')
      .style('text-align', 'center').style('margin-bottom', '4px')
      .style('font-weight', '600').style('font-size', '12px').style('color', '#e0e0e0')
      .text(trellisVal);

    const ca = cc.append('div').style('width', '100%').style('height', 'calc(100% - 24px)');

    const chart = createPieChart(ca.node(), { ...config, marks: { ...config.marks, detail: undefined } }, trellisData, {
      ...options, width: 220, height: 200,
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
      showLegend: false, sharedColorScale,
    });

    charts.push(chart);
  });

  // Shared trellis legend
  if (options.showLegend !== false && sharedColorDomain.length > 0) {
    const lp = options.legendPosition || 'top';
    const containerEl = d3.select(container);
    const lc = containerEl.insert('div', lp === 'top' ? ':first-child' : null)
      .style('display', 'flex').style('flex-wrap', 'wrap').style('justify-content', 'center')
      .style('gap', '12px').style('padding', '8px 12px')
      .style('border-' + (lp === 'top' ? 'bottom' : 'top'), '1px solid rgba(255, 255, 255, 0.06)');

    let trFocused = null;
    const updateAllFocus = (s) => {
      trFocused = trFocused === s ? null : s;
      d3.select(container).selectAll('.slice, .radial-bar').each(function() {
        const bar = d3.select(this);
        bar.style('opacity', trFocused === null ? 1 : (bar.attr('data-category') === trFocused ? 1 : 0.15));
      });
    };

    sharedColorDomain.forEach(item => {
      const li = lc.append('div')
        .style('display', 'flex').style('align-items', 'center').style('gap', '6px')
        .style('font-size', '11px').style('color', '#a0a0b0').style('cursor', 'pointer')
        .on('click', () => updateAllFocus(String(item)))
        .on('mouseenter', function() { d3.select(this).style('color', '#e0e0e0'); })
        .on('mouseleave', function() { d3.select(this).style('color', '#a0a0b0'); });
      li.append('div').style('width', '10px').style('height', '10px').style('border-radius', '2px')
        .style('background', sharedColorScale(String(item)));
      li.append('span').text(String(item));
    });
  }

  return {
    update: (nc, nd) => createTrellisPieChart(container, nc || config, nd || data, options),
    destroy: () => { charts.forEach(c => c.destroy()); d3.select(container).selectAll('*').remove(); },
  };
};
