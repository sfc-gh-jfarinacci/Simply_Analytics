/**
 * Query Concurrency Semaphore.
 *
 * Guards the Node.js process — NOT Snowflake warehouses. Snowflake handles
 * its own per-warehouse queuing natively and each connection may target a
 * different warehouse with different sizes and concurrency settings.
 *
 * This semaphore exists to prevent the Node.js heap from being overwhelmed
 * by too many in-flight result sets held in memory simultaneously. The
 * priority lanes ensure interactive users aren't starved by batch work.
 *
 * Three priority lanes (highest to lowest):
 *   1. dashboard  — widget queries; users stare at spinners, latency matters most
 *   2. ai         — SimplyAsk / Cortex Analyst; back-to-back calls, moderate latency
 *   3. batch      — API pipe endpoints; external consumers, tolerates queuing
 *
 * Unused reserves are available to any lane.
 */

const TOTAL_PERMITS     = parseInt(process.env.QUERY_CONCURRENCY_LIMIT || '200', 10);
const DASHBOARD_RESERVE = parseInt(process.env.QUERY_DASHBOARD_RESERVE || '80', 10);
const AI_RESERVE        = parseInt(process.env.QUERY_AI_RESERVE || '40', 10);
const QUEUE_TIMEOUT_MS  = parseInt(process.env.QUERY_QUEUE_TIMEOUT_MS || '60000', 10);

let activeDashboard = 0;
let activeAi = 0;
let activeBatch = 0;

const dashboardQueue = [];
const aiQueue = [];
const batchQueue = [];

function activeTotal() {
  return activeDashboard + activeAi + activeBatch;
}

function tryAdmit(lane) {
  const total = activeTotal();

  if (lane === 'dashboard' || lane === 'interactive') {
    if (total < TOTAL_PERMITS) {
      activeDashboard++;
      return true;
    }
    return false;
  }

  if (lane === 'ai') {
    const unusedDashboard = Math.max(DASHBOARD_RESERVE - activeDashboard, 0);
    const aiCeiling = TOTAL_PERMITS - unusedDashboard;
    if (total < aiCeiling) {
      activeAi++;
      return true;
    }
    return false;
  }

  // batch: cannot use permits reserved for dashboard or AI
  const unusedDashboard = Math.max(DASHBOARD_RESERVE - activeDashboard, 0);
  const unusedAi = Math.max(AI_RESERVE - activeAi, 0);
  const batchCeiling = TOTAL_PERMITS - unusedDashboard - unusedAi;
  if (total < batchCeiling) {
    activeBatch++;
    return true;
  }
  return false;
}

function releaseAndDrain(lane) {
  if (lane === 'dashboard' || lane === 'interactive') activeDashboard--;
  else if (lane === 'ai') activeAi--;
  else activeBatch--;

  // Drain in priority order: dashboard > ai > batch
  while (dashboardQueue.length > 0) {
    if (!tryAdmit('dashboard')) break;
    const w = dashboardQueue.shift();
    clearTimeout(w.timer);
    w.resolve(makeRelease('dashboard'));
  }

  while (aiQueue.length > 0) {
    if (!tryAdmit('ai')) break;
    const w = aiQueue.shift();
    clearTimeout(w.timer);
    w.resolve(makeRelease('ai'));
  }

  while (batchQueue.length > 0) {
    if (!tryAdmit('batch')) break;
    const w = batchQueue.shift();
    clearTimeout(w.timer);
    w.resolve(makeRelease('batch'));
  }
}

function makeRelease(lane) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseAndDrain(lane);
  };
}

/**
 * Acquire a semaphore permit.
 * @param {'dashboard'|'interactive'|'ai'|'batch'} lane
 * @returns {Promise<() => void>} release function
 */
export function acquire(lane = 'batch') {
  if (tryAdmit(lane)) {
    return Promise.resolve(makeRelease(lane));
  }

  const queue = (lane === 'dashboard' || lane === 'interactive')
    ? dashboardQueue
    : lane === 'ai' ? aiQueue : batchQueue;

  return new Promise((resolve, reject) => {
    const waiter = { resolve, timer: null };

    waiter.timer = setTimeout(() => {
      const idx = queue.indexOf(waiter);
      if (idx !== -1) queue.splice(idx, 1);
      reject(Object.assign(
        new Error('Server busy, try again later'),
        { statusCode: 503 },
      ));
    }, QUEUE_TIMEOUT_MS);

    queue.push(waiter);
  });
}

/**
 * Current stats (for monitoring / health endpoint).
 */
export function getStats() {
  return {
    totalPermits: TOTAL_PERMITS,
    dashboardReserve: DASHBOARD_RESERVE,
    aiReserve: AI_RESERVE,
    activeDashboard,
    activeAi,
    activeBatch,
    queuedDashboard: dashboardQueue.length,
    queuedAi: aiQueue.length,
    queuedBatch: batchQueue.length,
  };
}

export default { acquire, getStats };
