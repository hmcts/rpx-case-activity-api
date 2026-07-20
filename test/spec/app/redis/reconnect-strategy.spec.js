const expect = require('chai').expect;
const { redisReconnectDelay } = require('../../../../app/redis/reconnect-strategy');

describe('redis reconnect strategy', () => {
  it('should retry between five and ten seconds', () => {
    expect(redisReconnectDelay(1)).to.equal(5000);
    expect(redisReconnectDelay(2)).to.equal(6000);
    expect(redisReconnectDelay(3)).to.equal(7000);
    expect(redisReconnectDelay(6)).to.equal(10000);
    expect(redisReconnectDelay(100)).to.equal(10000);
  });

  it('should default invalid retry counts to the minimum delay', () => {
    expect(redisReconnectDelay(null)).to.equal(5000);
    expect(redisReconnectDelay(0)).to.equal(5000);
    expect(redisReconnectDelay('abc')).to.equal(5000);
  });
});
