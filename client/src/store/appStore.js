import { create } from 'zustand';
import api, { 
  dashboardApi, semanticApi, connectionApi, queryApi, authApi, userApi,
  persistSession, restoreSession, clearPersistedSession, persistLastDashboard, getLastDashboard 
} from '../api/apiClient';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Debug logging
const DEBUG = import.meta.env.VITE_DEBUG === 'true';
const log = (...args) => DEBUG && log(...args);

// Helper for authenticated API calls
const authFetch = async (url, options = {}) => {
  const token = sessionStorage.getItem('authToken');
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };
  return fetch(url, config);
};

export const useAppStore = create((set, get) => ({
  // Connection state (now per-dashboard, but keep for data explorer)
  connection: null,
  connectionId: null,
  isConnecting: false,
  connectionError: null,

  // Data browser state
  databases: [],
  schemas: [],
  tables: [],
  columns: [],
  selectedDatabase: null,
  selectedSchema: null,
  selectedTable: null,

  // Semantic models
  semanticModels: [],
  selectedModel: null,
  
  // Semantic view metadata cache - keyed by fully qualified name
  // Avoids re-fetching metadata every time WidgetEditor opens
  semanticViewMetadataCache: {},

  // Saved custom color schemes - now stored at dashboard level, this is derived
  savedColorSchemes: [],

  // Dashboards
  dashboards: [],
  currentDashboard: null,
  currentTabId: null,
  hasUnsavedChanges: false, // Track if dashboard has unsaved edits
  isSaving: false, // Track save operation in progress
  isLoadingDashboards: false, // Track dashboard list loading
  isLoadingDashboard: false, // Track single dashboard loading
  dashboardLoadPhase: null, // 'config' | 'connecting' | null
  dashboardLoadError: null, // Track dashboard load errors (access denied, not found)
  dashboardConnectionError: null, // Track connection errors (for reconnect banner)
  widgetRefreshKey: 0, // Increment to trigger all widgets to reload their data

  // UI state
  activeView: 'home', // home, explorer, models, dashboards
  sidebarOpen: true,
  isLoading: false,
  isInitialized: false,
  
  // Live editing widget config - synced from WidgetEditor to DashboardWidget
  // This allows real-time updates while editing without persisting to server
  editingWidgetConfig: null,
  
  setEditingWidgetConfig: (config) => set({ editingWidgetConfig: config }),
  
  clearEditingWidgetConfig: () => set({ editingWidgetConfig: null }),
  
  // Theme state (default to light, use localStorage when not authenticated)
  theme: localStorage.getItem('theme') || 'light',
  
  setTheme: async (theme) => {
    // Add transition class for smooth animation
    document.documentElement.classList.add('theme-transition');
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
    // Remove transition class after animation completes
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transition');
    }, 250);
    
    // If authenticated, save to backend
    if (get().isAuthenticated) {
      try {
        await userApi.updateTheme(theme);
      } catch (err) {
        console.warn('Failed to save theme preference:', err.message);
      }
    }
  },
  
  toggleTheme: async () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    // Add transition class for smooth animation
    document.documentElement.classList.add('theme-transition');
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    set({ theme: newTheme });
    // Remove transition class after animation completes
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transition');
    }, 250);
    
    // If authenticated, save to backend
    if (get().isAuthenticated) {
      try {
        await userApi.updateTheme(newTheme);
      } catch (err) {
        console.warn('Failed to save theme preference:', err.message);
      }
    }
  },
  
  // Load theme from backend (called after authentication)
  loadThemeFromBackend: async () => {
    try {
      const { theme } = await userApi.getTheme();
      if (theme) {
        document.documentElement.classList.add('theme-transition');
        localStorage.setItem('theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
        set({ theme });
        setTimeout(() => {
          document.documentElement.classList.remove('theme-transition');
        }, 250);
      }
    } catch (err) {
      console.warn('Failed to load theme preference:', err.message);
    }
  },
  
  // Save current theme to backend on first login
  saveInitialThemeToBackend: async () => {
    const currentTheme = get().theme;
    try {
      await userApi.updateTheme(currentTheme);
    } catch (err) {
      console.warn('Failed to save initial theme preference:', err.message);
    }
  },

  // User/Role state
  currentUser: 'john.doe@company.com',
  currentRole: 'ANALYST',
  availableRoles: ['ACCOUNTADMIN', 'SYSADMIN', 'ANALYST', 'DATA_ENGINEER', 'VIEWER'],

  // Query results
  queryResults: null,
  queryError: null,

  // Color palettes (loaded from YAML)
  colorPalettes: null,

  // Warehouses (loaded when authenticated)
  availableWarehouses: [],
  loadingWarehouses: false,

  // Semantic views (loaded when authenticated)
  availableSemanticViews: [],
  loadingSemanticViews: false,

  // Actions
  setActiveView: (view) => set({ activeView: view }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  // Authentication state
  isAuthenticated: false,

  // Load warehouses from Snowflake
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

  // Load semantic views from Snowflake
  loadSemanticViews: async () => {
    set({ loadingSemanticViews: true });
    try {
      const response = await semanticApi.listViews();
      set({ 
        availableSemanticViews: response.views || [],
        loadingSemanticViews: false,
      });
    } catch (error) {
      console.warn('Failed to load semantic views:', error);
      set({ loadingSemanticViews: false, availableSemanticViews: [] });
    }
  },

  // Role actions
  // Check if there are unsaved changes (for external components to use)
  checkHasUnsavedChanges: () => get().hasUnsavedChanges,
  
  // Force clear unsaved changes and reset dashboard (used when user confirms discard)
  // This resets currentDashboard to null so it will be reloaded fresh next time
  clearUnsavedChanges: () => set({ 
    hasUnsavedChanges: false, 
    currentDashboard: null,
    currentTabId: null 
  }),
  
  // Dashboard connection error management
  setDashboardConnectionError: (error) => set({ dashboardConnectionError: error }),
  clearDashboardConnectionError: () => set({ dashboardConnectionError: null }),
  
  // Trigger all widgets to reload their data (used after reconnect)
  triggerWidgetRefresh: () => set(state => ({ widgetRefreshKey: state.widgetRefreshKey + 1 })),

  setCurrentRole: async (role, forceChange = false) => {
    // If there are unsaved changes and not forcing, return false to indicate action was blocked
    if (!forceChange && get().hasUnsavedChanges) {
      return { blocked: true, reason: 'unsaved_changes' };
    }
    
    set({ currentRole: role, currentDashboard: null, dashboards: [], hasUnsavedChanges: false });
    // Switch role on server and reload data
    try {
      await authApi.switchRole(role);
      // Reload all role-dependent data - await dashboard load
      await Promise.all([
        get().loadWarehouses(),
        get().loadSemanticViews(),
        get().loadDashboards(), // Dashboards are role-dependent
      ]);
    } catch (error) {
      console.warn('Failed to switch role on server:', error);
    }
    return { blocked: false };
  },

  // Sign in with app username/password (PostgreSQL user)
  signIn: async (credentials) => {
    const { username, password, forceLogin } = credentials;
    set({ isConnecting: true, connectionError: null });
    try {
      const response = await authApi.login(username, password, forceLogin);
      
      // Check if 2FA is required
      if (response.success && response.requires2FA) {
        // 2FA required - return pending info without completing sign-in
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
        // Complete sign-in (either no 2FA or 2FA already verified)
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

  // Complete sign-in after password verification (and 2FA if applicable)
  completeSignIn: (response, username) => {
    // Persist session to localStorage
    persistSession(response.user, response.token);
    
    set({
      isAuthenticated: true,
      currentUser: response.user?.username || username,
      currentRole: response.user?.role || 'viewer',
      availableRoles: ['viewer', 'creator', 'admin', 'owner'],
      isConnecting: false,
      connectionError: null,
      currentDashboard: null,
      dashboards: [],
    });
    
    // Handle theme preference
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
    
    // Show grace period warning if applicable
    if (response.gracePeriodWarning) {
      console.warn('MFA Grace Period Warning:', response.gracePeriodWarning);
      // Could show a toast/notification here
    }
    
    // Load user's dashboards and connections
    get().loadDashboards();
    get().loadUserConnections();
  },

  // Complete 2FA verification and finish sign-in
  complete2FASignIn: async (response) => {
    if (response.success && response.token) {
      get().completeSignIn(response, response.user?.username);
      return { success: true };
    }
    throw new Error('MFA verification failed');
  },

  // Load user's Snowflake connections
  userConnections: [],
  loadingConnections: false,
  
  loadUserConnections: async () => {
    set({ loadingConnections: true });
    try {
      const response = await fetch('/api/connections', {
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

  // Sign in with Key Pair (kept for backward compatibility with stored connections)
  signInWithKeyPair: async (credentials) => {
    const { account, username, privateKey, privateKeyPassphrase } = credentials;
    set({ isLoading: true });
    try {
      const response = await authApi.loginWithKeyPair(account, username, privateKey, privateKeyPassphrase);
      if (response.success) {
        // Persist session to localStorage
        persistSession(response.user, response.token);
        
        set({
          isAuthenticated: true,
          currentUser: response.user?.username || username,
          currentRole: response.user?.role || 'PUBLIC',
          availableRoles: response.roles || [],
          isLoading: false,
          currentDashboard: null,
          dashboards: [],
        });
        // Load all user data for the authenticated session
        get().loadWarehouses();
        get().loadSemanticViews();
        get().loadDashboards();
        return response;
      } else {
        throw new Error(response.error || 'Authentication failed');
      }
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  // Sign in with PAT (kept for backward compatibility with stored connections)
  signInWithPAT: async (credentials) => {
    const { account, username, token } = credentials;
    set({ isLoading: true });
    try {
      const response = await authApi.loginWithPAT(account, username, token);
      if (response.success) {
        // Persist session to localStorage
        persistSession(response.user, response.token);
        
        set({
          isAuthenticated: true,
          currentUser: response.user?.username || username,
          currentRole: response.user?.role || 'PUBLIC',
          availableRoles: response.roles || [],
          isLoading: false,
          currentDashboard: null,
          dashboards: [],
        });
        // Load all user data for the authenticated session
        get().loadWarehouses();
        get().loadSemanticViews();
        get().loadDashboards();
        return response;
      } else {
        throw new Error(response.error || 'Authentication failed');
      }
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  // Sign out
  signOut: async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.warn('Logout error:', error);
    }
    
    // Clear persisted session from localStorage
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
    });
  },

  // Initialize app - check for existing session
  initializeApp: async () => {
    const { isInitialized } = get();
    if (isInitialized) return;

    set({ isLoading: true });

    // Try to restore session from localStorage
    const savedSession = restoreSession();
    if (savedSession?.token && savedSession?.user) {
      try {
        // Validate the session with the server
        const validation = await authApi.validate();
        if (validation.valid) {
          log('Restored session for user:', savedSession.user.username);
          
          // Get available roles
          const rolesResponse = await authApi.getRoles();
          
          set({
            isInitialized: true,
            isLoading: false,
            isAuthenticated: true,
            currentUser: savedSession.user.username,
            currentRole: savedSession.user.role,
            availableRoles: rolesResponse.roles || [],
          });
          
          // Load user data - dashboards and user's stored Snowflake connections
          const dashboards = await get().loadDashboards();
          get().loadUserConnections();
          // Color schemes are now loaded with each dashboard
          
          // Only restore last viewed dashboard if loadDashboards succeeded (no MFA error)
          const { dashboardLoadError } = get();
          if (!dashboardLoadError) {
            const lastDashboardId = getLastDashboard();
            if (lastDashboardId && dashboards.some(d => d.id === lastDashboardId)) {
              get().loadDashboard(lastDashboardId);
            }
          }
          
          return;
        }
      } catch (error) {
        console.warn('Failed to restore session:', error);
        clearPersistedSession();
      }
    }

    // No session found - set to unauthenticated state
    set({
      isInitialized: true,
      isLoading: false,
      isAuthenticated: false,
    });
  },

  // Connect to Snowflake with credentials
  connectSnowflake: async (credentials) => {
    set({ isConnecting: true, connectionError: null });

    try {
      const result = await authApi.login(credentials);
      
      if (result.success) {
        // Save session
        persistSession(result.token, {
          username: result.user.username,
          role: result.user.role,
        });
        
        // Get available roles
        const rolesResponse = await authApi.getRoles();
        
        set({
          isConnecting: false,
          isAuthenticated: true,
          connectionId: result.connectionId,
          currentUser: result.user.username,
          currentRole: result.user.role,
          availableRoles: rolesResponse.roles || [],
        });
        
        // Load user data
        get().loadWarehouses();
        get().loadSemanticViews();
        get().loadDashboards();
        
        return { success: true };
      } else {
        set({
          isConnecting: false,
          connectionError: result.error || 'Connection failed',
        });
        return { success: false, error: result.error };
      }
    } catch (error) {
      set({
        isConnecting: false,
        connectionError: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  // Disconnect and clear session
  disconnect: async () => {
    const { connectionId } = get();
    if (connectionId) {
      try {
        await authApi.logout();
      } catch (e) {
        console.warn('Logout failed:', e);
      }
    }
    clearPersistedSession();
    set({
      isAuthenticated: false,
      connectionId: null,
      connection: null,
      currentDashboard: null,
      currentTabId: null,
      dashboards: [],
      semanticModels: [],
      databases: [],
      schemas: [],
      tables: [],
      columns: [],
      selectedDatabase: null,
      selectedSchema: null,
      selectedTable: null,
      currentUser: null,
      currentRole: null,
      activeView: 'home',
    });
  },

  // Data browser actions
  loadDatabases: async () => {
    const { connectionId } = get();
    if (!connectionId) return;

    set({ isLoading: true });
    try {
      const response = await authFetch(`${API_BASE}/connection/databases/${connectionId}`);
      const data = await response.json();
      set({ databases: data.databases, isLoading: false });
    } catch (error) {
      console.error('Failed to load databases:', error);
      set({ isLoading: false });
    }
  },

  selectDatabase: async (database) => {
    const { connectionId } = get();
    set({ selectedDatabase: database, selectedSchema: null, selectedTable: null, schemas: [], tables: [], columns: [] });

    if (!connectionId) return;

    try {
      const response = await authFetch(`${API_BASE}/connection/schemas/${connectionId}/${database}`);
      const data = await response.json();
      set({ schemas: data.schemas });
    } catch (error) {
      console.error('Failed to load schemas:', error);
    }
  },

  selectSchema: async (schema) => {
    const { connectionId, selectedDatabase } = get();
    set({ selectedSchema: schema, selectedTable: null, tables: [], columns: [] });

    if (!connectionId) return;

    try {
      const response = await authFetch(`${API_BASE}/connection/tables/${connectionId}/${selectedDatabase}/${schema}`);
      const data = await response.json();
      set({ tables: data.tables });
    } catch (error) {
      console.error('Failed to load tables:', error);
    }
  },

  selectTable: async (table) => {
    const { connectionId, selectedDatabase, selectedSchema } = get();
    set({ selectedTable: table });

    if (!connectionId) return;

    try {
      const response = await authFetch(
        `${API_BASE}/connection/columns/${connectionId}/${selectedDatabase}/${selectedSchema}/${table}`
      );
      const data = await response.json();
      set({ columns: data.columns });
    } catch (error) {
      console.error('Failed to load columns:', error);
    }
  },

  // Query actions
  executeQuery: async (sql) => {
    const { connectionId } = get();
    if (!connectionId) return;

    set({ isLoading: true, queryError: null });
    try {
      const response = await authFetch(`${API_BASE}/query/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, sql }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      set({ queryResults: data, isLoading: false });
      return data;
    } catch (error) {
      set({ queryError: error.message, isLoading: false });
      throw error;
    }
  },

  getSampleData: async () => {
    const { connectionId, selectedDatabase, selectedSchema, selectedTable } = get();
    if (!connectionId || !selectedTable) return;

    set({ isLoading: true, queryError: null });
    try {
      const response = await authFetch(
        `${API_BASE}/query/sample/${connectionId}/${selectedDatabase}/${selectedSchema}/${selectedTable}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      set({ queryResults: data, isLoading: false });
      return data;
    } catch (error) {
      set({ queryError: error.message, isLoading: false });
    }
  },

  // Semantic model actions
  loadModels: async () => {
    try {
      const response = await authFetch(`${API_BASE}/semantic/models`);
      const data = await response.json();
      set({ semanticModels: data.models || [] });
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  },

  createModel: async (modelData) => {
    try {
      const response = await authFetch(`${API_BASE}/semantic/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelData),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      set((state) => ({ semanticModels: [...state.semanticModels, data.model] }));
      return data.model;
    } catch (error) {
      console.error('Failed to create model:', error);
      throw error;
    }
  },

  generateModel: async (name, description) => {
    const { connectionId, selectedDatabase, selectedSchema, selectedTable, columns } = get();
    if (!selectedTable || !columns.length) return;

    try {
      const response = await authFetch(`${API_BASE}/semantic/models/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          database: selectedDatabase,
          schema: selectedSchema,
          table: selectedTable,
          columns,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      set((state) => ({ semanticModels: [...state.semanticModels, data.model] }));
      return data.model;
    } catch (error) {
      console.error('Failed to generate model:', error);
      throw error;
    }
  },

  selectModel: (model) => set({ selectedModel: model }),

  // Semantic view metadata cache actions
  // Get cached metadata for a semantic view (returns null if not cached)
  getCachedViewMetadata: (fullyQualifiedName) => {
    if (!fullyQualifiedName) return null;
    return get().semanticViewMetadataCache[fullyQualifiedName] || null;
  },
  
  // Cache metadata for a semantic view
  setCachedViewMetadata: (fullyQualifiedName, metadata) => {
    if (!fullyQualifiedName || !metadata) return;
    set((state) => ({
      semanticViewMetadataCache: {
        ...state.semanticViewMetadataCache,
        [fullyQualifiedName]: {
          ...metadata,
          cachedAt: Date.now(),
        },
      },
    }));
  },
  
  // Prefetch metadata for all semantic views referenced by a dashboard's widgets
  // Called after loadDashboard so metadata is ready before WidgetEditor opens
  prefetchSemanticViewMetadata: async (dashboard) => {
    if (!dashboard?.tabs) return;
    
    const { getCachedViewMetadata, setCachedViewMetadata } = get();
    
    // Collect all unique semantic view FQNs from all widgets across all tabs
    const fqnSet = new Set();
    dashboard.tabs.forEach(tab => {
      (tab.widgets || []).forEach(widget => {
        // Try multiple sources for the FQN
        const refs = widget.semanticViewsReferenced || [];
        refs.forEach(ref => {
          const fqn = typeof ref === 'object' ? ref.fullyQualifiedName : null;
          if (fqn) fqnSet.add(fqn);
        });
        // Also check widget.semanticView directly
        if (widget.semanticView && widget.semanticView.includes('.')) {
          fqnSet.add(widget.semanticView);
        }
      });
    });
    
    // Also check dashboard-level semanticViewsReferenced
    (dashboard.semanticViewsReferenced || []).forEach(ref => {
      const fqn = typeof ref === 'object' ? ref.fullyQualifiedName : null;
      if (fqn) fqnSet.add(fqn);
    });
    
    if (fqnSet.size === 0) return;
    
    // Helper to parse Snowflake DESCRIBE output (same logic as widget-editor utils)
    const parseColumns = (columns) => {
      const dimensions = [], measures = [], facts = [];
      const stripPrefix = (name) => name?.includes('.') ? name.split('.').pop() : name;
      
      const isSnowflakeFormat = columns?.[0]?.object_kind !== undefined;
      
      if (isSnowflakeFormat) {
        const objectMap = new Map();
        columns.forEach(({ object_kind, object_name, property, property_value, parent_entity }) => {
          if (!object_name) return;
          if (!objectMap.has(object_name)) {
            objectMap.set(object_name, { name: stripPrefix(object_name), kind: object_kind, parentEntity: parent_entity, properties: {} });
          }
          if (property && property_value !== undefined) {
            objectMap.get(object_name).properties[property] = property_value;
          }
        });
        objectMap.forEach((obj) => {
          const kind = (obj.kind || '').toUpperCase();
          if (!['FACT', 'DIMENSION', 'METRIC'].includes(kind)) return;
          const fieldObj = { name: obj.name, type: obj.properties.DATA_TYPE || '', description: obj.properties.DESCRIPTION || '', parentEntity: obj.parentEntity };
          if (kind === 'METRIC') measures.push({ ...fieldObj, aggregation: obj.properties.DEFAULT_AGGREGATION || 'sum' });
          else if (kind === 'DIMENSION') dimensions.push(fieldObj);
          else if (kind === 'FACT') facts.push(fieldObj);
        });
      } else {
        (columns || []).forEach(col => {
          const name = col.name || col.column_name || col.NAME;
          const type = col.type || col.data_type || '';
          const semType = col.semantic_type || col.kind;
          if (!name) return;
          const fieldObj = { name, type, description: col.description || '' };
          if (semType === 'measure' || col.aggregation) measures.push({ ...fieldObj, aggregation: col.aggregation || 'sum' });
          else if (semType === 'dimension') dimensions.push(fieldObj);
          else if (semType === 'fact') facts.push(fieldObj);
          else {
            const upper = type.toUpperCase();
            (upper.includes('NUMBER') || upper.includes('INT') || upper.includes('FLOAT') || upper.includes('DECIMAL')) ? facts.push(fieldObj) : dimensions.push(fieldObj);
          }
        });
      }
      return { dimensions, measures, facts };
    };
    
    // Fetch all views in parallel, skipping already-cached ones
    const fetches = [...fqnSet].map(async (fqn) => {
      if (getCachedViewMetadata(fqn)) return; // Already cached
      
      try {
        const parts = fqn.split('.');
        if (parts.length !== 3) return;
        const [database, schema, name] = parts;
        
        const data = await semanticApi.getView(database, schema, name, {
          connectionId: dashboard.connection_id,
          role: dashboard.role,
          warehouse: dashboard.warehouse,
        });
        
        let metadata;
        if (data?.columns?.length > 0) {
          metadata = parseColumns(data.columns);
        } else if (data?.dimensions || data?.measures || data?.facts) {
          metadata = { dimensions: data.dimensions || [], measures: data.measures || [], facts: data.facts || [] };
        }
        
        if (metadata) {
          setCachedViewMetadata(fqn, metadata);
        }
      } catch (err) {
        console.warn(`[Prefetch] Failed to fetch metadata for ${fqn}:`, err.message);
      }
    });
    
    await Promise.allSettled(fetches);
  },

  // Clear cache for a specific view (e.g., when view is updated)
  clearCachedViewMetadata: (fullyQualifiedName) => {
    if (!fullyQualifiedName) return;
    set((state) => {
      const newCache = { ...state.semanticViewMetadataCache };
      delete newCache[fullyQualifiedName];
      return { semanticViewMetadataCache: newCache };
    });
  },
  
  // Clear all cached metadata
  clearAllViewMetadataCache: () => {
    set({ semanticViewMetadataCache: {} });
  },

  // Color scheme management - stored at dashboard level
  // Generate UUID for color schemes
  generateSchemeId: () => {
    return 'cs_' + crypto.randomUUID();
  },

  // Get all custom color schemes for the current dashboard
  getDashboardColorSchemes: () => {
    const { currentDashboard } = get();
    return currentDashboard?.customColorSchemes || [];
  },

  // Check if a color scheme is in use by any widget
  isColorSchemeInUse: (schemeId) => {
    const { currentDashboard } = get();
    if (!currentDashboard?.tabs) return false;
    
    for (const tab of currentDashboard.tabs) {
      for (const widget of (tab.widgets || [])) {
        if (widget.config?.customScheme?.id === schemeId) {
          return true;
        }
      }
    }
    return false;
  },

  // Get widgets using a specific color scheme
  getWidgetsUsingScheme: (schemeId) => {
    const { currentDashboard } = get();
    if (!currentDashboard?.tabs) return [];
    
    const widgets = [];
    for (const tab of currentDashboard.tabs) {
      for (const widget of (tab.widgets || [])) {
        if (widget.config?.customScheme?.id === schemeId) {
          widgets.push({ widget, tabId: tab.id, tabName: tab.name });
        }
      }
    }
    return widgets;
  },

  // Save a color scheme to the current dashboard
  saveColorScheme: (scheme) => {
    const { currentDashboard } = get();
    if (!currentDashboard) {
      console.warn('No dashboard loaded - cannot save color scheme');
      return null;
    }

    const existingSchemes = currentDashboard.customColorSchemes || [];
    
    // Generate UUID if new scheme
    const schemeWithId = {
      ...scheme,
      id: scheme.id || get().generateSchemeId(),
      createdAt: scheme.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Check for unique name (case-insensitive)
    const nameExists = existingSchemes.some(s => 
      s.id !== schemeWithId.id && 
      s.name.toLowerCase() === schemeWithId.name.toLowerCase()
    );
    
    if (nameExists) {
      // Append number to make unique
      let counter = 1;
      let newName = `${schemeWithId.name} (${counter})`;
      while (existingSchemes.some(s => s.name.toLowerCase() === newName.toLowerCase())) {
        counter++;
        newName = `${schemeWithId.name} (${counter})`;
      }
      schemeWithId.name = newName;
    }
    
    // Update or add
    const existingIndex = existingSchemes.findIndex(s => s.id === schemeWithId.id);
    let updated;
    if (existingIndex >= 0) {
      updated = [...existingSchemes];
      updated[existingIndex] = schemeWithId;
    } else {
      updated = [...existingSchemes, schemeWithId];
    }
    
    // Update dashboard state
    set((state) => ({
      currentDashboard: {
        ...state.currentDashboard,
        customColorSchemes: updated,
      },
      hasUnsavedChanges: true,
    }));
    
    return schemeWithId;
  },

  // Delete a color scheme from the current dashboard
  deleteColorScheme: (schemeId) => {
    const { currentDashboard, isColorSchemeInUse, getWidgetsUsingScheme } = get();
    if (!currentDashboard) return { success: false, error: 'No dashboard loaded' };
    
    // Check if scheme is in use
    if (isColorSchemeInUse(schemeId)) {
      const widgets = getWidgetsUsingScheme(schemeId);
      const widgetNames = widgets.map(w => w.widget.title || w.widget.id).join(', ');
      return { 
        success: false, 
        error: `Cannot delete: scheme is in use by widgets: ${widgetNames}`,
        widgetsInUse: widgets,
      };
    }
    
    const existingSchemes = currentDashboard.customColorSchemes || [];
    const updated = existingSchemes.filter(s => s.id !== schemeId);
    
    set((state) => ({
      currentDashboard: {
        ...state.currentDashboard,
        customColorSchemes: updated,
      },
      hasUnsavedChanges: true,
    }));
    
    return { success: true };
  },

  // Legacy: Load color schemes - now they come from dashboard
  loadColorSchemes: async () => {
    // Color schemes are now loaded with the dashboard
    // This is kept for backwards compatibility
  },

  removeSemanticModel: async (modelId) => {
    const { selectedModel } = get();
    try {
      await authFetch(`${API_BASE}/semantic/models/${modelId}`, { method: 'DELETE' });
      set((state) => ({
        semanticModels: state.semanticModels.filter(m => m.id !== modelId),
        selectedModel: selectedModel?.id === modelId ? null : selectedModel,
      }));
    } catch (error) {
      console.error('Failed to delete model:', error);
      throw error;
    }
  },

  // Dashboard actions
  loadDashboards: async () => {
    // Fetch from API with auth headers - server handles role-based filtering
    set({ isLoadingDashboards: true, dashboardLoadError: null });
    try {
      const data = await dashboardApi.list();
      // Store full dashboard records - use title as the primary display field
      const dashboards = (data.dashboards || []).map(d => ({
        ...d,
        // Ensure title is always set (fallback to name if server sends it differently)
        title: d.title || d.name,
        // Computed fields for display
        tabCount: d.tabCount || d.tabs?.length || 0,
        widgetCount: d.widgetCount || 0,
      }));
      set({ dashboards, isLoadingDashboards: false, dashboardLoadError: null });
      return dashboards;
    } catch (error) {
      console.error('Failed to load dashboards:', error);
      // Check if this is an MFA required error
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
    // Clear previous error (but preserve MFA_REQUIRED errors from loadDashboards)
    const { dashboardLoadError } = get();
    if (dashboardLoadError?.code !== 'MFA_REQUIRED') {
      set({ dashboardLoadError: null, isLoadingDashboard: true, dashboardLoadPhase: 'config' });
    } else {
      set({ isLoadingDashboard: true, dashboardLoadPhase: 'config' });
    }
    
    // Phase 1: Fetch dashboard config from database
    try {
      const data = await dashboardApi.get(id);
      let dashboard = data.dashboard;
      
      if (!dashboard) {
        console.error('Dashboard not found:', id);
        set({ dashboardLoadError: { message: 'Dashboard not found', code: 'NOT_FOUND' }, isLoadingDashboard: false, dashboardLoadPhase: null });
        return null;
      }
      
      // Fetch group access for this dashboard
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
      
      // Ensure tabs exist
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
      
      // Config loaded -- show the real title and transition to Phase 2
      set({ currentDashboard: dashboard, currentTabId: firstTabId, hasUnsavedChanges: false, dashboardLoadError: null, dashboardLoadPhase: 'connecting' });
      
      // Phase 2: Initialize Snowflake session
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
      
      // Phase 3: Ready -- widgets render and fetch their own data
      set({ isLoadingDashboard: false, dashboardLoadPhase: null });
      
      // Prefetch semantic view metadata for all widgets in the background
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

  // Local-only dashboard update - does NOT call API, use saveDashboard() to persist
  updateDashboard: (id, updates) => {
    const { currentDashboard, dashboards } = get();
    if (!currentDashboard || currentDashboard.id !== id) return;
    
    const updated = { ...currentDashboard, ...updates };
    // Also update the dashboards array so sidebar reflects the change
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

  // Widget operations are LOCAL ONLY - use saveDashboard() to persist changes
  addWidget: (dashboardId, widget) => {
    const { currentTabId, currentUser, currentRole } = get();
    const creator = currentUser || currentRole || 'unknown';
    const newWidget = { 
      ...widget, 
      id: `w-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      creator: creator,
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
    const lastUpdatedBy = currentUser || currentRole || 'unknown';
    const markDirty = !options.silent;
    set((state) => {
      const newTabs = state.currentDashboard.tabs.map(tab => {
        if (tab.id !== currentTabId) return tab;
        
        const newWidgets = tab.widgets.map(w => {
          if (w.id !== widgetId) return w;

          // Shallow-compare update keys against current widget to avoid
          // creating new references (and re-renders) when nothing changed.
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

  // Save dashboard to persist all changes (tabs, widgets, etc.)
  saveDashboard: async () => {
    const { currentDashboard, isAuthenticated } = get();
    if (!currentDashboard) return;
    
    // Must be authenticated to persist
    if (!isAuthenticated) {
      console.warn('Cannot save dashboard: not authenticated');
      set({ hasUnsavedChanges: false });
      return;
    }

    set({ isSaving: true });
    
    try {
      // Collect all semantic views referenced by widgets and merge with dashboard-level list
      const dashboardSemanticViews = [...(currentDashboard.semanticViewsReferenced || [])];
      const existingViewNames = new Set(dashboardSemanticViews.map(v => 
        typeof v === 'string' ? v : v.name
      ));
      
      // Scan all widgets in all tabs for semantic views
      (currentDashboard.tabs || []).forEach(tab => {
        (tab.widgets || []).forEach(widget => {
          (widget.semanticViewsReferenced || []).forEach(widgetView => {
            const viewName = typeof widgetView === 'string' ? widgetView : widgetView.name;
            if (!existingViewNames.has(viewName)) {
              // Add this semantic view to the dashboard-level list
              dashboardSemanticViews.push(widgetView);
              existingViewNames.add(viewName);
            }
          });
        });
      });
      
      // Build the YAML content from current dashboard state
      const yamlContent = {
        tabs: currentDashboard.tabs || [],
        filters: currentDashboard.filters || [],
        semanticViewsReferenced: dashboardSemanticViews,
        cortexAgentsEnabled: currentDashboard.cortexAgentsEnabled || false,
        cortexAgents: currentDashboard.cortexAgents || [],
        customColorSchemes: currentDashboard.customColorSchemes || [],
      };
      
      const updates = {
        name: currentDashboard.name || currentDashboard.title, // Backend expects 'name'
        description: currentDashboard.description,
        warehouse: currentDashboard.warehouse,
        role: currentDashboard.role,
        visibility: currentDashboard.visibility,
        isPublished: currentDashboard.isPublished,
        folderId: currentDashboard.folder_id,
        yamlDefinition: yamlContent, // Use camelCase to match backend
        tabs: currentDashboard.tabs, // Also send tabs directly for server-side processing
        semanticViewsReferenced: dashboardSemanticViews, // Include at top level too
        cortexAgentsEnabled: currentDashboard.cortexAgentsEnabled || false,
        cortexAgents: currentDashboard.cortexAgents || [],
        customColorSchemes: currentDashboard.customColorSchemes || [], // Custom color schemes for this dashboard
      };
      
      await dashboardApi.update(currentDashboard.id, updates);
      
      // Update group access if access list was modified
      if (currentDashboard.access && Array.isArray(currentDashboard.access)) {
        const groupIds = currentDashboard.access
          .filter(a => a.groupId) // Only include entries with groupId
          .map(a => a.groupId);
        await dashboardApi.updateGroups(currentDashboard.id, groupIds);
      }
      
      // Update local state with merged semantic views
      const updatedDashboard = { ...currentDashboard, semanticViewsReferenced: dashboardSemanticViews };
      
      // Also update the dashboards array so sidebar reflects any name changes
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

  // Discard unsaved changes and reload from server
  discardChanges: async () => {
    const { currentDashboard, loadDashboard } = get();
    if (!currentDashboard) return;
    
    set({ hasUnsavedChanges: false });
    await loadDashboard(currentDashboard.id);
  },

  // Save dashboard settings directly to database (used by Dashboard Settings modal)
  // This updates local state AND persists to database immediately
  saveDashboardSettings: async (settings) => {
    const { currentDashboard, dashboards, isAuthenticated } = get();
    if (!currentDashboard) return;
    
    // Update local state first
    const updatedDashboard = { 
      ...currentDashboard, 
      ...settings,
      // Map name to title for consistency
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
    
    // If not authenticated, just update local state
    if (!isAuthenticated) {
      set({ isSaving: false });
      return updatedDashboard;
    }
    
    try {
      // Build the full update payload including YAML content
      const yamlContent = {
        tabs: updatedDashboard.tabs || [],
        filters: updatedDashboard.filters || [],
        semanticViewsReferenced: settings.semanticViewsReferenced || updatedDashboard.semanticViewsReferenced || [],
        cortexAgentsEnabled: settings.cortexAgentsEnabled ?? updatedDashboard.cortexAgentsEnabled ?? false,
        cortexAgents: settings.cortexAgents || updatedDashboard.cortexAgents || [],
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
        semanticViewsReferenced: settings.semanticViewsReferenced || updatedDashboard.semanticViewsReferenced,
        cortexAgentsEnabled: settings.cortexAgentsEnabled ?? updatedDashboard.cortexAgentsEnabled ?? false,
        cortexAgents: settings.cortexAgents || updatedDashboard.cortexAgents || [],
        customColorSchemes: settings.customColorSchemes || updatedDashboard.customColorSchemes || [],
      };
      
      await dashboardApi.update(currentDashboard.id, updatePayload);
      
      // Note: Group access updates require separate API calls to /dashboard/:id/access endpoints
      // TODO: Add API endpoints for managing dashboard group access
      
      // Clear unsaved changes since we just saved everything
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
      return; // Don't allow removing the last tab
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

  // Execute query from semantic model
  executeModelQuery: async (modelId, dimensions, measures, filters, orderBy, limit) => {
    const { connectionId, semanticModels } = get();
    const model = semanticModels.find((m) => m.id === modelId);
    if (!connectionId || !model) return;

    try {
      const data = await queryApi.build(modelId, {
        connectionId,
        model,
        dimensions,
        measures,
        filters,
        orderBy,
        limit,
      });
      return data;
    } catch (error) {
      console.error('Query execution failed:', error);
      throw error;
    }
  },

  // ========== YAML IMPORT/EXPORT ACTIONS ==========

  // Get color palettes from cache
  getColorPalettes: () => {
    const { colorPalettes } = get();
    return colorPalettes || { palettes: {}, default: 'ocean' };
  },

  // Export dashboard to YAML (via server API)
  exportDashboardToYaml: async (dashboardId) => {
    const { currentDashboard } = get();
    const id = dashboardId || currentDashboard?.id;
    
    if (!id) return null;
    
    try {
      return await dashboardApi.exportYaml(id);
    } catch (error) {
      console.error('Export failed:', error);
      return null;
    }
  },

  // Export semantic model to YAML
  exportModelToYaml: (modelId) => {
    const { semanticModels } = get();
    const model = semanticModels.find(m => m.id === modelId);
    
    if (!model) return null;
    
    // Generate YAML client-side
    return import('js-yaml').then(yaml => yaml.dump({
      id: model.id,
      name: model.name,
      description: model.description || '',
      source: model.source,
      dimensions: model.dimensions || [],
      measures: model.measures || [],
      joins: model.joins || [],
      calculated_fields: model.calculated_fields || [],
    }, { indent: 2, lineWidth: 120, noRefs: true }));
  },

  // Import dashboard from YAML string
  // Accepts the unified schema: { dashboard: { title, tabs, filters, semanticViewsReferenced, ... } }
  importDashboardFromYaml: async (yamlString) => {
    try {
      const yaml = await import('js-yaml');
      const parsed = yaml.load(yamlString);
      
      if (!parsed) throw new Error('Empty or invalid YAML');

      // Support both wrapper formats: { dashboard: {...} } or flat
      const db = parsed.dashboard || parsed;
      const name = db.title || db.name;
      if (!name) throw new Error('Invalid dashboard YAML — title or name is required');

      // Resolve customColumnIds → customColumns on each widget using dashboard-level definitions
      const calcFieldsById = new Map();
      (db.semanticViewsReferenced || []).forEach(sv => {
        (sv.calculatedFields || []).forEach(cf => {
          if (cf.id) calcFieldsById.set(cf.id, cf);
        });
      });

      const tabs = (db.tabs || []).map(tab => ({
        ...tab,
        backgroundColor: tab.tabColor || tab.backgroundColor || null,
        widgets: (tab.widgets || []).map(w => ({
          ...w,
          customColumns: (w.customColumnIds || [])
            .map(id => calcFieldsById.get(id))
            .filter(Boolean),
        })),
      }));

      const dashboard = {
        id: db.id || `dashboard-${Date.now()}`,
        name,
        title: name,
        description: db.description || '',
        warehouse: db.warehouse || null,
        isPublished: db.isPublished || false,
        tabs,
        filters: db.filters || [],
        semanticViewsReferenced: db.semanticViewsReferenced || [],
        cortexAgentsEnabled: db.cortexAgentsEnabled || false,
        cortexAgents: db.cortexAgents || [],
        customColorSchemes: db.customColorSchemes || [],
      };
      
      set((state) => ({
        dashboards: [...state.dashboards, { 
          id: dashboard.id, 
          name: dashboard.name, 
          tabCount: dashboard.tabs.length,
        }],
        currentDashboard: dashboard,
        currentTabId: dashboard.tabs[0]?.id,
      }));
      
      return dashboard;
    } catch (error) {
      console.error('Failed to import dashboard from YAML:', error);
      throw error;
    }
  },

  // Import semantic model from YAML string
  importModelFromYaml: async (yamlString) => {
    try {
      const yaml = await import('js-yaml');
      const parsed = yaml.load(yamlString);
      
      if (!parsed || !parsed.name) {
        throw new Error('Invalid model YAML');
      }

      const model = {
        id: `model-${Date.now()}`,
        name: parsed.name,
        description: parsed.description,
        source: parsed.source,
        dimensions: parsed.dimensions || [],
        measures: parsed.measures || [],
        joins: parsed.joins || [],
        calculated_fields: parsed.calculated_fields || [],
      };
      
      set((state) => ({
        semanticModels: [...state.semanticModels, model],
      }));
      
      return model;
    } catch (error) {
      console.error('Failed to import model from YAML:', error);
      throw error;
    }
  },

  // Validate YAML before import — uses the unified schema
  validateDashboardYaml: async (yamlString) => {
    try {
      const yaml = await import('js-yaml');
      const parsed = yaml.load(yamlString);
      const errors = [];

      const db = parsed?.dashboard || parsed;
      if (!db?.title && !db?.name) errors.push('Dashboard title or name is required');

      const tabs = db?.tabs || [];
      tabs.forEach((tab, ti) => {
        (tab.widgets || []).forEach((widget, wi) => {
          if (!widget.type) errors.push(`Tab ${ti + 1}, Widget ${wi + 1}: type is required`);
        });
      });

      return { valid: errors.length === 0, errors };
    } catch (error) {
      return { valid: false, errors: [error.message] };
    }
  },

  validateModelYaml: async (yamlString) => {
    try {
      const yaml = await import('js-yaml');
      const config = yaml.load(yamlString);
      const errors = [];

      if (!config.name) errors.push('Model name is required');
      if (!config.source) errors.push('Source configuration is required');

      (config.dimensions || []).forEach((dim, index) => {
        if (!dim.name) errors.push(`Dimension ${index + 1}: name is required`);
        if (!dim.sql) errors.push(`Dimension ${index + 1}: sql is required`);
      });

      (config.measures || []).forEach((measure, index) => {
        if (!measure.name) errors.push(`Measure ${index + 1}: name is required`);
        if (!measure.sql) errors.push(`Measure ${index + 1}: sql is required`);
      });

      return { valid: errors.length === 0, errors };
    } catch (error) {
      return { valid: false, errors: [error.message] };
    }
  },
}));
