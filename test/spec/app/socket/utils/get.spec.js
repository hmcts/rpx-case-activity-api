const expect = require('chai').expect;
const get = require('../../../../../app/socket/utils/get');
const keys = require('../../../../../app/socket/redis/keys');

describe('socket.utils', () => {

  describe('get', () => {

    const NOW = 999;

    const expectCaseActivityPipe = (pipe, caseId, activity, now) => {
      expect(pipe).to.be.an('array').and.have.lengthOf(4);
      expect(pipe[0]).to.equal('zrangebyscore');
      expect(pipe[1]).to.equal(keys.case[activity](caseId));
      expect(pipe[2]).to.equal(now);
      expect(pipe[3]).to.equal('+inf');
    };

    const expectCaseActivityPipes = (pipes, caseIds, activity, now) => {
      expect(pipes).to.be.an('array').and.have.lengthOf(caseIds.length);
      caseIds.forEach((id, index) => {
        expectCaseActivityPipe(pipes[index], id, activity, now);
      });
    };

    const expectUserPipe = (pipe, userId) => {
      expect(pipe).to.be.an('array').and.have.lengthOf(2);
      expect(pipe[0]).to.equal('get');
      expect(pipe[1]).to.equal(keys.user(userId));
    };

    const expectUserPipes = (pipes, userIds) => {
      expect(pipes).to.be.an('array').and.have.lengthOf(userIds.length);
      userIds.forEach((id, index) => {
        expectUserPipe(pipes[index], id);
      });
    };

    describe('caseActivities', () => {
      it('should get the correct result for a single case being viewed', () => {
        const CASE_IDS = ['1'];
        const ACTIVITY = 'view';
        const pipes = get.caseActivities(CASE_IDS, ACTIVITY, NOW);
        expectCaseActivityPipes(pipes, CASE_IDS, ACTIVITY, NOW);
      });

      it('should get the correct result for a multiple cases being viewed', () => {
        const CASE_IDS = ['1', '8', '2345678', 'x'];
        const ACTIVITY = 'view';
        const pipes = get.caseActivities(CASE_IDS, ACTIVITY, NOW);
        expectCaseActivityPipes(pipes, CASE_IDS, ACTIVITY, NOW);
      });

      it('should handle a null case ID for cases being viewed', () => {
        const CASE_IDS = ['1', '8', null, 'x'];
        const ACTIVITY = 'view';
        const validIds = CASE_IDS.filter(id => id !== null);
        const pipes = get.caseActivities(CASE_IDS, ACTIVITY, NOW);
        expectCaseActivityPipes(pipes, validIds, ACTIVITY, NOW);
      });

      it('should handle a null case ID for cases being edited', () => {
        const CASE_IDS = ['1', '8', null, 'x'];
        const ACTIVITY = 'edit';
        const validIds = CASE_IDS.filter(id => id !== null);
        const pipes = get.caseActivities(CASE_IDS, ACTIVITY, NOW);
        expectCaseActivityPipes(pipes, validIds, ACTIVITY, NOW);
      });

      it('should handle a null array of case IDs', () => {
        const CASE_IDS = null;
        const ACTIVITY = 'view';
        const pipes = get.caseActivities(CASE_IDS, ACTIVITY, NOW);
        expect(pipes).to.be.an('array').and.have.lengthOf(0);
      });

      it('should handle an invalid activity type', () => {
        const CASE_IDS = ['1', '8', '2345678', 'x'];
        const ACTIVITY = 'bob';
        const pipes = get.caseActivities(CASE_IDS, ACTIVITY, NOW);
        expect(pipes).to.be.an('array').and.have.lengthOf(0);
      });
    });

    describe('users', () => {
      it('should get the correct result for a single user ID', () => {
        const USER_IDS = ['1'];
        const pipes = get.users(USER_IDS);
        expectUserPipes(pipes, USER_IDS);
      });

      it('should get the correct result for multiple user IDs', () => {
        const USER_IDS = ['1', '8', '2345678', 'x'];
        const pipes = get.users(USER_IDS);
        expectUserPipes(pipes, USER_IDS);
      });

      it('should handle a null user ID', () => {
        const USER_IDS = ['1', '8', null, 'x'];
        const validIds = USER_IDS.filter(id => id);
        const pipes = get.users(USER_IDS);
        expectUserPipes(pipes, validIds);
      });

      it('should handle a null array of user IDs', () => {
        const USER_IDS = null;
        const pipes = get.users(USER_IDS);
        expect(pipes).to.be.an('array').and.have.lengthOf(0);
      });
    });

  });

});
