const { expect } = require('chai');
const sinon = require('sinon');
const nock = require('nock');
const createRouter = require('../../../../app/web-pubsub/router');
const createHandlers = require('../../../../app/web-pubsub/service/handlers');
const createCaseAccessChecker = require('../../../../app/service/case-access-checker');

describe('Web PubSub case authorization boundary', () => {
  afterEach(() => nock.cleanAll());

  function setup() {
    const config = {
      has: () => true,
      get: (key) => (key === 'rpx.base_url' ? 'http://case-authorization.test' : true)
    };
    const activityService = {
      ttl: { activity: 5 },
      removeConnectionActivity: sinon.stub().resolves(null),
      getActivityForCases: sinon.stub().resolves([{ caseId: '111', viewers: [{ id: 'private-user' }] }]),
      addActivity: sinon.stub().resolves([])
    };
    const group = {
      addConnection: sinon.stub().resolves(), removeConnection: sinon.stub().resolves()
    };
    const serviceClient = {
      group: sinon.stub().returns(group), sendToConnection: sinon.stub().resolves()
    };
    const sessions = {
      get: async () => ({ user: { uid: 'user-1' }, token: 'Bearer user-1-token' })
    };
    const router = createRouter(
      serviceClient, createHandlers(activityService, serviceClient), sessions,
      createCaseAccessChecker(config)
    );
    const response = { fail: sinon.spy(), success: sinon.spy(), setState: sinon.spy() };
    const request = (eventName, data) => ({
      context: {
        eventName, connectionId: 'connection-1', userId: 'user-1', states: {}
      },
      data
    });
    return {
      activityService, serviceClient, router, response, request
    };
  }

  ['watch', 'view', 'edit'].forEach((eventName) => {
    [403, 404, 500].forEach((status) => {
      it(`denies ${eventName} before group access or Redis operations when CCD returns ${status}`, async () => {
        const {
          activityService, serviceClient, router, response, request
        } = setup();
        const scope = nock('http://case-authorization.test', {
          reqheaders: { authorization: 'Bearer user-1-token' }
        }).get('/cases/111').reply(status);
        await router.handleUserEvent(request(eventName, { caseId: '111' }), response);
        expect(scope.isDone()).to.equal(true);
        expect(response.fail.firstCall.args[0]).to.equal(status === 500 ? 502 : 403);
        expect(serviceClient.group.called).to.equal(false);
        expect(serviceClient.sendToConnection.called).to.equal(false);
        expect(activityService.addActivity.called).to.equal(false);
        expect(activityService.getActivityForCases.called).to.equal(false);
        expect(activityService.removeConnectionActivity.called).to.equal(false);
      });
    });
  });

  it('denies a mixed batch in full before joining even an accessible case group', async () => {
    const {
      serviceClient, router, response, request
    } = setup();
    const scope = nock('http://case-authorization.test')
      .get('/cases/111').reply(200, {})
      .get('/cases/222')
      .reply(403);
    await router.handleUserEvent(request('watch', { caseIds: ['111', '222'] }), response);
    expect(scope.isDone()).to.equal(true);
    expect(response.fail.firstCall.args[0]).to.equal(403);
    expect(serviceClient.group.called).to.equal(false);
    expect(serviceClient.sendToConnection.called).to.equal(false);
  });

  it('delivers activity and joins the group when CCD confirms access', async () => {
    const {
      activityService, serviceClient, router, response, request
    } = setup();
    const scope = nock('http://case-authorization.test', {
      reqheaders: {
        experimental: 'true',
      }
    }).get('/cases/111').reply(200, {});
    await router.handleUserEvent(request('watch', { caseIds: ['111'] }), response);
    expect(scope.isDone()).to.equal(true);
    expect(response.success.calledOnce).to.equal(true);
    expect(serviceClient.group.firstCall.args).to.deep.equal(['c:111']);
    expect(serviceClient.sendToConnection.firstCall.args).to.deep.equal([
      'connection-1', { event: 'activity', data: await activityService.getActivityForCases() }
    ]);
  });

  it('fails closed on a CCD redirect rather than authorizing from a login page response', async () => {
    const {
      serviceClient, router, response, request
    } = setup();
    const scope = nock('http://case-authorization.test')
      .get('/cases/111').reply(302, '', { Location: '/login' });
    await router.handleUserEvent(request('watch', { caseIds: ['111'] }), response);
    expect(scope.isDone()).to.equal(true);
    expect(response.fail.firstCall.args[0]).to.equal(502);
    expect(serviceClient.group.called).to.equal(false);
    expect(serviceClient.sendToConnection.called).to.equal(false);
  });

  it('fails closed when CCD is unavailable', async () => {
    const {
      serviceClient, router, response, request
    } = setup();
    const scope = nock('http://case-authorization.test')
      .get('/cases/111').replyWithError({ code: 'ECONNREFUSED' });
    await router.handleUserEvent(request('watch', { caseIds: ['111'] }), response);
    expect(scope.isDone()).to.equal(true);
    expect(response.fail.firstCall.args[0]).to.equal(502);
    expect(serviceClient.group.called).to.equal(false);
    expect(serviceClient.sendToConnection.called).to.equal(false);
  });
});
