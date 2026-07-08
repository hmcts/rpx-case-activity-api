const { Logger } = require('@hmcts/nodejs-logging');
const debug = require('debug')('rpx-case-activity-api:get-activities');
const utils = require('../util/utils');

const logger = Logger.getLogger('get-activities');
const { ifNotTimedOut } = utils;

const getActivities = (activityService) => (req, res, next) => {
  logger.warn(`GET_ACTIVITIES request received at ${new Date().toISOString()}`);

  const caseIds = req.params.caseids.split(',');
  const { user } = req.authentication;
  const { token } = req.authentication;

  logger.warn(`GET_ACTIVITIES request for caseIds: ${caseIds}`);

  debug(`GET_ACTIVITIES request for caseIds: ${caseIds}`);
  activityService.getActivities(caseIds, user, token)
    .then((result) => ifNotTimedOut(req, () => {
      debug(`GET_ACTIVITIES response is ==> ${JSON.stringify(result)}`);
      res.status(200).json(result);
    }))
    .catch((err) => ifNotTimedOut(req, () => {
      next(err.message);
    }));
};

module.exports = getActivities;
