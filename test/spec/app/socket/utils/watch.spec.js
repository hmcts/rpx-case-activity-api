const keys = require('../../../../../app/socket/redis/keys');
const watch = require('../../../../../app/socket/utils/watch');
const expect = require('chai').expect;

describe('socket.utils', () => {

  describe('watch', () => {
    const MOCK_SOCKET = {
      id: 'socket-id',
      rooms: ['socket-id'],
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
      }
    };

    const expectSocketIdOnly = () => {
      expect(MOCK_SOCKET.rooms).to.have.lengthOf(1)
        .and.to.include(MOCK_SOCKET.id);
    };

    const expectRoomsWithCases = (caseIds, includeSocketId = true) => {
      const validCaseIds = caseIds.filter(id => id !== null && id !== undefined);
      const expectedLength = validCaseIds.length + (includeSocketId ? 1 : 0);
      expect(MOCK_SOCKET.rooms).to.have.lengthOf(expectedLength);
      if (includeSocketId) {
        expect(MOCK_SOCKET.rooms).to.include(MOCK_SOCKET.id);
      }
      validCaseIds.forEach((id) => {
        expect(MOCK_SOCKET.rooms).to.include(keys.case.base(id));
      });
    };

    const expectRoomsNotIncludingCases = (caseIds) => {
      caseIds.forEach((id) => {
        expect(MOCK_SOCKET.rooms).not.to.include(keys.case.base(id));
      });
    };

    afterEach(() => {
      MOCK_SOCKET.rooms.length = 0;
      MOCK_SOCKET.rooms.push(MOCK_SOCKET.id)
    });

    describe('case', () => {
      it('should join the appropriate room on the socket', () => {
        const CASE_ID = '1234567890';
        watch.case(MOCK_SOCKET, CASE_ID);
        expectRoomsWithCases([CASE_ID]);
      });

      it('should handle a null room', () => {
        watch.case(MOCK_SOCKET, null);
        expectSocketIdOnly();
      });

      it('should handle a null socket', () => {
        watch.case(null, null);
        expectSocketIdOnly();
      });
    });

    describe('cases', () => {
      it('should join all appropriate rooms on the socket', () => {
        const CASE_IDS = ['1234567890', '0987654321', 'bob'];
        watch.cases(MOCK_SOCKET, CASE_IDS);
        expectRoomsWithCases(CASE_IDS);
      });

      it('should handle a null room', () => {
        const CASE_IDS = ['1234567890', null, 'bob'];
        watch.cases(MOCK_SOCKET, CASE_IDS);
        expectRoomsWithCases(CASE_IDS);
      });

      it('should handle a null socket', () => {
        const CASE_IDS = ['1234567890', '0987654321', 'bob'];
        watch.cases(null, CASE_IDS);
        expectSocketIdOnly();
      });
    });

    describe('stop', () => {
      const CASE_IDS = ['1234567890', '0987654321', 'bob'];

      it('should leave all the case rooms', () => {
        watch.cases(MOCK_SOCKET, CASE_IDS);
        expectRoomsWithCases(CASE_IDS);

        watch.stop(MOCK_SOCKET);
        expectSocketIdOnly();
      });

      it('should handle a null socket', () => {
        watch.cases(MOCK_SOCKET, CASE_IDS);
        expectRoomsWithCases(CASE_IDS);

        watch.stop(null);
        expectRoomsWithCases(CASE_IDS);
      });

      it('should handle no case rooms to leave', () => {
        expectSocketIdOnly();
        watch.stop(MOCK_SOCKET);
        expectSocketIdOnly();
      });
    });

    describe('update', () => {
      it('should appropriately replace one set of cases with another', () => {
        const CASE_IDS = ['1234567890', '0987654321', 'bob'];
        watch.cases(MOCK_SOCKET, CASE_IDS);

        const REPLACEMENT_CASE_IDS = ['a', 'b', 'c', 'd'];
        watch.update(MOCK_SOCKET, REPLACEMENT_CASE_IDS);
        expectRoomsWithCases(REPLACEMENT_CASE_IDS);
        expectRoomsNotIncludingCases(CASE_IDS);
      });
    });

  });

});
