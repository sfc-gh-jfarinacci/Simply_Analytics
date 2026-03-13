import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';
import DashboardWidget from '../components/DashboardWidget';
import WidgetEditor from '../components/widget-editor';
import DashboardEditPanel from '../components/DashboardEditPanel';
import DashboardSettingsModal from '../components/DashboardSettingsModal';
import CreateDashboardModal from '../components/CreateDashboardModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { useToast } from '../components/Toast';
import {
  FiGrid,
  FiPlus,
  FiEdit3,
  FiTrash2,
  FiBarChart2,
  FiPieChart,
  FiTrendingUp,
  FiTable,
  FiHash,
  FiSettings,
  FiDatabase,
  FiX,
  FiSearch,
  FiAlignLeft,
  FiColumns,
  FiMinusCircle,
  FiActivity,
  FiDisc,
  FiSun,
  FiCrosshair,
  FiCircle,
  FiHexagon,
  FiMaximize2,
  FiRepeat,
  FiGitBranch,
  FiShare2,
  FiChevronLeft,
  FiChevronRight,
  FiMenu,
  FiMoreVertical,
  FiEye,
  FiRefreshCw,
  FiSave,
  FiWifi,
  FiWifiOff,
  FiArrowLeft,
  FiLayers,
  FiAlertTriangle,
  FiRotateCcw,
  FiRotateCw,
  FiHelpCircle,
  FiCheck,
} from 'react-icons/fi';
import { sfConnectionApi } from '../api/apiClient';
import CortexAgentChat from '../components/CortexAgentChat';
import '../styles/DashboardView.css';

// Debug logging
const DEBUG = import.meta.env.VITE_DEBUG === 'true';
const log = (...args) => DEBUG && log(...args);

// Layout modes similar to Tableau
const LAYOUT_MODES = {
  ADAPTIVE: 'adaptive',  // Auto-fit to screen
  FIXED: 'fixed',        // Fixed pixel sizes
};

// Device preview modes
const DEVICE_MODES = {
  DESKTOP: 'desktop',
  TABLET: 'tablet',
  MOBILE: 'mobile',
};

