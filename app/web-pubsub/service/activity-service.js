const { Logger } = require('@hmcts/nodejs-logging');
const { randomUUID } = require('node:crypto');
const keys = require('../redis/keys');
const utils = require('../utils');

const logger = Logger.getLogger('connection-activity-service');
const userForLog = (user) => (user ? {
  uid: user.uid,
  name: user.name
} : null);

function createConnectionActivityService(config, redis) {
  const connectionOperations = new Map();
  const ttl = {
    user: config.get('redis.webPubSub.userDetailsTtlSec'),
    activity: config.get('redis.webPubSub.activityTtlSec')
  };

  const notifyChange = (caseId, excludedConnectionId) => {
    if (!caseId) {
      return;
    }
    logger.warn(`Notifying change for caseId ${caseId}`);
    const message = JSON.stringify({
      notificationId: randomUUID(),
      timestamp: Date.now(),
      ...(excludedConnectionId ? { excludedConnectionId } : {})
    });
    redis.publish(keys.case.base(caseId), message);
  };

  // Redis mutations for one connection must run in arrival order. Without this queue,
  // a rapid stop -> view/edit transition can remove the newly-added activity.
  const runConnectionOperation = (connectionId, operation) => {
    if (!connectionId) {
      return Promise.resolve(operation());
    }
    const previous = connectionOperations.get(connectionId) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    connectionOperations.set(connectionId, queued);
    return queued.finally(() => {
      if (connectionOperations.get(connectionId) === queued) {
        connectionOperations.delete(connectionId);
      }
    });
  };

  const getConnectionActivity = async (connectionId) => {
    logger.warn(`Getting activity for connectionId ${connectionId}`);
    if (connectionId) {
      const key = keys.connection(connectionId);
      logger.warn(`Connection activity key: ${key}`);
      return JSON.parse(await redis.get(key));
    }
    return null;
  };

  const getUserDetails = async (userIds) => {
    logger.warn(`Getting user details for userIds ${userIds}`);
    if (Array.isArray(userIds) && userIds.length > 0) {
      logger.warn('Fetching user details from redis');
      // Get hold of the details.
      const details = await redis.pipeline(utils.get.users(userIds)).exec();
      // Now turn them into a map.
      return details.reduce((obj, item) => {
        if (item[1]) {
          const user = JSON.parse(item[1]);
          obj[user.id] = { id: user.id, forename: user.forename, surname: user.surname };
        }
        return obj;
      }, {});
    }
    return {};
  };

  const doRemoveActivity = async (connectionId, removeConnectionEntry = false) => {
    logger.warn(
      `Removing activity for connectionId ${connectionId} removeConnectionEntry=${removeConnectionEntry}`
    );
    // First make sure we actually have some activity to remove.
    const activity = await getConnectionActivity(connectionId);
    if (activity) {
      const pipeline = [utils.remove.userActivity(activity)];
      if (removeConnectionEntry) {
        pipeline.push(utils.remove.connectionEntry(connectionId));
      }
      await redis.pipeline(pipeline).exec();
      return activity.caseId;
    }
    return null;
  };

  // Backwards-compatible wrappers
  const doRemoveConnectionActivity = async (connectionId) => (
    doRemoveActivity(connectionId, true)
  );
  const doRemoveUserActivity = async (connectionId) => doRemoveActivity(connectionId, false);

  const removeConnectionActivity = (connectionId) => runConnectionOperation(
    connectionId,
    async () => {
      const removedCaseId = await doRemoveConnectionActivity(connectionId);
      if (removedCaseId) {
        notifyChange(removedCaseId, connectionId);
      }
    }
  );

  const removeUserActivity = (connectionId) => runConnectionOperation(connectionId, async () => {
    const removedCaseId = await doRemoveUserActivity(connectionId);
    if (removedCaseId) {
      notifyChange(removedCaseId, connectionId);
    }
  });

  const doAddActivity = async (caseId, user, connectionId, activity) => {
    // Now store this activity.
    const activityKey = keys.case[activity](caseId);
    return redis.pipeline([
      utils.store.userActivity(activityKey, user.uid, utils.score(ttl.activity)),
      utils.store.connectionActivity(connectionId, activityKey, caseId, user.uid, ttl.user),
      utils.store.userDetails(user, ttl.user)
    ]).exec();
  };

  const addActivity = (caseId, user, connectionId, activity) => runConnectionOperation(
    connectionId,
    async () => {
      logger.warn(
        `adding activity for caseId '${caseId}', user ${JSON.stringify(userForLog(user))} `
        + `on connection '${connectionId}' with activity '${activity}'`
      );
      if (caseId && user && connectionId && activity) {
        // First, clear out any existing activity on this connection.
        const removedCaseId = await doRemoveConnectionActivity(connectionId);

        // Now store this activity.
        await doAddActivity(caseId, user, connectionId, activity);
        if (removedCaseId !== caseId) {
          notifyChange(removedCaseId, connectionId);
        }
        notifyChange(caseId);
      }
      return null;
    }
  );

  // Renew the sorted-set score and supporting Redis keys for a healthy
  // long-lived Web PubSub connection.
  const refreshConnectionActivity = (connectionId, user) => runConnectionOperation(
    connectionId,
    async () => {
      const currentActivity = await getConnectionActivity(connectionId);
      if (!currentActivity) {
        return null;
      }

      const pipeline = [
        utils.store.userActivity(
          currentActivity.activityKey,
          currentActivity.userId,
          utils.score(ttl.activity)
        ),
        ['expire', keys.connection(connectionId), ttl.user]
      ];
      if (user?.uid) {
        pipeline.push(utils.store.userDetails(user, ttl.user));
      }
      await redis.pipeline(pipeline).exec();
      return currentActivity.caseId;
    }
  );

  const getActivityForCases = async (caseIds) => {
    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return [];
    }
    let uniqueUserIds = [];
    let caseViewers = [];
    let caseEditors = [];
    const now = Date.now();
    const getPromise = async (activity, failureMessage, cb) => {
      const result = await redis.pipeline(
        utils.get.caseActivities(caseIds, activity, now)
      ).exec();

      redis.logPipelineFailures(result, failureMessage);
      cb(result);
      uniqueUserIds = utils.extractUniqueUserIds(result, uniqueUserIds);
    };

    // Set up the promises fore view and edit.
    const caseViewersPromise = getPromise('view', 'caseViewersPromise', (result) => {
      caseViewers = result;
    });
    const caseEditorsPromise = getPromise('edit', 'caseEditorsPromise', (result) => {
      caseEditors = result;
    });

    // Now wait until both promises have been completed.
    await Promise.all([caseViewersPromise, caseEditorsPromise]);

    // Get all the user details for both viewers and editors.
    const userDetails = await getUserDetails(uniqueUserIds);

    // Now produce a response for every case requested.
    return caseIds.map((caseId, index) => {
      const cv = caseViewers[index][1];
      const ce = caseEditors[index][1];
      const viewers = cv ? cv.map((v) => userDetails[v]) : [];
      const editors = ce ? ce.map((e) => userDetails[e]) : [];
      return {
        caseId,
        viewers: viewers.filter((v) => !!v),
        unknownViewers: viewers.filter((v) => !v).length,
        editors: editors.filter((e) => !!e),
        unknownEditors: editors.filter((e) => !e).length
      };
    });
  };

  return {
    addActivity,
    getActivityForCases,
    getConnectionActivity,
    getUserDetails,
    notifyChange,
    redis,
    refreshConnectionActivity,
    removeConnectionActivity,
    ttl,
    removeUserActivity
  };
}

module.exports = createConnectionActivityService;
