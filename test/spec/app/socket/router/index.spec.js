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
        handler(...args);
      }
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
    addActivity: (socket, caseId, user, activity) => {
      const params = { socket, caseId, user, activity };
      MOCK_HANDLERS.calls.push({ method: 'addActivity', params });
    },
    watch: (socket, caseIds) => {
      const params = { socket, caseIds };
      MOCK_HANDLERS.calls.push({ method: 'watch', params });
    },
    removeSocketActivity: async (socketId) => {
      const params = { socketId };
      MOCK_HANDLERS.calls.push({ method: 'removeSocketActivity', params });
    }
  };
  const MOCK_SOCKET = {
    id: 'socket-id',
    handshake: {
      query: {
        user: JSON.stringify({ id: 'a', name: 'Bob Smith' })
      }
    },
    rooms: ['socket-id'],
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
    dispatch: (event) => {
      const handler = MOCK_SOCKET.events[event];
      if (handler) {
        handler(MOCK_SOCKET);
      }
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
    MOCK_SOCKET.using.length = 0;
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
      const EXPECTED_EVENTS = ['view', 'edit', 'watch'];
      EXPECTED_EVENTS.forEach((event) => {
        expect(MOCK_IO_ROUTER.events[event]).to.be.a('function');
      });
    });
  });

  describe('iorouter', () => {
    const MOCK_CONTEXT = {
      request: {
        caseId: '1234567890',
        caseIds: ['2345678901', '3456789012', '4567890123']
      }
    };
    const MOCK_JSON_USER = JSON.parse(MOCK_SOCKET.handshake.query.user);

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
      MOCK_SOCKET.dispatch('disconnect');
      expect(MOCK_HANDLERS.calls).to.have.lengthOf(1);
      expect(MOCK_HANDLERS.calls[0].method).to.equal('removeSocketActivity');
      expect(MOCK_HANDLERS.calls[0].params.socketId).to.equal(MOCK_SOCKET.id);
      expect(router.getUser(MOCK_SOCKET.id)).to.be.undefined;
      expect(router.getConnections()).to.have.lengthOf(0);
    });
  });

});
