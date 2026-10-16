const { EventEmitter } = require('node:events');
const { expect } = require('chai');
const ActivityService = require('../../../../../app/web-pubsub/service/activity-service');
const keys = require('../../../../../app/web-pubsub/redis/keys');
const utils = require('../../../../../app/web-pubsub/utils');

describe('web-pubsub reconnect cleanup', () => {
  it('removes a user\'s old connection activity while retaining the new connection', async () => {
    const commands = [];
    const messages = [];
    const redis = {
      scanStream: () => {
        const stream = new EventEmitter();
        process.nextTick(() => {
          stream.emit('data', ['activity:c:case-1:viewers', 'activity:c:case-2:editors']);
          stream.emit('end');
        });
        return stream;
      },
      zrange: async (key) => (key === 'c:case-1:viewers'
        ? [utils.toActivityMember('user-a', 'old-connection'), utils.toActivityMember('user-a', 'new-connection')]
        : [utils.toActivityMember('user-a', 'old-connection')]),
      multi: (pipeline) => ({
        exec: async () => {
          commands.push(...pipeline);
          return pipeline.map(() => [null, 1]);
        }
      }),
      publish: (channel, message) => messages.push({ channel, message })
    };
    const config = {
      get: (key) => ({
        'redis.keyPrefix': 'activity:',
        'redis.webPubSub.userDetailsTtlSec': 60,
        'redis.webPubSub.activityTtlSec': 300
      }[key])
    };
    const service = ActivityService(config, redis);

    const changes = await service.removeStaleUserActivity('user-a', 'new-connection');

    expect(commands).to.deep.include.members([
      ['zrem', keys.case.view('case-1'), utils.toActivityMember('user-a', 'old-connection')],
      ['del', keys.connection('old-connection')],
      ['zrem', keys.case.edit('case-2'), utils.toActivityMember('user-a', 'old-connection')]
    ]);
    expect(changes.map((change) => change.caseId)).to.have.members(['case-1', 'case-2']);
    expect(messages.map((message) => message.channel)).to.have.members([
      keys.case.base('case-1'),
      keys.case.base('case-2')
    ]);
  });
});
