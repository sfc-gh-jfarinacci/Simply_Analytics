import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import tar from 'tar';
import configStore from '../config/configStore.js';
import {
  getConfigFilePath,
  getMasterKeyPath,
  importRecoveryKeyFile,
  decryptConfigWithKey,
  encryptConfigWithKey,
  exportRecoveryKeyFile,
  rotateMasterKeyOnDisk,
  saveConfigFile,
} from '../config/configEncryption.js';
import { LATEST_VERSION } from '../db/schemaPatches.js';

const execFileAsync = promisify(execFile);

const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_HOURS || '6', 10) * 60 * 60 * 1000;
const BACKUP_RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);

let _schedulerTimer = null;
let _lastBackupTime = null;
let _nextBackupTime = null;

function _ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function _getAppVersion() {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

/**
 * Create a full backup archive containing:
 *   - dump.sql  (pg_dump output)
 *   - config.enc (encrypted config file)
 *   - manifest.json (metadata)
 * @returns {{ id, filename, size, createdAt, appVersion, schemaVersion }}
 */
export async function createBackup() {
  _ensureBackupDir();

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveName = `simply-backup-${timestamp}-${id.slice(0, 8)}.tar.gz`;
  const archivePath = path.join(BACKUP_DIR, archiveName);
  const tmpDir = path.join(BACKUP_DIR, `.tmp-${id}`);

  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. pg_dump
    const dumpPath = path.join(tmpDir, 'dump.sql');
    const pgHost = configStore.get('POSTGRES_HOST') || 'localhost';
    const pgPort = configStore.get('POSTGRES_PORT') || '5432';
    const pgDb = configStore.get('POSTGRES_DB') || 'simply_analytics';
    const pgUser = configStore.get('POSTGRES_USER') || 'simply';
    const pgPass = configStore.get('POSTGRES_PASSWORD') || '';

    await execFileAsync('pg_dump', [
      '-h', pgHost,
      '-p', pgPort,
      '-U', pgUser,
      '-d', pgDb,
      '--no-owner',
      '--no-acl',
      '-f', dumpPath,
    ], {
      env: { ...process.env, PGPASSWORD: pgPass },
      timeout: 120_000,
    });

    // 2. Copy encrypted config
    const configSrc = getConfigFilePath();
    const configDst = path.join(tmpDir, 'config.enc');
    if (fs.existsSync(configSrc)) {
      fs.copyFileSync(configSrc, configDst);
    }

    // 3. Write manifest
    const manifest = {
      id,
      appVersion: _getAppVersion(),
      schemaVersion: LATEST_VERSION,
      createdAt: new Date().toISOString(),
      pgDatabase: pgDb,
    };
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 4. Create tar.gz archive
    await tar.create(
      { gzip: true, file: archivePath, cwd: tmpDir },
      ['dump.sql', 'config.enc', 'manifest.json']
    );

    const stat = fs.statSync(archivePath);
    _lastBackupTime = new Date();
    console.log(`[backup] Created backup: ${archiveName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

    return {
      id,
      filename: archiveName,
      size: stat.size,
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
    };
  } finally {
    // Clean up tmp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * List all backups sorted by creation date (newest first).
 */
export function listBackups() {
  _ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('simply-backup-') && f.endsWith('.tar.gz'));

  return files.map(filename => {
    const filePath = path.join(BACKUP_DIR, filename);
    const stat = fs.statSync(filePath);

    // Try to extract manifest without full extraction
    let manifest = {};
    try {
      const entries = [];
      tar.list({
        file: filePath,
        sync: true,
        onentry: (entry) => {
          if (entry.path === 'manifest.json') {
            const chunks = [];
            entry.on('data', c => chunks.push(c));
            entry.on('end', () => {
              manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            });
          }
        },
      });
    } catch (_) {}

    return {
      id: manifest.id || filename,
      filename,
      size: stat.size,
      createdAt: manifest.createdAt || stat.mtime.toISOString(),
      appVersion: manifest.appVersion || 'unknown',
      schemaVersion: manifest.schemaVersion || 0,
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get the full path to a backup archive by ID or filename.
 * @returns {string|null}
 */
export function getBackupPath(idOrFilename) {
  _ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('simply-backup-') && f.endsWith('.tar.gz'));

  // Direct filename match
  if (files.includes(idOrFilename)) {
    return path.join(BACKUP_DIR, idOrFilename);
  }

  // Match by ID (embedded in filename)
  for (const f of files) {
    if (f.includes(idOrFilename.slice(0, 8))) {
      return path.join(BACKUP_DIR, f);
    }
  }

  return null;
}

/**
 * Delete a backup by ID or filename.
 */
export function deleteBackup(idOrFilename) {
  const filePath = getBackupPath(idOrFilename);
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Restore from a backup archive using a recovery key file.
 * @param {string} archivePath - path to the .tar.gz backup
 * @param {Buffer} recoveryKeyBuffer - the recovery key file contents
 * @returns {{ success, error?, newRecoveryKeyBuffer? }}
 */
export async function restoreFromBackup(archivePath, recoveryKeyBuffer) {
  const tmpDir = path.join(BACKUP_DIR, `.tmp-restore-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Extract archive
    await tar.extract({ file: archivePath, cwd: tmpDir });

    // Parse recovery key
    const oldKeyHex = importRecoveryKeyFile(recoveryKeyBuffer);

    // Validate key against bundled config.enc
    const configEncPath = path.join(tmpDir, 'config.enc');
    if (!fs.existsSync(configEncPath)) {
      return { success: false, error: 'Backup archive does not contain config.enc' };
    }

    const envelope = JSON.parse(fs.readFileSync(configEncPath, 'utf8'));
    let plainConfig;
    try {
      plainConfig = decryptConfigWithKey(envelope, oldKeyHex);
    } catch (err) {
      return { success: false, error: 'Recovery key does not match this backup. Decryption failed.' };
    }

    // Restore database from dump.sql
    const dumpPath = path.join(tmpDir, 'dump.sql');
    if (!fs.existsSync(dumpPath)) {
      return { success: false, error: 'Backup archive does not contain dump.sql' };
    }

    const pgHost = plainConfig.POSTGRES_HOST || process.env.BUNDLED_PG_HOST || 'postgres';
    const pgPort = plainConfig.POSTGRES_PORT || process.env.BUNDLED_PG_PORT || '5432';
    const pgDb = plainConfig.POSTGRES_DB || process.env.BUNDLED_PG_DB || 'simply_analytics';
    const pgUser = plainConfig.POSTGRES_USER || process.env.BUNDLED_PG_USER || 'simply';
    const pgPass = plainConfig.POSTGRES_PASSWORD || '';

    // Drop and recreate database for clean restore
    try {
      await execFileAsync('psql', [
        '-h', pgHost, '-p', pgPort, '-U', pgUser, '-d', 'postgres',
        '-c', `DROP DATABASE IF EXISTS "${pgDb}"`,
        '-c', `CREATE DATABASE "${pgDb}"`,
      ], { env: { ...process.env, PGPASSWORD: pgPass }, timeout: 30_000 });
    } catch (err) {
      console.warn('[backup] Could not drop/recreate database, attempting direct restore:', err.message);
    }

    await execFileAsync('psql', [
      '-h', pgHost, '-p', pgPort, '-U', pgUser, '-d', pgDb,
      '-f', dumpPath,
    ], {
      env: { ...process.env, PGPASSWORD: pgPass },
      timeout: 120_000,
    });

    // Set master key to old key temporarily, write config, then rotate
    const keyPath = getMasterKeyPath();
    const keyDir = path.dirname(keyPath);
    if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(keyPath, oldKeyHex, { mode: 0o600 });

    saveConfigFile(plainConfig);
    const newKeyHex = rotateMasterKeyOnDisk(plainConfig);
    const newRecoveryKeyBuffer = exportRecoveryKeyFile();

    console.log('[backup] Restore completed successfully');
    return { success: true, newRecoveryKeyBuffer };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Re-encrypt all backup archives with a new master key.
 * Used during master key rotation.
 */
export async function reEncryptBackups(oldKeyHex, newKeyHex) {
  _ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('simply-backup-') && f.endsWith('.tar.gz'));

  let count = 0;
  for (const filename of files) {
    const archivePath = path.join(BACKUP_DIR, filename);
    const tmpDir = path.join(BACKUP_DIR, `.tmp-reencrypt-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      await tar.extract({ file: archivePath, cwd: tmpDir });

      const configEncPath = path.join(tmpDir, 'config.enc');
      if (!fs.existsSync(configEncPath)) continue;

      const envelope = JSON.parse(fs.readFileSync(configEncPath, 'utf8'));
      let plainConfig;
      try {
        plainConfig = decryptConfigWithKey(envelope, oldKeyHex);
      } catch (_) {
        console.warn(`[backup] Could not decrypt ${filename} with old key, skipping`);
        continue;
      }

      // Re-encrypt with new key
      const newEnvelope = encryptConfigWithKey(plainConfig, newKeyHex);
      fs.writeFileSync(configEncPath, JSON.stringify(newEnvelope, null, 2));

      // Rebuild archive
      const entries = fs.readdirSync(tmpDir);
      await tar.create({ gzip: true, file: archivePath, cwd: tmpDir }, entries);
      count++;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  console.log(`[backup] Re-encrypted ${count} backup(s) with new master key`);
  return count;
}

/**
 * Enforce retention policy: delete backups older than BACKUP_RETENTION_DAYS.
 */
function _enforceRetention() {
  _ensureBackupDir();
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('simply-backup-') && f.endsWith('.tar.gz'));

  for (const filename of files) {
    const filePath = path.join(BACKUP_DIR, filename);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      console.log(`[backup] Deleted expired backup: ${filename}`);
    }
  }
}

/**
 * Get backup statistics.
 */
export function getBackupStats() {
  _ensureBackupDir();
  const backups = listBackups();
  const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

  return {
    count: backups.length,
    totalSize,
    totalSizeMB: (totalSize / 1024 / 1024).toFixed(1),
    lastBackupAt: _lastBackupTime?.toISOString() || (backups[0]?.createdAt ?? null),
    nextBackupAt: _nextBackupTime?.toISOString() || null,
    retentionDays: BACKUP_RETENTION_DAYS,
    intervalHours: BACKUP_INTERVAL_MS / 3600000,
  };
}

/**
 * Start the automated backup scheduler.
 */
export function scheduleBackups() {
  if (_schedulerTimer) return;

  _ensureBackupDir();

  const runCycle = async () => {
    try {
      await createBackup();
      _enforceRetention();
    } catch (err) {
      console.error('[backup] Scheduled backup failed:', err.message);
    }
    _nextBackupTime = new Date(Date.now() + BACKUP_INTERVAL_MS);
  };

  // Run first backup after a short delay (let the server fully start)
  setTimeout(() => {
    runCycle();
    _schedulerTimer = setInterval(runCycle, BACKUP_INTERVAL_MS);
  }, 30_000);

  _nextBackupTime = new Date(Date.now() + 30_000);
  console.log(`[backup] Automated backups scheduled every ${BACKUP_INTERVAL_MS / 3600000}h, retention ${BACKUP_RETENTION_DAYS}d`);
}