const DashboardView = () => {
  const {
    dashboards,
    currentDashboard,
    currentTabId,
    createDashboard,
    loadDashboard,
    removeDashboard,
    addWidget,
    updateWidget,
    removeWidget,
    updateDashboard,
    setCurrentTab,
    addTab,
    updateTab,
    removeTab,
    duplicateTab,
    hasUnsavedChanges,
    isSaving,
    saveDashboard,
    isLoadingDashboards,
    isLoadingDashboard,
    dashboardLoadPhase,
    currentUser,
    currentRole,
    dashboardLoadError,
    clearDashboardLoadError,
    clearEditingWidgetConfig = () => {},
    // Undo/Redo (with defaults since not yet implemented in store)
    undo = () => {},
    redo = () => {},
    canUndo = () => false,
    canRedo = () => false,
    clearHistory = () => {},
  } = useAppStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  
  // Get id from query params
  const dashboardIdFromUrl = searchParams.get('id');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingWidget, setEditingWidget] = useState(null);
  const [isCreatingWidget, setIsCreatingWidget] = useState(false);
  const [dashboardName, setDashboardName] = useState('');
  
  // Widget editor state
  const [selectedWidgetId, setSelectedWidgetId] = useState(null);
  const [useSidePanel, setUseSidePanel] = useState(true); // Use left side panel for editing
  const [useInlineEditor, setUseInlineEditor] = useState(false); // Legacy inline mode (disabled)
  
  // Load dashboard from URL query param if present
  useEffect(() => {
    if (dashboardIdFromUrl) {
      // Always try to load if we have an ID and it's different from current
      // Server will return appropriate error if user doesn't have access
      // Don't reload if we already have an error for this attempt
      const shouldLoad = !currentDashboard || currentDashboard.id !== dashboardIdFromUrl;
      const hasErrorForThisId = dashboardLoadError && !currentDashboard;
      
      if (shouldLoad && !hasErrorForThisId && !isLoadingDashboard) {
        loadDashboard(dashboardIdFromUrl);
      }
    }
  }, [dashboardIdFromUrl, currentDashboard, dashboardLoadError, isLoadingDashboard, loadDashboard]);
  
  // Open a dashboard and update URL
  const openDashboard = useCallback((id) => {
    loadDashboard(id);
    setSearchParams({ id }, { replace: true });
  }, [loadDashboard, setSearchParams]);
  const [layoutMode, setLayoutMode] = useState(LAYOUT_MODES.ADAPTIVE);
  const [devicePreview, setDevicePreview] = useState(DEVICE_MODES.DESKTOP);
  const [autoDetectDevice, setAutoDetectDevice] = useState(true);
  const [fixedCanvasSize, setFixedCanvasSize] = useState({ width: 1024, height: 768 });
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [compactToolbar, setCompactToolbar] = useState(false);
  
  // Inline title editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const titleInputRef = useRef(null);
  const titleSaveTimerRef = useRef(null);
  
  // GridStack reference
  const gridRef = useRef(null);
  const gridContainerRef = useRef(null);
  const gridInitializedRef = useRef(false);
  const currentDashboardIdRef = useRef(null);
  
  // Keep ref in sync with current dashboard ID
  useEffect(() => {
    currentDashboardIdRef.current = currentDashboard?.id;
  }, [currentDashboard?.id]);
  
  const canvasRef = useRef(null);
  const toolbarMenuRef = useRef(null);
  const dashboardMainRef = useRef(null);
  
  // Edit mode state - dashboards open in view mode by default
  const [isEditMode, setIsEditMode] = useState(false);
  
  // Connection state for dashboard-level reconnection
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  // Get connection error from store (set by widgets when they encounter network errors)
  const dashboardConnectionError = useAppStore(state => state.dashboardConnectionError);
  const clearDashboardConnectionError = useAppStore(state => state.clearDashboardConnectionError);
  const triggerWidgetRefresh = useAppStore(state => state.triggerWidgetRefresh);
  
  // Tab management state
  const [tabContextMenu, setTabContextMenu] = useState({ open: false, x: 0, y: 0, tabId: null });
  const [editingTabId, setEditingTabId] = useState(null);
  const [editedTabTitle, setEditedTabTitle] = useState('');
  const [showTabColorPicker, setShowTabColorPicker] = useState(null);
  const [previewTabColor, setPreviewTabColor] = useState(null);
  const [previewCanvasColor, setPreviewCanvasColor] = useState(null);
  const tabContextMenuRef = useRef(null);
  
  // Tab list navigation
  const tabListRef = useRef(null);
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  
  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, itemName: '', itemType: '', onConfirm: null });
  
  // Exit edit mode confirmation state (when unsaved changes exist)
  const [exitEditConfirm, setExitEditConfirm] = useState(false);
  
  // Back button confirmation state (when unsaved changes exist)
  const [backConfirm, setBackConfirm] = useState(false);
  
  // Keyboard shortcuts panel state
  const [showShortcuts, setShowShortcuts] = useState(false);
  
  // Save success animation state
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Enhanced save with success animation
  const handleSaveWithAnimation = useCallback(async () => {
    if (!hasUnsavedChanges || isSaving) return;
    
    try {
      await saveDashboard();
      setSaveSuccess(true);
      
      // Reset after animation
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, [hasUnsavedChanges, isSaving, saveDashboard]);
  
  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;
      
      // Undo: Cmd/Ctrl + Z
      if (cmdKey && e.key === 'z' && !e.shiftKey && isEditMode) {
        e.preventDefault();
        if (canUndo()) {
          undo();
        }
        return;
      }
      
      // Redo: Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y
      if ((cmdKey && e.key === 'z' && e.shiftKey) || (cmdKey && e.key === 'y')) {
        e.preventDefault();
        if (isEditMode && canRedo()) {
          redo();
        }
        return;
      }
      
      // Save: Cmd/Ctrl + S
      if (cmdKey && e.key === 's' && isEditMode) {
        e.preventDefault();
        if (hasUnsavedChanges) {
          saveDashboard();
        }
        return;
      }
      
      // Toggle shortcuts: ? or /
      if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !cmdKey) {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
        return;
      }
      
      // Escape: Close shortcuts panel, deselect widget
      if (e.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false);
        } else if (editingWidget) {
          handleDeselectWidget();
        }
        return;
      }
      
      // Add widget: A (when in edit mode, nothing selected)
      if (e.key === 'a' && isEditMode && !editingWidget && !cmdKey) {
        e.preventDefault();
        handleOpenNewWidget();
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditMode, canUndo, canRedo, undo, redo, hasUnsavedChanges, saveDashboard, showShortcuts, editingWidget]);
  
  // Get current tab's widgets
  const currentTab = currentDashboard?.tabs?.find(t => t.id === currentTabId);
  const allWidgets = currentTab?.widgets || [];
  
  // Sort widgets by position (y first, then x) so they render in logical order
  // Widgets without position go to the end
  const currentWidgets = useMemo(() => {
    return [...allWidgets].sort((a, b) => {
      const aY = a.position?.y ?? 999;
      const bY = b.position?.y ?? 999;
      if (aY !== bY) return aY - bY;
      const aX = a.position?.x ?? 999;
      const bX = b.position?.x ?? 999;
      return aX - bX;
    });
  }, [allWidgets]);
  
  // Widget deletion - delete immediately, show brief notification
  const handleDeleteWidget = useCallback((widgetId) => {
    if (!currentDashboard?.id) return;
    
    // Get widget info before deleting (for the toast message)
    const widget = currentWidgets.find(w => w.id === widgetId);
    const widgetName = widget?.title || 'Widget';
    
    // Delete immediately (this pushes to history automatically)
    removeWidget(currentDashboard.id, widgetId);
    
    // Close the edit panel if this widget was being edited
    if (selectedWidgetId === widgetId) {
      setEditingWidget(null);
      setSelectedWidgetId(null);
      clearEditingWidgetConfig();
    }
    
    // Show simple info toast - users can use ⌘Z or toolbar to undo
    toast.info(`"${widgetName}" deleted`, 3000);
  }, [currentDashboard?.id, currentWidgets, removeWidget, selectedWidgetId, clearEditingWidgetConfig, toast]);
  
  // Permission checking - uses access_level from backend
  const accessLevel = currentDashboard?.access_level;
  const isOwner = currentDashboard?.isOwner || accessLevel === 'owner';
  const isAdmin = accessLevel === 'admin';
  const hasEditAccess = isOwner || isAdmin || accessLevel === 'edit';
  const hasViewAccess = hasEditAccess || accessLevel === 'view';
  
  // Can edit: Owner, Admin, or has Edit access
  const canEdit = hasEditAccess;
  // Can delete: Owner or Admin only
  const canDelete = isOwner || isAdmin;
  // Can access settings: Owner or Admin only
  const canManageSettings = isOwner || isAdmin;
  // Can create dashboards: Owner, Admin, or Creator (NOT viewers)
  const canCreateDashboards = ['owner', 'admin', 'creator'].includes(currentRole);
  
  // Reset edit mode only when navigating to a DIFFERENT dashboard (based on URL, not store)
  const prevDashboardIdFromUrlRef = useRef(dashboardIdFromUrl);
  useEffect(() => {
    // Only reset edit mode if the URL parameter actually changed to a different dashboard
    if (prevDashboardIdFromUrlRef.current !== dashboardIdFromUrl && dashboardIdFromUrl) {
      setIsEditMode(false);
    }
    prevDashboardIdFromUrlRef.current = dashboardIdFromUrl;
  }, [dashboardIdFromUrl]);
  
  // In view mode, if current tab is empty, switch to first non-empty tab
  useEffect(() => {
    if (!isEditMode && currentDashboard?.tabs && currentTabId) {
      const currentTab = currentDashboard.tabs.find(t => t.id === currentTabId);
      const isCurrentTabEmpty = !currentTab?.widgets || currentTab.widgets.length === 0;
      
      if (isCurrentTabEmpty) {
        // Find first non-empty tab
        const firstNonEmptyTab = currentDashboard.tabs.find(t => t.widgets && t.widgets.length > 0);
        if (firstNonEmptyTab) {
          setCurrentTab(firstNonEmptyTab.id);
        }
      }
    }
  }, [isEditMode, currentDashboard?.tabs, currentTabId, setCurrentTab]);
  
  // Auto-detect device mode based on AVAILABLE dashboard space (not browser width)
  useEffect(() => {
    if (!autoDetectDevice) return;
    
    const detectDevice = () => {
      // Use canvas width if available, otherwise fall back to estimating available space
      let availableWidth;
      if (canvasRef.current) {
        availableWidth = canvasRef.current.offsetWidth;
      } else {
        // Estimate: browser width minus main sidebar (~220px)
        availableWidth = window.innerWidth - 220;
      }
      
      if (availableWidth <= 500) {
        setDevicePreview(DEVICE_MODES.MOBILE);
      } else if (availableWidth <= 900) {
        setDevicePreview(DEVICE_MODES.TABLET);
      } else {
        setDevicePreview(DEVICE_MODES.DESKTOP);
      }
    };
    
    // Initial detection
    detectDevice();
    
    // Use ResizeObserver for accurate canvas size detection
    let resizeObserver;
    if (canvasRef.current) {
      resizeObserver = new ResizeObserver(detectDevice);
      resizeObserver.observe(canvasRef.current);
    }
    
    // Also listen to window resize as fallback
    window.addEventListener('resize', detectDevice);
    
    return () => {
      window.removeEventListener('resize', detectDevice);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [autoDetectDevice]);
  
  // When user manually selects a device mode, disable auto-detection
  const handleDeviceChange = (mode) => {
    setAutoDetectDevice(false);
    setDevicePreview(mode);
  };

  // Close toolbar menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (toolbarMenuRef.current && !toolbarMenuRef.current.contains(e.target)) {
        setToolbarMenuOpen(false);
      }
    };
    if (toolbarMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [toolbarMenuOpen]);

  // Close compact menu when toolbar mode changes (screen resize)
  useEffect(() => {
    if (!compactToolbar) {
      setToolbarMenuOpen(false);
    }
  }, [compactToolbar]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle shortcuts when not typing in an input
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      
      // Ctrl/Cmd + S = Save dashboard
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isEditMode && hasUnsavedChanges && !isSaving) {
          saveDashboard();
        }
      }
      
      // Escape = Exit edit mode or close modals
      if (e.key === 'Escape' && !isTyping) {
        if (editingWidget) {
          // Close widget editor - handled by WidgetEditor
          return;
        }
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (isEditMode && !hasUnsavedChanges) {
          setIsEditMode(false);
        } else if (isEditMode && hasUnsavedChanges) {
          setExitEditConfirm(true);
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditMode, hasUnsavedChanges, isSaving, saveDashboard, editingWidget, showSettings]);

  // Inline title editing handlers
  const handleTitleDoubleClick = () => {
    // Only allow editing in edit mode
    if (!isEditMode) return;
    if (currentDashboard) {
      setEditedTitle(currentDashboard.name);
      setEditingTitle(true);
      setTimeout(() => titleInputRef.current?.focus(), 10);
    }
  };

  const handleTitleChange = (e) => {
    const newValue = e.target.value;
    setEditedTitle(newValue);
    // Auto-save after 1.5 seconds of no typing
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
    }
    titleSaveTimerRef.current = setTimeout(() => {
      saveTitleChange(newValue);
    }, 1500);
  };

  const saveTitleChange = (newTitle) => {
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = null;
    }
    if (currentDashboard && newTitle && newTitle.trim() && newTitle.trim() !== currentDashboard.name) {
      updateDashboard(currentDashboard.id, { name: newTitle.trim() });
    }
    setEditingTitle(false);
    setEditedTitle('');
  };
  
  // Initialize GridStack when container is ready (re-run when widgets appear)
  useEffect(() => {
    if (!gridContainerRef.current) return;
    
    // If the DOM container changed (e.g. after reconnection unmounted/remounted
    // the grid), the old GridStack instance is stale. Clean it up so we
    // reinitialize against the new container element.
    if (gridInitializedRef.current && gridRef.current) {
      try {
        const oldEl = gridRef.current.el;
        if (oldEl !== gridContainerRef.current) {
          gridRef.current.destroy(false);
          gridRef.current = null;
          gridInitializedRef.current = false;
        } else {
          return; // Same container, already initialized
        }
      } catch {
        gridRef.current = null;
        gridInitializedRef.current = false;
      }
    }
    
    // Initialize GridStack with responsive columns
    const grid = GridStack.init({
      column: 12,
      cellHeight: 80,
      margin: 8,
      float: true,
      animate: true,
      resizable: { handles: 'se,sw,ne,nw' },
      staticGrid: !isEditMode,
      disableOneColumnMode: true,
      removable: false,
    }, gridContainerRef.current);
    
    // float(true) lets widgets keep gaps but still prevents overlap
    grid.float(true);
    
    gridRef.current = grid;
    gridInitializedRef.current = true;
    
    // Store grid instance on the element for access from widgets
    gridContainerRef.current.gridstack = grid;
    
    // Register all existing items immediately (they're already in the DOM)
    const items = gridContainerRef.current.querySelectorAll('.grid-stack-item:not(.grid-stack-placeholder)');
    items.forEach(item => {
      if (!item.gridstackNode) {
        grid.makeWidget(item, {
          x: parseInt(item.getAttribute('gs-x')) || 0,
          y: parseInt(item.getAttribute('gs-y')) || 0,
          w: parseInt(item.getAttribute('gs-w')) || 4,
          h: parseInt(item.getAttribute('gs-h')) || 3,
          minW: parseInt(item.getAttribute('gs-min-w')) || 2,
          minH: parseInt(item.getAttribute('gs-min-h')) || 2,
          autoPosition: false,
          noMove: !isEditMode,
        });
      }
    });
    
    // Position updates use { silent: true } so layout reflow from the
    // editor panel opening/closing doesn't mark the dashboard as unsaved.
    grid.on('change', (event, items) => {
      items?.forEach(item => {
        const widgetId = item.el?.dataset?.widgetId;
        const dashboardId = currentDashboardIdRef.current;
        if (widgetId && dashboardId) {
          updateWidget(dashboardId, widgetId, {
            position: { x: item.x, y: item.y, w: item.w, h: item.h }
          }, { silent: true });
        }
      });
    });

    // Mark unsaved only when the user finishes an intentional drag
    grid.on('dragstop', () => {
      useAppStore.setState({ hasUnsavedChanges: true });
    });

    // Persist position after resize and mark unsaved
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
      // Brief flag so the widget's click handler knows not to open the editor
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
  // Re-run when widgets exist, load phase clears, or connection error clears
  // (grid container unmounts during error state and remounts after reconnection)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWidgets.length > 0, dashboardLoadPhase, dashboardConnectionError]);
  
  // Register NEW widgets added after init (e.g. user adds a widget)
  useEffect(() => {
    if (!gridInitializedRef.current || !gridRef.current || !gridContainerRef.current) return;
    
    // Use rAF to wait for React to commit the new DOM elements
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
            minW: parseInt(item.getAttribute('gs-min-w')) || 2,
            minH: parseInt(item.getAttribute('gs-min-h')) || 2,
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
    
    // setStatic(true) disables all move/resize, setStatic(false) enables them
    gridRef.current.setStatic(!isEditMode);
  }, [isEditMode]);

  const handleTitleBlur = () => {
    saveTitleChange(editedTitle);
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter') {
      saveTitleChange(editedTitle);
    } else if (e.key === 'Escape') {
      cancelTitleEdit();
    }
  };

  const cancelTitleEdit = () => {
    setEditingTitle(false);
    setEditedTitle('');
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
    }
  };

  // Detect when dashboard area is too small for full toolbar
  useEffect(() => {
    const checkToolbarSpace = () => {
      if (dashboardMainRef.current) {
        const width = dashboardMainRef.current.offsetWidth;
        // Switch to compact toolbar when available space is less than 700px
        setCompactToolbar(width < 700);
      }
    };

    checkToolbarSpace();

    let resizeObserver;
    if (dashboardMainRef.current) {
      resizeObserver = new ResizeObserver(checkToolbarSpace);
      resizeObserver.observe(dashboardMainRef.current);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [currentDashboard]);

  // Close tab context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (tabContextMenuRef.current && !tabContextMenuRef.current.contains(e.target)) {
        setTabContextMenu({ open: false, x: 0, y: 0, tabId: null });
      }
    };
    if (tabContextMenu.open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [tabContextMenu.open]);

  // Tab list overflow detection
  const checkTabOverflow = useCallback(() => {
    if (!tabListRef.current) return;
    const el = tabListRef.current;
    const hasOverflowLeft = el.scrollLeft > 0;
    const hasOverflowRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setTabOverflow({ left: hasOverflowLeft, right: hasOverflowRight });
  }, []);

  // Check overflow when tabs change
  useEffect(() => {
    checkTabOverflow();
    // Also check on resize
    window.addEventListener('resize', checkTabOverflow);
    return () => window.removeEventListener('resize', checkTabOverflow);
  }, [currentDashboard?.tabs, checkTabOverflow]);

  // Scroll tabs left/right
  const scrollTabs = (direction) => {
    if (!tabListRef.current) return;
    const scrollAmount = 150;
    tabListRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
    // Check overflow after scroll
    setTimeout(checkTabOverflow, 300);
  };

  // Tab context menu handlers
  const handleTabContextMenu = (e, tabId) => {
    e.preventDefault();
    setTabContextMenu({ open: true, x: e.clientX, y: e.clientY, tabId });
  };

  const handleRenameTab = () => {
    const tab = currentDashboard?.tabs?.find(t => t.id === tabContextMenu.tabId);
    if (tab) {
      setEditingTabId(tabContextMenu.tabId);
      setEditedTabTitle(tab.title);
    }
    setTabContextMenu({ open: false, x: 0, y: 0, tabId: null });
  };

  const saveTabTitle = () => {
    if (editingTabId && editedTabTitle.trim()) {
      // Only update if the title actually changed
      const currentTab = currentDashboard?.tabs?.find(t => t.id === editingTabId);
      if (currentTab && currentTab.title !== editedTabTitle.trim()) {
        updateTab(editingTabId, { title: editedTabTitle.trim() });
      }
    }
    setEditingTabId(null);
    setEditedTabTitle('');
  };

  const handleTabTitleKeyDown = (e) => {
    if (e.key === 'Enter') {
      saveTabTitle();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
      setEditedTabTitle('');
    }
  };

  const handleDeleteTab = () => {
    if (tabContextMenu.tabId) {
      const tabToDelete = currentDashboard?.tabs?.find(t => t.id === tabContextMenu.tabId);
      if (tabToDelete) {
        setDeleteConfirm({
          open: true,
          itemName: tabToDelete.title || 'Untitled Tab',
          itemType: 'tab',
          onConfirm: () => {
            removeTab(tabContextMenu.tabId);
            setDeleteConfirm({ open: false, itemName: '', itemType: '', onConfirm: null });
          }
        });
      }
    }
    setTabContextMenu({ open: false, x: 0, y: 0, tabId: null });
  };

  const handleDuplicateTab = () => {
    if (tabContextMenu.tabId) {
      duplicateTab(tabContextMenu.tabId);
    }
    setTabContextMenu({ open: false, x: 0, y: 0, tabId: null });
  };

  const handlePreviewTabColor = (color) => {
    setPreviewTabColor(color);
  };

  const handleApplyTabColor = () => {
    if (tabContextMenu.tabId && previewTabColor !== null) {
      updateTab(tabContextMenu.tabId, { backgroundColor: previewTabColor });
    }
    setPreviewTabColor(null);
  };

  const handlePreviewCanvasColor = (color) => {
    setPreviewCanvasColor(color);
  };

  const handleApplyCanvasColor = () => {
    if (tabContextMenu.tabId && previewCanvasColor !== null) {
      updateTab(tabContextMenu.tabId, { canvasColor: previewCanvasColor });
    }
    setPreviewCanvasColor(null);
  };

  // Quick apply for preset colors (one click)
  const handleQuickSetTabColor = (color) => {
    if (tabContextMenu.tabId) {
      updateTab(tabContextMenu.tabId, { backgroundColor: color });
    }
    setPreviewTabColor(null);
    setTabContextMenu({ open: false, x: 0, y: 0, tabId: null });
  };

  const handleQuickSetCanvasColor = (color) => {
    if (tabContextMenu.tabId) {
      updateTab(tabContextMenu.tabId, { canvasColor: color });
    }
    setPreviewCanvasColor(null);
    setTabContextMenu({ open: false, x: 0, y: 0, tabId: null });
  };

  const TAB_COLORS = [
    null, // Default (no color)
    '#ef4444', // Red
    '#f97316', // Orange
    '#eab308', // Yellow
    '#22c55e', // Green
    '#14b8a6', // Teal
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#6b7280', // Gray
  ];

  // Handle saving dashboard settings (local update - persists with main dashboard save)
  const handleSaveSettings = async (settings) => {
    if (currentDashboard) {
      // Update local state only - will be persisted when user clicks main Save button
      await useAppStore.getState().updateDashboard(currentDashboard.id, settings);
      setShowSettings(false);
      // Don't change edit mode - user should remain in edit mode
    }
  };

  // Handle dashboard-level reconnection (used when IP changes due to VPN)
  const handleReconnect = async () => {
    if (!currentDashboard?.connection_id) return;
    
    setIsReconnecting(true);
    
    try {
      log('🔄 Reconnecting dashboard connection...');
      const result = await sfConnectionApi.refresh(currentDashboard.connection_id);
      log('🔄 Refresh result:', result);
      
      // Clear the connection error
      clearDashboardConnectionError();
      
      // Trigger all widgets to reload their data with the fresh connection
      triggerWidgetRefresh();
      
      log('✅ Dashboard reconnected successfully - widgets will reload');
    } catch (error) {
      console.error('❌ Reconnection failed:', error);
      // Keep the error banner visible
    } finally {
      setIsReconnecting(false);
    }
  };


  const handleCreateDashboard = async () => {
    if (!dashboardName.trim()) return;
    await createDashboard(dashboardName, '');
    setShowCreateModal(false);
    setDashboardName('');
  };

  // Handle selecting a widget for editing (side panel or modal)
  const handleSelectWidget = (widget) => {
    // Clear any existing editing config to prevent it from being applied to the new widget
    clearEditingWidgetConfig();
    
    if (useSidePanel) {
      // Side panel mode - panel slides in from left
      setSelectedWidgetId(widget.id);
      setEditingWidget(widget);
      setIsCreatingWidget(false);
    } else if (useInlineEditor) {
      // Legacy inline mode
      setSelectedWidgetId(widget.id);
      setEditingWidget(widget);
      setIsCreatingWidget(false);
    } else {
      // Legacy modal mode
      setEditingWidget(widget);
      setIsCreatingWidget(false);
    }
  };

  // Handle deselecting widget (clicking outside or closing panel)
  const handleDeselectWidget = () => {
    setSelectedWidgetId(null);
    setEditingWidget(null);
    setIsCreatingWidget(false);
  };

  // Get the currently selected widget
  const selectedWidget = currentWidgets.find(w => w.id === selectedWidgetId);

  // Find the next available position for a new widget in the grid
  const findNextAvailablePosition = (width = 4, height = 3) => {
    const GRID_COLUMNS = 12;
    
    // Get actual positions from GridStack if available, otherwise use stored positions
    const getWidgetPositions = () => {
      if (gridRef.current && gridContainerRef.current) {
        const items = gridContainerRef.current.querySelectorAll('.grid-stack-item');
        return Array.from(items).map(item => {
          if (item.gridstackNode) {
            return {
              x: item.gridstackNode.x || 0,
              y: item.gridstackNode.y || 0,
              w: item.gridstackNode.w || 4,
              h: item.gridstackNode.h || 3,
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
        return {
          x: pos.x || 0,
          y: pos.y || 0,
          w: pos.w || 4,
          h: pos.h || 3,
        };
      });
    };
    
    const positions = getWidgetPositions();
    
    if (positions.length === 0) {
      return { x: 0, y: 0, w: width, h: height };
    }
    
    // Find max Y extent
    let maxY = 0;
    positions.forEach(pos => {
      const endY = pos.y + pos.h;
      if (endY > maxY) maxY = endY;
    });
    
    // Create occupancy grid
    const gridHeight = maxY + height + 5;
    const occupied = Array.from({ length: gridHeight }, () => 
      Array.from({ length: GRID_COLUMNS }, () => false)
    );
    
    // Mark occupied cells
    positions.forEach(pos => {
      for (let y = pos.y; y < pos.y + pos.h && y < gridHeight; y++) {
        for (let x = pos.x; x < pos.x + pos.w && x < GRID_COLUMNS; x++) {
          occupied[y][x] = true;
        }
      }
    });
    
    // Find first position where widget fits
    const canFit = (startX, startY) => {
      if (startX + width > GRID_COLUMNS) return false;
      if (startY + height > gridHeight) return false;
      
      for (let y = startY; y < startY + height; y++) {
        for (let x = startX; x < startX + width; x++) {
          if (occupied[y][x]) return false;
        }
      }
      return true;
    };
    
    // Scan row by row, left to right
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x <= GRID_COLUMNS - width; x++) {
        if (canFit(x, y)) {
          return { x, y, w: width, h: height };
        }
      }
    }
    
    // If no space found, place below existing widgets
    return { x: 0, y: maxY, w: width, h: height };
  };

  // Add a new widget - immediately creates it with default name
  const handleOpenNewWidget = async () => {
    if (!currentDashboard) return;
    
    // Find a position that doesn't overlap existing widgets
    const position = findNextAvailablePosition(4, 3);
    
    // Generate default name: Widget_N where N is the next number
    const existingWidgetCount = currentWidgets.length;
    const defaultTitle = `Widget_${existingWidgetCount + 1}`;
    
    // Create the widget immediately with default config
    const widgetConfig = {
      type: 'table',
      title: defaultTitle,
      config: getDefaultWidgetConfig('table'),
      position,
      query: { dimensions: [], measures: [], filters: [], orderBy: [], limit: 1000000 },
    };
    
    const newWidget = await addWidget(currentDashboard.id, widgetConfig);
    
    // Select the new widget so user can start editing it
    if (newWidget) {
      setSelectedWidgetId(newWidget.id);
      setEditingWidget(newWidget);
      setIsCreatingWidget(false);
    }
  };

  // Legacy function - kept for widget picker if needed
  const handleAddWidget = async (type) => {
    if (!currentDashboard) return;
    
    // Find a position that doesn't overlap existing widgets
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
  };

  const getDefaultWidgetConfig = (type) => {
    const defaultColors = ['#00d4ff', '#7c3aed', '#10b981', '#f59e0b', '#ef4444'];
    switch (type) {
      case 'bar':
      case 'horizontal-bar':
      case 'stacked-bar':
      case 'diverging-bar':
      case 'line':
      case 'multiline':
      case 'area':
      case 'pie':
      case 'donut':
      case 'radial':
      case 'treemap':
      case 'icicle':
      case 'sankey':
        return { config: { colors: defaultColors } };
      case 'table':
        return { config: { pageSize: 10 } };
      case 'metric':
        return { config: { format: 'number', prefix: '', suffix: '' } };
      default:
        return { config: { colors: defaultColors } };
    }
  };

  // Handle widget resize — accepts { w, h } or full { x, y, w, h }
  const handleWidgetResize = (widgetId, newSize) => {
    if (!currentDashboard || !currentTab) return;
    
    const widget = currentWidgets.find((w) => w.id === widgetId);
    if (widget) {
      const currentPosition = widget.position || { x: 0, y: 0, w: 4, h: 3 };
      const newPosition = { 
        x: typeof newSize.x === 'number' ? newSize.x : (currentPosition.x || 0),
        y: typeof newSize.y === 'number' ? newSize.y : (currentPosition.y || 0),
        w: newSize.w, 
        h: newSize.h,
      };
      
      updateWidget(currentDashboard.id, widgetId, {
        position: newPosition,
      });
    }
  };

  // All available widget types
  const widgetTypes = [
    // Basic Charts
    { type: 'bar', icon: FiBarChart2, label: 'Bar', category: 'chart' },
    { type: 'horizontal-bar', icon: FiAlignLeft, label: 'Horizontal Bar', category: 'chart' },
    { type: 'stacked-bar', icon: FiColumns, label: 'Stacked Bar', category: 'chart' },
    { type: 'diverging-bar', icon: FiMinusCircle, label: 'Diverging Bar', category: 'chart' },
    { type: 'line', icon: FiTrendingUp, label: 'Line', category: 'chart' },
    { type: 'multiline', icon: FiActivity, label: 'Multiline', category: 'chart' },
    { type: 'area', icon: FiTrendingUp, label: 'Area', category: 'chart' },
    // Circular
    { type: 'pie', icon: FiPieChart, label: 'Pie', category: 'circular' },
    { type: 'donut', icon: FiDisc, label: 'Donut', category: 'circular' },
    { type: 'radial', icon: FiSun, label: 'Radial', category: 'circular' },
    // Scatter
    // Comparison
    { type: 'treemap', icon: FiGrid, label: 'Treemap', category: 'comparison' },
    { type: 'icicle', icon: FiLayers, label: 'Icicle', category: 'comparison' },
    { type: 'sankey', icon: FiShare2, label: 'Sankey', category: 'comparison' },
    // Data
    { type: 'table', icon: FiTable, label: 'Table', category: 'data' },
    { type: 'metric', icon: FiHash, label: 'Metric', category: 'data' },
  ];

  // State for widget picker search
  const [widgetSearch, setWidgetSearch] = useState('');
  
  // Filter widget types based on search
  const filteredWidgetTypes = widgetSearch.trim()
    ? widgetTypes.filter(t => 
        t.label.toLowerCase().includes(widgetSearch.toLowerCase()) ||
        t.type.toLowerCase().includes(widgetSearch.toLowerCase()) ||
        t.category.toLowerCase().includes(widgetSearch.toLowerCase())
      )
    : widgetTypes;

  return (
    <div className={`dashboard-view ${editingWidget && useSidePanel ? 'has-side-panel' : ''} ${editingWidget && useInlineEditor ? 'has-config-panel' : ''}`}>
      <div className="dashboard-main" ref={dashboardMainRef}>
        {currentDashboard ? (
          <>
            <div className={`dashboard-toolbar${isEditMode ? ' edit-mode' : ''}`}>
              <div className="toolbar-left">
                <button 
                  className="btn btn-icon btn-back"
                  onClick={() => {
                    if (hasUnsavedChanges) {
                      setBackConfirm(true);
                    } else {
                      const folderId = currentDashboard?.folder_id;
                      navigate(folderId ? `/dashboards?folder=${folderId}` : '/dashboards');
                    }
                  }}
                  title="Back to dashboards"
                >
                  <FiArrowLeft />
                </button>
                
                <div className="toolbar-title-group">
                  {editingTitle ? (
                    <div className="inline-edit-title">
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={editedTitle}
                        onChange={handleTitleChange}
                        onBlur={handleTitleBlur}
                        onKeyDown={handleTitleKeyDown}
                        className="title-input"
                      />
                      <button 
                        className="cancel-edit-btn"
                        onClick={cancelTitleEdit}
                        title="Cancel"
                      >
                        <FiX />
                      </button>
                    </div>
                  ) : (
                    <h2 
                      onDoubleClick={isEditMode ? handleTitleDoubleClick : undefined}
                      className={`editable-title ${isEditMode ? 'can-edit' : ''}`}
                      title={isEditMode ? "Double-click to edit" : undefined}
                    >
                      {currentDashboard.name}
                    </h2>
                  )}
                  
                  <div className="toolbar-meta">
                    <span className="widget-count">{currentWidgets.length} widget{currentWidgets.length !== 1 ? 's' : ''}</span>
                    {hasUnsavedChanges && (
                      <span className="unsaved-indicator" title="Unsaved changes (⌘S to save)">
                        <span className="unsaved-dot"></span>
                        Unsaved
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Layout toggles removed - widgets now respect saved sizes */}
              
              {!compactToolbar && (
              <div className="toolbar-right">
                {/* View Mode: Show Edit button (if user has permission) */}
                {!isEditMode && canEdit && (
                  <button
                    className="toolbar-btn toolbar-btn-edit"
                    onClick={() => setIsEditMode(true)}
                    title="Edit dashboard (E)"
                  >
                    <FiEdit3 />
                    <span>Edit</span>
                  </button>
                )}
                
                {/* View Mode: Show view indicator when user can't edit */}
                {!isEditMode && !canEdit && (
                  <span className="toolbar-badge view-only">
                    <FiEye />
                    <span>View Only</span>
                  </span>
                )}
                
                {/* Edit Mode: Show all editing controls */}
                {isEditMode && (
                  <>
                    {/* History controls group */}
                    <div className="toolbar-group toolbar-history">
                      <button
                        className={`toolbar-btn ${!canUndo() ? 'disabled' : ''}`}
                        onClick={() => canUndo() && undo()}
                        disabled={!canUndo()}
                        title="Undo (⌘Z)"
                      >
                        <FiRotateCcw />
                      </button>
                      <button
                        className={`toolbar-btn ${!canRedo() ? 'disabled' : ''}`}
                        onClick={() => canRedo() && redo()}
                        disabled={!canRedo()}
                        title="Redo (⌘⇧Z)"
                      >
                        <FiRotateCw />
                      </button>
                    </div>
                    
                    {/* Save button - appears when changes exist */}
                    {(hasUnsavedChanges || saveSuccess) && (
                      <button
                        className={`toolbar-btn toolbar-btn-save ${isSaving ? 'saving' : ''} ${saveSuccess ? 'success' : ''}`}
                        onClick={handleSaveWithAnimation}
                        disabled={isSaving}
                        title="Save changes (⌘S)"
                      >
                        {saveSuccess ? <FiCheck /> : <FiSave />}
                        <span>{saveSuccess ? 'Saved!' : isSaving ? 'Saving...' : 'Save'}</span>
                      </button>
                    )}
                    
                    {/* Settings button */}
                    {canManageSettings && (
                      <button
                        className="toolbar-btn"
                        onClick={() => setShowSettings(true)}
                        title="Dashboard Settings"
                      >
                        <FiSettings />
                      </button>
                    )}
                    
                    {/* Primary action - Add Widget */}
                    <button className="toolbar-btn toolbar-btn-primary" onClick={handleOpenNewWidget}>
                      <FiPlus />
                      <span>Add Widget</span>
                    </button>
                    
                    {/* Done button */}
                    <button
                      className="toolbar-btn toolbar-btn-done"
                      onClick={() => {
                        if (hasUnsavedChanges) {
                          setExitEditConfirm(true);
                        } else {
                          setIsEditMode(false);
                        }
                      }}
                      title="Exit edit mode"
                    >
                      <FiCheck />
                      <span>Done</span>
                    </button>
                  </>
                )}
              </div>
              )}
              
              {/* Compact menu button - shown when space is limited */}
              {compactToolbar && (
              <div className="toolbar-compact" ref={toolbarMenuRef}>
                {/* View mode: Only show Edit button if user can edit */}
                {!isEditMode && canEdit && (
                  <button 
                    className="btn btn-primary btn-icon"
                    onClick={() => setIsEditMode(true)}
                    title="Edit dashboard"
                  >
                    <FiEdit3 />
                  </button>
                )}
                
                {/* Edit mode: Show menu with all options */}
                {isEditMode && (
                  <>
                    <button 
                      className="btn btn-icon mobile-menu-btn"
                      onClick={() => setToolbarMenuOpen(!toolbarMenuOpen)}
                    >
                      <FiMoreVertical />
                    </button>
                    
                    {toolbarMenuOpen && (
                      <div className="toolbar-dropdown">
                        {canManageSettings && (
                          <>
                            <div className="dropdown-divider" />
                            
                            <button
                              className="dropdown-btn"
                              onClick={() => { setShowSettings(true); setToolbarMenuOpen(false); }}
                            >
                              <FiSettings /> Settings
                            </button>
                          </>
                        )}
                        <button
                          className="dropdown-btn primary"
                          onClick={() => { handleOpenNewWidget(); setToolbarMenuOpen(false); }}
                        >
                          <FiPlus /> Add Widget
                        </button>
                        
                        <div className="dropdown-divider" />
                        
                        {hasUnsavedChanges && (
                          <button
                            className="dropdown-btn save"
                            onClick={() => { saveDashboard(); setToolbarMenuOpen(false); }}
                            disabled={isSaving}
                          >
                            <FiSave /> {isSaving ? 'Saving...' : 'Save'}
                          </button>
                        )}
                        <button
                          className="dropdown-btn"
                          onClick={() => {
                            setToolbarMenuOpen(false);
                            if (hasUnsavedChanges) {
                              setExitEditConfirm(true);
                            } else {
                              setIsEditMode(false);
                            }
                          }}
                        >
                          Done
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              )}
            </div>

            {/* Scrollable content area - canvas + tabs shift together when panel opens */}
            <div className="dashboard-content-scroll">
              <div className="dashboard-content">
                {/* Connection Status Indicator */}
                {currentDashboard?.connection?.account && (
                  <div className="connection-indicator">
                    <FiDatabase />
                    <span>{currentDashboard.connection.account}</span>
                    {currentDashboard.connection.role && (
                      <span className="connection-role">({currentDashboard.connection.role})</span>
                    )}
                  </div>
                )}

                <div 
                  ref={canvasRef}
                  className={`dashboard-canvas layout-${layoutMode} device-${devicePreview}${isEditMode ? ' edit-mode' : ''}${editingWidget && useSidePanel ? ' panel-open' : ''}`}
              style={{ backgroundColor: currentTab?.canvasColor || 'transparent' }}
              onClick={(e) => {
                // Deselect widget when clicking on canvas background (not on a widget)
                if (e.target === e.currentTarget || e.target.closest('.widgets-grid') === e.target) {
                  handleDeselectWidget();
                }
              }}
            >
              {/* Phase 2: Connecting to Snowflake */}
              {dashboardLoadPhase === 'connecting' ? (
                <div className="dashboard-connecting-state">
                  <div className="dashboard-loading-bar" />
                  <div className="dashboard-connecting-label">Connecting to Snowflake...</div>
                </div>
              ) : dashboardConnectionError ? (
                <div className="connection-error-state">
                  <div className="connection-error-content">
                    <FiWifiOff className="connection-error-icon" />
                    <h3>Connection Error</h3>
                    <p className="connection-error-message">{dashboardConnectionError}</p>
                    <button 
                      className="btn btn-primary"
                      onClick={handleReconnect}
                      disabled={isReconnecting}
                    >
                      {isReconnecting ? (
                        <><FiRefreshCw className="spin" /> Reconnecting...</>
                      ) : (
                        <><FiRefreshCw /> Reconnect</>
                      )}
                    </button>
                  </div>
                </div>
              ) : currentWidgets.length > 0 ? (
                /* GridStack grid */
                <div 
                  ref={gridContainerRef}
                  className={`grid-stack widgets-grid ${isEditMode ? 'show-grid-lines' : ''}`}
                  style={{ 
                    minHeight: layoutMode === 'fixed' ? fixedCanvasSize.height : undefined,
                  }}
                >
                  {currentWidgets.map((widget, index) => {
                    // Ensure position has valid defaults
                    const pos = widget.position || {};
                    const x = typeof pos.x === 'number' ? pos.x : (index % 3) * 4;
                    const y = typeof pos.y === 'number' ? pos.y : Math.floor(index / 3) * 3;
                    const w = typeof pos.w === 'number' && pos.w > 0 ? pos.w : 4;
                    const h = typeof pos.h === 'number' && pos.h > 0 ? pos.h : 3;
                    
                    return (
                      <DashboardWidget
                        key={widget.id}
                        widget={widget}
                        gridPosition={{ x, y, w, h, minW: 2, minH: 2 }}
                        onSelect={isEditMode ? handleSelectWidget : undefined}
                        onDelete={isEditMode && canDelete ? () => handleDeleteWidget(widget.id) : undefined}
                        onResize={isEditMode ? handleWidgetResize : undefined}
                        onUpdateTitle={isEditMode ? (widgetId, newTitle) => updateWidget(currentDashboard.id, widgetId, { title: newTitle }) : undefined}
                        layoutMode={layoutMode}
                        devicePreview={devicePreview}
                        canvasColor={currentTab?.canvasColor}
                        isEditMode={isEditMode}
                        isSelected={selectedWidgetId === widget.id}
                        isEditing={useInlineEditor && selectedWidgetId === widget.id}
                        dashboardId={currentDashboard?.id}
                        isGridLayout={true}
                        onAutoSave={(updates) => {
                          // Auto-save widget changes in real-time
                          updateWidget(currentDashboard.id, widget.id, updates);
                        }}
                        onCloseEditor={() => {
                          setSelectedWidgetId(null);
                          setEditingWidget(null);
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="empty-canvas">
                  <div className="empty-canvas-content">
                    {/* Custom SVG Illustration - solid colors for visibility */}
                    <div className="empty-illustration">
                      <svg width="160" height="120" viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                        {/* Card 1 - Left */}
                        <rect x="10" y="40" width="50" height="38" rx="6" fill="#0ea5e9" fillOpacity="0.15" stroke="#0ea5e9" strokeWidth="1.5"/>
                        <rect x="16" y="48" width="38" height="4" rx="2" fill="#0ea5e9"/>
                        <rect x="16" y="56" width="24" height="3" rx="1.5" fill="#0ea5e9" fillOpacity="0.6"/>
                        <rect x="16" y="64" width="38" height="10" rx="2" fill="#0ea5e9" fillOpacity="0.3"/>
                        
                        {/* Card 2 - Center/Top (main) */}
                        <rect x="45" y="12" width="55" height="48" rx="6" fill="#0ea5e9" fillOpacity="0.2" stroke="#0ea5e9" strokeWidth="1.5"/>
                        <rect x="52" y="20" width="42" height="5" rx="2" fill="#0ea5e9"/>
                        <rect x="52" y="29" width="26" height="3" rx="1.5" fill="#0ea5e9" fillOpacity="0.7"/>
                        {/* Bar chart */}
                        <rect x="54" y="40" width="8" height="16" rx="2" fill="#0ea5e9" fillOpacity="0.7"/>
                        <rect x="65" y="34" width="8" height="22" rx="2" fill="#0ea5e9"/>
                        <rect x="76" y="42" width="8" height="14" rx="2" fill="#0ea5e9" fillOpacity="0.6"/>
                        <rect x="87" y="37" width="8" height="19" rx="2" fill="#0ea5e9" fillOpacity="0.8"/>
                        
                        {/* Card 3 - Right */}
                        <rect x="90" y="50" width="50" height="40" rx="6" fill="#0ea5e9" fillOpacity="0.15" stroke="#0ea5e9" strokeWidth="1.5"/>
                        <rect x="96" y="58" width="38" height="4" rx="2" fill="#0ea5e9"/>
                        {/* Pie chart */}
                        <circle cx="115" cy="78" r="10" fill="none" stroke="#0ea5e9" strokeOpacity="0.4" strokeWidth="4" strokeDasharray="31 31" strokeDashoffset="8"/>
                        <circle cx="115" cy="78" r="10" fill="none" stroke="#0ea5e9" strokeWidth="4" strokeDasharray="20 42"/>
                        
                        {/* Plus button */}
                        <circle cx="80" cy="95" r="16" fill="#0ea5e9" fillOpacity="0.2" stroke="#0ea5e9" strokeWidth="2"/>
                        <path d="M80 88 L80 102 M73 95 L87 95" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round"/>
                        
                        {/* Decorative elements */}
                        <circle cx="5" cy="25" r="3" fill="#0ea5e9" fillOpacity="0.5"/>
                        <circle cx="155" cy="35" r="3" fill="#0ea5e9" fillOpacity="0.4"/>
                        <circle cx="25" cy="95" r="2" fill="#0ea5e9" fillOpacity="0.5"/>
                        <circle cx="145" cy="100" r="2.5" fill="#0ea5e9" fillOpacity="0.4"/>
                      </svg>
                    </div>
                    <h3>Start Building Your Dashboard</h3>
                    <p>Add widgets to visualize your Snowflake data</p>
                    <button className="btn btn-primary btn-glow" onClick={handleOpenNewWidget}>
                      <FiPlus /> Add Your First Widget
                    </button>
                    <span className="keyboard-hint">or press <kbd>A</kbd></span>
                  </div>
                </div>
              )}
              
            </div>

            {/* Tab Bar - Excel-like sheets with navigation buttons */}
            <div className="tab-bar">
              {/* Left navigation button */}
              {(tabOverflow.left || tabOverflow.right) && (
                <button 
                  className="tab-nav-btn"
                  onClick={() => scrollTabs('left')}
                  disabled={!tabOverflow.left}
                  title="Previous tabs"
                >
                  <FiChevronLeft />
                </button>
              )}
              
              <div className={`tab-list-wrapper ${tabOverflow.left ? 'has-overflow-left' : ''} ${tabOverflow.right ? 'has-overflow-right' : ''}`}>
                <div 
                  className="tab-list" 
                  ref={tabListRef}
                  onScroll={checkTabOverflow}
                >
                  {currentDashboard.tabs
                    ?.filter(tab => isEditMode || (tab.widgets && tab.widgets.length > 0))
                    .map((tab) => (
                    <div
                      key={tab.id}
                      className={`tab-item ${tab.id === currentTabId ? 'active' : ''} ${tab.backgroundColor ? 'has-color' : ''}`}
                      style={{ 
                        '--tab-bg-color': tab.backgroundColor || 'transparent',
                        '--tab-color': tab.backgroundColor || 'var(--accent-primary)'
                      }}
                      onClick={() => setCurrentTab(tab.id)}
                      onContextMenu={isEditMode ? (e) => handleTabContextMenu(e, tab.id) : undefined}
                      onDoubleClick={isEditMode ? () => {
                        setEditingTabId(tab.id);
                        setEditedTabTitle(tab.title);
                      } : undefined}
                    >
                      {editingTabId === tab.id ? (
                        <input
                          type="text"
                          className="tab-title-input"
                          value={editedTabTitle}
                          onChange={(e) => setEditedTabTitle(e.target.value)}
                          onBlur={saveTabTitle}
                          onKeyDown={handleTabTitleKeyDown}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <span className="tab-title">{tab.title}</span>
                      )}
                    </div>
                  ))}
                  {isEditMode && (
                    <button 
                      className="tab-add-btn" 
                      onClick={() => addTab()}
                      title="Add new sheet"
                    >
                      <FiPlus />
                    </button>
                  )}
                </div>
              </div>
              
              {/* Right navigation button */}
              {(tabOverflow.left || tabOverflow.right) && (
                <button 
                  className="tab-nav-btn"
                  onClick={() => scrollTabs('right')}
                  disabled={!tabOverflow.right}
                  title="More tabs"
                >
                  <FiChevronRight />
                </button>
              )}
            </div>
              </div>{/* end dashboard-content */}
            </div>{/* end dashboard-content-scroll */}

            {/* Tab Context Menu - opens upward since tabs are at bottom, only in edit mode */}
            {isEditMode && tabContextMenu.open && (
              <div 
                ref={tabContextMenuRef}
                className="tab-context-menu"
                style={{ 
                  left: tabContextMenu.x, 
                  bottom: window.innerHeight - tabContextMenu.y + 10
                }}
              >
                <button onClick={handleRenameTab}>
                  <FiEdit3 /> Rename
                </button>
                <button onClick={handleDuplicateTab}>
                  <FiGrid /> Duplicate
                </button>
                <div className="context-menu-divider" />
                <div className="color-picker-section">
                  <span className="color-picker-label">Tab Color</span>
                  <div className="color-picker-grid">
                    {TAB_COLORS.map((color, idx) => (
                      <button
                        key={idx}
                        className={`color-swatch ${color === null ? 'no-color' : ''} ${currentDashboard.tabs?.find(t => t.id === tabContextMenu.tabId)?.backgroundColor === color ? 'selected' : ''}`}
                        style={{ backgroundColor: color || 'transparent' }}
                        onClick={() => handleQuickSetTabColor(color)}
                        title={color ? color : 'No color'}
                      >
                        {color === null && <FiX />}
                      </button>
                    ))}
                  </div>
                  <div className="color-picker-custom">
                    <input
                      type="color"
                      value={previewTabColor || currentDashboard.tabs?.find(t => t.id === tabContextMenu.tabId)?.backgroundColor || '#3b82f6'}
                      onChange={(e) => handlePreviewTabColor(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="color-input"
                    />
                    <span 
                      className="color-preview-text"
                      style={{ color: previewTabColor || currentDashboard.tabs?.find(t => t.id === tabContextMenu.tabId)?.backgroundColor || '#888' }}
                    >
                      {previewTabColor || currentDashboard.tabs?.find(t => t.id === tabContextMenu.tabId)?.backgroundColor || 'Custom'}
                    </span>
                    {previewTabColor && (
                      <button className="color-apply-btn" onClick={handleApplyTabColor}>
                        Apply
                      </button>
                    )}
                  </div>
                </div>
                <div className="color-picker-section">
                  <span className="color-picker-label">Canvas Background</span>
                  <div className="color-picker-grid">
                    {TAB_COLORS.map((color, idx) => (
                      <button
                        key={idx}
                        className={`color-swatch ${color === null ? 'no-color' : ''} ${currentDashboard.tabs?.find(t => t.id === tabContextMenu.tabId)?.canvasColor === color ? 'selected' : ''}`}
                        style={{ backgroundColor: color || 'transparent' }}
                        onClick={() => handleQuickSetCanvasColor(color)}
                        title={color ? color : 'No color'}
                      >
                        {color === null && <FiX />}
                      </button>
                    ))}
                  </div>
                  <div className="color-picker-custom">
                    <input
                      type="color"
                      value={previewCanvasColor || currentDashboard.tabs?.find(t => t.id === tabContextMenu.tabId)?.canvasColor || '#3b82f6'}
                      onChange={(e) => handlePreviewCanvasColor(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="color-input"
                    />
                    <span 
                      className="color-preview-text"
                      style={{ color: previewCanvasColor || currentDashboard.tabs?.find(t => t.id === tabContextMenu.tabId)?.canvasColor || '#888' }}
                    >
                      {previewCanvasColor || currentDashboard.tabs?.find(t => t.id === tabContextMenu.tabId)?.canvasColor || 'Custom'}
                    </span>
                    {previewCanvasColor && (
                      <button className="color-apply-btn" onClick={handleApplyCanvasColor}>
                        Apply
                      </button>
                    )}
                  </div>
                </div>
                <div className="context-menu-divider" />
                <button 
                  onClick={handleDeleteTab} 
                  className="danger"
                  disabled={currentDashboard.tabs?.length <= 1}
                >
                  <FiTrash2 /> Delete
                </button>
              </div>
            )}
          </>
        ) : isLoadingDashboard ? (
          <div className="dashboard-loading-config">
            <div className="dashboard-loading-bar" />
            <div className="dashboard-loading-toolbar">
              <div className="dashboard-skeleton-back" />
              <div className="dashboard-skeleton-title" />
            </div>
            <div className="dashboard-shimmer-pane">
              <div className="dashboard-shimmer-sweep" />
            </div>
          </div>
        ) : dashboardLoadError ? (
          <div className="empty-state error-state">
            <FiAlertTriangle className="empty-state-icon error-icon" />
            <h3 className="empty-state-title">
              {dashboardLoadError.code === 'MFA_REQUIRED' 
                ? 'Multi-Factor Authentication Required' 
                : dashboardLoadError.code === 'ACCESS_DENIED' 
                  ? 'Access Denied' 
                  : 'Error Loading Dashboard'}
            </h3>
            <p className="empty-state-text">
              {dashboardLoadError.message}
            </p>
            <div className="error-actions">
              {dashboardLoadError.code === 'MFA_REQUIRED' && (
                <button 
                  className="error-dismiss-btn primary"
                  onClick={() => {
                    clearDashboardLoadError();
                    navigate('/settings');
                  }}
                >
                  Go to Settings
                </button>
              )}
              <button 
                className="error-dismiss-btn"
                onClick={() => {
                  clearDashboardLoadError();
                  navigate('/dashboards');
                }}
              >
                Back to Dashboards
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            {/* Dashboard selection illustration - uses currentColor for theme support */}
            <div className="empty-illustration select-dashboard">
              <svg width="180" height="140" viewBox="0 0 180 140" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'var(--accent-primary)' }}>
                {/* Folder stack */}
                <rect x="30" y="50" width="120" height="80" rx="10" fill="currentColor" fillOpacity="0.12"/>
                <rect x="25" y="45" width="120" height="80" rx="10" fill="currentColor" fillOpacity="0.18"/>
                <rect x="20" y="40" width="120" height="80" rx="10" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2"/>
                
                {/* Folder tab */}
                <path d="M20 50 L20 50 C20 44.477 24.477 40 30 40 L55 40 L65 50 L130 50" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" fill="none"/>
                
                {/* Dashboard preview lines */}
                <rect x="30" y="58" width="40" height="5" rx="2.5" fill="currentColor" fillOpacity="0.5"/>
                <rect x="30" y="68" width="25" height="3" rx="1.5" fill="currentColor" fillOpacity="0.35"/>
                
                {/* Mini chart */}
                <rect x="30" y="80" width="45" height="30" rx="4" fill="currentColor" fillOpacity="0.15"/>
                <rect x="35" y="95" width="6" height="12" rx="1" fill="currentColor" fillOpacity="0.4"/>
                <rect x="44" y="90" width="6" height="17" rx="1" fill="currentColor" fillOpacity="0.5"/>
                <rect x="53" y="93" width="6" height="14" rx="1" fill="currentColor" fillOpacity="0.45"/>
                <rect x="62" y="88" width="6" height="19" rx="1" fill="currentColor" fillOpacity="0.55"/>
                
                {/* Mini table */}
                <rect x="85" y="80" width="45" height="30" rx="4" fill="currentColor" fillOpacity="0.15"/>
                <rect x="90" y="85" width="35" height="3" rx="1.5" fill="currentColor" fillOpacity="0.4"/>
                <rect x="90" y="92" width="35" height="3" rx="1.5" fill="currentColor" fillOpacity="0.3"/>
                <rect x="90" y="99" width="35" height="3" rx="1.5" fill="currentColor" fillOpacity="0.3"/>
                
                {/* Cursor pointer */}
                <path d="M145 75 L145 100 L152 94 L160 105 L165 102 L157 91 L165 87 L145 75Z" fill="currentColor" fillOpacity="0.8" className="cursor-float"/>
                
                {/* Sparkles */}
                <circle cx="155" cy="35" r="3" fill="currentColor" fillOpacity="0.4" className="sparkle-1"/>
                <circle cx="165" cy="55" r="2" fill="currentColor" fillOpacity="0.35" className="sparkle-2"/>
                <circle cx="10" cy="70" r="2.5" fill="currentColor" fillOpacity="0.3" className="sparkle-3"/>
              </svg>
            </div>
            <h3 className="empty-state-title">Select a Dashboard</h3>
            <p className="empty-state-text">
              Choose a dashboard from the list or create a new one to start building
            </p>
          </div>
        )}
      </div>

      {/* Create Dashboard Modal */}
      <CreateDashboardModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(dashboard) => {
          if (dashboard?.id) {
            openDashboard(dashboard.id);
          }
        }}
      />

      {/* Widget Picker Modal */}
      {showWidgetPicker && (
        <div className="modal-overlay">
          <div className="modal widget-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Add Widget</h2>
              <button className="modal-close" onClick={() => { setShowWidgetPicker(false); setWidgetSearch(''); }}>
                <FiX />
              </button>
            </div>
            
            {/* Search Input */}
            <div className="widget-picker-search">
              <FiSearch className="search-icon" />
              <input
                type="text"
                placeholder="Search charts... (bar, pie, scatter, sankey...)"
                value={widgetSearch}
                onChange={(e) => setWidgetSearch(e.target.value)}
                autoFocus
              />
              {widgetSearch && (
                <button className="search-clear" onClick={() => setWidgetSearch('')}>
                  <FiX />
                </button>
              )}
            </div>

            <div className="widget-types-grid">
              {filteredWidgetTypes.length > 0 ? (
                filteredWidgetTypes.map(({ type, icon: Icon, label }) => (
                  <button
                    key={type}
                    className="widget-type-card"
                    onClick={() => { handleAddWidget(type); setWidgetSearch(''); }}
                  >
                    <div className="widget-type-icon">
                      <Icon />
                    </div>
                    <span>{label}</span>
                  </button>
                ))
              ) : (
                <div className="no-results">
                  <span>No charts match "{widgetSearch}"</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Widget Editor - Side Panel Mode (new default) */}
      {useSidePanel && (
        <DashboardEditPanel
          widget={editingWidget}
          dashboardId={currentDashboard?.id}
          isOpen={!!editingWidget}
          isNew={isCreatingWidget}
          onClose={() => {
            setEditingWidget(null);
            setIsCreatingWidget(false);
            setSelectedWidgetId(null);
          }}
          onSave={async (updates) => {
            if (isCreatingWidget) {
              const position = findNextAvailablePosition(4, 3);
              const widgetConfig = {
                type: updates.type,
                title: updates.title,
                config: updates.config,
                position,
                modelId: updates.modelId,
                query: updates.query,
                semanticViewsReferenced: updates.semanticViewsReferenced,
                fieldsUsed: updates.fieldsUsed,
                filtersApplied: updates.filtersApplied,
                sortsApplied: updates.sortsApplied,
                customColumns: updates.customColumns,
              };
              await addWidget(currentDashboard.id, widgetConfig);
            } else {
              updateWidget(currentDashboard.id, editingWidget.id, updates);
            }
            setEditingWidget(null);
            setIsCreatingWidget(false);
            setSelectedWidgetId(null);
          }}
          onAutoSave={(updates) => {
            if (editingWidget && currentDashboard) {
              updateWidget(currentDashboard.id, editingWidget.id, updates);
            }
          }}
        />
      )}

      {/* Widget Editor - Modal Mode (legacy) */}
      {editingWidget && !useSidePanel && !useInlineEditor && (
        <WidgetEditor
          key={editingWidget.id || 'new'}
          widget={editingWidget}
          dashboardId={currentDashboard?.id}
          isNew={isCreatingWidget}
          inline={false}
          onClose={() => {
            setEditingWidget(null);
            setIsCreatingWidget(false);
            setSelectedWidgetId(null);
          }}
          onSave={async (updates) => {
            if (isCreatingWidget) {
              // Create new widget - include ALL widget properties from updates
              const position = findNextAvailablePosition(4, 3);
              const widgetConfig = {
                type: updates.type,
                title: updates.title,
                config: updates.config,
                position,
                modelId: updates.modelId,
                query: updates.query,
                // Include semantic view references and calculated fields
                semanticViewsReferenced: updates.semanticViewsReferenced,
                fieldsUsed: updates.fieldsUsed,
                filtersApplied: updates.filtersApplied,
                sortsApplied: updates.sortsApplied,
                customColumns: updates.customColumns,
              };
              await addWidget(currentDashboard.id, widgetConfig);
            } else {
              // Update existing widget - pass through all updates including calculated fields
              updateWidget(currentDashboard.id, editingWidget.id, updates);
            }
            setEditingWidget(null);
            setIsCreatingWidget(false);
            setSelectedWidgetId(null);
          }}
        />
      )}

      {/* Dashboard Settings */}
      <DashboardSettingsModal
        dashboard={currentDashboard}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
      />

      {/* Delete Confirmation Dialog */}
      {deleteConfirm.open && (
        <ConfirmDeleteModal
          itemName={deleteConfirm.itemName}
          itemType={deleteConfirm.itemType}
          onConfirm={deleteConfirm.onConfirm}
          onCancel={() => setDeleteConfirm({ open: false, itemName: '', itemType: '', onConfirm: null })}
        />
      )}

      {/* Exit Edit Mode Confirmation (when unsaved changes) */}
      {exitEditConfirm && (
        <div className="modal-overlay">
          <div className="modal exit-edit-modal">
            <div className="modal-header">
              <h2 className="modal-title">
                <span className="warning-icon">⚠️</span>
                Unsaved Changes
              </h2>
            </div>
            <div className="modal-body">
              <p>You have unsaved changes to this dashboard.</p>
              <p className="modal-hint">What would you like to do?</p>
            </div>
            <div className="modal-footer exit-edit-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setExitEditConfirm(false)}
              >
                Continue Editing
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  setExitEditConfirm(false);
                  // Reload dashboard to revert changes
                  if (currentDashboard?.id) {
                    await loadDashboard(currentDashboard.id);
                  }
                  setIsEditMode(false);
                }}
              >
                Don't Save
              </button>
              <button
                className="btn btn-save"
                onClick={async () => {
                  setExitEditConfirm(false);
                  await saveDashboard();
                  setIsEditMode(false);
                }}
              >
                <FiSave /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Back Button Confirmation (when unsaved changes) */}
      {backConfirm && (
        <div className="modal-overlay">
          <div className="modal exit-edit-modal">
            <div className="modal-header">
              <h2 className="modal-title">
                <span className="warning-icon">⚠️</span>
                Unsaved Changes
              </h2>
            </div>
            <div className="modal-body">
              <p>You have unsaved changes to this dashboard.</p>
              <p className="modal-hint">If you leave now, your changes will be lost.</p>
            </div>
            <div className="modal-footer exit-edit-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setBackConfirm(false)}
              >
                Stay
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setBackConfirm(false);
                  // Clear unsaved changes flag before navigating
                  useAppStore.getState().clearUnsavedChanges();
                  // Navigate back to the folder the dashboard is in
                  const folderId = currentDashboard?.folder_id;
                  navigate(folderId ? `/dashboards?folder=${folderId}` : '/dashboards');
                }}
              >
                Leave Without Saving
              </button>
              <button
                className="btn btn-save"
                onClick={async () => {
                  setBackConfirm(false);
                  await saveDashboard();
                  // Navigate back to the folder the dashboard is in
                  const folderId = currentDashboard?.folder_id;
                  navigate(folderId ? `/dashboards?folder=${folderId}` : '/dashboards');
                }}
              >
                <FiSave /> Save & Leave
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Keyboard Shortcuts Panel */}
      {showShortcuts && (
        <div className="shortcuts-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="shortcuts-panel" onClick={e => e.stopPropagation()}>
            <div className="shortcuts-header">
              <h3><FiHelpCircle /> Keyboard Shortcuts</h3>
              <button className="btn btn-icon" onClick={() => setShowShortcuts(false)}>
                <FiX />
              </button>
            </div>
            <div className="shortcuts-body">
              <div className="shortcuts-section">
                <h4>General</h4>
                <div className="shortcut-row">
                  <span className="shortcut-keys"><kbd>?</kbd></span>
                  <span className="shortcut-desc">Toggle this panel</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-keys"><kbd>Esc</kbd></span>
                  <span className="shortcut-desc">Close panel / Deselect widget</span>
                </div>
              </div>
              
              <div className="shortcuts-section">
                <h4>Editing</h4>
                <div className="shortcut-row">
                  <span className="shortcut-keys"><kbd>⌘</kbd><kbd>Z</kbd></span>
                  <span className="shortcut-desc">Undo</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-keys"><kbd>⌘</kbd><kbd>⇧</kbd><kbd>Z</kbd></span>
                  <span className="shortcut-desc">Redo</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-keys"><kbd>⌘</kbd><kbd>S</kbd></span>
                  <span className="shortcut-desc">Save dashboard</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-keys"><kbd>A</kbd></span>
                  <span className="shortcut-desc">Add new widget</span>
                </div>
              </div>
              
              <div className="shortcuts-section">
                <h4>Widget Editing</h4>
                <div className="shortcut-row">
                  <span className="shortcut-keys"><kbd>Delete</kbd></span>
                  <span className="shortcut-desc">Delete selected widget</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-keys"><kbd>⌘</kbd><kbd>D</kbd></span>
                  <span className="shortcut-desc">Duplicate selected widget</span>
                </div>
              </div>
            </div>
            <div className="shortcuts-footer">
              <span className="shortcuts-hint">Press <kbd>?</kbd> anytime to see shortcuts</span>
            </div>
          </div>
        </div>
      )}

      {/* Cortex Agent Chat FAB + Panel */}
      {currentDashboard?.cortexAgentsEnabled && currentDashboard?.cortexAgents?.length > 0 && (
        <CortexAgentChat
          connectionId={currentDashboard.connection_id}
          cortexAgents={currentDashboard.cortexAgents}
          role={currentDashboard.role}
        />
      )}
    </div>
  );
};

export default DashboardView;

