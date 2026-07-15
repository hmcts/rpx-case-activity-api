const { Logger } = require('@hmcts/nodejs-logging');
const keys = require('../redis/keys');
const utils = require('../utils');

const logger = Logger.getLogger('socket-activity-service');
const userForLog = (user) => (user ? {
  uid: user.uid,
  name: user.name
} : null);

function createSocketActivityService(config, redis) {
  const socketOperations = new Map();
  const ttl = {
    user: config.get('redis.socket.userDetailsTtlSec'),
    activity: config.get('redis.socket.activityTtlSec')
  };

  const notifyChange = (caseId, excludedSocketId) => {
    if (!caseId) {
      return;
    }
    logger.warn(`Notifying change for caseId ${caseId}`);
    const message = excludedSocketId
      ? JSON.stringify({ timestamp: Date.now(), excludedSocketId })
      : Date.now().toString();
    redis.publish(keys.case.base(caseId), message);
  };

  // Redis mutations for one socket must run in arrival order. Without this queue,
  // a rapid stop -> view/edit transition can remove the newly-added activity.
  const runSocketOperation = (socketId, operation) => {
    if (!socketId) {
      return Promise.resolve(operation());
    }
    const previous = socketOperations.get(socketId) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    socketOperations.set(socketId, queued);
    return queued.finally(() => {
      if (socketOperations.get(socketId) === queued) {
        socketOperations.delete(socketId);
      }
    });
  };

  const getSocketActivity = async (socketId) => {
    logger.warn(`Getting socket activity for socketId ${socketId}`);
    if (socketId) {
      const key = keys.socket(socketId);
      logger.warn(`Socket activity key: ${key}`);
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

  const doRemoveActivity = async (socketId, removeSocketEntry = false) => {
    logger.warn(
      `Removing activity for socketId ${socketId} removeSocketEntry=${removeSocketEntry}`
    );
    // First make sure we actually have some activity to remove.
    const activity = await getSocketActivity(socketId);
    if (activity) {
      const pipeline = [utils.remove.userActivity(activity)];
      if (removeSocketEntry) {
        pipeline.push(utils.remove.socketEntry(socketId));
      }
      await redis.pipeline(pipeline).exec();
      return activity.caseId;
    }
    return null;
  };

  // Backwards-compatible wrappers
  const doRemoveSocketActivity = async (socketId) => doRemoveActivity(socketId, true);
  const doRemoveUserActivity = async (socketId) => doRemoveActivity(socketId, false);

  const removeSocketActivity = (socketId) => runSocketOperation(socketId, async () => {
    const removedCaseId = await doRemoveSocketActivity(socketId);
    if (removedCaseId) {
      notifyChange(removedCaseId, socketId);
    }
  });

  const removeUserActivity = (socketId) => runSocketOperation(socketId, async () => {
    const removedCaseId = await doRemoveUserActivity(socketId);
    if (removedCaseId) {
      notifyChange(removedCaseId, socketId);
    }
  });

  const doAddActivity = async (caseId, user, socketId, activity) => {
    // Now store this activity.
    const activityKey = keys.case[activity](caseId);
    return redis.pipeline([
      utils.store.userActivity(activityKey, user.uid, utils.score(ttl.activity)),
      utils.store.socketActivity(socketId, activityKey, caseId, user.uid, ttl.user),
      utils.store.userDetails(user, ttl.user)
    ]).exec();
  };

  const addActivity = (caseId, user, socketId, activity) => runSocketOperation(
    socketId,
    async () => {
      logger.warn(
        `adding activity for caseId '${caseId}', user ${JSON.stringify(userForLog(user))} `
        + `on socket '${socketId}' with activity '${activity}'`
      );
      if (caseId && user && socketId && activity) {
        // First, clear out any existing activity on this socket.
        const removedCaseId = await doRemoveSocketActivity(socketId);

        // Now store this activity.
        await doAddActivity(caseId, user, socketId, activity);
        if (removedCaseId !== caseId) {
          notifyChange(removedCaseId, socketId);
        }
        notifyChange(caseId);
      }
      return null;
    }
  );

  // Renew the sorted-set score and supporting Redis keys from the existing
  // Engine.IO heartbeat. This keeps a healthy long-lived socket visible beyond
  // redis.socket.activityTtlSec without adding another browser timer.
  const refreshSocketActivity = (socketId, user) => runSocketOperation(socketId, async () => {
    const currentActivity = await getSocketActivity(socketId);
    if (!currentActivity) {
      return null;
    }

    const pipeline = [
      utils.store.userActivity(
        currentActivity.activityKey,
        currentActivity.userId,
        utils.score(ttl.activity)
      ),
      ['expire', keys.socket(socketId), ttl.user]
    ];
    if (user?.uid) {
      pipeline.push(utils.store.userDetails(user, ttl.user));
    }
    await redis.pipeline(pipeline).exec();
    return currentActivity.caseId;
  });

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
    getSocketActivity,
    getUserDetails,
    notifyChange,
    redis,
    refreshSocketActivity,
    removeSocketActivity,
    ttl,
    removeUserActivity
  };
}

module.exports = createSocketActivityService;
