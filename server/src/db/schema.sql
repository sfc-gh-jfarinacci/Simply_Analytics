-- Simply Analytics Database Schema
-- PostgreSQL database for users, connections, workspaces, dashboards

-- Note: Using gen_random_uuid() which is built-in to PostgreSQL 13+
-- No extension needed!

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

-- User roles/privileges enum
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'developer', 'viewer');

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  display_name VARCHAR(255),
  role user_role NOT NULL DEFAULT 'viewer',
  auth_provider VARCHAR(20) NOT NULL DEFAULT 'local',
  external_id VARCHAR(255),
  scim_managed BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  theme_preference VARCHAR(20) DEFAULT 'light',
  active_session_id VARCHAR(255),
  session_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES users(id),
  
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================
-- SNOWFLAKE CONNECTIONS
-- ============================================

CREATE TYPE connection_auth_type AS ENUM ('pat', 'keypair');

CREATE TABLE IF NOT EXISTS snowflake_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  account VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  auth_type connection_auth_type NOT NULL,
  
  credentials_encrypted TEXT NOT NULL,
  
  default_warehouse VARCHAR(255),
  default_role VARCHAR(255),
  
  is_valid BOOLEAN DEFAULT true,
  last_tested TIMESTAMP WITH TIME ZONE,
  last_test_error TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
);

CREATE INDEX IF NOT EXISTS idx_connections_user ON snowflake_connections(user_id);

-- ============================================
-- WORKSPACES
-- ============================================

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspaces_created_by ON workspaces(created_by);

-- Add default workspace reference to users (FK added after workspaces table exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

-- Workspace ↔ Snowflake connection mapping (many-to-many)
CREATE TABLE IF NOT EXISTS workspace_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES snowflake_connections(id) ON DELETE CASCADE,
  warehouse VARCHAR(255),
  role VARCHAR(255),
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_workspace_connection UNIQUE (workspace_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_connections_ws ON workspace_connections(workspace_id);

-- Workspace membership
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_workspace_member UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_ws ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

-- Semantic views attached to a workspace connection
CREATE TABLE IF NOT EXISTS workspace_semantic_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_connection_id UUID NOT NULL REFERENCES workspace_connections(id) ON DELETE CASCADE,
  semantic_view_fqn VARCHAR(1000) NOT NULL,
  label VARCHAR(255),
  sample_questions JSONB DEFAULT '[]',
  added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_ws_conn_semantic_view UNIQUE (workspace_id, workspace_connection_id, semantic_view_fqn)
);

CREATE INDEX IF NOT EXISTS idx_ws_semantic_views_ws ON workspace_semantic_views(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_semantic_views_conn ON workspace_semantic_views(workspace_connection_id);

-- Cortex agents attached to a workspace connection
CREATE TABLE IF NOT EXISTS workspace_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_connection_id UUID NOT NULL REFERENCES workspace_connections(id) ON DELETE CASCADE,
  agent_fqn VARCHAR(1000) NOT NULL,
  label VARCHAR(255),
  sample_questions JSONB DEFAULT '[]',
  added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_ws_conn_agent UNIQUE (workspace_id, workspace_connection_id, agent_fqn)
);

CREATE INDEX IF NOT EXISTS idx_ws_agents_ws ON workspace_agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_agents_conn ON workspace_agents(workspace_connection_id);

-- MCP servers attached to a workspace connection
CREATE TABLE IF NOT EXISTS workspace_mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_connection_id UUID NOT NULL REFERENCES workspace_connections(id) ON DELETE CASCADE,
  mcp_server_fqn VARCHAR(1000) NOT NULL,
  label VARCHAR(255),
  sample_questions JSONB DEFAULT '[]',
  added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_ws_conn_mcp_server UNIQUE (workspace_id, workspace_connection_id, mcp_server_fqn)
);

CREATE INDEX IF NOT EXISTS idx_ws_mcp_servers_ws ON workspace_mcp_servers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_mcp_servers_conn ON workspace_mcp_servers(workspace_connection_id);

