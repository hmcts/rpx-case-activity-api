const { expect } = require('chai');
const sinon = require('sinon');
const createAuthSession = require('../../../../app/web-pubsub/auth-session');

describe('web-pubsub.auth-session', () => {
  beforeEach(() => sinon.useFakeTimers({ now: 1800000000000, toFake: ['Date'] }));
  afterEach(() => sinon.restore());

  it('stores credentials with an expiry and returns only an opaque reference', async () => {
    const redis = { set: sinon.stub().resolves('OK'), get: sinon.stub() };
    const sessions = createAuthSession(redis);
    const authentication = { user: { uid: 'user-1' }, token: 'Bearer secret' };
    const storedAuthentication = { ...authentication, expiresAt: Date.now() + 3600000 };
    const id = await sessions.create(authentication);
    expect(id).to.match(/^[a-f0-9-]{36}$/);
    expect(id).not.to.contain('secret');
    expect(redis.set.firstCall.args).to.deep.equal([
      `web-pubsub:auth:${id}`, JSON.stringify(storedAuthentication), 'EX', 3600
    ]);
    redis.get.resolves(JSON.stringify(storedAuthentication));
    expect(await sessions.get(id)).to.deep.equal(storedAuthentication);
  });

  it('rejects unknown, expired and malformed session references', async () => {
    const redis = { get: sinon.stub().resolves(null) };
    const sessions = createAuthSession(redis);
    const results = await Promise.all(
      [undefined, '', 'attacker-controlled-key', {}].map((id) => sessions.get(id))
    );
    expect(results).to.deep.equal([null, null, null, null]);
    expect(redis.get.called).to.equal(false);
    expect(await sessions.get('00000000-0000-0000-0000-000000000000')).to.equal(null);
  });

  it('does not issue a session when Redis cannot persist credentials', async () => {
    const sessions = createAuthSession({ set: sinon.stub().rejects(new Error('unavailable')) });
    try {
      await sessions.create({ user: { uid: 'user-1' }, token: 'Bearer secret' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error.message).to.equal('unavailable');
    }
  });

  function jwt(exp) {
    return `Bearer e30.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
  }

  it('expires the session with the earliest upstream credential', async () => {
    const redis = { set: sinon.stub().resolves('OK') };
    const sessions = createAuthSession(redis);
    await sessions.create({
      user: { uid: 'user-1' },
      token: jwt(Date.now() / 1000 + 600),
      serviceAuthorization: jwt(Date.now() / 1000 + 300)
    });
    expect(redis.set.firstCall.args[3]).to.equal(300);
    expect(JSON.parse(redis.set.firstCall.args[1]).expiresAt).to.equal(Date.now() + 300000);
  });

  it('rejects expired credentials and expired stored sessions', async () => {
    const redis = {
      set: sinon.stub(), get: sinon.stub().resolves(JSON.stringify({ expiresAt: Date.now() - 1 }))
    };
    const sessions = createAuthSession(redis);
    try {
      await sessions.create({ token: jwt(Date.now() / 1000 - 10) });
      throw new Error('expected failure');
    } catch (error) {
      expect(error.status).to.equal(401);
    }
    expect(redis.set.called).to.equal(false);
    expect(await sessions.get('00000000-0000-0000-0000-000000000000')).to.equal(null);
  });
});
