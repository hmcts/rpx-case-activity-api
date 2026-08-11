const debug = require('debug')('rpx-case-activity-api:web-pubsub-utils-remove');
const redisActivityKeys = require('../redis/keys');

const remove = {
  userActivity: (activity) => {
    debug(`about to remove activity "${activity.activityKey}" for user "${activity.userId}"`);
    return ['zrem', activity.activityKey, activity.activityMember || activity.userId];
  },
  legacyUserActivity: (activity) => {
    debug(`about to remove legacy activity "${activity.activityKey}" for user "${activity.userId}"`);
    return ['zrem', activity.activityKey, activity.userId];
  },
  connectionEntry: (connectionId) => {
    debug(`about to remove activity for connection "${connectionId}"`);
    return ['del', redisActivityKeys.connection(connectionId)];
  }
};

module.exports = remove;
