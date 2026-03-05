/**
 * useWidgetFromStore - Selective widget subscription hook
 * 
 * Each DashboardWidget uses this hook to subscribe ONLY to its own widget data.
 * This prevents unnecessary re-renders when other widgets change.
 * 
 * Uses Zustand's selector pattern with shallow comparison.
 */
import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { shallow } from 'zustand/shallow';

/**
 * Get a specific widget from the global config by ID
 * Only re-renders when THIS widget's data changes
 */
export function useWidgetFromStore(widgetId, tabId = null) {
  // Selector that finds the specific widget
  const selector = useCallback((state) => {
    const dashboard = state.currentDashboard;
    if (!dashboard?.tabs) return null;
    
    // If tabId provided, look in that specific tab
    if (tabId) {
      const tab = dashboard.tabs.find(t => t.id === tabId);
      return tab?.widgets?.find(w => w.id === widgetId) || null;
    }
    
    // Otherwise search all tabs
    for (const tab of dashboard.tabs) {
      const widget = tab.widgets?.find(w => w.id === widgetId);
      if (widget) return widget;
    }
    return null;
  }, [widgetId, tabId]);
  
  // Use shallow comparison to prevent unnecessary re-renders
  const widget = useAppStore(selector, shallow);
  
  return widget;
}

/**
 * Get widget update function scoped to a specific widget
 * Returns a function that updates only this widget's data
 */
export function useUpdateWidget(widgetId) {
  const updateWidget = useAppStore(state => state.updateWidget);
  const currentDashboard = useAppStore(state => state.currentDashboard);
  
  const update = useCallback((changes) => {
    if (!currentDashboard?.id) return;
    updateWidget(currentDashboard.id, widgetId, changes);
  }, [updateWidget, currentDashboard?.id, widgetId]);
  
  return update;
}

/**
 * Combined hook for components that need both read and write
 */
export function useWidgetConfig(widgetId, tabId = null) {
  const widget = useWidgetFromStore(widgetId, tabId);
  const updateWidget = useUpdateWidget(widgetId);
  
  return { widget, updateWidget };
}

export default useWidgetFromStore;
