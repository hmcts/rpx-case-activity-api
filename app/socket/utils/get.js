const { Logger } = require('@hmcts/nodejs-logging');
const keys = require('../redis/keys');

const logger = Logger.getLogger('socket-utils-get');

const get = {
  caseActivities: (caseIds, activity, now) => {
    logger.warn(`getting case activities for activity '${activity}' and caseIds: ${caseIds}`);
    if (Array.isArray(caseIds) && ['view', 'edit'].includes(activity)) {
      return caseIds.filter((id) => !!id).map((id) => {
        return ['zrangebyscore', keys.case[activity](id), now, '+inf'];
      });
    }
    return [];
  },
  users: (userIds) => {
    logger.warn(`getting user details for userIds: ${userIds}`);
    if (Array.isArray(userIds)) {
      return userIds.filter((id) => !!id).map((id) => ['get', keys.user(id)]);
    }
    return [];
  }
};

module.exports = get;
