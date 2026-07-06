const config = require('config');
const appInsights = require('applicationinsights');

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

const enableAppInsights = () => {
  if (!enabled) {
    return;
  }
  const appInsightsString = config.get('secrets.rpx.app-insights-connection-string-at');
  const appInsightsRoleName = config.get('appInsights.roleName');
  appInsights.setup(appInsightsString)
    .setAutoDependencyCorrelation(true)
    .setAutoCollectConsole(true, true);
  appInsights.defaultClient.context.tags[
    appInsights.defaultClient.context.keys.cloudRole] = appInsightsRoleName;
  appInsights.defaultClient.config.samplingPercentage = getSamplingPercentage();
  appInsights.start();
};

module.exports = enableAppInsights;
