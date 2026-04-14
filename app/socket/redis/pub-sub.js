const keys = require('./keys');

function handlePatternMessage(_, room, caseNotifier) {
  const caseId = room.replace(`${keys.prefixes.case}:`, '');
  caseNotifier(caseId);
}

function init(watcher, caseNotifier) {
  if (watcher && typeof caseNotifier === 'function') {
    watcher.psubscribe(`${keys.prefixes.case}:*`);
    watcher.on('pmessage', function onPatternMessage(_, room) {
      handlePatternMessage(_, room, caseNotifier);
    });
  }
}

function createPubSub() {
  return {
    init
  };
}

module.exports = createPubSub;
