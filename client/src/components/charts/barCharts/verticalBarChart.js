import * as d3 from 'd3';
import {
  DEFAULT_COLORS, STYLES, getRowValue, toPrimitive, getUniqueValues,
  getFieldAggregation, getAggregationFunction,
  truncateLabel, createTooltip, createTooltipFormatter,
  createBarHandlers, applyBarHandlers, applyStackedBarHandlers,
  styleAxisLines, renderHorizontalGrid, addLegend,
  parseChartOptions, parseChartConfig, createChartScaffold,
  initFocusState, resolveGroupKeys, computeClusteredAggData,
  computeClusteredMaxVal, buildStackData,
  finalizeChart, createTrellisChart,
  createDisplayNameGetter, smartAxisFormat,
} from './shared';

const getTextAnchor = (angle) => angle < 0 ? 'end' : angle > 0 ? 'start' : 'middle';
const getDominantBaseline = (angle) => Math.abs(angle) === 90 ? 'central' : 'auto';
const getLabelFontSize = (barWidth) => barWidth < 20 ? '7px' : barWidth < 30 ? '8px' : barWidth < 50 ? '9px' : '10px';

const renderXAxis = (axisGroup, scale, options = {}) => {
  const { categoryWidth = 50, showEveryNth = 1, rotate = true, maxLabelLen = 20 } = options;
  const fontSize = categoryWidth < 30 ? STYLES.axis.smallFontSize : STYLES.axis.fontSize;
  axisGroup.call(d3.axisBottom(scale)).selectAll('text')
    .style('fill', STYLES.axis.textColor).style('font-size', fontSize)
    .attr('transform', rotate ? 'rotate(-45)' : null)
    .style('text-anchor', rotate ? 'end' : 'middle')
    .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0)
    .text(d => truncateLabel(d, maxLabelLen));
};

const renderYAxis = (axisGroup, scale, chartHeight) => {
  const tickCount = Math.max(2, Math.min(5, Math.floor((chartHeight || 200) / 40)));
  axisGroup.call(d3.axisLeft(scale).ticks(tickCount).tickFormat(smartAxisFormat))
    .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
};

const renderClusteredXAxis = (axisGroup, x0, x1, groupKeys, options = {}) => {
  const { categoryWidth, showEveryNth = 1, showClusterLabels = true, topLabelGroup, height, labelFormatter } = options;
  axisGroup.selectAll('*').remove();

  const categoryTicks = axisGroup.selectAll('.category-tick')
    .data(x0.domain()).enter().append('g').attr('class', 'category-tick')
    .attr('transform', d => `translate(${x0(d) + x0.bandwidth() / 2}, 0)`);

  if (topLabelGroup) {
    topLabelGroup.selectAll('.top-category-label').remove();
    const catFont = categoryWidth < 50 ? '10px' : '11px';
    const catMaxLen = categoryWidth < 50 ? 10 : 20;
    topLabelGroup.selectAll('.top-category-label').data(x0.domain()).enter().append('text')
      .attr('class', 'top-category-label')
      .attr('x', d => x0(d) + x0.bandwidth() / 2).attr('y', -8)
      .attr('text-anchor', 'middle').style('fill', STYLES.axis.textColor)
      .style('font-size', catFont).style('font-weight', '600')
      .style('opacity', (d, i) => i % showEveryNth === 0 ? 1 : 0)
      .text(d => truncateLabel(d, catMaxLen));
  }

  if (showClusterLabels) {
    const bw = x1.bandwidth();
    const cf = bw < 15 ? '8px' : bw < 25 ? '9px' : '10px';
    const ml = bw < 15 ? 10 : bw < 25 ? 14 : 20;
    categoryTicks.selectAll('.cluster-label')
      .data(d => groupKeys.map(k => ({ category: d, cluster: k })))
      .enter().append('text').attr('class', 'cluster-label')
      .attr('x', d => x1(d.cluster) - x0.bandwidth() / 2 + x1.bandwidth() / 2)
      .attr('y', 12).attr('text-anchor', 'end')
      .attr('transform', d => {
        const lx = x1(d.cluster) - x0.bandwidth() / 2 + x1.bandwidth() / 2;
        return `rotate(-45, ${lx}, 12)`;
      })
      .style('fill', '#9ca3af').style('font-size', cf).style('font-weight', '500')
      .text(d => truncateLabel(labelFormatter ? labelFormatter(d.cluster) : d.cluster, ml));
  }

  if (categoryWidth > 30) {
    categoryTicks.append('line')
      .attr('x1', -x0.bandwidth() / 2).attr('x2', -x0.bandwidth() / 2)
      .attr('y1', 0).attr('y2', showClusterLabels ? 55 : 15)
      .style('stroke', 'rgba(100, 100, 120, 0.15)').style('stroke-width', 1)
      .style('opacity', (d, i) => i === 0 ? 0 : 1);
  }
};

