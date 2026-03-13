#!/usr/bin/env node
import dotenv from 'dotenv';
import { init, query, close } from '../db/db.js';
import { decryptWithKey, encryptWithKey, parseKeyHex } from '../utils/encryption.js';

dotenv.config();

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--old-key') flags.oldKey = args[++i];
  if (args[i] === '--new-key') flags.newKey = args[++i];
  if (args[i] === '--dry-run') flags.dryRun = true;
  if (args[i] === '--generate') flags.generate = true;
}

if (flags.generate) {
  const crypto = await import('crypto');
  console.log(crypto.default.randomBytes(32).toString('hex'));
  process.exit(0);
}

if (!flags.oldKey || !flags.newKey) {
  console.error(`
Usage:
  node src/scripts/rotate-encryption-key.js --old-key <hex> --new-key <hex> [--dry-run]

Options:
  --old-key <hex>   Current 64-char hex encryption key
  --new-key <hex>   New 64-char hex encryption key
  --dry-run         Preview without writing changes
  --generate        Print a new random key and exit

Steps:
  1. Generate a new key:
     node src/scripts/rotate-encryption-key.js --generate

  2. Dry run to verify:
     node src/scripts/rotate-encryption-key.js \\
       --old-key <current_key_from_env> \\
       --new-key <generated_key> \\
       --dry-run

  3. Execute rotation:
     node src/scripts/rotate-encryption-key.js \\
       --old-key <current_key_from_env> \\
       --new-key <generated_key>

  4. Update .env with the new key:
     CREDENTIALS_ENCRYPTION_KEY=<new_key>

  5. Restart the application
`);
  process.exit(1);
}

let oldKeyBuf, newKeyBuf;
try {
  oldKeyBuf = parseKeyHex(flags.oldKey);
} catch {
  console.error('ERROR: --old-key is not a valid 64-char hex string');
  process.exit(1);
}
try {
  newKeyBuf = parseKeyHex(flags.newKey);
} catch {
  console.error('ERROR: --new-key is not a valid 64-char hex string');
  process.exit(1);
}

if (flags.oldKey === flags.newKey) {
  console.error('ERROR: old and new keys are identical');
  process.exit(1);
}

console.log(`Encryption key rotation ${flags.dryRun ? '(DRY RUN)' : ''}`);
console.log(`Old key: ${flags.oldKey.substring(0, 8)}...${flags.oldKey.substring(56)}`);
console.log(`New key: ${flags.newKey.substring(0, 8)}...${flags.newKey.substring(56)}\n`);

try {
  await init();
  console.log('Connected to database\n');
} catch (err) {
  console.error('Failed to connect:', err.message);
  process.exit(1);
}

let rotated = 0;
let failed = 0;
let skipped = 0;

function reEncrypt(ciphertext) {
  const plaintext = decryptWithKey(ciphertext, oldKeyBuf);
  const reEncrypted = encryptWithKey(plaintext, newKeyBuf);
  const verify = decryptWithKey(reEncrypted, newKeyBuf);
  if (verify !== plaintext) {
    throw new Error('Re-encryption verification failed');
  }
  return reEncrypted;
}

try {
  // --- Connection credentials ---
  const connResult = await query('SELECT id, name, credentials_encrypted FROM snowflake_connections');
  const connRows = connResult.rows;
  console.log(`Found ${connRows.length} connection credential(s)`);

  for (const row of connRows) {
    const label = `connection: ${row.name} (${row.id.substring(0, 8)})`;
    try {
      const reEncrypted = reEncrypt(row.credentials_encrypted);

      if (flags.dryRun) {
        console.log(`  OK (dry): ${label}`);
        skipped++;
      } else {
        await query(
          'UPDATE snowflake_connections SET credentials_encrypted = $1 WHERE id = $2',
          [reEncrypted, row.id]
        );
        console.log(`  OK: ${label}`);
        rotated++;
      }
    } catch (err) {
      console.error(`  FAIL: ${label} — ${err.message}`);
      failed++;
    }
  }

  // --- TOTP secrets ---
  const totpResult = await query('SELECT id, username, totp_secret FROM users WHERE totp_secret IS NOT NULL');
  const totpRows = totpResult.rows;
  console.log(`\nFound ${totpRows.length} TOTP secret(s)`);

  for (const row of totpRows) {
    const label = `totp: ${row.username} (${row.id.substring(0, 8)})`;
    try {
      const reEncrypted = reEncrypt(row.totp_secret);

      if (flags.dryRun) {
        console.log(`  OK (dry): ${label}`);
        skipped++;
      } else {
        await query(
          'UPDATE users SET totp_secret = $1 WHERE id = $2',
          [reEncrypted, row.id]
        );
        console.log(`  OK: ${label}`);
        rotated++;
      }
    } catch (err) {
      console.error(`  FAIL: ${label} — ${err.message}`);
      failed++;
    }
  }
} catch (err) {
  console.error('Query failed:', err.message);
  process.exit(1);
} finally {
  await close();
}

console.log(`\nDone: ${rotated} rotated, ${skipped} skipped (dry-run), ${failed} failed`);

if (failed > 0) {
  console.error('\nWARNING: Some rows failed to rotate. Do NOT update .env until resolved.');
  process.exit(1);
}

if (!flags.dryRun && rotated > 0) {
  console.log(`\nUpdate your .env now:\n  CREDENTIALS_ENCRYPTION_KEY=${flags.newKey}\n\nThen restart the application.`);
}
