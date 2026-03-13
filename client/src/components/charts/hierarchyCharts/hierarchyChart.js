/**
 * D3.js Treemap & Icicle Charts
 *
 * Treemap — Nested treemap (Observable-style)
 *   Hierarchy is built from columns → rows fields in order.
 *   Mark types are ignored. First measure determines both cell SIZE
 *   and COLOR INTENSITY within the widget's color scheme.
 *
 * Icicle — Partition diagram using the same hierarchy.
 *
 * Data mapping:
 *   - groupFields  → ordered array of dimension fields that define nesting
 *                     (columns shelf first, then rows shelf)
 *   - series[0]    → measure field used for size + intensity
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
  tooltip: {
    background: 'rgba(30, 30, 40, 0.95)',
    border: '1px solid rgba(100, 100, 120, 0.3)',
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '12px',
    color: '#e0e0e0',
    shadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  cell: {
    dimmedOpacity: 0.25,
    stroke: 'rgba(20, 20, 30, 0.8)',
    labelColor: '#fff',
    labelShadow: '0 1px 3px rgba(0,0,0,0.6)',
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

const getFieldAggregation = (config, fieldName) => {
  const aggs = config.fieldAggregations || {};
  if (!fieldName) return 'sum';
  const upper = fieldName.toUpperCase();
  for (const [key, val] of Object.entries(aggs)) {
    if (key.toUpperCase() === upper) return val;
  }
  return 'sum';
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

const createValueFormatter = (fieldFormats) => (value, field) => {
  if (value == null) return '—';
  if (typeof value !== 'number') return String(value);
  const cfg = fieldFormats?.[field];
  if (cfg?.format === 'currency') return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: cfg.decimals ?? 0 });
  if (cfg?.format === 'percent') return value.toLocaleString(undefined, { maximumFractionDigits: cfg.decimals ?? 1 }) + '%';
  if (Math.abs(value) >= 1e9) return (value / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'B';
  if (Math.abs(value) >= 1e6) return (value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'M';
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const createDisplayNameGetter = (columnAliases) => (name) => {
  if (!name) return '';
  const alias = columnAliases?.[name];
  if (alias) return alias;
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

// ============================================================================
// TOOLTIP
// ============================================================================

const createTooltip = () => {
  let tip = d3.select('body').select('.hierarchy-chart-tooltip');
  if (tip.empty()) {
    tip = d3.select('body').append('div').attr('class', 'hierarchy-chart-tooltip');
  }
  tip.style('position', 'fixed')
    .style('pointer-events', 'none')
    .style('z-index', '99999')
    .style('visibility', 'hidden')
    .style('opacity', '0')
    .style('background', STYLES.tooltip.background)
    .style('border', STYLES.tooltip.border)
    .style('border-radius', STYLES.tooltip.borderRadius)
    .style('padding', STYLES.tooltip.padding)
    .style('font-size', STYLES.tooltip.fontSize)
    .style('color', STYLES.tooltip.color)
    .style('box-shadow', STYLES.tooltip.shadow)
    .style('max-width', '300px')
    .style('transition', 'opacity 0.15s ease');
  return tip;
};

// ============================================================================
// N-LEVEL HIERARCHY BUILDER
// ============================================================================

/**
 * Build a d3.hierarchy from flat row data with N nesting levels.
 *
 * @param {Array} data        - flat row objects
 * @param {Array} groupFields - ordered dimension field names (columns then rows)
 * @param {string} measureField
 * @param {Function} aggFn    - aggregation function for measure
 * @returns {d3.hierarchy|null}
 */
const buildNestedHierarchy = (data, groupFields, measureField, aggFn) => {
  if (!groupFields || groupFields.length === 0 || data.length === 0) return null;

  const buildLevel = (rows, fieldIndex) => {
    const field = groupFields[fieldIndex];
    const isLeaf = fieldIndex === groupFields.length - 1;
    const grouped = d3.group(rows, d => {
      const v = toPrimitive(getRowValue(d, field));
      return v != null ? String(v) : '(empty)';
    });

    const children = [];
    for (const [key, groupRows] of grouped) {
      if (isLeaf) {
        const value = Math.abs(aggFn(groupRows) || 0);
        if (value > 0) children.push({ name: key, value, _field: field });
      } else {
        const sub = buildLevel(groupRows, fieldIndex + 1);
        if (sub.length > 0) children.push({ name: key, children: sub, _field: field });
      }
    }
    return children;
  };

  const children = buildLevel(data, 0);
  if (children.length === 0) return null;

  return d3.hierarchy({ name: 'root', children })
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value);
};

