import { dashboardApi, connectionApi } from '../../api/apiClient';
import { log } from '../storeUtils';

export const createDashboardSlice = (set, get) => ({
  dashboards: [],
  currentDashboard: null,
  currentTabId: null,
  hasUnsavedChanges: false,
  isSaving: false,
  isLoadingDashboards: false,
  isLoadingDashboard: false,
  dashboardLoadPhase: null,
  dashboardLoadError: null,
  dashboardConnectionError: null,
  widgetRefreshKey: 0,
  dashboardFilters: {},

  availableWarehouses: [],
  loadingWarehouses: false,

  loadWarehouses: async () => {
    set({ loadingWarehouses: true });
    try {
      const response = await connectionApi.getWarehouses();
      set({ 
        availableWarehouses: response.warehouses || [],
        loadingWarehouses: false,
      });
    } catch (error) {
      console.warn('Failed to load warehouses:', error);
      set({ loadingWarehouses: false, availableWarehouses: [] });
    }
  },

  clearUnsavedChanges: () => set({ 
    hasUnsavedChanges: false, 
    currentDashboard: null,
    currentTabId: null 
  }),
  
  setDashboardConnectionError: (error) => set({ dashboardConnectionError: error }),
  clearDashboardConnectionError: () => set({ dashboardConnectionError: null }),
  
  triggerWidgetRefresh: () => set(state => ({ widgetRefreshKey: state.widgetRefreshKey + 1 })),

  setDashboardFilter: (filterWidgetId, filter) => set(state => ({
    dashboardFilters: { ...state.dashboardFilters, [filterWidgetId]: filter },
    widgetRefreshKey: state.widgetRefreshKey + 1,
  })),
  removeDashboardFilter: (filterWidgetId) => set(state => {
    const next = { ...state.dashboardFilters };
    delete next[filterWidgetId];
    return { dashboardFilters: next, widgetRefreshKey: state.widgetRefreshKey + 1 };
  }),
  clearDashboardFilters: () => set({ dashboardFilters: {} }),

  loadDashboards: async () => {
    const { activeWorkspace } = get();
    const wsId = activeWorkspace?.id || null;
    set({ isLoadingDashboards: true, dashboardLoadError: null });
    try {
      const params = wsId ? { workspaceId: wsId } : {};
      const data = await dashboardApi.list(params);

      // Discard result if workspace changed while fetching
      if (get().activeWorkspace?.id !== wsId) return [];

      const dashboards = (data.dashboards || []).map(d => ({
        ...d,
        title: d.title || d.name,
        tabCount: d.tabCount || d.tabs?.length || 0,
        widgetCount: d.widgetCount || 0,
      }));
      set({ dashboards, isLoadingDashboards: false, dashboardLoadError: null });
      return dashboards;
    } catch (error) {
      // Discard error if workspace changed while fetching
      if (get().activeWorkspace?.id !== wsId) return [];

      console.error('Failed to load dashboards:', error);
      if (error.code === 'MFA_REQUIRED') {
        set({ 
          dashboards: [], 
          isLoadingDashboards: false,
          dashboardLoadError: {
            message: error.message,
            code: 'MFA_REQUIRED'
          }
        });
      } else {
        set({ dashboards: [], isLoadingDashboards: false });
      }
      return [];
    }
  },

  createDashboard: async (name, description) => {
    try {
      const data = await dashboardApi.create({ name, description });
      const dashboard = data.dashboard;
      const firstTabId = dashboard.tabs?.[0]?.id || null;
      set((state) => ({
        dashboards: [...state.dashboards, { ...dashboard, widgetCount: 0 }],
        currentDashboard: dashboard,
        currentTabId: firstTabId,
      }));
      return dashboard;
    } catch (error) {
      console.error('Failed to create dashboard:', error);
      throw error;
    }
  },

  removeDashboard: async (dashboardId) => {
    const { currentDashboard } = get();

    try {
      await dashboardApi.delete(dashboardId);
      set((state) => ({
        dashboards: state.dashboards.filter(d => d.id !== dashboardId),
        currentDashboard: currentDashboard?.id === dashboardId ? null : currentDashboard,
      }));
    } catch (error) {
      console.error('Failed to delete dashboard:', error);
      throw error;
    }
  },

  loadDashboard: async (id) => {
    const { dashboardLoadError } = get();
    if (dashboardLoadError?.code !== 'MFA_REQUIRED') {
      set({ dashboardLoadError: null, isLoadingDashboard: true, dashboardLoadPhase: 'config' });
    } else {
      set({ isLoadingDashboard: true, dashboardLoadPhase: 'config' });
    }
    
    try {
      const data = await dashboardApi.get(id);
      let dashboard = data.dashboard;
      
      if (!dashboard) {
        console.error('Dashboard not found:', id);
        set({ dashboardLoadError: { message: 'Dashboard not found', code: 'NOT_FOUND' }, isLoadingDashboard: false, dashboardLoadPhase: null });
        return null;
      }
      
      try {
        const groupData = await dashboardApi.getGroups(id);
        dashboard.access = (groupData.groups || []).map(g => ({
          groupId: g.id,
          groupName: g.name,
        }));
      } catch (groupError) {
        console.warn('Failed to load dashboard groups:', groupError);
        dashboard.access = [];
      }
      
      if (!dashboard.tabs) {
        const defaultTab = {
          id: 'tab-1',
          title: 'Sheet 1',
          backgroundColor: null,
          widgets: dashboard.widgets || [],
        };
        dashboard = { ...dashboard, tabs: [defaultTab], widgets: undefined };
      }
      
      const firstTabId = dashboard.tabs?.[0]?.id || null;
      
      set({ currentDashboard: dashboard, currentTabId: firstTabId, hasUnsavedChanges: false, dashboardLoadError: null, dashboardLoadPhase: 'connecting' });
      
      let connectionError = null;
      try {
        const sessionResult = await dashboardApi.initSession(id);
        if (sessionResult.success) {
          console.log('[Dashboard] Session initialized:', {
            warehouse: sessionResult.warehouse,
            role: sessionResult.role,
          });
          set({ dashboardConnectionError: null });
        } else if (sessionResult.error) {
          connectionError = sessionResult.error;
          console.error('[Dashboard] Session init failed:', connectionError);
          set({ dashboardConnectionError: connectionError });
        }
      } catch (sessionError) {
        connectionError = sessionError.message || 'Failed to connect to Snowflake';
        console.error('[Dashboard] Session init error:', connectionError);
        set({ dashboardConnectionError: connectionError });
      }
      
      set({ isLoadingDashboard: false, dashboardLoadPhase: null });
      
      get().prefetchSemanticViewMetadata(dashboard).catch(err => {
        console.warn('[Dashboard] Metadata prefetch failed:', err.message);
      });
      
      return dashboard;
    } catch (error) {
      console.error('Failed to load dashboard:', error);
      set({ 
        dashboardLoadError: { 
          message: error.message || 'Failed to load dashboard', 
          code: error.code || 'ERROR' 
        },
        currentDashboard: null,
        isLoadingDashboard: false,
        dashboardLoadPhase: null,
      });
      return null;
    }
  },
  
  clearDashboardLoadError: () => {
    set({ dashboardLoadError: null });
  },

  updateDashboard: (id, updates) => {
    const { currentDashboard, dashboards } = get();
    if (!currentDashboard || currentDashboard.id !== id) return;
    
    const updated = { ...currentDashboard, ...updates };
    const updatedDashboards = dashboards.map(d => 
      d.id === id ? { ...d, ...updates } : d
    );
    set({ 
      currentDashboard: updated, 
      dashboards: updatedDashboards,
      hasUnsavedChanges: true,
    });
    return updated;
  },

  addWidget: (dashboardId, widget) => {
    const { currentTabId, currentUser, currentRole } = get();
    const creator = currentUser?.username || currentRole || 'unknown';
    const newWidget = { 
      ...widget, 
      id: `w-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      creator,
      createdAt: new Date().toISOString(),
      lastUpdatedBy: creator,
      lastUpdatedAt: new Date().toISOString(),
    };
    
    set((state) => ({
      currentDashboard: {
        ...state.currentDashboard,
        tabs: state.currentDashboard.tabs.map(tab =>
          tab.id === currentTabId
            ? { ...tab, widgets: [...(tab.widgets || []), newWidget] }
            : tab
        ),
      },
      hasUnsavedChanges: true,
    }));
    return newWidget;
  },

  updateWidget: (dashboardId, widgetId, updates, options = {}) => {
    const { currentTabId, currentUser, currentRole } = get();
    const lastUpdatedBy = currentUser?.username || currentRole || 'unknown';
    const markDirty = !options.silent;
    set((state) => {
      const newTabs = state.currentDashboard.tabs.map(tab => {
        if (tab.id !== currentTabId) return tab;
        
        const newWidgets = tab.widgets.map(w => {
          if (w.id !== widgetId) return w;

          const hasRealChange = Object.keys(updates).some(key => {
            const oldVal = w[key];
            const newVal = updates[key];
            if (oldVal === newVal) return false;
            if (oldVal != null && newVal != null && typeof oldVal === 'object' && typeof newVal === 'object') {
              try { return JSON.stringify(oldVal) !== JSON.stringify(newVal); } catch { return true; }
            }
            return true;
          });
          if (!hasRealChange) return w;

          return { ...w, ...updates, lastUpdatedBy, lastUpdatedAt: new Date().toISOString() };
        });
        
        const widgetsChanged = newWidgets.some((w, i) => w !== tab.widgets[i]);
        if (!widgetsChanged) return tab;
        
        return { ...tab, widgets: newWidgets };
      });
      
      const tabsChanged = newTabs.some((t, i) => t !== state.currentDashboard.tabs[i]);
      if (!tabsChanged) {
        return {};
      }
      
      return {
        currentDashboard: {
          ...state.currentDashboard,
          tabs: newTabs,
        },
        ...(markDirty ? { hasUnsavedChanges: true } : {}),
      };
    });
  },

  removeWidget: (dashboardId, widgetId) => {
    const { currentTabId } = get();
    set((state) => ({
      currentDashboard: {
        ...state.currentDashboard,
        tabs: state.currentDashboard.tabs.map(tab =>
          tab.id === currentTabId
            ? { ...tab, widgets: tab.widgets.filter(w => w.id !== widgetId) }
            : tab
        ),
      },
      hasUnsavedChanges: true,
    }));
  },

  saveDashboard: async () => {
    const { currentDashboard, isAuthenticated } = get();
    if (!currentDashboard) return;
    
    if (!isAuthenticated) {
      console.warn('Cannot save dashboard: not authenticated');
      set({ hasUnsavedChanges: false });
      return;
    }

    set({ isSaving: true });
    
    try {
      const dashboardSemanticViews = [...(currentDashboard.semanticViewsReferenced || [])];
      const existingViewNames = new Set(dashboardSemanticViews.map(v => 
        typeof v === 'string' ? v : v.name
      ));
      
      (currentDashboard.tabs || []).forEach(tab => {
        (tab.widgets || []).forEach(widget => {
          (widget.semanticViewsReferenced || []).forEach(widgetView => {
            const viewName = typeof widgetView === 'string' ? widgetView : widgetView.name;
            if (!existingViewNames.has(viewName)) {
              dashboardSemanticViews.push(widgetView);
              existingViewNames.add(viewName);
            }
          });
        });
      });
      
      const yamlContent = {
        tabs: currentDashboard.tabs || [],
        filters: currentDashboard.filters || [],
        globalFilterFields: currentDashboard.globalFilterFields || [],
        semanticViewsReferenced: dashboardSemanticViews,
        customColorSchemes: currentDashboard.customColorSchemes || [],
      };
      
      const updates = {
        name: currentDashboard.name || currentDashboard.title,
        description: currentDashboard.description,
        warehouse: currentDashboard.warehouse,
        role: currentDashboard.role,
        visibility: currentDashboard.visibility,
        isPublished: currentDashboard.isPublished,
        folderId: currentDashboard.folder_id,
        yamlDefinition: yamlContent,
        tabs: currentDashboard.tabs,
        globalFilterFields: currentDashboard.globalFilterFields || [],
        semanticViewsReferenced: dashboardSemanticViews,
        customColorSchemes: currentDashboard.customColorSchemes || [],
      };
      
      await dashboardApi.update(currentDashboard.id, updates);
      
      if (currentDashboard.access && Array.isArray(currentDashboard.access)) {
        const groupIds = currentDashboard.access
          .filter(a => a.groupId)
          .map(a => a.groupId);
        await dashboardApi.updateGroups(currentDashboard.id, groupIds);
      }
      
      const updatedDashboard = { ...currentDashboard, semanticViewsReferenced: dashboardSemanticViews };
      
      const { dashboards } = get();
      const updatedDashboards = dashboards.map(d => 
        d.id === currentDashboard.id 
          ? { ...d, name: currentDashboard.name, title: currentDashboard.name }
          : d
      );
      
      set({ 
        currentDashboard: updatedDashboard,
        dashboards: updatedDashboards,
        hasUnsavedChanges: false, 
        isSaving: false 
      });
      log('Dashboard saved successfully');
      return true;
    } catch (error) {
      console.error('Failed to save dashboard:', error);
      set({ isSaving: false });
      throw error;
    }
  },

  discardChanges: async () => {
    const { currentDashboard, loadDashboard } = get();
    if (!currentDashboard) return;
    
    set({ hasUnsavedChanges: false });
    await loadDashboard(currentDashboard.id);
  },

  saveDashboardSettings: async (settings) => {
    const { currentDashboard, dashboards, isAuthenticated } = get();
    if (!currentDashboard) return;
    
    const updatedDashboard = { 
      ...currentDashboard, 
      ...settings,
      title: settings.name || settings.title || currentDashboard.title,
    };
    
    const updatedDashboards = dashboards.map(d => 
      d.id === currentDashboard.id ? { ...d, ...settings, title: updatedDashboard.title } : d
    );
    
    set({ 
      currentDashboard: updatedDashboard, 
      dashboards: updatedDashboards,
      isSaving: true,
    });
    
    if (!isAuthenticated) {
      set({ isSaving: false });
      return updatedDashboard;
    }
    
    try {
      const yamlContent = {
        tabs: updatedDashboard.tabs || [],
        filters: updatedDashboard.filters || [],
        globalFilterFields: updatedDashboard.globalFilterFields || [],
        semanticViewsReferenced: settings.semanticViewsReferenced || updatedDashboard.semanticViewsReferenced || [],
        customColorSchemes: settings.customColorSchemes || updatedDashboard.customColorSchemes || [],
      };
      
      const updatePayload = {
        title: updatedDashboard.title,
        description: settings.description ?? updatedDashboard.description,
        warehouse: settings.warehouse ?? updatedDashboard.warehouse,
        isPublished: settings.isPublished ?? updatedDashboard.isPublished,
        visibility: settings.visibility ?? updatedDashboard.visibility,
        folderId: settings.folder_id ?? updatedDashboard.folder_id,
        yamlDefinition: yamlContent,
        tabs: updatedDashboard.tabs,
        filters: updatedDashboard.filters,
        globalFilterFields: updatedDashboard.globalFilterFields || [],
        semanticViewsReferenced: settings.semanticViewsReferenced || updatedDashboard.semanticViewsReferenced,
        customColorSchemes: settings.customColorSchemes || updatedDashboard.customColorSchemes || [],
      };
      
      await dashboardApi.update(currentDashboard.id, updatePayload);
      
      set({ hasUnsavedChanges: false, isSaving: false });
      log('Dashboard settings saved to database');
      return updatedDashboard;
    } catch (error) {
      console.error('Failed to save dashboard settings:', error);
      set({ isSaving: false });
      throw error;
    }
  },

  // Tab management
  setCurrentTab: (tabId) => {
    set({ currentTabId: tabId });
  },

  addTab: (title = null) => {
    const { currentDashboard } = get();
    const tabCount = currentDashboard?.tabs?.length || 0;
    const newTab = {
      id: `tab-${Date.now()}`,
      title: title || `Sheet ${tabCount + 1}`,
      backgroundColor: null,
      widgets: [],
    };
    set((state) => ({
      currentDashboard: {
        ...state.currentDashboard,
        tabs: [...(state.currentDashboard?.tabs || []), newTab],
      },
      currentTabId: newTab.id,
      hasUnsavedChanges: true,
    }));
    return newTab;
  },

  updateTab: (tabId, updates) => {
    set((state) => ({
      currentDashboard: {
        ...state.currentDashboard,
        tabs: state.currentDashboard.tabs.map(tab =>
          tab.id === tabId ? { ...tab, ...updates } : tab
        ),
      },
      hasUnsavedChanges: true,
    }));
  },

  removeTab: (tabId) => {
    const { currentDashboard, currentTabId } = get();
    if (!currentDashboard?.tabs || currentDashboard.tabs.length <= 1) {
      return;
    }
    const newTabs = currentDashboard.tabs.filter(t => t.id !== tabId);
    const newCurrentTabId = currentTabId === tabId ? newTabs[0]?.id : currentTabId;
    set((state) => ({
      currentDashboard: {
        ...state.currentDashboard,
        tabs: newTabs,
      },
      currentTabId: newCurrentTabId,
      hasUnsavedChanges: true,
    }));
  },

  duplicateTab: (tabId) => {
    const { currentDashboard } = get();
    const tabToDuplicate = currentDashboard?.tabs?.find(t => t.id === tabId);
    if (!tabToDuplicate) return;

    const newTab = {
      ...tabToDuplicate,
      id: `tab-${Date.now()}`,
      title: `${tabToDuplicate.title} (Copy)`,
      widgets: tabToDuplicate.widgets.map(w => ({ ...w, id: `w-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` })),
    };
    set((state) => ({
      currentDashboard: {
        ...state.currentDashboard,
        tabs: [...(state.currentDashboard?.tabs || []), newTab],
      },
      currentTabId: newTab.id,
      hasUnsavedChanges: true,
    }));
    return newTab;
  },

});
