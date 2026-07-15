const { Logger } = require('@hmcts/nodejs-logging');
const utils = require('../utils');

const logger = Logger.getLogger('index-socket-router');
const getSocketTimestamp = () => new Date().toISOString();
const logSocketWarning = (message, ...args) => {
  const timestampedMessage = `[${getSocketTimestamp()}] ${message}`;
  logger.warn(timestampedMessage, ...args);
};
const logWarning = (message) => {
  logger.warn(message);
};
const users = {};
const connections = [];

function getHeader(socket, name) {
  const value = socket?.handshake?.headers?.[name];
  return Array.isArray(value) ? value.join(',') : value;
}

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

function getConnectionDiagnostics(socket, connectedAt) {
  return {
    connectionDurationMs: Math.max(Date.now() - connectedAt, 0),
    podName: process.env.HOSTNAME,
    forwardedFor: getHeader(socket, 'x-forwarded-for'),
    requestId: getHeader(socket, 'x-request-id')
      || getHeader(socket, 'x-correlation-id'),
    userAgent: getHeader(socket, 'user-agent'),
    origin: getHeader(socket, 'origin'),
    engineReadyState: socket?.conn?.readyState,
    transportWritable: socket?.conn?.transport?.writable
  };
}

function parseHandshakeUser(socket) {
  const authUser = socket?.handshake?.auth?.user;
  if (authUser && typeof authUser === 'object') {
    return authUser;
  }

  if (typeof authUser === 'string') {
    try {
      return JSON.parse(authUser);
    } catch (e) {
      utils.log(socket, '', 'Failed to parse user from handshake auth', logWarning, getSocketTimestamp());
      logSocketWarning(`Failed to parse user from handshake auth: ${e.message}`);
    }
  }

  // Temporary compatibility for clients deployed before user details moved to
  // the Socket.IO auth payload. Remove after all clients have been upgraded.
  const queryUser = socket?.handshake?.query?.user;
  if (typeof queryUser === 'string') {
    try {
      return JSON.parse(queryUser);
    } catch (e) {
      utils.log(socket, '', 'Failed to parse user from handshake query', logWarning, getSocketTimestamp());
      logSocketWarning(`Failed to parse user from handshake query: ${e.message}`);
    }
  }

  return null;
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
      const connectedAt = Date.now();

      router.addConnection(socket);
      const userObj = parseHandshakeUser(socket);
      router.addUser(socket.id, userObj);
      const getSocketUser = () => router.getUser(socket.id) || userObj;
      const getDiagnostics = (extra = {}) => ({
        ...getConnectionDiagnostics(socket, connectedAt),
        connectionCount: router.getConnections().length,
        ...extra
      });
      logSocketLifecycle(
        socket,
        'connection',
        'client connected',
        getSocketUser(),
        getDiagnostics()
      );
      utils.log(socket, '', `connected (${router.getConnections().length} total)`);
      socket.use((packet, next) => {
        iorouter.attach(socket, packet, next);
      });

      socket.on('disconnecting', (reason) => {
        logSocketLifecycle(
          socket,
          'disconnecting',
          reason,
          getSocketUser(),
          getDiagnostics()
        );
      });

      if (socket.conn && typeof socket.conn.on === 'function') {
        socket.conn.on('upgrade', (transport) => {
          logSocketLifecycle(
            socket,
            'transport-upgrade',
            'transport upgraded',
            getSocketUser(),
            getDiagnostics({ upgradedTransport: transport?.name })
          );
        });
        socket.conn.on('error', (error) => {
          logSocketLifecycle(
            socket,
            'engine-error',
            error?.message || String(error),
            getSocketUser(),
            getDiagnostics({ error: formatError(error) })
          );
        });
        socket.conn.on('packet', (packet) => {
          if (packet?.type === 'pong') {
            handlers.refreshSocketActivity(socket, getSocketUser()).catch((error) => {
              logSocketLifecycle(
                socket,
                'activity-refresh-error',
                error?.message || String(error),
                getSocketUser(),
                getDiagnostics({ error: formatError(error) })
              );
            });
          }
        });
        socket.conn.on('close', (reason, description) => {
          logSocketLifecycle(
            socket,
            'engine-close',
            reason,
            getSocketUser(),
            getDiagnostics({ closeDescription: formatError(description) })
          );
        });
      }

      socket.on('error', (error) => {
        logSocketLifecycle(
          socket,
          'error',
          error?.message || String(error),
          getSocketUser(),
          getDiagnostics({ error: formatError(error) })
        );
      });

      // When the socket disconnects, do an appropriate teardown.
      socket.on('disconnect', (reason) => {
        logSocketLifecycle(
          socket,
          'disconnect',
          reason,
          getSocketUser(),
          getDiagnostics({ connectionCount: router.getConnections().length - 1 })
        );

        utils.log(socket, '', `disconnected (${router.getConnections().length - 1} total)`);
        handlers.removeSocketActivity(socket.id);
        router.removeUser(socket.id);
        router.removeConnection(socket);
      });
    });
  }
};

module.exports = router;
