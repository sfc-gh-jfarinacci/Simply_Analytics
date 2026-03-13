/**
 * MetricCard - KPI / Metric display component
 * 
 * Renders a single metric value with optional:
 * - Icon/emoji in top-left
 * - Trend badge (% change) in top-right
 * - Large formatted number with optional prefix/suffix
 * - Prior period comparison value
 * - Label (field name)
 * - Sparkline (mini area chart of recent values)
 */
import React, { useMemo, useRef, useEffect } from 'react';
import * as d3 from 'd3';

const MetricCard = ({ data, config, query }) => {
  const sparklineRef = useRef(null);
  const rows = data?.rows || [];
  
  const dimensionField = query?.xAxis?.[0] || query?.columns?.[0] || null;

  // Filter out any xAxis/columns fields that were incorrectly included in measures
  const xAxisSet = new Set([
    ...(query?.xAxis || []).map(f => f?.toUpperCase?.()),
    ...(query?.columns || []).map(f => f?.toUpperCase?.()),
  ].filter(Boolean));
  const measures = (query?.measures || []).filter(m => !xAxisSet.has(m?.toUpperCase?.()));
  const measureField = measures[0] || null;
  const comparisonMeasureField = measures.length >= 2 ? measures[1] : null;
  
  const showSparkline = config?.showSparkline !== false;
  const showLabels = config?.showLabels !== false;
  const metricIcon = config?.metricIcon || '';
  const animate = config?.animate !== false;
  const numberFormat = config?.numberFormat || 'auto';
  const decimalPlaces = config?.decimalPlaces ?? 1;
  const columnAliases = config?.columnAliases || {};
  const comparisonLabel = config?.comparisonLabel || (comparisonMeasureField
    ? (columnAliases[comparisonMeasureField] || comparisonMeasureField?.replace(/_/g, ' '))
    : 'Prior Period');

  const { mainValue, priorValue, changePercent, trendDirection, sparkData, label } = useMemo(() => {
    if (!rows.length) {
      return { mainValue: null, priorValue: null, changePercent: null, trendDirection: 'neutral', sparkData: [], label: '' };
    }

    const dataKeys = Object.keys(rows[0]);

    // Case-insensitive key resolver: finds the actual data column key
    // matching a given field name, avoiding the dimension column.
    const resolveKey = (name) => {
      if (!name) return null;
      if (dataKeys.includes(name)) return name;
      const upper = name.toUpperCase();
      return dataKeys.find(k => k.toUpperCase() === upper) || null;
    };

    const dimKey = resolveKey(dimensionField);
    const dimKeyUpper = dimKey?.toUpperCase();

    // Resolve measure field: prefer explicit measure, then first numeric
    // column that ISN'T the dimension.
    let fieldName = resolveKey(measureField);
    if (!fieldName) {
      fieldName = dataKeys.find(k =>
        typeof rows[0][k] === 'number' && k.toUpperCase() !== dimKeyUpper
      ) || dataKeys.find(k => typeof rows[0][k] === 'number') || dataKeys[0];
    }

    const displayLabel = columnAliases[fieldName] || fieldName?.replace(/_/g, ' ') || '';

    const sorted = dimKey
      ? [...rows].sort((a, b) => {
          const av = a[dimKey], bv = b[dimKey];
          if (av < bv) return -1;
          if (av > bv) return 1;
          return 0;
        })
      : rows;

    const toNum = (v) => typeof v === 'number' ? v : parseFloat(v) || 0;

    const mainValues = sorted.map(r => toNum(r[fieldName]));

    if (comparisonMeasureField) {
      const compKey = resolveKey(comparisonMeasureField);
      const mainSum = mainValues.reduce((a, b) => a + b, 0);
      const compValues = compKey
        ? sorted.map(r => toNum(r[compKey]))
        : [];
      const compSum = compValues.reduce((a, b) => a + b, 0);

      let pct = null;
      let dir = 'neutral';
      if (compSum !== 0) {
        pct = ((mainSum - compSum) / Math.abs(compSum)) * 100;
        dir = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'neutral';
      }

      return {
        mainValue: mainSum,
        priorValue: compSum,
        changePercent: pct,
        trendDirection: dir,
        sparkData: mainValues,
        label: displayLabel,
      };
    }

    // Single-measure mode: trend over rows
    if (rows.length === 1) {
      return {
        mainValue: mainValues[0],
        priorValue: null,
        changePercent: null,
        trendDirection: 'neutral',
        sparkData: [],
        label: displayLabel,
      };
    }

    const current = mainValues[mainValues.length - 1];
    const prior = mainValues.length >= 2 ? mainValues[mainValues.length - 2] : null;
    let pct = null;
    let dir = 'neutral';
    if (prior !== null && prior !== 0) {
      pct = ((current - prior) / Math.abs(prior)) * 100;
      dir = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'neutral';
    }

    return {
      mainValue: current,
      priorValue: prior,
      changePercent: pct,
      trendDirection: dir,
      sparkData: mainValues,
      label: displayLabel,
    };
  }, [rows, measureField, comparisonMeasureField, dimensionField, columnAliases]);

  // Format number for display
  const formatNumber = (val) => {
    if (val === null || val === undefined) return '--';
    if (typeof val !== 'number') return String(val);

    const abs = Math.abs(val);

    switch (numberFormat) {
      case 'currency':
        if (abs >= 1e9) return '$' + (val / 1e9).toFixed(decimalPlaces) + 'B';
        if (abs >= 1e6) return '$' + (val / 1e6).toFixed(decimalPlaces) + 'M';
        if (abs >= 1e3) return '$' + (val / 1e3).toFixed(decimalPlaces) + 'K';
        return '$' + val.toLocaleString('en-US', { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces });
      case 'percent':
        return (val * 100).toFixed(decimalPlaces) + '%';
      case 'number':
        return val.toLocaleString('en-US', { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces });
      case 'compact':
        if (abs >= 1e9) return (val / 1e9).toFixed(decimalPlaces) + 'B';
        if (abs >= 1e6) return (val / 1e6).toFixed(decimalPlaces) + 'M';
        if (abs >= 1e3) return (val / 1e3).toFixed(decimalPlaces) + 'K';
        return val.toFixed(decimalPlaces);
      case 'auto':
      default:
        if (abs >= 1e9) return (val / 1e9).toFixed(decimalPlaces) + 'B';
        if (abs >= 1e6) return (val / 1e6).toFixed(decimalPlaces) + 'M';
        if (abs >= 1e4) return (val / 1e3).toFixed(decimalPlaces) + 'K';
        if (Number.isInteger(val)) return val.toLocaleString('en-US');
        return val.toLocaleString('en-US', { maximumFractionDigits: decimalPlaces });
    }
  };

  // Split formatted value into number and suffix for styling
  const { displayNumber, displaySuffix, displayPrefix } = useMemo(() => {
    if (mainValue === null) return { displayNumber: '--', displaySuffix: '', displayPrefix: '' };

    const formatted = formatNumber(mainValue);
    const suffixMatch = formatted.match(/([KMBT%])$/);
    const prefixMatch = formatted.match(/^(\$)/);

    let num = formatted;
    let suffix = '';
    let prefix = '';

    if (prefixMatch) {
      prefix = prefixMatch[1];
      num = num.slice(prefix.length);
    }
    if (suffixMatch) {
      suffix = suffixMatch[1];
      num = num.slice(0, -1);
    }

    return { displayNumber: num, displaySuffix: suffix, displayPrefix: prefix };
  }, [mainValue, numberFormat, decimalPlaces]);

  // Sparkline rendering with D3
  useEffect(() => {
    if (!sparklineRef.current || !showSparkline || sparkData.length < 3) return;

    const container = sparklineRef.current;
    const width = container.clientWidth || 120;
    const height = 40;

    d3.select(container).selectAll('*').remove();

    const svg = d3.select(container)
      .append('svg')
      .attr('class', 'sparkline-svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'none');

    const x = d3.scaleLinear().domain([0, sparkData.length - 1]).range([0, width]);
    const yMin = d3.min(sparkData);
    const yMax = d3.max(sparkData);
    const padding = (yMax - yMin) * 0.1 || 1;
    const y = d3.scaleLinear().domain([yMin - padding, yMax + padding]).range([height - 2, 2]);

    const trendColor = trendDirection === 'up' ? '#10b981' : trendDirection === 'down' ? '#ef4444' : '#6b7280';

    // Area
    const area = d3.area()
      .x((_, i) => x(i))
      .y0(height)
      .y1(d => y(d))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(sparkData)
      .attr('d', area)
      .attr('fill', trendColor)
      .attr('fill-opacity', 0.12);

    // Line
    const line = d3.line()
      .x((_, i) => x(i))
      .y(d => y(d))
      .curve(d3.curveMonotoneX);

    const path = svg.append('path')
      .datum(sparkData)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', trendColor)
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round');

    if (animate) {
      const totalLength = path.node()?.getTotalLength() || 0;
      if (totalLength > 0) {
        path
          .attr('stroke-dasharray', totalLength)
          .attr('stroke-dashoffset', totalLength)
          .transition()
          .duration(800)
          .ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0);
      }
    }

    // End dot
    svg.append('circle')
      .attr('cx', x(sparkData.length - 1))
      .attr('cy', y(sparkData[sparkData.length - 1]))
      .attr('r', 3)
      .attr('fill', trendColor);

  }, [sparkData, showSparkline, trendDirection, animate]);

  const trendArrow = trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '';

  return (
    <div className="kpi-card">
      {/* Header: icon + trend badge */}
      <div className="kpi-card-header">
        {metricIcon ? (
          <div className="kpi-icon" style={{ background: 'var(--bg-tertiary)' }}>
            {metricIcon}
          </div>
        ) : <div />}

        {changePercent !== null && (
          <div className={`kpi-trend-badge trend-${trendDirection}`}>
            {trendArrow && <span className="trend-arrow">{trendArrow}</span>}
            <span className="trend-value">{Math.abs(changePercent).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* Main value */}
      <div className="kpi-main-value">
        <div className="kpi-value-text">
          {displayPrefix && <span className="kpi-prefix">{displayPrefix}</span>}
          <span className="kpi-number">{displayNumber}</span>
          {displaySuffix && <span className="kpi-suffix">{displaySuffix}</span>}
        </div>

        {priorValue !== null && (
          <div className="kpi-comparison">
            <span className="kpi-comparison-label">{comparisonLabel}</span>
            <span className="kpi-comparison-value">{formatNumber(priorValue)}</span>
          </div>
        )}
      </div>

      {/* Label */}
      {showLabels && label && (
        <div className="kpi-label">{label}</div>
      )}

      {/* Sparkline */}
      {showSparkline && sparkData.length >= 3 && (
        <div className="kpi-sparkline" ref={sparklineRef} />
      )}
    </div>
  );
};

export default MetricCard;
