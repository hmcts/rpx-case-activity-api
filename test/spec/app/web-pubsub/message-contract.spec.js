const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const nock = require('nock');

// Exercise the real Azure upstream middleware, router, authorization and handlers.
// These events/payloads match toolkit PR #2230; the negotiation proxy in XUI PR
// #5315 passes the response through and the toolkit uses connection.url verbatim.
describe('Web PubSub toolkit message contract with case authorization', () => {
  let app;
  let webPubSub;
  let activityService;
  let snapshot;
  let messages;
  let membership;
  let activeStates;
  const eventPath = '/api/webpubsub/hubs/hub/';
  const authentication = {
    user: { uid: 'user-1', given_name: 'Test', family_name: 'User' },
    token: 'Bearer user-token',
    serviceAuthorization: 'Bearer proxy-service-token'
  };

  beforeEach(() => {
    messages = [];
    membership = new Map();
    activeStates = new Map();
    snapshot = [];
    const stored = new Map();
    const redis = {
      set: sinon.stub().callsFake(async (key, value) => { stored.set(key, value); return 'OK'; }),
      get: sinon.stub().callsFake(async (key) => stored.get(key) || null)
    };
    const change = { caseId: '111', options: {} };
    const clearActivity = async () => { snapshot = []; return change; };
    activityService = {
      redis,
      ttl: { activity: 3000 },
      removeStaleUserActivity: sinon.stub().resolves([]),
      refreshConnectionActivity: sinon.stub().resolves('111'),
      removeConnectionActivity: sinon.stub().resolves(null),
      removeUserActivity: sinon.stub().resolves(null),
      getActivityForCases: sinon.stub().callsFake(async (caseIds) => caseIds.map((caseId) => ({
        caseId,
        viewers: snapshot.filter((user) => user.role === 'view').map((user) => user.details),
        editors: snapshot.filter((user) => user.role === 'edit').map((user) => user.details),
        unknownViewers: 0,
        unknownEditors: 0
      }))),
      addActivity: sinon.stub().callsFake(async (caseId, user, connectionId, role) => {
        snapshot = [{ role, details: { id: user.uid, forename: 'Test', surname: 'User' } }];
        activityService.removeConnectionActivity.callsFake(clearActivity);
        activityService.removeUserActivity.callsFake(clearActivity);
        return [change];
      })
    };

    class ServiceClient {
      constructor() {
        this.endpoint = 'https://example.webpubsub.azure.com';
        this.membership = membership;
        this.messages = messages;
        this.getClientAccessToken = sinon.stub().resolves({
          token: 'azure-token',
          baseUrl: 'wss://example.webpubsub.azure.com/client/hubs/hub',
          url: 'wss://example.webpubsub.azure.com/client/hubs/hub?access_token=azure-token'
        });
        this.closeConnection = sinon.stub().resolves();
      }

      group(name) {
        return {
          addConnection: async (id) => {
            const rooms = this.membership.get(id) || new Set();
            rooms.add(name);
            this.membership.set(id, rooms);
          },
          removeConnection: async (id) => this.membership.get(id)?.delete(name),
          sendToAll: async (payload, options) => this.messages.push({
            group: name, payload, options
          })
        };
      }

      async sendToConnection(id, payload) {
        this.messages.push({ connection: id, payload });
      }
    }

    const settings = {
      'webPubSub.enabled': true,
      'webPubSub.hub': 'hub',
      'webPubSub.eventHandlerPath': eventPath,
      'secrets.rpx.rpx-case-activity-api-web-pubsub-primary-connection-string': 'test-connection',
      'rpx.base_url': 'http://contract-ccd.test',
      'rpx.case_access_check_enabled': true
    };
    const config = {
      has: (key) => Object.hasOwn(settings, key),
      get: (key) => settings[key],
      util: { getEnv: () => 'test' }
    };
    const createWebPubSub = proxyquire('../../../../app/web-pubsub', {
      config, './service/activity-service': () => activityService
    });
    webPubSub = createWebPubSub(redis, { WebPubSubServiceClient: ServiceClient });
    app = express();
    app.use(webPubSub.middleware);
    app.get('/web-pubsub/negotiate', (req, res, next) => {
      req.authentication = authentication;
      next();
    }, webPubSub.negotiate);
  });

  function upstream(type, id, states = {}) {
    return request(app).post(eventPath)
      .set('ce-awpsversion', '1.0')
      .set('ce-type', type)
      .set('ce-hub', 'hub')
      .set('ce-connectionid', id)
      .set('ce-userid', 'user-1')
      .set('webhook-request-origin', 'example.webpubsub.azure.com')
      .set('ce-connectionstate', Buffer.from(JSON.stringify(states)).toString('base64'));
  }

  afterEach(async () => {
    nock.cleanAll();
    await Promise.all([...activeStates].map(([connectionId, states]) => (
      upstream('azure.webpubsub.sys.disconnected', connectionId, states).send({}).expect(200)
    )));
  });

  async function connect(id = 'connection-1') {
    const negotiation = await request(app).get('/web-pubsub/negotiate').expect(200);
    expect(JSON.stringify(negotiation.body)).not.to.contain('user-token');
    expect(JSON.stringify(negotiation.body)).not.to.contain('proxy-service-token');
    const url = new URL(negotiation.body.url);
    expect(url.searchParams.get('access_token')).to.equal('azure-token');
    const response = await upstream('azure.webpubsub.sys.connect', id).send({
      query: { session: [url.searchParams.get('session')] }, headers: {}
    }).expect(200);
    expect(response.body).to.deep.equal({ userId: 'user-1' });
    const states = JSON.parse(Buffer.from(response.headers['ce-connectionstate'], 'base64'));
    activeStates.set(id, states);
    return id;
  }

  async function event(id, name, data, status = 200) {
    const response = await upstream(`azure.webpubsub.user.${name}`, id, activeStates.get(id))
      .set('ce-eventname', name).send(data).expect(status);
    if (response.headers['ce-connectionstate']) {
      activeStates.set(id, JSON.parse(Buffer.from(response.headers['ce-connectionstate'], 'base64')));
    }
    return response;
  }

  function permit(caseId) {
    return nock('http://contract-ccd.test', {
      reqheaders: {
        authorization: authentication.token,
        serviceauthorization: authentication.serviceAuthorization
      }
    }).get(`/cases/${caseId}`).reply(200, {});
  }

  it('preserves snapshots, broadcasts, stop and stopAll with the current hub contract', async () => {
    const id = await connect();
    const first = permit('111');
    const second = permit('222');
    await event(id, 'watch', { caseIds: ['111', '222'] });
    expect(first.isDone() && second.isDone()).to.equal(true);
    expect([...membership.get(id)]).to.deep.equal(['c:111', 'c:222']);
    expect(messages[0].connection).to.equal(id);
    expect(messages[0].payload.event).to.equal('activity');
    expect(messages[0].payload.data.map((item) => item.caseId)).to.deep.equal(['111', '222']);

    permit('111');
    await event(id, 'view', { caseId: '111' });
    expect([...membership.get(id)]).to.deep.equal(['c:111']);
    const viewer = { id: 'user-1', forename: 'Test', surname: 'User' };
    expect(messages.at(-1).payload).to.deep.equal({
      event: 'activity',
      data: [{
        caseId: '111', viewers: [viewer], editors: [], unknownViewers: 0, unknownEditors: 0
      }]
    });
    permit('111');
    await event(id, 'edit', { caseId: '111' });
    expect(messages.at(-1).group).to.equal('c:111');
    expect(messages.at(-1).payload.data[0].editors).to.deep.equal([viewer]);
    expect(messages.at(-1).payload.data[0].viewers).to.deep.equal([]);

    await event(id, 'stop', { caseId: '111' });
    expect([...membership.get(id)]).to.deep.equal([]);
    expect(messages.at(-1).payload.data[0].editors).to.deep.equal([]);
    permit('111');
    await event(id, 'view', { caseId: '111' });
    await event(id, 'stopAll', { caseIds: ['111'] });
    expect([...membership.get(id)]).to.deep.equal([]);
    expect(nock.isDone()).to.equal(true);
    expect(webPubSub.serviceClient.getClientAccessToken.firstCall.args).to.deep.equal([
      { userId: 'user-1' }
    ]);
  });

  it('rejects a denied watch through the Azure middleware without joining or sending activity', async () => {
    const id = await connect();
    const ccd = nock('http://contract-ccd.test').get('/cases/333').reply(403);
    await event(id, 'watch', { caseIds: ['333'] }, 403);
    expect(ccd.isDone()).to.equal(true);
    expect(membership.has(id)).to.equal(false);
    expect(messages).to.deep.equal([]);
  });

  it('accepts a new negotiated connection and restores watching after reconnect', async () => {
    await connect('old-connection');
    const id = await connect('new-connection');
    permit('111');
    await event(id, 'watch', { caseIds: ['111'] });
    expect(activityService.removeStaleUserActivity.lastCall.args).to.deep.equal([
      'user-1', 'new-connection'
    ]);
    expect(messages.at(-1).connection).to.equal(id);
    expect(messages.at(-1).payload.event).to.equal('activity');
    expect([...membership.get(id)]).to.deep.equal(['c:111']);
  });
});
