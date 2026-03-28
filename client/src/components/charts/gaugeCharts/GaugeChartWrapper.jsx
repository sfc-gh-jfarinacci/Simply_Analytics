import React, { useRef, useEffect, useState } from 'react';
import { createGaugeChart } from './gaugeChart';

const toFieldName = (v) => {
  if (v == null) return null;
  if (typeof v !== 'object') return String(v);
  return v.name ?? v.value ?? v.label ?? null;
};

const formatDisplayName = (name, aliases) => {
  if (!name) return '';
  if (aliases?.[name]) return aliases[name];
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const GaugeChartWrapper = ({ data, config, query }) => {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const hasAnimatedRef = useRef(false);

  const measureField = toFieldName((query?.measures || query?.rows || [])[0]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || dimensions.width === 0 || dimensions.height === 0) return;
    const rows = data?.rows || [];
    if (!measureField || rows.length === 0) return;

    const value = +rows[0][measureField] || 0;
    const shouldAnimate = !hasAnimatedRef.current;
    hasAnimatedRef.current = true;

    const gaugeConfig = config?.gaugeConfig || {};
    let minVal = gaugeConfig.minValue ?? 0;
    let maxVal = gaugeConfig.maxValue;
    if (maxVal == null) {
      const allVals = rows.map(r => +r[measureField]).filter(v => !isNaN(v));
      maxVal = Math.max(...allVals) * 1.2 || 100;
    }

    createGaugeChart(containerRef.current, value, {
      width: dimensions.width, height: dimensions.height,
      minValue: minVal, maxValue: maxVal,
      label: formatDisplayName(measureField, config?.columnAliases),
      colorScheme: config?.colorScheme || 'blues',
      colors: config?.colors,
      animate: shouldAnimate,
      thresholds: gaugeConfig.thresholds,
    });
  }, [dimensions, data, measureField, config]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />;
};

export default GaugeChartWrapper;
