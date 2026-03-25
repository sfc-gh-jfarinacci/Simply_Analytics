/**
 * React Wrapper for D3.js Nested Treemap Chart
 *
 * Hierarchy is determined by columns → rows shelf order (top to bottom).
 * Mark types are ignored. First measure drives size AND color intensity.
 *
 * Props: data, config, query, fieldAggregations
 */
import React, { useRef, useEffect, useState } from 'react';
import { createTreemapChart } from './hierarchyChart';

const toFieldName = (v) => {
  if (v == null) return null;
  if (typeof v !== 'object') return String(v);
  if (v.name != null) return String(v.name);
  if (v.value != null) return String(v.value);
  if (v.label != null) return String(v.label);
  const first = Object.values(v).find(x => x != null && typeof x !== 'object');
  return first != null ? String(first) : null;
};

/**
 * Builds the chart config from the query object.
 * groupFields = columns (xAxis) first, then rows — in shelf order.
 * Marks are intentionally not used for hierarchy.
 */
const queryToConfig = (query) => {
  const columns = (query?.xAxis || query?.columns || []).map(toFieldName).filter(Boolean);
  const rows = (query?.rows || []).map(toFieldName).filter(Boolean);
  const groupFields = [...columns, ...rows];

  const series = (query?.measures || []).map(toFieldName).filter(Boolean);

  const sorts = {};
  if (query?.sorts) {
    query.sorts.forEach(s => { if (s.field) sorts[s.field] = s.direction || 'asc'; });
  }

  return { groupFields, series, sorts };
};

const convertData = (data) => data?.rows || [];

const TreemapChartWrapper = ({ data, config, query, fieldAggregations = {} }) => {
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

    if (chartRef.current) chartRef.current.destroy();

    const dataKey = JSON.stringify(rawData.slice(0, 5).map(r => Object.values(r).slice(0, 3)));
    const shouldAnimate = !hasAnimatedRef.current || (lastDataKeyRef.current !== dataKey);
    hasAnimatedRef.current = true;
    lastDataKeyRef.current = dataKey;

    chartRef.current = createTreemapChart(containerRef.current, chartConfig, rawData, {
      width: dimensions.width,
      height: dimensions.height,
      colors: config?.colors,
      showLabels: config?.showLabels !== false,
      animate: shouldAnimate,
      columnAliases: config?.columnAliases || {},
    });

    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [data, queryKey, configKey, aggKey, dimensions]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />;
};

export default React.memo(TreemapChartWrapper);
