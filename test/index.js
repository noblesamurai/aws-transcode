const expect = require('chai').expect;
const AWS = require('aws-sdk');
const AWSMock = require('aws-sdk-mock');
const sinon = require('sinon');
const transcode = require('..');

const inputKey = 'input/test.avi';
const outputKey = 'output/test.mp4';
const jobBase = { Id: 'TESTID' };
const jobProgressing = { Status: 'Progressing' };
const jobComplete = { Status: 'Complete', Output: { Key: outputKey, DurationMillis: 123 } };
const jobError = { Status: 'Error', Output: { StatusDetail: 'ERRORDETAILS' } };
const jobCancelled = { Status: 'Canceled' };

describe('transcode', function () {
  beforeEach(function () {
    AWSMock.setSDKInstance(AWS);
  });

  afterEach(function () {
    AWSMock.restore();
  });

  it('should request and poll a transcoder job', async function () {
    const createJob = sinon.stub()
      .callsArgWith(1, null, { Job: jobBase });
    const readJob = sinon.stub()
      .onCall(0).callsArgWith(1, null, { Job: { ...jobBase, ...jobProgressing } })
      .onCall(1).callsArgWith(1, null, { Job: { ...jobBase, ...jobComplete } });
    AWSMock.mock('ElasticTranscoder', 'createJob', createJob);
    AWSMock.mock('ElasticTranscoder', 'readJob', readJob);

    const res = await transcode(
      inputKey,
      [{ key: outputKey, presetId: 'PRESETID' }],
      { pipelineId: 'PIPELINEID', pollInterval: 0, region: 'REGIONID' }
    );
    expect(res).to.equal(123);

    // check aws functions were called with the right params
    const expectedJobParams = {
      Input: { Key: inputKey },
      PipelineId: 'PIPELINEID',
      Outputs: [{ Key: outputKey, PresetId: 'PRESETID' }]
    };
    expect(createJob).to.have.been.calledWith(expectedJobParams).and.to.have.been.calledOnce();
    expect(readJob).to.have.been.calledWith(jobBase).and.to.have.been.calledTwice();
  });

  it('should throw an error', async function () {
    const createJob = sinon.stub()
      .callsArgWith(1, null, { Job: jobBase });
    const readJob = sinon.stub()
      .onCall(0).callsArgWith(1, null, { Job: { ...jobBase, ...jobProgressing } })
      .onCall(1).callsArgWith(1, null, { Job: { ...jobBase, ...jobError } });
    AWSMock.mock('ElasticTranscoder', 'createJob', createJob);
    AWSMock.mock('ElasticTranscoder', 'readJob', readJob);

    await expect(transcode(
      inputKey,
      [{ key: outputKey, presetId: 'PRESETID' }],
      { pipelineId: 'PIPELINEID', pollInterval: 0, region: 'REGIONID' }
    )).to.eventually.be.rejected(/ERRORDETAILS/);

    // check aws functions were called with the right params
    expect(createJob).to.have.been.calledOnce();
    expect(readJob).to.have.been.calledWith(jobBase).and.to.have.been.calledTwice();
  });

  it('should throw a cancelled error if job is cancelled', async function () {
    const createJob = sinon.stub()
      .callsArgWith(1, null, { Job: jobBase });
    const readJob = sinon.stub()
      .onCall(0).callsArgWith(1, null, { Job: { ...jobBase, ...jobProgressing } })
      .onCall(1).callsArgWith(1, null, { Job: { ...jobBase, ...jobCancelled } });
    AWSMock.mock('ElasticTranscoder', 'createJob', createJob);
    AWSMock.mock('ElasticTranscoder', 'readJob', readJob);

    await expect(transcode(
      inputKey,
      [{ key: outputKey, presetId: 'PRESETID' }],
      { pipelineId: 'PIPELINEID', pollInterval: 0, region: 'REGIONID' }
    )).to.eventually.be.rejected().with.property('code', 'CANCELLED');

    // check aws functions were called with the right params
    expect(createJob).to.have.been.calledOnce();
    expect(readJob).to.have.been.calledWith(jobBase).and.to.have.been.calledTwice();
  });

  it('should return "progressing" status updates', async function () {
    const createJob = sinon.stub()
      .callsArgWith(1, null, { Job: jobBase });
    const readJob = sinon.stub()
      .onCall(0).callsArgWith(1, null, { Job: { ...jobBase, ...jobProgressing } })
      .onCall(1).callsArgWith(1, null, { Job: { ...jobBase, ...jobProgressing } })
      .onCall(2).callsArgWith(1, null, { Job: { ...jobBase, ...jobComplete } });
    AWSMock.mock('ElasticTranscoder', 'createJob', createJob);
    AWSMock.mock('ElasticTranscoder', 'readJob', readJob);

    const statusEvents = [];
    const onProgress = status => statusEvents.push(status);
    const res = await transcode(
      inputKey,
      [{ key: outputKey, presetId: 'PRESETID' }],
      { onProgress, pipelineId: 'PIPELINEID', pollInterval: 0, region: 'REGIONID' }
    );
    expect(res).to.equal(123);

    // check aws functions were called with the right params
    expect(createJob).to.have.been.calledOnce();
    expect(readJob).to.have.been.calledWith(jobBase).and.to.have.been.calledThrice();
    expect(statusEvents).to.deep.equal([{ status: 'Progressing' }, { status: 'Progressing' }]);
  });

  it('should check if the output exists already', async function () {
    const createJob = sinon.stub();
    const headObject = sinon.stub().callsArgWith(1, undefined, 'HEADRESPONSE');
    AWSMock.mock('ElasticTranscoder', 'createJob', createJob);
    AWSMock.mock('S3', 'headObject', headObject);

    const res = await transcode(
      inputKey,
      [{ key: outputKey, presetId: 'PRESETID' }],
      { checkExistsInBucket: 'BUCKET', pipelineId: 'PIPELINEID', pollInterval: 0, region: 'REGIONID' }
    );
    expect(res).to.be.false(); // nothing transcoded.

    // check aws functions were called with the right params
    expect(headObject).to.have.been.called();
    expect(createJob).not.to.have.been.calledOnce();
  });

  it('should continue if the output does not exist', async function () {
    const createJob = sinon.stub()
      .callsArgWith(1, null, { Job: jobBase });
    const readJob = sinon.stub()
      .onCall(0).callsArgWith(1, null, { Job: { ...jobBase, ...jobProgressing } })
      .onCall(1).callsArgWith(1, null, { Job: { ...jobBase, ...jobComplete } });
    const headObject = sinon.stub().callsArgWith(1, new Error('not found'));
    AWSMock.mock('ElasticTranscoder', 'createJob', createJob);
    AWSMock.mock('ElasticTranscoder', 'readJob', readJob);
    AWSMock.mock('S3', 'headObject', headObject);

    const res = await transcode(
      inputKey,
      [{ key: outputKey, presetId: 'PRESETID' }],
      { checkExistsInBucket: 'BUCKET', pipelineId: 'PIPELINEID', pollInterval: 0, region: 'REGIONID' }
    );
    expect(res).to.equal(123);

    // check aws functions were called with the right params
    const expectedJobParams = {
      Input: { Key: inputKey },
      PipelineId: 'PIPELINEID',
      Outputs: [{ Key: outputKey, PresetId: 'PRESETID' }]
    };
    expect(headObject).to.have.been.called();
    expect(createJob).to.have.been.calledWith(expectedJobParams).and.to.have.been.calledOnce();
    expect(readJob).to.have.been.calledWith(jobBase).and.to.have.been.calledTwice();
  });

  it('should request thumbnails with a thumbnail pattern', async function () {
    const createJob = sinon.stub()
      .callsArgWith(1, null, { Job: jobBase });
    const readJob = sinon.stub()
      .onCall(0).callsArgWith(1, null, { Job: { ...jobBase, ...jobProgressing } })
      .onCall(1).callsArgWith(1, null, { Job: { ...jobBase, ...jobComplete } });
    AWSMock.mock('ElasticTranscoder', 'createJob', createJob);
    AWSMock.mock('ElasticTranscoder', 'readJob', readJob);

    const res = await transcode(
      inputKey,
      [{ key: outputKey, presetId: 'PRESETID', thumbnailPattern: 'output/video_thumb_[count]' }],
      { pipelineId: 'PIPELINEID', pollInterval: 0, region: 'REGIONID' }
    );
    expect(res).to.equal(123);

    // check aws functions were called with the right params
    const expectedJobParams = {
      Input: { Key: inputKey },
      PipelineId: 'PIPELINEID',
      Outputs: [{ Key: outputKey, PresetId: 'PRESETID', ThumbnailPattern: 'output/video_thumb_[count]' }]
    };
    expect(createJob).to.have.been.calledWith(expectedJobParams).and.to.have.been.calledOnce();
    expect(readJob).to.have.been.calledWith(jobBase).and.to.have.been.calledTwice();
  });
});
