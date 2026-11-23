const { Logger } = require('@hmcts/nodejs-logging');
const { randomUUID } = require('node:crypto');
const keys = require('../redis/keys');

const logger = Logger.getLogger('web-pubsub-service-handlers');
const userForLog = (user) => (user ? { uid: user.uid, name: user.name } : null);
const NOTIFICATION_DEBOUNCE_MS = 200;

function createHandlers(activityService, serviceClient) {
  const refreshTimers = new Map();
  const pendingNotifications = new Map();
  const refreshIntervalMs = Math.max(Math.floor(activityService.ttl.activity * 500), 1000);

  function stopRefreshing(connectionId) {
    const timer = refreshTimers.get(connectionId);
    if (timer) {
      clearInterval(timer);
      refreshTimers.delete(connectionId);
    }
  }

  async function runWatchStage(stage, operation) {
    logger.warn(`Web PubSub watch stage started stage=${stage}`);
    try {
      const result = await operation();
      logger.warn(`Web PubSub watch stage completed stage=${stage}`);
      return result;
    } catch (error) {
      const stagedError = new Error(error?.message || String(error), { cause: error });
      stagedError.name = error?.name || stagedError.name;
      stagedError.code = error?.code;
      stagedError.statusCode = error?.statusCode || error?.status;
      stagedError.webPubSubStage = stage;
      throw stagedError;
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

  async function claimNotification(caseId, notificationId) {
    if (!notificationId) {
      return true;
    }
    const key = `web-pubsub:notification:${caseId}:${notificationId}`;
    const claimed = await activityService.redis.set(key, randomUUID(), 'PX', 5000, 'NX');
    return claimed === 'OK';
  }

  async function sendNotification(caseId, options) {
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

  function notify(caseId, options = {}) {
    return new Promise((resolve, reject) => {
      // A view -> edit transition can publish a removal followed by an addition. Wait for the
      // transition to settle so clients receive the final Redis state rather than both states.
      const pending = pendingNotifications.get(caseId) || { waiters: [] };
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.options = options;
      pending.waiters.push({ resolve, reject });
      pending.timer = setTimeout(async () => {
        pendingNotifications.delete(caseId);
        try {
          await sendNotification(caseId, pending.options);
          pending.waiters.forEach((waiter) => waiter.resolve());
        } catch (error) {
          pending.waiters.forEach((waiter) => waiter.reject(error));
        }
      }, NOTIFICATION_DEBOUNCE_MS);
      pendingNotifications.set(caseId, pending);
    });
  }

  async function notifyPublishedChanges(changes, includeOriginatingConnection = false) {
    const publishedChanges = Array.isArray(changes)
      ? changes
      : [changes].filter(Boolean);
    await Promise.all(
      publishedChanges
        .filter((change) => change?.caseId)
        .map(async ({ caseId, options }) => {
          try {
            const broadcastOptions = includeOriginatingConnection
              ? { ...options, excludedConnectionId: undefined, excludedSocketId: undefined }
              : options;
            await notify(caseId, broadcastOptions);
          } catch (error) {
            // Activity changes are already persisted at this point. A failure to
            // broadcast them must not turn the originating client event into a 500.
            logger.warn(
              `Failed to broadcast Web PubSub activity for caseId ${caseId}`,
              error
            );
          }
        })
    );
  }

  async function addActivity(connection, caseId, user, activity) {
    await replaceCaseGroups(connection, [caseId]);
    logger.warn(
      `Adding activity for caseId ${caseId} user ${JSON.stringify(userForLog(user))} activity ${activity}`
    );
    const changes = await activityService.addActivity(caseId, user, connection.id, activity);
    startRefreshing(connection.id, user);
    await notifyPublishedChanges(changes);
  }

  async function removeConnectionActivity(connectionId) {
    logger.warn(`Removing activity for Web PubSub connection ${connectionId}`);
    stopRefreshing(connectionId);
    const change = await activityService.removeConnectionActivity(connectionId);
    await notifyPublishedChanges(change);
  }

  async function cleanupReconnectedUser(userId, connectionId) {
    const changes = await activityService.removeStaleUserActivity(userId, connectionId);
    await notifyPublishedChanges(changes, true);
  }

  async function watch(connection, caseIds) {
    const change = await runWatchStage(
      'remove-activity',
      () => activityService.removeConnectionActivity(connection.id, true)
    );
    // The connection is still subscribed to its previous case group. Broadcast the removal
    // before replacing groups so a user navigating to search also clears their old presence.
    await notifyPublishedChanges(change, true);
    stopRefreshing(connection.id);
    await runWatchStage('update-groups', () => replaceCaseGroups(connection, caseIds));
    const activity = await runWatchStage(
      'get-activity',
      () => activityService.getActivityForCases(caseIds)
    );
    await runWatchStage('emit-activity', () => connection.emit('activity', activity));
    return undefined;
  }

  async function stop(connection, caseId) {
    logger.warn(`Stop watching case ${caseId} for Web PubSub connection ${connection.id}`);
    const change = await activityService.removeConnectionActivity(connection.id, true);
    stopRefreshing(connection.id);
    // Broadcast while the source connection is still in the case group. The client that
    // stopped viewing/editing must receive the refreshed list as well as the other clients.
    await notifyPublishedChanges(change, true);
    if (caseId) {
      await connection.leave(keys.case.base(caseId));
    }
  }

  async function stopAll(connection, caseIds) {
    const change = await activityService.removeUserActivity(connection.id, true);
    stopRefreshing(connection.id);
    // Keep the connection subscribed until the removal snapshot has been delivered to it.
    await notifyPublishedChanges(change, true);
    if (Array.isArray(caseIds) && caseIds.length > 0) {
      await Promise.all(
        caseIds.filter(Boolean).map((caseId) => connection.leave(keys.case.base(caseId)))
      );
    } else {
      await connection.leaveCaseGroups();
    }
  }

  return {
    activityService,
    addActivity,
    cleanupReconnectedUser,
    notify,
    removeConnectionActivity,
    serviceClient,
    stop,
    stopAll,
    watch
  };
}

module.exports = createHandlers;
