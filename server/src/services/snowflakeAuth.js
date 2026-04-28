import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Build authorization headers for Snowflake REST APIs (Analyst, Cortex COMPLETE, etc.).
 * Supports both PAT (Programmatic Access Token) and key-pair JWT auth.
 */
export async function buildSnowflakeHeaders(connWithCreds, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (options.accept) {
    headers['Accept'] = options.accept;
  }

  if (!connWithCreds.credentials) {
    throw new Error('Connection credentials are missing — cannot authenticate with Snowflake REST API');
  }

  if (connWithCreds.auth_type === 'pat') {
    if (!connWithCreds.credentials.token) {
      throw new Error('PAT token is missing from connection credentials');
    }
    headers['Authorization'] = `Bearer ${connWithCreds.credentials.token}`;
    headers['X-Snowflake-Authorization-Token-Type'] = 'PROGRAMMATIC_ACCESS_TOKEN';
  } else {
    const account = (connWithCreds.account || '').trim().replace(/^https?:\/\//, '').replace(/\.snowflakecomputing\.com\/?$/, '').replace(/\/+$/, '').toUpperCase();
    const user = connWithCreds.username.toUpperCase();

    const privateKeyObj = crypto.createPrivateKey({
      key: connWithCreds.credentials.privateKey,
      format: 'pem',
      passphrase: connWithCreds.credentials.passphrase || undefined,
    });
    const publicKeyDer = crypto.createPublicKey(privateKeyObj).export({ type: 'spki', format: 'der' });
    const fingerprint = crypto.createHash('sha256').update(publicKeyDer).digest('base64');

    const now = Math.floor(Date.now() / 1000);
    const keypairJwt = jwt.sign(
      {
        iss: `${account}.${user}.SHA256:${fingerprint}`,
        sub: `${account}.${user}`,
        iat: now,
        exp: now + 3600,
      },
      { key: connWithCreds.credentials.privateKey, passphrase: connWithCreds.credentials.passphrase || undefined },
      { algorithm: 'RS256' },
    );

    headers['Authorization'] = `Bearer ${keypairJwt}`;
    headers['X-Snowflake-Authorization-Token-Type'] = 'KEYPAIR_JWT';
  }

  return headers;
}

export function getAccountUrl(connWithCreds) {
  const account = (connWithCreds.account || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.snowflakecomputing\.com\/?$/, '')
    .replace(/\/+$/, '');
  return `https://${account}.snowflakecomputing.com`;
}
