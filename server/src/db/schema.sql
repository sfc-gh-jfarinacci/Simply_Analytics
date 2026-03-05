-- Simply Analytics Database Schema
-- PostgreSQL database for users, connections, dashboards, and groups

-- Note: Using gen_random_uuid() which is built-in to PostgreSQL 13+
-- No extension needed!

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

-- User roles/privileges enum
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'creator', 'viewer');

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  role user_role NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN DEFAULT true,
  theme_preference VARCHAR(20) DEFAULT 'light', -- 'light' or 'dark'
  active_session_id VARCHAR(255), -- Current active session (for single-session enforcement)
  session_expires_at TIMESTAMP WITH TIME ZONE, -- When the current session expires
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES users(id),
  
  -- Constraints
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Create index on username and email for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================
-- SNOWFLAKE CONNECTIONS
-- ============================================

-- Connection authentication type enum
CREATE TYPE connection_auth_type AS ENUM ('pat', 'keypair');

-- Snowflake connections table
CREATE TABLE IF NOT EXISTS snowflake_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Snowflake connection details
  account VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  auth_type connection_auth_type NOT NULL,
  
  -- Encrypted credentials (encrypted at rest)
  credentials_encrypted TEXT NOT NULL,
  
  -- Default warehouse (optional)
  default_warehouse VARCHAR(255),
  default_role VARCHAR(255),
  
  -- Connection status
  is_valid BOOLEAN DEFAULT true,
  last_tested TIMESTAMP WITH TIME ZONE,
  last_test_error TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Each user can have multiple connections with unique names
  CONSTRAINT unique_connection_name_per_user UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_connections_user ON snowflake_connections(user_id);

-- ============================================
-- USER GROUPS
-- ============================================

-- User groups for dashboard sharing
CREATE TABLE IF NOT EXISTS user_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Group membership
CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_group_member UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

-- ============================================
-- DASHBOARD FOLDERS
-- ============================================

-- Folders for organizing dashboards (like Tableau)
CREATE TABLE IF NOT EXISTS dashboard_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES dashboard_folders(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  
  -- Visibility (folders can be private or public)
  is_public BOOLEAN DEFAULT false,
  
  -- Icon/color for folder (optional)
  icon VARCHAR(50) DEFAULT 'folder',
  color VARCHAR(7) DEFAULT '#6366f1',
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Unique folder name per parent (or root)
  CONSTRAINT unique_folder_name_per_parent UNIQUE (parent_id, name, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON dashboard_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON dashboard_folders(owner_id);

-- Folder group access (for sharing folders with groups)
CREATE TABLE IF NOT EXISTS folder_group_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES dashboard_folders(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_folder_group UNIQUE (folder_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_access_folder ON folder_group_access(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_access_group ON folder_group_access(group_id);

-- ============================================
-- DASHBOARDS
-- ============================================

-- Dashboard visibility enum
CREATE TYPE dashboard_visibility AS ENUM ('private', 'public');

-- Dashboards table
CREATE TABLE IF NOT EXISTS dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Owner and connection
  owner_id UUID NOT NULL REFERENCES users(id),
  connection_id UUID NOT NULL REFERENCES snowflake_connections(id),
  
  -- Folder organization (null = root level)
  folder_id UUID REFERENCES dashboard_folders(id) ON DELETE SET NULL,
  
  -- Snowflake context
  warehouse VARCHAR(255) NOT NULL,
  role VARCHAR(255) NOT NULL,
  
  -- Dashboard configuration (YAML)
  yaml_definition TEXT,
  
  -- Visibility and sharing
  visibility dashboard_visibility DEFAULT 'private',
  is_published BOOLEAN DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_dashboard_name_per_owner UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON dashboards(owner_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_connection ON dashboards(connection_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_visibility ON dashboards(visibility);

-- Dashboard group access (for private dashboards)
CREATE TABLE IF NOT EXISTS dashboard_group_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_dashboard_group UNIQUE (dashboard_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_access_dashboard ON dashboard_group_access(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_access_group ON dashboard_group_access(group_id);

-- Dashboard individual user access (optional override)
CREATE TABLE IF NOT EXISTS dashboard_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level VARCHAR(50) DEFAULT 'view', -- 'view', 'edit', 'admin'
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_dashboard_user UNIQUE (dashboard_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_user_access_dashboard ON dashboard_user_access(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_user_access_user ON dashboard_user_access(user_id);

-- ============================================
-- AUDIT LOG
-- ============================================

-- Audit log for tracking important actions
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50), -- 'user', 'dashboard', 'connection', 'group'
  entity_id UUID,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to relevant tables
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_connections_updated_at ON snowflake_connections;
CREATE TRIGGER update_connections_updated_at
  BEFORE UPDATE ON snowflake_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_groups_updated_at ON user_groups;
CREATE TRIGGER update_groups_updated_at
  BEFORE UPDATE ON user_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_dashboards_updated_at ON dashboards;
CREATE TRIGGER update_dashboards_updated_at
  BEFORE UPDATE ON dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_folders_updated_at ON dashboard_folders;
CREATE TRIGGER update_folders_updated_at
  BEFORE UPDATE ON dashboard_folders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INITIAL DATA
-- ============================================

-- NOTE: Admin user is created by the migration script with a properly hashed password.
-- The migration script (migrate-postgres.js) handles admin user creation using bcrypt.
