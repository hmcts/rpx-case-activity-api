const debug = require('debug')('rpx-case-activity-api:web-pubsub-utils');

const ACTIVITY_MEMBER_PREFIX = 'web-pubsub-connection:';

const toActivityMember = (userId, connectionId) => (
  `${ACTIVITY_MEMBER_PREFIX}${JSON.stringify([String(userId), String(connectionId)])}`
);

const userIdFromActivityMember = (member) => {
  if (typeof member !== 'string' || !member.startsWith(ACTIVITY_MEMBER_PREFIX)) {
    return member;
  }
  try {
    const decoded = JSON.parse(member.slice(ACTIVITY_MEMBER_PREFIX.length));
    return Array.isArray(decoded) && decoded.length === 2 ? decoded[0] : member;
  } catch (error) {
    debug(`failed to decode activity member '${member}'`);
    return member;
  }
};

const connectionIdFromActivityMember = (member) => {
  if (typeof member !== 'string' || !member.startsWith(ACTIVITY_MEMBER_PREFIX)) {
    return null;
  }
  try {
    const decoded = JSON.parse(member.slice(ACTIVITY_MEMBER_PREFIX.length));
    return Array.isArray(decoded) && decoded.length === 2 ? decoded[1] : null;
  } catch (error) {
    debug(`failed to decode connection from activity member '${member}'`);
    return null;
  }
};

const uniqueUserIdsFromActivityMembers = (members) => (
  Array.isArray(members)
    ? [...new Set(members.map(userIdFromActivityMember).filter(Boolean))]
    : []
);

const other = {
  toActivityMember,
  userIdFromActivityMember,
  connectionIdFromActivityMember,
  uniqueUserIdsFromActivityMembers,
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
      forename: user.forename || user.given_name,
      surname: user.surname || user.family_name
    }) : '{}';
  }
};

module.exports = other;
