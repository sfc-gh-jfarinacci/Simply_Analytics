import * as d3 from 'd3';
import {
  DEFAULT_COLORS, STYLES, getRowValue, toPrimitive, getUniqueValues,
  getFieldAggregation, getAggregationFunction,
  truncateLabel, createTooltip, createTooltipFormatter,
  createBarHandlers, applyBarHandlers, applyStackedBarHandlers,
  renderYCategoryAxis, renderClusteredYAxis, styleAxisLines,
  renderVerticalGrid,
  parseChartOptions, parseChartConfig, createChartScaffold,
  initFocusState, resolveGroupKeys, computeClusteredAggData,
  computeClusteredMaxVal, buildStackData,
  finalizeChart, createTrellisChart,
} from './shared';

const renderXValueAxis = (axisGroup, scale) => {
  axisGroup.call(d3.axisBottom(scale).ticks(5).tickFormat(d3.format('.2s')))
    .selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
};

const renderBarLabels = (container, labelsData, options) => {
  const { x, barHeight, formatValue, getTextColor } = options;
  labelsData.forEach(({ yPos, value, fieldName }) => {
    if (value <= 0 || barHeight < 12 || (x(value) - x(0)) < 20) return;
    container.append('text').attr('class', 'bar-label')
      .attr('x', x(value) + 4).attr('y', yPos)
      .attr('dominant-baseline', 'central').attr('text-anchor', 'start')
      .style('font-size', barHeight < 20 ? '8px' : '10px')
      .style('fill', getTextColor(fieldName) || STYLES.label.color)
      .style('pointer-events', 'none').text(formatValue(value, fieldName));
  });
};

