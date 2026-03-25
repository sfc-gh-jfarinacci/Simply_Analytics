/**
 * ChartRenderer - Shared chart rendering component
 * Used by both DashboardWidget and WidgetEditor to ensure consistent rendering
 * 
 * Provides smooth transitions when switching chart types with a subtle
 * entrance animation while D3's own transitions handle the rest.
 */
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { VerticalBarChartWrapper, HorizontalBarChartWrapper, DivergingBarChartWrapper, LineChartWrapper, AreaChartWrapper, PieChartWrapper, TreemapChartWrapper, IcicleChartWrapper, SankeyChartWrapper, FunnelChartWrapper, WaterfallChartWrapper, ScatterChartWrapper, BoxPlotChartWrapper, MetricCard, DataTable, getColorArray } from './charts';

// Blueprint-style chart illustration - looks like it's being designed
const ChartBlueprint = ({ type }) => {
  const color = 'var(--accent-primary, #3b82f6)';
  const mutedColor = 'var(--text-muted, #666)';
  
  const getChartSvg = () => {
    const baseProps = { width: 120, height: 80 };
    
    switch (type?.toLowerCase()) {
      case 'line':
      case 'multiline':
      case 'area':
        return (
          <svg {...baseProps} viewBox="0 0 120 80">
            <line x1="20" y1="70" x2="110" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <line x1="20" y1="10" x2="20" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <path d="M 25 55 L 45 35 L 65 45 L 85 20 L 105 30" fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 2" opacity="0.6" />
            <circle cx="25" cy="55" r="3" fill={color} opacity="0.4" />
            <circle cx="45" cy="35" r="3" fill={color} opacity="0.4" />
            <circle cx="65" cy="45" r="3" fill={color} opacity="0.4" />
            <circle cx="85" cy="20" r="3" fill={color} opacity="0.4" />
            <circle cx="105" cy="30" r="3" fill={color} opacity="0.4" />
          </svg>
        );
      case 'pie':
      case 'donut':
      case 'radial':
        return (
          <svg {...baseProps} viewBox="0 0 120 80">
            <circle cx="60" cy="40" r="30" fill="none" stroke={mutedColor} strokeWidth="1" opacity="0.3" strokeDasharray="3 2" />
            <path d="M 60 40 L 60 10 A 30 30 0 0 1 85 55 Z" fill={color} opacity="0.3" />
            <path d="M 60 40 L 85 55 A 30 30 0 0 1 35 55 Z" fill={color} opacity="0.2" />
            <path d="M 60 40 L 35 55 A 30 30 0 0 1 60 10 Z" fill={color} opacity="0.15" />
            {type?.toLowerCase() === 'donut' && <circle cx="60" cy="40" r="15" fill="var(--bg-primary, #1a1a2e)" />}
          </svg>
        );
      case 'horizontal bar':
      case 'diverging bar':
        return (
          <svg {...baseProps} viewBox="0 0 120 80">
            <rect x="20" y="12" width="70" height="12" rx="2" fill={color} opacity="0.4" />
            <rect x="20" y="28" width="50" height="12" rx="2" fill={color} opacity="0.3" />
            <rect x="20" y="44" width="85" height="12" rx="2" fill={color} opacity="0.35" />
            <rect x="20" y="60" width="40" height="12" rx="2" fill={color} opacity="0.25" />
            <line x1="20" y1="8" x2="20" y2="76" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
          </svg>
        );
      case 'waterfall':
        return (
          <svg {...baseProps} viewBox="0 0 120 80">
            <line x1="20" y1="70" x2="110" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <line x1="20" y1="10" x2="20" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <rect x="28" y="30" width="12" height="20" rx="1" fill="#22c55e" opacity="0.5" />
            <rect x="46" y="20" width="12" height="10" rx="1" fill="#22c55e" opacity="0.5" />
            <rect x="64" y="30" width="12" height="15" rx="1" fill="#ef4444" opacity="0.5" />
            <rect x="82" y="15" width="12" height="55" rx="1" fill={color} opacity="0.4" />
            <line x1="40" y1="30" x2="46" y2="30" stroke={mutedColor} strokeWidth="0.5" strokeDasharray="2,1" opacity="0.4" />
            <line x1="58" y1="20" x2="64" y2="20" stroke={mutedColor} strokeWidth="0.5" strokeDasharray="2,1" opacity="0.4" />
          </svg>
        );
      case 'scatter':
        return (
          <svg {...baseProps} viewBox="0 0 120 80">
            <line x1="20" y1="70" x2="110" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <line x1="20" y1="10" x2="20" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <circle cx="35" cy="45" r="3" fill={color} opacity="0.5" />
            <circle cx="50" cy="30" r="4" fill={color} opacity="0.4" />
            <circle cx="60" cy="50" r="3" fill={color} opacity="0.45" />
            <circle cx="75" cy="25" r="5" fill={color} opacity="0.35" />
            <circle cx="85" cy="40" r="3" fill={color} opacity="0.5" />
            <circle cx="95" cy="20" r="4" fill={color} opacity="0.4" />
            <circle cx="45" cy="55" r="3" fill={color} opacity="0.3" />
          </svg>
        );
      case 'boxplot':
        return (
          <svg {...baseProps} viewBox="0 0 120 80">
            <line x1="20" y1="70" x2="110" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <line x1="20" y1="10" x2="20" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <line x1="45" y1="18" x2="45" y2="60" stroke={color} strokeWidth="1" opacity="0.4" />
            <rect x="35" y="30" width="20" height="20" rx="2" fill={color} opacity="0.3" stroke={color} strokeWidth="1" />
            <line x1="35" y1="40" x2="55" y2="40" stroke="#fff" strokeWidth="1.5" opacity="0.6" />
            <line x1="40" y1="18" x2="50" y2="18" stroke={color} strokeWidth="1" opacity="0.4" />
            <line x1="40" y1="60" x2="50" y2="60" stroke={color} strokeWidth="1" opacity="0.4" />
            <line x1="85" y1="22" x2="85" y2="55" stroke={color} strokeWidth="1" opacity="0.4" />
            <rect x="75" y="32" width="20" height="15" rx="2" fill={color} opacity="0.25" stroke={color} strokeWidth="1" />
            <line x1="75" y1="38" x2="95" y2="38" stroke="#fff" strokeWidth="1.5" opacity="0.6" />
            <line x1="80" y1="22" x2="90" y2="22" stroke={color} strokeWidth="1" opacity="0.4" />
            <line x1="80" y1="55" x2="90" y2="55" stroke={color} strokeWidth="1" opacity="0.4" />
          </svg>
        );
      default:
        return (
          <svg {...baseProps} viewBox="0 0 120 80">
            <line x1="20" y1="70" x2="110" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <line x1="20" y1="10" x2="20" y2="70" stroke={mutedColor} strokeWidth="1" opacity="0.3" />
            <rect x="28" y="30" width="14" height="40" rx="2" fill={color} opacity="0.3" stroke={color} strokeWidth="1" strokeDasharray="3 2" />
            <rect x="48" y="20" width="14" height="50" rx="2" fill={color} opacity="0.25" stroke={color} strokeWidth="1" strokeDasharray="3 2" />
            <rect x="68" y="40" width="14" height="30" rx="2" fill={color} opacity="0.35" stroke={color} strokeWidth="1" strokeDasharray="3 2" />
            <rect x="88" y="15" width="14" height="55" rx="2" fill={color} opacity="0.2" stroke={color} strokeWidth="1" strokeDasharray="3 2" />
          </svg>
        );
    }
  };

  return getChartSvg();
};

