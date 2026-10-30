const config = require('config');
const debug = require('debug')('rpx-case-activity-api:redis-client');
const Redis = require('ioredis');
const { URL } = require('url');

const ERROR = 0;
const RESULT = 1;
const ENV = config.util.getEnv('NODE_ENV');

const connectionString = config.get('secrets.rpx.activity-managed-redis-connection-string');
let connectionOptions;

if (connectionString) {
  const endpoint = new URL(connectionString);
  if (endpoint.protocol !== 'rediss:') {
    throw new Error('Managed Redis requires a rediss:// connection string');
  }
  // ioredis 3 does not enable TLS automatically for rediss:// URLs.
  connectionOptions = {
    host: endpoint.hostname,
    port: Number(endpoint.port || 10000),
    password: decodeURIComponent(endpoint.password),
    tls: { servername: endpoint.hostname },
  };
} else {
  connectionOptions = {
    port: config.get('redis.port'),
    host: config.get('redis.host'),
    password: config.get('redis.password'),
  };
}

const redis = new Redis({
  ...connectionOptions,
  keyPrefix: config.get('redis.keyPrefix'),
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
  } else {
    debug(`${plOutcome} is not an Array...`);
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
    // eslint-disable-next-line no-console
    console.log(`Redis error: ${err.message}`);
  }).on('connect', () => {
  // eslint-disable-next-line no-console
    console.log('connected to Redis');
  });

module.exports = redis;
