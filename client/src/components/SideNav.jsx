import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import {
  FiHelpCircle,
  FiChevronLeft,
  FiChevronRight,
  FiUser,
  FiLogOut,
  FiLogIn,
  FiHome,
  FiUsers,
  FiSettings,
  FiSun,
  FiMoon,
  FiShield,
  FiChevronDown,
  FiLayers,
  FiPlus,
  FiBarChart2,
} from 'react-icons/fi';
import SimplyLogo from '../assets/Simply_Logo.png';
import '../styles/SideNav.css';

const MIN_WIDTH = 60;
const MAX_WIDTH = 280;
const COLLAPSED_WIDTH = 60;

// Map view IDs to routes
const viewToRoute = {
  home: '/',
  workspaces: '/workspaces',
  users: '/users',
  admin: '/admin',
  consumption: '/consumption',
  settings: '/settings',
  models: '/models',
};

const SideNav = ({ onSignIn }) => {
  const { 
    activeView, 
    currentUser,
    currentRole,
    signOut,
    isAuthenticated,
    theme,
    toggleTheme,
    emergencyMode,
    workspaces,
    activeWorkspace,
    switchWorkspace,
  } = useAppStore();
  
  const navigate = useNavigate();
  const location = useLocation();
  
  const [width, setWidth] = useState(220);
  const [isResizing, setIsResizing] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const sidebarRef = useRef(null);
  const userMenuRef = useRef(null);
  const wsMenuRef = useRef(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const isCollapsed = width <= COLLAPSED_WIDTH + 10;
  
  // Navigate to a view using the router
  const navigateTo = (viewId) => {
    if (viewId === 'workspaces' && activeWorkspace?.id) {
      navigate(`/workspaces/${activeWorkspace.id}`);
      return;
    }
    const route = viewToRoute[viewId] || '/';
    navigate(route);
  };
  
  // Check if a nav item is active based on current path
  const isNavActive = (viewId) => {
    if (viewId === 'workspaces') {
      return location.pathname.startsWith('/workspaces');
    }
    const route = viewToRoute[viewId];
    if (route === '/') {
      return location.pathname === '/' || location.pathname === '/home';
    }
    return location.pathname.startsWith(route);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target)) {
        setWsMenuOpen(false);
      }
    };
    if (userMenuOpen || wsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen, wsMenuOpen]);

  // Build nav items based on authentication and user role
  const navItems = [];
  
  if (!isAuthenticated) {
    navItems.push({ id: 'home', icon: FiHome, label: 'Home' });
  } else if (currentRole === 'bootstrap_admin' || emergencyMode) {
    // Bootstrap admin during provisioning or emergency mode — only Admin tab
    navItems.push({ id: 'admin', icon: FiShield, label: 'Admin' });
  } else {
    navItems.push({ id: 'workspaces', icon: FiLayers, label: 'Workspaces' });

    if (['owner', 'admin'].includes(currentRole)) {
      navItems.push({ id: 'users', icon: FiUsers, label: 'Users' });
      navItems.push({ id: 'consumption', icon: FiBarChart2, label: 'Consumption' });
    }

    if (currentRole === 'owner') {
      navItems.push({ id: 'admin', icon: FiShield, label: 'Admin' });
    }
  }

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return;
    const delta = e.clientX - startXRef.current;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + delta));
    setWidth(newWidth);
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    // Snap to collapsed or expanded
    if (width < 100) {
      setWidth(COLLAPSED_WIDTH);
    } else if (width < 160) {
      setWidth(180);
    }
  }, [width]);

  const toggleCollapse = () => {
    setWidth(isCollapsed ? 220 : COLLAPSED_WIDTH);
  };

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <aside 
      ref={sidebarRef}
      className={`sidebar ${isCollapsed ? 'collapsed' : 'open'} ${isResizing ? 'resizing' : ''}`}
      style={{ width: `${width}px` }}
    >
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="logo-icon">
            <img src={SimplyLogo} alt="Simply" className="logo-image" />
          </div>
          {!isCollapsed && (
            <div className="logo-text-container">
              <span className="logo-text">Simply Analytics</span>
              <span className="logo-subtitle">Unified Semantic Portal</span>
            </div>
          )}
        </div>
      </div>

      {isAuthenticated && currentRole !== 'bootstrap_admin' && !emergencyMode && workspaces.length > 0 && (
        <div className="workspace-switcher" ref={wsMenuRef}>
          <button
            className={`workspace-switcher-btn ${wsMenuOpen ? 'active' : ''}`}
            onClick={() => setWsMenuOpen(!wsMenuOpen)}
            title={isCollapsed ? (activeWorkspace?.name || 'Select workspace') : undefined}
          >
            <FiLayers className="ws-icon" />
            {!isCollapsed && (
              <>
                <span className="ws-name">{activeWorkspace?.name || 'Select workspace'}</span>
                <FiChevronDown className={`ws-chevron ${wsMenuOpen ? 'open' : ''}`} />
              </>
            )}
          </button>
          {wsMenuOpen && (
            <div className={`workspace-menu ${isCollapsed ? 'collapsed-mode' : ''}`}>
              <div className="workspace-menu-header">Workspaces</div>
              {workspaces.map(ws => (
                <button
                  key={ws.id}
                  className={`workspace-menu-item ${activeWorkspace?.id === ws.id ? 'active' : ''}`}
                  onClick={() => {
                    switchWorkspace(ws);
                    setWsMenuOpen(false);
                    if (location.pathname.startsWith('/workspaces')) {
                      navigate(`/workspaces/${ws.id}`);
                    }
                  }}
                >
                  <span className="ws-item-name">{ws.name}</span>
                  {ws.member_count != null && (
                    <span className="ws-item-count">{ws.member_count}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <nav className="sidebar-nav">
        {navItems.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`nav-item ${isNavActive(id) ? 'active' : ''}`}
            onClick={() => navigateTo(id)}
            title={isCollapsed ? label : undefined}
          >
            <Icon className="nav-icon" />
            {!isCollapsed && (
              <>
                <span className="nav-label">{label}</span>
                {id === 'workspaces' && ['owner', 'admin'].includes(currentRole) && (
                  <span
                    className="nav-add-btn"
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('/workspaces?create=1');
                    }}
                    title="New Workspace"
                  >
                    <FiPlus />
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {!isCollapsed && activeWorkspace && (
          <div className="sidebar-info">
            <p>{activeWorkspace.connection_count > 0 ? `${activeWorkspace.connection_count} connection${activeWorkspace.connection_count != 1 ? 's' : ''}` : 'No connections'}</p>
          </div>
        )}
        <button className="nav-item help-btn" title={isCollapsed ? 'Help' : undefined}>
          <FiHelpCircle className="nav-icon" />
          {!isCollapsed && <span className="nav-label">Help</span>}
        </button>
        
        {/* User Menu / Sign In */}
        {isAuthenticated ? (
          <div className="user-menu-container" ref={userMenuRef}>
            <button 
              className={`nav-item user-btn ${userMenuOpen ? 'active' : ''}`}
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              title={isCollapsed ? `${currentUser?.username} (${currentRole})` : undefined}
            >
              <FiUser className="nav-icon" />
              {!isCollapsed && (
                <div className="user-info">
                  <span className="user-name">{currentUser?.displayName || currentUser?.display_name || currentUser?.username || 'User'}</span>
                  <span className="user-role">{currentRole}</span>
                </div>
              )}
            </button>
            
            {userMenuOpen && (
              <div className={`user-menu-popup ${isCollapsed ? 'collapsed-mode' : ''}`}>
                <div className="user-menu-section">
                  <div className="user-menu-header">
                    {currentUser?.username}
                  </div>
                  <div className="user-menu-role">
                    Role: <strong>{currentRole}</strong>
                  </div>
                </div>
                
                <div className="user-menu-divider" />
                
                <button 
                  className="user-menu-item"
                  onClick={() => {
                    navigate('/settings');
                    setUserMenuOpen(false);
                  }}
                >
                  <FiSettings className="menu-icon" />
                  <span>Settings</span>
                </button>
                
                <button 
                  className="user-menu-item"
                  onClick={() => {
                    toggleTheme();
                  }}
                >
                  {theme === 'dark' ? <FiSun className="menu-icon" /> : <FiMoon className="menu-icon" />}
                  <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                </button>
                
                <div className="user-menu-divider" />
                
                <button 
                  className="user-menu-item sign-out"
                  onClick={() => {
                    signOut();
                    setUserMenuOpen(false);
                  }}
                >
                  <FiLogOut className="sign-out-icon" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button 
            className="nav-item sign-in-btn"
            onClick={onSignIn}
            title={isCollapsed ? 'Sign In to Snowflake' : undefined}
          >
            <FiLogIn className="nav-icon" />
            {!isCollapsed && <span className="nav-label">Sign In</span>}
          </button>
        )}
      </div>

      {/* Resize Handle */}
      <div 
        className="sidebar-resize-handle"
        onMouseDown={handleMouseDown}
      >
        <button 
          className="resize-toggle"
          onClick={toggleCollapse}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <FiChevronRight /> : <FiChevronLeft />}
        </button>
      </div>

    </aside>
  );
};

export default SideNav;
