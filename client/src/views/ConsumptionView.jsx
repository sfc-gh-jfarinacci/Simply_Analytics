import React, { useEffect, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  FiBarChart2, FiUsers, FiCheckCircle, FiEye,
  FiDatabase, FiRefreshCw, FiShield,
  FiActivity, FiTrendingUp, FiInbox,
} from 'react-icons/fi';
import { useAppStore } from '../store/appStore';
import '../styles/Consumption.css';

const DATE_RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function useThemeColors() {
  const theme = useAppStore((s) => s.theme);
  const isDark = theme === 'dark';
  return {
    text: isDark ? '#f0f0f5' : '#0f172a',
    subText: isDark ? '#808090' : '#64748b',
    border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    gridLine: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
    tooltipBg: isDark ? '#1a1a24' : '#fff',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
  };
}

// -------- Chart option builders --------

function baseTooltip(colors) {
  return {
    trigger: 'axis',
    backgroundColor: colors.tooltipBg,
    borderColor: colors.tooltipBorder,
    textStyle: { color: colors.text, fontSize: 12 },
  };
}

function buildAuthChartOption(data, colors) {
  const labels = data.map((d) => fmtDate(d.bucket));
  return {
    tooltip: baseTooltip(colors),
    legend: { data: ['Success', 'Failed'], textStyle: { color: colors.subText, fontSize: 11 }, itemWidth: 12, itemHeight: 8, itemGap: 16 },
    grid: { left: 44, right: 16, top: 40, bottom: 28 },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { color: colors.subText, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: colors.gridLine, type: 'dashed' } }, axisLabel: { color: colors.subText, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      { name: 'Success', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, showSymbol: false, areaStyle: { opacity: 0.12 }, lineStyle: { width: 2 }, data: data.map((d) => d.success), itemStyle: { color: '#10b981' } },
      { name: 'Failed', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, showSymbol: false, areaStyle: { opacity: 0.12 }, lineStyle: { width: 2 }, data: data.map((d) => d.fail), itemStyle: { color: '#ef4444' } },
    ],
  };
}

function buildRequestVolumeOption(data, colors) {
  const labels = data.map((d) => fmtDate(d.bucket));
  return {
    tooltip: baseTooltip(colors),
    legend: { data: ['AI', 'Query', 'Dashboard'], textStyle: { color: colors.subText, fontSize: 11 }, itemWidth: 12, itemHeight: 8, itemGap: 16 },
    grid: { left: 44, right: 16, top: 40, bottom: 28 },
    xAxis: { type: 'category', data: labels, axisLabel: { color: colors.subText, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: colors.gridLine, type: 'dashed' } }, axisLabel: { color: colors.subText, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      { name: 'AI', type: 'bar', stack: 'total', data: data.map((d) => d.ai), itemStyle: { color: '#7c3aed', borderRadius: [0, 0, 0, 0] }, barMaxWidth: 24 },
      { name: 'Query', type: 'bar', stack: 'total', data: data.map((d) => d.query), itemStyle: { color: '#0ea5e9' }, barMaxWidth: 24 },
      { name: 'Dashboard', type: 'bar', stack: 'total', data: data.map((d) => d.dashboard), itemStyle: { color: '#06b6d4', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 24 },
    ],
  };
}

function buildActiveUsersOption(data, colors) {
  const labels = data.map((d) => fmtDate(d.bucket));
  return {
    tooltip: baseTooltip(colors),
    grid: { left: 44, right: 16, top: 24, bottom: 28 },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { color: colors.subText, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: colors.gridLine, type: 'dashed' } }, axisLabel: { color: colors.subText, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      { type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, showSymbol: false, areaStyle: { opacity: 0.1 }, lineStyle: { width: 2.5 }, data: data.map((d) => d.users), itemStyle: { color: '#f59e0b' } },
    ],
  };
}

function buildPopularDashboardsOption(data, colors) {
  const names = data.map((d) => d.dashboardName).reverse();
  const views = data.map((d) => d.views).reverse();
  return {
    tooltip: { ...baseTooltip(colors), axisPointer: { type: 'shadow' } },
    grid: { left: 130, right: 32, top: 8, bottom: 16 },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: colors.gridLine, type: 'dashed' } }, axisLabel: { color: colors.subText, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: {
        color: colors.subText,
        fontSize: 11,
        formatter: (v) => (v.length > 16 ? v.slice(0, 16) + '\u2026' : v),
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: views,
        itemStyle: { color: '#0ea5e9', borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18,
      },
    ],
  };
}