-- Published query endpoints (Tinybird-style query-as-API)
CREATE TABLE IF NOT EXISTS workspace_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_connection_id UUID NOT NULL REFERENCES workspace_connections(id) ON DELETE CASCADE,
  slug VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  endpoint_type VARCHAR(20) NOT NULL DEFAULT 'structured',
  semantic_view_fqn VARCHAR(1000) NOT NULL,
  query_definition JSONB NOT NULL,
  parameters JSONB DEFAULT '[]',
  share_token VARCHAR(64) UNIQUE,
  is_public BOOLEAN DEFAULT false,
  validated_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_ws_endpoint_slug UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_ws_endpoints_ws ON workspace_endpoints(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_endpoints_conn ON workspace_endpoints(workspace_connection_id);
CREATE INDEX IF NOT EXISTS idx_ws_endpoints_token ON workspace_endpoints(share_token);

DROP TRIGGER IF EXISTS update_ws_endpoints_updated_at ON workspace_endpoints;
CREATE TRIGGER update_ws_endpoints_updated_at
  BEFORE UPDATE ON workspace_endpoints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Workspace-scoped API keys for bearer token access to endpoints
CREATE TABLE IF NOT EXISTS workspace_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(128) NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_ws_api_key_name UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ws_api_keys_ws ON workspace_api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_api_keys_hash ON workspace_api_keys(key_hash);

-- ============================================
-- WORKSPACE AI CONFIG
-- ============================================

CREATE TABLE IF NOT EXISTS workspace_ai_config (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'cortex',
  api_key_encrypted TEXT,
  default_model VARCHAR(100),
  endpoint_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_workspace_ai_config_updated_at ON workspace_ai_config;
CREATE TRIGGER update_workspace_ai_config_updated_at
  BEFORE UPDATE ON workspace_ai_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Models available within a workspace (API-hosted or self-hosted open models)
CREATE TABLE IF NOT EXISTS workspace_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  description TEXT,
  context_window INTEGER,
  capabilities JSONB DEFAULT '[]',
  is_default BOOLEAN DEFAULT false,
  is_enabled BOOLEAN DEFAULT true,
  endpoint_url TEXT,
  api_key_encrypted TEXT,
  added_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_ws_model UNIQUE (workspace_id, provider, model_id)
);

CREATE INDEX IF NOT EXISTS idx_ws_models_ws ON workspace_models(workspace_id);

DROP TRIGGER IF EXISTS update_workspace_models_updated_at ON workspace_models;
CREATE TRIGGER update_workspace_models_updated_at
  BEFORE UPDATE ON workspace_models
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Platform model catalog — defines which models the platform supports
CREATE TABLE IF NOT EXISTS platform_models (
  id VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  vendor VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'chat',
  context_window INTEGER,
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Cloud endpoints where each model is deployed (cross-cloud, cross-region)
CREATE TABLE IF NOT EXISTS platform_model_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id VARCHAR(255) NOT NULL REFERENCES platform_models(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,
  cloud VARCHAR(10) NOT NULL,
  region VARCHAR(100) NOT NULL,
  endpoint_config JSONB DEFAULT '{}',
  priority INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  health_status VARCHAR(20) DEFAULT 'healthy',
  last_health_check TIMESTAMPTZ,
  avg_latency_ms INTEGER,
  cost_per_1k_tokens NUMERIC(10, 6),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_model_cloud_region UNIQUE (model_id, cloud, region)
);

CREATE INDEX IF NOT EXISTS idx_platform_endpoints_model ON platform_model_endpoints(model_id);
CREATE INDEX IF NOT EXISTS idx_platform_endpoints_cloud ON platform_model_endpoints(cloud, region);
CREATE INDEX IF NOT EXISTS idx_platform_endpoints_active ON platform_model_endpoints(is_active, health_status);

DROP TRIGGER IF EXISTS update_platform_model_endpoints_updated_at ON platform_model_endpoints;
CREATE TRIGGER update_platform_model_endpoints_updated_at
  BEFORE UPDATE ON platform_model_endpoints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DASHBOARD FOLDERS
-- ============================================

CREATE TABLE IF NOT EXISTS dashboard_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES dashboard_folders(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  
  is_public BOOLEAN DEFAULT false,
  
  icon VARCHAR(50) DEFAULT 'folder',
  color VARCHAR(7) DEFAULT '#6366f1',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON dashboard_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON dashboard_folders(owner_id);

-- ============================================
-- DASHBOARDS
-- ============================================

CREATE TYPE dashboard_visibility AS ENUM ('private', 'public');

CREATE TABLE IF NOT EXISTS dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  owner_id UUID NOT NULL REFERENCES users(id),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES snowflake_connections(id),
  
  folder_id UUID REFERENCES dashboard_folders(id) ON DELETE SET NULL,
  
  warehouse VARCHAR(255),
  role VARCHAR(255),
  
  yaml_definition TEXT,
  
  visibility dashboard_visibility DEFAULT 'private',
  is_published BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON dashboards(owner_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_connection ON dashboards(connection_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_visibility ON dashboards(visibility);
CREATE INDEX IF NOT EXISTS idx_dashboards_workspace ON dashboards(workspace_id);

-- Dashboard individual user access (for private dashboards)
CREATE TABLE IF NOT EXISTS dashboard_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level VARCHAR(50) DEFAULT 'view',
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_dashboard_user UNIQUE (dashboard_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_user_access_dashboard ON dashboard_user_access(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_user_access_user ON dashboard_user_access(user_id);

-- ============================================
-- AUDIT LOG
-- ============================================

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- ============================================
-- APP EVENTS (consumption / analytics tracking)
-- ============================================

CREATE TABLE IF NOT EXISTS app_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_events_type ON app_events(event_type);
CREATE INDEX IF NOT EXISTS idx_app_events_ws_created ON app_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_user ON app_events(user_id);
CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events(created_at);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_connections_updated_at ON snowflake_connections;
CREATE TRIGGER update_connections_updated_at
  BEFORE UPDATE ON snowflake_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_workspaces_updated_at ON workspaces;
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON workspaces
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
-- SIMPLYASK TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS ask_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  connection_id UUID REFERENCES snowflake_connections(id),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  mode VARCHAR(20) NOT NULL DEFAULT 'semantic',
  title VARCHAR(500) DEFAULT 'New conversation',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ask_conversations_user ON ask_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ask_conversations_ws ON ask_conversations(workspace_id);

CREATE TABLE IF NOT EXISTS ask_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ask_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT DEFAULT '',
  artifacts TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ask_messages_conv ON ask_messages(conversation_id);

CREATE TABLE IF NOT EXISTS ask_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  connection_id UUID REFERENCES snowflake_connections(id),
  title VARCHAR(500) DEFAULT 'AI Dashboard',
  yaml_definition JSONB NOT NULL,
  share_token VARCHAR(64) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ask_dashboards_user ON ask_dashboards(user_id);
CREATE INDEX IF NOT EXISTS idx_ask_dashboards_token ON ask_dashboards(share_token);

DROP TRIGGER IF EXISTS update_ask_conversations_updated_at ON ask_conversations;
CREATE TRIGGER update_ask_conversations_updated_at
  BEFORE UPDATE ON ask_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- LEGACY TABLES (kept for migration compatibility)
-- These are no longer used by new code but retained
-- so existing databases don't break during migration.
-- ============================================

CREATE TABLE IF NOT EXISTS user_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_group_member UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS dashboard_group_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_dashboard_group UNIQUE (dashboard_id, group_id)
);

CREATE TABLE IF NOT EXISTS folder_group_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES dashboard_folders(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_folder_group UNIQUE (folder_id, group_id)
);
