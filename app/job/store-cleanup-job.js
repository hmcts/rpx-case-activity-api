const cron = require('node-cron');
const debug = require('debug')('rpx-case-activity-api:store-cleanup-job');
const config = require('config');
const redis = require('../redis/redis-client');

const { logPipelineFailures } = redis;
const REDIS_ACTIVITY_KEY_PREFIX = config.get('redis.keyPrefix');

const scanExistingCasesKeys = (prefix) => new Promise((resolve, reject) => {
  const stream = redis.scanStream({
    // only returns keys following the pattern
    match: `${REDIS_ACTIVITY_KEY_PREFIX}${prefix}:*`,
    // returns approximately 100 elements per call
    count: 100,
  });
  const keys = [];
  let settled = false;
  stream.on('data', (resultKeys) => {
    // `resultKeys` is an array of strings representing key names
    for (let i = 0; i < resultKeys.length; i += 1) {
      keys.push(resultKeys[i]);
    }
  });
  stream.once('error', (err) => {
    if (settled) return;
    settled = true;
    reject(err);
  });
  stream.once('end', () => {
    if (settled) return;
    settled = true;
    debug(`scan completed keys: ${keys}`);
    resolve(keys);
  });
});

const cleanupActivitiesCommand = (key) => ['zremrangebyscore', key, '-inf', Date.now()];

const pipeline = (cases) => {
  const commands = cases.map((caseKey) => cleanupActivitiesCommand(caseKey));
  debug(`created cleanup pipeline: ${commands}`);
  return redis.pipeline(commands);
};

const cleanCasesWithPrefix = (prefix) => scanExistingCasesKeys(prefix)
  .then((cases) => {
    // scan returns the prefixed keys. Remove them since the redis client will add it back
    const casesWithoutPrefix = cases.map((k) => k.replace(REDIS_ACTIVITY_KEY_PREFIX, ''));

    debug(`about to cleanup the following cases: ${casesWithoutPrefix}`);
    if (casesWithoutPrefix.length === 0) return undefined;
    return pipeline(casesWithoutPrefix).exec()
      .then((pipelineOutcome) => logPipelineFailures(pipelineOutcome, 'error in store cleanup job'));
  })
  .catch((err) => {
    // ScanStream emits errors independently of the Redis client. Always consume the
    // error so a temporary Redis outage cannot terminate the Node.js process.
    debug(`Error cleaning activities with prefix '${prefix}': ${err.message}`);
  });

let activeCleanup;

const storeCleanup = () => {
  if (activeCleanup) {
    debug('store cleanup already running; skipping overlapping run');
    return activeCleanup;
  }

  debug('store cleanup starting...');
  activeCleanup = Promise.all([
    cleanCasesWithPrefix('case'), // Cases via RESTful interface.
    cleanCasesWithPrefix('c') // Cases via the Web PubSub interface.
  ]).finally(() => {
    activeCleanup = undefined;
  });
  return activeCleanup;
};

exports.start = (crontab) => {
  const isValid = cron.validate(crontab);
  if (!isValid) throw new Error(`invalid crontab: ${crontab}`);
  debug(`scheduling store cleanup job according to crontab: ${crontab}`);
  cron.schedule(crontab, storeCleanup);
};

exports.force = () => {
  debug('forced store cleanup');
  return storeCleanup();
};
