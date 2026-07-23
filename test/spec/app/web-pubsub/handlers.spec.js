const { expect } = require('chai');
const createHandlers = require('../../../../app/web-pubsub/service/handlers');

describe('web-pubsub.service.handlers', () => {
  const calls = [];
  const groupClient = {
    sendToAll: async (...args) => calls.push(['sendToAll', ...args])
  };
  const serviceClient = { group: () => groupClient };
  const activityService = {
    ttl: { activity: 3000 },
    redis: {
      set: async (...args) => {
        calls.push(['set', ...args]);
        return 'OK';
      }
    },
    addActivity: async (...args) => calls.push(['addActivity', ...args]),
    getActivityForCases: async () => [{ caseId: 'case-1', viewers: [], editors: [] }],
    refreshConnectionActivity: async () => null,
    removeConnectionActivity: async (...args) => calls.push(['removeConnectionActivity', ...args]),
    removeUserActivity: async (...args) => calls.push(['removeUserActivity', ...args])
  };

  beforeEach(() => {
    calls.length = 0;
  });

  it('sends case activity to the Web PubSub group and excludes the source connection', async () => {
    const handlers = createHandlers(activityService, serviceClient);

    await handlers.notify('case-1', {
      notificationId: 'notification-1',
      excludedConnectionId: 'connection-1'
    });

    expect(calls[0][0]).to.equal('set');
    expect(calls[1]).to.deep.equal([
      'sendToAll',
      { event: 'activity', data: [{ caseId: 'case-1', viewers: [], editors: [] }] },
      { excludedConnections: ['connection-1'] }
    ]);
  });

  it('does not send a duplicate notification claimed by another replica', async () => {
    activityService.redis.set = async () => null;
    const handlers = createHandlers(activityService, serviceClient);

    await handlers.notify('case-1', { notificationId: 'notification-1' });

    expect(calls).to.deep.equal([]);
    activityService.redis.set = async (...args) => {
      calls.push(['set', ...args]);
      return 'OK';
    };
  });
});
