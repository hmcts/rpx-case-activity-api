const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const proxyquire = require('proxyquire');

chai.use(sinonChai);

const expect = chai.expect;

describe('case access checker', () => {
  let config;
  let fetch;
  let caseAccessChecker;

  beforeEach(() => {
    fetch = sinon.stub().returns(Promise.resolve({}));
    config = {
      has: sinon.stub().returns(true),
      get: sinon.stub(),
    };
    config.get.withArgs('rpx.case_access_check_enabled').returns(true);
    config.get.withArgs('rpx.base_url').returns('https://ccd.local');

    caseAccessChecker = proxyquire('../../../../app/service/case-access-checker', {
      '../util/fetch': fetch,
    })(config);
  });

  it('should call CCD once for each unique case id', async () => {
    await caseAccessChecker.assertUserHasAccess(['111', '222', '111'], 'Bearer token');

    expect(fetch).to.have.been.calledTwice;
    expect(fetch.firstCall).to.have.been.calledWith('https://ccd.local/cases/111', {
      headers: {
        Authorization: 'Bearer token',
      },
    });
    expect(fetch.secondCall).to.have.been.calledWith('https://ccd.local/cases/222', {
      headers: {
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

    expect(fetch).not.to.have.been.called;
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

    expect(fetch).not.to.have.been.called;
  });
});
