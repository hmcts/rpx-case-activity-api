const debug = require('debug')('rpx-case-activity-api:web-pubsub-utils-store');
const redisActivityKeys = require('../redis/keys');
const { toActivityMember, toUserString } = require('./other');

const store = {
  activity: (activityKey, activityMember, score) => {
    debug(`about to store activity "${activityKey}" for member "${activityMember}"`);
    return ['zadd', activityKey, score, activityMember];
  },
  userActivity: (activityKey, userId, score) => {
    debug(`about to store activity "${activityKey}" for user "${userId}"`);
    return store.activity(activityKey, userId, score);
  },
  userDetails: (user, ttl) => {
    const key = redisActivityKeys.user(user.uid);
    const userString = toUserString(user);
    debug(`about to store details "${key}" for user "${user.uid}": ${userString}`);
    return ['set', key, userString, 'EX', ttl];
  },
  connectionActivity: (connectionId, activityKey, caseId, userId, ttl) => {
    const key = redisActivityKeys.connection(connectionId);
    const activityMember = toActivityMember(userId, connectionId);
    const userString = JSON.stringify({
      activityKey, activityMember, caseId, userId
    });
    debug(`about to store activity "${key}" for connection "${connectionId}": ${userString}`);
    return ['set', key, userString, 'EX', ttl];
  }
};

module.exports = store;
