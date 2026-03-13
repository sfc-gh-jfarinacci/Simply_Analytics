/**
 * Simply Analytics - PostgreSQL Schema Migration
 * 
 * This script creates the necessary tables in PostgreSQL to store:
 * - Users and authentication
 * - Snowflake connections
 * - Dashboard definitions
 * - User groups and sharing
 * - Audit logs
 * 
 * Prerequisites:
 * 1. PostgreSQL server running
 * 2. Database created: CREATE DATABASE simply_analytics;
 * 3. Environment variables set:
 *    POSTGRES_HOST=localhost
 *    POSTGRES_PORT=5432
 *    POSTGRES_DB=simply_analytics
 *    POSTGRES_USER=postgres
 *    POSTGRES_PASSWORD=your_password
 * 
 * Run with: node src/db/migrate-postgres.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

async function runMigration() {
  console.log('🚀 Starting Simply Analytics PostgreSQL schema migration...\n');

  // Validate environment
  const requiredVars = ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];
  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.log('\nPlease set the following in your .env file:');
    console.log('  POSTGRES_HOST=localhost');
    console.log('  POSTGRES_PORT=5432');
    console.log('  POSTGRES_DB=simply_analytics');
    console.log('  POSTGRES_USER=postgres');
    console.log('  POSTGRES_PASSWORD=your_password');
    process.exit(1);
  }

  const targetDb = process.env.POSTGRES_DB;
  
  // First, connect to 'postgres' database to check/create the target database
  const adminPool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: 'postgres', // Connect to default database first
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  });

  try {
    console.log(`📍 Connecting to PostgreSQL at ${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}...`);
    
    // Check if target database exists
    const dbCheck = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [targetDb]
    );
    
    if (dbCheck.rows.length === 0) {
      console.log(`📦 Database '${targetDb}' does not exist. Creating...`);
      await adminPool.query(`CREATE DATABASE ${targetDb}`);
      console.log(`✅ Database '${targetDb}' created!`);
    } else {
      console.log(`✅ Database '${targetDb}' exists`);
    }
    
    await adminPool.end();
  } catch (adminErr) {
    console.error('❌ Could not check/create database:', adminErr.message);
    await adminPool.end();
    process.exit(1);
  }

  // Now connect to the target database
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: targetDb,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  });

  try {
    // Test connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('✅ Connected to', targetDb, 'at', testResult.rows[0].now);

    // Check if user has permissions
    console.log('\n🔐 Checking permissions...');
    try {
      const permCheck = await pool.query(`
        SELECT 
          current_user,
          pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') as can_create,
          (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) as is_super
      `);
      const perms = permCheck.rows[0];
      console.log(`   User: ${perms.current_user}`);
      console.log(`   Superuser: ${perms.is_super ? 'Yes' : 'No'}`);
      console.log(`   Can create in public schema: ${perms.can_create ? 'Yes' : 'No'}`);
      
      if (!perms.can_create) {
        console.log('\n⚠️  User lacks CREATE permission on public schema!');
        console.log('   This is common in PostgreSQL 15+. Trying to fix...\n');
        
        try {
          // Try to grant permissions if we're superuser
          if (perms.is_super) {
            await pool.query('GRANT ALL ON SCHEMA public TO PUBLIC');
            console.log('   ✅ Granted schema permissions');
          } else {
            console.log('   ❌ Not a superuser - cannot grant permissions');
            console.log('   Please run as superuser or ask your DBA to run:');
            console.log(`      GRANT ALL ON SCHEMA public TO ${perms.current_user};`);
          }
        } catch (grantErr) {
          console.log('   ❌ Could not grant permissions:', grantErr.message);
        }
      }
    } catch (permErr) {
      console.log('   ⚠️  Could not check permissions:', permErr.message);
    }

    console.log('\n📦 Running schema migration...\n');

    // Read and execute schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Split into individual statements (handle $$ blocks for functions)
    const statements = splitSqlStatements(schemaSql);
    
    let completed = 0;
    let skipped = 0;
    let errors = 0;

    console.log(`Found ${statements.length} SQL statements to execute\n`);
    
    for (const stmt of statements) {
      const shortStmt = stmt.substring(0, 70).replace(/\n/g, ' ').trim() + '...';
      
      try {
        await pool.query(stmt);
        completed++;
        console.log(`  ✅ ${shortStmt}`);
      } catch (err) {
        if (err.message.includes('already exists') || 
            err.message.includes('duplicate key') ||
            err.code === '42710' ||  // Duplicate object
            err.code === '42P07') {  // Duplicate table
          skipped++;
          console.log(`  ⚪ Skipped (exists): ${shortStmt}`);
        } else {
          errors++;
          console.log(`  ❌ ERROR: ${shortStmt}`);
          console.log(`     Code: ${err.code}, Message: ${err.message}`);
        }
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   ${completed} statements executed`);
    console.log(`   ${skipped} statements skipped (already exist)`);
    if (errors > 0) {
      console.log(`   ${errors} statements had warnings`);
    }

    // Run incremental migrations (for existing databases)
    console.log('\n🔄 Running incremental migrations...');
    
    // Add theme_preference column if it doesn't exist
    try {
      const themeColCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'theme_preference'
      `);
      
      if (themeColCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN theme_preference VARCHAR(20) DEFAULT 'light'`);
        console.log("   ✅ Added 'theme_preference' column to users table");
      } else {
        console.log("   ✓ 'theme_preference' column already exists");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add theme_preference column:', migrateErr.message);
    }

    // Add active_session_id column if it doesn't exist (for single-session enforcement)
    try {
      const sessionColCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'active_session_id'
      `);
      
      if (sessionColCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN active_session_id VARCHAR(255)`);
        await pool.query(`ALTER TABLE users ADD COLUMN session_expires_at TIMESTAMP WITH TIME ZONE`);
        console.log("   ✅ Added 'active_session_id' and 'session_expires_at' columns to users table");
      } else {
        console.log("   ✓ 'active_session_id' column already exists");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add active_session_id columns:', migrateErr.message);
    }

    // Add preferences JSONB column if it doesn't exist (for color schemes, etc.)
    try {
      const prefsColCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'preferences'
      `);
      
      if (prefsColCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}'::jsonb`);
        console.log("   ✅ Added 'preferences' column to users table");
      } else {
        console.log("   ✓ 'preferences' column already exists");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add preferences column:', migrateErr.message);
    }

    // Add Multi-Factor Authentication columns
    console.log('\n🔐 Setting up Multi-Factor Authentication schema...');
    
    // TOTP columns
    try {
      const totpSecretCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'totp_secret'
      `);
      
      if (totpSecretCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN totp_secret TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT false`);
        console.log("   ✅ Added TOTP columns to users table");
      } else {
        console.log("   ✓ TOTP columns already exist");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add TOTP columns:', migrateErr.message);
    }

    // Passkey/WebAuthn credentials column (JSONB array)
    try {
      const passkeyCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'passkey_credentials'
      `);
      
      if (passkeyCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN passkey_credentials JSONB DEFAULT '[]'::jsonb`);
        await pool.query(`ALTER TABLE users ADD COLUMN passkey_enabled BOOLEAN DEFAULT false`);
        console.log("   ✅ Added Passkey columns to users table");
      } else {
        console.log("   ✓ Passkey columns already exist");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add Passkey columns:', migrateErr.message);
    }

    // 2FA enforcement and grace period columns
    try {
      const twoFactorRequiredCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'two_factor_required'
      `);
      
      if (twoFactorRequiredCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN two_factor_required BOOLEAN DEFAULT true`);
        await pool.query(`ALTER TABLE users ADD COLUMN two_factor_grace_period_start TIMESTAMP WITH TIME ZONE`);
        await pool.query(`ALTER TABLE users ADD COLUMN two_factor_grace_days INTEGER DEFAULT 7`);
        console.log("   ✅ Added MFA enforcement columns to users table");
      } else {
        console.log("   ✓ MFA enforcement columns already exist");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add MFA enforcement columns:', migrateErr.message);
    }

    // Account lock columns
    try {
      const accountLockedCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'account_locked'
      `);
      
      if (accountLockedCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN account_locked BOOLEAN DEFAULT false`);
        await pool.query(`ALTER TABLE users ADD COLUMN account_locked_reason TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN account_unlock_expires TIMESTAMP WITH TIME ZONE`);
        console.log("   ✅ Added account lock columns to users table");
      } else {
        console.log("   ✓ Account lock columns already exist");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add account lock columns:', migrateErr.message);
    }

    // Failed login attempts tracking
    try {
      const failedLoginCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'failed_login_attempts'
      `);
      
      if (failedLoginCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE users ADD COLUMN last_failed_login TIMESTAMP WITH TIME ZONE`);
        console.log("   ✅ Added failed login tracking columns to users table");
      } else {
        console.log("   ✓ Failed login tracking columns already exist");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add failed login columns:', migrateErr.message);
    }

    // MFA bypass columns
    try {
      const mfaBypassCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'mfa_bypass_until'
      `);
      
      if (mfaBypassCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN mfa_bypass_until TIMESTAMP WITH TIME ZONE`);
        await pool.query(`ALTER TABLE users ADD COLUMN mfa_bypass_reason TEXT`);
        console.log("   ✅ Added MFA bypass columns to users table");
      } else {
        console.log("   ✓ MFA bypass columns already exist");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add MFA bypass columns:', migrateErr.message);
    }

    // WebAuthn challenge storage (for ongoing registrations/authentications)
    try {
      const webauthnChallengeCheck = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = 'webauthn_challenges'
      `);
      
      if (webauthnChallengeCheck.rows.length === 0) {
        await pool.query(`
          CREATE TABLE webauthn_challenges (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            challenge TEXT NOT NULL,
            type VARCHAR(20) NOT NULL, -- 'registration' or 'authentication'
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user ON webauthn_challenges(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at)`);
        console.log("   ✅ Created 'webauthn_challenges' table");
      } else {
        console.log("   ✓ 'webauthn_challenges' table already exists");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not create webauthn_challenges table:', migrateErr.message);
    }

    // Add folder_id column to dashboards if it doesn't exist
    try {
      const folderColCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'dashboards' AND column_name = 'folder_id'
      `);
      
      if (folderColCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE dashboards ADD COLUMN folder_id UUID REFERENCES dashboard_folders(id) ON DELETE SET NULL`);
        console.log("   ✅ Added 'folder_id' column to dashboards table");
      } else {
        console.log("   ✓ 'folder_id' column already exists");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add folder_id column:', migrateErr.message);
    }

    // Add folder_group_access table if it doesn't exist
    try {
      const folderAccessCheck = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = 'folder_group_access'
      `);
      
      if (folderAccessCheck.rows.length === 0) {
        await pool.query(`
          CREATE TABLE folder_group_access (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            folder_id UUID NOT NULL REFERENCES dashboard_folders(id) ON DELETE CASCADE,
            group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
            granted_by UUID REFERENCES users(id),
            granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_folder_group UNIQUE (folder_id, group_id)
          )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_folder_access_folder ON folder_group_access(folder_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_folder_access_group ON folder_group_access(group_id)`);
        console.log("   ✅ Created 'folder_group_access' table");
      } else {
        console.log("   ✓ 'folder_group_access' table already exists");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not create folder_group_access table:', migrateErr.message);
    }

    // Add unique constraint on folder names (case-insensitive)
    try {
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_unique_name ON dashboard_folders (LOWER(name))`);
      console.log("   ✓ Folder name uniqueness constraint exists");
    } catch (migrateErr) {
      console.log('   ⚠️  Could not create folder name unique index:', migrateErr.message);
    }

    // SSO / SCIM columns
    console.log('\n🔑 Setting up SSO / SCIM columns...');

    try {
      const authProviderCheck = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'auth_provider'
      `);

      if (authProviderCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE users ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'local'`);
        await pool.query(`ALTER TABLE users ADD COLUMN external_id VARCHAR(255)`);
        await pool.query(`ALTER TABLE users ADD COLUMN scim_managed BOOLEAN DEFAULT false`);
        await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id) WHERE external_id IS NOT NULL`);
        console.log("   ✅ Added SSO/SCIM columns to users table");
      } else {
        console.log("   ✓ SSO/SCIM columns already exist");
      }
    } catch (migrateErr) {
      console.log('   ⚠️  Could not add SSO/SCIM columns:', migrateErr.message);
    }

    // Create or update admin user with properly hashed password
    console.log('\n👤 Setting up admin user...');
    const adminPassword = 'admin123';
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    
    try {
      // Check if admin exists
      const existingAdmin = await pool.query(
        "SELECT id FROM users WHERE username = 'admin'"
      );
      
      if (existingAdmin.rows.length > 0) {
        // Update password hash
        await pool.query(
          "UPDATE users SET password_hash = $1 WHERE username = 'admin'",
          [passwordHash]
        );
        console.log('   ✅ Admin user password updated');
      } else {
        // Create admin user
        await pool.query(`
          INSERT INTO users (username, email, password_hash, display_name, role)
          VALUES ($1, $2, $3, $4, 'owner')
        `, ['admin', 'admin@simplyanalytics.local', passwordHash, 'System Administrator']);
        console.log('   ✅ Admin user created');
      }
    } catch (adminErr) {
      console.log('   ⚠️  Could not create/update admin user:', adminErr.message);
    }

    // Show initial admin user info
    console.log('\n📋 Default admin user credentials:');
    console.log('   Username: admin');
    console.log('   Email: admin@simplyanalytics.local');
    console.log('   Password: admin123 (CHANGE THIS IMMEDIATELY!)');
    console.log('   Role: owner');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('\n🔌 Connection closed');
  }
}

/**
 * Split SQL into individual statements, handling $$ delimited blocks
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarBlock = false;
  const lines = sql.split('\n');
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip pure comment lines when not in a function block
    if (trimmedLine.startsWith('--') && !inDollarBlock) {
      continue;
    }
    
    current += line + '\n';
    
    // Check for $$ delimiter toggle
    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) {
        inDollarBlock = !inDollarBlock;
      }
    }
    
    // If we're outside a $$ block and line ends with ;, it's end of statement
    if (!inDollarBlock && trimmedLine.endsWith(';')) {
      const stmt = current.trim();
      if (stmt.length > 0 && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
      current = '';
    }
  }
  
  // Handle any remaining content
  if (current.trim().length > 0 && !current.trim().startsWith('--')) {
    statements.push(current.trim());
  }
  
  return statements;
}

runMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
