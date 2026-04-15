const keys = require('../../../../../app/socket/redis/keys');
const ActivityService = require('../../../../../app/socket/service/activity-service');
const expect = require('chai').expect;
const sandbox = require("sinon").createSandbox();

describe('socket.service.activity-service', () => {
  // An instance that can be tested.
  let activityService;

  // Helper functions to reduce duplication
  const expectNoPipelineCalls = () => {
    expect(MOCK_REDIS.pipelines).to.have.lengthOf(0);
  };

  const expectPipelineContains = (pipe, ...expectedValues) => {
    const assertions = expect(pipe).to.be.an('array').with.a.lengthOf(expectedValues.length);
    expectedValues.forEach(val => assertions.and.to.contain(val));
    return assertions;
  };

  const expectNotificationSent = (caseId, approximateTime = Date.now(), tolerance = 5) => {
    const message = MOCK_REDIS.messages.find(m => m.channel === keys.case.base(caseId));
    expect(message).to.exist;
    const messageTS = Number.parseInt(message.message, 10);
    expect(messageTS).to.be.approximately(approximateTime, tolerance);
  };

  const USER_ID = 'a';
  const CASE_ID = '1234567890';
  const TTL_USER = 20;
  const TTL_ACTIVITY = 99;
  const MOCK_CONFIG = {
    getCalls: [],
    keys: {
      'redis.socket.activityTtlSec': TTL_ACTIVITY,
      'redis.socket.userDetailsTtlSec': TTL_USER
    },
    get: (key) => {
      MOCK_CONFIG.getCalls.push(key);
      return MOCK_CONFIG.keys[key];
    }
  };
  const MOCK_REDIS = {
    messages: [],
    gets: [],
    pipelines: [],
    pipelineFailureLogs: [],
    pipelineMode: undefined,
    publish: (channel, message) => {
      MOCK_REDIS.messages.push({ channel, message });
    },
    get: (key) => {
      MOCK_REDIS.gets.push(key);
      return JSON.stringify({
        activityKey: keys.case.view(CASE_ID),
        caseId: CASE_ID,
        userId: USER_ID
      });
    },
    pipeline: (pipes) => {
      MOCK_REDIS.pipelines.push(pipes);
      let execResult = null;
      switch (MOCK_REDIS.pipelineMode) {
        case 'get':
          if (MOCK_REDIS.isUserGet(pipes)) {
            execResult = MOCK_REDIS.userPipeline(pipes);
          } else {
            execResult = MOCK_REDIS.casePipeline(pipes);
          }
          break;
        case 'socket':
          execResult = CASE_ID;
          break;
        case 'user':
          execResult = MOCK_REDIS.userPipeline(pipes);
          break;
      }
      return {
        exec: () => {
          return execResult;
        }
      };
    },
    casePipeline: (pipes) => {
      return pipes.map(() => {
        return [null, [USER_ID, 'MISSING']];
      });
    },
    userPipeline: (pipes) => {
      return pipes.map((pipe) => {
        const id = pipe[1].replace(`${keys.prefixes.user}:`, '');
        if (id === 'MISSING') {
          return [null, null];
        }
        return [null, JSON.stringify({ id, forename: `Bob ${id.toUpperCase()}`, surname: 'Smith' })];
      });
    },
    logPipelineFailures: (result, message) => {
      MOCK_REDIS.pipelineFailureLogs.push({ result, message });
    },
    isUserGet: (pipes) => {
      if (pipes.length > 0) {
        return pipes[0][0] === 'get';
      }
      return false;
    }
  };

  beforeEach(() => {
    activityService = ActivityService(MOCK_CONFIG, MOCK_REDIS);
  });

  afterEach(async () => {
    MOCK_CONFIG.getCalls.length = 0;
    MOCK_REDIS.messages.length = 0;
    MOCK_REDIS.gets.length = 0;
    MOCK_REDIS.pipelines.length = 0;
    MOCK_REDIS.pipelineMode = undefined;
    MOCK_REDIS.pipelineFailureLogs.length = 0;
  });

  it('should have appropriately initialised from the config', () => {
    expect(MOCK_CONFIG.getCalls).to.include('redis.socket.activityTtlSec');
    expect(activityService.ttl.activity).to.equal(TTL_ACTIVITY);
    expect(MOCK_CONFIG.getCalls).to.include('redis.socket.userDetailsTtlSec');
    expect(activityService.ttl.user).to.equal(TTL_USER);
  });

  describe('notifyChange', () => {
    it('should broadcast via redis that there is a change to a case', () => {
      const NOW = Date.now();
      activityService.notifyChange(CASE_ID);
      expect(MOCK_REDIS.messages).to.have.lengthOf(1);
      expectNotificationSent(CASE_ID, NOW);
    });
    it('should handle a null caseId', () => {
      activityService.notifyChange(null);
      expect(MOCK_REDIS.messages).to.have.lengthOf(0);
    });
  });

  describe('getSocketActivity', () => {
    it('should appropriately get socket activity', async () => {
      const SOCKET_ID = 'abcdef123456';
      const activity = await activityService.getSocketActivity(SOCKET_ID);
      expect(MOCK_REDIS.gets).to.have.lengthOf(1);
      expect(MOCK_REDIS.gets[0]).to.equal(keys.socket(SOCKET_ID));
      expect(activity).to.be.an('object');
      expect(activity.activityKey).to.equal(keys.case.view(CASE_ID));
    });
    it('should handle a null caseId', async () => {
      const activity = await activityService.getSocketActivity(null);
      expect(MOCK_REDIS.messages).to.have.lengthOf(0);
      expect(activity).to.be.null;
    });
  });

  describe('getUserDetails', () => {
    beforeEach(() => {
      MOCK_REDIS.pipelineMode = 'user';
    });

    const verifyUserPipeline = (pipes, userIds) => {
      expect(pipes).to.be.an('array').and.have.lengthOf(userIds.length);
      userIds.forEach((id, index) => {
        expectPipelineContains(pipes[index], 'get', keys.user(id));
      });
    };

    const verifyUserDetails = (userDetails, expectedIds) => {
      expectedIds.forEach((id) => {
        const user = userDetails[id];
        expect(user).to.be.an('object');
        expect(user.forename).to.be.a('string');
        expect(user.surname).to.be.a('string');
      });
    };

    it('should appropriately get user details', async () => {
      const USER_IDS = ['a', 'b'];
      const userDetails = await activityService.getUserDetails(USER_IDS);
      expect(MOCK_REDIS.pipelines).to.have.lengthOf(1);
      verifyUserPipeline(MOCK_REDIS.pipelines[0], USER_IDS);
      verifyUserDetails(userDetails, USER_IDS);
    });
    it('should handle null userIds', async () => {
      const userDetails = await activityService.getUserDetails(null);
      expectNoPipelineCalls();
      expect(userDetails).to.deep.equal({});
    });
    it('should handle empty userIds', async () => {
      const userDetails = await activityService.getUserDetails([]);
      expectNoPipelineCalls();
      expect(userDetails).to.deep.equal({});
    });
    it('should handle a missing user', async () => {
      const USER_IDS = ['a', 'b', 'MISSING'];
      const userDetails = await activityService.getUserDetails(USER_IDS);
      expect(MOCK_REDIS.pipelines).to.have.lengthOf(1);
      verifyUserPipeline(MOCK_REDIS.pipelines[0], USER_IDS);
      USER_IDS.forEach((id) => {
        if (id === 'MISSING') {
          expect(userDetails[id]).to.be.undefined;
        } else {
          const user = userDetails[id];
          expect(user).to.be.an('object');
          expect(user.forename).to.be.a('string');
          expect(user.surname).to.be.a('string');
        }
      });
    });
    it('should handle a null userId', async () => {
      const USER_IDS = ['a', 'b', null];
      const userDetails = await activityService.getUserDetails(USER_IDS);
      expect(MOCK_REDIS.pipelines).to.have.lengthOf(1);
      const pipes = MOCK_REDIS.pipelines[0];
      expect(pipes).to.be.an('array').and.have.lengthOf(USER_IDS.length - 1);
      const validIds = USER_IDS.filter(Boolean);
      verifyUserDetails(userDetails, validIds);
      validIds.forEach((id, index) => {
        expectPipelineContains(pipes[index], 'get', keys.user(id));
      });
    });
  });

  describe('removeSocketActivity', () => {
    beforeEach(() => {
      MOCK_REDIS.pipelineMode = 'socket';
    });

    it('should appropriately remove socket activity', async () => {
      const NOW = Date.now();
      const SOCKET_ID = 'abcdef123456';
      await activityService.removeSocketActivity(SOCKET_ID);
      expect(MOCK_REDIS.pipelines).to.have.lengthOf(1);
      const pipes = MOCK_REDIS.pipelines[0];
      expect(pipes).to.be.an('array').with.a.lengthOf(2);
      expectPipelineContains(pipes[0], 'zrem', keys.case.view(CASE_ID), USER_ID);
      expectPipelineContains(pipes[1], 'del', keys.socket(SOCKET_ID));
      expect(MOCK_REDIS.messages).to.have.lengthOf(1);
      expectNotificationSent(CASE_ID, NOW);
    });
    it('should handle a null socketId', async () => {
      await activityService.removeSocketActivity(null);
      expectNoPipelineCalls();
    });
  });

  describe('addActivity', () => {
    const DATE_NOW = 55;

    beforeEach(() => {
      MOCK_REDIS.pipelineMode = 'add';
      sandbox.stub(Date, 'now').returns(DATE_NOW);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should appropriately add view activity', async () => {
      const NOW = Date.now();
      const USER = { uid: USER_ID, given_name: 'Joe', family_name: 'Bloggs' };
      const SOCKET_ID = 'abcdef123456';
      await activityService.addActivity(CASE_ID, USER, SOCKET_ID, 'view');
      expect(MOCK_REDIS.pipelines).to.have.lengthOf(2);
      const pipes = MOCK_REDIS.pipelines[1];
      expectPipelineContains(pipes[0], 'zadd', keys.case.view(CASE_ID), DATE_NOW + TTL_ACTIVITY * 1000, USER_ID);
      expectPipelineContains(pipes[1], 'set', keys.socket(SOCKET_ID), `{"activityKey":"${keys.case.view(CASE_ID)}","caseId":"${CASE_ID}","userId":"${USER_ID}"}`, 'EX', TTL_USER);
      expectPipelineContains(pipes[2], 'set', keys.user(USER_ID), `{"id":"${USER_ID}","forename":"Joe","surname":"Bloggs"}`, 'EX', TTL_USER);
      expect(MOCK_REDIS.messages).to.have.lengthOf(1);
      expectNotificationSent(CASE_ID, NOW);
    });
    it('should notifications about both removed and added cases', async () => {
      const USER = { uid: USER_ID, given_name: 'Joe', family_name: 'Bloggs' };
      const SOCKET_ID = 'abcdef123456';
      const NEW_CASE_ID = '0987654321';
      await activityService.addActivity(NEW_CASE_ID, USER, SOCKET_ID, 'view');
      expect(MOCK_REDIS.messages).to.have.lengthOf(2);
      expect(MOCK_REDIS.messages[0].channel).to.equal(keys.case.base(CASE_ID));
      expect(MOCK_REDIS.messages[1].channel).to.equal(keys.case.base(NEW_CASE_ID));
    });
    it('should handle a null caseId', async () => {
      const USER = { uid: USER_ID };
      const SOCKET_ID = 'abcdef123456';
      await activityService.addActivity(null, USER, SOCKET_ID, 'view');
      expectNoPipelineCalls();
    });
    it('should handle a null user', async () => {
      const SOCKET_ID = 'abcdef123456';
      await activityService.addActivity(CASE_ID, null, SOCKET_ID, 'view');
      expectNoPipelineCalls();
    });
    it('should handle a null socketId', async () => {
      const USER = { uid: USER_ID };
      await activityService.addActivity(CASE_ID, USER, null, 'view');
      expectNoPipelineCalls();
    });
    it('should handle a null activity', async () => {
      const USER = { uid: USER_ID };
      const SOCKET_ID = 'abcdef123456';
      await activityService.addActivity(CASE_ID, USER, SOCKET_ID, null);
      expectNoPipelineCalls();
    });
  });

  describe('getActivityForCases', () => {
    const DATE_NOW = 55;

    beforeEach(() => {
      MOCK_REDIS.pipelineMode = 'get';
      sandbox.stub(Date, 'now').returns(DATE_NOW);
    });

    afterEach(() => {
      sandbox.restore();
    });

    const verifyCaseActivity = (caseActivity, caseId) => {
      expect(caseActivity).to.be.an('object');
      expect(caseActivity.caseId).to.equal(caseId);
      expect(caseActivity.viewers).to.be.an('array').with.a.lengthOf(1);
      expect(caseActivity.viewers[0]).to.be.an('object');
      expect(caseActivity.viewers[0].forename).to.equal(`Bob ${USER_ID.toUpperCase()}`);
      expect(caseActivity.unknownViewers).to.equal(1);
      expect(caseActivity.editors).to.be.an('array').with.a.lengthOf(1);
      expect(caseActivity.editors[0]).to.be.an('object');
      expect(caseActivity.unknownEditors).to.equal(1);
      expect(caseActivity.editors[0].forename).to.equal(`Bob ${USER_ID.toUpperCase()}`);
    };

    it('should appropriately get case activity', async () => {
      const CASE_IDS = ['1234567890','0987654321'];
      const result = await activityService.getActivityForCases(CASE_IDS);
      expect(result).to.be.an('array').with.a.lengthOf(CASE_IDS.length);
      CASE_IDS.forEach((id, index) => {
        verifyCaseActivity(result[index], id);
      });
    });
    it('should handle null caseIds', async () => {
      const result = await activityService.getActivityForCases(null);
      expect(result).to.be.an('array').with.a.lengthOf(0);
      expectNoPipelineCalls();
    });
    it('should handle empty caseIds', async () => {
      const result = await activityService.getActivityForCases([]);
      expect(result).to.be.an('array').with.a.lengthOf(0);
      expectNoPipelineCalls();
    });
  });

});
