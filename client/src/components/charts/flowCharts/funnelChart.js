/**
 * D3.js Funnel Chart
 *
 * Data mapping (from shelf model):
 *   - columns[0] → stage/category dimension
 *   - measures[0] → value for each stage
 *
 * Stages are sorted by value descending (largest at top).
 * Each stage is a trapezoid that narrows toward the bottom.
 *
 * Features:
 *   - Proportional trapezoid widths based on value
 *   - Labels with stage name, value, and conversion rate
 *   - Hover highlight with tooltip
 *   - Animated entrance (stages slide in from sides)
 *   - Colors from widget color scheme
 */

import * as d3 from 'd3';

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
};

const DEFAULT_COLORS = [
  '#6366f1', '#f472b6', '#38bdf8', '#34d399', '#fbbf24',
  '#fb923c', '#a78bfa', '#2dd4bf', '#f87171', '#818cf8',
  '#4ade80', '#f9a8d4', '#67e8f9', '#fcd34d', '#c084fc',
  '#86efac', '#fda4af', '#7dd3fc',
];

const createTooltip = () => {
  let tip = d3.select('body').select('.funnel-chart-tooltip');
  if (tip.empty()) tip = d3.select('body').append('div').attr('class', 'funnel-chart-tooltip');
  tip.style('position', 'fixed').style('pointer-events', 'none').style('z-index', '99999')
    .style('visibility', 'hidden').style('opacity', '0')
    .style('background', STYLES.tooltip.background).style('border', STYLES.tooltip.border)
    .style('border-radius', STYLES.tooltip.borderRadius).style('padding', STYLES.tooltip.padding)
    .style('font-size', STYLES.tooltip.fontSize).style('color', STYLES.tooltip.color)
    .style('box-shadow', STYLES.tooltip.shadow).style('max-width', '300px')
    .style('transition', 'opacity 0.15s ease');
  return tip;
};

const getRowValue = (row, key) => {
  if (!row || key == null) return undefined;
  const keyStr = String(key);
  if (row[keyStr] !== undefined) return row[keyStr];
  const keyUpper = keyStr.toUpperCase();
  const match = Object.keys(row).find(k => k.toUpperCase() === keyUpper);
  return match ? row[match] : undefined;
};

