const { expect } = require('chai');
const path = require('path');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');

const modulePath = path.resolve(__dirname, '../../../../app/web-pubsub/index.js');
const CONNECTION_STRING_CONFIG = 'secrets.rpx.rpx-case-activity-api-web-pubsub-primary-connection-string';

function createConfigStub(configConnectionString, enabled) {
  const get = sinon.stub();
  get.withArgs('webPubSub.hub').returns('hub');
  get.withArgs('webPubSub.eventHandlerPath').returns('/api/webpubsub/hubs/hub/');
  get.withArgs(CONNECTION_STRING_CONFIG).returns(configConnectionString);
  if (enabled !== undefined) {
    get.withArgs('webPubSub.enabled').returns(enabled);
  }

  const has = sinon.stub().returns(false);
  if (enabled !== undefined) {
    has.withArgs('webPubSub.enabled').returns(true);
  }

  return {
    get,
    has,
    util: {
      getEnv: sinon.stub().returns('test')
    }
  };
}

function ServiceClientStub(connectionString, hub) {
  this.connectionString = connectionString;
  this.hub = hub;
  this.endpoint = 'https://example.webpubsub.azure.com';
  this.getClientAccessToken = sinon.stub().resolves({
    token: 'token',
    url: 'wss://example.webpubsub.azure.com/client/hubs/hub'
  });
}

function EventHandlerStub(hub, options) {
  this.hub = hub;
  this.path = options.path;
  this.getMiddleware = () => (req, res, next) => next();
}

function loadCreateWebPubSub(configConnectionString, enabled) {
  delete require.cache[modulePath];
  const config = createConfigStub(configConnectionString, enabled);
  const pubSubInit = sinon.stub();

  const createWebPubSub = proxyquire(modulePath, {
    config,
    './service/activity-service': sinon.stub().returns({ ttl: { activity: 5 } }),
    './service/handlers': sinon.stub().returns({ notify: sinon.stub() }),
    './router': sinon.stub().returns({
      handleConnect: sinon.stub(),
      handleUserEvent: sinon.stub(),
      onDisconnected: sinon.stub()
    }),
    './redis/pub-sub': () => ({ init: pubSubInit }),
    '@hmcts/nodejs-logging': { Logger: { getLogger: () => ({ warn: sinon.stub() }) } }
  });

  return { createWebPubSub, config };
}

describe('web-pubsub.index', () => {
  const originalWebPubSubConnectionString = process.env.WEB_PUBSUB_CONNECTION_STRING;
  const originalTunnelConnectionString = process.env.WebPubSubConnectionString;

  afterEach(() => {
    if (originalWebPubSubConnectionString === undefined) {
      delete process.env.WEB_PUBSUB_CONNECTION_STRING;
    } else {
      process.env.WEB_PUBSUB_CONNECTION_STRING = originalWebPubSubConnectionString;
    }

    if (originalTunnelConnectionString === undefined) {
      delete process.env.WebPubSubConnectionString;
    } else {
      process.env.WebPubSubConnectionString = originalTunnelConnectionString;
    }
  });

  it('does not create Azure clients when Web PubSub is disabled', () => {
    const ServiceClient = sinon.spy(ServiceClientStub);
    const EventHandler = sinon.spy(EventHandlerStub);
    const { createWebPubSub } = loadCreateWebPubSub('WEB_PUBSUB_CONNECTION_STRING', 'false');

    const webPubSub = createWebPubSub({}, {
      WebPubSubServiceClient: ServiceClient,
      WebPubSubEventHandler: EventHandler
    });

    expect(webPubSub).to.equal(null);
    expect(ServiceClient.called).to.equal(false);
    expect(EventHandler.called).to.equal(false);
  });

  it('prefers WEB_PUBSUB_CONNECTION_STRING when set', () => {
    process.env.WEB_PUBSUB_CONNECTION_STRING = 'Endpoint=https://from-backend-env;AccessKey=abc;Version=1.0;';
    process.env.WebPubSubConnectionString = 'Endpoint=https://from-tunnel-env;AccessKey=def;Version=1.0;';

    const { createWebPubSub } = loadCreateWebPubSub('Endpoint=https://from-config;AccessKey=ghi;Version=1.0;');
    const webPubSub = createWebPubSub({}, {
      WebPubSubServiceClient: ServiceClientStub,
      WebPubSubEventHandler: EventHandlerStub
    });

    expect(webPubSub.serviceClient.connectionString)
      .to.equal('Endpoint=https://from-backend-env;AccessKey=abc;Version=1.0;');
  });

  it('uses WebPubSubConnectionString when backend env is not set', () => {
    delete process.env.WEB_PUBSUB_CONNECTION_STRING;
    process.env.WebPubSubConnectionString = 'Endpoint=https://from-tunnel-env;AccessKey=def;Version=1.0;';

    const { createWebPubSub } = loadCreateWebPubSub('Endpoint=https://from-config;AccessKey=ghi;Version=1.0;');
    const webPubSub = createWebPubSub({}, {
      WebPubSubServiceClient: ServiceClientStub,
      WebPubSubEventHandler: EventHandlerStub
    });

    expect(webPubSub.serviceClient.connectionString)
      .to.equal('Endpoint=https://from-tunnel-env;AccessKey=def;Version=1.0;');
  });

  it('falls back to config value when env variables are not set', () => {
    delete process.env.WEB_PUBSUB_CONNECTION_STRING;
    delete process.env.WebPubSubConnectionString;

    const { createWebPubSub } = loadCreateWebPubSub('Endpoint=https://from-config;AccessKey=ghi;Version=1.0;');
    const webPubSub = createWebPubSub({}, {
      WebPubSubServiceClient: ServiceClientStub,
      WebPubSubEventHandler: EventHandlerStub
    });

    expect(webPubSub.serviceClient.connectionString)
      .to.equal('Endpoint=https://from-config;AccessKey=ghi;Version=1.0;');
  });
});
