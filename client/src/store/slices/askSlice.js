const ASK_SESSION_KEY = 'ask_session';

function saveSession(workspaceId, conversationId, connectionId, viewFqn) {
  try {
    sessionStorage.setItem(ASK_SESSION_KEY, JSON.stringify({
      workspaceId: workspaceId || null,
      conversationId: conversationId || null,
      connectionId: connectionId || null,
      viewFqn: viewFqn || null,
    }));
  } catch { /* ignore */ }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(ASK_SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export const createAskSlice = (set, get) => ({
  askHasAccess: null,
  askWorkspaces: [],
  askActiveWorkspace: null,
  askConversations: [],
  askActiveConversationId: null,
  askMessages: [],
  askIsStreaming: false,

  askWorkspaceConnections: [],
  askActiveConnectionId: null,
  askWorkspaceViews: [],
  askActiveViewFqn: null,

  checkAskAccess: async () => {
    const role = get().currentRole;
    if (['owner', 'admin'].includes(role)) {
      set({ askHasAccess: true });
      return true;
    }
    try {
      const { workspaceApi } = await import('../../api/modules/workspaceApi.js');
      const res = await workspaceApi.list();
      const has = Array.isArray(res.workspaces) && res.workspaces.length > 0;
      set({ askHasAccess: has });
      return has;
    } catch {
      set({ askHasAccess: false });
      return false;
    }
  },

  setAskWorkspaces: (workspaces) => set({ askWorkspaces: workspaces }),

  setAskActiveWorkspace: (workspace) => {
    saveSession(workspace?.id, null, null, null);
    set({
      askActiveWorkspace: workspace,
      askActiveConversationId: null,
      askMessages: [],
      askWorkspaceConnections: [],
      askActiveConnectionId: null,
      askWorkspaceViews: [],
      askActiveViewFqn: null,
    });
  },

  setAskWorkspaceResources: (connections, views) => {
    const state = get();
    const saved = loadSession();

    const conns = connections || [];
    const savedConnStillValid = saved.connectionId && conns.some(c => c.connection_id === saved.connectionId);
    const activeConnId = state.askActiveConnectionId
      || (savedConnStillValid ? saved.connectionId : null)
      || (conns.length ? conns[0].connection_id : null);

    const savedViewStillValid = saved.viewFqn && (views || []).some(v => v.semantic_view_fqn === saved.viewFqn);
    const activeViewFqn = state.askActiveViewFqn
      || (savedViewStillValid ? saved.viewFqn : null)
      || (views?.length ? views[0].semantic_view_fqn : null);

    set({
      askWorkspaceConnections: conns,
      askActiveConnectionId: activeConnId,
      askWorkspaceViews: views || [],
      askActiveViewFqn: activeViewFqn,
    });
  },

  setAskActiveConnectionId: (id) => {
    set({ askActiveConnectionId: id });
    const s = get();
    saveSession(s.askActiveWorkspace?.id, s.askActiveConversationId, id, s.askActiveViewFqn);
  },
  setAskActiveViewFqn: (fqn) => {
    set({ askActiveViewFqn: fqn });
    const s = get();
    saveSession(s.askActiveWorkspace?.id, s.askActiveConversationId, s.askActiveConnectionId, fqn);
  },

  setAskConversations: (conversations) => set({ askConversations: conversations }),

  setAskActiveConversation: (id, messages) => {
    const ws = get().askActiveWorkspace;
    saveSession(ws?.id, id);
    set(s => ({
      askActiveConversationId: id,
      askMessages: messages !== undefined ? messages : s.askMessages,
    }));
  },

  addAskConversation: (conv) => set(s => ({
    askConversations: [conv, ...s.askConversations],
  })),

  renameAskConversation: (id, title) => set(s => ({
    askConversations: s.askConversations.map(c => c.id === id ? { ...c, title } : c),
  })),

  removeAskConversation: (id) => set(s => {
    const wasActive = s.askActiveConversationId === id;
    if (wasActive) saveSession(s.askActiveWorkspace?.id, null);
    return {
      askConversations: s.askConversations.filter(c => c.id !== id),
      askActiveConversationId: wasActive ? null : s.askActiveConversationId,
      askMessages: wasActive ? [] : s.askMessages,
    };
  }),

  addAskMessage: (msg) => set(s => ({ askMessages: [...s.askMessages, msg] })),

  updateLastAskAssistantMessage: (updater) => set(s => {
    const msgs = [...s.askMessages];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = typeof updater === 'function' ? updater(msgs[i]) : { ...msgs[i], ...updater };
        break;
      }
    }
    return { askMessages: msgs };
  }),

  setAskStreaming: (isStreaming) => set({ askIsStreaming: isStreaming }),

  getAskSavedSession: () => loadSession(),
});
