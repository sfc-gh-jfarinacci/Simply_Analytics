import { workspaceApi } from '../../api/modules/workspaceApi.js';
import { fetchApi, safeJson } from '../../api/modules/fetchCore.js';

export const createWorkspaceSlice = (set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  defaultWorkspaceId: null,
  workspaceMembers: [],
  isLoadingWorkspaces: false,

  loadWorkspaces: async () => {
    set({ isLoadingWorkspaces: true });
    try {
      const data = await workspaceApi.list();
      const workspaces = data.workspaces || [];
      const defaultWorkspaceId = data.defaultWorkspaceId || null;
      const { activeWorkspace } = get();

      // If activeWorkspace exists, refresh it with updated data from the server
      const updatedActive = activeWorkspace
        ? workspaces.find(w => w.id === activeWorkspace.id) || null
        : null;

      set({
        workspaces,
        defaultWorkspaceId,
        isLoadingWorkspaces: false,
        ...(activeWorkspace && {
          activeWorkspace: updatedActive,
          askActiveWorkspace: updatedActive,
        }),
      });

      if (!updatedActive) {
        // Priority: default workspace > first workspace
        const defaultMatch = defaultWorkspaceId
          ? workspaces.find(w => w.id === defaultWorkspaceId)
          : null;

        if (defaultMatch) {
          get().switchWorkspace(defaultMatch);
        } else if (workspaces.length > 0) {
          // Default is invalid/null — don't auto-switch, let UI prompt
          // But if there's exactly one workspace, just use it
          if (workspaces.length === 1) {
            get().switchWorkspace(workspaces[0]);
          }
          // Otherwise activeWorkspace stays null; WorkspacesView will show picker
        }
      }

      return workspaces;
    } catch (err) {
      console.error('Failed to load workspaces:', err);
      set({ isLoadingWorkspaces: false });
      return [];
    }
  },

  switchWorkspace: (workspace) => {
    if (!workspace) {
      set({
        activeWorkspace: null,
        workspaceMembers: [],
        dashboards: [],
        currentDashboard: null,
        currentTabId: null,
        hasUnsavedChanges: false,
        askActiveWorkspace: workspace,
        askActiveConversationId: null,
        askMessages: [],
        askConversations: [],
        askWorkspaceConnections: [],
        askActiveConnectionId: null,
        askWorkspaceViews: [],
        askSelectedViewFqn: null,
      });
      return;
    }

    set({
      activeWorkspace: workspace,
      workspaceMembers: [],
      currentDashboard: null,
      currentTabId: null,
      hasUnsavedChanges: false,
      askActiveWorkspace: workspace,
      askActiveConversationId: null,
      askMessages: [],
      askConversations: [],
      askWorkspaceConnections: [],
      askActiveConnectionId: null,
      askWorkspaceViews: [],
      askSelectedViewFqn: null,
    });

    get().loadDashboards();
  },

  setDefaultWorkspace: async (workspaceId) => {
    try {
      const res = await fetchApi('/users/me/default-workspace', {
        method: 'PUT',
        body: JSON.stringify({ workspaceId }),
      });
      if (res.ok) {
        set({ defaultWorkspaceId: workspaceId });
      }
    } catch (err) {
      console.error('Failed to set default workspace:', err);
    }
  },

  loadWorkspaceMembers: async (workspaceId) => {
    try {
      const data = await workspaceApi.getMembers(workspaceId || get().activeWorkspace?.id);
      set({ workspaceMembers: data.members || [] });
      return data.members || [];
    } catch (err) {
      console.error('Failed to load workspace members:', err);
      return [];
    }
  },

});
