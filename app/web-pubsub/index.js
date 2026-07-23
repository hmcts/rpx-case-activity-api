const { Logger } = require('@hmcts/nodejs-logging');
const { WebPubSubServiceClient } = require('@azure/web-pubsub');
const { WebPubSubEventHandler } = require('@azure/web-pubsub-express');
const config = require('config');
const ActivityService = require('./service/activity-service');
const pubSub = require('./redis/pub-sub')();
const createHandlers = require('./service/handlers');
const createRouter = require('./router');

const logger = Logger.getLogger('web-pubsub-index');
const CONNECTION_STRING_CONFIG = 'secrets.rpx.rpx-case-activity-api-web-pubsub-primary-connection-string';

function createWebPubSub(redis, dependencies = {}) {
  const hub = config.get('webPubSub.hub');
  const connectionString = config.get(CONNECTION_STRING_CONFIG);
  const ServiceClient = dependencies.WebPubSubServiceClient || WebPubSubServiceClient;
  const EventHandler = dependencies.WebPubSubEventHandler || WebPubSubEventHandler;
  const serviceClient = new ServiceClient(connectionString, hub);
  const activityService = ActivityService(config, redis);
  const handlers = createHandlers(activityService, serviceClient);
  const router = createRouter(serviceClient, handlers);
  const allowedEndpoints = config.has('webPubSub.allowedEndpoints')
    ? config.get('webPubSub.allowedEndpoints')
    : [serviceClient.endpoint];
  const eventHandler = new EventHandler(hub, {
    path: config.get('webPubSub.eventHandlerPath'),
    allowedEndpoints,
    ...router
  });

  if (config.util.getEnv('NODE_ENV') !== 'test') {
    const watcher = redis.duplicate();
    pubSub.init(watcher, handlers.notify);
  }
  logger.warn(`Azure Web PubSub event handler mounted at ${eventHandler.path}`);

  async function negotiate(req, res, next) {
    try {
      const user = req.authentication?.user;
      const token = await serviceClient.getClientAccessToken({ userId: String(user.uid) });
      const separator = token.url.includes('?') ? '&' : '?';
      const url = `${token.url}${separator}user=${encodeURIComponent(JSON.stringify(user))}`;
      res.json({ ...token, url });
    } catch (error) {
      next(error);
    }
  }

  return {
    activityService,
    eventHandler,
    handlers,
    middleware: eventHandler.getMiddleware(),
    negotiate,
    serviceClient
  };
}

module.exports = createWebPubSub;
