const { Logger } = require('@hmcts/nodejs-logging');
const keys = require('./keys');

const logger = Logger.getLogger('redis-pub-sub');

function parseMessage(message) {
  if (typeof message !== 'string') {
    return {};
  }

  try {
    return JSON.parse(message);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(`[${new Date().toISOString()}] Failed to parse Redis pub-sub message`, error);
    logger.warn('Failed to parse Redis pub-sub message', error);
    return {};
  }
}

function handlePatternMessage(_, room, caseNotifier, message) {
  const caseId = room.replace(`${keys.prefixes.case}:`, '');
  caseNotifier(caseId, parseMessage(message));
}

function init(watcher, caseNotifier) {
  if (watcher && typeof caseNotifier === 'function') {
    watcher.psubscribe(`${keys.prefixes.case}:*`);
    watcher.on('pmessage', (_, room, message) => {
      handlePatternMessage(_, room, caseNotifier, message);
    });
  }
}

function createPubSub() {
  return {
    init
  };
}

module.exports = createPubSub;
