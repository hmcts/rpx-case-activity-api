const { randomUUID } = require('node:crypto');
const jwtDecode = require('jwt-decode');

function tokenExpiresAt(token) {
  try {
    const { exp } = jwtDecode(token.replace(/^Bearer /i, ''));
    return Number.isFinite(exp) ? exp * 1000 : Infinity;
  } catch (error) {
    // Local IDAM and some token providers use opaque tokens. CCD still validates
    // the credential on every protected event; cap server storage at one hour.
    return Infinity;
  }
}

// Keep IDAM credentials in Redis, never in client query strings or Web PubSub states.
module.exports = (redis) => ({
  async create(authentication) {
    const sessionId = randomUUID();
    const expiresAt = Math.min(
      Date.now() + 3600000,
      tokenExpiresAt(authentication.token),
      tokenExpiresAt(authentication.serviceAuthorization)
    );
    const ttl = Math.ceil((expiresAt - Date.now()) / 1000);
    if (ttl < 1) {
      throw Object.assign(new Error('Activity credentials have expired'), { status: 401 });
    }
    await redis.set(
      `web-pubsub:auth:${sessionId}`, JSON.stringify({ ...authentication, expiresAt }), 'EX', ttl
    );
    return sessionId;
  },
  async get(sessionId) {
    if (typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId)) {
      return null;
    }
    const authentication = JSON.parse(await redis.get(`web-pubsub:auth:${sessionId}`));
    return authentication?.expiresAt > Date.now() ? authentication : null;
  }
});
