const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const Redis = require('ioredis');

describe('Redis connection configuration', () => {
  let settings;
  let client;

  beforeEach(() => {
    settings = {
      'secrets.rpx.activity-managed-redis-connection-string': '',
      'secrets.rpx.activity-redis-password': 'preview-password',
      'redis.host': 'preview-redis-master',
      'redis.port': '6379',
      'redis.ssl': '',
      'redis.keyPrefix': 'activity:',
    };
  });

  afterEach(() => {
    if (client) client.disconnect();
    client = undefined;
  });

  function loadClient() {
    client = proxyquire('../../../../app/redis/redis-client', {
      config: {
        get: (key) => settings[key],
        util: { getEnv: () => 'test' },
      },
      // Use the installed client's option handling without opening a connection.
      ioredis: function LazyRedis(options) {
        return new Redis({ ...options, lazyConnect: true });
      },
    });
    return client.options;
  }

  it('uses the managed endpoint and decodes the access key with verified TLS', () => {
    settings['secrets.rpx.activity-managed-redis-connection-string'] = 'rediss://:key%2Bwith%2Fspecial%3D@managed.redis.azure.net:10000';

    const options = loadClient();
    expect(options.host).to.equal('managed.redis.azure.net');
    expect(options.port).to.equal(10000);
    expect(options.password).to.equal('key+with/special=');
    expect(options.tls).to.deep.equal({ servername: 'managed.redis.azure.net' });
    expect(options.keyPrefix).to.equal('activity:');
  });

  it('uses local and preview settings without TLS when the managed secret is empty', () => {
    const options = loadClient();
    expect(options.host).to.equal('preview-redis-master');
    expect(options.port).to.equal(6379);
    expect(options.password).to.equal('preview-password');
    expect(options.tls).to.equal(undefined);
  });

  [true, 'true'].forEach((ssl) => {
    it(`enables legacy TLS when configured as ${typeof ssl}`, () => {
      settings['redis.ssl'] = ssl;
      expect(loadClient().tls).to.deep.equal({});
    });
  });

  it('rejects an unencrypted managed connection string', () => {
    settings['secrets.rpx.activity-managed-redis-connection-string'] = 'redis://:password@managed.redis.azure.net:10000';
    expect(loadClient).to.throw('Managed Redis requires a rediss:// connection string');
  });
});