const PlaceholderChart = ({ type }) => (
  <div className="chart-placeholder" style={{
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    background: 'transparent',
  }}>
    <ChartBlueprint type={type} />
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      background: 'var(--bg-secondary, rgba(40, 40, 50, 0.5))',
      borderRadius: '20px',
      border: '1px solid var(--border-subtle, rgba(100, 100, 120, 0.2))',
    }}>
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: 'var(--accent-primary, #3b82f6)',
        animation: 'pulse 2s ease-in-out infinite',
      }} />
      <span style={{
        color: 'var(--text-muted, #888)',
        fontSize: '11px',
        fontWeight: 500,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
      }}>
        {type} · In Development
      </span>
    </div>
    <style>{`
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.8); }
      }
    `}</style>
  </div>
);

/**
 * Resolve a chart type to a React element.
 */
const resolveChart = (type, data, config, query, fieldAggregations) => {
  switch (type) {
    case 'bar':
    case 'stacked-bar':
      return <VerticalBarChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'horizontal-bar':
      return <HorizontalBarChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'diverging-bar':
      return <DivergingBarChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'line':
    case 'multiline':
      return <LineChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'area':
      return <AreaChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'pie':
      return <PieChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} variant="pie" />;
    case 'donut':
      return <PieChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} variant="donut" />;
    case 'radial':
      return <PieChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} variant="radial" />;
    case 'treemap':
      return <TreemapChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'icicle':
      return <IcicleChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'sankey':
      return <SankeyChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
  
    case 'gauge':
      return <PlaceholderChart type="Gauge" />;
    case 'funnel':
      return <FunnelChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'waterfall':
      return <WaterfallChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'scatter':
      return <ScatterChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'boxplot':
      return <BoxPlotChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
    case 'table':
      return <DataTable data={data} config={config} query={{
        rowFields: [...(query?.rows || []), ...(query?.labelFields || [])],
        columnFields: query?.xAxis || query?.columns || [],
        measureFields: query?.measures || [],
        markFields: query?.marks || {},
      }} pivot={false} />;
    case 'pivot':
    case 'crosstab':
      return <DataTable data={data} config={config} query={{
        rowFields: [...(query?.rows || []), ...(query?.labelFields || [])],
        columnFields: query?.xAxis || query?.columns || [],
        measureFields: query?.measures || [],
        markFields: query?.marks || {},
      }} pivot={true} />;
    case 'metric':
      return <MetricCard data={data} config={config} query={query} />;
    default:
      return <VerticalBarChartWrapper data={data} config={config} query={query} fieldAggregations={fieldAggregations} />;
  }
};

