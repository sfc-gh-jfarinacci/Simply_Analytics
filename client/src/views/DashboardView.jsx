import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import 'gridstack/dist/gridstack.min.css';
import DashboardWidget from '../components/dashboard-widget';
import WidgetEditor from '../components/widget-editor';
import WidgetEditorWrapper from '../components/widget-editor/WidgetEditorWrapper';
import DashboardSettingsModal from '../components/dashboard-settings-modal/DashboardSettingsModal';
import CreateDashboardModal from '../components/CreateDashboardModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { useToast } from '../components/Toast';
import { FiDatabase } from 'react-icons/fi';
import { sfConnectionApi } from '../api/apiClient';
import CortexAgentChat from '../components/CortexAgentChat';
import AiChatPanel from '../components/ai/AiChatPanel';
import '../styles/DashboardView.css';

import { useGridStack } from '../components/dashboard-view/hooks/useGridStack';
import { useKeyboardShortcuts } from '../components/dashboard-view/hooks/useKeyboardShortcuts';
import { useTabManagement } from '../components/dashboard-view/hooks/useTabManagement';
import { useTitleEditor } from '../components/dashboard-view/hooks/useTitleEditor';
import { useDeviceDetection } from '../components/dashboard-view/hooks/useDeviceDetection';
import { useWidgetActions } from '../components/dashboard-view/hooks/useWidgetActions';

import {
  DashboardToolbar, TabBar, TabContextMenu,
  ExitEditConfirmModal, BackConfirmModal,
  KeyboardShortcutsPanel, WidgetPickerModal,
  ConnectingState, ConnectionErrorState, EmptyCanvasState,
  LoadingState, ErrorState, SelectDashboardState,
} from '../components/dashboard-view/components';
import DashboardFilterPanel from '../components/dashboard-view/components/DashboardFilterPanel';

import { LAYOUT_MODES, WIDGET_TYPES } from '../components/dashboard-view/constants';

