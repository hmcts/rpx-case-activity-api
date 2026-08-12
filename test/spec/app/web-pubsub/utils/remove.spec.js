const { expect } = require('chai');
const remove = require('../../../../../app/web-pubsub/utils/remove');
const keys = require('../../../../../app/web-pubsub/redis/keys');
const {
  connectionIdFromActivityMember,
  toActivityMember,
  userIdFromActivityMember
} = require('../../../../../app/web-pubsub/utils/other');

describe('web-pubsub.utils', () => {
  it('decodes connection-scoped activity members', () => {
    const member = toActivityMember('user-a', 'connection-a');

    expect(userIdFromActivityMember(member)).to.equal('user-a');
    expect(connectionIdFromActivityMember(member)).to.equal('connection-a');
    expect(connectionIdFromActivityMember('user-a')).to.equal(null);
  });

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

      it('should remove only the stale connection member after a reconnect', () => {
        const ACTIVITY_KEY = keys.case.view('1234567890');
        const oldMember = toActivityMember('user-a', 'old-connection');
        const newMember = toActivityMember('user-a', 'new-connection');
        const pipe = remove.userActivity({
          activityKey: ACTIVITY_KEY,
          activityMember: oldMember,
          userId: 'user-a'
        });

        expect(pipe).to.deep.equal(['zrem', ACTIVITY_KEY, oldMember]);
        expect(pipe[2]).not.to.equal(newMember);
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