export const createHorizontalBarChart = (container, config, data, options = {}) => {
  if (!container || !data || data.length === 0) return { update: () => {}, destroy: () => {} };

  const hasClusterField = !!(config.marks?.cluster || config.clusterField);
  const hideYAxis = options.hideYAxis || false;
  const compactMargins = options.compactMargins || false;
  const compactOffset = compactMargins
    ? { top: -10, bottom: -10, left: hideYAxis ? -30 : -10, right: -10 }
    : { top: 0, bottom: 0, left: 0, right: 0 };

  const opts = parseChartOptions(container, options, {
    defaultMargin: options.margin || { top: 20, right: 30, bottom: 35, left: 80 },
    extraTop: compactOffset.top,
    extraBottom: compactOffset.bottom,
    extraLeft: (hasClusterField ? 40 : 0) + compactOffset.left,
    extraRight: compactOffset.right,
  });

  const { showLegend, legendPosition, xAxisTitle, yAxisTitle, showGrid, showLabels, animate,
    colors, sharedColorScale, formatValue, getDisplayName, getTextColor, margin, width, height } = opts;

  const { processedData, mode, categoryField, seriesFields, colorField, clusterField, tooltipFields } = parseChartConfig(data, config);
  const yField = categoryField;

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
    const maxVal = computeClusteredMaxVal(processedData, config, seriesFields, yField, clusterField, groupKeys, useClusterField, { absolute: true });
    const x = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(groupKeys).range(colors);

    renderVerticalGrid(gridGroup, x, height, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

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
      bars.attr('x', 0).attr('width', 0).transition().duration(600).delay((d, i) => i * 30)
        .attr('x', 0).attr('width', d => x(Math.max(0, d.value)));
    } else {
      bars.attr('x', 0).attr('width', d => x(Math.max(0, d.value)));
    }

    applyBarHandlers(bars, barHandlers);

    if (showLabels) {
      const labelsData = [];
      if (useClusterField) {
        const aggData = computeClusteredAggData(processedData, config, seriesFields, yField, clusterField);
        yCategories.forEach(yVal => {
          const cm = aggData.get(yVal) || new Map();
          groupKeys.forEach(cv => { labelsData.push({ yPos: y0(yVal) + y1(cv) + y1.bandwidth() / 2, value: cm.get(cv) || 0, fieldName: cv }); });
        });
      } else {
        processedData.forEach(d => {
          groupKeys.forEach(key => {
            labelsData.push({ yPos: y0(getRowValue(d, yField)) + y1(key) + y1.bandwidth() / 2, value: getRowValue(d, key) || 0, fieldName: key });
          });
        });
      }
      renderBarLabels(labelsGroup, labelsData, { x, barHeight: y1.bandwidth(), formatValue, getTextColor });
    }

    const catH = y0.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) {
      if (groupKeys.length > 1) {
        renderClusteredYAxis(yAxisGroup, y0, y1, groupKeys, {
          categoryHeight: catH, showEveryNth: showEvN, showClusterLabels: y1.bandwidth() >= 12,
          labelFormatter: useClusterField ? null : (k) => getDisplayName(k),
        });
      } else {
        renderYCategoryAxis(yAxisGroup, y0, { categoryHeight: catH, showEveryNth: showEvN, maxLabelLen: 18 });
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
    if (stackKeys.length === 0) {
      if (colorField && seriesFields.length > 0) return renderClustered();
      return { y: null, x: null, colorScale: null };
    }

    const stackedData = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetNone)(stackData);
    const maxVal = d3.max(stackedData, layer => d3.max(layer, d => d[1])) || 0;
    const x = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);

    renderVerticalGrid(gridGroup, x, height, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

    const layers = barsGroup.selectAll('.layer').data(stackedData).enter().append('g')
      .attr('class', 'layer').attr('fill', d => colorScale(d.key));
    const bars = layers.selectAll('.bar')
      .data(d => d.map((item, i) => ({ ...item, key: d.key, _seriesName: d.key, _yCategory: yCategories[i] })))
      .enter().append('rect').attr('class', 'bar')
      .attr('y', d => y(d._yCategory)).attr('height', y.bandwidth())
      .attr('rx', STYLES.bar.borderRadius).style('cursor', 'pointer');

    if (animate) {
      bars.attr('x', 0).attr('width', 0).transition().duration(600).delay((d, i) => i * 20)
        .attr('x', d => x(d[0])).attr('width', d => Math.max(0, x(d[1]) - x(d[0])));
    } else {
      bars.attr('x', d => x(d[0])).attr('width', d => Math.max(0, x(d[1]) - x(d[0])));
    }

    applyStackedBarHandlers(bars, tooltip, formatTooltip, yField, '_yCategory', focusState);

    if (showLabels) {
      const labelsData = yCategories.map((yCat, i) => ({
        yPos: y(yCat) + y.bandwidth() / 2,
        value: stackedData[stackedData.length - 1]?.[i]?.[1] || 0,
        fieldName: seriesFields[0] || 'value'
      }));
      renderBarLabels(labelsGroup, labelsData, { x, barHeight: y.bandwidth(), formatValue, getTextColor });
    }

    const catH = y.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) renderYCategoryAxis(yAxisGroup, y, { categoryHeight: catH, showEveryNth: showEvN, maxLabelLen: 18 });
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

    let maxVal = 0;
    yCategories.forEach(yVal => {
      const yGroup = processedData.filter(d => getRowValue(d, yField) === yVal);
      groupKeys.forEach(gKey => {
        const gGroup = yGroup.filter(d => getRowValue(d, groupField) === gKey);
        const sum = stackKeys.reduce((acc, sKey) => {
          const item = gGroup.find(d => getRowValue(d, stackField) === sKey);
          return acc + (item ? (getRowValue(item, measureField) || 0) : 0);
        }, 0);
        if (sum > maxVal) maxVal = sum;
      });
    });

    const x = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([0, width]);
    const colorScale = sharedColorScale || d3.scaleOrdinal().domain(stackKeys).range(colors);
    const stack = d3.stack().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetNone);

    renderVerticalGrid(gridGroup, x, height, showGrid);
    barsGroup.selectAll('*').remove();
    labelsGroup.selectAll('*').remove();

    const labelsData = [];
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
        let groupTotal = 0;
        stackedGroup.forEach(layer => {
          const d = layer[0];
          const bw = d[1] - d[0];
          groupTotal = d[1];
          if (bw > 0) {
            const bar = gG.append('rect').attr('class', 'bar').attr('y', 0).attr('height', y1.bandwidth())
              .attr('fill', colorScale(layer.key)).attr('rx', STYLES.bar.borderRadius)
              .datum({ ...d, key: layer.key, _groupKey: gKey, _yVal: yVal, _seriesName: layer.key })
              .style('cursor', 'pointer');
            if (animate) {
              bar.attr('x', 0).attr('width', 0).transition().duration(600).delay(barIdx * 15)
                .attr('x', x(d[0])).attr('width', x(d[1]) - x(d[0]));
            } else { bar.attr('x', x(d[0])).attr('width', x(d[1]) - x(d[0])); }
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
        if (showLabels && groupTotal > 0) {
          labelsData.push({ yPos: y0(yVal) + y1(gKey) + y1.bandwidth() / 2, value: groupTotal, fieldName: seriesFields[0] || 'value' });
        }
      });
    });

    if (showLabels) renderBarLabels(labelsGroup, labelsData, { x, barHeight: y1.bandwidth(), formatValue, getTextColor });

    const catH = y0.bandwidth();
    const showEvN = Math.ceil(20 / Math.max(catH, 1));
    if (!hideYAxis) renderClusteredYAxis(yAxisGroup, y0, y1, groupKeys, { categoryHeight: catH, showEveryNth: showEvN, showClusterLabels: y1.bandwidth() >= 12 });
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

  const activeYScale = scales?.y0 || scales?.y || null;
  const activeY1Scale = scales?.y1 || null;
  const activeXScale = scales?.x || null;
  const hasClusteredAxis = !!scales?.isClustered;

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
            yAxisGroup.call(d3.axisLeft(zoomedY).tickSizeOuter(0));
            yAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize)
              .text(d => truncateLabel(d, 20));
            yAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);
          }
        }

        if (activeXScale) {
          const zx = t.rescaleX(activeXScale);
          xAxisGroup.call(d3.axisBottom(zx).ticks(5).tickFormat(d3.format('.2s')));
          xAxisGroup.selectAll('text').style('fill', STYLES.axis.textColor).style('font-size', STYLES.axis.fontSize);
          xAxisGroup.selectAll('line, path').style('stroke', STYLES.axis.lineColor);
          gridGroup.selectAll('*').remove();
          if (showGrid) {
            gridGroup.selectAll('.grid-line').data(zx.ticks(5)).enter().append('line')
              .attr('class', 'grid-line').attr('x1', d => zx(d)).attr('x2', d => zx(d))
              .attr('y1', 0).attr('y2', height).style('stroke', STYLES.grid.lineColor).style('stroke-dasharray', STYLES.grid.dashArray);
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
    createChartFn: createHorizontalBarChart, container, config, data, options,
  });
};

export const createTrellisHorizontalBarChart = (container, config, data, options = {}) =>
  createTrellisChart(container, config, data, options, createHorizontalBarChart);
