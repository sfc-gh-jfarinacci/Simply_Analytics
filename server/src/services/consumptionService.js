/**
 * Consumption Service — aggregation queries over the app_events table
 * for the admin consumption dashboard.
 */

import { query } from '../db/db.js';

function wsFilter(paramIdx, alias = 'e') {
  return `AND ${alias}.workspace_id = $${paramIdx}`;
}

/**
 * Overview KPI cards: total requests, active users, login success rate, dashboard views.
 */
export async function getOverviewStats(workspaceId, from, to) {
  const params = [from, to];
  const wClause = workspaceId ? wsFilter(3) : '';
  if (workspaceId) params.push(workspaceId);

  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE event_type NOT LIKE 'auth.%') AS total_requests,
      COUNT(DISTINCT user_id) AS active_users,
      COUNT(*) FILTER (WHERE event_type = 'auth.login_success') AS login_success,
      COUNT(*) FILTER (WHERE event_type = 'auth.login_fail') AS login_fail,
      COUNT(*) FILTER (WHERE event_type = 'dashboard.view') AS dashboard_views,
      COUNT(*) FILTER (WHERE event_type = 'ai.request') AS ai_requests,
      COUNT(*) FILTER (WHERE event_type = 'query.execute') AS query_executions
    FROM app_events e
    WHERE e.created_at >= $1 AND e.created_at <= $2
    ${wClause}
  `;

  const result = await query(sql, params);
  const row = result.rows[0];
  const loginTotal = parseInt(row.login_success) + parseInt(row.login_fail);

  return {
    totalRequests: parseInt(row.total_requests),
    activeUsers: parseInt(row.active_users),
    loginSuccessRate: loginTotal > 0 ? Math.round((parseInt(row.login_success) / loginTotal) * 100) : 100,
    dashboardViews: parseInt(row.dashboard_views),
    aiRequests: parseInt(row.ai_requests),
    queryExecutions: parseInt(row.query_executions),
    loginSuccess: parseInt(row.login_success),
    loginFail: parseInt(row.login_fail),
  };
}

/**
 * Auth metrics (login success / fail) bucketed by time.
 */
export async function getAuthMetrics(workspaceId, from, to, bucket = 'day') {
  const trunc = bucket === 'hour' ? 'hour' : 'day';
  const params = [from, to];
  const wClause = workspaceId ? wsFilter(3) : '';
  if (workspaceId) params.push(workspaceId);

  const sql = `
    SELECT
      date_trunc('${trunc}', e.created_at) AS bucket,
      COUNT(*) FILTER (WHERE event_type = 'auth.login_success') AS success,
      COUNT(*) FILTER (WHERE event_type = 'auth.login_fail') AS fail
    FROM app_events e
    WHERE e.event_type LIKE 'auth.login_%'
      AND e.created_at >= $1 AND e.created_at <= $2
      ${wClause}
    GROUP BY 1
    ORDER BY 1
  `;

  const result = await query(sql, params);
  return result.rows.map(r => ({
    bucket: r.bucket,
    success: parseInt(r.success),
    fail: parseInt(r.fail),
  }));
}

/**
 * Popular dashboards ranked by view count.
 */
export async function getDashboardPopularity(workspaceId, from, to, limit = 10) {
  const params = [from, to, limit];
  const wClause = workspaceId ? wsFilter(4) : '';
  if (workspaceId) params.push(workspaceId);

  const sql = `
    SELECT
      e.entity_id AS dashboard_id,
      e.metadata->>'dashboardName' AS dashboard_name,
      COUNT(*) AS views,
      COUNT(DISTINCT e.user_id) AS unique_viewers
    FROM app_events e
    WHERE e.event_type = 'dashboard.view'
      AND e.created_at >= $1 AND e.created_at <= $2
      ${wClause}
    GROUP BY e.entity_id, e.metadata->>'dashboardName'
    ORDER BY views DESC
    LIMIT $3
  `;

  const result = await query(sql, params);
  return result.rows.map(r => ({
    dashboardId: r.dashboard_id,
    dashboardName: r.dashboard_name || 'Unknown',
    views: parseInt(r.views),
    uniqueViewers: parseInt(r.unique_viewers),
  }));
}

/**
 * Request volume bucketed by type (ai, query, dashboard) over time.
 */
export async function getRequestVolume(workspaceId, from, to, bucket = 'day') {
  const trunc = bucket === 'hour' ? 'hour' : 'day';
  const params = [from, to];
  const wClause = workspaceId ? wsFilter(3) : '';
  if (workspaceId) params.push(workspaceId);

  const sql = `
    SELECT
      date_trunc('${trunc}', e.created_at) AS bucket,
      COUNT(*) FILTER (WHERE event_type = 'ai.request') AS ai,
      COUNT(*) FILTER (WHERE event_type = 'query.execute') AS query,
      COUNT(*) FILTER (WHERE event_type = 'dashboard.view') AS dashboard
    FROM app_events e
    WHERE e.event_type IN ('ai.request', 'query.execute', 'dashboard.view')
      AND e.created_at >= $1 AND e.created_at <= $2
      ${wClause}
    GROUP BY 1
    ORDER BY 1
  `;

  const result = await query(sql, params);
  return result.rows.map(r => ({
    bucket: r.bucket,
    ai: parseInt(r.ai),
    query: parseInt(r.query),
    dashboard: parseInt(r.dashboard),
  }));
}

/**
 * Active unique users bucketed by time.
 */
export async function getActiveUsers(workspaceId, from, to, bucket = 'day') {
  const trunc = bucket === 'hour' ? 'hour' : 'day';
  const params = [from, to];
  const wClause = workspaceId ? wsFilter(3) : '';
  if (workspaceId) params.push(workspaceId);

  const sql = `
    SELECT
      date_trunc('${trunc}', e.created_at) AS bucket,
      COUNT(DISTINCT e.user_id) AS users
    FROM app_events e
    WHERE e.created_at >= $1 AND e.created_at <= $2
      ${wClause}
    GROUP BY 1
    ORDER BY 1
  `;

  const result = await query(sql, params);
  return result.rows.map(r => ({
    bucket: r.bucket,
    users: parseInt(r.users),
  }));
}

export default {
  getOverviewStats,
  getAuthMetrics,
  getDashboardPopularity,
  getRequestVolume,
  getActiveUsers,
};
