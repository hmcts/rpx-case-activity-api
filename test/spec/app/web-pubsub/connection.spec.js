const { expect } = require('chai');
const createConnection = require('../../../../app/web-pubsub/connection');

describe('web-pubsub.connection', () => {
  const calls = [];
  const group = {
    addConnection: async (connectionId) => calls.push(['add', connectionId]),
    removeConnection: async (connectionId) => calls.push(['remove', connectionId])
  };
  const serviceClient = {
    group: (name) => {
      calls.push(['group', name]);
      return group;
    },
    sendToConnection: async (...args) => calls.push(['send', ...args])
  };

  beforeEach(() => {
    calls.length = 0;
  });

  it('joins and leaves Azure Web PubSub groups while tracking connection state', async () => {
    const connection = createConnection(serviceClient, {
      connectionId: 'connection-1',
      states: { rooms: ['c:old'] }
    });

    await connection.leaveCaseGroups();
    await connection.join('c:new');

    expect([...connection.rooms]).to.deep.equal(['c:new']);
    expect(calls).to.deep.equal([
      ['group', 'c:old'],
      ['remove', 'connection-1'],
      ['group', 'c:new'],
      ['add', 'connection-1']
    ]);
  });

  it('wraps outgoing data with the retained event name', async () => {
    const connection = createConnection(serviceClient, {
      connectionId: 'connection-1',
      states: {}
    });

    await connection.emit('activity', [{ caseId: '123' }]);

    expect(calls).to.deep.equal([
      ['send', 'connection-1', { event: 'activity', data: [{ caseId: '123' }] }]
    ]);
  });
});
