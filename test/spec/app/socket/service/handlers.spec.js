const keys = require('../../../../../app/socket/redis/keys');
const Handlers = require('../../../../../app/socket/service/handlers');
const expect = require('chai').expect;


describe('socket.service.handlers', () => {
  // An instance that can be tested.
  let handlers;

  const MOCK_ACTIVITY_SERVICE = {
    calls: [],
    addActivity: async (caseId, user, socketId, activity) => {
      const params = { caseId, user, socketId, activity };
      MOCK_ACTIVITY_SERVICE.calls.push({ method: 'addActivity', params });
      return null;
    },
    getActivityForCases: async (caseIds) => {
      const params = { caseIds };
      MOCK_ACTIVITY_SERVICE.calls.push({ method: 'getActivityForCases', params });
      return caseIds.map((caseId) => {
        return {
          caseId,
          viewers: [],
          unknownViewers: 0,
          editors: [],
          unknownEditors: 0
        };
      });
    },
    removeSocketActivity: async (socketId) => {
      const params = { socketId };
      MOCK_ACTIVITY_SERVICE.calls.push({ method: 'removeSocketActivity', params });
    },
    refreshSocketActivity: async (socketId, user) => {
      const params = { socketId, user };
      MOCK_ACTIVITY_SERVICE.calls.push({ method: 'refreshSocketActivity', params });
    },
    removeUserActivity: async (socketId) => {
      const params = { socketId };
      MOCK_ACTIVITY_SERVICE.calls.push({ method: 'removeUserActivity', params });
    }
  };
  const MOCK_SOCKET_SERVER = {
    messagesTo: [],
    to: (room) => {
      const messageTo = { room }
      MOCK_SOCKET_SERVER.messagesTo.push(messageTo);
      return {
        except: (socketId) => {
          messageTo.excludedSocketId = socketId;
          return {
            emit: (event, message) => {
              messageTo.event = event;
              messageTo.message = message;
            }
          };
        },
        emit: (event, message) => {
          messageTo.event = event;
          messageTo.message = message;
        }
      };
    },
    local: {
      to: (room) => MOCK_SOCKET_SERVER.to(room)
    }
  };
  const MOCK_SOCKET = {
    id: 'socket-id',
    rooms: ['socket-id'],
    messages: [],
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
    }
  };

  beforeEach(async () => {
    handlers = Handlers(MOCK_ACTIVITY_SERVICE, MOCK_SOCKET_SERVER);
  });

  afterEach(async () => {
    MOCK_ACTIVITY_SERVICE.calls.length = 0;
    MOCK_SOCKET_SERVER.messagesTo.length = 0;
    MOCK_SOCKET.rooms.length = 0;
    MOCK_SOCKET.rooms.push(MOCK_SOCKET.id);
    MOCK_SOCKET.messages.length = 0;
  });

  describe('addActivity', () => {
    it('should update what the socket is watching and add activity for the specified case', async () => {
      const CASE_ID = '0987654321';
      const USER = { uid: 'a', name: 'John Smith', given_name: 'John', family_name: 'Smith' };
      const ACTIVITY = 'view';

      // Pretend the socket is watching a bunch of additional rooms.
      MOCK_SOCKET.join(keys.case.base('bob'));
      MOCK_SOCKET.join(keys.case.base('fred'));
      MOCK_SOCKET.join(keys.case.base('xyz'));
      expect(MOCK_SOCKET.rooms).to.have.lengthOf(4);

      // Now make the call.
      await handlers.addActivity(MOCK_SOCKET, CASE_ID, USER, ACTIVITY);

      // The socket should be watching that case and that case alone...
      // ... plus its own room, which is not related to a case, hence lengthOf(2).
      expect(MOCK_SOCKET.rooms).to.have.lengthOf(2)
        .and.to.include(MOCK_SOCKET.id)
        .and.to.include(keys.case.base(CASE_ID));

      // The activity service should have been called with appropriate parameters
      expect(MOCK_ACTIVITY_SERVICE.calls).to.have.lengthOf(1);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].method).to.equal('addActivity');
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.caseId).to.equal(CASE_ID);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.socketId).to.equal(MOCK_SOCKET.id);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.activity).to.equal(ACTIVITY);
      // The user parameter should have been transformed appropriatel.
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.user.uid).to.equal(USER.uid);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.user.name).to.equal(USER.name);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.user.given_name).to.equal('John');
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.user.family_name).to.equal('Smith');
    });
  });

  describe('notify', () => {
    it('should get activity for specified case and notify watchers', async () => {
      const CASE_ID = '1234567890';
      await handlers.notify(CASE_ID);

      // The activity service should have been called.
      expect(MOCK_ACTIVITY_SERVICE.calls).to.have.lengthOf(1);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].method).to.equal('getActivityForCases');
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.caseIds).to.deep.equal([CASE_ID]);

      // The socket server should also have been called.
      expect(MOCK_SOCKET_SERVER.messagesTo).to.have.lengthOf(1);
      expect(MOCK_SOCKET_SERVER.messagesTo[0].room).to.equal(keys.case.base(CASE_ID));
      expect(MOCK_SOCKET_SERVER.messagesTo[0].event).to.equal('activity');
      expect(MOCK_SOCKET_SERVER.messagesTo[0].message).to.be.an('array').and.to.have.lengthOf(1);
      expect(MOCK_SOCKET_SERVER.messagesTo[0].message[0].caseId).to.equal(CASE_ID);
    });

    it('should exclude the source socket when requested', async () => {
      const CASE_ID = '1234567890';
      const SOCKET_ID = 'socket-id';
      await handlers.notify(CASE_ID, { excludedSocketId: SOCKET_ID });

      expect(MOCK_SOCKET_SERVER.messagesTo).to.have.lengthOf(1);
      expect(MOCK_SOCKET_SERVER.messagesTo[0].room).to.equal(keys.case.base(CASE_ID));
      expect(MOCK_SOCKET_SERVER.messagesTo[0].excludedSocketId).to.equal(SOCKET_ID);
      expect(MOCK_SOCKET_SERVER.messagesTo[0].event).to.equal('activity');
    });

    it('should prefer local emitter when available', async () => {
      const CASE_ID = '2222222222';
      const localToCalls = [];
      MOCK_SOCKET_SERVER.local.to = (room) => {
        localToCalls.push(room);
        return MOCK_SOCKET_SERVER.to(room);
      };

      await handlers.notify(CASE_ID);

      expect(localToCalls).to.deep.equal([keys.case.base(CASE_ID)]);
    });
  });

  describe('removeSocketActivity', () => {
    it('should remove activity for specified socket', async () => {
      const SOCKET_ID = 'abcdef123456';
      await handlers.removeSocketActivity(SOCKET_ID);

      // The activity service should have been called.
      expect(MOCK_ACTIVITY_SERVICE.calls).to.have.lengthOf(1);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].method).to.equal('removeSocketActivity');
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.socketId).to.equal(SOCKET_ID);
    });
  });

  describe('refreshSocketActivity', () => {
    it('should not query Redis when the socket has no active view or edit', async () => {
      await handlers.refreshSocketActivity(MOCK_SOCKET, { uid: 'a' });

      expect(MOCK_ACTIVITY_SERVICE.calls).to.have.lengthOf(0);
    });

    it('should refresh activity for the connected socket', async () => {
      const USER = { uid: 'a', name: 'John Smith' };
      await handlers.addActivity(MOCK_SOCKET, '1234567890', USER, 'view');
      MOCK_ACTIVITY_SERVICE.calls.length = 0;

      await handlers.refreshSocketActivity(MOCK_SOCKET, USER);

      expect(MOCK_ACTIVITY_SERVICE.calls).to.have.lengthOf(1);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].method).to.equal('refreshSocketActivity');
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.socketId).to.equal(MOCK_SOCKET.id);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.user).to.equal(USER);
    });
  });

  describe('watch', () => {
    it('should update what the socket is watching, remove its activity, and let the user know what state the cases are in', async () => {
      const CASE_IDS = ['0987654321', '9876543210', '8765432109'];

      // Pretend the socket is watching a bunch of additional rooms.
      MOCK_SOCKET.join(keys.case.base('bob'));
      MOCK_SOCKET.join(keys.case.base('fred'));
      MOCK_SOCKET.join(keys.case.base('xyz'));
      expect(MOCK_SOCKET.rooms).to.have.lengthOf(4);

      // Now make the call.
      await handlers.watch(MOCK_SOCKET, CASE_IDS);

      // The socket should be watching just the cases specified...
      // ... plus its own room, which is not related to a case, hence lengthOf(2).
      expect(MOCK_SOCKET.rooms).to.have.lengthOf(CASE_IDS.length + 1)
        .and.to.include(MOCK_SOCKET.id);
      CASE_IDS.forEach((caseId) => {
        expect(MOCK_SOCKET.rooms).to.include(keys.case.base(caseId));
      });

      // The activity service should have been called twice.
      expect(MOCK_ACTIVITY_SERVICE.calls).to.have.lengthOf(2);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].method).to.equal('removeSocketActivity');
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.socketId).to.equal(MOCK_SOCKET.id);
      expect(MOCK_ACTIVITY_SERVICE.calls[1].method).to.equal('getActivityForCases');
      expect(MOCK_ACTIVITY_SERVICE.calls[1].params.caseIds).to.deep.equal(CASE_IDS);

      // And the socket should have been told about the case statuses.
      expect(MOCK_SOCKET.messages).to.have.lengthOf(1);
      expect(MOCK_SOCKET.messages[0].event).to.equal('activity');
      expect(MOCK_SOCKET.messages[0].message).to.be.an('array').and.have.lengthOf(CASE_IDS.length);
      CASE_IDS.forEach((caseId, index) => {
        expect(MOCK_SOCKET.messages[0].message[index].caseId).to.equal(caseId);
      })
    })
  });

  describe('stopAll', () => {
    it('should stop watching the specified cases and remove user activity', async () => {
      const CASE_IDS = ['0987654321', '9876543210', '8765432109'];

      CASE_IDS.forEach((caseId) => {
        MOCK_SOCKET.join(keys.case.base(caseId));
      });
      expect(MOCK_SOCKET.rooms).to.have.lengthOf(CASE_IDS.length + 1);

      await handlers.stopAll(MOCK_SOCKET, CASE_IDS);

      expect(MOCK_SOCKET.rooms).to.have.lengthOf(1)
        .and.to.include(MOCK_SOCKET.id);
      CASE_IDS.forEach((caseId) => {
        expect(MOCK_SOCKET.rooms).not.to.include(keys.case.base(caseId));
      });

      expect(MOCK_ACTIVITY_SERVICE.calls).to.have.lengthOf(1);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].method).to.equal('removeUserActivity');
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.socketId).to.equal(MOCK_SOCKET.id);
    });
  });

  describe('stop', () => {
    it('should stop watching the specified case and remove socket activity', async () => {
      const CASE_ID = '1234567890';
      const OTHER_CASE_ID = '0987654321';

      MOCK_SOCKET.join(keys.case.base(CASE_ID));
      MOCK_SOCKET.join(keys.case.base(OTHER_CASE_ID));
      expect(MOCK_SOCKET.rooms).to.include(keys.case.base(CASE_ID));
      expect(MOCK_SOCKET.rooms).to.include(keys.case.base(OTHER_CASE_ID));

      await handlers.stop(MOCK_SOCKET, CASE_ID);

      expect(MOCK_SOCKET.rooms).not.to.include(keys.case.base(CASE_ID));
      expect(MOCK_SOCKET.rooms).to.include(keys.case.base(OTHER_CASE_ID));
      expect(MOCK_ACTIVITY_SERVICE.calls).to.have.lengthOf(1);
      expect(MOCK_ACTIVITY_SERVICE.calls[0].method).to.equal('removeSocketActivity');
      expect(MOCK_ACTIVITY_SERVICE.calls[0].params.socketId).to.equal(MOCK_SOCKET.id);
    });
  });


});
