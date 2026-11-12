const { expect } = require('chai');
const sinon = require('sinon');
const createGetActivities = require('../../../../app/routes/get-activities');
const createAddActivity = require('../../../../app/routes/add-activity');

describe('activity routes authorization failures', () => {
  [403, 502].forEach((status) => {
    ['getActivities', 'addActivity'].forEach((method) => {
      it(`preserves the ${status} error from ${method} for the Express error handler`, async () => {
        const error = Object.assign(new Error('Unable to access case'), { status });
        const service = { [method]: sinon.stub().rejects(error) };
        const route = method === 'getActivities'
          ? createGetActivities(service) : createAddActivity(service);
        const request = {
          params: { caseid: '111', caseids: '111' },
          body: { activity: 'view' },
          authentication: { user: { uid: 'user-1' }, token: 'Bearer token' }
        };
        const response = { status: sinon.spy(), json: sinon.spy() };
        const nextError = await new Promise((resolve) => route(request, response, resolve));
        expect(nextError).to.equal(error);
        expect(nextError.status).to.equal(status);
        expect(response.json.called).to.equal(false);
      });
    });
  });
});
