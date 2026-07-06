const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const path = require('path');
const enableAppInsights = require('../../../../app/app-insights/app-insights');

describe('Application insights', () => {
  it('should initialize properly', () => {
    expect(enableAppInsights).to.not.throw();
  });

  it('should read connection string and role name when enabled', () => {
    const getConfig = sinon.stub();
    getConfig.withArgs('appInsights.enabled').returns(true);
    getConfig
      .withArgs('secrets.rpx.app-insights-connection-string-at')
      .returns('InstrumentationKey=XYZ;IngestionEndpoint=https://foo');
    getConfig.withArgs('appInsights.roleName').returns('rpx-case-activity-api');
    getConfig.withArgs('appInsights.samplingPercentage').returns(100);

    const configStub = {
      has: sinon.stub()
        .withArgs('appInsights.samplingPercentage').returns(true),
      get: getConfig,
    };
    const defaultClient = {
      context: { tags: {}, keys: { cloudRole: 'cloudRoleKey' } },
      config: {}
    };
    const setAutoDependencyCorrelation = sinon.stub().returnsThis();
    const setAutoCollectConsole = sinon.stub().returnsThis();
    const setupStub = sinon.stub().returns({
      setAutoDependencyCorrelation,
      setAutoCollectConsole
    });
    const startStub = sinon.stub();
    const appInsightsStub = { setup: setupStub, start: startStub, defaultClient };

    const modulePath = path.resolve(__dirname, '../../../../app/app-insights/app-insights.js');
    delete require.cache[modulePath];
    const enableWithStubs = proxyquire(modulePath, {
      config: configStub,
      applicationinsights: appInsightsStub,
    });

    enableWithStubs();

    sinon.assert.calledOnce(setupStub);
    sinon.assert.calledWith(configStub.get, 'secrets.rpx.app-insights-connection-string-at');
    sinon.assert.calledWith(configStub.get, 'appInsights.roleName');
    expect(defaultClient.context.tags['cloudRoleKey']).to.equal('rpx-case-activity-api');
    expect(defaultClient.config.samplingPercentage).to.equal(100);
    sinon.assert.calledOnce(startStub);
  });

  it('should default sampling percentage to 1 when config is unavailable', () => {
    const getConfig = sinon.stub();
    getConfig.withArgs('appInsights.enabled').returns(true);
    getConfig
      .withArgs('secrets.rpx.app-insights-connection-string-at')
      .returns('InstrumentationKey=XYZ;IngestionEndpoint=https://foo');
    getConfig.withArgs('appInsights.roleName').returns('rpx-case-activity-api');

    const configStub = {
      has: sinon.stub()
        .withArgs('appInsights.samplingPercentage').returns(false),
      get: getConfig,
    };
    const defaultClient = {
      context: { tags: {}, keys: { cloudRole: 'cloudRoleKey' } },
      config: {}
    };
    const setAutoDependencyCorrelation = sinon.stub().returnsThis();
    const setAutoCollectConsole = sinon.stub().returnsThis();
    const setupStub = sinon.stub().returns({
      setAutoDependencyCorrelation,
      setAutoCollectConsole
    });
    const startStub = sinon.stub();
    const appInsightsStub = { setup: setupStub, start: startStub, defaultClient };

    const modulePath = path.resolve(__dirname, '../../../../app/app-insights/app-insights.js');
    delete require.cache[modulePath];
    const enableWithStubs = proxyquire(modulePath, {
      config: configStub,
      applicationinsights: appInsightsStub,
    });

    enableWithStubs();

    expect(defaultClient.config.samplingPercentage).to.equal(1);
    sinon.assert.neverCalledWith(configStub.get, 'appInsights.samplingPercentage');
  });
});
