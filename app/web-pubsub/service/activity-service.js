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

  const execAtomic = (commands) => {
    if (!Array.isArray(commands) || commands.length === 0) {
      return Promise.resolve([]);
    }
    return redis.multi(commands).exec();
  };

  const scanKeys = (match) => new Promise((resolve, reject) => {
    if (!redis.scanStream) {
      resolve([]);
      return;
    }
    const stream = redis.scanStream({ match, count: 100 });
    const scannedKeys = [];
    let settled = false;
    stream.on('data', (resultKeys) => {
      scannedKeys.push(...resultKeys);
    });
    stream.once('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    stream.once('end', () => {
      if (!settled) {
        settled = true;
        resolve(scannedKeys);
      }
    });
  });

  const notifyChange = (caseId, excludedConnectionId) => {
    if (!caseId) {
      return null;
    }
    logger.warn(`Notifying change for caseId ${caseId}`);
    const options = {
      notificationId: randomUUID(),
      timestamp: Date.now(),
      ...(excludedConnectionId ? { excludedConnectionId } : {})
    };
    redis.publish(keys.case.base(caseId), JSON.stringify(options));
    return { caseId, options };
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
      if (activity.activityMember && activity.userId
        && activity.activityMember !== activity.userId) {
        // Remove the pre-connection-scoped representation too. This is needed for
        // activity written before the Web PubSub member format was introduced.
        pipeline.push(utils.remove.legacyUserActivity(activity));
      }
      if (removeConnectionEntry) {
        pipeline.push(utils.remove.connectionEntry(connectionId));
      }
      await execAtomic(pipeline);
      return activity.caseId;
    }
    return null;
  };

  // Backwards-compatible wrappers
  const doRemoveConnectionActivity = async (connectionId) => (
    doRemoveActivity(connectionId, true)
  );
  const doRemoveUserActivity = async (connectionId) => doRemoveActivity(connectionId, false);

  const removeConnectionActivity = (
    connectionId,
    includeOriginatingConnection = false
  ) => runConnectionOperation(
    connectionId,
    async () => {
      const removedCaseId = await doRemoveConnectionActivity(connectionId);
      if (removedCaseId) {
        return notifyChange(
          removedCaseId,
          includeOriginatingConnection ? undefined : connectionId
        );
      }
      return null;
    }
  );

  const removeUserActivity = (
    connectionId,
    includeOriginatingConnection = false
  ) => runConnectionOperation(
    connectionId,
    async () => {
      const removedCaseId = await doRemoveUserActivity(connectionId);
      if (removedCaseId) {
        return notifyChange(
          removedCaseId,
          includeOriginatingConnection ? undefined : connectionId
        );
      }
      return null;
    }
  );

  // A VPN drop can prevent Web PubSub from delivering its disconnected event.
  // On reconnect, remove this user's old connection-scoped members so activity
  // from the previous case/role cannot survive the new connection.
  const removeStaleUserActivity = async (userId, currentConnectionId) => {
    if (!userId || !redis.scanStream) {
      return [];
    }

    try {
      const keyPrefix = config.get('redis.keyPrefix') || '';
      const scannedKeys = await scanKeys(
        `${keyPrefix}${keys.prefixes.case}:*`
      );
      const activityKeys = scannedKeys.map((key) => (
        key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key
      )).filter((key) => /^(c:.*):(viewers|editors)$/.test(key));
      if (activityKeys.length === 0) {
        return [];
      }

      const activityResults = await Promise.all(
        activityKeys.map((activityKey) => redis.zrange(activityKey, 0, -1))
      );
      const staleEntries = [];
      activityResults.forEach((members, index) => {
        members.filter((member) => {
          const connectionId = utils.connectionIdFromActivityMember(member);
          return connectionId
            && utils.userIdFromActivityMember(member) === String(userId)
            && connectionId !== String(currentConnectionId);
        }).forEach((member) => {
          staleEntries.push({ activityKey: activityKeys[index], member });
        });
      });
      if (staleEntries.length === 0) {
        return [];
      }

      const commands = [];
      const affectedCaseIds = new Set();
      staleEntries.forEach(({ activityKey, member }) => {
        commands.push(['zrem', activityKey, member]);
        commands.push(['del', keys.connection(utils.connectionIdFromActivityMember(member))]);
        const match = activityKey.match(/^c:(.*):(viewers|editors)$/);
        if (match) {
          affectedCaseIds.add(match[1]);
        }
      });
      await execAtomic(commands);
      return [...affectedCaseIds].map((caseId) => notifyChange(caseId));
    } catch (error) {
      logger.warn(`Failed to remove stale activity for user ${userId}`, error);
      return [];
    }
  };

  const doReplaceActivity = async (caseId, user, connectionId, activity) => {
    const previousActivity = await getConnectionActivity(connectionId);
    const activityKey = keys.case[activity](caseId);
    const activityMember = utils.toActivityMember(user.uid, connectionId);
    const commands = [];
    if (previousActivity) {
      commands.push(utils.remove.userActivity(previousActivity));
      if (previousActivity.activityMember && previousActivity.userId
        && previousActivity.activityMember !== previousActivity.userId) {
        commands.push(utils.remove.legacyUserActivity(previousActivity));
      }
    }
    commands.push(
      utils.store.activity(activityKey, activityMember, utils.score(ttl.activity)),
      utils.store.connectionActivity(connectionId, activityKey, caseId, user.uid, ttl.user),
      utils.store.userDetails(user, ttl.user)
    );
    await execAtomic(commands);
    return previousActivity?.caseId || null;
  };

  const addActivity = (caseId, user, connectionId, activity) => runConnectionOperation(
    connectionId,
    async () => {
      logger.warn(
        `adding activity for caseId '${caseId}', user ${JSON.stringify(userForLog(user))} `
        + `on connection '${connectionId}' with activity '${activity}'`
      );
      if (caseId && user && connectionId && activity) {
        // Replacing a connection's old activity and adding its new activity must be
        // atomic. Otherwise another user's notification can observe the gap between
        // the two operations and broadcast an incomplete multi-user list.
        const removedCaseId = await doReplaceActivity(caseId, user, connectionId, activity);
        const changes = [];
        if (removedCaseId !== caseId) {
          changes.push(notifyChange(removedCaseId, connectionId));
        }
        changes.push(notifyChange(caseId));
        return changes.filter(Boolean);
      }
      return [];
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

      const pipeline = [];
      if (currentActivity.activityMember && currentActivity.userId
        && currentActivity.activityMember !== currentActivity.userId) {
        pipeline.push(utils.remove.legacyUserActivity(currentActivity));
      }
      pipeline.push(
        utils.store.activity(
          currentActivity.activityKey,
          currentActivity.activityMember || currentActivity.userId,
          utils.score(ttl.activity)
        ),
        ['expire', keys.connection(connectionId), ttl.user]
      );
      if (user?.uid) {
        pipeline.push(utils.store.userDetails(user, ttl.user));
      }
      await execAtomic(pipeline);
      return currentActivity.caseId;
    }
  );

  const getActivityForCases = async (caseIds) => {
    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return [];
    }
    const now = Date.now();
    const viewerCommands = utils.get.caseActivities(caseIds, 'view', now);
    const editorCommands = utils.get.caseActivities(caseIds, 'edit', now);
    // Read both roles in one transaction so a mixed view/edit update cannot be
    // assembled from two different points in time.
    const activityResult = await execAtomic([...viewerCommands, ...editorCommands]);
    redis.logPipelineFailures(activityResult, 'caseActivitySnapshot');
    const toUserIdResults = (results) => results.map(([error, members]) => [
      error,
      // Connection-scoped members are the only entries that can be tied to a
      // currently managed Web PubSub connection. Ignore legacy plain user IDs,
      // which can survive a backend restart and otherwise appear indefinitely.
      utils.uniqueUserIdsFromActivityMembers(
        Array.isArray(members)
          ? members.filter((member) => utils.userIdFromActivityMember(member) !== member)
          : []
      )
    ]);
    const caseViewers = toUserIdResults(activityResult.slice(0, viewerCommands.length));
    const caseEditors = toUserIdResults(activityResult.slice(viewerCommands.length));
    const uniqueUserIds = utils.extractUniqueUserIds(
      caseEditors,
      utils.extractUniqueUserIds(caseViewers, [])
    );

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
    removeStaleUserActivity,
    ttl,
    removeUserActivity
  };
}

module.exports = createConnectionActivityService;
