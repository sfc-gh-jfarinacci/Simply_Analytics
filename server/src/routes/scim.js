import { Router } from 'express';
import scimService from '../services/scimService.js';

export const scimRoutes = Router();

function scimAuth(req, res, next) {
  if (!scimService.isEnabled()) {
    return res.status(404).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'SCIM is not enabled', status: '404' });
  }
  try {
    if (!scimService.validateToken(req.headers.authorization)) {
      return res.status(401).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Unauthorized', status: '401' });
    }
  } catch (err) {
    return res.status(500).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: err.message, status: '500' });
  }
  next();
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function scimError(res, status, detail) {
  return res.status(status).json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    detail,
    status: String(status),
  });
}

scimRoutes.use(scimAuth);
scimRoutes.use((req, res, next) => {
  res.set('Content-Type', 'application/scim+json');
  next();
});

// --- Users ---

scimRoutes.get('/Users', async (req, res) => {
  try {
    const result = await scimService.listUsers(
      req.query.filter,
      parseInt(req.query.startIndex) || 1,
      parseInt(req.query.count) || 100,
      getBaseUrl(req)
    );
    res.json(result);
  } catch (err) {
    scimError(res, 500, err.message);
  }
});

scimRoutes.get('/Users/:id', async (req, res) => {
  try {
    const user = await scimService.getUser(req.params.id, getBaseUrl(req));
    if (!user) return scimError(res, 404, 'User not found');
    res.json(user);
  } catch (err) {
    scimError(res, 500, err.message);
  }
});

scimRoutes.post('/Users', async (req, res) => {
  try {
    const user = await scimService.createUser(req.body, getBaseUrl(req));
    res.status(201).json(user);
  } catch (err) {
    scimError(res, err.status || 500, err.message);
  }
});

scimRoutes.put('/Users/:id', async (req, res) => {
  try {
    const user = await scimService.updateUser(req.params.id, req.body, getBaseUrl(req));
    if (!user) return scimError(res, 404, 'User not found');
    res.json(user);
  } catch (err) {
    scimError(res, err.status || 500, err.message);
  }
});

scimRoutes.patch('/Users/:id', async (req, res) => {
  try {
    const operations = req.body.Operations || req.body.operations || [];
    const user = await scimService.patchUser(req.params.id, operations, getBaseUrl(req));
    if (!user) return scimError(res, 404, 'User not found');
    res.json(user);
  } catch (err) {
    scimError(res, err.status || 500, err.message);
  }
});

scimRoutes.delete('/Users/:id', async (req, res) => {
  try {
    const deleted = await scimService.deleteUser(req.params.id);
    if (!deleted) return scimError(res, 404, 'User not found');
    res.status(204).end();
  } catch (err) {
    scimError(res, 500, err.message);
  }
});

// --- Groups ---

scimRoutes.get('/Groups', async (req, res) => {
  try {
    const result = await scimService.listGroups(
      req.query.filter,
      parseInt(req.query.startIndex) || 1,
      parseInt(req.query.count) || 100,
      getBaseUrl(req)
    );
    res.json(result);
  } catch (err) {
    scimError(res, 500, err.message);
  }
});

scimRoutes.get('/Groups/:id', async (req, res) => {
  try {
    const group = await scimService.getGroup(req.params.id, getBaseUrl(req));
    if (!group) return scimError(res, 404, 'Group not found');
    res.json(group);
  } catch (err) {
    scimError(res, 500, err.message);
  }
});

scimRoutes.post('/Groups', async (req, res) => {
  try {
    const group = await scimService.createGroup(req.body, getBaseUrl(req));
    res.status(201).json(group);
  } catch (err) {
    scimError(res, err.status || 500, err.message);
  }
});

scimRoutes.put('/Groups/:id', async (req, res) => {
  try {
    const group = await scimService.updateGroup(req.params.id, req.body, getBaseUrl(req));
    if (!group) return scimError(res, 404, 'Group not found');
    res.json(group);
  } catch (err) {
    scimError(res, err.status || 500, err.message);
  }
});

scimRoutes.patch('/Groups/:id', async (req, res) => {
  try {
    const operations = req.body.Operations || req.body.operations || [];
    const group = await scimService.patchGroup(req.params.id, operations, getBaseUrl(req));
    if (!group) return scimError(res, 404, 'Group not found');
    res.json(group);
  } catch (err) {
    scimError(res, err.status || 500, err.message);
  }
});

scimRoutes.delete('/Groups/:id', async (req, res) => {
  try {
    const deleted = await scimService.deleteGroup(req.params.id);
    if (!deleted) return scimError(res, 404, 'Group not found');
    res.status(204).end();
  } catch (err) {
    scimError(res, 500, err.message);
  }
});

// --- Service Provider Config ---

scimRoutes.get('/ServiceProviderConfig', (req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'OAuth Bearer Token', description: 'Authentication via bearer token' }],
  });
});

scimRoutes.get('/ResourceTypes', (req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/scim/v2/Users', schema: 'urn:ietf:params:scim:schemas:core:2.0:User' },
      { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'Group', name: 'Group', endpoint: '/scim/v2/Groups', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group' },
    ],
  });
});

scimRoutes.get('/Schemas', (req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User' },
      { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group' },
    ],
  });
});

export default scimRoutes;
