const { Logger } = require('@hmcts/nodejs-logging');
const utils = require('../utils');

const logger = Logger.getLogger('index-socket-router');
const getSocketTimestamp = () => new Date().toISOString();
const logSocketWarning = (message, ...args) => logger.warn(`[${getSocketTimestamp()}] ${message}`, ...args);
const logWarning = (message) => logger.warn(message);
const users = {};
const connections = [];

function normaliseRooms(socket) {
  if (!socket?.rooms) {
    return [];
  }

  return Array.isArray(socket.rooms) ? [...socket.rooms] : Array.from(socket.rooms);
}

function getIdamId(user) {
  return user?.uid ?? user?.idamId ?? user?.id ?? 'unknown';
}

function normaliseUser(user) {
  if (!user) {
    return 'unknown';
  }

  return {
    idamId: getIdamId(user),
    id: user.id || user.uid,
    name: user.name,
    forename: user.forename || user.given_name,
    surname: user.surname || user.family_name
  };
}

function formatError(error) {
  if (!error) {
    return undefined;
  }

  return {
    name: error.name,
    message: error.message || String(error)
  };
}

function getSocketLifecycleDetails(socket, event, reason, user, timestamp, extra = {}) {
  return JSON.stringify({
    event,
    timestamp,
    socketId: socket?.id,
    reason: reason || 'unknown',
    idamId: getIdamId(user),
    user: normaliseUser(user),
    transport: socket?.conn?.transport?.name || 'unknown',
    engineSocketId: socket?.conn?.id,
    remoteAddress: socket?.handshake?.address,
    rooms: normaliseRooms(socket),
    ...extra
  });
}

function logSocketLifecycle(socket, event, reason, user, extra) {
  const timestamp = getSocketTimestamp();
  logger.warn(`[${timestamp}] Socket lifecycle ${getSocketLifecycleDetails(socket, event, reason, user, timestamp, extra)}`);
}

function runHandler(handler, next) {
  try {
    const result = handler();
    if (result && typeof result.then === 'function') {
      return result.then(() => next()).catch(next);
    }
    next();
  } catch (e) {
    next(e);
  }
  return null;
}

const router = {
  addUser: (socketId, user) => {
    if (user && !user.name) {
      user.name = `${user.forename} ${user.surname}`;
    }
    users[socketId] = user;
  },
  removeUser: (socketId) => {
    delete users[socketId];
  },
  getUser: (socketId) => {
    return users[socketId];
  },
  addConnection: (socket) => {
    connections.push(socket);
  },
  removeConnection: (socket) => {
    const socketIndex = connections.indexOf(socket);
    if (socketIndex > -1) {
      connections.splice(socketIndex, 1);
    }
  },
  getConnections: () => {
    return [...connections];
  },
  init: (io, iorouter, handlers) => {
    logSocketWarning('Initializing socket router');
    // Set up routes for each type of message.
    iorouter.on('view', (socket, ctx, next) => {
      const user = router.getUser(socket.id);
      utils.log(socket, `${ctx.request.caseId} (${user.name})`, 'view');
      return runHandler(() => handlers.addActivity(socket, ctx.request.caseId, user, 'view'), next);
    });
    iorouter.on('edit', (socket, ctx, next) => {
      const user = router.getUser(socket.id);
      utils.log(socket, `${ctx.request.caseId} (${user.name})`, 'edit');
      return runHandler(() => handlers.addActivity(socket, ctx.request.caseId, user, 'edit'), next);
    });
    iorouter.on('watch', (socket, ctx, next) => {
      const user = router.getUser(socket.id);
      utils.log(socket, `${ctx.request.caseIds} (${user.name})`, 'watch');
      return runHandler(() => handlers.watch(socket, ctx.request.caseIds), next);
    });
    iorouter.on('stop', (socket, ctx, next) => {
      const user = router.getUser(socket.id);
      utils.log(socket, `${ctx.request.caseId} (${user.name})`, 'stop');
      return runHandler(() => handlers.stop(socket, ctx.request.caseId, user, 'stop'), next);
    });
    iorouter.on('stopAll', (socket, ctx, next) => {
      const user = router.getUser(socket.id);
      utils.log(socket, `${ctx.request.caseIds} (${user.name})`, 'stopAll');
      return runHandler(() => handlers.stopAll(socket, ctx.request.caseIds), next);
    });

    // On client connection, attach the router and track the socket.
    io.on('connection', (socket) => {
      logSocketWarning(`Socket connected: ${socket.id}`);

      router.addConnection(socket);
      let userObj = null;
      if (socket?.handshake?.query?.user) {
        try {
          userObj = JSON.parse(socket.handshake.query.user);
        } catch (e) {
          utils.log(socket, '', 'Failed to parse user from handshake query', logWarning, getSocketTimestamp());
          logSocketWarning(`Failed to parse user from handshake query: ${e.message}`);
        }
      }
      router.addUser(socket.id, userObj);
      const getSocketUser = () => router.getUser(socket.id) || userObj;
      utils.log(socket, '', `connected (${router.getConnections().length} total)`);
      logSocketWarning(`Socket connected: ${socket.id} for user ${userObj ? userObj.name : 'unknown'}`);

      utils.log(
        socket,
        '',
        `connected (${router.getConnections().length} total)`,
        logWarning,
        getSocketTimestamp()
      );
      socket.use((packet, next) => {
        iorouter.attach(socket, packet, next);
      });

      socket.on('disconnecting', (reason) => {
        logSocketLifecycle(socket, 'disconnecting', reason, getSocketUser());
      });

      if (socket.conn && typeof socket.conn.on === 'function') {
        socket.conn.on('close', (reason) => {
          logSocketLifecycle(socket, 'engine-close', reason, getSocketUser());
        });
      }

      socket.on('error', (error) => {
        logSocketLifecycle(
          socket,
          'error',
          error?.message || String(error),
          getSocketUser(),
          { error: formatError(error) }
        );
      });

      // When the socket disconnects, do an appropriate teardown.
      socket.on('disconnect', (reason) => {
        logSocketLifecycle(socket, 'disconnect', reason, getSocketUser());
        logSocketWarning(`Socket disconnected: ${socket.id}`);

        utils.log(socket, '', `disconnected (${router.getConnections().length - 1} total)`);
        utils.log(
          socket,
          '',
          `disconnected (${router.getConnections().length - 1} total)`,
          logWarning,
          getSocketTimestamp()
        );
        handlers.removeSocketActivity(socket.id);
        router.removeUser(socket.id);
        router.removeConnection(socket);
      });
    });
  }
};

module.exports = router;