// ============================================================================
// TREEMAP CHART (nested, Observable-style)
// ============================================================================

export const createTreemapChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const {
    showLabels = true,
    animate = true,
    fieldFormats = {},
    columnAliases = {},
    colors = DEFAULT_COLORS,
    margin: baseMargin = { top: 0, right: 0, bottom: 0, left: 0 },
  } = options;

  const formatValue = createValueFormatter(fieldFormats);
  const getDisplayName = createDisplayNameGetter(columnAliases);

  const containerRect = container.getBoundingClientRect();
  const totalW = options.width || containerRect.width || 400;
  const totalH = options.height || containerRect.height || 300;

  // Resolve grouping fields: columns first, then rows — marks ignored
  const groupFields = [...(config.groupFields || [])];
  if (groupFields.length === 0) {
    if (config.x_axis) groupFields.push(config.x_axis);
  }
  if (groupFields.length === 0) return { update: () => {}, destroy: () => {} };

  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const measureField = seriesFields[0] || 'value';
  const aggType = getFieldAggregation(config, measureField);
  const aggFn = getAggregationFunction(aggType, measureField);

  const root = buildNestedHierarchy(data, groupFields, measureField, aggFn);
  if (!root) return { update: () => {}, destroy: () => {} };

  const grandTotal = root.value;
  const maxDepth = groupFields.length;

  // --- Color intensity scale ---
  // Use the FIRST color from the scheme as the base hue.
  // Leaves get intensity proportional to their value.
  const baseHsl = d3.hsl(colors[0] || '#6366f1');
  const leaves = root.leaves();
  const leafValues = leaves.map(l => l.value);
  const minVal = d3.min(leafValues) || 0;
  const maxVal = d3.max(leafValues) || 1;

  // sqrt scale spreads values more evenly when data is skewed
  const intensityScale = d3.scaleSqrt()
    .domain([minVal, maxVal])
    .range([0, 1])
    .clamp(true);

  // Light end: clearly tinted, not washed out
  const lightEnd = d3.hsl(baseHsl.h, Math.max(0.35, baseHsl.s * 0.6), 0.78).formatHsl();
  // Dark end: rich saturated version of base color
  const darkEnd = d3.hsl(baseHsl.h, Math.min(1, baseHsl.s * 1.1), Math.max(0.25, baseHsl.l * 0.65)).formatHsl();

  const getLeafColor = (value) => {
    const t = intensityScale(value);
    return d3.interpolateHsl(lightEnd, darkEnd)(t);
  };

  // Parent group colors: tinted backgrounds that are clearly visible
  const getGroupColor = (depth, index) => {
    if (depth === 0) return 'transparent';
    const groupHsl = d3.hsl(colors[(index) % colors.length] || '#6366f1');
    groupHsl.s = Math.max(0.15, groupHsl.s * 0.3);
    groupHsl.l = 0.15 + depth * 0.03;
    return groupHsl.formatHsl();
  };

  // Group header height based on depth
  const groupHeaderH = (depth) => {
    if (depth <= 0) return 0;
    return depth === 1 ? 20 : 16;
  };

  // Treemap layout
  const treemapLayout = d3.treemap()
    .size([totalW, totalH])
    .paddingInner(1)
    .paddingOuter(3)
    .paddingTop(d => groupHeaderH(d.depth + 1))
    .round(true)
    .tile(d3.treemapSquarify);

  treemapLayout(root);

  // ========================================
  // RENDER
  // ========================================

  d3.select(container).selectAll('*').remove();
  const tooltip = createTooltip();

  const svg = d3.select(container).append('svg')
    .attr('width', totalW).attr('height', totalH)
    .attr('viewBox', `0 0 ${totalW} ${totalH}`)
    .style('overflow', 'hidden')
    .style('font-family', 'system-ui, -apple-system, sans-serif');

  // Render all non-root nodes
  const allNodes = root.descendants().filter(d => d.depth > 0);

  const nodeG = svg.selectAll('.tm-node')
    .data(allNodes, d => d.ancestors().map(a => a.data.name).join('/'))
    .enter().append('g')
    .attr('class', 'tm-node')
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  // Rectangles
  const rects = nodeG.append('rect')
    .attr('width', d => Math.max(0, d.x1 - d.x0))
    .attr('height', d => Math.max(0, d.y1 - d.y0))
    .attr('rx', d => d.children ? 3 : 2)
    .attr('fill', d => {
      if (d.children) {
        // Group node: subtle tinted background
        const idx = d.parent ? d.parent.children.indexOf(d) : 0;
        return getGroupColor(d.depth, idx);
      }
      return getLeafColor(d.value);
    })
    .attr('stroke', d => d.children
      ? `rgba(255,255,255,${0.06 + d.depth * 0.03})`
      : STYLES.cell.stroke)
    .attr('stroke-width', d => d.children ? 1 : 0.5)
    .style('cursor', d => d.children ? 'default' : 'pointer');

  if (animate) {
    rects.style('opacity', 0)
      .transition().duration(500).ease(d3.easeCubicOut)
      .style('opacity', 1);
  }

  // --- GROUP HEADERS (non-leaf nodes) ---
  nodeG.filter(d => d.children).each(function(d) {
    const g = d3.select(this);
    const cellW = d.x1 - d.x0;
    if (cellW < 30) return;

    const headerH = groupHeaderH(d.depth);
    const name = getDisplayName(d.data.name);
    const maxChars = Math.floor((cellW - 8) / (d.depth === 1 ? 7.5 : 6.5));
    const label = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
    const fontSize = d.depth === 1 ? '11px' : '10px';

    g.append('text')
      .attr('x', 4)
      .attr('y', headerH - 5)
      .style('font-size', fontSize)
      .style('font-weight', d.depth === 1 ? '700' : '600')
      .style('fill', 'rgba(255,255,255,0.8)')
      .style('pointer-events', 'none')
      .text(label);
  });

  // --- LEAF LABELS ---
  if (showLabels) {
    nodeG.filter(d => !d.children).each(function(d) {
      const g = d3.select(this);
      const cellW = d.x1 - d.x0;
      const cellH = d.y1 - d.y0;
      if (cellW < 32 || cellH < 20) return;

      const name = getDisplayName(d.data.name);
      const maxChars = Math.floor((cellW - 8) / 6);
      const truncated = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;

      // Determine text contrast against leaf color
      const bg = d3.color(getLeafColor(d.value));
      const lum = bg ? (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255 : 0;
      const textColor = lum > 0.55 ? 'rgba(0,0,0,0.8)' : STYLES.cell.labelColor;
      const shadowColor = lum > 0.55 ? 'none' : STYLES.cell.labelShadow;

      g.append('text')
        .attr('x', 4).attr('y', 14)
        .style('font-size', cellW < 55 ? '9px' : '10px')
        .style('font-weight', '600')
        .style('fill', textColor)
        .style('text-shadow', shadowColor)
        .style('pointer-events', 'none')
        .text(truncated);

      if (cellH > 30) {
        g.append('text')
          .attr('x', 4).attr('y', 26)
          .style('font-size', '9px')
          .style('fill', lum > 0.55 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.65)')
          .style('text-shadow', shadowColor)
          .style('pointer-events', 'none')
          .text(formatValue(d.value, measureField));
      }
    });
  }

  // --- TOOLTIP ---
  const showTooltip = (event, d) => {
    const pct = grandTotal > 0 ? ((d.value / grandTotal) * 100).toFixed(1) : '0';
    const ancestors = d.ancestors().filter(a => a.depth > 0).reverse();
    const path = ancestors.map(a => getDisplayName(a.data.name)).join(' › ');

    let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">`;
    html += `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${d.children ? 'rgba(255,255,255,0.3)' : getLeafColor(d.value)};margin-right:6px;vertical-align:middle;"></span>`;
    html += `${path}</div>`;
    html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">${getDisplayName(measureField)}:</span>`;
    html += `<span style="font-weight:600;margin-left:auto;">${formatValue(d.value, measureField)}</span></div>`;
    html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Share:</span>`;
    html += `<span style="font-weight:600;margin-left:auto;">${pct}%</span></div>`;
    if (d.children) {
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Items:</span>`;
      html += `<span style="font-weight:600;margin-left:auto;">${d.leaves().length}</span></div>`;
    }
    tooltip.html(html).style('visibility', 'visible').style('opacity', '1')
      .style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
  };

  const hideTooltip = () => { tooltip.style('visibility', 'hidden').style('opacity', '0'); };

  // --- INTERACTIONS ---
  rects
    .on('mouseover', function(event, d) {
      if (!d.children) d3.select(this).style('filter', 'brightness(1.2)');
      showTooltip(event, d);
    })
    .on('mousemove', function(event) {
      tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
    })
    .on('mouseout', function(event, d) {
      if (!d.children) d3.select(this).style('filter', null);
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

// ============================================================================
// ICICLE CHART  (zoomable horizontal partition with adaptive scroll)
//
// Navigation:
//   - Click any group → zoom in (it becomes the leftmost bar)
//   - Click the leftmost bar (current focus) → zoom back out to parent
//   - When a zoomed-in section has too many leaves to fit at readable sizes,
//     the SVG expands vertically and the container scrolls.
//   - Zooming back out shrinks the SVG back to fit the container.
// ============================================================================

export const createIcicleChart = (container, config, data, options = {}) => {
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
  const viewW = options.width || containerRect.width || 400;
  const viewH = options.height || containerRect.height || 300;
  const MIN_LEAF_H = 24;

  // Resolve grouping fields
  const groupFields = [...(config.groupFields || [])];
  if (groupFields.length === 0) {
    if (config.x_axis) groupFields.push(config.x_axis);
  }
  if (groupFields.length === 0) return { update: () => {}, destroy: () => {} };

  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  const measureField = seriesFields[0] || 'value';
  const aggType = getFieldAggregation(config, measureField);
  const aggFn = getAggregationFunction(aggType, measureField);

  const root = buildNestedHierarchy(data, groupFields, measureField, aggFn);
  if (!root) return { update: () => {}, destroy: () => {} };

  const grandTotal = root.value;

  // --- Colors ---
  const topChildren = root.children || [];
  const topColorScale = d3.scaleOrdinal()
    .domain(topChildren.map(c => c.data.name))
    .range(colors);

  const getNodeColor = (d) => {
    if (d.depth === 0) {
      const rootHsl = d3.hsl(colors[0] || '#6366f1');
      rootHsl.s = Math.max(0.2, rootHsl.s * 0.45);
      rootHsl.l = 0.68;
      return rootHsl.formatHsl();
    }
    const topAncestor = d.ancestors().find(a => a.depth === 1);
    if (!topAncestor) return colors[0];
    const base = d3.hsl(topColorScale(topAncestor.data.name));
    if (d.depth === 1) return base.formatHsl();
    const sibIdx = d.parent ? d.parent.children.indexOf(d) : 0;
    const shift = (d.depth - 1) * 0.13;
    return d3.hsl(
      base.h + sibIdx * 20,
      Math.min(1, base.s + shift * 0.2),
      Math.min(0.82, base.l + shift)
    ).formatHsl();
  };

  // Contrast helper
  const textAttrs = (d) => {
    const bg = d3.color(getNodeColor(d));
    const lum = bg ? (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255 : 0;
    return {
      color: lum > 0.55 ? 'rgba(0,0,0,0.82)' : '#fff',
      shadow: lum > 0.55 ? 'none' : '0 1px 2px rgba(0,0,0,0.5)',
      dim: lum > 0.55 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)',
    };
  };

  // --- Partition layout (on full tree at base size) ---
  d3.partition().size([viewH, viewW]).padding(1).round(true)(root);

  // ========================================
  // RENDER
  // ========================================

  d3.select(container).selectAll('*').remove();
  const tooltip = createTooltip();

  // Scrollable wrapper
  const wrapper = d3.select(container).append('div')
    .style('width', '100%')
    .style('height', '100%')
    .style('overflow', 'auto')
    .style('position', 'relative');

  const svg = wrapper.append('svg')
    .attr('width', viewW).attr('height', viewH)
    .style('display', 'block')
    .style('font-family', 'system-ui, -apple-system, sans-serif');

  const cell = svg.selectAll('g')
    .data(root.descendants())
    .join('g')
    .attr('transform', d => `translate(${d.y0},${d.x0})`);

  // Per-cell clip paths
  const defs = svg.append('defs');
  cell.each(function(d, i) {
    const cid = `ic-clip-${i}`;
    defs.append('clipPath').attr('id', cid)
      .append('rect')
      .attr('width', Math.max(0, d.y1 - d.y0))
      .attr('height', Math.max(0, d.x1 - d.x0));
    d3.select(this).attr('clip-path', `url(#${cid})`);
    d._clipIdx = i;
  });

  const rect = cell.append('rect')
    .attr('width', d => Math.max(0, d.y1 - d.y0))
    .attr('height', d => Math.max(0, d.x1 - d.x0))
    .attr('fill', d => getNodeColor(d))
    .attr('stroke', 'rgba(255,255,255,0.4)')
    .attr('stroke-width', 0.5)
    .style('cursor', d => d.children ? 'pointer' : 'default');

  // --- Labels (rendered once, repositioned on zoom) ---
  const nameText = cell.append('text')
    .attr('class', 'ic-name')
    .style('pointer-events', 'none');
  const valTextEl = cell.append('text')
    .attr('class', 'ic-val')
    .style('pointer-events', 'none');

  // Draws/updates labels for current target positions
  const renderLabels = () => {
    nameText.each(function(d) {
      const el = d3.select(this);
      const t = d.target;
      const w = t.y1 - t.y0;
      const h = t.x1 - t.x0;

      if (d.depth === 0 || w < 25 || h < 14) {
        el.attr('fill-opacity', 0);
        return;
      }

      const { color, shadow } = textAttrs(d);
      const name = getDisplayName(d.data.name);

      el.attr('x', 4)
        .attr('y', h < 28 ? h / 2 + 4 : 13)
        .style('font-size', w < 60 ? '10px' : '11px')
        .style('font-weight', d.children ? '700' : '500')
        .style('fill', color)
        .style('text-shadow', shadow)
        .attr('fill-opacity', 1)
        .text(name);
    });

    valTextEl.each(function(d) {
      const el = d3.select(this);
      const t = d.target;
      const w = t.y1 - t.y0;
      const h = t.x1 - t.x0;

      if (d.depth === 0 || w < 45 || h < 32) {
        el.attr('fill-opacity', 0);
        return;
      }

      const { dim, shadow } = textAttrs(d);
      el.attr('x', 4).attr('y', 26)
        .style('font-size', '9px')
        .style('fill', dim)
        .style('text-shadow', shadow)
        .attr('fill-opacity', 1)
        .text(formatValue(d.value, measureField));
    });
  };

  // Set initial targets
  root.each(d => { d.target = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 }; });
  renderLabels();

  if (animate) {
    cell.style('opacity', 0)
      .transition().duration(500).ease(d3.easeCubicOut)
      .style('opacity', 1);
  }

  // --- Zoom ---
  let focus = root;
  // Stack of { node, scrollTop, scrollLeft } for restoring position on back-nav
  const navStack = [];

  const zoomTo = (p, isZoomOut) => {
    const wn = wrapper.node();

    // Save current scroll position before zooming in
    if (!isZoomOut && wn) {
      navStack.push({
        node: focus,
        scrollTop: wn.scrollTop,
        scrollLeft: wn.scrollLeft,
      });
    }

    // Pop saved position when zooming out
    const restored = isZoomOut ? navStack.pop() : null;

    focus = p;

    // How many leaves does the focused node have?
    const focusLeaves = p.leaves().length;
    const neededH = Math.max(viewH, focusLeaves * MIN_LEAF_H);

    // Recompute targets: p fills the full neededH vertically,
    // p.y0 becomes x=0 horizontally
    root.each(d => {
      d.target = {
        x0: (d.x0 - p.x0) / (p.x1 - p.x0) * neededH,
        x1: (d.x1 - p.x0) / (p.x1 - p.x0) * neededH,
        y0: d.y0 - p.y0,
        y1: d.y1 - p.y0,
      };
    });

    // When zooming out, set SVG to the LARGER of old and new height first
    // so the saved scroll position is valid, then shrink after transition.
    const prevH = parseFloat(svg.attr('height')) || viewH;
    if (isZoomOut && neededH < prevH) {
      // Keep SVG tall for now; restore scroll immediately (no animation)
      if (wn && restored) {
        wn.scrollTop = restored.scrollTop;
        wn.scrollLeft = restored.scrollLeft;
      }
    } else {
      // Zooming in: grow SVG immediately, scroll to top after transition
      svg.attr('height', neededH);
    }

    // Animate cells
    const t = cell.transition().duration(600).ease(d3.easeCubicInOut)
      .attr('transform', d => `translate(${d.target.y0},${d.target.x0})`);

    rect.transition(t)
      .attr('width', d => Math.max(0, d.target.y1 - d.target.y0))
      .attr('height', d => Math.max(0, d.target.x1 - d.target.x0));

    // Update clip paths
    root.each(d => {
      if (d._clipIdx != null) {
        defs.select(`#ic-clip-${d._clipIdx} rect`)
          .transition().duration(600)
          .attr('width', Math.max(0, d.target.y1 - d.target.y0))
          .attr('height', Math.max(0, d.target.x1 - d.target.x0));
      }
    });

    // After transition: shrink SVG to final size, re-render labels
    t.end().then(() => {
      svg.attr('height', neededH);
      renderLabels();
      if (!isZoomOut && wn) {
        wn.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }).catch(() => {});
  };

  // --- Tooltip ---
  const showTooltipFn = (event, d) => {
    const pct = grandTotal > 0 ? ((d.value / grandTotal) * 100).toFixed(1) : '0';
    const ancestors = d.ancestors().filter(a => a.depth > 0).reverse();
    const path = ancestors.map(a => getDisplayName(a.data.name)).join(' › ');
    const isGroup = !!d.children;

    let html = `<div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">`;
    html += `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${getNodeColor(d)};margin-right:6px;vertical-align:middle;"></span>`;
    html += `${path || getDisplayName(d.data.name)}</div>`;
    html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">${getDisplayName(measureField)}:</span>`;
    html += `<span style="font-weight:600;margin-left:auto;">${formatValue(d.value, measureField)}</span></div>`;
    html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Share:</span>`;
    html += `<span style="font-weight:600;margin-left:auto;">${pct}%</span></div>`;
    if (isGroup) {
      html += `<div style="display:flex;gap:8px;margin:3px 0;"><span style="color:#a0a0b0;">Items:</span>`;
      html += `<span style="font-weight:600;margin-left:auto;">${d.leaves().length}</span></div>`;
    }
    tooltip.html(html).style('visibility', 'visible').style('opacity', '1')
      .style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
  };

  const hideTooltip = () => { tooltip.style('visibility', 'hidden').style('opacity', '0'); };

  // --- Interactions ---
  rect
    .on('mouseover', function(event, d) {
      d3.select(this).style('filter', 'brightness(1.12)');
      showTooltipFn(event, d);
    })
    .on('mousemove', function(event) {
      tooltip.style('left', `${event.clientX + 15}px`).style('top', `${event.clientY - 10}px`);
    })
    .on('mouseout', function() {
      d3.select(this).style('filter', null);
      hideTooltip();
    })
    .on('click', function(event, d) {
      if (!d.children) return;
      event.stopPropagation();
      if (d === focus) {
        zoomTo(d.parent || root, true);
      } else {
        zoomTo(d, false);
      }
    });

  return {
    update: () => {},
    destroy: () => {
      d3.select(container).selectAll('*').remove();
      tooltip.remove();
    },
  };
};