const createValueFormatter = () => (value) => {
  if (value == null) return '—';
  if (typeof value !== 'number') return String(value);
  if (Math.abs(value) >= 1e9) return (value / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'B';
  if (Math.abs(value) >= 1e6) return (value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'M';
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const createDisplayNameGetter = (aliases) => (name) => {
  if (name == null) return '';
  const str = String(name);
  if (aliases?.[str]) return aliases[str];
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

export const createFunnelChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const {
    showLabels = true,
    animate = true,
    columnAliases = {},
    colors = DEFAULT_COLORS,
  } = options;

  const formatValue = createValueFormatter();
  const getDisplayName = createDisplayNameGetter(columnAliases);

  const containerRect = container.getBoundingClientRect();
  const totalW = options.width || containerRect.width || 400;
  const totalH = options.height || containerRect.height || 300;
  const isCompact = totalW < 250;
  let margin = { top: 12, right: 16, bottom: 12, left: 16 };
  if (isCompact) {
    margin = { top: 6, right: 8, bottom: 6, left: 8 };
  }
  const width = totalW - margin.left - margin.right;
  const height = totalH - margin.top - margin.bottom;

  const categoryField = config.categoryField;
  const measureField = (config.series || [])[0] || 'value';

  if (!categoryField) return { update: () => {}, destroy: () => {} };

  // Aggregate data by category
  const aggMap = new Map();
  for (const row of data) {
    const cat = String(getRowValue(row, categoryField) ?? '');
    const val = Math.abs(Number(getRowValue(row, measureField)) || 0);
    if (!cat) continue;
    aggMap.set(cat, (aggMap.get(cat) || 0) + val);
  }

  // Sort stages descending by value
  const stages = Array.from(aggMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  if (stages.length === 0) return { update: () => {}, destroy: () => {} };

  const maxValue = stages[0].value || 1;
  const stageGap = 3;
  const stageH = Math.max(20, (height - stageGap * (stages.length - 1)) / stages.length);
  const minWidthRatio = 0.15;

  // ========================================
  // RENDER
  // ========================================

  d3.select(container).selectAll('*').remove();
  const tooltip = createTooltip();

  const svg = d3.select(container).append('svg')
    .attr('width', totalW).attr('height', totalH)
    .style('font-family', 'system-ui, -apple-system, sans-serif');

  const chartG = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const colorScale = d3.scaleOrdinal().domain(stages.map(s => s.name)).range(colors);

  const r = Math.min(8, stageH * 0.2);

  // Build a rounded-trapezoid path: top-left, top-right, bottom-right, bottom-left
  const trapezoidPath = (topW, botW, h, cx, r) => {
    const tl = cx - topW / 2, tr = cx + topW / 2;
    const bl = cx - botW / 2, br = cx + botW / 2;
    const cr = Math.min(r, Math.abs(tr - br), h / 2);
    return `M${tl + cr},0 L${tr - cr},0 Q${tr},0 ${tr - (tr - br) * (cr / h)},${cr}`
      + ` L${br + (tr - br) * (cr / h)},${h - cr} Q${br},${h} ${br - cr},${h}`
      + ` L${bl + cr},${h} Q${bl},${h} ${bl + (tl - bl) * (cr / h)},${h - cr}`
      + ` L${tl - (tl - bl) * (cr / h)},${cr} Q${tl},0 ${tl + cr},0 Z`;
  };

  stages.forEach((stage, i) => {
    const widthRatio = Math.max(minWidthRatio, stage.value / maxValue);
    const nextRatio = i < stages.length - 1
      ? Math.max(minWidthRatio, stages[i + 1].value / maxValue)
      : widthRatio * 0.6;

    const topW = widthRatio * width;
    const botW = nextRatio * width;
    const y = i * (stageH + stageGap);
    const cx = width / 2;

    const g = chartG.append('g').attr('class', 'funnel-stage')
      .attr('transform', `translate(0,${y})`);

    const shape = g.append('path')
      .attr('d', trapezoidPath(topW, botW, stageH, cx, r))
      .attr('fill', colorScale(stage.name))
      .style('cursor', 'pointer');

    if (animate) {
      const zeroPath = trapezoidPath(0, 0, stageH, cx, 0);
      shape.attr('d', zeroPath)
        .transition().duration(500).delay(i * 80).ease(d3.easeCubicOut)
        .attr('d', trapezoidPath(topW, botW, stageH, cx, r));
    }

    if (showLabels && stageH >= 18 && !(isCompact && stageH < 30)) {
      const labelY = stageH / 2;
      const convRate = i === 0 ? '100%' : `${((stage.value / stages[0].value) * 100).toFixed(1)}%`;
      const stepRate = i === 0 ? '' : ` (${((stage.value / stages[i - 1].value) * 100).toFixed(1)}%)`;

      const nameEl = g.append('text')
        .attr('x', cx).attr('y', stageH >= 40 ? labelY - 6 : labelY + 1)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', stageH < 30 ? '10px' : '12px')
        .style('font-weight', '600')
        .style('fill', '#fff')
        .style('pointer-events', 'none')
        .text(getDisplayName(stage.name));

      if (stageH >= 40) {
        g.append('text')
          .attr('x', cx).attr('y', labelY + 8)
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .style('font-size', '10px')
          .style('fill', 'rgba(255,255,255,0.75)')
          .style('pointer-events', 'none')
          .text(`${formatValue(stage.value)}  •  ${convRate}${stepRate}`);
      }

      if (animate) {
        nameEl.style('opacity', 0)
          .transition().delay(i * 80 + 300).duration(300)
          .style('opacity', 1);
        g.selectAll('text:nth-child(3)').style('opacity', 0)
          .transition().delay(i * 80 + 300).duration(300)
          .style('opacity', 1);
      }
    }

    shape
      .on('mouseover', function(event) {
        d3.select(this).transition().duration(150).attr('opacity', 0.85);
        const convRate = ((stage.value / stages[0].value) * 100).toFixed(1);
        const stepConv = i > 0 ? ((stage.value / stages[i - 1].value) * 100).toFixed(1) : null;
        let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:4px;">`;
        html += `<span style="display:inline-block;width:8px;height:8px;border-radius:3px;background:${colorScale(stage.name)};margin-right:6px;"></span>`;
        html += `${getDisplayName(stage.name)}</div>`;
        html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#94a3b8;">Value:</span><span style="font-weight:600;margin-left:auto;">${formatValue(stage.value)}</span></div>`;
        html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#94a3b8;">Overall:</span><span style="font-weight:600;margin-left:auto;">${convRate}%</span></div>`;
        if (stepConv) {
          html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#94a3b8;">Step:</span><span style="font-weight:600;margin-left:auto;">${stepConv}%</span></div>`;
        }
        tooltip.html(html).style('visibility', 'visible').style('opacity', '1')
          .style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
      })
      .on('mousemove', function(event) {
        tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', function() {
        d3.select(this).transition().duration(150).attr('opacity', 1);
        tooltip.style('visibility', 'hidden').style('opacity', '0');
      });
  });

  return {
    update: () => {},
    destroy: () => {
      d3.select(container).selectAll('*').remove();
      tooltip.remove();
    },
  };
};
