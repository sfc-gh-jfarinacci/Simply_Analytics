import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, useSearchParams, useParams } from 'react-router-dom';
import { useAppStore } from './store/appStore';
import SideNav from './components/SideNav';

import DashboardBrowser from './views/DashboardBrowser';
import DashboardView from './views/DashboardView';
import GettingStarted from './views/GettingStarted';
import UsersManagement from './views/UsersManagement';
import UserSettings from './views/UserSettings';
import AskView from './views/AskView';
import AdminPanel from './views/AdminPanel';
import WorkspacesView from './views/WorkspacesView';
import ConsumptionView from './views/ConsumptionView';
import SignInModal from './components/SignInModal';
import SessionWarningModal from './components/SessionWarningModal';
import { startSessionMonitoring, stopSessionMonitoring, persistSession } from './api/apiClient';
import './styles/App.css';

// Hook to detect if we're in dashboard focus mode (viewing a specific dashboard)
function useDashboardFocusMode() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  
  return useMemo(() => {
    const isDashboardRoute = /^\/workspaces\/[^/]+\/dashboards$/.test(location.pathname);
    const hasDashboardId = searchParams.has('id');
    return isDashboardRoute && hasDashboardId;
  }, [location.pathname, searchParams]);
}

// Wrapper component that shows browser or view based on URL params
// Also syncs workspace from URL param to store
function DashboardsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const { activeWorkspace, workspaces, switchWorkspace, isLoadingWorkspaces } = useAppStore();

  useEffect(() => {
    if (!workspaceId || isLoadingWorkspaces) return;
    if (activeWorkspace?.id === workspaceId) return;
    const match = workspaces.find(w => w.id === workspaceId);
    if (match) {
      switchWorkspace(match);
    } else if (workspaces.length > 0) {
      navigate('/workspaces', { replace: true });
    }
  }, [workspaceId, activeWorkspace?.id, workspaces, switchWorkspace, isLoadingWorkspaces, navigate]);

  const dashboardId = searchParams.get('id');
  if (dashboardId) return <DashboardView />;
  return <DashboardBrowser />;
}

// Wrapper for WorkspacesView that syncs workspace from URL param
function WorkspacesPage() {
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const { activeWorkspace, workspaces, switchWorkspace, isLoadingWorkspaces } = useAppStore();

  useEffect(() => {
    if (!workspaceId || isLoadingWorkspaces) return;
    if (activeWorkspace?.id === workspaceId) return;
    const match = workspaces.find(w => w.id === workspaceId);
    if (match) {
      switchWorkspace(match);
    } else if (workspaces.length > 0) {
      navigate('/workspaces', { replace: true });
    }
  }, [workspaceId, activeWorkspace?.id, workspaces, switchWorkspace, isLoadingWorkspaces, navigate]);

  return <WorkspacesView />;
}

// Wrapper for AskView that syncs workspace from URL param
function AskPage() {
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const { activeWorkspace, workspaces, switchWorkspace, isLoadingWorkspaces } = useAppStore();

  useEffect(() => {
    if (!workspaceId || isLoadingWorkspaces) return;
    if (activeWorkspace?.id === workspaceId) return;
    const match = workspaces.find(w => w.id === workspaceId);
    if (match) {
      switchWorkspace(match);
    } else if (workspaces.length > 0) {
      navigate('/workspaces', { replace: true });
    }
  }, [workspaceId, activeWorkspace?.id, workspaces, switchWorkspace, isLoadingWorkspaces, navigate]);

  return <AskView />;
}

// Map routes to activeView values for store sync
const routeToView = {
  '/': 'home',
  '/home': 'home',
  '/models': 'models',
  '/workspaces': 'workspaces',
  '/users': 'users',
  '/settings': 'settings',
  '/admin': 'admin',
  '/consumption': 'consumption',
};

// Protected route wrapper - defined OUTSIDE App to prevent remounting children on re-render
function ProtectedRoute({ children, requiredRoles = null, requireAskAccess = false, requireSecureAuth = false }) {
  const { isAuthenticated, isInitialized, currentRole, askHasAccess, currentUser } = useAppStore();
  
  if (!isInitialized) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  if (requiredRoles && !requiredRoles.includes(currentRole)) {
    return <Navigate to="/workspaces" replace />;
  }
  if (requireSecureAuth) {
    const hasSecureAuth = currentUser?.auth_provider === 'saml' ||
      currentUser?.totp_enabled || currentUser?.passkey_enabled;
    if (!hasSecureAuth) {
      return <Navigate to="/workspaces" replace />;
    }
  }
  if (requireAskAccess && askHasAccess === false) {
    return <Navigate to="/workspaces" replace />;
  }
  return children;
}

