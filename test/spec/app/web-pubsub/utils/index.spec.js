const expect = require('chai').expect;
const sandbox = require("sinon").createSandbox();
const utils = require('../../../../../app/web-pubsub/utils');

describe('web-pubsub.utils', () => {

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

  testModuleSetup('get', '../../../../../app/web-pubsub/utils/get');
  testModuleSetup('remove', '../../../../../app/web-pubsub/utils/remove');
  testModuleSetup('store', '../../../../../app/web-pubsub/utils/store');

});
