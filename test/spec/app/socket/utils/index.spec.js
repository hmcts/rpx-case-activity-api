const expect = require('chai').expect;
const sandbox = require("sinon").createSandbox();
const utils = require('../../../../../app/socket/utils');

describe('socket.utils', () => {

  describe('extractUniqueUserIds', () => {
    const testExtractUniqueUserIds = (result, unique, expectedLength, ...expectedIds) => {
      const IDS = utils.extractUniqueUserIds(result, unique);
      let expectation = expect(IDS).to.be.an('array').that.has.lengthOf(expectedLength);
      expectedIds.forEach(id => {
        expectation = expectation.and.that.includes(id);
      });
    };

    it('should handle a null result', () => {
      testExtractUniqueUserIds(null, ['a'], 1, 'a');
    });

    it('should handle a result of the wrong type', () => {
      testExtractUniqueUserIds('bob', ['a'], 1, 'a');
    });

    it('should handle a result with the wrong structure', () => {
      const RESULT = [['bob'], ['fred']];
      testExtractUniqueUserIds(RESULT, ['a'], 1, 'a');
    });

    it('should handle a result containing nulls', () => {
      const RESULT = [['bob', ['b']], ['fred', null]];
      testExtractUniqueUserIds(RESULT, ['a'], 2, 'a', 'b');
    });

    it('should handle a result with the correct structure', () => {
      const RESULT = [['bob', ['b', 'g']], ['fred', ['f']]];
      testExtractUniqueUserIds(RESULT, ['a'], 4, 'a', 'b', 'f', 'g');
    });

    it('should handle a result with the correct structure but a null original array', () => {
      const RESULT = [['bob', ['b', 'g']], ['fred', ['f']]];
      testExtractUniqueUserIds(RESULT, null, 3, 'b', 'f', 'g');
    });

    it('should handle a result with the correct structure but an original array of the wrong type', () => {
      const RESULT = [['bob', ['b', 'g']], ['fred', ['f']]];
      testExtractUniqueUserIds(RESULT, 'a', 3, 'b', 'f', 'g');
    });

    it('should strip out duplicates', () => {
      const RESULT = [['bob', ['a', 'b', 'g']], ['fred', ['f', 'b']]];
      testExtractUniqueUserIds(RESULT, ['a'], 4, 'a', 'b', 'f', 'g');
    });
  });

  describe('log', () => {
    const testLog = (payload, expectedLength, validateLogs) => {
      const logs = [];
      const logTo = (str) => logs.push(str);
      const SOCKET = { id: 'Are' };
      const GROUP = 'you not';
      utils.log(SOCKET, payload, GROUP, logTo);
      expect(logs).to.have.lengthOf(expectedLength);
      validateLogs(logs);
    };

    it('should output string payload', () => {
      const PAYLOAD = 'entertained?';
      testLog(PAYLOAD, 1, (logs) => {
        expect(logs[0]).to.include(`| Are | you not => entertained?`);
      });
    });

    it('should output object payload', () => {
      const PAYLOAD = { sufficiently: 'entertained?' };
      testLog(PAYLOAD, 2, (logs) => {
        expect(logs[0]).to.include(`| Are | you not`);
        expect(logs[1]).to.equal(PAYLOAD);
      });
    });
  });

  describe('score', () => {
    const NOW = 55;

    const testScore = (ttl, expectedScore) => {
      sandbox.stub(Date, 'now').returns(NOW);
      const score = utils.score(ttl);
      expect(score).to.equal(expectedScore);
    };

    afterEach(() => {
      sandbox.restore();
    });

    it('should handle a string TTL', () => {
      testScore('12', 12055); // (TTL * 1000) + NOW
    });

    it('should handle a numeric TTL', () => {
      testScore(13, 13055); // (TTL * 1000) + NOW
    });

    it('should handle a null TTL', () => {
      testScore(null, 55); // null TTL => 0
    });
  });

  describe('toUser', () => {
    const testToUser = (obj, expected) => {
      const user = utils.toUser(obj);
      Object.keys(expected).forEach(key => {
        expect(user[key]).to.equal(expected[key]);
      });
    };

    it('should handle a null object', () => {
      expect(utils.toUser(null)).to.deep.equal({});
    });

    it('should handle a valid object', () => {
      const OBJ = { id: 'bob', name: 'Bob Smith' };
      testToUser(OBJ, {
        uid: 'bob',
        name: 'Bob Smith',
        given_name: 'Bob',
        family_name: 'Smith',
        sub: 'Bob.Smith@mailinator.com'
      });
    });

    it('should handle a valid object with a long name', () => {
      const OBJ = { id: 'ddl', name: 'Daniel Day Lewis' };
      testToUser(OBJ, {
        uid: 'ddl',
        name: 'Daniel Day Lewis',
        given_name: 'Daniel',
        family_name: 'Day Lewis',
        sub: 'Daniel.Day-Lewis@mailinator.com'
      });
    });
  });

  describe('toUserString', () => {
    const testToUserString = (user, expected) => {
      expect(utils.toUserString(user)).to.equal(expected);
    };

    it('should handle a null user', () => {
      testToUserString(null, '{}');
    });

    it('should handle an undefined user', () => {
      testToUserString(undefined, '{}');
    });

    it('should handle an empty user', () => {
      testToUserString({}, '{}');
    });

    it('should handle a full user', () => {
      const USER = { uid: '1234567890', given_name: 'Bob', family_name: 'Smith' };
      testToUserString(USER, '{"id":"1234567890","forename":"Bob","surname":"Smith"}');
    });

    it('should handle a user with a missing family name', () => {
      const USER = { uid: '1234567890', given_name: 'Bob' };
      testToUserString(USER, '{"id":"1234567890","forename":"Bob"}');
    });

    it('should handle a user with a missing given name', () => {
      const USER = { uid: '1234567890', family_name: 'Smith' };
      testToUserString(USER, '{"id":"1234567890","surname":"Smith"}');
    });

    it('should handle a user with a missing name', () => {
      const USER = { uid: '1234567890' };
      testToUserString(USER, '{"id":"1234567890"}');
    });
  });

  const testModuleSetup = (moduleName, modulePath) => {
    describe(moduleName, () => {
      it('should be appropriately set up', () => {
        expect(utils[moduleName]).to.equal(require(modulePath));
      });
    });
  };

  testModuleSetup('get', '../../../../../app/socket/utils/get');
  testModuleSetup('remove', '../../../../../app/socket/utils/remove');
  testModuleSetup('store', '../../../../../app/socket/utils/store');
  testModuleSetup('watch', '../../../../../app/socket/utils/watch');

});
