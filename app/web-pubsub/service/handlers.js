const { Logger } = require('@hmcts/nodejs-logging');
const { randomUUID } = require('node:crypto');
const keys = require('../redis/keys');

const logger = Logger.getLogger('web-pubsub-service-handlers');
const userForLog = (user) => (user ? { uid: user.uid, name: user.name } : null);

function createHandlers(activityService, serviceClient) {
  const refreshTimers = new Map();
  const refreshIntervalMs = Math.max(Math.floor(activityService.ttl.activity * 500), 1000);

  function stopRefreshing(connectionId) {
    const timer = refreshTimers.get(connectionId);
    if (timer) {
      clearInterval(timer);
      refreshTimers.delete(connectionId);
    }
  }

  function startRefreshing(connectionId, user) {
    stopRefreshing(connectionId);
    const timer = setInterval(async () => {
      try {
        const caseId = await activityService.refreshConnectionActivity(connectionId, user);
        if (!caseId) {
          stopRefreshing(connectionId);
        }
      } catch (error) {
        logger.warn(`Failed to refresh activity for connection ${connectionId}`, error);
      }
    }, refreshIntervalMs);
    timer.unref();
    refreshTimers.set(connectionId, timer);
  }

  async function replaceCaseGroups(connection, caseIds) {
    await connection.leaveCaseGroups();
    await Promise.all(
      (Array.isArray(caseIds) ? caseIds : [])
        .filter(Boolean)
        .map((caseId) => connection.join(keys.case.base(caseId)))
    );
  }

  async function addActivity(connection, caseId, user, activity) {
    await replaceCaseGroups(connection, [caseId]);
    logger.warn(
      `Adding activity for caseId ${caseId} user ${JSON.stringify(userForLog(user))} activity ${activity}`
    );
    await activityService.addActivity(caseId, user, connection.id, activity);
    startRefreshing(connection.id, user);
  }

  async function claimNotification(caseId, notificationId) {
    if (!notificationId) {
      return true;
    }
    const key = `web-pubsub:notification:${caseId}:${notificationId}`;
    const claimed = await activityService.redis.set(key, randomUUID(), 'PX', 5000, 'NX');
    return claimed === 'OK';
  }

  async function notify(caseId, options = {}) {
    if (!await claimNotification(caseId, options.notificationId)) {
      return;
    }
    const activity = await activityService.getActivityForCases([caseId]);
    logger.warn(`Notifying Web PubSub case activity: ${JSON.stringify(activity)}`);
    const excludedConnectionId = options.excludedConnectionId || options.excludedSocketId;
    await serviceClient.group(keys.case.base(caseId)).sendToAll(
      { event: 'activity', data: activity },
      excludedConnectionId ? { excludedConnections: [excludedConnectionId] } : {}
    );
  }

  async function removeConnectionActivity(connectionId) {
    logger.warn(`Removing activity for Web PubSub connection ${connectionId}`);
    stopRefreshing(connectionId);
    await activityService.removeConnectionActivity(connectionId);
  }

  async function watch(connection, caseIds) {
    await connection.leaveCaseGroups();
    await activityService.removeConnectionActivity(connection.id);
    stopRefreshing(connection.id);
    await replaceCaseGroups(connection, caseIds);
    const activity = await activityService.getActivityForCases(caseIds);
    await connection.emit('activity', activity);
  }

  async function stop(connection, caseId) {
    logger.warn(`Stop watching case ${caseId} for Web PubSub connection ${connection.id}`);
    if (caseId) {
      await connection.leave(keys.case.base(caseId));
    }
    await activityService.removeConnectionActivity(connection.id);
    stopRefreshing(connection.id);
  }

  async function stopAll(connection, caseIds) {
    if (Array.isArray(caseIds) && caseIds.length > 0) {
      await Promise.all(
        caseIds.filter(Boolean).map((caseId) => connection.leave(keys.case.base(caseId)))
      );
    } else {
      await connection.leaveCaseGroups();
    }
    await activityService.removeUserActivity(connection.id);
    stopRefreshing(connection.id);
  }

  return {
    activityService,
    addActivity,
    notify,
    removeConnectionActivity,
    serviceClient,
    stop,
    stopAll,
    watch
  };
}

module.exports = createHandlers;
