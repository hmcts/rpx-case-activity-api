const { expect } = require('chai');
const path = require('path');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');
const { WebPubSubServiceClient } = require('@azure/web-pubsub');
const { WebPubSubEventHandler } = require('@azure/web-pubsub-express');
const express = require('express');
const request = require('supertest');
const createRouter = require('../../../../app/web-pubsub/router');

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

function loadCreateWebPubSub(configConnectionString, enabled, routerOverride) {
  delete require.cache[modulePath];
  const config = createConfigStub(configConnectionString, enabled);
  const pubSubInit = sinon.stub();
  const routerFactory = routerOverride || sinon.stub().returns({
    handleConnect: sinon.stub(),
    handleUserEvent: sinon.stub(),
    onDisconnected: sinon.stub()
  });

  const createWebPubSub = proxyquire(modulePath, {
    config,
    './service/activity-service': sinon.stub().returns({ ttl: { activity: 5 } }),
    './service/handlers': sinon.stub().returns({ notify: sinon.stub() }),
    './router': routerFactory,
    './redis/pub-sub': () => ({ init: pubSubInit }),
    '@hmcts/nodejs-logging': { Logger: { getLogger: () => ({ warn: sinon.stub() }) } }
  });

  return { createWebPubSub, config, routerFactory };
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

  it('does not create Azure clients when the connection string is missing', () => {
    delete process.env.WEB_PUBSUB_CONNECTION_STRING;
    delete process.env.WebPubSubConnectionString;
    const ServiceClient = sinon.spy(ServiceClientStub);
    const EventHandler = sinon.spy(EventHandlerStub);
    const { createWebPubSub } = loadCreateWebPubSub('');

    const webPubSub = createWebPubSub({}, {
      WebPubSubServiceClient: ServiceClient,
      WebPubSubEventHandler: EventHandler
    });

    expect(webPubSub).to.equal(null);
    expect(ServiceClient.called).to.equal(false);
    expect(EventHandler.called).to.equal(false);
  });

  it('does not pass the connection string environment variable name to Azure as a value', () => {
    delete process.env.WEB_PUBSUB_CONNECTION_STRING;
    delete process.env.WebPubSubConnectionString;
    const ServiceClient = sinon.spy(ServiceClientStub);
    const { createWebPubSub } = loadCreateWebPubSub('WEB_PUBSUB_CONNECTION_STRING');

    const webPubSub = createWebPubSub({}, {
      WebPubSubServiceClient: ServiceClient,
      WebPubSubEventHandler: EventHandlerStub
    });

    expect(webPubSub).to.equal(null);
    expect(ServiceClient.called).to.equal(false);
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

  describe('negotiate browser endpoint', () => {
    const user = {
      uid: 'test-user',
      name: 'Test User',
      given_name: 'Test',
      family_name: 'User',
      email: 'test@example.com',
      roles: ['caseworker']
    };
    const azureUrl = 'wss://example.webpubsub.azure.com/client/hubs/hub';
    const proxyOrigin = 'wss://rpx-case-activity-api-webpubsub.perftest.platform.hmcts.net';
    let redis;
    let routerFactory;

    beforeEach(() => {
      redis = { set: sinon.stub().resolves('OK'), get: sinon.stub().resolves(null) };
    });

    function createHandler(endpoint, ServiceClient = ServiceClientStub) {
      delete process.env.WEB_PUBSUB_CONNECTION_STRING;
      delete process.env.WebPubSubConnectionString;
      const loaded = loadCreateWebPubSub(
        'Endpoint=https://example.webpubsub.azure.com;AccessKey=dGVzdC1rZXk=;Version=1.0;'
      );
      const { createWebPubSub, config } = loaded;
      routerFactory = loaded.routerFactory;
      if (endpoint !== undefined) {
        config.has.withArgs('webPubSub.clientEndpoint').returns(true);
        config.get.withArgs('webPubSub.clientEndpoint').returns(endpoint);
      }
      return createWebPubSub(redis, {
        WebPubSubServiceClient: ServiceClient,
        WebPubSubEventHandler: EventHandlerStub
      });
    }

    [undefined, ''].forEach((endpoint) => {
      it(`keeps the Azure URL when the browser endpoint is ${endpoint === undefined ? 'unset' : 'empty'}`, async () => {
        const handler = createHandler(endpoint);
        const res = { json: sinon.spy() };
        const next = sinon.spy();

        await handler.negotiate({ authentication: { user } }, res, next);

        const response = res.json.firstCall.args[0];
        expect(response.url).to.equal(`${azureUrl}?user=${encodeURIComponent(JSON.stringify(user))}`);
        expect(response.token).to.equal('token');
        expect(next.called).to.equal(false);
        expect(redis.set.called).to.equal(false);
        expect(routerFactory.firstCall.args[2]).to.equal(null);
      });
    });

    it('rewrites proxy URLs without identity JSON and keeps display details server-side', async () => {
      const handler = createHandler(proxyOrigin);
      handler.serviceClient.getClientAccessToken.resolves({
        token: 'signed-token',
        baseUrl: azureUrl,
        url: `${azureUrl}?access_token=signed-token&custom=a%2Bb`
      });
      const res = { json: sinon.spy() };
      const next = sinon.spy();

      await handler.negotiate({ authentication: { user } }, res, next);

      const response = res.json.firstCall.args[0];
      const url = new URL(response.url);
      expect(url.origin).to.equal(proxyOrigin);
      expect(url.pathname).to.equal('/client/hubs/hub');
      expect(url.searchParams.get('access_token')).to.equal('signed-token');
      expect(url.searchParams.get('custom')).to.equal('a+b');
      expect(url.searchParams.has('user')).to.equal(false);
      expect(response.token).to.equal('signed-token');
      expect(response.baseUrl).to.equal(`${proxyOrigin}/client/hubs/hub`);
      expect(handler.serviceClient.endpoint).to.equal('https://example.webpubsub.azure.com');
      expect(handler.serviceClient.getClientAccessToken.calledOnceWithExactly({
        userId: user.uid, expirationTimeInMinutes: 60
      }))
        .to.equal(true);
      expect(redis.set.calledOnceWithExactly(
        'web-pubsub:negotiated-user:test-user',
        JSON.stringify({
          uid: user.uid, name: user.name, forename: 'Test', surname: 'User'
        }),
        'EX', 3600
      )).to.equal(true);
      expect(next.called).to.equal(false);
    });

    it('resolves negotiated identity from shared Redis using the verified token subject', async () => {
      createHandler(proxyOrigin);
      const identity = { uid: 'test-user', given_name: 'Test', family_name: 'User' };
      redis.get.resolves(JSON.stringify(identity));
      const resolveUser = routerFactory.firstCall.args[2];

      expect(await resolveUser('test-user')).to.deep.equal(identity);
      expect(redis.get.calledOnceWithExactly('web-pubsub:negotiated-user:test-user')).to.equal(true);
      expect(await resolveUser(undefined)).to.equal(null);
      expect(redis.get.calledOnce).to.equal(true);
    });

    it('does not return a proxy token when storing connection identity fails', async () => {
      const handler = createHandler(proxyOrigin);
      const error = new Error('Redis unavailable');
      redis.set.rejects(error);
      const res = { json: sinon.spy() };
      const next = sinon.spy();

      await handler.negotiate({ authentication: { user } }, res, next);

      expect(next.calledOnceWithExactly(error)).to.equal(true);
      expect(res.json.called).to.equal(false);
    });

    it('negotiates and accepts a real SDK callback without putting identity in the URL', async () => {
      delete process.env.WEB_PUBSUB_CONNECTION_STRING;
      delete process.env.WebPubSubConnectionString;
      const sharedStore = new Map();
      const sharedRedis = {
        set: async (key, value) => sharedStore.set(key, value),
        get: async (key) => sharedStore.get(key)
      };
      const loaded = loadCreateWebPubSub(
        'Endpoint=https://example.webpubsub.azure.com;AccessKey=dGVzdC1rZXk=;Version=1.0;',
        undefined,
        createRouter
      );
      loaded.config.has.withArgs('webPubSub.clientEndpoint').returns(true);
      loaded.config.get.withArgs('webPubSub.clientEndpoint').returns(proxyOrigin);
      const handler = loaded.createWebPubSub(sharedRedis, {
        WebPubSubServiceClient,
        WebPubSubEventHandler
      });
      const res = { json: sinon.spy() };
      const next = sinon.spy();
      await handler.negotiate({ authentication: { user } }, res, next);
      expect(next.called).to.equal(false);
      expect(new URL(res.json.firstCall.args[0].url).searchParams.has('user')).to.equal(false);

      const app = express();
      app.use(handler.middleware);
      const callback = await request(app)
        .post('/api/webpubsub/hubs/hub/')
        .set('ce-awpsversion', '1.0')
        .set('WebHook-Request-Origin', 'example.webpubsub.azure.com')
        .set('ce-type', 'azure.webpubsub.sys.connect')
        .set('ce-hub', 'hub')
        .set('ce-userid', user.uid)
        .set('ce-connectionid', 'integration-connection')
        .send({ claims: {}, query: {} });

      expect(callback.status).to.equal(200);
      expect(callback.body).to.deep.equal({ userId: user.uid });
      const state = JSON.parse(Buffer.from(callback.headers['ce-connectionstate'], 'base64').toString());
      expect(state.user).to.deep.equal({
        uid: user.uid, name: user.name, forename: 'Test', surname: 'User'
      });
      expect(state.rooms).to.deep.equal([]);
    });

    it('preserves the Azure token audience using the real SDK with a proxy browser URL', async () => {
      const handler = createHandler(proxyOrigin, WebPubSubServiceClient);
      const res = { json: sinon.spy() };
      const next = sinon.spy();

      await handler.negotiate({ authentication: { user } }, res, next);

      expect(next.called).to.equal(false);
      const response = res.json.firstCall.args[0];
      const url = new URL(response.url);
      const payload = JSON.parse(Buffer.from(response.token.split('.')[1], 'base64url').toString());
      expect(payload.aud).to.equal('https://example.webpubsub.azure.com/client/hubs/hub');
      expect(payload.sub).to.equal(user.uid);
      expect(url.origin).to.equal(proxyOrigin);
      expect(url.searchParams.get('access_token')).to.equal(response.token);
      expect(response.baseUrl).to.equal(`${proxyOrigin}/client/hubs/hub`);
      expect(new URL(handler.serviceClient.endpoint).origin).to.equal('https://example.webpubsub.azure.com');
    });

    it('passes token generation failures to the error handler', async () => {
      const handler = createHandler(proxyOrigin);
      const error = new Error('Token generation failed');
      handler.serviceClient.getClientAccessToken.rejects(error);
      const res = { json: sinon.spy() };
      const next = sinon.spy();

      await handler.negotiate({ authentication: { user } }, res, next);

      expect(next.calledOnceWithExactly(error)).to.equal(true);
      expect(res.json.called).to.equal(false);
    });

    ['http://proxy.example.com', 'wss://proxy.example.com/path',
      'wss://proxy.example.com?token=value', 'wss://user:password@proxy.example.com',
      'wss://proxy.example.com#fragment'].forEach((endpoint) => {
      it(`rejects an invalid browser endpoint: ${endpoint}`, () => {
        expect(() => createHandler(endpoint)).to.throw('webPubSub.clientEndpoint must be a WSS origin');
      });
    });
  });
});
