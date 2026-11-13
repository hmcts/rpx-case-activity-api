const debug = require('debug')('rpx-case-activity-api:activity-service');

const noopCaseAccessChecker = {
  assertUserHasAccess: () => Promise.resolve(),
};

function createActivityService(
  config,
  redis,
  ttlScoreGenerator,
  caseAccessChecker = noopCaseAccessChecker
) {
  const redisActivityKeys = {
    view: (caseId) => `case:${caseId}:viewers`,
    edit: (caseId) => `case:${caseId}:editors`,
  };
  const getUserDetails = (uniqueUserIds) => redis.pipeline(
    uniqueUserIds.map((userId) => ['get', `user:${userId}`])
  ).exec();

  const extractUniqueUserIds = (result, uniqueUserIds) => {
    result.forEach((item) => {
      item[1].forEach((userId) => {
        if (!uniqueUserIds.includes(userId)) {
          uniqueUserIds.push(userId);
        }
      });
    });
  };

  const getActivityUsers = (activityResult, user, userDetails, uniqueUserIds) => {
    if (!activityResult) {
      return [];
    }

    return activityResult
      .filter((element) => element !== user.uid.toString())
      .map((item) => JSON.parse(userDetails[uniqueUserIds.indexOf(item)][1]));
  };

  const addActivity = (caseId, user, activity, authorization) => (
    caseAccessChecker.assertUserHasAccess([caseId], authorization)
      .then(() => {
        const storeUserActivity = () => {
          const key = redisActivityKeys[activity](caseId);
          debug(`about to store user activity with key: ${key}`);
          return ['zadd', key, ttlScoreGenerator.getScore(), user.uid];
        };

        const storeUserDetails = () => {
          const userDetails = JSON.stringify({
            forename: user.given_name,
            surname: user.family_name,
          });
          const key = `user:${user.uid}`;
          debug(`about to store user details with key ${key}: ${userDetails}`);
          return ['set', key, userDetails, 'EX', config.get('redis.userDetailsTtlSec')];
        };

        return redis.pipeline([
          storeUserActivity(),
          storeUserDetails(),
        ]).exec();
      })
  );

  const getActivities = async (caseIds, user, authorization) => {
    await caseAccessChecker.assertUserHasAccess(caseIds, authorization);

    const uniqueUserIds = [];
    const now = Date.now();
    const [caseViewers, caseEditors] = await Promise.all([
      redis.pipeline(
        caseIds.map((caseId) => ['zrangebyscore', `case:${caseId}:viewers`, now, '+inf'])
      ).exec(),
      redis.pipeline(
        caseIds.map((caseId) => ['zrangebyscore', `case:${caseId}:editors`, now, '+inf'])
      ).exec(),
    ]);

    redis.logPipelineFailures(caseViewers, 'caseViewersPromise');
    extractUniqueUserIds(caseViewers, uniqueUserIds);
    redis.logPipelineFailures(caseEditors, 'caseEditorsPromise');
    extractUniqueUserIds(caseEditors, uniqueUserIds);
    const userDetails = await getUserDetails(uniqueUserIds);
    redis.logPipelineFailures(userDetails, 'userDetails');

    return caseIds.map((elem, index) => {
      const viewers = getActivityUsers(caseViewers[index][1], user, userDetails, uniqueUserIds);
      const editors = getActivityUsers(caseEditors[index][1], user, userDetails, uniqueUserIds);

      return {
        caseId: elem,
        viewers: viewers.filter(Boolean),
        unknownViewers: viewers.reduce(
          (sum, el) => sum + Number(el === null || el === undefined),
          0
        ),
        editors: editors.filter(Boolean),
        unknownEditors: editors.reduce(
          (sum, el) => sum + Number(el === null || el === undefined),
          0
        ),
      };
    });
  };

  return { addActivity, getActivities };
}

module.exports = createActivityService;