const DashboardView = () => {
  const {
    dashboards, currentDashboard, currentTabId,
    createDashboard, loadDashboard, removeDashboard,
    addWidget, updateWidget, removeWidget, updateDashboard,
    setCurrentTab, addTab, updateTab, removeTab, duplicateTab,
    hasUnsavedChanges, isSaving, saveDashboard,
    isLoadingDashboards, isLoadingDashboard, dashboardLoadPhase,
    currentUser, currentRole,
    dashboardLoadError, clearDashboardLoadError,
    clearEditingWidgetConfig = () => {},
    removeDashboardFilter,
    undo = () => {}, redo = () => {},
    canUndo = () => false, canRedo = () => false,
    clearHistory = () => {},
  } = useAppStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const dashboardIdFromUrl = searchParams.get('id');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiChat, setShowAiChat] = useState(false);
  const [dashboardName, setDashboardName] = useState('');
  const [useSidePanel] = useState(true);
  const [useInlineEditor] = useState(false);

  // Edit mode & layout
  const [isEditMode, setIsEditMode] = useState(false);
  const [layoutMode, setLayoutMode] = useState(LAYOUT_MODES.ADAPTIVE);
  const [fixedCanvasSize, setFixedCanvasSize] = useState({ width: 1024, height: 768 });
  const [compactToolbar, setCompactToolbar] = useState(false);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const toolbarMenuRef = useRef(null);

  // Confirmation modals
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, itemName: '', itemType: '', onConfirm: null });
  const [exitEditConfirm, setExitEditConfirm] = useState(false);
  const [backConfirm, setBackConfirm] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Save animation
  const [saveSuccess, setSaveSuccess] = useState(false);
  const handleSaveWithAnimation = useCallback(async () => {
    if (!hasUnsavedChanges || isSaving) return;
    try {
      await saveDashboard();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) { console.error('Save failed:', err); }
  }, [hasUnsavedChanges, isSaving, saveDashboard]);

  // Global filter panel
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [globalFilterFields, setGlobalFilterFields] = useState([]);

  // Connection + temp filters
  const [tempFilters, setTempFilters] = useState([]);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const dashboardConnectionError = useAppStore(state => state.dashboardConnectionError);
  const clearDashboardConnectionError = useAppStore(state => state.clearDashboardConnectionError);
  const triggerWidgetRefresh = useAppStore(state => state.triggerWidgetRefresh);

  const canvasRef = useRef(null);
  const dashboardMainRef = useRef(null);
  const currentDashboardIdRef = useRef(null);

  useEffect(() => { currentDashboardIdRef.current = currentDashboard?.id; }, [currentDashboard?.id]);

  // Load global filter fields from dashboard
  useEffect(() => {
    if (currentDashboard?.globalFilterFields) {
      setGlobalFilterFields(currentDashboard.globalFilterFields);
    } else {
      setGlobalFilterFields([]);
    }
    setShowFilterPanel(false);
  }, [currentDashboard?.id]);

  const handleUpdateFilterFields = useCallback((fields) => {
    setGlobalFilterFields(fields);
    if (currentDashboard) {
      updateDashboard(currentDashboard.id, { globalFilterFields: fields });
    }
  }, [currentDashboard, updateDashboard]);

  // Load dashboard from URL
  useEffect(() => {
    if (dashboardIdFromUrl) {
      const shouldLoad = !currentDashboard || currentDashboard.id !== dashboardIdFromUrl;
      const hasErrorForThisId = dashboardLoadError && !currentDashboard;
      if (shouldLoad && !hasErrorForThisId && !isLoadingDashboard) loadDashboard(dashboardIdFromUrl);
    }
  }, [dashboardIdFromUrl, currentDashboard, dashboardLoadError, isLoadingDashboard, loadDashboard]);

  const openDashboard = useCallback((id) => {
    loadDashboard(id);
    setSearchParams({ id }, { replace: true });
  }, [loadDashboard, setSearchParams]);

  // Current tab & sorted widgets
  const currentTab = currentDashboard?.tabs?.find(t => t.id === currentTabId);
  const allWidgets = currentTab?.widgets || [];
  const currentWidgets = useMemo(() => {
    return [...allWidgets].sort((a, b) => {
      const aY = a.position?.y ?? 999;
      const bY = b.position?.y ?? 999;
      if (aY !== bY) return aY - bY;
      return (a.position?.x ?? 999) - (b.position?.x ?? 999);
    });
  }, [allWidgets]);

  // Permissions
  const accessLevel = currentDashboard?.access_level;
  const isOwner = currentDashboard?.isOwner || accessLevel === 'owner';
  const isAdmin = accessLevel === 'admin';
  const hasEditAccess = isOwner || isAdmin || accessLevel === 'edit';
  const canEdit = hasEditAccess;
  const canDelete = isOwner || isAdmin;
  const canManageSettings = isOwner || isAdmin;

  // Reset edit mode on dashboard change
  const prevDashboardIdFromUrlRef = useRef(dashboardIdFromUrl);
  useEffect(() => {
    if (prevDashboardIdFromUrlRef.current !== dashboardIdFromUrl && dashboardIdFromUrl) setIsEditMode(false);
    prevDashboardIdFromUrlRef.current = dashboardIdFromUrl;
  }, [dashboardIdFromUrl]);

  // Auto-switch to first non-empty tab in view mode
  useEffect(() => {
    if (!isEditMode && currentDashboard?.tabs && currentTabId) {
      const tab = currentDashboard.tabs.find(t => t.id === currentTabId);
      if (!tab?.widgets || tab.widgets.length === 0) {
        const firstNonEmpty = currentDashboard.tabs.find(t => t.widgets && t.widgets.length > 0);
        if (firstNonEmpty) setCurrentTab(firstNonEmpty.id);
      }
    }
  }, [isEditMode, currentDashboard?.tabs, currentTabId, setCurrentTab]);

  // --- HOOKS ---
  const { gridRef, gridContainerRef } = useGridStack({
    isEditMode, currentWidgets, dashboardLoadPhase, dashboardConnectionError,
    updateWidget, currentDashboardIdRef,
  });

  const widgetActions = useWidgetActions({
    currentDashboard, currentWidgets, addWidget, updateWidget, removeWidget,
    removeDashboardFilter, clearEditingWidgetConfig,
    gridRef, gridContainerRef, toast, showAiChat, useSidePanel, useInlineEditor,
  });

  const {
    editingWidget, setEditingWidget, isCreatingWidget, setIsCreatingWidget,
    selectedWidgetId, setSelectedWidgetId,
    showWidgetPicker, setShowWidgetPicker,
    aiFocusedWidgetId, setAiFocusedWidgetId,
    liveEditingWidget, findNextAvailablePosition,
    handleDeleteWidget, handleSelectWidget, handleDeselectWidget,
    handleOpenNewWidget, handleAddSpecialWidget, handleAddWidget,
    handleWidgetResize,
  } = widgetActions;

  const { devicePreview } = useDeviceDetection(canvasRef);

  const titleEditor = useTitleEditor({ currentDashboard, updateDashboard, isEditMode });

  const tabMgmt = useTabManagement({
    currentDashboard, updateTab, removeTab, duplicateTab, isEditMode, setDeleteConfirm,
  });

  useKeyboardShortcuts({
    isEditMode, canUndo, canRedo, undo, redo,
    hasUnsavedChanges, saveDashboard, isSaving,
    showShortcuts, setShowShortcuts,
    editingWidget, showSettings: showSettings,
    setShowSettings, setExitEditConfirm, setIsEditMode,
    handleDeselectWidget, handleOpenNewWidget, handleSaveWithAnimation,
  });

  // Close toolbar menu on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (toolbarMenuRef.current && !toolbarMenuRef.current.contains(e.target)) setToolbarMenuOpen(false);
    };
    if (toolbarMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [toolbarMenuOpen]);

  useEffect(() => { if (!compactToolbar) setToolbarMenuOpen(false); }, [compactToolbar]);

  // Detect compact toolbar based on available width
  useEffect(() => {
    const check = () => {
      if (dashboardMainRef.current) setCompactToolbar(dashboardMainRef.current.offsetWidth < 700);
    };
    check();
    let obs;
    if (dashboardMainRef.current) {
      obs = new ResizeObserver(check);
      obs.observe(dashboardMainRef.current);
    }
    return () => obs?.disconnect();
  }, [currentDashboard]);

  // Reconnect handler
  const handleReconnect = async () => {
    if (!currentDashboard?.connection_id) return;
    setIsReconnecting(true);
    try {
      await sfConnectionApi.refresh(currentDashboard.connection_id);
      clearDashboardConnectionError();
      triggerWidgetRefresh();
    } catch (error) {
      console.error('Reconnection failed:', error);
    } finally {
      setIsReconnecting(false);
    }
  };

  const handleSaveSettings = async (settings) => {
    if (currentDashboard) {
      await useAppStore.getState().updateDashboard(currentDashboard.id, settings);
      setShowSettings(false);
    }
  };

  // Widget search for picker
  const [widgetSearch, setWidgetSearch] = useState('');

  return (
    <div className={`dashboard-view ${editingWidget && useSidePanel ? 'has-side-panel' : ''} ${editingWidget && useInlineEditor ? 'has-config-panel' : ''} ${showAiChat ? 'has-ai-panel' : ''}`}>
      <div className="dashboard-main" ref={dashboardMainRef}>
        {currentDashboard ? (
          <>
            <DashboardToolbar
              currentDashboard={currentDashboard}
              currentWidgets={currentWidgets}
              isEditMode={isEditMode} setIsEditMode={setIsEditMode}
              canEdit={canEdit} canManageSettings={canManageSettings}
              hasUnsavedChanges={hasUnsavedChanges} isSaving={isSaving}
              saveSuccess={saveSuccess} handleSaveWithAnimation={handleSaveWithAnimation}
              saveDashboard={saveDashboard}
              canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo}
              editingTitle={titleEditor.editingTitle} editedTitle={titleEditor.editedTitle}
              titleInputRef={titleEditor.titleInputRef}
              handleTitleDoubleClick={titleEditor.handleTitleDoubleClick}
              handleTitleChange={titleEditor.handleTitleChange}
              handleTitleBlur={titleEditor.handleTitleBlur}
              handleTitleKeyDown={titleEditor.handleTitleKeyDown}
              cancelTitleEdit={titleEditor.cancelTitleEdit}
              compactToolbar={compactToolbar}
              toolbarMenuOpen={toolbarMenuOpen} setToolbarMenuOpen={setToolbarMenuOpen}
              toolbarMenuRef={toolbarMenuRef}
              setShowSettings={setShowSettings}
              showAiChat={showAiChat} setShowAiChat={setShowAiChat}
              handleAddSpecialWidget={handleAddSpecialWidget}
              handleOpenNewWidget={handleOpenNewWidget}
              handleDeselectWidget={handleDeselectWidget}
              setExitEditConfirm={setExitEditConfirm}
              setBackConfirm={setBackConfirm}
              navigate={navigate}
              showFilterPanel={showFilterPanel}
              onToggleFilterPanel={() => {
                setShowFilterPanel(prev => {
                  if (!prev) handleDeselectWidget();
                  return !prev;
                });
              }}
              filterFieldCount={globalFilterFields.length}
            />

            <div className="dashboard-content-scroll">
              <div className="dashboard-content">
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
                  className={`dashboard-canvas layout-${layoutMode} device-${devicePreview}${isEditMode ? ' edit-mode' : ''}${editingWidget && useSidePanel ? ' panel-open' : ''}${showFilterPanel ? ' filter-panel-open' : ''}`}
                  style={{ backgroundColor: currentTab?.canvasColor || 'transparent' }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget || e.target.closest('.widgets-grid') === e.target) handleDeselectWidget();
                  }}
                >
                  {dashboardLoadPhase === 'connecting' ? (
                    <ConnectingState />
                  ) : dashboardConnectionError ? (
                    <ConnectionErrorState error={dashboardConnectionError} onReconnect={handleReconnect} isReconnecting={isReconnecting} />
                  ) : currentWidgets.length > 0 ? (
                    <div
                      ref={gridContainerRef}
                      className={`grid-stack widgets-grid ${isEditMode ? 'show-grid-lines' : ''}`}
                      style={{ minHeight: layoutMode === 'fixed' ? fixedCanvasSize.height : undefined }}
                    >
                      {currentWidgets.map((widget, index) => {
                        const pos = widget.position || {};
                        const x = typeof pos.x === 'number' ? pos.x : (index % 3) * 4;
                        const y = typeof pos.y === 'number' ? pos.y : Math.floor(index / 3) * 3;
                        const w = typeof pos.w === 'number' && pos.w > 0 ? pos.w : 4;
                        const h = typeof pos.h === 'number' && pos.h > 0 ? pos.h : 3;

                        return (
                          <DashboardWidget
                            key={widget.id}
                            widget={widget}
                            gridPosition={{ x, y, w, h, minW: pos.minW || 1, minH: pos.minH || 1 }}
                            onSelect={isEditMode ? (w) => { setShowFilterPanel(false); handleSelectWidget(w); } : undefined}
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
                            tempFilters={tempFilters}
                            isGridLayout={true}
                            onAutoSave={(updates) => updateWidget(currentDashboard.id, widget.id, updates)}
                            onCloseEditor={() => { setSelectedWidgetId(null); setEditingWidget(null); }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyCanvasState onAddWidget={handleOpenNewWidget} />
                  )}
                </div>

                <TabBar
                  currentDashboard={currentDashboard}
                  currentTabId={currentTabId}
                  setCurrentTab={setCurrentTab}
                  addTab={addTab}
                  isEditMode={isEditMode}
                  tabListRef={tabMgmt.tabListRef}
                  tabOverflow={tabMgmt.tabOverflow}
                  checkTabOverflow={tabMgmt.checkTabOverflow}
                  scrollTabs={tabMgmt.scrollTabs}
                  editingTabId={tabMgmt.editingTabId}
                  editedTabTitle={tabMgmt.editedTabTitle}
                  setEditedTabTitle={tabMgmt.setEditedTabTitle}
                  setEditingTabId={tabMgmt.setEditingTabId}
                  saveTabTitle={tabMgmt.saveTabTitle}
                  handleTabTitleKeyDown={tabMgmt.handleTabTitleKeyDown}
                  handleTabContextMenu={tabMgmt.handleTabContextMenu}
                />
              </div>
            </div>

            {isEditMode && tabMgmt.tabContextMenu.open && (
              <TabContextMenu
                currentDashboard={currentDashboard}
                tabContextMenu={tabMgmt.tabContextMenu}
                tabContextMenuRef={tabMgmt.tabContextMenuRef}
                handleRenameTab={tabMgmt.handleRenameTab}
                handleDuplicateTab={tabMgmt.handleDuplicateTab}
                handleDeleteTab={tabMgmt.handleDeleteTab}
                previewTabColor={tabMgmt.previewTabColor}
                previewCanvasColor={tabMgmt.previewCanvasColor}
                handlePreviewTabColor={tabMgmt.handlePreviewTabColor}
                handleApplyTabColor={tabMgmt.handleApplyTabColor}
                handlePreviewCanvasColor={tabMgmt.handlePreviewCanvasColor}
                handleApplyCanvasColor={tabMgmt.handleApplyCanvasColor}
                handleQuickSetTabColor={tabMgmt.handleQuickSetTabColor}
                handleQuickSetCanvasColor={tabMgmt.handleQuickSetCanvasColor}
              />
            )}
          </>
        ) : isLoadingDashboard ? (
          <LoadingState />
        ) : dashboardLoadError ? (
          <ErrorState
            error={dashboardLoadError}
            onGoToSettings={() => { clearDashboardLoadError(); navigate('/settings'); }}
            onBackToDashboards={() => { clearDashboardLoadError(); navigate('/dashboards'); }}
          />
        ) : (
          <SelectDashboardState />
        )}
      </div>

      <CreateDashboardModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(dashboard) => { if (dashboard?.id) openDashboard(dashboard.id); }}
      />

      {showWidgetPicker && (
        <WidgetPickerModal
          widgetTypes={WIDGET_TYPES}
          widgetSearch={widgetSearch}
          setWidgetSearch={setWidgetSearch}
          onAddWidget={handleAddWidget}
          onAddSpecialWidget={handleAddSpecialWidget}
          onClose={() => setShowWidgetPicker(false)}
        />
      )}

      <DashboardFilterPanel
        open={showFilterPanel}
        onClose={() => setShowFilterPanel(false)}
        isEditMode={isEditMode}
        dashboard={currentDashboard}
        filterFields={globalFilterFields}
        onUpdateFilterFields={handleUpdateFilterFields}
      />

      {useSidePanel && (
        <WidgetEditorWrapper
          widget={liveEditingWidget}
          dashboardId={currentDashboard?.id}
          isOpen={!!editingWidget}
          isNew={isCreatingWidget}
          onClose={() => { setEditingWidget(null); setIsCreatingWidget(false); setSelectedWidgetId(null); }}
          onSave={async (updates) => {
            if (isCreatingWidget) {
              const position = findNextAvailablePosition(4, 3);
              await addWidget(currentDashboard.id, {
                type: updates.type, title: updates.title, config: updates.config, position,
                modelId: updates.modelId, query: updates.query,
                semanticViewsReferenced: updates.semanticViewsReferenced,
                fieldsUsed: updates.fieldsUsed, filtersApplied: updates.filtersApplied,
                sortsApplied: updates.sortsApplied, customColumns: updates.customColumns,
              });
            } else {
              updateWidget(currentDashboard.id, editingWidget.id, updates);
            }
            setEditingWidget(null); setIsCreatingWidget(false); setSelectedWidgetId(null);
          }}
          onAutoSave={(updates) => {
            if (editingWidget && currentDashboard) updateWidget(currentDashboard.id, editingWidget.id, updates);
          }}
        />
      )}

      {editingWidget && !useSidePanel && !useInlineEditor && (
        <WidgetEditor
          key={editingWidget.id || 'new'}
          widget={liveEditingWidget}
          dashboardId={currentDashboard?.id}
          isNew={isCreatingWidget}
          inline={false}
          onClose={() => { setEditingWidget(null); setIsCreatingWidget(false); setSelectedWidgetId(null); }}
          onSave={async (updates) => {
            if (isCreatingWidget) {
              const position = findNextAvailablePosition(4, 3);
              await addWidget(currentDashboard.id, {
                type: updates.type, title: updates.title, config: updates.config, position,
                modelId: updates.modelId, query: updates.query,
                semanticViewsReferenced: updates.semanticViewsReferenced,
                fieldsUsed: updates.fieldsUsed, filtersApplied: updates.filtersApplied,
                sortsApplied: updates.sortsApplied, customColumns: updates.customColumns,
              });
            } else {
              updateWidget(currentDashboard.id, editingWidget.id, updates);
            }
            setEditingWidget(null); setIsCreatingWidget(false); setSelectedWidgetId(null);
          }}
        />
      )}

      <DashboardSettingsModal
        dashboard={currentDashboard}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
      />

      {deleteConfirm.open && (
        <ConfirmDeleteModal
          itemName={deleteConfirm.itemName}
          itemType={deleteConfirm.itemType}
          onConfirm={deleteConfirm.onConfirm}
          onCancel={() => setDeleteConfirm({ open: false, itemName: '', itemType: '', onConfirm: null })}
        />
      )}

      {exitEditConfirm && (
        <ExitEditConfirmModal
          onClose={() => setExitEditConfirm(false)}
          loadDashboard={loadDashboard}
          currentDashboard={currentDashboard}
          saveDashboard={saveDashboard}
          setIsEditMode={setIsEditMode}
        />
      )}

      {backConfirm && (
        <BackConfirmModal
          onClose={() => setBackConfirm(false)}
          currentDashboard={currentDashboard}
          saveDashboard={saveDashboard}
          navigate={navigate}
        />
      )}

      {showShortcuts && <KeyboardShortcutsPanel onClose={() => setShowShortcuts(false)} />}

      {currentDashboard?.cortexAgentsEnabled && currentDashboard?.cortexAgents?.length > 0 && (
        <CortexAgentChat
          connectionId={currentDashboard.connection_id}
          cortexAgents={currentDashboard.cortexAgents}
          role={currentDashboard.role}
          tempFilters={tempFilters}
          onApplyTempFilter={(filter) => setTempFilters(prev => [...prev.filter(f => f.field !== filter.field), filter])}
          onClearTempFilters={() => setTempFilters([])}
        />
      )}

      <AiChatPanel
        isOpen={showAiChat}
        onClose={() => setShowAiChat(false)}
        focusedWidgetId={aiFocusedWidgetId}
        onFocusWidget={setAiFocusedWidgetId}
      />
    </div>
  );
};

export default DashboardView;
