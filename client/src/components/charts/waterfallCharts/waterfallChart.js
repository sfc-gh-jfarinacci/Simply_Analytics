import * as d3 from 'd3';

const DEFAULT_COLORS = [
  '#6366f1', '#f472b6', '#38bdf8', '#34d399', '#fbbf24',
  '#fb923c', '#a78bfa', '#2dd4bf', '#f87171', '#818cf8',
  '#4ade80', '#f9a8d4', '#67e8f9', '#fcd34d', '#c084fc',
  '#86efac', '#fda4af', '#7dd3fc',
];

const STYLES = {
  axis: { textColor: '#94a3b8', lineColor: 'rgba(148, 163, 184, 0.15)', fontSize: '11px' },
  grid: { lineColor: 'rgba(148, 163, 184, 0.1)' },
  tooltip: {
    background: 'rgba(15, 23, 42, 0.92)', border: '1px solid rgba(148, 163, 184, 0.15)',
    borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#e2e8f0',
    shadow: '0 4px 16px rgba(0,0,0,0.2)',
  },
  bar: { borderRadius: 2, hoverOpacity: 0.8 },
  label: { color: '#a0a0b0', fontFamily: 'system-ui, -apple-system, sans-serif' },
};

const WATERFALL_COLORS = {
  increase: '#22c55e',
  decrease: '#ef4444',
  total: '#6366f1',
  connector: 'rgba(100, 100, 120, 0.3)',
};

