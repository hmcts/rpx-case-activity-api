const { Logger } = require('@hmcts/nodejs-logging');
const keys = require('./keys');

const logger = Logger.getLogger('web-pubsub-redis-pub-sub');

function parseMessage(message) {
  if (typeof message !== 'string') {
    logger.warn('Redis pub-sub message is not a string');
    return {};
  }

  try {
    return JSON.parse(message);
  } catch (error) {
    logger.warn('Failed to parse Redis pub-sub message', error);
    return {};
  }
}

function handlePatternMessage(_, room, caseNotifier, message) {
  const caseId = room.replace(`${keys.prefixes.case}:`, '');
  logger.warn(`Redis pub-sub event received for room '${room}', caseId '${caseId}'`);
  caseNotifier(caseId, parseMessage(message));
}

function init(watcher, caseNotifier) {
  if (watcher && typeof caseNotifier === 'function') {
    const pattern = `${keys.prefixes.case}:*`;
    logger.warn(`Subscribing Web PubSub watcher to Redis pattern '${pattern}'`);
    const subscription = watcher.psubscribe(pattern);
    if (subscription && typeof subscription.catch === 'function') {
      subscription.catch((error) => {
        logger.warn('Web PubSub Redis pattern subscription failed', error);
      });
    }
    watcher.on('pmessage', (_, room, message) => {
      handlePatternMessage(_, room, caseNotifier, message);
    });
  } else {
    logger.warn('Web PubSub Redis pub-sub init skipped due to missing watcher or notifier');
  }
}

function createPubSub() {
  return {
    init
  };
}

module.exports = createPubSub;
