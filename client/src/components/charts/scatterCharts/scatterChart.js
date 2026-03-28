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
  dot: { radius: 5, hoverRadius: 7, dimmedOpacity: 0.15, fillOpacity: 0.7, strokeWidth: 1.5 },
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

const getUniqueValues = (data, field) => {
  if (!field) return [];
  return [...new Set(data.map(d => toPrimitive(getRowValue(d, field))).filter(v => v != null))];
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

export const createScatterChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  let {
    showLegend = true,
    legendPosition = 'right',
    xAxisTitle = '',
    yAxisTitle = '',
    showGrid = true,
    showLabels = false,
    animate = true,
    fieldFormats = {},
    columnAliases = {},
    colors = DEFAULT_COLORS,
    sharedColorScale = null,
    margin: baseMargin = { top: 20, right: 20, bottom: 45, left: 55 },
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

  const legendWidth = 90, legendHeight = 26;
  const isVLegend = showLegend && (legendPosition === 'left' || legendPosition === 'right');
  const isHLegend = showLegend && (legendPosition === 'top' || legendPosition === 'bottom');

  const margin = {
    top: Math.max(5, baseMargin.top + (isHLegend && legendPosition === 'top' ? legendHeight : 0)),
    right: Math.max(5, baseMargin.right + (isVLegend && legendPosition === 'right' ? legendWidth : 0)),
    bottom: Math.max(5, baseMargin.bottom + (xAxisTitle ? 20 : 0) + (isHLegend && legendPosition === 'bottom' ? legendHeight : 0)),
    left: Math.max(5, baseMargin.left + (isVLegend && legendPosition === 'left' ? legendWidth : 0) + (yAxisTitle ? 20 : 0)),
  };

  const width = totalW - margin.left - margin.right;
  const height = totalH - margin.top - margin.bottom;

  const xField = config.xField || config.x_axis;
  const yField = config.yField || (config.series || [])[0];
  const sizeField = config.sizeField || null;
  const colorField = config.marks?.color || config.colorField || null;
  const tooltipFields = config.marks?.tooltip || [];

  if (!xField || !yField) return { update: () => {}, destroy: () => {} };

  // Detect whether X values are numeric or categorical (strings/dates)
  const xRawValues = data.map(row => getRowValue(row, xField)).filter(v => v != null);
  const xIsNumeric = xRawValues.length > 0 && xRawValues.every(v => !isNaN(Number(v)));

  const points = data.map(row => {
    const rawX = getRowValue(row, xField);
    const x = xIsNumeric ? Number(rawX) : String(toPrimitive(rawX) ?? '');
    const y = Number(getRowValue(row, yField));
    if ((xIsNumeric && isNaN(x)) || isNaN(y)) return null;
    if (!xIsNumeric && !x) return null;
    const size = sizeField ? (Number(getRowValue(row, sizeField)) || 0) : null;
    const color = colorField ? String(getRowValue(row, colorField) ?? '') : null;
    return { x, y, size, color, _row: row };
  }).filter(Boolean);

  if (points.length === 0) return { update: () => {}, destroy: () => {} };

  d3.select(container).selectAll('*').remove();
  const tooltip = createTooltip();

  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .style('overflow', 'visible');

  const clipId = `clip-${Math.random().toString(36).substr(2, 9)}`;
  svg.append('defs').append('clipPath').attr('id', clipId).append('rect').attr('width', width).attr('height', height);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const chartArea = g.append('g').attr('clip-path', `url(#${clipId})`);
  const gridGroup = g.append('g').attr('class', 'grid-group');

  // Build X scale: linear for numeric, point for categorical
  let xScale;
  if (xIsNumeric) {
    const xExtent = d3.extent(points, d => d.x);
    const xPad = (xExtent[1] - xExtent[0]) * 0.05 || 1;
    xScale = d3.scaleLinear().domain([xExtent[0] - xPad, xExtent[1] + xPad]).nice().range([0, width]);
  } else {
    const xCategories = [...new Set(points.map(d => d.x))];
    xScale = d3.scalePoint().domain(xCategories).range([0, width]).padding(0.5);
  }

  const yExtent = d3.extent(points, d => d.y);
  const yPad = (yExtent[1] - yExtent[0]) * 0.05 || 1;
  const yScale = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).nice().range([height, 0]);

  let currentXScale = xScale.copy ? xScale.copy() : xScale;
  let currentYScale = yScale.copy();

  const sizeScale = sizeField
    ? d3.scaleSqrt().domain([0, d3.max(points, d => d.size) || 1]).range([3, 20])
    : null;

  const colorDomain = colorField ? getUniqueValues(data, colorField) : [];
  const colorScale = sharedColorScale || d3.scaleOrdinal().domain(colorDomain).range(colors);

  const focusState = {
    focused: null,
    updateFn: () => {
      chartArea.selectAll('.scatter-dot').transition().duration(200)
        .style('opacity', d => !focusState.focused ? STYLES.dot.fillOpacity : d.color === focusState.focused ? 1 : STYLES.dot.dimmedOpacity);
    }
  };

  const renderGrid = (xs, ys) => {
    gridGroup.selectAll('*').remove();
    if (!showGrid) return;
    gridGroup.selectAll('.grid-h').data(ys.ticks(5)).enter().append('line')
      .attr('x1', 0).attr('x2', width).attr('y1', d => ys(d)).attr('y2', d => ys(d))
      .style('stroke', STYLES.grid.lineColor);
    if (xIsNumeric) {
      gridGroup.selectAll('.grid-v').data(xs.ticks(5)).enter().append('line')
        .attr('x1', d => xs(d)).attr('x2', d => xs(d)).attr('y1', 0).attr('y2', height)
        .style('stroke', STYLES.grid.lineColor);
    }
  };
  renderGrid(xScale, yScale);

  const dots = chartArea.selectAll('.scatter-dot').data(points).enter().append('circle')
    .attr('class', 'scatter-dot')
    .attr('cx', d => xScale(d.x))
    .attr('cy', d => yScale(d.y))
    .attr('r', d => sizeScale ? sizeScale(d.size) : STYLES.dot.radius)
    .attr('fill', d => d.color ? colorScale(d.color) : colors[0])
    .attr('stroke', d => d.color ? colorScale(d.color) : colors[0])
    .attr('stroke-width', STYLES.dot.strokeWidth)
    .style('opacity', STYLES.dot.fillOpacity)
    .style('cursor', 'pointer');

  if (animate) {
    dots.attr('r', 0).transition().duration(400).delay((d, i) => Math.min(i * 3, 300))
      .ease(d3.easeBackOut).attr('r', d => sizeScale ? sizeScale(d.size) : STYLES.dot.radius);
  }

  const formatXDisplay = (val) => xIsNumeric ? formatValue(val, xField) : String(val);

  dots
    .on('mouseover', function(event, d) {
      const r = sizeScale ? sizeScale(d.size) : STYLES.dot.radius;
      d3.select(this).transition().duration(100).attr('r', r + 2).style('opacity', 1);
      let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">`;
      if (d.color) html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorScale(d.color)};margin-right:6px;"></span>`;
      html += d.color || 'Point';
      html += `</div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">${getDisplayName(xField)}:</span><span style="font-weight:600;margin-left:auto;">${formatXDisplay(d.x)}</span></div>`;
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">${getDisplayName(yField)}:</span><span style="font-weight:600;margin-left:auto;">${formatValue(d.y, yField)}</span></div>`;
      if (sizeField && d.size != null) {
        html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">${getDisplayName(sizeField)}:</span><span style="font-weight:600;margin-left:auto;">${formatValue(d.size, sizeField)}</span></div>`;
      }
      tooltipFields.forEach(field => {
        const val = getRowValue(d._row, field);
        if (val != null) {
          html += `<div style="display:flex;gap:8px;margin:2px 0;color:#888;"><span>${getDisplayName(field)}:</span><span style="margin-left:auto;">${typeof val === 'number' ? formatValue(val, field) : val}</span></div>`;
        }
      });
      tooltip.html(html).style('visibility', 'visible').style('opacity', '1');
    })
    .on('mousemove', (event) => { tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`); })
    .on('mouseout', function(event, d) {
      const r = sizeScale ? sizeScale(d.size) : STYLES.dot.radius;
      const op = focusState.focused && d.color !== focusState.focused ? STYLES.dot.dimmedOpacity : STYLES.dot.fillOpacity;
      d3.select(this).transition().duration(100).attr('r', r).style('opacity', op);
      tooltip.style('visibility', 'hidden').style('opacity', '0');
    })
    .on('click', function(event, d) {
      event.stopPropagation();
      if (d.color) {
        focusState.focused = focusState.focused === d.color ? null : d.color;
        focusState.updateFn();
      }
    });

  if (showLabels) {
    chartArea.selectAll('.scatter-label').data(points).enter().append('text')
      .attr('class', 'scatter-label')
      .attr('x', d => xScale(d.x) + (sizeScale ? sizeScale(d.size) : STYLES.dot.radius) + 4)
      .attr('y', d => yScale(d.y) + 3)
      .style('font-size', '9px').style('fill', STYLES.label.color)
      .style('pointer-events', 'none')
      .text(d => d.color || (xIsNumeric ? formatValue(d.y, yField) : d.x));
  }

  const xAxisGroup = g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`);
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

  const renderAxes = (xs, ys) => {
    if (xIsNumeric) {
      xAxisGroup.call(d3.axisBottom(xs).ticks(Math.min(width / 80, 10)).tickFormat(smartFmt));
    } else {
      const maxTicks = Math.max(1, Math.floor(width / 60));
      const domain = xs.domain();
      const step = Math.max(1, Math.ceil(domain.length / maxTicks));
      const tickVals = domain.filter((_, i) => i % step === 0);
      xAxisGroup.call(d3.axisBottom(xs).tickValues(tickVals));
      xAxisGroup.selectAll('text')
        .text(d => truncateLabel(d, 12))
        .style('text-anchor', domain.length > 6 ? 'end' : 'middle')
        .attr('transform', domain.length > 6 ? 'rotate(-35)' : null);
    }
    xAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
    xAxisGroup.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor);
    yAxisGroup.call(d3.axisLeft(ys).ticks(5).tickFormat(smartFmt))
      .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
    yAxisGroup.selectAll('.domain, .tick line').style('stroke', STYLES.axis.lineColor);
  };
  renderAxes(xScale, yScale);

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

  // Zoom only for numeric X (categorical point scale doesn't support rescaleX)
  if (xIsNumeric) {
    const zoomBehavior = d3.zoom()
      .scaleExtent([1, 20])
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
        const t = event.transform;
        currentXScale = t.rescaleX(xScale);
        currentYScale = t.rescaleY(yScale);

        chartArea.selectAll('.scatter-dot')
          .attr('cx', d => currentXScale(d.x))
          .attr('cy', d => currentYScale(d.y));
        if (showLabels) {
          chartArea.selectAll('.scatter-label')
            .attr('x', d => currentXScale(d.x) + (sizeScale ? sizeScale(d.size) : STYLES.dot.radius) + 4)
            .attr('y', d => currentYScale(d.y) + 3);
        }
        renderAxes(currentXScale, currentYScale);
        renderGrid(currentXScale, currentYScale);
      });

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', () => { svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity); });
  }

  if (colorDomain.length > 0 && showLegend) {
    const items = colorScale.domain();
    const swatchSize = 10, itemGap = 16, itemH = 18;
    const legend = svg.append('g').attr('class', 'legend');

    const tempText = svg.append('text').style('font-size', '11px').style('visibility', 'hidden');
    const itemWidths = items.map(item => { tempText.text(truncateLabel(item, 12)); return tempText.node().getComputedTextLength() + swatchSize + 6; });
    tempText.remove();

    const isH = legendPosition === 'top' || legendPosition === 'bottom';
    let lx, ly;
    switch (legendPosition) {
      case 'top': lx = margin.left; ly = 6; break;
      case 'bottom': lx = margin.left; ly = margin.top + height + margin.bottom - 20; break;
      case 'left': lx = 8; ly = margin.top; break;
      case 'right': default: lx = margin.left + width + 10; ly = margin.top;
    }
    legend.attr('transform', `translate(${lx}, ${ly})`);

    let pos = 0;
    items.forEach((item, i) => {
      const ig = legend.append('g').style('cursor', 'pointer')
        .on('click', (e) => { e.stopPropagation(); focusState.focused = focusState.focused === item ? null : item; focusState.updateFn(); })
        .on('mouseover', function() { d3.select(this).select('text').style('fill', '#fff'); })
        .on('mouseout', function() { d3.select(this).select('text').style('fill', '#b0b0b8'); });
      if (isH) { ig.attr('transform', `translate(${pos}, 0)`); pos += itemWidths[i] + itemGap; }
      else { ig.attr('transform', `translate(0, ${i * itemH})`); }
      ig.append('circle').attr('cx', swatchSize / 2).attr('cy', swatchSize / 2).attr('r', 4).attr('fill', colorScale(item));
      ig.append('text').attr('x', swatchSize + 4).attr('y', swatchSize - 1).style('font-size', '11px').style('fill', '#b0b0b8')
        .style('font-family', STYLES.label.fontFamily).text(truncateLabel(getDisplayName(item), isH ? 50 : 9));
    });
  }

  svg.on('click', () => { if (focusState.focused) { focusState.focused = null; focusState.updateFn(); } });

  return {
    update: (nc, nd) => createScatterChart(container, nc || config, nd || data, options),
    destroy: () => { tooltip.remove(); d3.select(container).selectAll('*').remove(); },
    getFocusedSeries: () => focusState.focused,
    setFocusedSeries: (n) => { focusState.focused = n; focusState.updateFn(); },
    resetZoom: xIsNumeric
      ? () => svg.transition().duration(300).call(d3.zoom().transform, d3.zoomIdentity)
      : () => {},
  };
};
