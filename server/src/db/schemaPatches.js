/**
 * Lightweight schema patches applied at server startup.
 *
 * Each patch has:
 *   - version: monotonically increasing integer
 *   - name: human-readable label
 *   - check: query that returns rows if already applied (safety net for pre-versioned DBs)
 *   - apply: array of DDL statements to execute
 *
 * The `schema_meta` table tracks the current version.  On startup we only
 * apply patches whose version > stored version.  The legacy `check` queries
 * remain as a fallback for databases that existed before versioning was added.
 */

const patches = [
  {
    version: 1,
    name: 'workspace_connections',
    check: `SELECT 1 FROM information_schema.tables WHERE table_name='workspace_connections'`,
    apply: [
      `CREATE TABLE IF NOT EXISTS workspace_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        connection_id UUID NOT NULL REFERENCES snowflake_connections(id) ON DELETE CASCADE,
        warehouse VARCHAR(255),
        role VARCHAR(255),
        added_by UUID REFERENCES users(id),
        added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_workspace_connection UNIQUE (workspace_id, connection_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_workspace_connections_ws ON workspace_connections(workspace_id)`,
    ],
  },
  {
    version: 2,
    name: 'users.default_workspace_id',
    check: `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='default_workspace_id'`,
    apply: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS default_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL`,
    ],
  },
  {
    version: 3,
    name: 'workspace_semantic_views.workspace_connection_id',
    check: `SELECT 1 FROM information_schema.columns WHERE table_name='workspace_semantic_views' AND column_name='workspace_connection_id'`,
    apply: [
      `ALTER TABLE workspace_semantic_views ADD COLUMN workspace_connection_id UUID REFERENCES workspace_connections(id) ON DELETE CASCADE`,
      `ALTER TABLE workspace_semantic_views DROP CONSTRAINT IF EXISTS unique_ws_semantic_view`,
      `ALTER TABLE workspace_semantic_views ADD CONSTRAINT unique_ws_conn_semantic_view UNIQUE (workspace_id, workspace_connection_id, semantic_view_fqn)`,
      `CREATE INDEX IF NOT EXISTS idx_ws_semantic_views_conn ON workspace_semantic_views(workspace_connection_id)`,
    ],
  },
  {
    version: 4,
    name: 'workspace_endpoints',
    check: `SELECT 1 FROM information_schema.tables WHERE table_name='workspace_endpoints'`,
    apply: [
      `CREATE TABLE IF NOT EXISTS workspace_endpoints (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        workspace_connection_id UUID NOT NULL REFERENCES workspace_connections(id) ON DELETE CASCADE,
        slug VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        semantic_view_fqn VARCHAR(1000) NOT NULL,
        query_definition JSONB NOT NULL,
        parameters JSONB DEFAULT '[]',
        share_token VARCHAR(64) UNIQUE,
        is_public BOOLEAN DEFAULT false,
        created_by UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_ws_endpoint_slug UNIQUE (workspace_id, slug)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ws_endpoints_ws ON workspace_endpoints(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ws_endpoints_conn ON workspace_endpoints(workspace_connection_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ws_endpoints_token ON workspace_endpoints(share_token)`,
    ],
  },
  {
    version: 5,
    name: 'workspace_api_keys',
    check: `SELECT 1 FROM information_schema.tables WHERE table_name='workspace_api_keys'`,
    apply: [
      `CREATE TABLE IF NOT EXISTS workspace_api_keys (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ws_api_keys_ws ON workspace_api_keys(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ws_api_keys_hash ON workspace_api_keys(key_hash)`,
    ],
  },
  {
    version: 6,
    name: 'workspace_ai_config',
    check: `SELECT 1 FROM information_schema.tables WHERE table_name='workspace_ai_config'`,
    apply: [
      `CREATE TABLE IF NOT EXISTS workspace_ai_config (
        workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        provider VARCHAR(20) NOT NULL DEFAULT 'cortex',
        api_key_encrypted TEXT,
        default_model VARCHAR(100),
        endpoint_url TEXT,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    version: 7,
    name: 'workspace_endpoints.endpoint_type',
    check: `SELECT 1 FROM information_schema.columns WHERE table_name='workspace_endpoints' AND column_name='endpoint_type'`,
    apply: [
      `ALTER TABLE workspace_endpoints ADD COLUMN IF NOT EXISTS endpoint_type VARCHAR(20) NOT NULL DEFAULT 'structured'`,
      `ALTER TABLE workspace_endpoints ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ`,
    ],
  },
  {
    version: 8,
    name: 'app_events',
    check: `SELECT 1 FROM information_schema.tables WHERE table_name='app_events'`,
    apply: [
      `CREATE TABLE IF NOT EXISTS app_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(50) NOT NULL,
        user_id UUID REFERENCES users(id),
        workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
        entity_type VARCHAR(50),
        entity_id UUID,
        metadata JSONB DEFAULT '{}',
        ip_address VARCHAR(45),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_app_events_type ON app_events(event_type)`,
      `CREATE INDEX IF NOT EXISTS idx_app_events_ws_created ON app_events(workspace_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_app_events_user ON app_events(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events(created_at)`,
    ],
  },
  {
    version: 13,
    name: 'drop_unique_connection_name_per_user',
    check: `SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'unique_connection_name_per_user'
        AND table_name = 'snowflake_connections'
    )`,
    apply: [
      `ALTER TABLE snowflake_connections DROP CONSTRAINT IF EXISTS unique_connection_name_per_user`,
    ],
  },
];

const LATEST_VERSION = patches[patches.length - 1].version;

export { LATEST_VERSION };

export async function ensureLatestSchema(dbQuery) {
  // Bootstrap the schema_meta tracking table
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key VARCHAR(50) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Determine current version
  let currentVersion = 0;
  try {
    const row = await dbQuery(`SELECT value FROM schema_meta WHERE key = 'schema_version'`);
    if (row.rows.length > 0) {
      currentVersion = parseInt(row.rows[0].value, 10) || 0;
    }
  } catch (_) {}

  if (currentVersion >= LATEST_VERSION) {
    console.log(`[schema] Schema is up to date (version ${currentVersion})`);
    return;
  }

  for (const patch of patches) {
    if (patch.version <= currentVersion) continue;

    try {
      // Legacy safety net: skip if already applied (for pre-versioned databases)
      if (patch.check) {
        const exists = await dbQuery(patch.check);
        if (exists.rows.length > 0) {
          console.log(`[schema] v${patch.version} ${patch.name}: already exists, recording version`);
          await _setVersion(dbQuery, patch.version);
          continue;
        }
      }

      for (const sql of patch.apply) {
        await dbQuery(sql);
      }
      await _setVersion(dbQuery, patch.version);
      console.log(`[schema] v${patch.version} ${patch.name}: applied`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        await _setVersion(dbQuery, patch.version);
      } else {
        console.warn(`[schema] v${patch.version} ${patch.name}: ${err.message}`);
      }
    }
  }

  console.log(`[schema] Schema updated to version ${LATEST_VERSION}`);
}

async function _setVersion(dbQuery, version) {
  await dbQuery(
    `INSERT INTO schema_meta (key, value, updated_at) VALUES ('schema_version', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [String(version)]
  );
}
