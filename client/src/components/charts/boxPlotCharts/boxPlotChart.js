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
  box: { fillOpacity: 0.6, strokeWidth: 1.5, medianStroke: 2, whiskerStroke: 1, outlierRadius: 3, hoverOpacity: 0.85 },
  label: { color: '#a0a0b0', fontFamily: 'system-ui, -apple-system, sans-serif' },
};

const getRowValue = (row, key) => {
  if (!row || key == null) return undefined;
  const keyStr = String(key);
  if (row[keyStr] !== undefined) return row[keyStr];
  const keyUpper = keyStr.toUpperCase();
  const match = Object.keys(row).find(k => k.toUpperCase() === keyUpper);
  if (match) return row[match];
  const keyNorm = keyUpper.replace(/_/g, '');
  const matchNorm = Object.keys(row).find(k => k.toUpperCase().replace(/_/g, '') === keyNorm);
  return matchNorm ? row[matchNorm] : undefined;
};

const toPrimitive = (v) => {
  if (v == null || typeof v !== 'object') return v;
  if (v.name != null) return v.name;
  if (v.value != null) return v.value;
  if (v.label != null) return v.label;
  const vals = Object.values(v).filter(x => x != null && typeof x !== 'object');
  return vals.length > 0 ? vals[0] : String(v);
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

const computeBoxStats = (values) => {
  const sorted = values.slice().sort(d3.ascending);
  const q1 = d3.quantile(sorted, 0.25);
  const median = d3.quantile(sorted, 0.5);
  const q3 = d3.quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const whiskerLow = d3.min(sorted.filter(v => v >= lowerFence));
  const whiskerHigh = d3.max(sorted.filter(v => v <= upperFence));
  const outliers = sorted.filter(v => v < lowerFence || v > upperFence);
  const mean = d3.mean(sorted);
  return { q1, median, q3, iqr, whiskerLow, whiskerHigh, outliers, mean, min: sorted[0], max: sorted[sorted.length - 1], count: sorted.length };
};

export const createBoxPlotChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  let {
    showLegend = false,
    legendPosition = 'right',
    xAxisTitle = '',
    yAxisTitle = '',
    showGrid = true,
    showLabels = false,
    animate = true,
    fieldFormats = {},
    columnAliases = {},
    colors = DEFAULT_COLORS,
    showOutliers = true,
    showMean = true,
    margin: baseMargin = { top: 20, right: 20, bottom: 50, left: 55 },
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

  const margin = {
    top: baseMargin.top,
    right: baseMargin.right,
    bottom: baseMargin.bottom + (xAxisTitle ? 20 : 0),
    left: baseMargin.left + (yAxisTitle ? 20 : 0),
  };

  const width = totalW - margin.left - margin.right;
  const height = totalH - margin.top - margin.bottom;

  const categoryField = config.x_axis || config.categoryField;
  const measureField = (config.series || [])[0] || config.yField || 'value';

  if (!measureField) return { update: () => {}, destroy: () => {} };

  const grouped = new Map();
  const order = [];
  for (const row of data) {
    const cat = categoryField ? String(toPrimitive(getRowValue(row, categoryField)) ?? 'All') : 'All';
    const val = Number(getRowValue(row, measureField));
    if (isNaN(val)) continue;
    if (!grouped.has(cat)) { grouped.set(cat, []); order.push(cat); }
    grouped.get(cat).push(val);
  }

  if (order.length === 0) return { update: () => {}, destroy: () => {} };

  const boxes = order.map(cat => ({ category: cat, stats: computeBoxStats(grouped.get(cat)) }));

  d3.select(container).selectAll('*').remove();
  const tooltip = createTooltip();

  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .style('overflow', 'visible');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3.scaleBand().domain(order).range([0, width]).padding(0.3);
  const boxWidth = Math.min(xScale.bandwidth(), 60);

  const allVals = boxes.flatMap(b => [b.stats.whiskerLow, b.stats.whiskerHigh, ...b.stats.outliers]);
  const yMin = d3.min(allVals);
  const yMax = d3.max(allVals);
  const yPad = (yMax - yMin) * 0.1 || 1;
  const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).nice().range([height, 0]);

  const colorScale = d3.scaleOrdinal().domain(order).range(colors);

  if (showGrid) {
    g.append('g').attr('class', 'grid-group').selectAll('.grid-line').data(yScale.ticks(5)).enter()
      .append('line').attr('x1', 0).attr('x2', width)
      .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
      .style('stroke', STYLES.grid.lineColor);
  }

  const boxGroups = g.selectAll('.box-group').data(boxes).enter().append('g')
    .attr('class', 'box-group')
    .attr('transform', d => `translate(${xScale(d.category) + xScale.bandwidth() / 2}, 0)`);

  boxGroups.append('line').attr('class', 'whisker-line')
    .attr('x1', 0).attr('x2', 0)
    .style('stroke', (d) => colorScale(d.category)).style('stroke-width', STYLES.box.whiskerStroke)
    .style('stroke-dasharray', '3,3');

  boxGroups.append('line').attr('class', 'whisker-cap-low')
    .attr('x1', -boxWidth / 4).attr('x2', boxWidth / 4)
    .style('stroke', (d) => colorScale(d.category)).style('stroke-width', STYLES.box.whiskerStroke);

  boxGroups.append('line').attr('class', 'whisker-cap-high')
    .attr('x1', -boxWidth / 4).attr('x2', boxWidth / 4)
    .style('stroke', (d) => colorScale(d.category)).style('stroke-width', STYLES.box.whiskerStroke);

  boxGroups.append('rect').attr('class', 'box-rect')
    .attr('x', -boxWidth / 2)
    .attr('width', boxWidth)
    .attr('rx', 3)
    .attr('fill', (d) => colorScale(d.category))
    .attr('fill-opacity', STYLES.box.fillOpacity)
    .attr('stroke', (d) => colorScale(d.category))
    .attr('stroke-width', STYLES.box.strokeWidth)
    .style('cursor', 'pointer');

  boxGroups.append('line').attr('class', 'median-line')
    .attr('x1', -boxWidth / 2).attr('x2', boxWidth / 2)
    .style('stroke', '#fff').style('stroke-width', STYLES.box.medianStroke);

  if (showMean) {
    boxGroups.append('circle').attr('class', 'mean-dot')
      .attr('cx', 0).attr('r', 3)
      .attr('fill', '#fff').attr('stroke', (d) => colorScale(d.category)).attr('stroke-width', 1);
  }

  if (animate) {
    boxGroups.selectAll('.whisker-line')
      .attr('y1', d => yScale(d.stats.median)).attr('y2', d => yScale(d.stats.median))
      .transition().duration(500).ease(d3.easeCubicOut)
      .attr('y1', d => yScale(d.stats.whiskerHigh)).attr('y2', d => yScale(d.stats.whiskerLow));

    boxGroups.selectAll('.whisker-cap-low')
      .attr('y1', d => yScale(d.stats.median)).attr('y2', d => yScale(d.stats.median))
      .transition().duration(500).ease(d3.easeCubicOut)
      .attr('y1', d => yScale(d.stats.whiskerLow)).attr('y2', d => yScale(d.stats.whiskerLow));

    boxGroups.selectAll('.whisker-cap-high')
      .attr('y1', d => yScale(d.stats.median)).attr('y2', d => yScale(d.stats.median))
      .transition().duration(500).ease(d3.easeCubicOut)
      .attr('y1', d => yScale(d.stats.whiskerHigh)).attr('y2', d => yScale(d.stats.whiskerHigh));

    boxGroups.selectAll('.box-rect')
      .attr('y', d => yScale(d.stats.median)).attr('height', 0)
      .transition().duration(500).ease(d3.easeCubicOut)
      .attr('y', d => yScale(d.stats.q3))
      .attr('height', d => Math.max(1, yScale(d.stats.q1) - yScale(d.stats.q3)));

    boxGroups.selectAll('.median-line')
      .attr('y1', d => yScale(d.stats.median)).attr('y2', d => yScale(d.stats.median));

    if (showMean) {
      boxGroups.selectAll('.mean-dot')
        .attr('cy', d => yScale(d.stats.median))
        .transition().duration(500).ease(d3.easeCubicOut)
        .attr('cy', d => yScale(d.stats.mean));
    }
  } else {
    boxGroups.selectAll('.whisker-line')
      .attr('y1', d => yScale(d.stats.whiskerHigh)).attr('y2', d => yScale(d.stats.whiskerLow));
    boxGroups.selectAll('.whisker-cap-low')
      .attr('y1', d => yScale(d.stats.whiskerLow)).attr('y2', d => yScale(d.stats.whiskerLow));
    boxGroups.selectAll('.whisker-cap-high')
      .attr('y1', d => yScale(d.stats.whiskerHigh)).attr('y2', d => yScale(d.stats.whiskerHigh));
    boxGroups.selectAll('.box-rect')
      .attr('y', d => yScale(d.stats.q3))
      .attr('height', d => Math.max(1, yScale(d.stats.q1) - yScale(d.stats.q3)));
    boxGroups.selectAll('.median-line')
      .attr('y1', d => yScale(d.stats.median)).attr('y2', d => yScale(d.stats.median));
    if (showMean) {
      boxGroups.selectAll('.mean-dot').attr('cy', d => yScale(d.stats.mean));
    }
  }

  if (showOutliers) {
    boxGroups.each(function(d) {
      const group = d3.select(this);
      d.stats.outliers.forEach(val => {
        group.append('circle').attr('class', 'outlier')
          .attr('cx', (Math.random() - 0.5) * boxWidth * 0.3)
          .attr('cy', yScale(val))
          .attr('r', STYLES.box.outlierRadius)
          .attr('fill', 'none')
          .attr('stroke', colorScale(d.category))
          .attr('stroke-width', 1)
          .style('opacity', 0.6);
      });
    });
  }

  boxGroups.selectAll('.box-rect')
    .on('mouseover', function(event, d) {
      d3.select(this).attr('fill-opacity', STYLES.box.hoverOpacity);
      const s = d.stats;
      let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">`;
      html += `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${colorScale(d.category)};margin-right:6px;"></span>`;
      html += `${getDisplayName(d.category)}</div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Median:</span><span style="font-weight:600;margin-left:auto;">${formatValue(s.median, measureField)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Q1:</span><span style="font-weight:600;margin-left:auto;">${formatValue(s.q1, measureField)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Q3:</span><span style="font-weight:600;margin-left:auto;">${formatValue(s.q3, measureField)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">IQR:</span><span style="font-weight:600;margin-left:auto;">${formatValue(s.iqr, measureField)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Mean:</span><span style="font-weight:600;margin-left:auto;">${formatValue(s.mean, measureField)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Min:</span><span style="font-weight:600;margin-left:auto;">${formatValue(s.whiskerLow, measureField)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Max:</span><span style="font-weight:600;margin-left:auto;">${formatValue(s.whiskerHigh, measureField)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">n:</span><span style="font-weight:600;margin-left:auto;">${s.count}</span></div>`;
      if (s.outliers.length > 0) {
        html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Outliers:</span><span style="font-weight:600;margin-left:auto;">${s.outliers.length}</span></div>`;
      }
      tooltip.html(html).style('visibility', 'visible').style('opacity', '1');
    })
    .on('mousemove', (event) => { tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`); })
    .on('mouseout', function() {
      d3.select(this).attr('fill-opacity', STYLES.box.fillOpacity);
      tooltip.style('visibility', 'hidden').style('opacity', '0');
    });

  const tickCount = order.length;
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
  if (isTiny) {
    xAxisGroup.selectAll('text').style('opacity', 0);
  }

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
  if (isTiny) {
    yAxisGroup.selectAll('text').style('opacity', 0);
  }

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

  return {
    update: (nc, nd) => createBoxPlotChart(container, nc || config, nd || data, options),
    destroy: () => { tooltip.remove(); d3.select(container).selectAll('*').remove(); },
  };
};
