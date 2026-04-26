import { consumptionApi } from '../../api/modules/consumptionApi';

function defaultRange() {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 30 * 86400000).toISOString();
  return { from, to };
}

export const createConsumptionSlice = (set, get) => ({
  consumptionOverview: null,
  consumptionAuthMetrics: [],
  consumptionPopularDashboards: [],
  consumptionRequestVolume: [],
  consumptionActiveUsers: [],
  consumptionLoading: false,
  consumptionError: null,
  consumptionDateRange: '30d',
  consumptionWorkspaceId: null,
  consumptionBucket: 'day',

  setConsumptionDateRange: (range) => set({ consumptionDateRange: range }),
  setConsumptionWorkspaceId: (id) => set({ consumptionWorkspaceId: id }),
  setConsumptionBucket: (bucket) => set({ consumptionBucket: bucket }),

  _consumptionParams() {
    const state = get();
    const rangeKey = state.consumptionDateRange;
    const now = new Date();
    let from;
    if (rangeKey === '7d') from = new Date(now.getTime() - 7 * 86400000);
    else if (rangeKey === '30d') from = new Date(now.getTime() - 30 * 86400000);
    else if (rangeKey === '90d') from = new Date(now.getTime() - 90 * 86400000);
    else from = new Date(now.getTime() - 30 * 86400000);

    return {
      workspaceId: state.consumptionWorkspaceId || undefined,
      from: from.toISOString(),
      to: now.toISOString(),
      bucket: state.consumptionBucket,
    };
  },

  loadConsumptionData: async () => {
    set({ consumptionLoading: true, consumptionError: null });
    try {
      const params = get()._consumptionParams();
      const [overview, authMetrics, popularDashboards, requestVolume, activeUsers] = await Promise.all([
        consumptionApi.getOverview(params),
        consumptionApi.getAuthMetrics(params),
        consumptionApi.getPopularDashboards(params),
        consumptionApi.getRequestVolume(params),
        consumptionApi.getActiveUsers(params),
      ]);

      set({
        consumptionOverview: overview,
        consumptionAuthMetrics: authMetrics,
        consumptionPopularDashboards: popularDashboards,
        consumptionRequestVolume: requestVolume,
        consumptionActiveUsers: activeUsers,
        consumptionLoading: false,
      });
    } catch (err) {
      set({ consumptionError: err.message, consumptionLoading: false });
    }
  },
});
