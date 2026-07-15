const util = require('util');
const config = require('config');
const appInsights = require('applicationinsights');
const winston = require('winston');
const { Logger } = require('@hmcts/nodejs-logging');

const enabled = config.get('appInsights.enabled');
const samplingPercentageConfigKey = 'appInsights.samplingPercentage';
const defaultSamplingPercentage = 1;

const getSamplingPercentage = () => {
  if (!config.has(samplingPercentageConfigKey)) {
    return defaultSamplingPercentage;
  }

  const samplingPercentage = Number(config.get(samplingPercentageConfigKey));

  return Number.isFinite(samplingPercentage) ? samplingPercentage : defaultSamplingPercentage;
};

// Map winston level strings to App Insights SeverityLevel enum values.
const SEVERITY_MAP = {
  silly: appInsights.Contracts.SeverityLevel.Verbose,
  debug: appInsights.Contracts.SeverityLevel.Verbose,
  verbose: appInsights.Contracts.SeverityLevel.Verbose,
  info: appInsights.Contracts.SeverityLevel.Information,
  warn: appInsights.Contracts.SeverityLevel.Warning,
  error: appInsights.Contracts.SeverityLevel.Error,
};

// Custom winston transport that forwards each log entry to App Insights trackTrace.
function AppInsightsTransport(options) {
  winston.Transport.call(this, options);
  this.name = 'appInsights';
  this.level = options && options.level || 'silly';
}
util.inherits(AppInsightsTransport, winston.Transport);

AppInsightsTransport.prototype.log = function log(level, msg, meta, callback) {
  if (!appInsights.defaultClient) {
    callback(null, true);
    return;
  }

  const severity = SEVERITY_MAP[level] !== undefined
    ? SEVERITY_MAP[level]
    : appInsights.Contracts.SeverityLevel.Information;

  const properties = meta && typeof meta === 'object' && Object.keys(meta).length > 0
    ? meta
    : undefined;

  appInsights.defaultClient.trackTrace({ message: msg, severity, properties });
  callback(null, true);
};

// Patch Logger.getLogger to track every logger instance and wire App Insights
// transport to it, whether it is created before or after enableAppInsights().
const _originalGetLogger = Logger.getLogger.bind(Logger);
let _appInsightsTransport = null;
const _loggerRegistry = [];

Logger.getLogger = function getLogger(name) {
  const instance = _originalGetLogger(name);
  if (_appInsightsTransport) {
    instance.add(_appInsightsTransport, {}, true);
  } else {
    _loggerRegistry.push(instance);
  }
  return instance;
};

const enableAppInsights = () => {
  if (!enabled) {
    return;
  }
  const appInsightsString = config.get('secrets.rpx.app-insights-connection-string-at');
  const appInsightsRoleName = config.get('appInsights.roleName');
  appInsights.setup(appInsightsString)
    .setAutoDependencyCorrelation(true)
    .setAutoCollectConsole(false, false);
  appInsights.defaultClient.context.tags[
    appInsights.defaultClient.context.keys.cloudRole] = appInsightsRoleName;
  appInsights.defaultClient.config.samplingPercentage = getSamplingPercentage();
  appInsights.start();

  _appInsightsTransport = new AppInsightsTransport({ level: 'silly' });

  // Wire the transport to any loggers that were created before enableAppInsights() ran.
  _loggerRegistry.forEach((loggerInstance) => {
    loggerInstance.add(_appInsightsTransport, {}, true);
  });
  _loggerRegistry.length = 0;
};

module.exports = enableAppInsights;
