const { expect } = require('chai');
const routerFactory = require('../../../../app/web-pubsub/router');

const authentication = {
  user: { uid: 'user-1', forename: 'Test', surname: 'User' }, token: 'Bearer token'
};
const authSession = { get: async () => authentication };
const caseAccessChecker = { assertUserHasAccess: async () => undefined };
const createRouter = (client, handlers) => routerFactory(
  client, handlers, authSession, caseAccessChecker
);

describe('web-pubsub.router', () => {
  const calls = [];
  const serviceClient = {};
  const handlers = {
    cleanupReconnectedUser: async (...args) => calls.push(['cleanupReconnectedUser', ...args]),
    addActivity: async (...args) => calls.push(['addActivity', ...args]),
    watch: async (...args) => calls.push(['watch', ...args]),
    stop: async (...args) => calls.push(['stop', ...args]),
    stopAll: async (...args) => calls.push(['stopAll', ...args]),
    removeConnectionActivity: async (...args) => calls.push(['removeConnectionActivity', ...args])
  };
  const response = {
    states: {},
    setState(name, value) {
      this.states[name] = value;
    },
    success(value, dataType) {
      this.result = dataType === undefined
        ? ['success', value]
        : ['success', value, dataType];
    },
    fail(code, detail) {
      this.result = ['fail', code, detail];
    }
  };

  beforeEach(() => {
    calls.length = 0;
    response.states = {};
    response.result = undefined;
  });

  it('cleans stale activity before accepting a reconnected user', async () => {
    const router = createRouter(serviceClient, handlers);
    const user = { uid: 'user-1', forename: 'Test', surname: 'User' };

    await router.handleConnect({
      context: { connectionId: 'connection-1', states: {}, userId: 'user-1' },
      queries: { user: [JSON.stringify(user)] }
    }, response);

    expect(response.result).to.deep.equal(['success', { userId: 'user-1' }]);
    expect(calls[0]).to.deep.equal(['cleanupReconnectedUser', 'user-1', 'connection-1']);
    expect(response.states.user.name).to.equal('Test User');
    expect(response.states.rooms).to.deep.equal([]);
  });

  it('rejects a user that does not match the negotiated token', async () => {
    const router = createRouter(serviceClient, handlers);

    await router.handleConnect({
      context: { states: {}, userId: 'user-2' },
      queries: { user: [JSON.stringify({ uid: 'user-2' })] }
    }, response);

    expect(response.result).to.deep.equal([
      'fail',
      401,
      'The user does not match the access token'
    ]);
  });

  it('routes a view message through the retained activity flow', async () => {
    const router = createRouter(serviceClient, handlers);
    await router.handleUserEvent({
      context: {
        connectionId: 'connection-1',
        userId: 'user-1',
        eventName: 'view',
        states: { user: { uid: 'user-1', name: 'Test User' }, rooms: [] }
      },
      data: { caseId: '111' }
    }, response);

    expect(calls[0][0]).to.equal('addActivity');
    expect(calls[0][1].id).to.equal('connection-1');
    expect(calls[0][2]).to.equal('111');
    expect(calls[0][4]).to.equal('view');
    expect(response.result).to.deep.equal(['success', undefined]);
  });

  it('waits for activity processing before acknowledging the message', async () => {
    let completeActivity;
    const delayedHandlers = {
      ...handlers,
      addActivity: () => new Promise((resolve) => {
        completeActivity = resolve;
      })
    };
    const router = createRouter(serviceClient, delayedHandlers);
    const result = router.handleUserEvent({
      context: {
        connectionId: 'connection-1',
        userId: 'user-1',
        eventName: 'edit',
        states: { user: { uid: 'user-1', name: 'Test User' }, rooms: [] }
      },
      data: { caseId: '111' }
    }, response);

    expect(response.result).to.equal(undefined);
    await new Promise((resolve) => setImmediate(resolve));
    completeActivity();
    await result;
    expect(response.result).to.deep.equal(['success', undefined]);
  });

  it('acknowledges watch after handler completion', async () => {
    const router = createRouter(serviceClient, handlers);

    await router.handleUserEvent({
      context: {
        connectionId: 'connection-1',
        userId: 'user-1',
        eventName: 'watch',
        states: { user: { uid: 'user-1', name: 'Test User' }, rooms: [] }
      },
      data: { caseIds: ['111'] }
    }, response);

    expect(calls[0][0]).to.equal('watch');
    expect(calls[0][2]).to.deep.equal(['111']);
    expect(response.result).to.deep.equal(['success', undefined]);
  });

  it('accepts watch payload with a single caseId', async () => {
    const router = createRouter(serviceClient, {
      ...handlers,
      watch: async (...args) => {
        calls.push(['watch', ...args]);
      }
    });

    await router.handleUserEvent({
      context: {
        connectionId: 'connection-1',
        userId: 'user-1',
        eventName: 'watch',
        states: { user: { uid: 'user-1', name: 'Test User' }, rooms: [] }
      },
      data: { caseId: '111' }
    }, response);

    expect(calls[0][0]).to.equal('watch');
    expect(calls[0][2]).to.deep.equal(['111']);
    expect(response.result).to.deep.equal(['success', undefined]);
  });

  it('routes stop to handlers.stop', async () => {
    const router = createRouter(serviceClient, handlers);
    await router.handleUserEvent({
      context: {
        connectionId: 'connection-1',
        userId: 'user-1',
        eventName: 'stop',
        states: { user: { uid: 'user-1', name: 'Test User' }, rooms: ['c:111'] }
      },
      data: { caseId: '111' }
    }, response);

    expect(calls[0][0]).to.equal('stop');
    expect(calls[0][2]).to.equal('111');
    expect(response.result).to.deep.equal(['success', undefined]);
  });

  it('routes stopAll to handlers.stopAll with normalised caseIds', async () => {
    const router = createRouter(serviceClient, handlers);
    await router.handleUserEvent({
      context: {
        connectionId: 'connection-1',
        userId: 'user-1',
        eventName: 'stopAll',
        states: { user: { uid: 'user-1', name: 'Test User' }, rooms: ['c:111', 'c:222'] }
      },
      data: { caseIds: ['111', '222'] }
    }, response);

    expect(calls[0][0]).to.equal('stopAll');
    expect(calls[0][2]).to.deep.equal(['111', '222']);
    expect(response.result).to.deep.equal(['success', undefined]);
  });

  it('rejects watch payload without caseIds', async () => {
    const router = createRouter(serviceClient, handlers);
    await router.handleUserEvent({
      context: {
        connectionId: 'connection-1',
        userId: 'user-1',
        eventName: 'watch',
        states: { user: { uid: 'user-1', name: 'Test User' }, rooms: [] }
      },
      data: {}
    }, response);

    expect(response.result).to.deep.equal(['fail', 400, 'watch requires at least one caseId']);
  });

  it('rejects unsupported client events', () => {
    const router = createRouter(serviceClient, handlers);
    router.handleUserEvent({
      context: { connectionId: 'connection-1', eventName: 'unknown', states: {} },
      data: {}
    }, response);

    expect(response.result).to.deep.equal(['fail', 400, 'Unsupported event: unknown']);
  });
});
