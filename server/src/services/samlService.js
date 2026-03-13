import { SAML } from '@node-saml/node-saml';
import { query } from '../db/db.js';

const SSO_ENABLED = process.env.SSO_ENABLED === 'true';

let saml = null;

function getSaml() {
  if (saml) return saml;
  if (!SSO_ENABLED) throw new Error('SSO is not enabled');

  const cert = process.env.SAML_CERT;
  if (!cert) throw new Error('SAML_CERT is required when SSO is enabled');

  saml = new SAML({
    entryPoint: process.env.SAML_ENTRYPOINT,
    issuer: process.env.SAML_ISSUER || 'simply-analytics',
    callbackUrl: process.env.SAML_CALLBACK_URL,
    cert,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    maxAssertionAgeMs: 5 * 60 * 1000,
  });

  return saml;
}

export function isEnabled() {
  return SSO_ENABLED;
}

export async function getLoginUrl(relayState) {
  const s = getSaml();
  const url = await s.getAuthorizeUrlAsync(relayState || '', {}, {});
  return url;
}

export async function getMetadata() {
  const s = getSaml();
  return s.generateServiceProviderMetadata(null, process.env.SAML_CERT);
}

export async function validateCallback(body) {
  const s = getSaml();
  const { profile } = await s.validatePostResponseAsync(body);

  if (!profile) throw new Error('SAML assertion validation failed');

  const email = profile.email || profile.nameID;
  const nameID = profile.nameID;
  const externalId = profile.nameID;

  if (!email) throw new Error('SAML assertion missing email or nameID');

  const user = await findScimUser(email, externalId);

  return { user, nameID, sessionIndex: profile.sessionIndex };
}

async function findScimUser(email, externalId) {
  let result = await query(
    'SELECT * FROM users WHERE external_id = $1 AND auth_provider = $2',
    [externalId, 'saml']
  );
  if (result.rows[0]) return result.rows[0];

  result = await query(
    'SELECT * FROM users WHERE email = $1 AND auth_provider = $2',
    [email, 'saml']
  );
  if (result.rows[0]) return result.rows[0];

  throw new Error('User has not been provisioned. Contact your administrator to request access via SCIM.');
}

export async function handleLogout(nameID, sessionIndex) {
  if (!nameID) return;
  await query(
    'UPDATE users SET active_session_id = NULL, session_expires_at = NULL WHERE external_id = $1 AND auth_provider = $2',
    [nameID, 'saml']
  );
}

export default { isEnabled, getLoginUrl, getMetadata, validateCallback, handleLogout };
