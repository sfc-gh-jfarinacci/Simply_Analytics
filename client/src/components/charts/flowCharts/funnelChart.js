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
    background: 'rgba(30, 30, 40, 0.95)',
    border: '1px solid rgba(100, 100, 120, 0.3)',
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '12px',
    color: '#e0e0e0',
    shadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
};

const DEFAULT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6',
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
  if (!name) return '';
  if (aliases?.[name]) return aliases[name];
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
  const margin = { top: 12, right: 16, bottom: 12, left: 16 };
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

  stages.forEach((stage, i) => {
    const widthRatio = Math.max(minWidthRatio, stage.value / maxValue);
    const nextRatio = i < stages.length - 1
      ? Math.max(minWidthRatio, stages[i + 1].value / maxValue)
      : widthRatio * 0.6;

    const topW = widthRatio * width;
    const botW = nextRatio * width;
    const y = i * (stageH + stageGap);
    const cx = width / 2;

    // Trapezoid points: top-left, top-right, bottom-right, bottom-left
    const points = [
      [cx - topW / 2, y],
      [cx + topW / 2, y],
      [cx + botW / 2, y + stageH],
      [cx - botW / 2, y + stageH],
    ];

    const g = chartG.append('g').attr('class', 'funnel-stage');

    const poly = g.append('polygon')
      .attr('points', points.map(p => p.join(',')).join(' '))
      .attr('fill', colorScale(stage.name))
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 0.5)
      .attr('rx', 3)
      .style('cursor', 'pointer');

    if (animate) {
      // Animate from zero width to full
      const midY = y + stageH / 2;
      const zeroPoints = [
        [cx, midY], [cx, midY], [cx, midY], [cx, midY],
      ];
      poly.attr('points', zeroPoints.map(p => p.join(',')).join(' '))
        .transition().duration(500).delay(i * 80).ease(d3.easeCubicOut)
        .attr('points', points.map(p => p.join(',')).join(' '));
    }

    // Labels
    if (showLabels && stageH >= 18) {
      const labelY = y + stageH / 2;
      const convRate = i === 0 ? '100%' : `${((stage.value / stages[0].value) * 100).toFixed(1)}%`;
      const stepRate = i === 0 ? '' : ` (${((stage.value / stages[i - 1].value) * 100).toFixed(1)}%)`;

      // Stage name
      const nameEl = g.append('text')
        .attr('x', cx).attr('y', stageH >= 40 ? labelY - 6 : labelY + 1)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', stageH < 30 ? '10px' : '12px')
        .style('font-weight', '700')
        .style('fill', '#fff')
        .style('text-shadow', '0 1px 3px rgba(0,0,0,0.5)')
        .style('pointer-events', 'none')
        .text(getDisplayName(stage.name));

      // Value + conversion
      if (stageH >= 40) {
        g.append('text')
          .attr('x', cx).attr('y', labelY + 8)
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .style('font-size', '10px')
          .style('fill', 'rgba(255,255,255,0.7)')
          .style('text-shadow', '0 1px 2px rgba(0,0,0,0.4)')
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

    // Tooltip
    poly
      .on('mouseover', function(event) {
        d3.select(this).style('filter', 'brightness(1.15)');
        const convRate = ((stage.value / stages[0].value) * 100).toFixed(1);
        const stepConv = i > 0 ? ((stage.value / stages[i - 1].value) * 100).toFixed(1) : null;
        let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">`;
        html += `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${colorScale(stage.name)};margin-right:6px;"></span>`;
        html += `${getDisplayName(stage.name)}</div>`;
        html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Value:</span><span style="font-weight:600;margin-left:auto;">${formatValue(stage.value)}</span></div>`;
        html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Overall:</span><span style="font-weight:600;margin-left:auto;">${convRate}%</span></div>`;
        if (stepConv) {
          html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Step:</span><span style="font-weight:600;margin-left:auto;">${stepConv}%</span></div>`;
        }
        tooltip.html(html).style('visibility', 'visible').style('opacity', '1')
          .style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
      })
      .on('mousemove', function(event) {
        tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', function() {
        d3.select(this).style('filter', null);
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
