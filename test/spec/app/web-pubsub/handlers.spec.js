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

  function trackedConnection(initialRooms = [], trackedConnectionId = 'connection-1') {
    const connectionCalls = [];
    const rooms = new Set(initialRooms);
    const group = (room) => ({
      addConnection: async (groupConnectionId) => {
        connectionCalls.push(['addConnection', room, groupConnectionId]);
      },
      removeConnection: async (groupConnectionId) => {
        connectionCalls.push(['removeConnection', room, groupConnectionId]);
      }
    });
    const connection = createConnection({
      group,
      sendToConnection: async (...args) => connectionCalls.push(['sendToConnection', ...args])
    }, {
      connectionId: trackedConnectionId,
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

  it('joins and broadcasts the complete mixed activity list for three connections', async () => {
    const users = [
      { uid: 'user-a', forename: 'Alice', surname: 'User' },
      { uid: 'user-b', forename: 'Bob', surname: 'User' },
      { uid: 'user-c', forename: 'Carol', surname: 'User' }
    ];
    const activities = [];
    const multiUserService = {
      ...activityService,
      redis: { set: async () => 'OK' },
      addActivity: async (caseId, user, connectionId, activity) => {
        activities.push({
          caseId, user, connectionId, activity
        });
      },
      getActivityForCases: async ([caseId]) => [{
        caseId,
        viewers: activities
          .filter((entry) => entry.activity === 'view')
          .map((entry) => ({
            id: entry.user.uid,
            forename: entry.user.forename,
            surname: entry.user.surname
          })),
        unknownViewers: 0,
        editors: activities
          .filter((entry) => entry.activity === 'edit')
          .map((entry) => ({
            id: entry.user.uid,
            forename: entry.user.forename,
            surname: entry.user.surname
          })),
        unknownEditors: 0
      }]
    };
    const handlers = createHandlers(multiUserService, serviceClient);
    const connections = users.map((user, index) => ({
      user,
      ...trackedConnection([], `connection-${index + 1}`)
    }));

    await Promise.all(connections.map(({ connection, user }, index) => (
      handlers.addActivity(connection, 'case-1', user, index === 1 ? 'edit' : 'view')
    )));
    await handlers.notify('case-1');

    connections.forEach(({ connectionCalls }, index) => {
      expect(connectionCalls).to.deep.equal([
        ['addConnection', keys.case.base('case-1'), `connection-${index + 1}`]
      ]);
    });
    expect(calls).to.deep.equal([[
      'sendToAll',
      {
        event: 'activity',
        data: [{
          caseId: 'case-1',
          viewers: [
            { id: 'user-a', forename: 'Alice', surname: 'User' },
            { id: 'user-c', forename: 'Carol', surname: 'User' }
          ],
          unknownViewers: 0,
          editors: [{ id: 'user-b', forename: 'Bob', surname: 'User' }],
          unknownEditors: 0
        }]
      },
      {}
    ]]);
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

  it('coalesces consecutive case changes and broadcasts only the latest activity', async () => {
    const handlers = createHandlers(activityService, serviceClient);

    const firstNotification = handlers.notify('case-1', { notificationId: 'notification-1' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const latestNotification = handlers.notify('case-1', { notificationId: 'notification-2' });
    await Promise.all([firstNotification, latestNotification]);

    expect(calls).to.deep.equal([
      [
        'set',
        'web-pubsub:notification:case-1:notification-2',
        calls[0][2],
        'PX',
        5000,
        'NX'
      ],
      [
        'sendToAll',
        { event: 'activity', data: [{ caseId: 'case-1', viewers: [], editors: [] }] },
        {}
      ]
    ]);
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

  it('broadcasts a view or edit change directly to the Azure case group', async () => {
    const { connection } = trackedConnection([], 'connection-a');
    const user = { uid: 'user-a', forename: 'Alice', surname: 'User' };
    const originalAddActivity = activityService.addActivity;
    activityService.addActivity = async () => [{
      caseId: 'case-1',
      options: { notificationId: 'view-edit-change-1' }
    }];
    const handlers = createHandlers(activityService, serviceClient);

    try {
      await handlers.addActivity(connection, 'case-1', user, 'edit');

      expect(calls[0][0]).to.equal('set');
      expect(calls[0][1]).to.equal(
        'web-pubsub:notification:case-1:view-edit-change-1'
      );
      expect(calls[1]).to.deep.equal([
        'sendToAll',
        { event: 'activity', data: [{ caseId: 'case-1', viewers: [], editors: [] }] },
        {}
      ]);
    } finally {
      activityService.addActivity = originalAddActivity;
    }
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
