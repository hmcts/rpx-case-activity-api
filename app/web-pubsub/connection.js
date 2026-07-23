const keys = require('./redis/keys');

function createConnection(serviceClient, context) {
  const { connectionId } = context;
  const rooms = new Set(Array.isArray(context.states?.rooms) ? context.states.rooms : []);

  return {
    id: connectionId,
    rooms,
    async emit(event, data) {
      await serviceClient.sendToConnection(connectionId, { event, data });
    },
    async join(room) {
      if (room && !rooms.has(room)) {
        await serviceClient.group(room).addConnection(connectionId);
        rooms.add(room);
      }
    },
    async leave(room) {
      if (room && rooms.has(room)) {
        await serviceClient.group(room).removeConnection(connectionId);
        rooms.delete(room);
      }
    },
    async leaveCaseGroups() {
      const caseGroups = [...rooms].filter((room) => room.startsWith(`${keys.prefixes.case}:`));
      await Promise.all(caseGroups.map((room) => this.leave(room)));
    }
  };
}

module.exports = createConnection;
