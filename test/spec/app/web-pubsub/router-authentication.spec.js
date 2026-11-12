const { expect } = require('chai');
const sinon = require('sinon');
const createRouter = require('../../../../app/web-pubsub/router');

describe('Web PubSub authenticated connection lifecycle', () => {
  let clock;
  let sessions;
  let client;
  let handlers;
  let checker;
  let router;
  let response;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    sessions = {
      get: sinon.stub().resolves({
        user: { uid: 'user-1', given_name: 'Test', family_name: 'User' },
        token: 'Bearer user',
        serviceAuthorization: 'Bearer service',
        expiresAt: Date.now() + 60000
      })
    };
    client = { closeConnection: sinon.stub().resolves() };
    handlers = {
      cleanupReconnectedUser: sinon.stub().resolves(),
      removeConnectionActivity: sinon.stub().resolves(),
      addActivity: sinon.stub().resolves(),
      watch: sinon.stub().resolves()
    };
    checker = { assertUserHasAccess: sinon.stub().resolves() };
    response = { fail: sinon.spy(), success: sinon.spy(), setState: sinon.spy() };
    router = createRouter(client, handlers, sessions, checker);
  });

  afterEach(() => clock.restore());

  function connectRequest() {
    return {
      context: { connectionId: 'connection-1', userId: 'user-1', states: {} },
      queries: { session: ['server-session'], user: [JSON.stringify({ uid: 'attacker' })] }
    };
  }

  function eventRequest(eventName) {
    return {
      context: {
        connectionId: 'connection-1',
        userId: 'user-1',
        eventName,
        states: { session: 'server-session', user: { uid: 'attacker' } }
      },
      data: { caseId: '111', caseIds: ['111', '222'] }
    };
  }

  it('binds the connection to the negotiated identity and ignores query user claims', async () => {
    await router.handleConnect(connectRequest(), response);
    expect(sessions.get.firstCall.args).to.deep.equal(['server-session']);
    expect(response.success.firstCall.args).to.deep.equal([{ userId: 'user-1' }]);
    expect(response.setState.firstCall.args[1].uid).to.equal('user-1');
    expect(handlers.cleanupReconnectedUser.firstCall.args).to.deep.equal(['user-1', 'connection-1']);
  });

  it('closes at credential expiry so the existing client reconnect flow can renegotiate', async () => {
    await router.handleConnect(connectRequest(), response);
    await clock.tickAsync(59999);
    expect(client.closeConnection.called).to.equal(false);
    await clock.tickAsync(1);
    expect(client.closeConnection.firstCall.args).to.deep.equal([
      'connection-1', { reason: 'Activity session expired' }
    ]);
  });

  it('cancels expiry cleanup when the connection disconnects', async () => {
    const req = connectRequest();
    await router.handleConnect(req, response);
    router.onDisconnected(req);
    await clock.tickAsync(60001);
    expect(client.closeConnection.called).to.equal(false);
    expect(handlers.removeConnectionActivity.firstCall.args).to.deep.equal(['connection-1']);
  });

  ['view', 'edit', 'watch'].forEach((eventName) => {
    it(`checks ${eventName} with server credentials and identity`, async () => {
      await router.handleUserEvent(eventRequest(eventName), response);
      expect(checker.assertUserHasAccess.firstCall.args).to.deep.equal([
        eventName === 'watch' ? ['111', '222'] : ['111'], 'Bearer user', 'Bearer service'
      ]);
      if (eventName !== 'watch') {
        expect(handlers.addActivity.firstCall.args[2].uid).to.equal('user-1');
      }
      expect(response.success.calledOnce).to.equal(true);
    });

    [null, { user: { uid: 'other-user' }, token: 'Bearer other' }].forEach((session) => {
      it(`rejects ${eventName} with missing/expired or mismatched session before handler access`, async () => {
        sessions.get.resolves(session);
        await router.handleUserEvent(eventRequest(eventName), response);
        expect(response.fail.firstCall.args[0]).to.equal(401);
        expect(checker.assertUserHasAccess.called).to.equal(false);
        expect(handlers.watch.called).to.equal(false);
        expect(handlers.addActivity.called).to.equal(false);
        expect(client.closeConnection.calledOnce).to.equal(true);
      });
    });
  });

  it('fails closed on connect if session storage is unavailable', async () => {
    sessions.get.rejects(new Error('Redis unavailable'));
    await router.handleConnect(connectRequest(), response);
    expect(response.fail.firstCall.args[0]).to.equal(503);
    expect(handlers.cleanupReconnectedUser.called).to.equal(false);
  });

  it('does not subscribe or acknowledge an event while its authorization is pending', async () => {
    let authorize;
    checker.assertUserHasAccess.returns(new Promise((resolve) => { authorize = resolve; }));
    const pending = router.handleUserEvent(eventRequest('watch'), response);
    await clock.tickAsync(0);
    expect(handlers.watch.called).to.equal(false);
    expect(response.success.called).to.equal(false);
    authorize();
    await pending;
    expect(handlers.watch.calledOnce).to.equal(true);
    expect(response.success.calledOnce).to.equal(true);
  });
});
