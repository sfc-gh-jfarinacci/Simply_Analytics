import * as d3 from 'd3';
import {
  DEFAULT_COLORS, STYLES, getRowValue, toPrimitive, getUniqueValues,
  getFieldAggregation, getAggregationFunction,
  truncateLabel, createTooltip, createTooltipFormatter,
  createBarHandlers, applyBarHandlers, applyStackedBarHandlers,
  renderYCategoryAxis, renderClusteredYAxis, styleAxisLines,
  renderVerticalGrid, addLegend,
  parseChartOptions, parseChartConfig, createChartScaffold,
  initFocusState, resolveGroupKeys, computeClusteredAggData,
  computeClusteredMaxVal, buildStackData,
  finalizeChart, createTrellisChart, smartAxisFormat,
} from './shared';

const barX = (x, value) => value >= 0 ? x(0) : x(value);
const barW = (x, value) => Math.abs(x(value) - x(0));

const renderCenterLine = (g, x, height) => {
  g.selectAll('.center-line').remove();
  g.append('line').attr('class', 'center-line')
    .attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', height)
    .style('stroke', STYLES.axis.lineColor).style('stroke-width', 1.5);
};

const renderXValueAxis = (axisGroup, scale, chartWidth) => {
  const tickCount = Math.max(2, Math.min(7, Math.floor((chartWidth || 300) / 70)));
  axisGroup.call(d3.axisBottom(scale).ticks(tickCount).tickFormat(smartAxisFormat))
    .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
};

