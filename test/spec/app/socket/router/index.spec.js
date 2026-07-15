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

  const MOCK_SOCKET_SERVER = createMockEventEmitter();
  const MOCK_IO_ROUTER = {
    ...createMockEventEmitter(),
    attachments: [],
    attach: (socket, packet, next) => {
      MOCK_IO_ROUTER.attachments.push({ socket, packet, next });
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
    router.init(MOCK_SOCKET_SERVER, MOCK_IO_ROUTER, MOCK_HANDLERS);
  });

  afterEach(() => {
    MOCK_SOCKET_SERVER.events = {};
    MOCK_IO_ROUTER.events = {};
    MOCK_IO_ROUTER.attachments.length = 0;
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
    it('should have set up the appropriate events on the io router', () => {
      const EXPECTED_EVENTS = ['view', 'edit', 'watch', 'stop', 'stopAll'];
      EXPECTED_EVENTS.forEach((event) => {
        expect(MOCK_IO_ROUTER.events[event]).to.be.a('function');
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

  describe('iorouter', () => {
    const MOCK_CONTEXT = {
      request: {
        caseId: '1234567890',
        caseIds: ['2345678901', '3456789012', '4567890123']
      }
    };
    const MOCK_JSON_USER = MOCK_SOCKET.handshake.auth.user;

    const testActivityHandler = (activity, expectedMethod = 'addActivity', expectedContext = MOCK_CONTEXT) => {
      let nextCalled = false;
      MOCK_IO_ROUTER.dispatch(activity, MOCK_SOCKET, expectedContext, () => {
        nextCalled = true;
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
      });
      expect(nextCalled).to.be.true;
    };

    beforeEach(() => {
      // Dispatch the connection each time.
      MOCK_SOCKET_SERVER.dispatch('connection', MOCK_SOCKET);
    });

    it('should appropriately handle registering a user', () => {
      expect(router.getUser(MOCK_SOCKET.id)).to.deep.equal(MOCK_JSON_USER);
    });

    it('should appropriately handle viewing a case', () => {
      testActivityHandler('view');
    });

    it('should appropriately handle editing a case', () => {
      testActivityHandler('edit');
    });
    it('should appropriately handle watching cases', () => {
      testActivityHandler('watch', 'watch');
    });
    it('should appropriately handle stopping activity', () => {
      testActivityHandler('stop', 'stop');
    });
    it('should appropriately handle stopping all cases', () => {
      testActivityHandler('stopAll', 'stopAll');
    });
    it('should wait for async stop handling before continuing', async () => {
      let resolveStop;
      MOCK_HANDLERS.stopPromise = new Promise((resolve) => {
        resolveStop = resolve;
      });
      let nextCalled = false;

      const dispatchPromise = MOCK_IO_ROUTER.dispatch('stop', MOCK_SOCKET, MOCK_CONTEXT, () => {
        nextCalled = true;
      });

      expect(nextCalled).to.be.false;
      resolveStop();
      await dispatchPromise;
      expect(nextCalled).to.be.true;
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
      expect(MOCK_SOCKET.using).to.have.lengthOf(1);
      expect(MOCK_SOCKET.using[0]).to.be.a('function');
      expect(MOCK_SOCKET.events.disconnect).to.be.a('function');
      expect(MOCK_SOCKET.events.disconnecting).to.be.a('function');
      expect(MOCK_SOCKET.events.error).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.close).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.error).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.upgrade).to.be.a('function');
      expect(MOCK_SOCKET.conn.events.packet).to.be.a('function');
    });
    it('should handle a socket use', () => {
      const useFn = MOCK_SOCKET.using[0];
      const PACKET = 'packet';
      const NEXT_FN = () => {};

      expect(MOCK_IO_ROUTER.attachments).to.have.lengthOf(0);
      useFn(PACKET, NEXT_FN);
      expect(MOCK_IO_ROUTER.attachments).to.have.lengthOf(1);
      expect(MOCK_IO_ROUTER.attachments[0].socket).to.equal(MOCK_SOCKET);
      expect(MOCK_IO_ROUTER.attachments[0].packet).to.equal(PACKET);
      expect(MOCK_IO_ROUTER.attachments[0].next).to.equal(NEXT_FN);
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