// -------- Main component --------

export default function ConsumptionView() {
  const {
    consumptionOverview,
    consumptionAuthMetrics,
    consumptionPopularDashboards,
    consumptionRequestVolume,
    consumptionActiveUsers,
    consumptionLoading,
    consumptionError,
    consumptionDateRange,
    consumptionWorkspaceId,
    setConsumptionDateRange,
    setConsumptionWorkspaceId,
    loadConsumptionData,
    workspaces,
  } = useAppStore();

  const colors = useThemeColors();

  useEffect(() => {
    loadConsumptionData();
  }, [consumptionDateRange, consumptionWorkspaceId]);

  const handleRefresh = useCallback(() => {
    loadConsumptionData();
  }, [loadConsumptionData]);

  const overview = consumptionOverview || {};

  return (
    <div className="consumption-dashboard">
      {/* Sticky header */}
      <div className="consumption-header">
        <div className="consumption-header-left">
          <h1><FiBarChart2 /> Consumption</h1>
          <p>Platform usage analytics and metrics</p>
        </div>

        <div className="consumption-filters">
          <select
            value={consumptionWorkspaceId || ''}
            onChange={(e) => setConsumptionWorkspaceId(e.target.value || null)}
          >
            <option value="">All workspaces</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>

          <select
            value={consumptionDateRange}
            onChange={(e) => setConsumptionDateRange(e.target.value)}
          >
            {DATE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>

          <button
            className={`consumption-refresh-btn ${consumptionLoading ? 'loading' : ''}`}
            onClick={handleRefresh}
            disabled={consumptionLoading}
          >
            <FiRefreshCw size={13} />
            {consumptionLoading ? 'Loading\u2026' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="consumption-body">
        {consumptionError && (
          <div className="consumption-error-banner">{consumptionError}</div>
        )}

        {/* KPI Cards */}
        <div className="consumption-kpi-row">
          <KpiCard
            icon={<FiActivity />}
            color="blue"
            label="Total Requests"
            value={overview.totalRequests ?? '\u2014'}
            sub={`${overview.aiRequests ?? 0} AI \u00B7 ${overview.queryExecutions ?? 0} queries`}
          />
          <KpiCard
            icon={<FiUsers />}
            color="purple"
            label="Active Users"
            value={overview.activeUsers ?? '\u2014'}
          />
          <KpiCard
            icon={<FiCheckCircle />}
            color="green"
            label="Login Success Rate"
            value={overview.loginSuccessRate != null ? `${overview.loginSuccessRate}%` : '\u2014'}
            sub={`${overview.loginSuccess ?? 0} ok \u00B7 ${overview.loginFail ?? 0} failed`}
          />
          <KpiCard
            icon={<FiEye />}
            color="amber"
            label="Dashboard Views"
            value={overview.dashboardViews ?? '\u2014'}
          />
        </div>

        {/* Charts */}
        <div className="consumption-charts">
          <ChartCard title="Sign-in Activity" icon={<FiShield />} data={consumptionAuthMetrics} builder={buildAuthChartOption} colors={colors} />
          <ChartCard title="Request Volume by Type" icon={<FiDatabase />} data={consumptionRequestVolume} builder={buildRequestVolumeOption} colors={colors} />
          <ChartCard title="Popular Dashboards" icon={<FiTrendingUp />} data={consumptionPopularDashboards} builder={buildPopularDashboardsOption} colors={colors} />
          <ChartCard title="Active Users Over Time" icon={<FiUsers />} data={consumptionActiveUsers} builder={buildActiveUsersOption} colors={colors} />
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, color, label, value, sub }) {
  return (
    <div className="consumption-kpi-card">
      <div className="kpi-icon-row">
        <div className={`kpi-icon ${color}`}>{icon}</div>
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, icon, data, builder, colors }) {
  const hasData = Array.isArray(data) && data.length > 0;
  return (
    <div className="consumption-chart-card">
      <div className="chart-card-header">
        <h3>{icon} {title}</h3>
      </div>
      <div className="chart-container">
        {hasData ? (
          <ReactECharts
            option={builder(data, colors)}
            style={{ height: '100%', minHeight: 270 }}
            notMerge
          />
        ) : (
          <div className="consumption-empty">
            <FiInbox />
            No data for this period
          </div>
        )}
      </div>
    </div>
  );
}
