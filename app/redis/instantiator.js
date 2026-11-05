const config = require('config');
const Redis = require('ioredis');
const { URL } = require('node:url');
const { redisReconnectDelay } = require('./reconnect-strategy');

const ERROR = 0;
const RESULT = 1;
const ENV = config.util.getEnv('NODE_ENV');
const MANAGED_CONNECTION_STRING = 'secrets.rpx.activity-managed-redis-connection-string';

function connectionOptions() {
  const connectionString = config.has(MANAGED_CONNECTION_STRING)
    ? config.get(MANAGED_CONNECTION_STRING)
    : '';

  if (connectionString) {
    // Parse credentials without including the connection string in error messages.
    let endpoint;
    let password;
    let username;
    try {
      endpoint = new URL(connectionString);
      password = decodeURIComponent(endpoint.password);
      username = decodeURIComponent(endpoint.username);
    } catch (error) {
      throw new Error('Managed Redis requires a valid rediss:// connection string');
    }
    if (endpoint.protocol !== 'rediss:' || !endpoint.hostname) {
      throw new Error('Managed Redis requires a valid rediss:// connection string');
    }
    return {
      host: endpoint.hostname,
      port: Number(endpoint.port || 10000),
      password,
      ...(username ? { username } : {}),
      tls: { servername: endpoint.hostname },
    };
  }

  return {
    port: config.get('redis.port'),
    host: config.get('redis.host'),
    password: config.get('secrets.rpx.activity-redis-password'),
    tls: config.get('redis.ssl'),
  };
}

function instantiateRedis(debug) {
  const redis = new Redis({
    ...connectionOptions(),
    keyPrefix: config.get('redis.keyPrefix'),
    // Retry lost Redis connections periodically using the shared bounded delay.
    retryStrategy: redisReconnectDelay,
    // log unhandled redis errors
    showFriendlyErrorStack: ENV === 'test' || ENV === 'dev',
  });

  /* redis pipeline returns a reply of the form [[op1error, op1result], [op2error, op2result], ...].
    error is null in case of success */
  redis.logPipelineFailures = (plOutcome, message) => {
    if (Array.isArray(plOutcome)) {
      const operationsFailureOutcome = plOutcome.map((operationOutcome) => operationOutcome[ERROR]);
      const failures = operationsFailureOutcome.filter((element) => element !== null);
      failures.forEach((f) => debug(`${message}: ${f}`));
    }
    return plOutcome;
  };

  redis.extractPipelineResults = (pipelineOutcome) => {
    const results = pipelineOutcome.map((operationOutcome) => operationOutcome[RESULT]);
    debug(`pipeline results: ${results}`);
    return results;
  };

  redis
    .on('error', (err) => {
      debug(`Redis error: ${err.message}`);
    }).on('connect', () => {
      debug('connected to Redis');
    });

  return redis;
}

module.exports = instantiateRedis;
