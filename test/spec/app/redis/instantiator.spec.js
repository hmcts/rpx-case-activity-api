const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('redis instantiator', () => {
  function createWithConnectionString(connectionString, overrides = {}) {
    let options;
    const settings = {
      'secrets.rpx.activity-managed-redis-connection-string': connectionString,
      'secrets.rpx.activity-redis-password': 'local-password',
      'redis.host': 'localhost',
      'redis.port': 6379,
      'redis.ssl': false,
      'redis.keyPrefix': 'activity:',
      ...overrides
    };
    const instantiate = proxyquire('../../../../app/redis/instantiator', {
      config: {
        '@noCallThru': true,
        has: (key) => Object.prototype.hasOwnProperty.call(settings, key),
        get: (key) => settings[key],
        util: { getEnv: () => 'test' }
      },
      ioredis: function Redis(value) {
        options = value;
        return { on() { return this; } };
      }
    });
    const client = instantiate(() => {});
    return { options, client };
  }

  it('uses the mounted managed connection string instead of localhost defaults', () => {
    const { options } = createWithConnectionString('rediss://:secret@managed.redis.azure.net:10000');
    expect(options).to.include({ host: 'managed.redis.azure.net', port: 10000, password: 'secret' });
    expect(options.tls).to.deep.equal({ servername: 'managed.redis.azure.net' });
    expect(options.keyPrefix).to.equal('activity:');
    expect(options.retryStrategy(1)).to.equal(5000);
  });

  it('defaults to managed Redis port 10000 when the URL omits a port', () => {
    const { options } = createWithConnectionString('rediss://:secret@managed.redis.azure.net');
    expect(options.port).to.equal(10000);
  });

  it('preserves an explicit port and decodes URL-encoded credentials', () => {
    const { options } = createWithConnectionString('rediss://user%40name:p%2Bss%2Fword%3D@managed.redis.azure.net:12345');
    expect(options).to.include({ username: 'user@name', password: 'p+ss/word=', port: 12345 });
  });

  it('rejects plaintext managed connections rather than falling back to local Redis', () => {
    expect(() => createWithConnectionString('redis://:secret@managed.redis.azure.net:10000'))
      .to.throw('Managed Redis requires a valid rediss:// connection string');
  });

  it('rejects malformed connection strings without exposing credentials', () => {
    ['secret-not-a-url', 'rediss://:secret%ZZ@managed.redis.azure.net'].forEach((value) => {
      expect(() => createWithConnectionString(value))
        .to.throw('Managed Redis requires a valid rediss:// connection string');
    });
  });

  it('preserves local Redis options and client helpers when no managed URL is configured', () => {
    const { options, client } = createWithConnectionString('');
    expect(options).to.include({
      host: 'localhost', port: 6379, password: 'local-password', tls: false
    });
    const pipeline = [[null, 'OK'], [null, 1]];
    expect(client.logPipelineFailures(pipeline, 'test')).to.equal(pipeline);
    expect(client.extractPipelineResults(pipeline)).to.deep.equal(['OK', 1]);
  });

  it('preserves legacy remote Redis TLS, password, port, and prefix settings', () => {
    const tls = { servername: 'legacy.redis.cache.windows.net' };
    const { options } = createWithConnectionString('', {
      'redis.host': 'legacy.redis.cache.windows.net',
      'redis.port': 6380,
      'redis.ssl': tls,
      'redis.keyPrefix': 'existing-prefix:',
      'secrets.rpx.activity-redis-password': 'existing-password'
    });
    expect(options).to.include({
      host: 'legacy.redis.cache.windows.net',
      port: 6380,
      password: 'existing-password',
      keyPrefix: 'existing-prefix:'
    });
    expect(options.tls).to.equal(tls);
  });

  it('should configure ioredis to retry every 5-10 seconds', () => {
    let redisOptions;
    function Redis(options) {
      redisOptions = options;
      return {
        on() {
          return this;
        }
      };
    }

    const instantiateRedis = proxyquire('../../../../app/redis/instantiator', {
      ioredis: Redis
    });

    instantiateRedis(() => {});

    expect(redisOptions.retryStrategy(1)).to.equal(5000);
    expect(redisOptions.retryStrategy(6)).to.equal(10000);
    expect(redisOptions.retryStrategy(100)).to.equal(10000);
  });
});
