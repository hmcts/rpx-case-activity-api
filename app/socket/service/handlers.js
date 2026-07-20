const { Logger } = require('@hmcts/nodejs-logging');
const keys = require('../redis/keys');
const utils = require('../utils');

const logger = Logger.getLogger('socket-service-handlers');
const userForLog = (user) => (user ? {
  uid: user.uid,
  name: user.name
} : null);

function createSocketHandlers(activityService, socketServer) {
  const activeSocketIds = new Set();
  /**
   * Handle a user viewing or editing a case on a specific socket.
   * @param {*} socket The socket they're connected on.
   * @param {*} caseId The id of the case they're viewing or editing.
   * @param {*} user The user object.
   * @param {*} activity Whether they're viewing or editing.
   */
  async function addActivity(socket, caseId, user, activity) {
    // Update what's being watched.
    utils.watch.update(socket, [caseId]);

    logger.warn(
      `Adding activity for caseId ${caseId} user ${JSON.stringify(userForLog(user))} activity ${activity}`
    );

    // Then add this new activity to redis, which will also clear out the old activity.
    await activityService.addActivity(caseId, user, socket.id, activity);
    activeSocketIds.add(socket.id);
  }

  /**
   * Notify all users in a case room about any change to activity on a case.
   * @param {*} caseId The id of the case that has activity and that people should be
   * notified about.
   */
  async function notify(caseId, options = {}) {
    const cs = await activityService.getActivityForCases([caseId]);
    logger.warn(`notifying case activity: ${JSON.stringify(cs)}`);
    // With the Redis adapter enabled, each node receives the same case-change
    // pub/sub signal. Emit locally so each connected client sees one message.
    const emitter = socketServer.local || socketServer;
    const roomEmitter = emitter.to(keys.case.base(caseId));
    const targetEmitter = options.excludedSocketId && typeof roomEmitter.except === 'function'
      ? roomEmitter.except(options.excludedSocketId)
      : roomEmitter;
    targetEmitter.emit('activity', cs);
  }

  /**
   * Remove any activity associated with a socket. This can be called when the
   * socket disconnects.
   * @param {*} socketId The id of the socket to remove activity for.
   */
  async function removeSocketActivity(socketId) {
    logger.warn(`Removing socket activity for socketId ${socketId}`);
    await activityService.removeSocketActivity(socketId);
    activeSocketIds.delete(socketId);
  }

  async function refreshSocketActivity(socket, user) {
    if (activeSocketIds.has(socket.id)) {
      await activityService.refreshSocketActivity(socket.id, user);
    }
  }

  /**
   * Handle a user watching a bunch of cases on a specific socket.
   * @param {*} socket The socket they're connected on.
   * @param {*} caseIds The ids of the cases they're interested in.
   */
  async function watch(socket, caseIds) {
    // Stop watching the current cases.
    utils.watch.stop(socket);

    // Remove the activity for this socket.
    await activityService.removeSocketActivity(socket.id);
    activeSocketIds.delete(socket.id);

    // Now watch the specified cases.
    utils.watch.cases(socket, caseIds);

    // And immediately dispatch a message about the activity on those cases.
    const cs = await activityService.getActivityForCases(caseIds);
    socket.emit('activity', cs);
  }

  async function stop(socket, caseId) {
    // Stop watching the current cases.
    logger.warn(`Stop watching cases to ${caseId} for socket ${socket.id}`);
    if (caseId) {
      socket.leave(keys.case.base(caseId));
    }

    // Remove the activity and socket entry so a following watch does not
    // publish a second stale single-case activity update.
    await activityService.removeSocketActivity(socket.id);
    activeSocketIds.delete(socket.id);
  }

  async function stopAll(socket, caseIds) {
    if (Array.isArray(caseIds) && caseIds.length > 0) {
      caseIds.forEach((caseId) => {
        if (caseId) {
          socket.leave(keys.case.base(caseId));
        }
      });
    } else {
      utils.watch.stop(socket);
    }

    // Remove the activity for this socket.
    await activityService.removeUserActivity(socket.id);
    activeSocketIds.delete(socket.id);
  }

  return {
    activityService,
    addActivity,
    notify,
    refreshSocketActivity,
    removeSocketActivity,
    socketServer,
    watch,
    stop,
    stopAll
  };
}

module.exports = createSocketHandlers;
