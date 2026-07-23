const expect = require('chai').expect;
const remove = require('../../../../../app/web-pubsub/utils/remove');
const keys = require('../../../../../app/web-pubsub/redis/keys');

describe('web-pubsub.utils', () => {

  describe('remove', () => {

    describe('userActivity', () => {
      it('should produce an appopriate pipe', () => {
        const CASE_ID = '1234567890';
        const ACTIVITY = {
          activityKey: keys.case.view(CASE_ID),
          userId: 'a'
        };
        const pipe = remove.userActivity(ACTIVITY);
        expect(pipe).to.be.an('array').and.have.lengthOf(3);
        expect(pipe[0]).to.equal('zrem');
        expect(pipe[1]).to.equal(ACTIVITY.activityKey);
        expect(pipe[2]).to.equal(ACTIVITY.userId);
      });
    });

    describe('connectionEntry', () => {
      it('should produce an appopriate pipe', () => {
        const SOCKET_ID = 'abcdef123456';
        const pipe = remove.connectionEntry(SOCKET_ID);
        expect(pipe).to.be.an('array').and.have.lengthOf(2);
        expect(pipe[0]).to.equal('del');
        expect(pipe[1]).to.equal(keys.connection(SOCKET_ID));
      });
    });

  });

});
