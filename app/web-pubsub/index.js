const { Logger } = require('@hmcts/nodejs-logging');
const nodeCrypto = require('node:crypto');

// @typespec/ts-http-runtime generates request IDs with globalThis.crypto.randomUUID().
// Ensure it is available before the Azure Web PubSub SDK is loaded in all Node runtimes.
if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto = nodeCrypto.webcrypto;
}

const { WebPubSubServiceClient } = require('@azure/web-pubsub');
const { WebPubSubEventHandler } = require('@azure/web-pubsub-express');
const config = require('config');
const ActivityService = require('./service/activity-service');
const pubSub = require('./redis/pub-sub')();
const createHandlers = require('./service/handlers');
const createRouter = require('./router');

const logger = Logger.getLogger('web-pubsub-index');
const CONNECTION_STRING_CONFIG = 'secrets.rpx.rpx-case-activity-api-web-pubsub-primary-connection-string';

function isEnabled() {
  if (!config.has('webPubSub.enabled')) {
    return true;
  }

  const value = config.get('webPubSub.enabled');
  if (typeof value === 'boolean') {
    return value;
  }

  return !['false', '0', 'off', 'no'].includes(String(value).trim().toLowerCase());
}

function resolveConnectionString() {
  return process.env.WEB_PUBSUB_CONNECTION_STRING
    || process.env.WebPubSubConnectionString
    || config.get(CONNECTION_STRING_CONFIG);
}

function connectionStringSource() {
  if (process.env.WEB_PUBSUB_CONNECTION_STRING) {
    return 'WEB_PUBSUB_CONNECTION_STRING';
  }
  if (process.env.WebPubSubConnectionString) {
    return 'WebPubSubConnectionString';
  }
  return CONNECTION_STRING_CONFIG;
}

function hasConnectionString(connectionString) {
  return typeof connectionString === 'string'
    && connectionString.trim() !== ''
    && connectionString !== 'WEB_PUBSUB_CONNECTION_STRING';
}

function createWebPubSub(redis, dependencies = {}) {
  if (!isEnabled()) {
    logger.warn('Azure Web PubSub is disabled; skipping client and event handler initialization');
    return null;
  }

  const hub = config.get('webPubSub.hub');
  const connectionString = resolveConnectionString();
  if (!hasConnectionString(connectionString)) {
    logger.warn(
      `Azure Web PubSub is enabled but ${connectionStringSource()} is not configured; `
      + 'skipping client and event handler initialization'
    );
    return null;
  }

  logger.warn(`Initializing Web PubSub for hub '${hub}' using ${connectionStringSource()}`);
  const ServiceClient = dependencies.WebPubSubServiceClient || WebPubSubServiceClient;
  const EventHandler = dependencies.WebPubSubEventHandler || WebPubSubEventHandler;
  const serviceClient = new ServiceClient(connectionString, hub);
  logger.warn(`Web PubSub service endpoint resolved as ${serviceClient.endpoint}`);
  const activityService = ActivityService(config, redis);
  const handlers = createHandlers(activityService, serviceClient);
  const router = createRouter(serviceClient, handlers);
  const allowedEndpoints = config.has('webPubSub.allowedEndpoints')
    ? config.get('webPubSub.allowedEndpoints')
    : [serviceClient.endpoint];
  logger.warn(`Web PubSub allowedEndpoints: ${JSON.stringify(allowedEndpoints)}`);
  const eventHandler = new EventHandler(hub, {
    path: config.get('webPubSub.eventHandlerPath'),
    allowedEndpoints,
    ...router
  });
  logger.warn(`Web PubSub middleware path configured as ${eventHandler.path}`);

  const middleware = eventHandler.getMiddleware();
  const loggingMiddleware = (req, res, next) => {
    const isWebPubSubPath = req.path && req.path.startsWith(eventHandler.path);
    if (isWebPubSubPath) {
      logger.warn(
        `Web PubSub middleware ingress method=${req.method} path=${req.path} `
        + `ce-type=${req.get('ce-type') || '<missing>'} `
        + `ce-eventname=${req.get('ce-eventname') || '<missing>'} `
        + `ce-connectionid=${req.get('ce-connectionid') || '<missing>'}`
      );
    }
    return middleware(req, res, next);
  };

  if (config.util.getEnv('NODE_ENV') !== 'test') {
    const watcher = redis.duplicate();
    watcher.on('connect', () => logger.warn('Web PubSub Redis watcher connected'));
    watcher.on('ready', () => logger.warn('Web PubSub Redis watcher ready'));
    watcher.on('error', (error) => logger.warn('Web PubSub Redis watcher error', error));
    watcher.on('end', () => logger.warn('Web PubSub Redis watcher disconnected'));
    logger.warn('Initializing Web PubSub Redis pub-sub watcher');
    pubSub.init(watcher, handlers.notify);
  }
  logger.warn(`Azure Web PubSub event handler mounted at ${eventHandler.path}`);

  async function negotiate(req, res, next) {
    try {
      const user = req.authentication?.user;
      logger.warn(`Negotiating Web PubSub client token for user ${user?.uid || '<missing>'}`);
      const token = await serviceClient.getClientAccessToken({ userId: String(user.uid) });
      const separator = token.url.includes('?') ? '&' : '?';
      const url = `${token.url}${separator}user=${encodeURIComponent(JSON.stringify(user))}`;
      logger.warn(`Negotiation produced Web PubSub URL host ${new URL(url).host}`);
      res.json({ ...token, url });
    } catch (error) {
      logger.warn('Web PubSub negotiate failed', error);
      next(error);
    }
  }

  return {
    activityService,
    eventHandler,
    handlers,
    middleware: loggingMiddleware,
    negotiate,
    serviceClient
  };
}

module.exports = createWebPubSub;
