import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { initServiceConnection, query, closeConnection, getServiceConfig } from './snowflakeBackend.js';

dotenv.config();

async function runMigration() {
  console.log('Starting Simply Analytics Snowflake schema migration...\n');

  const config = getServiceConfig();
  console.log(`Target: ${config.account} / ${config.database}.${config.schema}`);
  console.log(`Role: ${config.role} | Warehouse: ${config.warehouse}\n`);

  try {
    await initServiceConnection();
    console.log('Connected to Snowflake service account\n');
  } catch (err) {
    console.error('Failed to connect:', err.message);
    process.exit(1);
  }

  const statements = [
    `CREATE HYBRID TABLE IF NOT EXISTS users (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      username VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255),
      display_name VARCHAR(255),
      role VARCHAR(20) DEFAULT 'viewer' NOT NULL,
      auth_provider VARCHAR(20) DEFAULT 'local' NOT NULL,
      external_id VARCHAR(255),
      scim_managed BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      theme_preference VARCHAR(20) DEFAULT 'light',
      active_session_id VARCHAR(255),
      session_expires_at TIMESTAMP_LTZ,
      preferences VARIANT DEFAULT PARSE_JSON('{}'),
      totp_secret VARCHAR(1000),
      totp_enabled BOOLEAN DEFAULT FALSE,
      passkey_credentials VARIANT DEFAULT PARSE_JSON('[]'),
      passkey_enabled BOOLEAN DEFAULT FALSE,
      two_factor_required BOOLEAN DEFAULT TRUE,
      two_factor_grace_period_start TIMESTAMP_LTZ,
      two_factor_grace_days INTEGER DEFAULT 7,
      account_locked BOOLEAN DEFAULT FALSE,
      account_locked_reason VARCHAR(500),
      account_unlock_expires TIMESTAMP_LTZ,
      failed_login_attempts INTEGER DEFAULT 0,
      last_failed_login TIMESTAMP_LTZ,
      mfa_bypass_until TIMESTAMP_LTZ,
      mfa_bypass_reason VARCHAR(500),
      created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      last_login TIMESTAMP_LTZ,
      created_by VARCHAR(36),
      PRIMARY KEY (id),
      UNIQUE (username),
      UNIQUE (email)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS snowflake_connections (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      name VARCHAR(255) NOT NULL,
      description VARCHAR(5000),
      user_id VARCHAR(36) NOT NULL,
      account VARCHAR(255) NOT NULL,
      username VARCHAR(255) NOT NULL,
      auth_type VARCHAR(20) NOT NULL,
      credentials_encrypted VARCHAR(10000) NOT NULL,
      default_warehouse VARCHAR(255),
      default_role VARCHAR(255),
      is_valid BOOLEAN DEFAULT TRUE,
      last_tested TIMESTAMP_LTZ,
      last_test_error VARCHAR(5000),
      created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      UNIQUE (user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS user_groups (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      name VARCHAR(255) NOT NULL,
      description VARCHAR(5000),
      created_by VARCHAR(36) NOT NULL,
      created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      UNIQUE (name),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS group_members (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      group_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      added_by VARCHAR(36),
      added_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      UNIQUE (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES user_groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS dashboard_folders (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      name VARCHAR(255) NOT NULL,
      description VARCHAR(5000),
      parent_id VARCHAR(36),
      owner_id VARCHAR(36) NOT NULL,
      is_public BOOLEAN DEFAULT FALSE,
      icon VARCHAR(50) DEFAULT 'folder',
      color VARCHAR(7) DEFAULT '#6366f1',
      created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS folder_group_access (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      folder_id VARCHAR(36) NOT NULL,
      group_id VARCHAR(36) NOT NULL,
      granted_by VARCHAR(36),
      granted_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      UNIQUE (folder_id, group_id),
      FOREIGN KEY (folder_id) REFERENCES dashboard_folders(id),
      FOREIGN KEY (group_id) REFERENCES user_groups(id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS dashboards (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      name VARCHAR(255) NOT NULL,
      description VARCHAR(5000),
      owner_id VARCHAR(36) NOT NULL,
      connection_id VARCHAR(36) NOT NULL,
      folder_id VARCHAR(36),
      warehouse VARCHAR(255),
      role VARCHAR(255),
      yaml_definition VARCHAR(16777216),
      visibility VARCHAR(20) DEFAULT 'private',
      is_published BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      UNIQUE (owner_id, name),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (connection_id) REFERENCES snowflake_connections(id),
      FOREIGN KEY (folder_id) REFERENCES dashboard_folders(id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS dashboard_group_access (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      dashboard_id VARCHAR(36) NOT NULL,
      group_id VARCHAR(36) NOT NULL,
      granted_by VARCHAR(36),
      granted_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      UNIQUE (dashboard_id, group_id),
      FOREIGN KEY (dashboard_id) REFERENCES dashboards(id),
      FOREIGN KEY (group_id) REFERENCES user_groups(id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS dashboard_user_access (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      dashboard_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      access_level VARCHAR(50) DEFAULT 'view',
      granted_by VARCHAR(36),
      granted_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      UNIQUE (dashboard_id, user_id),
      FOREIGN KEY (dashboard_id) REFERENCES dashboards(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS audit_log (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      user_id VARCHAR(36),
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50),
      entity_id VARCHAR(36),
      details VARIANT,
      ip_address VARCHAR(45),
      created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id)
    )`,

    `CREATE HYBRID TABLE IF NOT EXISTS webauthn_challenges (
      id VARCHAR(36) DEFAULT UUID_STRING() NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      challenge VARCHAR(5000) NOT NULL,
      type VARCHAR(20) NOT NULL,
      expires_at TIMESTAMP_LTZ NOT NULL,
      created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
  ];

  let completed = 0;
  let skipped = 0;
  let errors = 0;

  console.log(`Executing ${statements.length} CREATE TABLE statements...\n`);

  for (const sql of statements) {
    const tableName = sql.match(/CREATE HYBRID TABLE IF NOT EXISTS (\w+)/)?.[1] || 'unknown';
    try {
      await query(sql);
      completed++;
      console.log(`  OK: ${tableName}`);
    } catch (err) {
      if (err.message?.includes('already exists')) {
        skipped++;
        console.log(`  Skipped (exists): ${tableName}`);
      } else {
        errors++;
        console.error(`  ERROR: ${tableName} - ${err.message}`);
      }
    }
  }

  console.log(`\nSchema migration complete: ${completed} created, ${skipped} skipped, ${errors} errors`);

  console.log('\nSetting up admin user...');
  const adminPassword = 'admin123';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const adminId = crypto.randomUUID();

  try {
    const existing = await query("SELECT id FROM users WHERE username = ?", ['admin']);
    if (existing.rows.length > 0) {
      await query("UPDATE users SET password_hash = ? WHERE username = ?", [passwordHash, 'admin']);
      console.log('  Admin user password updated');
    } else {
      await query(
        `INSERT INTO users (id, username, email, password_hash, display_name, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [adminId, 'admin', 'admin@simplyanalytics.local', passwordHash, 'System Administrator', 'owner']
      );
      console.log('  Admin user created');
    }
  } catch (err) {
    console.error('  Could not create/update admin user:', err.message);
  }

  console.log('\nDefault admin credentials:');
  console.log('  Username: admin');
  console.log('  Password: admin123 (CHANGE THIS IMMEDIATELY!)');

  await closeConnection();
  console.log('\nDone');
}

runMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
