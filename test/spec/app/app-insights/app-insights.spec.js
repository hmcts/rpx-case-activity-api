const chai = require('chai');
const expect = chai.expect;
const path = require('path');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');

const modulePath = path.resolve(__dirname, '../../../../app/app-insights/app-insights.js');
const appInsightsConnectionString = 'InstrumentationKey=XYZ;IngestionEndpoint=https://foo';
const roleName = 'rpx-case-activity-api';
const samplingConfigKey = 'appInsights.samplingPercentage';

const buildConfigStub = ({
  enabled = true,
  samplingConfigAvailable = true,
  samplingPercentage = 100
} = {}) => {
  const get = sinon.stub();
  get.withArgs('appInsights.enabled').returns(enabled);
  get.withArgs('secrets.rpx.app-insights-connection-string-at')
    .returns(appInsightsConnectionString);
  get.withArgs('appInsights.roleName').returns(roleName);
  get.withArgs(samplingConfigKey).returns(samplingPercentage);

  const has = sinon.stub();
  has.withArgs(samplingConfigKey).returns(samplingConfigAvailable);

  return { get, has };
};

const buildApplicationInsightsStub = () => {
  const defaultClient = {
    context: {
      tags: {},
      keys: { cloudRole: 'cloudRoleKey' }
    },
    config: {}
  };
  const setAutoDependencyCorrelation = sinon.stub().returnsThis();
  const setAutoCollectConsole = sinon.stub().returnsThis();
  const setup = sinon.stub().returns({
    setAutoDependencyCorrelation,
    setAutoCollectConsole
  });
  const start = sinon.stub();

  return {
    appInsights: {
      setup,
      start,
      defaultClient
    },
    defaultClient,
    setAutoCollectConsole,
    setAutoDependencyCorrelation,
    setup,
    start
  };
};

const loadAppInsights = (configOptions = {}) => {
  delete require.cache[modulePath];

  const config = buildConfigStub(configOptions);
  const applicationInsights = buildApplicationInsightsStub();
  const enableAppInsights = proxyquire(modulePath, {
    config,
    applicationinsights: applicationInsights.appInsights
  });

  return {
    config,
    enableAppInsights,
    ...applicationInsights
  };
};

describe('Application insights', () => {
  it('should export an initializer function', () => {
    const { enableAppInsights } = loadAppInsights();

    expect(enableAppInsights).to.be.a('function');
  });

  it('should not initialize application insights when disabled', () => {
    const {
      config,
      enableAppInsights,
      setup,
      start
    } = loadAppInsights({ enabled: false });

    enableAppInsights();

    sinon.assert.calledOnceWithExactly(config.get, 'appInsights.enabled');
    sinon.assert.notCalled(config.has);
    sinon.assert.notCalled(setup);
    sinon.assert.notCalled(start);
  });

  it('should initialize application insights with configured sampling percentage', () => {
    const {
      config,
      defaultClient,
      enableAppInsights,
      setAutoCollectConsole,
      setAutoDependencyCorrelation,
      setup,
      start
    } = loadAppInsights({ samplingPercentage: 100 });

    enableAppInsights();

    sinon.assert.calledWithExactly(setup, appInsightsConnectionString);
    sinon.assert.calledWithExactly(setAutoDependencyCorrelation, true);
    sinon.assert.calledWithExactly(setAutoCollectConsole, true, true);
    sinon.assert.calledWith(config.get, 'secrets.rpx.app-insights-connection-string-at');
    sinon.assert.calledWith(config.get, 'appInsights.roleName');
    sinon.assert.calledWith(config.get, samplingConfigKey);
    expect(defaultClient.context.tags.cloudRoleKey).to.equal(roleName);
    expect(defaultClient.config.samplingPercentage).to.equal(100);
    sinon.assert.calledOnce(start);
  });

  it('should default sampling percentage to 1 when config is unavailable', () => {
    const {
      config,
      defaultClient,
      enableAppInsights
    } = loadAppInsights({ samplingConfigAvailable: false });

    enableAppInsights();

    expect(defaultClient.config.samplingPercentage).to.equal(1);
    sinon.assert.calledOnceWithExactly(config.has, samplingConfigKey);
    sinon.assert.neverCalledWith(config.get, samplingConfigKey);
  });

  it('should default sampling percentage to 1 when config value is invalid', () => {
    const {
      config,
      defaultClient,
      enableAppInsights
    } = loadAppInsights({ samplingPercentage: 'invalid' });

    enableAppInsights();

    expect(defaultClient.config.samplingPercentage).to.equal(1);
    sinon.assert.calledOnceWithExactly(config.has, samplingConfigKey);
    sinon.assert.calledWith(config.get, samplingConfigKey);
  });
});
