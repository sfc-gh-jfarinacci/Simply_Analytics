import React, { useRef, useEffect, useState } from 'react';
import { createScatterChart } from './scatterChart';

const toFieldName = (v) => {
  if (v == null) return null;
  if (typeof v !== 'object') return String(v);
  if (v.name != null) return String(v.name);
  if (v.value != null) return String(v.value);
  if (v.label != null) return String(v.label);
  const first = Object.values(v).find(x => x != null && typeof x !== 'object');
  return first != null ? String(first) : null;
};

const queryToConfig = (query) => {
  const xField = toFieldName((query?.xAxis?.length ? query.xAxis : query?.columns || [])[0]);
  const rows = query?.rows?.length ? query.rows : null;
  const measures = query?.measures || [];
  const yField = toFieldName((rows || measures)[0]);
  const sizeField = toFieldName(
    query?.marks?.size || measures[rows ? 0 : 1] || null
  );
  const marks = {
    color: toFieldName(query?.colorField || query?.marks?.color),
    tooltip: (query?.tooltipFields || query?.marks?.tooltip || []).map(toFieldName),
  };
  return { xField, yField, sizeField, marks };
};

const convertData = (data) => data?.rows || [];

const ScatterChartWrapper = ({ data, config, query, fieldAggregations = {} }) => {
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

    chartRef.current = createScatterChart(containerRef.current, chartConfig, rawData, {
      width: dimensions.width,
      height: dimensions.height,
      colors: config?.colors,
      showLegend: config?.showLegend !== false,
      legendPosition: config?.legendPosition || 'right',
      showGrid: config?.showGrid !== false,
      showLabels: config?.showLabels || false,
      xAxisTitle: config?.xAxisTitle || '',
      yAxisTitle: config?.yAxisTitle || '',
      animate: shouldAnimate,
      fieldFormats: config?.fieldFormats || {},
      columnAliases: config?.columnAliases || {},
    });

    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [data, queryKey, configKey, dimensions]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />;
};

export default React.memo(ScatterChartWrapper);
