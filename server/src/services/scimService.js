import crypto from 'crypto';
import { query } from '../db/db.js';
import { now } from '../db/db.js';

const SCIM_ENABLED = process.env.SCIM_ENABLED === 'true';
const SCIM_BEARER_TOKEN = process.env.SCIM_BEARER_TOKEN;

const ROLE_MAP = {
  admin: 'admin',
  editor: 'creator',
  creator: 'creator',
  viewer: 'viewer',
};

export function isEnabled() {
  return SCIM_ENABLED;
}

export function validateToken(authHeader) {
  if (!SCIM_ENABLED) return false;
  if (!SCIM_BEARER_TOKEN || SCIM_BEARER_TOKEN === 'generate-a-secure-random-token-here') {
    throw new Error('SCIM_BEARER_TOKEN is not configured');
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(SCIM_BEARER_TOKEN)
  );
}

function toScimUser(user, baseUrl) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: user.id,
    externalId: user.external_id || undefined,
    userName: user.username,
    name: {
      formatted: user.display_name || user.username,
    },
    displayName: user.display_name || user.username,
    emails: [{ value: user.email, primary: true }],
    active: user.is_active !== false,
    roles: [{ value: user.role, primary: true }],
    meta: {
      resourceType: 'User',
      created: user.created_at,
      lastModified: user.updated_at || user.created_at,
      location: `${baseUrl}/scim/v2/Users/${user.id}`,
    },
  };
}

function toScimGroup(group, members, baseUrl) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: group.id,
    displayName: group.name,
    members: members.map(m => ({
      value: m.user_id,
      display: m.username || m.display_name,
      $ref: `${baseUrl}/scim/v2/Users/${m.user_id}`,
    })),
    meta: {
      resourceType: 'Group',
      created: group.created_at,
      lastModified: group.updated_at || group.created_at,
      location: `${baseUrl}/scim/v2/Groups/${group.id}`,
    },
  };
}

export async function listUsers(filter, startIndex = 1, count = 100, baseUrl = '') {
  let sql = 'SELECT * FROM users WHERE auth_provider = $1';
  const params = ['saml'];

  if (filter) {
    const match = filter.match(/^userName\s+eq\s+"([^"]+)"$/i);
    if (match) {
      sql += ' AND username = $2';
      params.push(match[1]);
    }
    const emailMatch = filter.match(/^emails\.value\s+eq\s+"([^"]+)"$/i);
    if (emailMatch) {
      sql += ' AND email = $2';
      params.push(emailMatch[1]);
    }
    const extMatch = filter.match(/^externalId\s+eq\s+"([^"]+)"$/i);
    if (extMatch) {
      sql += ' AND external_id = $2';
      params.push(extMatch[1]);
    }
  }

  sql += ' ORDER BY created_at ASC';

  const result = await query(sql, params);
  const users = result.rows;
  const sliced = users.slice(startIndex - 1, startIndex - 1 + count);

  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: users.length,
    startIndex,
    itemsPerPage: sliced.length,
    Resources: sliced.map(u => toScimUser(u, baseUrl)),
  };
}

export async function getUser(id, baseUrl = '') {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (!result.rows[0]) return null;
  return toScimUser(result.rows[0], baseUrl);
}

