const { Logger } = require('@hmcts/nodejs-logging');
const userRequestAuthorizer = require('./user-request-authorizer');

const logger = Logger.getLogger('authCheckerUserOnlyFilter');

const isBadGatewayError = (error) => error.message !== undefined && (error.message.includes('getaddrinfo ENOTFOUND')
  || error.message.includes('socket hang up')
  || error.message.includes('getaddrinfo EAI_AGAIN')
  || error.message.includes('connect ETIMEOUT')
  || error.message.includes('ECONNRESET')
  || error.message.includes('ECONNREFUSED'));

const mapFetchErrors = (error, next) => {
  if (isBadGatewayError(error)) {
    logger.warn(`Mapping fetch error to 502: ${error.message}`);
    next({
      error: 'Bad Gateway',
      status: 502,
      message: error.message,
    });
  } else {
    logger.warn(`Mapping fetch error to 500: ${error.message}`);
    next({
      error: 'Internal Server Error',
      status: 500,
      message: error.message,
    });
  }
};

const authCheckerUserOnlyFilter = (req, res, next) => {
  const authorization = req.get('Authorization');
  req.authentication = {};

  logger.warn(`Authenticating user for ${req.method} ${req.originalUrl || req.url}; tokenPresent=${Boolean(authorization)}`);

  userRequestAuthorizer
    .authorise(req)
    .then((user) => {
      req.authentication.user = user;
      req.authentication.token = authorization;
      logger.warn(`Authentication successful for uid=${user?.uid || '<missing>'}`);
    })
    .then(() => {
      logger.warn('Proceeding to next middleware after successful authentication');
      next();
    })
    .catch((error) => {
      if (error.name === 'FetchError') {
        logger.error(error);
        mapFetchErrors(error, next);
      } else {
        logger.warn(`Unsuccessful user authentication: ${error?.message || error}`);
        error.status = error.status || 401; // eslint-disable-line no-param-reassign
        logger.warn(`Returning authentication error with status=${error.status}`);
        next(error);
      }
    });
};

module.exports = authCheckerUserOnlyFilter;
