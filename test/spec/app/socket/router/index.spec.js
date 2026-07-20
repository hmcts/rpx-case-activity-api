const expect = require('chai').expect;
const router = require('../../../../../app/socket/router');

describe('socket.router', () => {
  const createMockEventEmitter = () => ({
    events: {},
    on: function(event, eventHandler) {
      this.events[event] = eventHandler;
    },
    dispatch: function(event, ...args) {
      const handler = this.events[event];
      if (handler) {
        return handler(...args);
      }
      return null;
    }
  });

  const MOCK_SOCKET_SERVER = {
    ...createMockEventEmitter(),
    engine: {
      opts: {
        pingInterval: 25000,
        pingTimeout: 20000
      }
    }
  };
  const MOCK_HANDLERS = {
    calls: [],
    stopPromise: null,
    addActivity: (socket, caseId, user, activity) => {
      const params = { socket, caseId, user, activity };
      MOCK_HANDLERS.calls.push({ method: 'addActivity', params });
    },
    watch: (socket, caseIds) => {
      const params = { socket, caseIds };
      MOCK_HANDLERS.calls.push({ method: 'watch', params });
    },
    stop: (socket, caseId, user, activity) => {
      const params = { socket, caseId, user, activity };
      MOCK_HANDLERS.calls.push({ method: 'stop', params });
      return MOCK_HANDLERS.stopPromise;
    },
    stopAll: (socket, caseIds) => {
      const params = { socket, caseIds };
      MOCK_HANDLERS.calls.push({ method: 'stopAll', params });
    },
    refreshSocketActivity: async (socket, user) => {
      const params = { socket, user };
      MOCK_HANDLERS.calls.push({ method: 'refreshSocketActivity', params });
    },
    removeSocketActivity: async (socketId) => {
      const params = { socketId };
      MOCK_HANDLERS.calls.push({ method: 'removeSocketActivity', params });
    }
  };
  const MOCK_SOCKET = {
    id: 'socket-id',
    handshake: {
      address: '10.0.0.1',
      headers: {
        'x-forwarded-for': '192.0.2.1',
        'x-request-id': 'request-id',
        'user-agent': 'socket-test-client',
        origin: 'https://example.test'
      },
      auth: {
        user: { id: 'a', uid: 'idam-user-id', name: 'Bob Smith' }
      },
      query: {
        user: JSON.stringify({ id: 'legacy', uid: 'legacy-user-id', name: 'Legacy User' })
      }
    },
    rooms: ['socket-id'],
    conn: {
      id: 'engine-socket-id',
      transport: {
        name: 'websocket',
        writable: true
      },
      readyState: 'open',
      events: {},
      on: function(event, eventHandler) {
        this.events[event] = eventHandler;
      },
      dispatch: function(event, ...args) {
        const handler = this.events[event];
        if (handler) {
          return handler(...args);
        }
        return null;
      }
    },
    events: {},
    messages: [],
    using: [],
    join: (room) => {
      if (!MOCK_SOCKET.rooms.includes(room)) {
        MOCK_SOCKET.rooms.push(room);
      }
    },
    leave: (room) => {
      const roomIndex = MOCK_SOCKET.rooms.indexOf(room);
      if (roomIndex > -1) {
        MOCK_SOCKET.rooms.splice(roomIndex, 1);
      }
    },
    emit: (event, message) => {
      MOCK_SOCKET.messages.push({ event, message });
    },
    use: (fn) => {
      MOCK_SOCKET.using.push(fn);
    },
    on: (event, eventHandler) => {
      MOCK_SOCKET.events[event] = eventHandler;
    },
    dispatch: (event, ...args) => {
      const handler = MOCK_SOCKET.events[event];
      if (handler) {
        return handler(...args);
      }
      return null;
    }
  };

  beforeEach(() => {
    router.init(MOCK_SOCKET_SERVER, MOCK_HANDLERS);
  });

  afterEach(() => {
    MOCK_SOCKET_SERVER.events = {};
    MOCK_HANDLERS.calls.length = 0;
    MOCK_HANDLERS.stopPromise = null;
    MOCK_SOCKET.using.length = 0;
    MOCK_SOCKET.conn.events = {};
    router.removeUser(MOCK_SOCKET.id);
    router.removeConnection(MOCK_SOCKET);
  });

  describe('init', () => {
    it('should have set up the appropriate events on the socket server', () => {
      const EXPECTED_EVENTS = ['connection'];
      EXPECTED_EVENTS.forEach((event) => {
        expect(MOCK_SOCKET_SERVER.events[event]).to.be.a('function');
      });
    });
    it('should accept the legacy query user when auth is not present', () => {
      const auth = MOCK_SOCKET.handshake.auth;
      try {
        delete MOCK_SOCKET.handshake.auth;
        MOCK_SOCKET_SERVER.dispatch('connection', MOCK_SOCKET);

        expect(router.getUser(MOCK_SOCKET.id))
          .to.deep.equal(JSON.parse(MOCK_SOCKET.handshake.query.user));
      } finally {
        MOCK_SOCKET.handshake.auth = auth;
      }
    });
  });

  describe('socket routes', () => {
    const MOCK_CONTEXT = {
      request: {
        caseId: '1234567890',
        caseIds: ['2345678901', '3456789012', '4567890123']
      }
    };
    const MOCK_JSON_USER = MOCK_SOCKET.handshake.auth.user;

    const testActivityHandler = async (
      activity,
      expectedMethod = 'addActivity',
      expectedContext = MOCK_CONTEXT
    ) => {
      await MOCK_SOCKET.dispatch(activity, expectedContext.request);
        expect(MOCK_HANDLERS.calls).to.have.lengthOf(1);
        expect(MOCK_HANDLERS.calls[0].method).to.equal(expectedMethod);
        expect(MOCK_HANDLERS.calls[0].params.socket).to.equal(MOCK_SOCKET);
        
        if (expectedMethod === 'addActivity') {
          expect(MOCK_HANDLERS.calls[0].params.caseId).to.equal(expectedContext.request.caseId);
          expect(MOCK_HANDLERS.calls[0].params.user).to.deep.equal(MOCK_JSON_USER);
          expect(MOCK_HANDLERS.calls[0].params.activity).to.equal(activity);
        } else if (expectedMethod === 'watch') {
          expect(MOCK_HANDLERS.calls[0].params.caseIds).to.deep.equal(expectedContext.request.caseIds);
        } else if (expectedMethod === 'stopAll') {
          expect(MOCK_HANDLERS.calls[0].params.caseIds).to.deep.equal(expectedContext.request.caseIds);
        } else if (expectedMethod === 'stop') {
          expect(MOCK_HANDLERS.calls[0].params.caseId).to.equal(expectedContext.request.caseId);
          expect(MOCK_HANDLERS.calls[0].params.user).to.deep.equal(MOCK_JSON_USER);
          expect(MOCK_HANDLERS.calls[0].params.activity).to.equal(activity);
        }
    };

    beforeEach(() => {
      // Dispatch the connection each time.
      MOCK_SOCKET_SERVER.dispatch('connection', MOCK_SOCKET);
    });

    it('should appropriately handle registering a user', () => {
      expect(router.getUser(MOCK_SOCKET.id)).to.deep.equal(MOCK_JSON_USER);
    });

    it('should appropriately handle viewing a case', async () => {
      await testActivityHandler('view');
    });
    it('should appropriately handle editing a case', async () => {
      await testActivityHandler('edit');
    });
    it('should appropriately handle watching cases', async () => {
      await testActivityHandler('watch', 'watch');
    });
    it('should appropriately handle stopping activity', async () => {
      await testActivityHandler('stop', 'stop');
    });
    it('should appropriately handle stopping all cases', async () => {
      await testActivityHandler('stopAll', 'stopAll');
    });
    it('should wait for async stop handling before continuing', async () => {
      let resolveStop;
      MOCK_HANDLERS.stopPromise = new Promise((resolve) => {
        resolveStop = resolve;
      });
      const dispatchPromise = MOCK_SOCKET.dispatch('stop', MOCK_CONTEXT.request);
      expect(MOCK_HANDLERS.calls).to.have.lengthOf(1);
      resolveStop();
      await dispatchPromise;
      expect(MOCK_HANDLERS.calls[0].method).to.equal('stop');
    });
  });

  describe('io', () => {
    beforeEach(() => {
      // Dispatch the connection each time.
      MOCK_SOCKET_SERVER.dispatch('connection', MOCK_SOCKET);
    });
    it('should appropriately handle a new connection', () => {
      expect(router.getConnections()).to.have.lengthOf(1)
        .and.to.contain(MOCK_SOCKET);
      expect(MOCK_SOCKET.events.view).to.be.a('function');
      expect(MOCK_SOCKET.events.edit).to.be.a('function');
      expect(MOCK_SOCKET.events.watch).to.be.a('function');
      expect(MOCK_SOCKET.events.stop).to.be.a('function');
      expect(MOCK_SOCKET.events.stopAll).to.be.a('function');
      expect(MOCK_SOCKET.events.disconnect).to.be.a('function');
      expect(MOCK_SOCKET.events.disconnecting).to.be.a('function');
      expect(MOCK_SOCKET.events.error).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.close).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.error).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.upgrade).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.packet).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.packetCreate).to.be.a('function');
    });
    it('should handle a socket disconnecting', () => {
      MOCK_SOCKET.dispatch('disconnecting', 'transport close');
      MOCK_SOCKET.dispatch('disconnect', 'transport close');
      expect(MOCK_HANDLERS.calls).to.have.lengthOf(1);
      expect(MOCK_HANDLERS.calls[0].method).to.equal('removeSocketActivity');
      expect(MOCK_HANDLERS.calls[0].params.socketId).to.equal(MOCK_SOCKET.id);
      expect(router.getUser(MOCK_SOCKET.id)).to.be.undefined;
      expect(router.getConnections()).to.have.lengthOf(0);
    });
    it('should handle socket connection close and error diagnostics', () => {
      MOCK_SOCKET.conn.dispatch('upgrade', { name: 'websocket' });
      MOCK_SOCKET.conn.dispatch('error', new Error('engine transport failure'));
      MOCK_SOCKET.conn.dispatch(
        'close',
        'transport close',
        new Error('websocket connection closed')
      );
      MOCK_SOCKET.dispatch('error', new Error('socket middleware failure'));

      expect(router.getUser(MOCK_SOCKET.id))
        .to.deep.equal(MOCK_SOCKET.handshake.auth.user);
      expect(router.getConnections()).to.have.lengthOf(1);
      expect(MOCK_HANDLERS.calls).to.have.lengthOf(0);
    });
    it('should refresh socket activity when an Engine.IO pong is received', async () => {
      MOCK_SOCKET.conn.dispatch('packetCreate', { type: 'ping' });
      await MOCK_SOCKET.conn.dispatch('packet', { type: 'pong' });

      expect(MOCK_HANDLERS.calls).to.have.lengthOf(1);
      expect(MOCK_HANDLERS.calls[0].method).to.equal('refreshSocketActivity');
      expect(MOCK_HANDLERS.calls[0].params.socket).to.equal(MOCK_SOCKET);
      expect(MOCK_HANDLERS.calls[0].params.user).to.deep.equal(
        MOCK_SOCKET.handshake.auth.user
      );
    });
  });

});
