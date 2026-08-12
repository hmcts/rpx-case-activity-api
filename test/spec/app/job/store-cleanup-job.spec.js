const EventEmitter = require('events');
const expect = require('chai').expect;
const proxyquire = require('proxyquire').noCallThru();

describe('store cleanup job', () => {
  let streams;
  let pipelineCalls;
  let cleanupJob;

  beforeEach(() => {
    streams = [];
    pipelineCalls = [];

    const redis = {
      scanStream: () => {
        const stream = new EventEmitter();
        streams.push(stream);
        return stream;
      },
      pipeline: (commands) => {
        pipelineCalls.push(commands);
        return { exec: () => Promise.resolve([]) };
      },
      logPipelineFailures: () => undefined
    };

    cleanupJob = proxyquire('../../../../app/job/store-cleanup-job', {
      '../redis/redis-client': redis,
      'node-cron': {
        validate: () => true,
        schedule: () => undefined
      }
    });
  });

  it('contains Redis scan errors instead of crashing the application', async () => {
    const cleanup = cleanupJob.force();

    expect(streams).to.have.lengthOf(2);
    streams.forEach((stream) => stream.emit('error', new Error('Redis unavailable')));

    await cleanup;
    expect(pipelineCalls).to.have.lengthOf(0);
  });

  it('does not start overlapping scans while cleanup is running', async () => {
    const firstCleanup = cleanupJob.force();
    const overlappingCleanup = cleanupJob.force();

    expect(overlappingCleanup).to.equal(firstCleanup);
    expect(streams).to.have.lengthOf(2);
    streams.forEach((stream) => stream.emit('end'));

    await firstCleanup;
    expect(pipelineCalls).to.have.lengthOf(0);
  });
});
