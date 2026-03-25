/**
 * D3.js Sankey Diagram
 *
 * Data mapping (from shelf model):
 *   - columns[0] → source node field
 *   - columns[1] → target node field
 *   - measures[0] → link value / flow thickness
 *
 * Features:
 *   - Automatic node positioning via d3-sankey
 *   - Hover highlights full path (links + connected nodes)
 *   - Tooltip with source → target and value
 *   - Node labels with value
 *   - Animated link drawing on load
 *   - Color per source node from widget color scheme
 */

import * as d3 from 'd3';
import { sankey as d3Sankey, sankeyLinkHorizontal, sankeyLeft } from 'd3-sankey';

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
  let tip = d3.select('body').select('.sankey-chart-tooltip');
  if (tip.empty()) tip = d3.select('body').append('div').attr('class', 'sankey-chart-tooltip');
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

const createValueFormatter = (fieldFormats) => (value) => {
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

export const createSankeyChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const {
    showLabels = true,
    animate = true,
    fieldFormats = {},
    columnAliases = {},
    colors = DEFAULT_COLORS,
  } = options;

  const formatValue = createValueFormatter(fieldFormats);
  const getDisplayName = createDisplayNameGetter(columnAliases);

  const containerRect = container.getBoundingClientRect();
  const totalW = options.width || containerRect.width || 400;
  const totalH = options.height || containerRect.height || 300;
  const margin = { top: 10, right: 100, bottom: 10, left: 100 };
  const width = totalW - margin.left - margin.right;
  const height = totalH - margin.top - margin.bottom;

  // Extract fields from config
  const sourceField = config.sourceField;
  const targetField = config.targetField;
  const measureField = (config.series || [])[0] || 'value';

  if (!sourceField || !targetField) return { update: () => {}, destroy: () => {} };

  // Build links from flat data
  const linkMap = new Map();
  for (const row of data) {
    const src = String(getRowValue(row, sourceField) ?? '');
    const tgt = String(getRowValue(row, targetField) ?? '');
    const val = Math.abs(Number(getRowValue(row, measureField)) || 0);
    if (!src || !tgt || src === tgt) continue;
    const key = `${src}\x00${tgt}`;
    linkMap.set(key, (linkMap.get(key) || 0) + val);
  }

  if (linkMap.size === 0) return { update: () => {}, destroy: () => {} };

  // Build unique node list
  const nodeNames = new Set();
  const links = [];
  for (const [key, value] of linkMap) {
    const [source, target] = key.split('\x00');
    nodeNames.add(source);
    nodeNames.add(target);
    links.push({ source, target, value });
  }

  const nodeArray = Array.from(nodeNames);
  const nodeIndex = new Map(nodeArray.map((n, i) => [n, i]));
  const nodes = nodeArray.map(name => ({ name }));
  const sankeyLinks = links.map(l => ({
    source: nodeIndex.get(l.source),
    target: nodeIndex.get(l.target),
    value: l.value,
  }));

  // Sankey layout — node width scales with chart, generous padding
  const nodeW = Math.max(12, Math.min(24, width * 0.03));
  const nodePad = Math.max(8, Math.min(20, height / (nodeArray.length + 1)));
  const sankeyLayout = d3Sankey()
    .nodeId(d => d.index)
    .nodeAlign(sankeyLeft)
    .nodeWidth(nodeW)
    .nodePadding(nodePad)
    .extent([[0, 0], [width, height]]);

  const { nodes: sNodes, links: sLinks } = sankeyLayout({
    nodes: nodes.map((d, i) => ({ ...d, index: i })),
    links: sankeyLinks,
  });

  // Color: each source node gets a color from the palette
  const sourceNodes = new Set(sLinks.map(l => l.source.name));
  const sourceArray = Array.from(sourceNodes);
  const colorScale = d3.scaleOrdinal().domain(sourceArray).range(colors);
  const getNodeColor = (d) => colorScale(d.name);
  const getLinkColor = (d) => {
    const c = d3.color(colorScale(d.source.name));
    c.opacity = 0.55;
    return c.toString();
  };

  // ========================================
  // RENDER
  // ========================================

  d3.select(container).selectAll('*').remove();
  const tooltip = createTooltip();

  const svg = d3.select(container).append('svg')
    .attr('width', totalW).attr('height', totalH)
    .style('overflow', 'visible')
    .style('font-family', 'system-ui, -apple-system, sans-serif');

  const chartG = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Links
  const linkG = chartG.append('g').attr('fill', 'none');

  const linkPaths = linkG.selectAll('path')
    .data(sLinks)
    .join('path')
    .attr('d', sankeyLinkHorizontal())
    .attr('stroke', d => getLinkColor(d))
    .attr('stroke-width', d => Math.max(2, d.width));

  if (animate) {
    linkPaths.each(function() {
      const totalLen = this.getTotalLength();
      d3.select(this)
        .attr('stroke-dasharray', `${totalLen} ${totalLen}`)
        .attr('stroke-dashoffset', totalLen)
        .transition().duration(800).ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0)
        .on('end', function() {
          d3.select(this).attr('stroke-dasharray', null);
        });
    });
  }

  // Nodes
  const nodeG = chartG.append('g');

  const nodeRects = nodeG.selectAll('rect')
    .data(sNodes)
    .join('rect')
    .attr('x', d => d.x0).attr('y', d => d.y0)
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => Math.max(1, d.y1 - d.y0))
    .attr('fill', d => getNodeColor(d))
    .attr('rx', 2)
    .style('cursor', 'default');

  if (animate) {
    nodeRects.style('opacity', 0)
      .transition().duration(400).ease(d3.easeCubicOut)
      .style('opacity', 1);
  }

  // Node labels — positioned in the margins so they're never clipped
  if (showLabels) {
    nodeG.selectAll('text')
      .data(sNodes)
      .join('text')
      .attr('x', d => d.x0 < width / 2 ? d.x1 + 8 : d.x0 - 8)
      .attr('y', d => (d.y0 + d.y1) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('fill', 'rgba(220, 220, 230, 0.9)')
      .style('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
      .style('pointer-events', 'none')
      .text(d => {
        const name = getDisplayName(d.name);
        const maxChars = Math.floor((margin.right - 10) / 6.5);
        return name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
      });
  }

  // --- Tooltip ---
  const showTooltipFn = (event, html) => {
    tooltip.html(html).style('visibility', 'visible').style('opacity', '1')
      .style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
  };
  const hideTooltip = () => { tooltip.style('visibility', 'hidden').style('opacity', '0'); };

  // --- Interactions ---
  linkPaths
    .on('mouseover', function(event, d) {
      linkPaths.transition().duration(150).attr('stroke', l => l === d
        ? d3.color(colorScale(d.source.name)).copy({ opacity: 0.85 }).toString()
        : d3.color(getLinkColor(l)).copy({ opacity: 0.12 }).toString());
      const html = `<div style="font-weight:600;margin-bottom:4px;">${getDisplayName(d.source.name)} → ${getDisplayName(d.target.name)}</div>` +
        `<div>${formatValue(d.value)}</div>`;
      showTooltipFn(event, html);
    })
    .on('mousemove', function(event) {
      tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
    })
    .on('mouseout', function() {
      linkPaths.transition().duration(150).attr('stroke', d => getLinkColor(d));
      hideTooltip();
    });

  nodeRects
    .on('mouseover', function(event, d) {
      // Highlight all links connected to this node
      linkPaths.transition().duration(150)
        .attr('stroke', l => (l.source === d || l.target === d)
          ? d3.color(colorScale(l.source.name)).copy({ opacity: 0.85 }).toString()
          : d3.color(getLinkColor(l)).copy({ opacity: 0.1 }).toString());
      const incoming = d.targetLinks.reduce((s, l) => s + l.value, 0);
      const outgoing = d.sourceLinks.reduce((s, l) => s + l.value, 0);
      let html = `<div style="font-weight:600;margin-bottom:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${getNodeColor(d)};margin-right:6px;"></span>${getDisplayName(d.name)}</div>`;
      if (incoming > 0) html += `<div style="color:#a0a0b0;">Incoming: <span style="color:#e0e0e0;font-weight:600;">${formatValue(incoming)}</span></div>`;
      if (outgoing > 0) html += `<div style="color:#a0a0b0;">Outgoing: <span style="color:#e0e0e0;font-weight:600;">${formatValue(outgoing)}</span></div>`;
      showTooltipFn(event, html);
    })
    .on('mousemove', function(event) {
      tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
    })
    .on('mouseout', function() {
      linkPaths.transition().duration(150).attr('stroke', d => getLinkColor(d));
      hideTooltip();
    });

  return {
    update: () => {},
    destroy: () => {
      d3.select(container).selectAll('*').remove();
      tooltip.remove();
    },
  };
};
