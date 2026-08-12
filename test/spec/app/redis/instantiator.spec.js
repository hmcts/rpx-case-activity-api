const expect = require('chai').expect;
const proxyquire = require('proxyquire');

describe('redis instantiator', () => {
  it('should configure ioredis to retry every 5-10 seconds', () => {
    let redisOptions;
    function Redis(options) {
      redisOptions = options;
      return {
        on: function() {
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