export async function createUser(scimUser, baseUrl = '') {
  const username = scimUser.userName;
  const email = scimUser.emails?.[0]?.value || `${username}@scim.local`;
  const displayName = scimUser.displayName || scimUser.name?.formatted || username;
  const externalId = scimUser.externalId || null;
  const active = scimUser.active !== false;
  const scimRole = scimUser.roles?.[0]?.value;
  const role = ROLE_MAP[scimRole?.toLowerCase()] || 'viewer';

  const existing = await query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
  if (existing.rows.length > 0) {
    const err = new Error(`User ${username} already exists`);
    err.status = 409;
    throw err;
  }

  const id = crypto.randomUUID();
  await query(
    `INSERT INTO users (id, username, email, display_name, role, auth_provider, external_id, scim_managed, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, username, email, displayName, role, 'saml', externalId, true, active]
  );

  const created = await query('SELECT * FROM users WHERE id = $1', [id]);
  return toScimUser(created.rows[0], baseUrl);
}

export async function updateUser(id, scimUser, baseUrl = '') {
  const existing = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (!existing.rows[0]) return null;

  const user = existing.rows[0];
  if (user.auth_provider !== 'saml' && !user.scim_managed) {
    const err = new Error('Cannot modify a non-SCIM user via SCIM');
    err.status = 403;
    throw err;
  }

  const username = scimUser.userName || user.username;
  const email = scimUser.emails?.[0]?.value || user.email;
  const displayName = scimUser.displayName || scimUser.name?.formatted || user.display_name;
  const active = scimUser.active !== undefined ? scimUser.active : user.is_active;
  const scimRole = scimUser.roles?.[0]?.value;
  const role = scimRole ? (ROLE_MAP[scimRole.toLowerCase()] || user.role) : user.role;
  const externalId = scimUser.externalId || user.external_id;

  await query(
    `UPDATE users SET username = $1, email = $2, display_name = $3, role = $4, is_active = $5, external_id = $6, updated_at = ${now()} WHERE id = $7`,
    [username, email, displayName, role, active, externalId, id]
  );

  const updated = await query('SELECT * FROM users WHERE id = $1', [id]);
  return toScimUser(updated.rows[0], baseUrl);
}

export async function patchUser(id, operations, baseUrl = '') {
  const existing = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (!existing.rows[0]) return null;

  const user = existing.rows[0];

  for (const op of operations) {
    const path = op.path?.toLowerCase();
    const value = op.value;

    if (op.op === 'Replace' || op.op === 'replace') {
      if (path === 'active') {
        await query('UPDATE users SET is_active = $1 WHERE id = $2', [value, id]);
      } else if (path === 'username' || path === 'userName') {
        await query('UPDATE users SET username = $1 WHERE id = $2', [value, id]);
      } else if (path === 'displayname' || path === 'displayName') {
        await query('UPDATE users SET display_name = $1 WHERE id = $2', [value, id]);
      } else if (path === 'emails[type eq "work"].value' || path === 'emails') {
        const email = typeof value === 'string' ? value : value?.[0]?.value;
        if (email) await query('UPDATE users SET email = $1 WHERE id = $2', [email, id]);
      } else if (!path && typeof value === 'object') {
        if (value.active !== undefined) {
          await query('UPDATE users SET is_active = $1 WHERE id = $2', [value.active, id]);
        }
      }
    }
  }

  const updated = await query('SELECT * FROM users WHERE id = $1', [id]);
  return toScimUser(updated.rows[0], baseUrl);
}

export async function deleteUser(id) {
  const existing = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (!existing.rows[0]) return false;

  await query('UPDATE users SET is_active = false WHERE id = $1', [id]);
  return true;
}

export async function listGroups(filter, startIndex = 1, count = 100, baseUrl = '') {
  let sql = 'SELECT * FROM user_groups';
  const params = [];

  if (filter) {
    const match = filter.match(/^displayName\s+eq\s+"([^"]+)"$/i);
    if (match) {
      sql += ' WHERE name = $1';
      params.push(match[1]);
    }
  }

  sql += ' ORDER BY created_at ASC';

  const result = await query(sql, params);
  const groups = result.rows;
  const sliced = groups.slice(startIndex - 1, startIndex - 1 + count);

  const resources = [];
  for (const group of sliced) {
    const membersResult = await query(
      'SELECT gm.user_id, u.username, u.display_name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1',
      [group.id]
    );
    resources.push(toScimGroup(group, membersResult.rows, baseUrl));
  }

  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: groups.length,
    startIndex,
    itemsPerPage: sliced.length,
    Resources: resources,
  };
}

export async function getGroup(id, baseUrl = '') {
  const result = await query('SELECT * FROM user_groups WHERE id = $1', [id]);
  if (!result.rows[0]) return null;

  const membersResult = await query(
    'SELECT gm.user_id, u.username, u.display_name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1',
    [id]
  );

  return toScimGroup(result.rows[0], membersResult.rows, baseUrl);
}

export async function createGroup(scimGroup, baseUrl = '') {
  const name = scimGroup.displayName;
  if (!name) {
    const err = new Error('displayName is required');
    err.status = 400;
    throw err;
  }

  const existing = await query('SELECT id FROM user_groups WHERE name = $1', [name]);
  if (existing.rows.length > 0) {
    const err = new Error(`Group ${name} already exists`);
    err.status = 409;
    throw err;
  }

  const id = crypto.randomUUID();
  const systemUserId = (await query("SELECT id FROM users WHERE role = 'owner' LIMIT 1")).rows[0]?.id || id;

  await query(
    'INSERT INTO user_groups (id, name, description, created_by) VALUES ($1, $2, $3, $4)',
    [id, name, scimGroup.description || `SCIM-provisioned group: ${name}`, systemUserId]
  );

  if (scimGroup.members?.length > 0) {
    for (const member of scimGroup.members) {
      const memberId = crypto.randomUUID();
      await query(
        'INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $4)',
        [memberId, id, member.value, systemUserId]
      );
    }
  }

  return getGroup(id, baseUrl);
}

export async function updateGroup(id, scimGroup, baseUrl = '') {
  const existing = await query('SELECT * FROM user_groups WHERE id = $1', [id]);
  if (!existing.rows[0]) return null;

  const name = scimGroup.displayName || existing.rows[0].name;
  await query(`UPDATE user_groups SET name = $1, updated_at = ${now()} WHERE id = $2`, [name, id]);

  await query('DELETE FROM group_members WHERE group_id = $1', [id]);

  if (scimGroup.members?.length > 0) {
    const systemUserId = (await query("SELECT id FROM users WHERE role = 'owner' LIMIT 1")).rows[0]?.id;
    for (const member of scimGroup.members) {
      const memberId = crypto.randomUUID();
      await query(
        'INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $4)',
        [memberId, id, member.value, systemUserId]
      );
    }
  }

  return getGroup(id, baseUrl);
}

export async function patchGroup(id, operations, baseUrl = '') {
  const existing = await query('SELECT * FROM user_groups WHERE id = $1', [id]);
  if (!existing.rows[0]) return null;

  const systemUserId = (await query("SELECT id FROM users WHERE role = 'owner' LIMIT 1")).rows[0]?.id;

  for (const op of operations) {
    const action = op.op?.toLowerCase();
    const path = op.path?.toLowerCase();

    if (action === 'add' && path === 'members') {
      const members = Array.isArray(op.value) ? op.value : [op.value];
      for (const member of members) {
        const check = await query(
          'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
          [id, member.value]
        );
        if (check.rows.length === 0) {
          const memberId = crypto.randomUUID();
          await query(
            'INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $4)',
            [memberId, id, member.value, systemUserId]
          );
        }
      }
    } else if (action === 'remove' && path?.startsWith('members[')) {
      const valueMatch = path.match(/members\[value\s+eq\s+"([^"]+)"\]/i);
      if (valueMatch) {
        await query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [id, valueMatch[1]]);
      }
    } else if (action === 'replace' && path === 'displayname') {
      await query(`UPDATE user_groups SET name = $1, updated_at = ${now()} WHERE id = $2`, [op.value, id]);
    }
  }

  return getGroup(id, baseUrl);
}

export async function deleteGroup(id) {
  const existing = await query('SELECT id FROM user_groups WHERE id = $1', [id]);
  if (!existing.rows[0]) return false;

  await query('DELETE FROM group_members WHERE group_id = $1', [id]);
  await query('DELETE FROM user_groups WHERE id = $1', [id]);
  return true;
}

export default {
  isEnabled, validateToken,
  listUsers, getUser, createUser, updateUser, patchUser, deleteUser,
  listGroups, getGroup, createGroup, updateGroup, patchGroup, deleteGroup,
};
