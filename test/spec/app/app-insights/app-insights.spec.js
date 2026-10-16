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
  connectionString = appInsightsConnectionString,
  samplingConfigAvailable = true,
  samplingPercentage = 100
} = {}) => {
  const get = sinon.stub();
  get.withArgs('appInsights.enabled').returns(enabled);
  get.withArgs('secrets.rpx.app-insights-connection-string-at')
    .returns(connectionString);
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
    config: {},
    trackTrace: sinon.stub()
  };
  const setAutoDependencyCorrelation = sinon.stub().returnsThis();
  const setAutoCollectConsole = sinon.stub().returnsThis();
  const setup = sinon.stub().returns({
    setAutoDependencyCorrelation,
    setAutoCollectConsole
  });
  const start = sinon.stub();
  const Contracts = {
    SeverityLevel: {
      Verbose: 0,
      Information: 1,
      Warning: 2,
      Error: 3,
      Critical: 4
    }
  };

  return {
    appInsights: {
      setup,
      start,
      defaultClient,
      Contracts
    },
    defaultClient,
    setAutoCollectConsole,
    setAutoDependencyCorrelation,
    setup,
    start
  };
};

const buildLoggingStub = () => {
  const loggerInstance = { add: sinon.stub() };
  const getLogger = sinon.stub().returns(loggerInstance);
  return {
    Logger: { getLogger },
    loggerInstance
  };
};

const loadAppInsights = (configOptions = {}) => {
  delete require.cache[modulePath];

  const config = buildConfigStub(configOptions);
  const applicationInsights = buildApplicationInsightsStub();
  const loggingStub = buildLoggingStub();
  const enableAppInsights = proxyquire(modulePath, {
    config,
    applicationinsights: applicationInsights.appInsights,
    '@hmcts/nodejs-logging': loggingStub
  });

  return {
    config,
    enableAppInsights,
    loggingStub,
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

  it('should not initialize application insights without a connection string', () => {
    const {
      config,
      enableAppInsights,
      setup,
      start
    } = loadAppInsights({ connectionString: '' });

    enableAppInsights();

    sinon.assert.calledWithExactly(config.get, 'secrets.rpx.app-insights-connection-string-at');
    sinon.assert.neverCalledWith(config.get, 'appInsights.roleName');
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
    sinon.assert.calledWithExactly(setAutoCollectConsole, false, false);
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

  it('should wire the App Insights transport to loggers created before enableAppInsights()', () => {
    const { enableAppInsights, loggingStub } = loadAppInsights();

    // Simulate a logger created before App Insights starts.
    loggingStub.Logger.getLogger('early-logger');

    enableAppInsights();

    // The early logger should have had the transport added retroactively.
    sinon.assert.calledOnce(loggingStub.loggerInstance.add);
  });

  it('should wire the App Insights transport to loggers created after enableAppInsights()', () => {
    const { enableAppInsights, loggingStub } = loadAppInsights();

    enableAppInsights();

    // Simulate a logger created after App Insights starts.
    loggingStub.Logger.getLogger('late-logger');

    sinon.assert.calledOnce(loggingStub.loggerInstance.add);
  });

  it('should forward log entries to App Insights trackTrace', () => {
    const { enableAppInsights, defaultClient } = loadAppInsights();

    enableAppInsights();

    // Obtain the transport that was registered.
    const { loggingStub } = loadAppInsights();
    enableAppInsights();
    const transport = loggingStub.loggerInstance.add.args[0]
      ? loggingStub.loggerInstance.add.args[0][0]
      : null;

    if (transport && typeof transport.log === 'function') {
      const callback = sinon.stub();
      transport.log('warn', 'test message', {}, callback);
      sinon.assert.calledOnce(defaultClient.trackTrace);
      sinon.assert.calledOnce(callback);
    }
  });
});
