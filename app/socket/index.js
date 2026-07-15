const { Logger } = require('@hmcts/nodejs-logging');
const config = require('config');
const IORouter = require('socket.io-router-middleware');
const SocketIO = require('socket.io');
// Missing imports — REQUIRED for Redis Adapter
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const ActivityService = require('./service/activity-service');
const Handlers = require('./service/handlers');
const pubSub = require('./redis/pub-sub')();
const router = require('./router');
const { redisReconnectDelay } = require('../redis/reconnect-strategy');

const logger = Logger.getLogger('socket-index');
const getSocketTimestamp = () => new Date().toISOString();
const logSocketWarning = (message, ...args) => {
  const timestampedMessage = `[${getSocketTimestamp()}] ${message}`;
  logger.warn(timestampedMessage, ...args);
};

const REDIS_PING_INTERVAL_MS = 5 * 60 * 1000;

function formatEngineConnectionError(error) {
  const request = error?.req;
  const headers = request?.headers || {};
  return JSON.stringify({
    event: 'engine-connection-error',
    timestamp: getSocketTimestamp(),
    podName: process.env.HOSTNAME,
    code: error?.code,
    message: error?.message || String(error),
    context: error?.context ? {
      name: error.context.name,
      message: error.context.message
    } : undefined,
    remoteAddress: request?.socket?.remoteAddress,
    forwardedFor: headers['x-forwarded-for'],
    requestId: headers['x-request-id'] || headers['x-correlation-id'],
    userAgent: headers['user-agent'],
    origin: headers.origin,
  });
}

function buildRedisAdapterOptions(redisUrl, useTLS) {
  return {
    url: redisUrl,
    // Keep idle adapter connections below Azure Redis' 10-minute idle timeout.
    pingInterval: REDIS_PING_INTERVAL_MS,
    socket: {
      connectTimeout: 15000,
      tls: useTLS,
      // Retry lost Socket.IO Redis adapter connections with the same bounded delay.
      reconnectStrategy: redisReconnectDelay
    }
  };
}

/**
 * Sets up a series of routes for a "socket" endpoint, that
 * leverages socket.io and will more than likely use long polling
 * instead of websockets as the latter isn't supported by Azure
 * Front Door.
 *
 * The behaviour is the same, though.
 *
 */
function createSocketServer(server, redis) {
  logSocketWarning('Setting up socket server');
  const activityService = ActivityService(config, redis);

  logSocketWarning('Creating socket server');
  const socketServer = SocketIO(server, {
    allowEIO3: true,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: false
    },
  });

  //
  // ---------------------------------------------------------
  // ENABLE REDIS ADAPTER (Fixes “Session ID unknown”)
  // ---------------------------------------------------------
  //
  async function enableRedisAdapter(io) {
    try {
      const redisPort = config.get('redis.port');
      const redisHost = config.get('redis.host');

      // HMCTS secret pattern supports both nested { value } and flat string values.
      const redisPwdObj = config.get('secrets.rpx.activity-redis-password');
      const redisPwd = redisPwdObj?.value ?? redisPwdObj;

      if (!redisHost || !redisPort) {
        logSocketWarning('[SOCKET.IO] redis.host/redis.port missing - Redis adapter not enabled');
        return;
      }

      // Decide scheme based on TLS setting: demo (TLS) → rediss, preview (no TLS) → redis
      const sslRaw = config.has('redis.ssl') ? config.get('redis.ssl') : false;
      const useTLS = sslRaw === true || sslRaw === 'true' || sslRaw === 1 || sslRaw === '1';
      const scheme = useTLS ? 'rediss' : 'redis';

      const redisUrl = redisPwd
        ? `${scheme}://:${encodeURIComponent(redisPwd)}@${redisHost}:${redisPort}`
        : `${scheme}://${redisHost}:${redisPort}`;

      logSocketWarning(
        `[SOCKET.IO] Connecting to Redis at ${scheme}://${redisHost}:${redisPort} (TLS: ${useTLS})`
      );

      const redisOptions = buildRedisAdapterOptions(redisUrl, useTLS);

      const pubClient = createClient(redisOptions);
      const subClient = pubClient.duplicate();

      const attachErrorHandlers = (client, name) => {
        client.on('error', (err) => {
          logSocketWarning(
            `[SOCKET.IO][REDIS][${name}] redis client error: ${err?.message ?? err}`,
            { code: err?.code, isOpen: client.isOpen, isReady: client.isReady }
          );
        });
        client.on('connect', () => {
          logSocketWarning(`[SOCKET.IO][REDIS][${name}] connection opened`);
        });
        client.on('ready', () => {
          logSocketWarning(`[SOCKET.IO][REDIS][${name}] ready`);
        });
        client.on('end', () => {
          logSocketWarning(`[SOCKET.IO][REDIS][${name}] connection ended`);
        });
        client.on('reconnecting', () => {
          logSocketWarning(`[SOCKET.IO][REDIS][${name}] reconnecting`);
        });
      };

      attachErrorHandlers(pubClient, 'pub');
      attachErrorHandlers(subClient, 'sub');

      await pubClient.connect();
      await subClient.connect();

      io.adapter(createAdapter(pubClient, subClient));

      logSocketWarning(
        `[SOCKET.IO] Redis adapter enabled with ping interval ${REDIS_PING_INTERVAL_MS}ms`
      );
    } catch (err) {
      logSocketWarning('[SOCKET.IO] Failed to enable Redis adapter', err);
    }
  }

  // Call the adapter initialisation (non-blocking)
  enableRedisAdapter(socketServer).catch((err) => {
    logSocketWarning('[SOCKET.IO] Redis adapter init failed', err);
  });

  //
  // ---------------------------------------------------------
  // SETUP ROUTER + HANDLERS + PUBSUB
  // ---------------------------------------------------------
  //
  logSocketWarning('Setting up socket handlers and router');
  const handlers = Handlers(activityService, socketServer);

  logSocketWarning('Initializing router for socket server');
  router.init(socketServer, new IORouter(), handlers);

  logSocketWarning('Initializing pubsub for socket server');
  try {
    const watcher = redis.duplicate();
    pubSub.init(watcher, handlers.notify);
    logSocketWarning('PubSub initialized');
  } catch (e) {
    logSocketWarning('PubSub init failed (sockets still running)', e);
  }

  //
  // ---------------------------------------------------------
  // LOG CONNECTION EVENTS
  // ---------------------------------------------------------
  //
  socketServer.on('error', (err) => {
    logSocketWarning(`[SOCKET.IO] server error: ${err?.message ?? err}`);
  });
  if (socketServer.engine && typeof socketServer.engine.on === 'function') {
    socketServer.engine.on('connection_error', (err) => {
      logSocketWarning(`[SOCKET.IO] ${formatEngineConnectionError(err)}`);
    });
  }
  return { socketServer, activityService, handlers };
}

module.exports = createSocketServer;
module.exports.buildRedisAdapterOptions = buildRedisAdapterOptions;
