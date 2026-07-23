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

function parseUser(request) {
  const storedUser = request.context.states?.user;
  if (storedUser && typeof storedUser === 'object') {
    return normaliseUser(storedUser, request.context.userId);
  }
  const queryUser = firstQueryValue(request.queries || request.query, 'user');
  if (typeof queryUser === 'string') {
    try {
      return normaliseUser(JSON.parse(queryUser), request.context.userId);
    } catch (error) {
      logger.warn('Failed to parse user from Web PubSub connection query', error);
    }
  }
  return normaliseUser(null, request.context.userId);
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

function createRouter(serviceClient, handlers) {
  function handleConnect(request, response) {
    const user = parseUser(request);
    if (!user?.uid) {
      response.fail(401, 'A user is required');
      return;
    }
    if (request.context.userId && String(user.uid) !== String(request.context.userId)) {
      response.fail(401, 'The user does not match the access token');
      return;
    }
    response.setState('user', user);
    response.setState('rooms', []);
    response.success({ userId: String(user.uid) });
  }

  function handleUserEvent(request, response) {
    const { eventName } = request.context;
    if (!EVENTS.has(eventName)) {
      response.fail(400, `Unsupported event: ${eventName}`);
      return;
    }

    const connection = createConnection(serviceClient, request.context);
    const user = parseUser(request);
    const data = getRequestData(request);
    const actions = {
      view: () => handlers.addActivity(connection, data.caseId, user, 'view'),
      edit: () => handlers.addActivity(connection, data.caseId, user, 'edit'),
      watch: () => handlers.watch(connection, data.caseIds),
      stop: () => handlers.stop(connection, data.caseId),
      stopAll: () => handlers.stopAll(connection, data.caseIds)
    };

    Promise.resolve(actions[eventName]())
      .then(() => {
        response.setState('rooms', [...connection.rooms]);
        response.success();
      })
      .catch((error) => {
        logger.warn(`Web PubSub ${eventName} handler failed`, error);
        response.fail(500, 'Failed to process message');
      });
  }

  function onDisconnected(request) {
    handlers.removeConnectionActivity(request.context.connectionId).catch((error) => {
      logger.warn(`Web PubSub disconnect cleanup failed for ${request.context.connectionId}`, error);
    });
  }

  return { handleConnect, handleUserEvent, onDisconnected };
}

module.exports = createRouter;
module.exports.parseUser = parseUser;