const renderBarLabels = (container, labelsData, options) => {
  const { x, y, barWidth, labelAngle, formatValue, getTextColor } = options;
  if (barWidth < 12) return;

  const useAngle = labelAngle !== 0;
  const textAnchor = getTextAnchor(labelAngle);
  const fontSize = getLabelFontSize(barWidth);
  const yMax = y(0);

  labelsData.forEach(({ xPos, value, fieldName }) => {
    if (value <= 0) return;
    const barTop = y(value);
    if (yMax - barTop < 14) return;
    const labelX = xPos;
    const labelY = barTop - 5;
    container.append('text').attr('class', 'bar-label')
      .attr('x', labelX).attr('y', labelY)
      .attr('text-anchor', textAnchor)
      .attr('dominant-baseline', getDominantBaseline(labelAngle))
      .attr('transform', useAngle ? `rotate(${-labelAngle}, ${labelX}, ${labelY})` : null)
      .style('font-size', fontSize)
      .style('fill', getTextColor(fieldName) || STYLES.label.color)
      .style('pointer-events', 'none')
      .text(formatValue(value, fieldName));
  });
};

export const createVerticalBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const hasClusterField = !!(config.marks?.cluster || config.clusterField);
  const hideXAxis = options.hideXAxis || false;
  const compactMargins = options.compactMargins || false;
  const labelAngle = options.labelAngle || 0;
  const compactOffset = compactMargins
    ? { top: -10, bottom: hideXAxis ? -30 : -10, left: -10, right: -10 }
    : { top: 0, bottom: 0, left: 0, right: 0 };

  const opts = parseChartOptions(container, options, {
    defaultMargin: options.margin || { top: 20, right: 20, bottom: 45, left: 50 },
    extraTop: (hasClusterField ? 20 : 0) + compactOffset.top,
    extraBottom: (hasClusterField ? 45 : 0) + compactOffset.bottom,
    extraLeft: compactOffset.left,
    extraRight: compactOffset.right,
  });

  const { showLegend, legendPosition, xAxisTitle, yAxisTitle, showGrid, showLabels, animate,
    colors, sharedColorScale, formatValue, getDisplayName, getTextColor, margin, width, height } = opts;

  const { processedData, mode, categoryField, seriesFields, colorField, clusterField, tooltipFields } = parseChartConfig(data, config);
  const xField = categoryField;

  const { svg, g, gridGroup, barsGroup, labelsGroup, xAxisGroup, yAxisGroup } = createChartScaffold(container, width, height, margin);
  const focusState = initFocusState(() => barsGroup);

  const tooltip = createTooltip();
  const formatTooltip = createTooltipFormatter(xField, tooltipFields, formatValue, getDisplayName);
  const barHandlers = createBarHandlers(tooltip, formatTooltip, xField, clusterField, focusState);

  const renderClustered = () => {
    const xCategories = getUniqueValues(processedData, xField);
    const x0 = d3.scaleBand().domain(xCategories).range([0, width]).padding(0.2);
    const { groupKeys, useClusterField } = resolveGroupKeys(processedData, config, seriesFields, clusterField);
    const x1 = d3.scaleBand().domain(groupKeys).range([0, x0.bandwidth()]).padding(0.05);
    const maxVal = computeClusteredMaxVal(processedData, config, seriesFields, xField, clusterField, groupKeys, useClusterField, { absolute: true });
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([height, 0]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(groupKeys).range(colors);

    renderHorizontalGrid(gridGroup, y, width, showGrid, height);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

    let bars;
    if (useClusterField) {
      const aggData = computeClusteredAggData(processedData, config, seriesFields, xField, clusterField);
      const catGroups = barsGroup.selectAll('.category-group')
        .data(xCategories).enter().append('g').attr('class', 'category-group')
        .attr('transform', d => `translate(${x0(d)},0)`);
      bars = catGroups.selectAll('.bar')
        .data(xVal => groupKeys.map(cv => ({
          key: cv, value: (aggData.get(xVal) || new Map()).get(cv) || 0,
          _xVal: xVal, _seriesName: cv, _clusterValue: cv,
        })))
        .enter().append('rect').attr('class', 'bar')
        .attr('x', d => x1(d.key)).attr('width', x1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');
    } else {
      const catGroups = barsGroup.selectAll('.category-group')
        .data(processedData).enter().append('g').attr('class', 'category-group')
        .attr('transform', d => `translate(${x0(getRowValue(d, xField))},0)`);
      bars = catGroups.selectAll('.bar')
        .data(d => groupKeys.map(key => ({
          key, value: getRowValue(d, key) || 0,
          _data: d, _seriesName: key, _xVal: getRowValue(d, xField),
        })))
        .enter().append('rect').attr('class', 'bar')
        .attr('x', d => x1(d.key)).attr('width', x1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');
    }

    if (animate) {
      bars.attr('y', height).attr('height', 0).transition().duration(600).delay((d, i) => i * 30)
        .attr('y', d => y(Math.max(0, d.value))).attr('height', d => Math.abs(y(0) - y(d.value)));
    } else {
      bars.attr('y', d => y(Math.max(0, d.value))).attr('height', d => Math.abs(y(0) - y(d.value)));
    }

    applyBarHandlers(bars, barHandlers);

    if (showLabels) {
      const ld = [];
      if (useClusterField) {
        const aggData = computeClusteredAggData(processedData, config, seriesFields, xField, clusterField);
        xCategories.forEach(xVal => {
          const cm = aggData.get(xVal) || new Map();
          groupKeys.forEach(cv => { ld.push({ xPos: x0(xVal) + x1(cv) + x1.bandwidth() / 2, value: cm.get(cv) || 0, fieldName: cv }); });
        });
      } else {
        processedData.forEach(d => {
          groupKeys.forEach(key => {
            ld.push({ xPos: x0(getRowValue(d, xField)) + x1(key) + x1.bandwidth() / 2, value: getRowValue(d, key) || 0, fieldName: key });
          });
        });
      }
      renderBarLabels(labelsGroup, ld, { x: x0, y, barWidth: x1.bandwidth(), labelAngle, formatValue, getTextColor });
    }

    const catW = x0.bandwidth();
    const showEvN = Math.ceil(30 / Math.max(catW, 1));
    if (!hideXAxis) {
      if (groupKeys.length > 1) {
        renderClusteredXAxis(xAxisGroup, x0, x1, groupKeys, {
          categoryWidth: catW, showEveryNth: showEvN, showClusterLabels: x1.bandwidth() >= 15,
          topLabelGroup: g, height, labelFormatter: useClusterField ? null : (k) => getDisplayName(k),
        });
      } else {
        renderXAxis(xAxisGroup, x0, { categoryWidth: catW, showEveryNth: showEvN, maxLabelLen: catW < 30 ? 6 : 20 });
      }
    }
    renderYAxis(yAxisGroup, y);
    styleAxisLines(g);
    return { x0, x1, y, colorScale, isClustered: groupKeys.length > 1 };
  };

  const renderStacked = () => {
    const xCategories = getUniqueValues(processedData, xField);
    if (xCategories.length === 0) return { x: null, y: null, colorScale: null };
    const x = d3.scaleBand().domain(xCategories).range([0, width]).padding(0.2);
    const { stackKeys, stackData } = buildStackData(processedData, xCategories, xField, colorField, seriesFields, '_xVal');
    if (stackKeys.length === 0) {
      if (colorField && seriesFields.length > 0) return renderClustered();
      return { x: null, y: null, colorScale: null };
    }

    const stackedData = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetNone)(stackData);
    const maxVal = d3.max(stackedData, layer => d3.max(layer, d => d[1])) || 0;
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([height, 0]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);

    renderHorizontalGrid(gridGroup, y, width, showGrid, height);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

    const layers = barsGroup.selectAll('.layer').data(stackedData).enter().append('g')
      .attr('class', 'layer').attr('fill', d => colorScale(d.key));
    const bars = layers.selectAll('.bar')
      .data(d => d.map((item, i) => ({ ...item, key: d.key, _seriesName: d.key, _xCategory: xCategories[i] })))
      .enter().append('rect').attr('class', 'bar')
      .attr('x', d => x(d._xCategory)).attr('width', x.bandwidth())
      .attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');

    if (animate) {
      bars.attr('y', height).attr('height', 0).transition().duration(600).delay((d, i) => i * 20)
        .attr('y', d => y(d[1])).attr('height', d => Math.max(0, y(d[0]) - y(d[1])));
    } else {
      bars.attr('y', d => y(d[1])).attr('height', d => Math.max(0, y(d[0]) - y(d[1])));
    }

    applyStackedBarHandlers(bars, tooltip, formatTooltip, xField, '_xCategory', focusState);

    if (showLabels) {
      const ld = xCategories.map((xCat, i) => ({
        xPos: x(xCat) + x.bandwidth() / 2,
        value: stackedData[stackedData.length - 1]?.[i]?.[1] || 0,
        fieldName: seriesFields[0] || 'value'
      }));
      renderBarLabels(labelsGroup, ld, { x, y, barWidth: x.bandwidth(), labelAngle, formatValue, getTextColor });
    }

    const catW = x.bandwidth();
    const showEvN = Math.ceil(30 / Math.max(catW, 1));
    if (!hideXAxis) renderXAxis(xAxisGroup, x, { categoryWidth: catW, showEveryNth: showEvN, maxLabelLen: catW < 30 ? 6 : 20 });
    renderYAxis(yAxisGroup, y);
    styleAxisLines(g);
    return { x, y, colorScale };
  };

  const renderClusteredStacked = () => {
    const groupField = clusterField || config.marks?.detail || seriesFields[1];
    const stackField = colorField || seriesFields[0];
    const measureField = seriesFields[0];
    if (!groupField || !stackField) return renderStacked();

    const xCategories = getUniqueValues(processedData, xField);
    if (xCategories.length === 0) return { x0: null, x1: null, y: null, colorScale: null };
    const x0 = d3.scaleBand().domain(xCategories).range([0, width]).padding(0.2);
    const groupKeys = getUniqueValues(processedData, groupField);
    if (groupKeys.length === 0) return renderStacked();
    const x1 = d3.scaleBand().domain(groupKeys).range([0, x0.bandwidth()]).padding(0.05);
    const stackKeys = getUniqueValues(processedData, stackField);
    if (stackKeys.length === 0) return renderStacked();

    let maxVal = 0;
    xCategories.forEach(xVal => {
      const xGroup = processedData.filter(d => getRowValue(d, xField) === xVal);
      groupKeys.forEach(gKey => {
        const gGroup = xGroup.filter(d => getRowValue(d, groupField) === gKey);
        const sum = stackKeys.reduce((acc, sKey) => {
          const item = gGroup.find(d => getRowValue(d, stackField) === sKey);
          return acc + (item ? (getRowValue(item, measureField) || 0) : 0);
        }, 0);
        if (sum > maxVal) maxVal = sum;
      });
    });

    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([height, 0]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);
    const stack = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetNone);

    renderHorizontalGrid(gridGroup, y, width, showGrid, height);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

    const ld = [];
    let barIdx = 0;

    xCategories.forEach(xVal => {
      const xGroup = processedData.filter(d => getRowValue(d, xField) === xVal);
      const xG = barsGroup.append('g').attr('transform', `translate(${x0(xVal)},0)`);
      groupKeys.forEach(gKey => {
        const gGroup = xGroup.filter(d => getRowValue(d, groupField) === gKey);
        const stackObj = { _groupKey: gKey };
        stackKeys.forEach(sKey => {
          const item = gGroup.find(d => getRowValue(d, stackField) === sKey);
          stackObj[sKey] = item ? (getRowValue(item, measureField) || 0) : 0;
        });
        const stackedGroup = stack([stackObj]);
        const gG = xG.append('g').attr('transform', `translate(${x1(gKey)},0)`);
        let groupTotal = 0;
        stackedGroup.forEach(layer => {
          const d = layer[0];
          const bh = d[1] - d[0];
          groupTotal = d[1];
          if (bh > 0) {
            const bar = gG.append('rect').attr('class', 'bar').attr('x', 0).attr('width', x1.bandwidth())
              .attr('fill', colorScale(layer.key)).attr('rx', STYLES.bar.borderRadius)
              .datum({ ...d, key: layer.key, _groupKey: gKey, _xVal: xVal, _seriesName: layer.key })
              .style('cursor', 'pointer');
            if (animate) {
              bar.attr('y', height).attr('height', 0).transition().duration(600).delay(barIdx * 15)
                .attr('y', y(d[1])).attr('height', y(d[0]) - y(d[1]));
            } else { bar.attr('y', y(d[1])).attr('height', y(d[0]) - y(d[1])); }
            bar.on('mouseover', function(event, d) {
                d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
                tooltip.html(`<div style="font-weight:600;margin-bottom:6px;">${d._xVal}</div>
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
        if (showLabels && groupTotal > 0) {
          ld.push({ xPos: x0(xVal) + x1(gKey) + x1.bandwidth() / 2, value: groupTotal, fieldName: seriesFields[0] || 'value' });
        }
      });
    });

    if (showLabels) renderBarLabels(labelsGroup, ld, { x: x0, y, barWidth: x1.bandwidth(), labelAngle, formatValue, getTextColor });

    const catW = x0.bandwidth();
    const showEvN = Math.ceil(30 / Math.max(catW, 1));
    if (!hideXAxis) {
      renderClusteredXAxis(xAxisGroup, x0, x1, groupKeys, {
        categoryWidth: catW, showEveryNth: showEvN, showClusterLabels: x1.bandwidth() >= 15,
        topLabelGroup: g, height,
      });
    }
    renderYAxis(yAxisGroup, y);
    styleAxisLines(g);
    return { x0, x1, y, colorScale, isClustered: true };
  };

  let scales;
  switch (mode) {
    case 'stacked': case 'trellis-stacked': scales = renderStacked(); break;
    case 'clustered-stacked': case 'trellis-clustered-stacked': scales = renderClusteredStacked(); break;
    default: scales = renderClustered();
  }

  const activeXScale = scales?.x0 || scales?.x || null;
  const activeX1Scale = scales?.x1 || null;
  const activeYScale = scales?.y || null;
  const hasClusteredAxis = !!scales?.isClustered;

  const setupZoom = () => {
    const zoom = d3.zoom().scaleExtent([1, 8])
      .translateExtent([[0, 0], [width, height]]).extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
        const t = event.transform;
        barsGroup.attr('transform', t);
        labelsGroup.attr('transform', t);

        if (activeXScale) {
          const zoomedX = activeXScale.copy().range([t.applyX(0), t.applyX(width)]);
          if (hasClusteredAxis) {
            const newBW = zoomedX.bandwidth();
            xAxisGroup.selectAll('.category-tick')
              .attr('transform', d => `translate(${zoomedX(d) + newBW / 2}, 0)`)
              .style('opacity', d => {
                const pos = zoomedX(d) + newBW / 2;
                return pos < -40 || pos > width + 40 ? 0 : pos < 0 || pos > width ? 0.3 : 1;
              });
            if (activeX1Scale) {
              const zoomedX1 = activeX1Scale.copy().range([0, newBW]);
              xAxisGroup.selectAll('.cluster-label').each(function(d) {
                const lx = zoomedX1(d.cluster) - newBW / 2 + zoomedX1.bandwidth() / 2;
                d3.select(this).attr('x', lx).attr('transform', `rotate(-45, ${lx}, 12)`);
              });
            }
            xAxisGroup.selectAll('.category-tick line').attr('x1', -newBW / 2).attr('x2', -newBW / 2);
            g.selectAll('.top-category-label')
              .attr('x', d => zoomedX(d) + newBW / 2)
              .style('opacity', d => {
                const pos = zoomedX(d) + newBW / 2;
                return pos < -40 || pos > width + 40 ? 0 : pos < 0 || pos > width ? 0.3 : 1;
              });
          } else {
            xAxisGroup.call(d3.axisBottom(zoomedX).tickSizeOuter(0));
            xAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize)
              .text(d => truncateLabel(d, 20));
            xAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);
          }
        }

        if (activeYScale) {
          const zy = t.rescaleY(activeYScale);
          const zoomYTicks = Math.max(2, Math.min(5, Math.floor(height / 40)));
          yAxisGroup.call(d3.axisLeft(zy).ticks(zoomYTicks).tickFormat(smartAxisFormat));
          yAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
          yAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);
          gridGroup.selectAll('*').remove();
          if (showGrid) {
            gridGroup.selectAll('.grid-line').data(zy.ticks(zoomYTicks)).enter().append('line')
              .attr('class', 'grid-line').attr('x1', 0).attr('x2', width)
              .attr('y1', d => zy(d)).attr('y2', d => zy(d))
              .style('stroke', STYLES.grid.lineColor);
          }
        }

        labelsGroup.style('opacity', t.k > 1.5 ? Math.max(0, 1 - (t.k - 1.5) / 2) : 1);
      });

    svg.call(zoom);
    svg.on('dblclick.zoom', () => svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity));
  };

  setupZoom();

  return finalizeChart({
    svg, g, scales, showLegend, legendPosition, width, height, margin,
    getDisplayName, xAxisTitle, yAxisTitle, focusState, tooltip,
    createChartFn: createVerticalBarChart, container, config, data, options,
  });
};

export const createMeasureRowsBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const seriesFields = (config.series || []).map(s => String(toPrimitive(s) ?? s));
  if (seriesFields.length <= 1) return createVerticalBarChart(container, config, data, options);

  const { colors = DEFAULT_COLORS, columnAliases = {} } = options;
  const getDisplayName = createDisplayNameGetter(columnAliases);
  const measureCount = seriesFields.length;
  const containerRect = container.getBoundingClientRect();
  const totalWidth = options.width || containerRect.width || 600;
  const totalHeight = options.height || containerRect.height || 400;
  const rowGap = 8;
  const measureLabelWidth = 90;
  const rowHeight = Math.max(80, (totalHeight - (measureCount - 1) * rowGap) / measureCount);

  d3.select(container).selectAll('*').remove();
  const wrapper = d3.select(container).append('div')
    .style('display', 'flex').style('flex-direction', 'column')
    .style('width', '100%').style('height', '100%').style('gap', `${rowGap}px`);

  const subCharts = [];
  const detailField = config.marks?.detail;
  const hasDetailMark = detailField && (Array.isArray(detailField) ? detailField.length > 0 : true);

  seriesFields.forEach((measureField, rowIndex) => {
    const isLastRow = rowIndex === measureCount - 1;
    const barColor = colors[rowIndex % colors.length];

    const rowDiv = wrapper.append('div')
      .style('display', 'flex').style('flex', '1').style('min-height', `${rowHeight}px`).style('align-items', 'stretch');

    rowDiv.append('div')
      .style('width', `${measureLabelWidth}px`).style('display', 'flex')
      .style('align-items', 'center').style('justify-content', 'flex-end')
      .style('padding-right', '10px').style('font-size', '11px').style('font-weight', '600')
      .style('color', barColor).style('white-space', 'nowrap')
      .style('overflow', 'hidden').style('text-overflow', 'ellipsis')
      .text(getDisplayName(measureField));

    const chartContainer = rowDiv.append('div')
      .style('flex', '1').style('position', 'relative').style('min-width', '0').node();

    const rowConfig = { ...config, series: [measureField] };
    const rowOptions = {
      ...options, height: rowHeight, width: totalWidth - measureLabelWidth,
      showLegend: rowIndex === 0 && options.showLegend !== false,
      legendPosition: options.legendPosition || 'right',
      colors: [barColor, ...colors.filter((_, i) => i !== rowIndex % colors.length)],
      hideXAxis: !isLastRow, compactMargins: true,
    };

    const subChart = hasDetailMark
      ? createTrellisVerticalBarChart(chartContainer, rowConfig, data, rowOptions)
      : createVerticalBarChart(chartContainer, rowConfig, data, rowOptions);
    subCharts.push(subChart);

    if (!isLastRow) {
      wrapper.append('div').style('height', '1px')
        .style('background', 'rgba(100, 100, 120, 0.15)').style('margin', '0 10px');
    }
  });

  return {
    update: (nc, nd) => createMeasureRowsBarChart(container, nc || config, nd || data, options),
    destroy: () => { subCharts.forEach(c => c?.destroy?.()); d3.select(container).selectAll('*').remove(); },
  };
};

export const createTrellisVerticalBarChart = (container, config, data, options = {}) =>
  createTrellisChart(container, config, data, options, createVerticalBarChart, {
    gridColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    panelWidth: 250, panelHeight: 180,
    panelMargin: { top: 20, right: 15, bottom: 40, left: 45 },
  });
