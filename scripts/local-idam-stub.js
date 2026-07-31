const http = require('node:http');

const defaultUser = {
  uid: 'local-user',
  given_name: 'Local',
  family_name: 'Caseworker',
  roles: ['caseworker-local'],
};

const TOKEN_USER_PREFIX = 'local-dev-user:';

const sanitizeUid = (value) => String(value || '')
  .trim()
  .replace(/[^A-Za-z0-9_-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 64);

const decodeBase64Url = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch (error) {
    return null;
  }
};

const parseJwtPayload = (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const payloadText = decodeBase64Url(parts[1]);
  if (!payloadText) {
    return null;
  }
  try {
    const payload = JSON.parse(payloadText);
    return payload && typeof payload === 'object' ? payload : null;
  } catch (error) {
    return null;
  }
};

const inferNamesFromSubject = (subject) => {
  if (!subject || typeof subject !== 'string') {
    return {};
  }
  const localPart = subject.split('@')[0];
  const segments = localPart.split(/[-_.]/).filter(Boolean);
  if (segments.length < 2) {
    return {};
  }
  return {
    given_name: segments[0],
    family_name: segments[1]
  };
};

const userFromJwtPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const uid = sanitizeUid(payload.uid || payload.idamId || payload.id || payload.sub || payload.subname);
  if (!uid) {
    return null;
  }

  const inferredNames = inferNamesFromSubject(payload.subname || payload.sub);
  const given_name = payload.given_name || payload.forename || inferredNames.given_name || defaultUser.given_name;
  const family_name = payload.family_name || payload.surname || inferredNames.family_name || defaultUser.family_name;
  const name = payload.name || `${given_name} ${family_name}`.trim();

  return {
    uid,
    id: uid,
    given_name,
    family_name,
    name,
    roles: Array.isArray(payload.roles) && payload.roles.length > 0
      ? payload.roles
      : defaultUser.roles
  };
};

const getBearerToken = (authorization) => {
  if (!authorization || typeof authorization !== 'string') {
    return '';
  }
  const [scheme, token] = authorization.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') {
    return '';
  }
  return token.trim();
};

const getUserFromAuthorization = (authorization) => {
  const token = getBearerToken(authorization);
  if (!token || token === 'local-dev-token') {
    return defaultUser;
  }

  if (token.startsWith(TOKEN_USER_PREFIX)) {
    const requestedUid = sanitizeUid(token.slice(TOKEN_USER_PREFIX.length));
    if (requestedUid) {
      return {
        ...defaultUser,
        uid: requestedUid,
        family_name: requestedUid,
      };
    }
    return defaultUser;
  }

  const jwtPayload = parseJwtPayload(token);
  const jwtUser = userFromJwtPayload(jwtPayload);
  if (jwtUser) {
    return jwtUser;
  }

  // For unknown tokens, preserve the stable local user identity rather than
  // leaking bearer token content into user fields.
  return {
    ...defaultUser,
    uid: 'local-user',
  };
};

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};

const createLocalIdamStub = () => http.createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/o/userinfo') {
    sendJson(response, 404, { message: 'Not Found' });
    return;
  }

  if (!request.headers.authorization) {
    sendJson(response, 401, { message: 'Authorization header is required' });
    return;
  }

  sendJson(response, 200, getUserFromAuthorization(request.headers.authorization));
});

if (require.main === module) {
  const host = 'localhost';
  const port = Number(process.env.IDAM_STUB_PORT || 5000);
  const server = createLocalIdamStub();

  server.listen(port, host, () => {
    process.stdout.write(`Local IDAM stub listening at http://${host}:${port}\n`);
  });
}

module.exports = { createLocalIdamStub, defaultUser, getUserFromAuthorization };
