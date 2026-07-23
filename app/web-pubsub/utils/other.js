const debug = require('debug')('rpx-case-activity-api:web-pubsub-utils');

const other = {
  extractUniqueUserIds: (result, uniqueUserIds) => {
    const userIds = Array.isArray(uniqueUserIds) ? [...uniqueUserIds] : [];
    if (Array.isArray(result)) {
      result.forEach((item) => {
        if (item?.[1]) {
          const users = item[1];
          users.forEach((userId) => {
            if (!userIds.includes(userId)) {
              userIds.push(userId);
            }
          });
        }
      });
    }
    return userIds;
  },
  score: (ttlStr) => {
    const now = Date.now();
    const ttl = Number.parseInt(ttlStr, 10) || 0;
    const score = now + (ttl * 1000);
    debug(`generated score out of current timestamp '${now}' plus ${ttl} sec`);
    return score;
  },
  toUserString: (user) => {
    return user ? JSON.stringify({
      id: user.uid,
      forename: user.given_name,
      surname: user.family_name
    }) : '{}';
  }
};

module.exports = other;
