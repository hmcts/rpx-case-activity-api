const { Logger } = require('@hmcts/nodejs-logging');
const createConnection = require('./connection');

const logger = Logger.getLogger('web-pubsub-router');
const EVENTS = new Set(['view', 'edit', 'watch', 'stop', 'stopAll']);

function firstQueryValue(queries, name) {
  const value = queries?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function normaliseUser(user, fallbackUserId) {
  if (!user) {
    return fallbackUserId ? { uid: fallbackUserId, name: fallbackUserId } : null;
  }
  return {
    ...user,
    uid: user.uid || user.idamId || user.id || fallbackUserId,
    name: user.name || [user.forename || user.given_name, user.surname || user.family_name]
      .filter(Boolean)
      .join(' ')
  };
}

function getRequestData(request) {
  if (request.data && typeof request.data === 'object' && !Buffer.isBuffer(request.data)) {
    return request.data;
  }
  if (typeof request.data === 'string' && request.data) {
    try {
      return JSON.parse(request.data);
    } catch (error) {
      logger.warn(`Failed to parse ${request.context.eventName} Web PubSub message`, error);
    }
  }
  return {};
}

function normaliseCaseIds(value) {
  let asArray = [value];
  if (Array.isArray(value)) {
    asArray = value;
  } else if (value === undefined || value === null) {
    asArray = [];
  }
  return asArray
    .map((caseId) => (typeof caseId === 'number' ? String(caseId) : caseId))
    .filter((caseId) => typeof caseId === 'string')
    .map((caseId) => caseId.trim())
    .filter(Boolean);
}

function buildAckFailureLog(ackId, errorName, message) {
  return {
    type: 'ack',
    ackId,
    success: false,
    error: {
      name: errorName,
      message
    }
  };
}

function errorForLog(error) {
  return [
    `name=${error?.name || '<missing>'}`,
    `message=${error?.message || String(error)}`,
    `code=${error?.code || '<missing>'}`,
    `statusCode=${error?.statusCode || error?.status || '<missing>'}`,
    `stage=${error?.webPubSubStage || '<unknown>'}`
  ].join(' ');
}

function createRouter(serviceClient, handlers, authSession, caseAccessChecker) {
  const expiryTimers = new Map();

  function clearExpiryTimer(connectionId) {
    clearTimeout(expiryTimers.get(connectionId));
    expiryTimers.delete(connectionId);
  }

  function closeExpiredConnection(connectionId) {
    return serviceClient.closeConnection(connectionId, { reason: 'Activity session expired' })
      .catch(() => logger.warn(`Failed to close expired activity connection ${connectionId}`));
  }

  function scheduleSessionExpiry(connectionId, expiresAt) {
    clearExpiryTimer(connectionId);
    if (!Number.isFinite(expiresAt)) {
      return;
    }
    const timer = setTimeout(() => {
      expiryTimers.delete(connectionId);
      // The toolkit already renegotiates on disconnect/stopped. Close the expired
      // connection so it cannot remain subscribed with unusable credentials.
      closeExpiredConnection(connectionId);
    }, Math.max(0, expiresAt - Date.now()));
    timer.unref();
    expiryTimers.set(connectionId, timer);
  }

  async function handleConnect(request, response) {
    const sessionId = firstQueryValue(request.queries || request.query, 'session');
    let authentication;
    try {
      authentication = await authSession.get(sessionId);
    } catch (error) {
      response.fail(503, 'Unable to verify user');
      return;
    }
    const user = normaliseUser(authentication?.user);
    logger.warn(
      `Web PubSub connect received connectionId=${request.context.connectionId} `
      + `userId=${request.context.userId || '<missing>'}`
    );
    if (!user?.uid) {
      logger.warn('Web PubSub connect failed: missing user uid');
      response.fail(401, 'A user is required');
      return;
    }
    if (!request.context.userId || String(user.uid) !== String(request.context.userId)) {
      logger.warn(
        `Web PubSub connect failed: token userId=${request.context.userId} `
        + `does not match payload uid=${user.uid}`
      );
      response.fail(401, 'The user does not match the access token');
      return;
    }
    if (typeof handlers.cleanupReconnectedUser === 'function') {
      await handlers.cleanupReconnectedUser(user.uid, request.context.connectionId);
    }
    response.setState('user', user);
    response.setState('session', sessionId);
    response.setState('rooms', []);
    scheduleSessionExpiry(request.context.connectionId, authentication.expiresAt);
    logger.warn(`Web PubSub connect accepted for uid=${user.uid}`);
    response.success({ userId: String(user.uid) });
  }

  async function handleUserEvent(request, response) {
    const { eventName, connectionId } = request.context;
    const ackId = request.context?.ackId ?? request.data?.ackId;
    logger.warn(
      `Web PubSub message received connectionId=${connectionId} event=${eventName}`
    );
    if (!EVENTS.has(eventName)) {
      logger.warn(`Web PubSub message rejected: unsupported event=${eventName}`);
      const ackPayload = buildAckFailureLog(
        ackId,
        'BadRequest',
        `Unsupported event: ${eventName}`
      );
      logger.warn(
        `Web PubSub ACK failure response event=${eventName} ackId=${ackId ?? '<missing>'} `
        + `connectionId=${connectionId} status=400 reason=unsupported-event payload=${JSON.stringify(ackPayload)}`
      );
      response.fail(400, `Unsupported event: ${eventName}`);
      return;
    }

    const connection = createConnection(serviceClient, request.context);
    let user = normaliseUser(request.context.states?.user);
    const data = getRequestData(request);
    const watchCaseIds = normaliseCaseIds(data.caseIds ?? data.caseId);
    const activityCaseIds = normaliseCaseIds(data.caseId);
    const stopAllCaseIds = normaliseCaseIds(data.caseIds);
    logger.warn(
      `Web PubSub event payload event=${eventName} uid=${user?.uid || '<missing>'} `
      + `data=${JSON.stringify(data)} watchCaseIds=${JSON.stringify(watchCaseIds)}`
    );

    if (eventName === 'watch' && watchCaseIds.length === 0) {
      const ackPayload = buildAckFailureLog(
        ackId,
        'BadRequest',
        'watch requires at least one caseId'
      );
      logger.warn(
        `Web PubSub ACK failure response event=${eventName} ackId=${ackId ?? '<missing>'} `
        + `connectionId=${connectionId} status=400 reason=missing-caseIds payload=${JSON.stringify(ackPayload)}`
      );
      response.fail(400, 'watch requires at least one caseId');
      return;
    }

    const actions = {
      view: () => handlers.addActivity(connection, activityCaseIds[0], user, 'view'),
      edit: () => handlers.addActivity(connection, activityCaseIds[0], user, 'edit'),
      watch: () => handlers.watch(connection, watchCaseIds),
      stop: () => handlers.stop(connection, data.caseId),
      stopAll: () => handlers.stopAll(connection, stopAllCaseIds)
    };

    try {
      if (['watch', 'view', 'edit'].includes(eventName)) {
        const authentication = await authSession.get(request.context.states?.session);
        if (!authentication?.token || !authentication.user?.uid
          || String(authentication.user.uid) !== String(request.context.userId)) {
          response.fail(401, 'A valid user session is required');
          await closeExpiredConnection(connectionId);
          return;
        }
        user = normaliseUser(authentication.user);
        const caseIds = eventName === 'watch' ? watchCaseIds : activityCaseIds;
        const invalidActivityCase = eventName !== 'watch'
          && (Array.isArray(data.caseId) || caseIds.length !== 1);
        if (invalidActivityCase || caseIds.length === 0
          || caseIds.some((caseId) => !/^\d{1,16}$/.test(caseId))) {
          response.fail(400, 'Invalid caseId');
          return;
        }
        // Authorize the entire batch before joining groups, reading or mutating activity.
        await caseAccessChecker.assertUserHasAccess(
          caseIds, authentication.token, authentication.serviceAuthorization
        );
      }
      logger.warn(`Web PubSub event handling started event=${eventName} connectionId=${connectionId}`);
      await actions[eventName]();
      response.setState('rooms', [...connection.rooms]);
      logger.warn(`Web PubSub event handled successfully event=${eventName} connectionId=${connectionId}`);
      response.success();
    } catch (error) {
      if ([401, 403, 502].includes(error.status)) {
        response.fail(error.status, error.status === 403
          ? 'You are not authorized to access one or more requested cases'
          : 'Unable to verify case access');
        return;
      }
      logger.warn(`Web PubSub ${eventName} handler failed ${errorForLog(error)}`, error);
      const ackPayload = buildAckFailureLog(
        ackId,
        'InternalServerError',
        'Internal server error'
      );
      logger.warn(`Web PubSub event handling failed event=${eventName} connectionId=${connectionId}; sending 500`);
      logger.warn(
        `Web PubSub ACK failure response event=${eventName} ackId=${ackId ?? '<missing>'} `
        + `connectionId=${connectionId} status=500 reason=handler-error payload=${JSON.stringify(ackPayload)}`
      );
      response.fail(500, 'Failed to process message');
    }
  }

  function onDisconnected(request) {
    clearExpiryTimer(request.context.connectionId);
    logger.warn(`Web PubSub disconnected connectionId=${request.context.connectionId}`);
    handlers.removeConnectionActivity(request.context.connectionId).catch((error) => {
      logger.warn(`Web PubSub disconnect cleanup failed for ${request.context.connectionId}`, error);
    });
  }

  return { handleConnect, handleUserEvent, onDisconnected };
}

module.exports = createRouter;
