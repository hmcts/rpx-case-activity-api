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

/**
 * Sets up a series of routes for a "socket" endpoint, that
 * leverages socket.io and will more than likely use long polling
 * instead of websockets as the latter isn't supported by Azure
 * Front Door.
 *
 * The behaviour is the same, though.
 *
 * TODO:
 *   * Some sort of auth / get the credentials when the user connects.
 */
function createSocketServer(server, redis) {
  console.log('Setting up socket server');
  const activityService = ActivityService(config, redis);

  console.log('Creating socket server');
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
        console.warn('[SOCKET.IO] redis.host/redis.port missing — Redis adapter not enabled');
        return;
      }

      // Decide scheme based on TLS setting: demo (TLS) → rediss, preview (no TLS) → redis
      const sslRaw = config.has('redis.ssl') ? config.get('redis.ssl') : false;
      const useTLS = sslRaw === true || sslRaw === 'true' || sslRaw === 1 || sslRaw === '1';
      const scheme = useTLS ? 'rediss' : 'redis';

      const redisUrl = redisPwd
        ? `${scheme}://:${encodeURIComponent(redisPwd)}@${redisHost}:${redisPort}`
        : `${scheme}://${redisHost}:${redisPort}`;

      console.log('[SOCKET.IO] Connecting to Redis at', redisUrl, '(TLS:', useTLS, ')');

      const redisOptions = {
        url: redisUrl,
        socket: {
          connectTimeout: 15000,
          tls: useTLS
        }
      };

      const pubClient = createClient(redisOptions);
      const subClient = pubClient.duplicate();

      const attachErrorHandlers = (client, name) => {
        client.on('error', (err) => {
          console.log(`[SOCKET.IO][REDIS][${name}] redis client error:`, err?.message ?? err);
        });
        client.on('connect', () => {
          console.log(`[SOCKET.IO][REDIS][${name}] connected`);
        });
        client.on('end', () => {
          console.log(`[SOCKET.IO][REDIS][${name}] connection ended`);
        });
        client.on('reconnecting', () => {
          console.log(`[SOCKET.IO][REDIS][${name}] reconnecting`);
        });
      };

      attachErrorHandlers(pubClient, 'pub');
      attachErrorHandlers(subClient, 'sub');

      await pubClient.connect();
      await subClient.connect();

      io.adapter(createAdapter(pubClient, subClient));

      console.log('[SOCKET.IO] Redis adapter enabled');
    } catch (err) {
      console.log('[SOCKET.IO] Failed to enable Redis adapter:', err);
    }
  }

  // Call the adapter initialisation (non-blocking)
  enableRedisAdapter(socketServer).catch((err) => {
    console.log('[SOCKET.IO] Redis adapter init failed:', err);
  });

  //
  // ---------------------------------------------------------
  // SETUP ROUTER + HANDLERS + PUBSUB
  // ---------------------------------------------------------
  //
  console.log('Setting up socket handlers and router');
  const handlers = Handlers(activityService, socketServer);

  console.log('Initializing router for socket server');
  router.init(socketServer, new IORouter(), handlers);

  console.log('Initializing pubsub for socket server');
  try {
    const watcher = redis.duplicate();
    pubSub.init(watcher, handlers.notify);
    console.log('PubSub initialized');
  } catch (e) {
    console.error('PubSub init failed (sockets still running):', e);
  }

  //
  // ---------------------------------------------------------
  // LOG CONNECTION EVENTS
  // ---------------------------------------------------------
  //
  // log connections and errors
  socketServer.on('connection', (s) => {
    console.log('Socket connected:', s.id, 'transport:', s.conn.transport.name);
  });
  socketServer.on('error', (err) => {
    console.log('[SOCKET.IO] server error:', err?.message ?? err);
  });
  return { socketServer, activityService, handlers };
}

module.exports = createSocketServer;
