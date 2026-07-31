const fetch = require('../util/fetch');

const ACCESS_DENIED_ERROR = {
  error: 'Forbidden',
  status: 403,
  message: 'You are not authorized to access one or more requested cases',
};

const CCD_UNAVAILABLE_ERROR = {
  error: 'Bad Gateway',
  status: 502,
  message: 'Unable to verify case access',
};

const toError = (errorDetails) => Object.assign(new Error(errorDetails.message), errorDetails);

function createCaseAccessChecker(config) {
  const asBoolean = (value, defaultValue = true) => {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['false', '0', 'off', 'no'].includes(normalized)) {
        return false;
      }
      if (['true', '1', 'on', 'yes'].includes(normalized)) {
        return true;
      }
    }

    return Boolean(value);
  };

  const isEnabled = () => {
    if (!config.has('rpx.case_access_check_enabled')) {
      return true;
    }
    return asBoolean(config.get('rpx.case_access_check_enabled'));
  };

  const getBaseUrl = () => config.get('rpx.base_url').replace(/\/$/, '');

  const mapError = (error) => {
    if (error && (error.status === 403 || error.status === 404)) {
      return ACCESS_DENIED_ERROR;
    }

    if (error && typeof error.status === 'number') {
      return {
        error: 'Bad Gateway',
        status: 502,
        message: `Case access verification failed with status ${error.status}`,
      };
    }

    return {
      ...CCD_UNAVAILABLE_ERROR,
      details: error?.message,
    };
  };

  const assertUserHasAccess = (caseIds, authorization) => {
    if (!isEnabled()) {
      return Promise.resolve();
    }

    if (!authorization) {
      return Promise.reject(toError(ACCESS_DENIED_ERROR));
    }

    const uniqueCaseIds = [...new Set(caseIds.filter((caseId) => !!caseId))];
    const baseUrl = getBaseUrl();

    return Promise.all(uniqueCaseIds.map((caseId) => fetch(`${baseUrl}/cases/${caseId}`, {
      headers: {
        Authorization: authorization,
      },
    }))).catch((error) => {
      throw toError(mapError(error));
    });
  };

  return {
    assertUserHasAccess,
    ACCESS_DENIED_ERROR,
    CCD_UNAVAILABLE_ERROR,
  };
}

module.exports = createCaseAccessChecker;