const getRowValue = (row, key) => {
  if (!row || key == null) return undefined;
  const keyStr = String(key);
  if (row[keyStr] !== undefined) return row[keyStr];
  const keyUpper = keyStr.toUpperCase();
  const match = Object.keys(row).find(k => k.toUpperCase() === keyUpper);
  return match ? row[match] : undefined;
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

const createTooltip = () => d3.select(document.body).append('div').attr('class', 'chart-tooltip')
  .style('position', 'fixed').style('visibility', 'hidden')
  .style('background', STYLES.tooltip.background).style('border', STYLES.tooltip.border)
  .style('border-radius', STYLES.tooltip.borderRadius).style('padding', STYLES.tooltip.padding)
  .style('font-size', STYLES.tooltip.fontSize).style('color', STYLES.tooltip.color)
  .style('pointer-events', 'none').style('z-index', '99999')
  .style('box-shadow', STYLES.tooltip.shadow)
  .style('backdrop-filter', 'blur(8px)').style('-webkit-backdrop-filter', 'blur(8px)')
  .style('transition', 'opacity 0.15s ease, visibility 0.15s ease').style('opacity', '0');

const truncateLabel = (label, maxLen) => {
  const str = label == null ? '' : String(label);
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
};

export const createWaterfallChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  let {
    showLegend = true,
    legendPosition = 'top',
    xAxisTitle = '',
    yAxisTitle = '',
    showGrid = true,
    showLabels = true,
    animate = true,
    fieldFormats = {},
    columnAliases = {},
    colors = DEFAULT_COLORS,
    showTotal = true,
    totalLabel = 'Total',
    increaseColor = WATERFALL_COLORS.increase,
    decreaseColor = WATERFALL_COLORS.decrease,
    totalColor = WATERFALL_COLORS.total,
    margin: baseMargin = { top: 20, right: 20, bottom: 50, left: 60 },
  } = options;

  const formatValue = createValueFormatter(fieldFormats);
  const getDisplayName = createDisplayNameGetter(columnAliases);

  const containerRect = container.getBoundingClientRect();
  const totalW = options.width || containerRect.width || 400;
  const totalH = options.height || containerRect.height || 300;

  const isCompact = totalW < 250 || totalH < 180;
  const isTiny = totalW < 160 || totalH < 120;
  if (isTiny) {
    showLegend = false;
    xAxisTitle = '';
    yAxisTitle = '';
    showLabels = false;
    showGrid = false;
    baseMargin = { top: 4, right: 4, bottom: 20, left: 30 };
  } else if (isCompact) {
    showLegend = false;
    xAxisTitle = '';
    yAxisTitle = '';
    baseMargin = {
      top: Math.min(baseMargin.top, 10),
      right: Math.min(baseMargin.right, 10),
      bottom: Math.min(baseMargin.bottom, 30),
      left: Math.min(baseMargin.left, 40),
    };
  }

  const legendHeight = showLegend ? 26 : 0;

  const margin = {
    top: baseMargin.top + (legendPosition === 'top' ? legendHeight : 0),
    right: baseMargin.right,
    bottom: baseMargin.bottom + (xAxisTitle ? 20 : 0) + (legendPosition === 'bottom' ? legendHeight : 0),
    left: baseMargin.left + (yAxisTitle ? 20 : 0),
  };

  const width = totalW - margin.left - margin.right;
  const height = totalH - margin.top - margin.bottom;

  const categoryField = config.x_axis || config.categoryField;
  const measureField = (config.series || [])[0] || 'value';

  if (!categoryField) return { update: () => {}, destroy: () => {} };

  const aggMap = new Map();
  const order = [];
  for (const row of data) {
    const cat = String(getRowValue(row, categoryField) ?? '');
    const val = Number(getRowValue(row, measureField)) || 0;
    if (!cat) continue;
    if (!aggMap.has(cat)) { aggMap.set(cat, 0); order.push(cat); }
    aggMap.set(cat, aggMap.get(cat) + val);
  }

  const steps = [];
  let running = 0;
  for (const cat of order) {
    const val = aggMap.get(cat);
    steps.push({ category: cat, value: val, start: running, end: running + val, type: val >= 0 ? 'increase' : 'decrease' });
    running += val;
  }

  if (showTotal) {
    steps.push({ category: totalLabel, value: running, start: 0, end: running, type: 'total' });
  }

  if (steps.length === 0) return { update: () => {}, destroy: () => {} };

  d3.select(container).selectAll('*').remove();
  const tooltip = createTooltip();

  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .style('overflow', 'visible');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3.scaleBand().domain(steps.map(s => s.category)).range([0, width]).padding(0.3);

  const allValues = steps.flatMap(s => [s.start, s.end]);
  const yMin = Math.min(0, d3.min(allValues));
  const yMax = d3.max(allValues);
  const yScale = d3.scaleLinear().domain([yMin, yMax * 1.1]).nice().range([height, 0]);

  if (showGrid) {
    g.append('g').attr('class', 'grid-group').selectAll('.grid-line').data(yScale.ticks(5)).enter()
      .append('line').attr('x1', 0).attr('x2', width)
      .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
      .style('stroke', STYLES.grid.lineColor);
  }

  const getColor = (d) => d.type === 'total' ? totalColor : d.type === 'increase' ? increaseColor : decreaseColor;

  const bars = g.selectAll('.waterfall-bar').data(steps).enter().append('rect')
    .attr('class', 'waterfall-bar')
    .attr('x', d => xScale(d.category))
    .attr('width', xScale.bandwidth())
    .attr('rx', STYLES.bar.borderRadius)
    .attr('fill', getColor)
    .style('cursor', 'pointer');

  if (animate) {
    bars
      .attr('y', d => yScale(Math.max(d.start, d.end)))
      .attr('height', 0)
      .transition().duration(500).delay((d, i) => i * 60).ease(d3.easeCubicOut)
      .attr('y', d => yScale(Math.max(d.start, d.end)))
      .attr('height', d => Math.abs(yScale(d.start) - yScale(d.end)) || 1);
  } else {
    bars
      .attr('y', d => yScale(Math.max(d.start, d.end)))
      .attr('height', d => Math.abs(yScale(d.start) - yScale(d.end)) || 1);
  }

  g.selectAll('.connector').data(steps.slice(0, -1)).enter().append('line')
    .attr('class', 'connector')
    .attr('x1', d => xScale(d.category) + xScale.bandwidth())
    .attr('x2', (d, i) => xScale(steps[i + 1].category))
    .attr('y1', d => yScale(d.end))
    .attr('y2', d => yScale(d.end))
    .style('stroke', WATERFALL_COLORS.connector)
    .style('stroke-width', 1)
    .style('stroke-dasharray', '3,3');

  if (showLabels) {
    g.selectAll('.bar-label').data(steps).enter().append('text')
      .attr('class', 'bar-label')
      .attr('x', d => xScale(d.category) + xScale.bandwidth() / 2)
      .attr('y', d => d.value >= 0 ? yScale(d.end) - 5 : yScale(d.end) + 14)
      .attr('text-anchor', 'middle')
      .style('font-size', '10px').style('font-weight', '600')
      .style('fill', d => getColor(d))
      .style('pointer-events', 'none')
      .text(d => formatValue(d.value, measureField));
  }

  bars
    .on('mouseover', function(event, d) {
      d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
      let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">${getDisplayName(d.category)}</div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Change:</span><span style="font-weight:600;margin-left:auto;color:${getColor(d)};">${d.value >= 0 ? '+' : ''}${formatValue(d.value, measureField)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Running:</span><span style="font-weight:600;margin-left:auto;">${formatValue(d.end, measureField)}</span></div>`;
      tooltip.html(html).style('visibility', 'visible').style('opacity', '1');
    })
    .on('mousemove', (event) => { tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`); })
    .on('mouseout', function() {
      d3.select(this).attr('opacity', 1);
      tooltip.style('visibility', 'hidden').style('opacity', '0');
    });

  const tickCount = steps.length;
  const maxLabels = Math.floor(width / 50);
  const showEveryNth = Math.ceil(tickCount / maxLabels);

  const xAxisGroup = g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`);
  xAxisGroup.call(d3.axisBottom(xScale)).selectAll('text')
    .style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize)
    .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0)
    .attr('transform', tickCount > 8 ? 'rotate(-45)' : null)
    .style('text-anchor', tickCount > 8 ? 'end' : 'middle')
    .text(d => truncateLabel(d, 14));
  xAxisGroup.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor);

  const yAxisGroup = g.append('g').attr('class', 'y-axis');
  const smartFmt = (v) => {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e9) return d3.format('.3s')(v).replace('G', 'B');
    if (a >= 1e6) return d3.format('.3s')(v).replace('G', 'B');
    if (a >= 1e3) return d3.format(',.0f')(v);
    if (Number.isInteger(v)) return d3.format(',')(v);
    return d3.format(',.2f')(v);
  };

  yAxisGroup.call(d3.axisLeft(yScale).ticks(5).tickFormat(smartFmt))
    .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
  yAxisGroup.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor);

  if (xAxisTitle) {
    g.append('text').attr('class', 'axis-title').attr('x', width / 2).attr('y', height + 38)
      .attr('text-anchor', 'middle').style('font-size', '12px').style('font-weight', '500')
      .style('fill', STYLES.axis.textColor).style('font-family', STYLES.label.fontFamily).text(xAxisTitle);
  }
  if (yAxisTitle) {
    g.append('text').attr('class', 'axis-title').attr('transform', 'rotate(-90)')
      .attr('x', -height / 2).attr('y', -40).attr('text-anchor', 'middle')
      .style('font-size', '12px').style('font-weight', '500')
      .style('fill', STYLES.axis.textColor).style('font-family', STYLES.label.fontFamily).text(yAxisTitle);
  }

  if (showLegend) {
    const legendItems = [
      { label: 'Increase', color: increaseColor },
      { label: 'Decrease', color: decreaseColor },
      ...(showTotal ? [{ label: 'Total', color: totalColor }] : []),
    ];
    const ly = legendPosition === 'top' ? 6 : margin.top + height + margin.bottom - 18;
    const legend = svg.append('g').attr('class', 'legend').attr('transform', `translate(${margin.left}, ${ly})`);
    let lx = 0;
    legendItems.forEach(item => {
      const ig = legend.append('g').attr('transform', `translate(${lx}, 0)`);
      ig.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', item.color);
      ig.append('text').attr('x', 14).attr('y', 9).style('font-size', '11px').style('fill', '#b0b0b8')
        .style('font-family', STYLES.label.fontFamily).text(item.label);
      lx += item.label.length * 7 + 28;
    });
  }

  return {
    update: (nc, nd) => createWaterfallChart(container, nc || config, nd || data, options),
    destroy: () => { tooltip.remove(); d3.select(container).selectAll('*').remove(); },
  };
};