export const createDivergingBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const hideYAxis = options.hideYAxis || false;

  const opts = parseChartOptions(container, options, {
    defaultMargin: options.margin || { top: 20, right: 30, bottom: 35, left: 100 },
  });

  const { showLegend, legendPosition, xAxisTitle, yAxisTitle, showGrid, showLabels, animate,
    colors, sharedColorScale, formatValue, getDisplayName, margin, width, height } = opts;

  const { processedData, mode, categoryField, seriesFields, colorField, clusterField, tooltipFields } = parseChartConfig(data, config);
  const yField = categoryField;
  const isTwoMeasure = seriesFields.length >= 2;

  const { svg, g, gridGroup, barsGroup, labelsGroup, xAxisGroup, yAxisGroup } = createChartScaffold(container, width, height, margin);
  const focusState = initFocusState(() => barsGroup);

  const tooltip = createTooltip();
  const formatTooltip = createTooltipFormatter(yField, tooltipFields, formatValue, getDisplayName);
  const barHandlers = createBarHandlers(tooltip, formatTooltip, yField, clusterField, focusState);

  const renderClustered = () => {
    const yCategories = getUniqueValues(processedData, yField);
    const y0 = d3.scaleBand().domain(yCategories).range([0, height]).padding(0.2);
    const { groupKeys, useClusterField } = resolveGroupKeys(processedData, config, seriesFields, clusterField);
    const y1 = d3.scaleBand().domain(groupKeys).range([0, y0.bandwidth()]).padding(0.05);

    let maxAbsVal;
    if (useClusterField) {
      maxAbsVal = computeClusteredMaxVal(processedData, config, seriesFields, yField, clusterField, groupKeys, useClusterField, { absolute: true });
    } else if (isTwoMeasure) {
      maxAbsVal = d3.max(processedData, d => Math.max(...seriesFields.map(k => Math.abs(getRowValue(d, k) || 0)))) || 0;
    } else {
      maxAbsVal = d3.max(processedData, d => d3.max(groupKeys, key => Math.abs(getRowValue(d, key) || 0))) || 0;
    }

    const x = d3.scaleLinear().domain([-maxAbsVal * 1.1, maxAbsVal * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(groupKeys).range(colors);

    renderVerticalGrid(gridGroup, x, height, showGrid, width);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();
    renderCenterLine(g, x, height);

    let bars;
    if (useClusterField) {
      const aggData = computeClusteredAggData(processedData, config, seriesFields, yField, clusterField);
      const catGroups = barsGroup.selectAll('.category-group')
        .data(yCategories).enter().append('g').attr('class', 'category-group')
        .attr('transform', d => `translate(0,${y0(d)})`);
      bars = catGroups.selectAll('.bar')
        .data(yVal => groupKeys.map(cv => ({
          key: cv, value: (aggData.get(yVal) || new Map()).get(cv) || 0,
          _yVal: yVal, _seriesName: cv, _clusterValue: cv,
        })))
        .enter().append('rect').attr('class', 'bar')
        .attr('y', d => y1(d.key)).attr('height', y1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');
    } else if (isTwoMeasure) {
      const catGroups = barsGroup.selectAll('.category-group')
        .data(processedData).enter().append('g').attr('class', 'category-group')
        .attr('transform', d => `translate(0,${y0(getRowValue(d, yField))})`);
      bars = catGroups.selectAll('.bar')
        .data(d => seriesFields.map((key, i) => {
          const raw = getRowValue(d, key) || 0;
          const value = i === 0 ? Math.abs(raw) : -Math.abs(raw);
          return { key, value, _data: d, _seriesName: key, _yVal: getRowValue(d, yField) };
        }))
        .enter().append('rect').attr('class', 'bar')
        .attr('y', d => y1(d.key)).attr('height', y1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');
    } else {
      const catGroups = barsGroup.selectAll('.category-group')
        .data(processedData).enter().append('g').attr('class', 'category-group')
        .attr('transform', d => `translate(0,${y0(getRowValue(d, yField))})`);
      bars = catGroups.selectAll('.bar')
        .data(d => groupKeys.map(key => ({
          key, value: getRowValue(d, key) || 0,
          _data: d, _seriesName: key, _yVal: getRowValue(d, yField),
        })))
        .enter().append('rect').attr('class', 'bar')
        .attr('y', d => y1(d.key)).attr('height', y1.bandwidth())
        .attr('fill', d => colorScale(d.key)).attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');
    }

    if (animate) {
      bars.attr('x', x(0)).attr('width', 0).transition().duration(600).delay((d, i) => i * 25)
        .attr('x', d => barX(x, d.value)).attr('width', d => barW(x, d.value));
    } else {
      bars.attr('x', d => barX(x, d.value)).attr('width', d => barW(x, d.value));
    }

    applyBarHandlers(bars, barHandlers);

    if (showLabels) {
      bars.each(function(d) {
        if (d.value === 0) return;
        const bx = d.value >= 0 ? x(d.value) + 4 : x(d.value) - 4;
        const anchor = d.value >= 0 ? 'start' : 'end';
        labelsGroup.append('text').attr('class', 'bar-label')
          .attr('x', bx).attr('y', y0(d._yVal) + y1(d.key) + y1.bandwidth() / 2)
          .attr('dominant-baseline', 'central').attr('text-anchor', anchor)
          .style('font-size', y1.bandwidth() < 20 ? '8px' : '10px')
          .style('fill', STYLES.label.color).style('pointer-events', 'none')
          .text(formatValue(Math.abs(d.value), d.key));
      });
    }

    const catH = y0.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) {
      if (groupKeys.length > 1) {
        renderClusteredYAxis(yAxisGroup, y0, y1, groupKeys, {
          categoryHeight: catH, showEveryNth: showEvN, showClusterLabels: y1.bandwidth() >= 12,
          labelFormatter: useClusterField ? null : (k) => getDisplayName(k), atX: x(0),
        });
      } else {
        renderYCategoryAxis(yAxisGroup, y0, { categoryHeight: catH, showEveryNth: showEvN, maxLabelLen: 18, atX: x(0) });
      }
    }

    renderXValueAxis(xAxisGroup, x);
    styleAxisLines(g);
    return { y0, y1, x, colorScale, isClustered: groupKeys.length > 1 };
  };

  const renderStacked = () => {
    const yCategories = getUniqueValues(processedData, yField);
    if (yCategories.length === 0) return { y: null, x: null, colorScale: null };
    const y = d3.scaleBand().domain(yCategories).range([0, height]).padding(0.2);
    const { stackKeys, stackData } = buildStackData(processedData, yCategories, yField, colorField, seriesFields, '_yVal');
    if (stackKeys.length === 0) return renderClustered();

    const stackedData = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetDiverging)(stackData);
    const extMin = d3.min(stackedData, layer => d3.min(layer, d => d[0])) || 0;
    const extMax = d3.max(stackedData, layer => d3.max(layer, d => d[1])) || 0;
    const maxExt = Math.max(Math.abs(extMin), Math.abs(extMax));
    const x = d3.scaleLinear().domain([-maxExt * 1.1, maxExt * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);

    renderVerticalGrid(gridGroup, x, height, showGrid, width);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();
    renderCenterLine(g, x, height);

    const layers = barsGroup.selectAll('.layer').data(stackedData).enter().append('g')
      .attr('class', 'layer').attr('fill', d => colorScale(d.key));
    const bars = layers.selectAll('.bar')
      .data(d => d.map((item, i) => ({ ...item, key: d.key, _seriesName: d.key, _yCategory: yCategories[i] })))
      .enter().append('rect').attr('class', 'bar')
      .attr('y', d => y(d._yCategory)).attr('height', y.bandwidth())
      .attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');

    if (animate) {
      bars.attr('x', x(0)).attr('width', 0).transition().duration(600).delay((d, i) => i * 20)
        .attr('x', d => x(Math.min(d[0], d[1]))).attr('width', d => Math.abs(x(d[1]) - x(d[0])));
    } else {
      bars.attr('x', d => x(Math.min(d[0], d[1]))).attr('width', d => Math.abs(x(d[1]) - x(d[0])));
    }

    applyStackedBarHandlers(bars, tooltip, formatTooltip, yField, '_yCategory', focusState);

    const catH = y.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) renderYCategoryAxis(yAxisGroup, y, { categoryHeight: catH, showEveryNth: showEvN, maxLabelLen: 18, atX: x(0) });
    renderXValueAxis(xAxisGroup, x);
    styleAxisLines(g);
    return { y, x, colorScale };
  };

  const renderClusteredStacked = () => {
    const groupField = clusterField || config.marks?.detail || seriesFields[1];
    const stackField = colorField || seriesFields[0];
    const measureField = seriesFields[0];
    if (!groupField || !stackField) return renderStacked();

    const yCategories = getUniqueValues(processedData, yField);
    if (yCategories.length === 0) return { y0: null, y1: null, x: null, colorScale: null };
    const y0 = d3.scaleBand().domain(yCategories).range([0, height]).padding(0.2);
    const groupKeys = getUniqueValues(processedData, groupField);
    if (groupKeys.length === 0) return renderStacked();
    const y1 = d3.scaleBand().domain(groupKeys).range([0, y0.bandwidth()]).padding(0.05);
    const stackKeys = getUniqueValues(processedData, stackField);
    if (stackKeys.length === 0) return renderStacked();

    let maxAbsVal = 0;
    yCategories.forEach(yVal => {
      const yGroup = processedData.filter(d => getRowValue(d, yField) === yVal);
      groupKeys.forEach(gKey => {
        const gGroup = yGroup.filter(d => getRowValue(d, groupField) === gKey);
        const sum = stackKeys.reduce((acc, sKey) => {
          const item = gGroup.find(d => getRowValue(d, stackField) === sKey);
          return acc + Math.abs(item ? (getRowValue(item, measureField) || 0) : 0);
        }, 0);
        if (sum > maxAbsVal) maxAbsVal = sum;
      });
    });

    const x = d3.scaleLinear().domain([-maxAbsVal * 1.1, maxAbsVal * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);
    const stack = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetDiverging);

    renderVerticalGrid(gridGroup, x, height, showGrid, width);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();
    renderCenterLine(g, x, height);

    let barIdx = 0;
    yCategories.forEach(yVal => {
      const yGroup = processedData.filter(d => getRowValue(d, yField) === yVal);
      const yG = barsGroup.append('g').attr('transform', `translate(0,${y0(yVal)})`);
      groupKeys.forEach(gKey => {
        const gGroup = yGroup.filter(d => getRowValue(d, groupField) === gKey);
        const stackObj = { _groupKey: gKey };
        stackKeys.forEach(sKey => {
          const item = gGroup.find(d => getRowValue(d, stackField) === sKey);
          stackObj[sKey] = item ? (getRowValue(item, measureField) || 0) : 0;
        });
        const stackedGroup = stack([stackObj]);
        const gG = yG.append('g').attr('transform', `translate(0,${y1(gKey)})`);
        stackedGroup.forEach(layer => {
          const d = layer[0];
          const bw = Math.abs(x(d[1]) - x(d[0]));
          if (bw > 0) {
            const bar = gG.append('rect').attr('class', 'bar').attr('y', 0).attr('height', y1.bandwidth())
              .attr('fill', colorScale(layer.key)).attr('rx', STYLES.bar.borderRadius)
              .datum({ ...d, key: layer.key, _groupKey: gKey, _yVal: yVal, _seriesName: layer.key })
              .style('cursor', 'pointer');
            if (animate) {
              bar.attr('x', x(0)).attr('width', 0).transition().duration(600).delay(barIdx * 15)
                .attr('x', x(Math.min(d[0], d[1]))).attr('width', bw);
            } else { bar.attr('x', x(Math.min(d[0], d[1]))).attr('width', bw); }
            bar.on('mouseover', function(event, d) {
                d3.select(this).attr('opacity', STYLES.bar.hoverOpacity);
                tooltip.html(`<div style="font-weight:600;margin-bottom:6px;">${d._yVal}</div>
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
      });
    });

    const catH = y0.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) renderClusteredYAxis(yAxisGroup, y0, y1, groupKeys, { categoryHeight: catH, showEveryNth: showEvN, showClusterLabels: y1.bandwidth() >= 12, atX: x(0) });
    renderXValueAxis(xAxisGroup, x);
    styleAxisLines(g);
    return { y0, y1, x, colorScale, isClustered: true };
  };

  let scales;
  switch (mode) {
    case 'stacked': case 'trellis-stacked': scales = renderStacked(); break;
    case 'clustered-stacked': case 'trellis-clustered-stacked': scales = renderClusteredStacked(); break;
    default: scales = renderClustered();
  }

  let activeYScale = scales?.y0 || scales?.y || null;
  let activeY1Scale = scales?.y1 || null;
  let activeXScale = scales?.x || null;
  let hasClusteredAxis = !!scales?.isClustered;

  const yAxisBaseX = activeXScale ? activeXScale(0) : 0;

  const setupZoom = () => {
    const zoom = d3.zoom().scaleExtent([1, 8])
      .translateExtent([[0, 0], [width, height]]).extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
        const t = event.transform;
        barsGroup.attr('transform', t);
        labelsGroup.attr('transform', t);

        if (activeYScale) {
          const zoomedY = activeYScale.copy().range([t.applyY(0), t.applyY(height)]);
          if (hasClusteredAxis) {
            const newBW = zoomedY.bandwidth();
            yAxisGroup.selectAll('.category-tick')
              .attr('transform', d => `translate(0, ${zoomedY(d) + newBW / 2})`)
              .style('opacity', d => {
                const pos = zoomedY(d) + newBW / 2;
                return pos < -40 || pos > height + 40 ? 0 : pos < 0 || pos > height ? 0.3 : 1;
              });
            if (activeY1Scale) {
              const zoomedY1 = activeY1Scale.copy().range([0, newBW]);
              yAxisGroup.selectAll('.cluster-label')
                .attr('y', d => zoomedY1(d.cluster) - newBW / 2 + zoomedY1.bandwidth() / 2);
            }
            yAxisGroup.selectAll('.category-tick line').attr('y1', -newBW / 2).attr('y2', -newBW / 2);
          } else {
            yAxisGroup.attr('transform', `translate(${yAxisBaseX}, 0)`);
            yAxisGroup.call(d3.axisLeft(zoomedY).tickSizeOuter(0));
            yAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize)
              .text(d => truncateLabel(d, 20));
            yAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);
          }
        }

        if (activeXScale) {
          const zx = t.rescaleX(activeXScale);
          const zoomXTicks = Math.max(2, Math.min(7, Math.floor(width / 70)));
          xAxisGroup.call(d3.axisBottom(zx).ticks(zoomXTicks).tickFormat(smartAxisFormat));
          xAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
          xAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);
          g.selectAll('.center-line').attr('x1', zx(0)).attr('x2', zx(0));
          gridGroup.selectAll('*').remove();
          if (showGrid) {
            gridGroup.selectAll('.grid-line').data(zx.ticks(zoomXTicks)).enter().append('line')
              .attr('class', 'grid-line').attr('x1', d => zx(d)).attr('x2', d => zx(d))
              .attr('y1', 0).attr('y2', height).style('stroke', STYLES.grid.lineColor);
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
    createChartFn: createDivergingBarChart, container, config, data, options,
  });
};

export const createTrellisDivergingBarChart = (container, config, data, options = {}) =>
  createTrellisChart(container, config, data, options, createDivergingBarChart);
