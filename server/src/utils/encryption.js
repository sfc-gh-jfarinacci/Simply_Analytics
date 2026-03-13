import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_VERSION = 1;

let _encryptionKey = null;

function getKey() {
  if (_encryptionKey) return _encryptionKey;

  const keyHex = process.env.CREDENTIALS_ENCRYPTION_KEY;

  if (!keyHex || keyHex === 'default-encryption-key-change-in-production') {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is missing or set to the insecure default. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (256 bits). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  _encryptionKey = Buffer.from(keyHex, 'hex');
  return _encryptionKey;
}

export function encryptWithKey(plaintext, keyBuf) {
  const key = keyBuf || getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload = Buffer.concat([
    Buffer.from([KEY_VERSION]),
    iv,
    authTag,
    encrypted,
  ]);

  return payload.toString('base64');
}

export function decryptWithKey(encoded, keyBuf) {
  const key = keyBuf || getKey();
  const payload = Buffer.from(encoded, 'base64');

  const version = payload[0];
  if (version !== KEY_VERSION) {
    throw new Error(`Unsupported encryption key version: ${version}`);
  }

  let offset = 1;
  const iv = payload.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const authTag = payload.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;
  const ciphertext = payload.subarray(offset);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function encrypt(plaintext) {
  return encryptWithKey(plaintext, null);
}

export function decrypt(encoded) {
  return decryptWithKey(encoded, null);
}

export function encryptCredentials(credentials) {
  return encrypt(JSON.stringify(credentials));
}

export function decryptCredentials(encrypted) {
  return JSON.parse(decrypt(encrypted));
}

export function parseKeyHex(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('Key must be a 64-character hex string (256 bits)');
  }
  return Buffer.from(hex, 'hex');
}

export function validateKeyConfigured() {
  getKey();
}

export default {
  encrypt, decrypt, encryptWithKey, decryptWithKey,
  encryptCredentials, decryptCredentials, parseKeyHex, validateKeyConfigured,
};
