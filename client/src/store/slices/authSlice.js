import {
  authApi,
  persistSession, restoreSession, clearPersistedSession,
} from '../../api/apiClient';
import { log } from '../storeUtils';

export const createAuthSlice = (set, get) => ({
  // Connection state (kept for data explorer backward compat)
  connection: null,
  connectionId: null,
  isConnecting: false,
  connectionError: null,

  // User / Role state
  currentUser: null,
  currentRole: 'ANALYST',
  availableRoles: ['ACCOUNTADMIN', 'SYSADMIN', 'ANALYST', 'DATA_ENGINEER', 'VIEWER'],

  // Authentication state
  isAuthenticated: false,
  emergencyMode: false,

  // User connections
  userConnections: [],
  loadingConnections: false,

  loadUserConnections: async () => {
    set({ loadingConnections: true });
    try {
      const response = await fetch('/api/v1/connections', {
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('authToken')}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        const connections = await response.json();
        set({ userConnections: connections, loadingConnections: false });
      } else {
        set({ userConnections: [], loadingConnections: false });
      }
    } catch (error) {
      console.error('Failed to load connections:', error);
      set({ userConnections: [], loadingConnections: false });
    }
  },

  setCurrentRole: async (role, forceChange = false) => {
    if (!forceChange && get().hasUnsavedChanges) {
      return { blocked: true, reason: 'unsaved_changes' };
    }
    
    set({ currentRole: role, currentDashboard: null, dashboards: [], hasUnsavedChanges: false });
    try {
      await authApi.switchRole(role);
      await Promise.all([
        get().loadWarehouses(),
        get().loadSemanticViews(),
        get().loadDashboards(),
      ]);
    } catch (error) {
      console.warn('Failed to switch role on server:', error);
    }
    return { blocked: false };
  },

  signIn: async (credentials) => {
    const { username, password, forceLogin } = credentials;
    set({ isConnecting: true, connectionError: null });
    try {
      const response = await authApi.login(username, password, forceLogin);
      
      if (response.success && response.requires2FA) {
        set({ isConnecting: false });
        return {
          requires2FA: true,
          pendingToken: response.pendingToken,
          userId: response.userId,
          methods: response.methods,
          gracePeriodDaysRemaining: response.gracePeriodDaysRemaining,
        };
      }
      
      if (response.success) {
        get().completeSignIn(response, username);
        return response;
      } else {
        throw new Error(response.error || 'Authentication failed');
      }
    } catch (error) {
      set({ isConnecting: false, connectionError: error.message });
      throw error;
    }
  },

  emergencySignIn: async (masterKey) => {
    set({ isConnecting: true, connectionError: null });
    try {
      const response = await authApi.emergencyLogin(masterKey);
      if (response.success) {
        persistSession(response.user, response.token);
        set({
          isAuthenticated: true,
          currentUser: response.user,
          currentRole: 'owner',
          availableRoles: ['owner'],
          isConnecting: false,
          connectionError: null,
          emergencyMode: true,
        });
        return response;
      } else {
        throw new Error(response.error || 'Emergency login failed');
      }
    } catch (error) {
      set({ isConnecting: false, connectionError: error.message });
      throw error;
    }
  },

  setCurrentUser: (user) => set({ currentUser: user }),

  completeSignIn: (response, username) => {
    persistSession(response.user, response.token);
    
    const role = response.user?.role || 'viewer';

    set({
      isAuthenticated: true,
      currentUser: response.user || { username },
      currentRole: role,
      availableRoles: role === 'bootstrap_admin' ? ['bootstrap_admin'] : ['viewer', 'developer', 'admin', 'owner'],
      isConnecting: false,
      connectionError: null,
      currentDashboard: null,
      dashboards: [],
    });

    // Bootstrap admin — skip all DB-dependent post-login calls
    if (role === 'bootstrap_admin') return;
    
    const userThemePref = response.user?.theme_preference;
    if (userThemePref) {
      const currentTheme = get().theme;
      if (currentTheme !== userThemePref) {
        document.documentElement.classList.add('theme-transition');
        localStorage.setItem('theme', userThemePref);
        document.documentElement.setAttribute('data-theme', userThemePref);
        set({ theme: userThemePref });
        setTimeout(() => {
          document.documentElement.classList.remove('theme-transition');
        }, 250);
      }
    } else {
      get().saveInitialThemeToBackend();
    }
    
    if (response.gracePeriodWarning) {
      console.warn('MFA Grace Period Warning:', response.gracePeriodWarning);
    }
    
    get().loadWorkspaces();
    get().loadUserConnections();
    get().checkAskAccess();
  },

  complete2FASignIn: async (response) => {
    if (response.success && response.token) {
      get().completeSignIn(response, response.user?.username);
      return { success: true };
    }
    throw new Error('MFA verification failed');
  },

  signOut: async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.warn('Logout error:', error);
    }
    
    clearPersistedSession();
    
    set({ 
      isAuthenticated: false,
      currentUser: null, 
      currentRole: null,
      availableRoles: [],
      activeView: 'home',
      dashboards: [],
      currentDashboard: null,
      currentTabId: null,
      semanticModels: [],
      askHasAccess: null,
    });
  },

  initializeApp: async () => {
    const { isInitialized } = get();
    if (isInitialized) return;

    set({ isLoading: true });

    const savedSession = restoreSession();
    if (savedSession?.token && savedSession?.user) {
      try {
        const validation = await authApi.validate();
        if (validation.valid) {
          log('Restored session for user:', savedSession.user.username);
          
          const role = validation.user?.role || savedSession.user.role;
          const rolesResponse = await authApi.getRoles();
          
          set({
            isInitialized: true,
            isLoading: false,
            isAuthenticated: true,
            currentUser: savedSession.user,
            currentRole: role,
            availableRoles: rolesResponse.roles || [],
          });

          // Bootstrap admin — skip DB-dependent calls
          if (role === 'bootstrap_admin') return;
          
          await get().loadWorkspaces();
          get().loadUserConnections();
          get().checkAskAccess();
          
          return;
        }
      } catch (error) {
        console.warn('Failed to restore session:', error);
        clearPersistedSession();
      }
    }

    set({
      isInitialized: true,
      isLoading: false,
      isAuthenticated: false,
    });
  },

});
