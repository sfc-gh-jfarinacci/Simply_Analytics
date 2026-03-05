import React, { useEffect, useState, useMemo } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from './store/appStore';
import Sidebar from './components/Sidebar';
import SemanticModels from './components/SemanticModels';
import DashboardBrowser from './components/DashboardBrowser';
import DashboardView from './components/DashboardView';
import GettingStarted from './components/GettingStarted';
import UsersManagement from './components/UsersManagement';
import UserSettings from './components/UserSettings';
import SignInModal from './components/SignInModal';
import SessionWarning from './components/SessionWarning';
import { startSessionMonitoring, stopSessionMonitoring } from './api/apiClient';
import './styles/App.css';

// Hook to detect if we're in dashboard focus mode (viewing a specific dashboard)
function useDashboardFocusMode() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  
  return useMemo(() => {
    const isDashboardRoute = location.pathname === '/dashboards';
    const hasDashboardId = searchParams.has('id');
    return isDashboardRoute && hasDashboardId;
  }, [location.pathname, searchParams]);
}

// Wrapper component that shows browser or view based on URL params
function DashboardsPage() {
  const [searchParams] = useSearchParams();
  const dashboardId = searchParams.get('id');
  
  // If a dashboard ID is in the URL, show the dashboard view
  // Otherwise, show the browser
  if (dashboardId) {
    return <DashboardView />;
  }
  
  return <DashboardBrowser />;
}

// Map routes to activeView values for store sync
const routeToView = {
  '/': 'home',
  '/home': 'home',
  '/explorer': 'explorer',
  '/models': 'models',
  '/dashboards': 'dashboards',
  '/users': 'users',
  '/settings': 'settings',
};

// Protected route wrapper - defined OUTSIDE App to prevent remounting children on re-render
function ProtectedRoute({ children, requiredRoles = null }) {
  const { isAuthenticated, isInitialized, currentRole } = useAppStore();
  
  // Wait for app to initialize before checking auth
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
    return <Navigate to="/dashboards" replace />;
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
  } = useAppStore();

  const navigate = useNavigate();
  const location = useLocation();
  const isDashboardFocusMode = useDashboardFocusMode();
  
  const [showSignIn, setShowSignIn] = useState(false);
  const [showSessionWarning, setShowSessionWarning] = useState(false);
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState(0);
  const [sessionEndReason, setSessionEndReason] = useState(null);

  // Initialize app and theme on mount
  useEffect(() => {
    initializeApp();
    // Apply saved theme on load (default to light)
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  // Sync store activeView with current route on mount/route change
  useEffect(() => {
    const pathBase = '/' + location.pathname.split('/')[1]; // Get first path segment
    const viewFromRoute = routeToView[pathBase] || routeToView[location.pathname];
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
          setShowSessionWarning(true);
        },
        (reason) => {
          // Session expired or server restarted
          setShowSessionWarning(false);
          setSessionEndReason(reason || 'expired');
          signOut();
        }
      );
      // Clear any previous session end reason
      setSessionEndReason(null);
    } else {
      stopSessionMonitoring();
      setShowSessionWarning(false);
    }

    return () => stopSessionMonitoring();
  }, [isAuthenticated]);

  const handleKeepAlive = () => {
    setShowSessionWarning(false);
  };

  const handleSessionSignOut = () => {
    setShowSessionWarning(false);
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


  // Home route - redirect to dashboards if authenticated
  const HomeRoute = () => {
    if (!isInitialized) {
      return (
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
      );
    }
    if (isAuthenticated) {
      return <Navigate to="/dashboards" replace />;
    }
    return <GettingStarted onSignIn={() => setShowSignIn(true)} />;
  };

  return (
    <div className={`app ${isDashboardFocusMode ? 'dashboard-focus-mode' : ''}`}>
      {!isDashboardFocusMode && <Sidebar onSignIn={() => setShowSignIn(true)} />}
      <main className={`main-content ${isDashboardFocusMode ? 'full-width' : ''}`}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/home" element={<HomeRoute />} />
          <Route 
            path="/dashboards" 
            element={
              <ProtectedRoute>
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
        onClose={() => setShowSignIn(false)} 
      />

      {/* Session Warning */}
      {showSessionWarning && (
        <SessionWarning
          timeRemaining={sessionTimeRemaining}
          onKeepAlive={handleKeepAlive}
          onSignOut={handleSessionSignOut}
        />
      )}
    </div>
  );
}

export default App;
