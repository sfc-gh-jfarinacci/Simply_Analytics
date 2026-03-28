import { useEffect, useRef } from 'react';
import { GridStack } from 'gridstack';
import { useAppStore } from '../../../store/appStore';

/**
 * Manages GridStack initialization, widget registration, and layout event handling.
 *
 * @param {Object} opts
 * @param {boolean} opts.isEditMode
 * @param {Array}   opts.currentWidgets
 * @param {string}  opts.dashboardLoadPhase
 * @param {string|null} opts.dashboardConnectionError
 * @param {Function} opts.updateWidget
 * @param {React.RefObject} opts.currentDashboardIdRef
 * @returns {{ gridRef, gridContainerRef, gridInitializedRef }}
 */
export function useGridStack({
  isEditMode,
  currentWidgets,
  dashboardLoadPhase,
  dashboardConnectionError,
  updateWidget,
  currentDashboardIdRef,
}) {
  const gridRef = useRef(null);
  const gridContainerRef = useRef(null);
  const gridInitializedRef = useRef(false);

  // Initialize GridStack when container is ready
  useEffect(() => {
    if (!gridContainerRef.current) return;

    // If the DOM container changed (e.g. after reconnection), the old instance is stale.
    if (gridInitializedRef.current && gridRef.current) {
      try {
        const oldEl = gridRef.current.el;
        if (oldEl !== gridContainerRef.current) {
          gridRef.current.destroy(false);
          gridRef.current = null;
          gridInitializedRef.current = false;
        } else {
          return;
        }
      } catch {
        gridRef.current = null;
        gridInitializedRef.current = false;
      }
    }

    const grid = GridStack.init({
      column: 12,
      cellHeight: 80,
      margin: 0,
      float: true,
      animate: true,
      resizable: { handles: 'se,sw,ne,nw' },
      staticGrid: !isEditMode,
      disableOneColumnMode: true,
      removable: false,
    }, gridContainerRef.current);

    grid.float(true);
    gridRef.current = grid;
    gridInitializedRef.current = true;
    gridContainerRef.current.gridstack = grid;

    // Register all existing items immediately
    const items = gridContainerRef.current.querySelectorAll('.grid-stack-item:not(.grid-stack-placeholder)');
    items.forEach(item => {
      if (!item.gridstackNode) {
        grid.makeWidget(item, {
          x: parseInt(item.getAttribute('gs-x')) || 0,
          y: parseInt(item.getAttribute('gs-y')) || 0,
          w: parseInt(item.getAttribute('gs-w')) || 4,
          h: parseInt(item.getAttribute('gs-h')) || 3,
          minW: parseInt(item.getAttribute('gs-min-w')) || 1,
          minH: parseInt(item.getAttribute('gs-min-h')) || 1,
          autoPosition: false,
          noMove: !isEditMode,
        });
      }
    });

    // Position updates use { silent: true } so layout reflow doesn't mark unsaved.
    grid.on('change', (event, changedItems) => {
      changedItems?.forEach(item => {
        const widgetId = item.el?.dataset?.widgetId;
        const dashboardId = currentDashboardIdRef.current;
        if (widgetId && dashboardId) {
          updateWidget(dashboardId, widgetId, {
            position: { x: item.x, y: item.y, w: item.w, h: item.h }
          }, { silent: true });
        }
      });
    });

    grid.on('dragstop', () => {
      useAppStore.setState({ hasUnsavedChanges: true });
    });

    grid.on('resizestop', (event, el) => {
      const widgetId = el?.dataset?.widgetId;
      const node = el?.gridstackNode;
      const dashboardId = currentDashboardIdRef.current;
      if (widgetId && node && dashboardId) {
        updateWidget(dashboardId, widgetId, {
          position: { x: node.x, y: node.y, w: node.w, h: node.h }
        });
      }
      useAppStore.setState({ hasUnsavedChanges: true });
      if (el) {
        el.dataset.justResized = '1';
        requestAnimationFrame(() => { delete el.dataset.justResized; });
      }
    });

    return () => {
      if (gridRef.current) {
        gridRef.current.destroy(false);
        gridRef.current = null;
        gridInitializedRef.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWidgets.length > 0, dashboardLoadPhase, dashboardConnectionError]);

  // Register NEW widgets added after init
  useEffect(() => {
    if (!gridInitializedRef.current || !gridRef.current || !gridContainerRef.current) return;

    const frameId = requestAnimationFrame(() => {
      const grid = gridRef.current;
      if (!grid) return;

      const items = gridContainerRef.current.querySelectorAll('.grid-stack-item:not(.grid-stack-placeholder)');
      let registered = false;
      items.forEach(item => {
        if (!item.gridstackNode) {
          grid.makeWidget(item, {
            x: parseInt(item.getAttribute('gs-x')) || 0,
            y: parseInt(item.getAttribute('gs-y')) || 0,
            w: parseInt(item.getAttribute('gs-w')) || 4,
            h: parseInt(item.getAttribute('gs-h')) || 3,
            minW: parseInt(item.getAttribute('gs-min-w')) || 1,
            minH: parseInt(item.getAttribute('gs-min-h')) || 1,
            autoPosition: false,
            noMove: !isEditMode,
          });
          registered = true;
        }
      });
      if (registered) grid.setStatic(!isEditMode);
    });

    return () => cancelAnimationFrame(frameId);
  }, [currentWidgets, isEditMode, dashboardConnectionError]);

  // Update GridStack when edit mode changes
  useEffect(() => {
    if (!gridRef.current) return;
    gridRef.current.setStatic(!isEditMode);
  }, [isEditMode]);

  return { gridRef, gridContainerRef, gridInitializedRef };
}