/**
 * Render a chart based on type, data, config, and query.
 * Legacy helper kept for call-sites that use the function form.
 */
export const renderChart = (type, data, config, query, chartKey = null) => {
  const key = chartKey || `chart-${type}`;
  const fieldAggregations = config?.fieldAggregations || {};
  return (
    <ChartRenderer key={key} type={type} data={data} config={config} query={query} fieldAggregations={fieldAggregations} />
  );
};

// Bumped on each type change to re-trigger the CSS entrance animation
let transitionCounter = 0;

/**
 * ChartRenderer component
 *
 * Keeps a stable container so switching chart types is instant — no
 * unmount/remount flash. The new chart swaps in immediately and plays
 * a subtle CSS entrance animation while D3's own bar transitions
 * provide the main visual continuity.
 */
const ChartRenderer = ({ type, data, config, query, chartKey, fieldAggregations: fieldAggProp }) => {
  const fieldAggregations = fieldAggProp || config?.fieldAggregations || {};

  // Track a transition key so each type change gets a fresh entrance animation
  const [animKey, setAnimKey] = useState(0);
  const prevTypeRef = useRef(type);

  useEffect(() => {
    if (type !== prevTypeRef.current) {
      prevTypeRef.current = type;
      setAnimKey(++transitionCounter);
    }
  }, [type]);

  const queryStable = useMemo(() => query, [JSON.stringify(query)]);
  const configStable = useMemo(() => {
    if (!config) return config;
    if (config.colors) return config;
    return {
      ...config,
      colors: getColorArray(config.colorScheme || 'tableau10'),
    };
  }, [JSON.stringify(config)]);

  if (!data?.rows?.length) {
    return <div className="chart-no-data">No data available</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        key={animKey}
        style={{
          width: '100%',
          height: '100%',
          animation: animKey > 0 ? 'chartEnter 200ms ease-out both' : 'none',
        }}
      >
        {resolveChart(type, data, configStable, queryStable, fieldAggregations)}
      </div>
      <style>{`
        @keyframes chartEnter {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default React.memo(ChartRenderer);
