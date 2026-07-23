const { expect } = require('chai');
const createRouter = require('../../../../app/web-pubsub/router');

describe('web-pubsub.router', () => {
  const calls = [];
  const serviceClient = {};
  const handlers = {
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
    success(value) {
      this.result = ['success', value];
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

  it('accepts a connection and retains the user in connection state', () => {
    const router = createRouter(serviceClient, handlers);
    const user = { uid: 'user-1', forename: 'Test', surname: 'User' };

    router.handleConnect({
      context: { states: {}, userId: 'user-1' },
      queries: { user: [JSON.stringify(user)] }
    }, response);

    expect(response.result).to.deep.equal(['success', { userId: 'user-1' }]);
    expect(response.states.user.name).to.equal('Test User');
    expect(response.states.rooms).to.deep.equal([]);
  });

  it('rejects a user that does not match the negotiated token', () => {
    const router = createRouter(serviceClient, handlers);

    router.handleConnect({
      context: { states: {}, userId: 'user-1' },
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
    router.handleUserEvent({
      context: {
        connectionId: 'connection-1',
        eventName: 'view',
        states: { user: { uid: 'user-1', name: 'Test User' }, rooms: [] }
      },
      data: { caseId: 'case-1' }
    }, response);
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls[0][0]).to.equal('addActivity');
    expect(calls[0][1].id).to.equal('connection-1');
    expect(calls[0][2]).to.equal('case-1');
    expect(calls[0][4]).to.equal('view');
    expect(response.result).to.deep.equal(['success', undefined]);
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
