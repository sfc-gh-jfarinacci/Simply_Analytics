import { useState, useCallback, useMemo } from 'react';

/**
 * Manages widget CRUD operations, selection state, position finding, and default configs.
 */
export function useWidgetActions({
  currentDashboard,
  currentWidgets,
  addWidget,
  updateWidget,
  removeWidget,
  removeDashboardFilter,
  clearEditingWidgetConfig,
  gridRef,
  gridContainerRef,
  toast,
  showAiChat,
  useSidePanel,
  useInlineEditor,
}) {
  const [editingWidget, setEditingWidget] = useState(null);
  const [isCreatingWidget, setIsCreatingWidget] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState(null);
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);
  const [aiFocusedWidgetId, setAiFocusedWidgetId] = useState(null);

  const selectedWidget = currentWidgets.find(w => w.id === selectedWidgetId);

  const liveEditingWidget = useMemo(() => {
    if (!editingWidget) return null;
    return currentWidgets.find(w => w.id === editingWidget.id) || editingWidget;
  }, [editingWidget, currentWidgets]);

  const findNextAvailablePosition = useCallback((width = 4, height = 3) => {
    const GRID_COLUMNS = 12;

    const getWidgetPositions = () => {
      if (gridRef.current && gridContainerRef.current) {
        const items = gridContainerRef.current.querySelectorAll('.grid-stack-item');
        return Array.from(items).map(item => {
          if (item.gridstackNode) {
            return {
              x: item.gridstackNode.x || 0, y: item.gridstackNode.y || 0,
              w: item.gridstackNode.w || 4, h: item.gridstackNode.h || 3,
            };
          }
          return {
            x: parseInt(item.getAttribute('gs-x')) || 0,
            y: parseInt(item.getAttribute('gs-y')) || 0,
            w: parseInt(item.getAttribute('gs-w')) || 4,
            h: parseInt(item.getAttribute('gs-h')) || 3,
          };
        });
      }
      return currentWidgets.map(widget => {
        const pos = widget.position || {};
        return { x: pos.x || 0, y: pos.y || 0, w: pos.w || 4, h: pos.h || 3 };
      });
    };

    const positions = getWidgetPositions();
    if (positions.length === 0) return { x: 0, y: 0, w: width, h: height };

    let maxY = 0;
    positions.forEach(pos => { if (pos.y + pos.h > maxY) maxY = pos.y + pos.h; });

    const gridHeight = maxY + height + 5;
    const occupied = Array.from({ length: gridHeight }, () =>
      Array.from({ length: GRID_COLUMNS }, () => false)
    );

    positions.forEach(pos => {
      for (let y = pos.y; y < pos.y + pos.h && y < gridHeight; y++) {
        for (let x = pos.x; x < pos.x + pos.w && x < GRID_COLUMNS; x++) {
          occupied[y][x] = true;
        }
      }
    });

    const canFit = (startX, startY) => {
      if (startX + width > GRID_COLUMNS || startY + height > gridHeight) return false;
      for (let y = startY; y < startY + height; y++) {
        for (let x = startX; x < startX + width; x++) {
          if (occupied[y][x]) return false;
        }
      }
      return true;
    };

    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x <= GRID_COLUMNS - width; x++) {
        if (canFit(x, y)) return { x, y, w: width, h: height };
      }
    }

    return { x: 0, y: maxY, w: width, h: height };
  }, [gridRef, gridContainerRef, currentWidgets]);

  const getDefaultWidgetConfig = (type) => {
    const defaultColors = ['#00d4ff', '#7c3aed', '#10b981', '#f59e0b', '#ef4444'];
    switch (type) {
      case 'bar': case 'horizontal-bar': case 'stacked-bar': case 'diverging-bar':
      case 'line': case 'multiline': case 'area':
      case 'pie': case 'donut': case 'radial':
      case 'treemap': case 'icicle': case 'sankey':
        return { config: { colors: defaultColors } };
      case 'table':
        return { config: { pageSize: 10 } };
      case 'metric':
        return { config: { format: 'number', prefix: '', suffix: '' } };
      case 'title':
        return { config: { titleText: '', subtitle: '', titleAlign: 'left', titleFontSize: 22 } };
      case 'filter':
        return { config: { filterField: '', filterLabel: '', filterType: 'dropdown', filterValues: [] } };
      default:
        return { config: { colors: defaultColors } };
    }
  };

  const handleDeleteWidget = useCallback((widgetId) => {
    if (!currentDashboard?.id) return;
    const widget = currentWidgets.find(w => w.id === widgetId);
    const widgetName = widget?.title || 'Widget';

    if (widget?.type === 'filter') removeDashboardFilter(widgetId);
    removeWidget(currentDashboard.id, widgetId);

    if (selectedWidgetId === widgetId) {
      setEditingWidget(null);
      setSelectedWidgetId(null);
      clearEditingWidgetConfig();
    }
    toast.info(`"${widgetName}" deleted`, 3000);
  }, [currentDashboard?.id, currentWidgets, removeWidget, removeDashboardFilter, selectedWidgetId, clearEditingWidgetConfig, toast]);

  const handleSelectWidget = useCallback((widget) => {
    clearEditingWidgetConfig();
    if (showAiChat) setAiFocusedWidgetId(widget.id);

    if (useSidePanel || useInlineEditor) {
      setSelectedWidgetId(widget.id);
      setEditingWidget(widget);
      setIsCreatingWidget(false);
    } else {
      setEditingWidget(widget);
      setIsCreatingWidget(false);
    }
  }, [clearEditingWidgetConfig, showAiChat, useSidePanel, useInlineEditor]);

  const handleDeselectWidget = useCallback(() => {
    setSelectedWidgetId(null);
    setEditingWidget(null);
    setIsCreatingWidget(false);
  }, []);

  const handleOpenNewWidget = useCallback(async () => {
    if (!currentDashboard) return;
    const position = findNextAvailablePosition(4, 3);
    const defaultTitle = `Widget_${currentWidgets.length + 1}`;
    const widgetConfig = {
      type: 'table',
      title: defaultTitle,
      config: getDefaultWidgetConfig('table'),
      position,
      query: { dimensions: [], measures: [], filters: [], orderBy: [], limit: 1000000 },
    };
    const newWidget = await addWidget(currentDashboard.id, widgetConfig);
    if (newWidget) {
      setSelectedWidgetId(newWidget.id);
      setEditingWidget(newWidget);
      setIsCreatingWidget(false);
    }
  }, [currentDashboard, currentWidgets.length, findNextAvailablePosition, addWidget]);

  const handleAddSpecialWidget = useCallback(async (type) => {
    if (!currentDashboard) return;
    const sizes = {
      title: { w: 12, h: 1, minW: 2, minH: 1 },
      filter: { w: 4, h: 1, minW: 2, minH: 1 },
    };
    const s = sizes[type] || { w: 4, h: 3 };
    const position = findNextAvailablePosition(s.w, s.h);
    const defaults = { title: 'Dashboard Title', filter: 'Filter' };
    const widgetConfig = {
      type,
      title: defaults[type] || `New ${type}`,
      config: getDefaultWidgetConfig(type),
      position: { ...position, ...s },
      query: { dimensions: [], measures: [], filters: [], orderBy: [], limit: 1000000 },
    };
    const newWidget = await addWidget(currentDashboard.id, widgetConfig);
    if (newWidget) {
      setSelectedWidgetId(newWidget.id);
      setEditingWidget(newWidget);
      setIsCreatingWidget(false);
    }
  }, [currentDashboard, findNextAvailablePosition, addWidget]);

  const handleAddWidget = useCallback(async (type) => {
    if (!currentDashboard) return;
    const position = findNextAvailablePosition(4, 3);
    const widgetConfig = {
      type,
      title: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      config: getDefaultWidgetConfig(type),
      position,
    };
    const widget = await addWidget(currentDashboard.id, widgetConfig);
    setShowWidgetPicker(false);
    if (widget) {
      setEditingWidget(widget);
      setIsCreatingWidget(false);
    }
  }, [currentDashboard, findNextAvailablePosition, addWidget]);

  const handleWidgetResize = useCallback((widgetId, newSize) => {
    if (!currentDashboard) return;
    const widget = currentWidgets.find((w) => w.id === widgetId);
    if (widget) {
      const currentPosition = widget.position || { x: 0, y: 0, w: 4, h: 3 };
      updateWidget(currentDashboard.id, widgetId, {
        position: {
          x: typeof newSize.x === 'number' ? newSize.x : (currentPosition.x || 0),
          y: typeof newSize.y === 'number' ? newSize.y : (currentPosition.y || 0),
          w: newSize.w,
          h: newSize.h,
        },
      });
    }
  }, [currentDashboard, currentWidgets, updateWidget]);

  return {
    editingWidget, setEditingWidget,
    isCreatingWidget, setIsCreatingWidget,
    selectedWidgetId, setSelectedWidgetId,
    showWidgetPicker, setShowWidgetPicker,
    aiFocusedWidgetId, setAiFocusedWidgetId,
    selectedWidget, liveEditingWidget,
    findNextAvailablePosition, getDefaultWidgetConfig,
    handleDeleteWidget, handleSelectWidget, handleDeselectWidget,
    handleOpenNewWidget, handleAddSpecialWidget, handleAddWidget,
    handleWidgetResize,
  };
}
