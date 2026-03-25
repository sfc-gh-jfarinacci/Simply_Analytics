/**
 * React Wrapper for D3.js Pie / Donut / Radial Chart
 *
 * Props:
 *  - variant: 'pie' | 'donut' | 'radial'
 *  - data, config, query, fieldAggregations (same as other chart wrappers)
 */
import React, { useRef, useEffect, useState } from 'react';
import { createPieChart, createTrellisPieChart } from './pieChart';

const toFieldName = (v) => {
  if (v == null) return v;
  if (typeof v !== 'object') return String(v);
  if (v.name != null) return String(v.name);
  if (v.value != null) return String(v.value);
  if (v.label != null) return String(v.label);
  const first = Object.values(v).find(x => x != null && typeof x !== 'object');
  return first != null ? String(first) : null;
};

const queryToConfig = (query) => {
  const xAxis = toFieldName((query?.xAxis || query?.columns || [])[0]);
  const series = (query?.measures || []).map(toFieldName);

  const marks = {
    color: toFieldName(query?.colorField || query?.marks?.color),
    detail: toFieldName(query?.detailFields?.[0] || query?.marks?.detail),
    cluster: toFieldName(query?.clusterField || query?.marks?.cluster),
    tooltip: (query?.tooltipFields || query?.marks?.tooltip || []).map(toFieldName),
  };

  const sorts = {};
  if (query?.sorts) {
    query.sorts.forEach(s => { if (s.field) sorts[s.field] = s.direction || 'asc'; });
  }

  return { x_axis: xAxis, series, marks, sorts };
};

const convertData = (data) => data?.rows || [];

const collapseLabels = (rows, labelFields, measures, fieldAggregations) => {
  if (!labelFields || labelFields.length === 0) return rows;
  if (rows.length === 0) return rows;

  const labelSet = new Set(labelFields);
  const measureSet = new Set(measures);
  const allKeys = Object.keys(rows[0]);
  const groupKeys = allKeys.filter(k => !labelSet.has(k) && !measureSet.has(k));

  const groups = new Map();
  for (const row of rows) {
    const key = groupKeys.map(k => row[k]).join('\x00');
    if (!groups.has(key)) {
      const seed = {};
      for (const k of groupKeys) seed[k] = row[k];
      for (const m of measures) seed[m] = null;
      seed._count = 0;
      groups.set(key, seed);
    }
    const g = groups.get(key);
    g._count++;
    for (const m of measures) {
      const v = Number(row[m]) || 0;
      const agg = (fieldAggregations[m] || 'sum').toLowerCase();
      if (agg === 'min') g[m] = g[m] === null ? v : Math.min(g[m], v);
      else if (agg === 'max') g[m] = g[m] === null ? v : Math.max(g[m], v);
      else if (agg === 'count') g[m] = (g[m] || 0) + 1;
      else g[m] = (g[m] || 0) + v;
    }
  }

  const result = [];
  for (const g of groups.values()) {
    for (const m of measures) {
      const agg = (fieldAggregations[m] || 'sum').toLowerCase();
      if (agg === 'avg' || agg === 'average' || agg === 'mean') {
        g[m] = g._count > 0 ? g[m] / g._count : 0;
      }
      if (g[m] === null) g[m] = 0;
    }
    delete g._count;
    result.push(g);
  }
  return result;
};

const PieChartWrapper = ({ data, config, query, fieldAggregations = {}, variant = 'pie' }) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const hasAnimatedRef = useRef(false);
  const lastDataKeyRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    const timer = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) setDimensions({ width: rect.width, height: rect.height });
      }
    }, 50);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);

  const queryKey = JSON.stringify(query);
  const configKey = JSON.stringify(config);
  const aggKey = JSON.stringify(fieldAggregations);

  useEffect(() => {
    if (!containerRef.current || dimensions.width === 0 || dimensions.height === 0) return;

    const rawData = convertData(data);
    if (rawData.length === 0) return;

    const chartConfig = { ...queryToConfig(query), fieldAggregations };
    const labelFields = query?.labelFields || [];
    const chartData = collapseLabels(rawData, labelFields, query?.measures || [], fieldAggregations);

    if (chartRef.current) chartRef.current.destroy();

    const detailField = chartConfig.marks?.detail;
    const hasDetail = detailField && (Array.isArray(detailField) ? detailField.length > 0 : !!detailField);
    const isTrellis = hasDetail &&
      (query?.detailFields?.length > 0 || (query?.marks?.detail && query.marks.detail.length > 0));

    const dataKey = JSON.stringify(rawData.slice(0, 5).map(r => Object.values(r).slice(0, 3)));
    const shouldAnimate = !hasAnimatedRef.current || (lastDataKeyRef.current !== dataKey);
    hasAnimatedRef.current = true;
    lastDataKeyRef.current = dataKey;

    const chartOptions = {
      variant,
      width: dimensions.width,
      height: dimensions.height,
      colors: config?.colors,
      showLegend: config?.showLegend !== false,
      legendPosition: config?.legendPosition || 'right',
      showLabels: config?.showLabels !== false,
      animate: shouldAnimate,
      columnAliases: config?.columnAliases || {},
    };

    if (isTrellis) {
      chartRef.current = createTrellisPieChart(containerRef.current, chartConfig, chartData, chartOptions);
    } else {
      chartRef.current = createPieChart(containerRef.current, chartConfig, chartData, chartOptions);
    }

    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [data, queryKey, configKey, aggKey, dimensions, variant]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />;
};

export default React.memo(PieChartWrapper);
