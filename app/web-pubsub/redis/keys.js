const keys = {
  prefixes: {
    case: 'c',
    connection: 's',
    user: 'u'
  },
  case: {
    view: (caseId) => keys.compile('case', caseId, 'viewers'),
    edit: (caseId) => keys.compile('case', caseId, 'editors'),
    base: (caseId) => keys.compile('case', caseId),
  },
  user: (userId) => keys.compile('user', userId),
  connection: (connectionId) => keys.compile('connection', connectionId),
  compile: (prefix, value, suffix) => {
    const key = `${keys.prefixes[prefix]}:${value}`;
    if (suffix) {
      return `${key}:${suffix}`;
    }
    return key;
  }
};

module.exports = keys;
