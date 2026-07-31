const { expect } = require('chai');
const createConnection = require('../../../../app/web-pubsub/connection');
const keys = require('../../../../app/web-pubsub/redis/keys');
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

  function trackedConnection(initialRooms = []) {
    const connectionCalls = [];
    const rooms = new Set(initialRooms);
    const group = (room) => ({
      addConnection: async (connectionId) => {
        connectionCalls.push(['addConnection', room, connectionId]);
      },
      removeConnection: async (connectionId) => {
        connectionCalls.push(['removeConnection', room, connectionId]);
      }
    });
    const connection = createConnection({
      group,
      sendToConnection: async (...args) => connectionCalls.push(['sendToConnection', ...args])
    }, {
      connectionId: 'connection-1',
      states: { rooms: [...rooms] }
    });
    return { connection, connectionCalls };
  }

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

  it('broadcasts all known and unknown viewers and editors without filtering a recipient', async () => {
    const activity = [{
      caseId: 'case-1',
      viewers: [
        { id: 'user-1', forename: 'Alice', surname: 'Viewer' },
        { id: 'user-2', forename: 'Bob', surname: 'Viewer' }
      ],
      unknownViewers: 1,
      editors: [
        { id: 'user-3', forename: 'Carol', surname: 'Editor' },
        { id: 'user-4', forename: 'Dan', surname: 'Editor' }
      ],
      unknownEditors: 2
    }];
    const originalGetActivityForCases = activityService.getActivityForCases;
    activityService.getActivityForCases = async () => activity;
    const handlers = createHandlers(activityService, serviceClient);

    try {
      await handlers.notify('case-1');

      expect(calls[0]).to.deep.equal([
        'sendToAll',
        { event: 'activity', data: activity },
        {}
      ]);
    } finally {
      activityService.getActivityForCases = originalGetActivityForCases;
    }
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

  it('emits watched case activity to the requesting connection', async () => {
    const connectionCalls = [];
    const connection = {
      id: 'connection-1',
      leaveCaseGroups: async () => connectionCalls.push(['leaveCaseGroups']),
      join: async (...args) => connectionCalls.push(['join', ...args]),
      emit: async (...args) => connectionCalls.push(['emit', ...args])
    };
    const handlers = createHandlers(activityService, serviceClient);

    const result = await handlers.watch(connection, ['case-1']);

    expect(result).to.equal(undefined);
    expect(connectionCalls).to.deep.equal([
      ['leaveCaseGroups'],
      ['join', 'c:case-1'],
      ['emit', 'activity', [{ caseId: 'case-1', viewers: [], editors: [] }]]
    ]);
    expect(calls).to.deep.equal([
      ['removeConnectionActivity', 'connection-1']
    ]);
  });

  it('replaces watched cases when view or edit activity starts', async () => {
    const { connection, connectionCalls } = trackedConnection([
      keys.case.base('old-case-1'),
      keys.case.base('old-case-2')
    ]);
    const handlers = createHandlers(activityService, serviceClient);
    const user = { uid: 'user-1', forename: 'Alice', surname: 'User' };

    await handlers.addActivity(connection, 'case-1', user, 'view');

    expect([...connection.rooms]).to.deep.equal([keys.case.base('case-1')]);
    expect(connectionCalls).to.deep.equal([
      ['removeConnection', keys.case.base('old-case-1'), 'connection-1'],
      ['removeConnection', keys.case.base('old-case-2'), 'connection-1'],
      ['addConnection', keys.case.base('case-1'), 'connection-1']
    ]);
    expect(calls).to.deep.equal([
      ['addActivity', 'case-1', user, 'connection-1', 'view']
    ]);
  });

  it('stops watching only the requested case', async () => {
    const { connection, connectionCalls } = trackedConnection([
      keys.case.base('case-1'),
      keys.case.base('case-2')
    ]);
    const handlers = createHandlers(activityService, serviceClient);

    await handlers.stop(connection, 'case-1');

    expect([...connection.rooms]).to.deep.equal([keys.case.base('case-2')]);
    expect(connectionCalls).to.deep.equal([
      ['removeConnection', keys.case.base('case-1'), 'connection-1']
    ]);
    expect(calls).to.deep.equal([
      ['removeConnectionActivity', 'connection-1']
    ]);
  });

  it('stops watching all supplied cases while retaining other subscriptions', async () => {
    const { connection, connectionCalls } = trackedConnection([
      keys.case.base('case-1'),
      keys.case.base('case-2'),
      keys.case.base('case-3')
    ]);
    const handlers = createHandlers(activityService, serviceClient);

    await handlers.stopAll(connection, ['case-1', 'case-2']);

    expect([...connection.rooms]).to.deep.equal([keys.case.base('case-3')]);
    expect(connectionCalls).to.deep.equal([
      ['removeConnection', keys.case.base('case-1'), 'connection-1'],
      ['removeConnection', keys.case.base('case-2'), 'connection-1']
    ]);
    expect(calls).to.deep.equal([
      ['removeUserActivity', 'connection-1']
    ]);
  });

  it('stops every case subscription when stopAll has no caseIds', async () => {
    const { connection, connectionCalls } = trackedConnection([
      keys.case.base('case-1'),
      keys.case.base('case-2')
    ]);
    const handlers = createHandlers(activityService, serviceClient);

    await handlers.stopAll(connection, []);

    expect([...connection.rooms]).to.deep.equal([]);
    expect(connectionCalls).to.deep.equal([
      ['removeConnection', keys.case.base('case-1'), 'connection-1'],
      ['removeConnection', keys.case.base('case-2'), 'connection-1']
    ]);
    expect(calls).to.deep.equal([
      ['removeUserActivity', 'connection-1']
    ]);
  });
});
