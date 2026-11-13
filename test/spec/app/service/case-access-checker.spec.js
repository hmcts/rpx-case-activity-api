const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const proxyquire = require('proxyquire');

chai.use(sinonChai);

const { expect } = chai;

describe('case access checker', () => {
  let config;
  let fetch;
  let caseAccessChecker;
  let logger;

  beforeEach(() => {
    fetch = sinon.stub().returns(Promise.resolve({}));
    logger = { warn: sinon.stub() };
    config = {
      has: sinon.stub().returns(true),
      get: sinon.stub(),
    };
    config.get.withArgs('rpx.case_access_check_enabled').returns(true);
    config.get.withArgs('rpx.base_url').returns('https://ccd.local');

    caseAccessChecker = proxyquire('../../../../app/service/case-access-checker', {
      '../util/fetch': fetch,
      '@hmcts/nodejs-logging': { Logger: { getLogger: () => logger } },
    })(config);
  });

  it('should call CCD once for each unique case id', async () => {
    await caseAccessChecker.assertUserHasAccess(['111', '222', '111'], 'Bearer token');

    expect(fetch.callCount).to.equal(2);
    expect(fetch.firstCall).to.have.been.calledWith('https://ccd.local/cases/111', {
      timeout: 5000,
      redirect: 'error',
      headers: {
        experimental: 'true',
        Authorization: 'Bearer token',
      },
    });
    expect(fetch.secondCall).to.have.been.calledWith('https://ccd.local/cases/222', {
      timeout: 5000,
      redirect: 'error',
      headers: {
        experimental: 'true',
        Authorization: 'Bearer token',
      },
    });
  });

  it('should reject with forbidden when authorization is missing', async () => {
    try {
      await caseAccessChecker.assertUserHasAccess(['111'], null);
      throw new Error('expected access check to fail');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect(error).to.include(caseAccessChecker.ACCESS_DENIED_ERROR);
    }
  });

  it('forwards the proxy service credential alongside the caller identity to CCD', async () => {
    await caseAccessChecker.assertUserHasAccess(['111'], 'Bearer user', 'Bearer service');
    expect(fetch.firstCall.args[1].headers).to.deep.equal({
      experimental: 'true',
      Authorization: 'Bearer user',
      ServiceAuthorization: 'Bearer service'
    });
  });

  it('logs safe upstream diagnostics without exposing tokens, case IDs or error bodies', async () => {
    fetch.rejects(Object.assign(new Error('Bearer secret-user-token'), {
      code: 'ECONNREFUSED', type: 'system', body: 'private case details'
    }));
    try {
      await caseAccessChecker.assertUserHasAccess(['111'], 'Bearer secret-user-token', 'Bearer secret-service-token');
      throw new Error('expected lookup to fail');
    } catch (error) {
      expect(error.status).to.equal(502);
    }
    expect(logger.warn.calledOnce).to.equal(true);
    const log = logger.warn.firstCall.args.join(' ');
    expect(log).to.include('upstream=https://ccd.local');
    expect(log).to.include('code=ECONNREFUSED');
    expect(log).to.include('serviceAuthorizationPresent=true');
    expect(log).not.to.include('secret-user-token');
    expect(log).not.to.include('secret-service-token');
    expect(log).not.to.include('private case details');
    expect(log).not.to.include('111');
  });

  it('should reject with forbidden when CCD denies access', async () => {
    fetch.returns(Promise.reject(Object.assign(new Error('forbidden'), { status: 403 })));

    try {
      await caseAccessChecker.assertUserHasAccess(['111'], 'Bearer token');
      throw new Error('expected access check to fail');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect(error).to.include(caseAccessChecker.ACCESS_DENIED_ERROR);
    }
  });

  it('should skip the CCD lookup when access checks are disabled', async () => {
    fetch.resetHistory();
    config = {
      has: sinon.stub().returns(true),
      get: sinon.stub(),
    };
    config.get.withArgs('rpx.case_access_check_enabled').returns(false);
    config.get.withArgs('rpx.base_url').returns('https://ccd.local');
    caseAccessChecker = proxyquire('../../../../app/service/case-access-checker', {
      '../util/fetch': fetch,
    })(config);

    await caseAccessChecker.assertUserHasAccess(['111'], 'Bearer token');

    expect(fetch.called).to.equal(false);
  });

  it('should treat string false as disabled (env var override)', async () => {
    fetch.resetHistory();
    config = {
      has: sinon.stub().returns(true),
      get: sinon.stub(),
    };
    config.get.withArgs('rpx.case_access_check_enabled').returns('false');
    config.get.withArgs('rpx.base_url').returns('https://ccd.local');
    caseAccessChecker = proxyquire('../../../../app/service/case-access-checker', {
      '../util/fetch': fetch,
    })(config);

    await caseAccessChecker.assertUserHasAccess(['111'], 'Bearer token');

    expect(fetch.called).to.equal(false);
  });
});
