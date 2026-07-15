const SocketIO = require('socket.io');
const expect = require('chai').expect;
const Socket = require('../../../../app/socket');

describe('socket', () => {
  const MOCK_SERVER = {};
  const MOCK_REDIS = {
    duplicated: false,
    duplicate: () => {
      MOCK_REDIS.duplicated = true;
      return MOCK_REDIS;
    },
    psubscribe: () => {},
    on: () => {}
  };

  afterEach(() => {
    MOCK_REDIS.duplicated = false;
  });

  it('should be appropriately initialised', () => {
    const socket = Socket(MOCK_SERVER, MOCK_REDIS);
    expect(socket).not.to.be.undefined;
    expect(socket.socketServer).to.be.instanceOf(SocketIO.Server);
    expect(socket.activityService).to.be.an('object');
    expect(socket.activityService.redis).to.equal(MOCK_REDIS);
    expect(socket.handlers).to.be.an('object');
    expect(socket.handlers.activityService).to.equal(socket.activityService);
    expect(socket.handlers.socketServer).to.equal(socket.socketServer);
    expect(MOCK_REDIS.duplicated).to.be.true;
  });

  it('should configure Redis adapter clients to retry every 5-10 seconds', () => {
    const redisOptions = Socket.buildRedisAdapterOptions('rediss://localhost:6380', true);

    expect(redisOptions.url).to.equal('rediss://localhost:6380');
    expect(redisOptions.pingInterval).to.equal(300000);
    expect(redisOptions.socket.connectTimeout).to.equal(15000);
    expect(redisOptions.socket.tls).to.be.true;
    expect(redisOptions.socket.reconnectStrategy(1)).to.equal(5000);
    expect(redisOptions.socket.reconnectStrategy(6)).to.equal(10000);
    expect(redisOptions.socket.reconnectStrategy(100)).to.equal(10000);
  });

  it('should configure socket heartbeat defaults for websocket transport', () => {
    const socketOptions = Socket.buildSocketServerOptions();

    expect(socketOptions.allowEIO3).to.be.true;
    expect(socketOptions.transports).to.deep.equal(['websocket']);
    expect(socketOptions.pingInterval).to.equal(25000);
    expect(socketOptions.pingTimeout).to.equal(20000);
  });
});