function App() {
  const { 
    activeView,
    setActiveView,
    initializeApp, 
    isAuthenticated,
    isInitialized,
    signOut,
    currentRole,
    emergencyMode,
  } = useAppStore();

  const navigate = useNavigate();
  const location = useLocation();
  const isDashboardFocusMode = useDashboardFocusMode();
  
  const [showSignIn, setShowSignIn] = useState(false);
  const [showSessionWarningModal, setShowSessionWarningModal] = useState(false);
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState(0);
  const [sessionEndReason, setSessionEndReason] = useState(null);

  const openSignIn = useCallback(() => setShowSignIn(true), []);
  const closeSignIn = useCallback(() => setShowSignIn(false), []);

  const isLandingPage = !isAuthenticated && (location.pathname === '/' || location.pathname === '/home');
  const showSideNav = !isDashboardFocusMode && !isLandingPage;

  // Initialize app and theme on mount
  useEffect(() => {
    // Handle SSO callback token from URL
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('token');
    if (ssoToken) {
      try {
        const payload = JSON.parse(atob(ssoToken.split('.')[1]));
        const user = {
          id: payload.userId,
          username: payload.username,
          email: payload.email,
          role: payload.role,
          auth_provider: 'saml',
        };
        persistSession(user, ssoToken);
        window.history.replaceState({}, '', window.location.pathname);
      } catch (err) {
        console.error('Failed to process SSO token:', err);
      }
    }

    initializeApp();
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  // Sync store activeView with current route on mount/route change
  useEffect(() => {
    const pathBase = '/' + location.pathname.split('/')[1];
    let viewFromRoute = routeToView[pathBase] || routeToView[location.pathname];
    if (!viewFromRoute && pathBase === '/workspaces') viewFromRoute = 'workspaces';
    if (viewFromRoute && viewFromRoute !== activeView) {
      setActiveView(viewFromRoute);
    }
  }, [location.pathname]);

  // Start session monitoring when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      startSessionMonitoring(
        (timeRemaining) => {
          setSessionTimeRemaining(timeRemaining);
          setShowSessionWarningModal(true);
        },
        (reason) => {
          // Session expired or server restarted
          setShowSessionWarningModal(false);
          setSessionEndReason(reason || 'expired');
          signOut();
        }
      );
      // Clear any previous session end reason
      setSessionEndReason(null);
    } else {
      stopSessionMonitoring();
      setShowSessionWarningModal(false);
    }

    return () => stopSessionMonitoring();
  }, [isAuthenticated]);

  const handleKeepAlive = () => {
    setShowSessionWarningModal(false);
  };

  const handleSessionSignOut = () => {
    setShowSessionWarningModal(false);
    signOut();
  };

  // Auto-clear session end notification after 10 seconds
  useEffect(() => {
    if (sessionEndReason) {
      const timer = setTimeout(() => {
        setSessionEndReason(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [sessionEndReason]);


  const homeElement = useMemo(() => {
    if (!isInitialized) {
      return (
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
      );
    }
    if (isAuthenticated) {
      return <Navigate to="/workspaces" replace />;
    }
    return <GettingStarted onSignIn={openSignIn} />;
  }, [isInitialized, isAuthenticated, openSignIn]);

  // Bootstrap admin or emergency mode — redirect to /admin after login
  useEffect(() => {
    if (isAuthenticated && (currentRole === 'bootstrap_admin' || emergencyMode) && location.pathname !== '/admin') {
      navigate('/admin', { replace: true });
    }
  }, [isAuthenticated, currentRole, emergencyMode, location.pathname]);

  return (
    <div className={`app ${isDashboardFocusMode ? 'dashboard-focus-mode' : ''}`}>
      {showSideNav && <SideNav onSignIn={openSignIn} />}
      <main className={`main-content ${isDashboardFocusMode || isLandingPage ? 'full-width' : ''}`}>
        <Routes>
          <Route path="/" element={homeElement} />
          <Route path="/home" element={homeElement} />
          <Route 
            path="/workspaces" 
            element={
              <ProtectedRoute>
                <WorkspacesView />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/workspaces/:workspaceId" 
            element={
              <ProtectedRoute>
                <WorkspacesPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/workspaces/:workspaceId/dashboards" 
            element={
              <ProtectedRoute requireSecureAuth>
                <DashboardsPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/users" 
            element={
              <ProtectedRoute requiredRoles={['owner', 'admin']}>
                <UsersManagement />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute>
                <UserSettings />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/workspaces/:workspaceId/ask" 
            element={
              <ProtectedRoute requireAskAccess requireSecureAuth>
                <AskPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin" 
            element={
              <ProtectedRoute requiredRoles={['owner', 'bootstrap_admin']}>
                <AdminPanel />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/consumption" 
            element={
              <ProtectedRoute requiredRoles={['owner', 'admin']}>
                <ConsumptionView />
              </ProtectedRoute>
            } 
          />
          {/* Fallback route */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Server Restart / Session End Notification */}
      {sessionEndReason && !isAuthenticated && (
        <div className={`session-notification ${sessionEndReason === 'server_restarted' ? 'server-restarted' : sessionEndReason === 'revoked' ? 'session-revoked' : ''}`}>
          <div className="notification-content">
            <span className="notification-icon">
              {sessionEndReason === 'server_restarted' ? '🔄' : sessionEndReason === 'revoked' ? '🔒' : '⏱️'}
            </span>
            <span className="notification-message">
              {sessionEndReason === 'server_restarted' 
                ? 'Connection to server was lost. Please sign in again.'
                : sessionEndReason === 'revoked'
                ? 'You were signed out because you signed in from another location.'
                : 'Your session has expired. Please sign in again.'}
            </span>
            <button 
              className="notification-close"
              onClick={() => setSessionEndReason(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Sign In Modal */}
      <SignInModal 
        isOpen={showSignIn} 
        onClose={closeSignIn} 
      />

      {/* Session Warning */}
      {showSessionWarningModal && (
        <SessionWarningModal
          timeRemaining={sessionTimeRemaining}
          onKeepAlive={handleKeepAlive}
          onSignOut={handleSessionSignOut}
        />
      )}
    </div>
  );
}

export default App;
