const abind = require('abind');
const AWS = require('aws-sdk');
const debug = require('debug')('aws-transcode');
const delay = require('delay');

class AwsTranscoder {
  /**
   * Constructor.
   *
   * @param {string} [config.checkExistsInBucket] if set we will check if an output already
   *   exists in the specified bucket. We need the bucket since it is built into the pipeline id and
   *   not available here.
   * @param {function} config.onProgress function to get very basic update events
   * @param {string} config.pipelineId aws transcode pipeline to use
   * @param {number} config.pollInterval time between polling for updates
   * @param {string} config.region region to use for transcoding
   */
  constructor (config = {}) {
    const { region = 'us-east-1' } = config;
    abind(this);
    this.config = config;
    this.elastictranscoder = new AWS.ElasticTranscoder({ region });
    this.s3 = new AWS.S3({ signatureVersion: 'v4' });
  }

  /**
   * Transcode a media file that has already been uploaded to s3.
   *
   * @param {object} input
   *   {string} key input key
   *   {number} start optional defaults to 0
   *   {number} duration optional defaults to duration of input file
   * @param {object[]} outputs an array of outputs { key, presetId, thumbnailPattern }
   *   {string} key output key (bucket is defined in the pipeline)
   *   {string} presetId aws transcoding preset to be used
   *   {string} thumbnailPattern (optional) thumbnail pattern string
   * @return {false|number} false if there was nothing to transcode, or the duration of the
   *   transcoded video if successful
   * @throws Error
   */
  async transcode (input, outputs) {
    const filteredOutputs = await this.maybeRemoveExistingOutputs(outputs);
    if (!filteredOutputs.length) return false;
    const jobId = await this.createTranscoderJob(input, filteredOutputs);
    return this.waitForTranscoderJob(input.key, jobId);
  }

  /**
   * Check and remove any existing outputs.
   *
   * @param {object[]} outputs
   * @return {object[]}
   */
  async maybeRemoveExistingOutputs (outputs) {
    return outputs.reduce(async (acc, output) => {
      return (await this.checkExists(output)) ? acc : [...(await acc), output];
    }, []);
  }

  /**
   * Check if an output already exists or not.
   *
   * @param {string} output.key output key (bucket is defined in the pipeline)
   * @return {boolean}
   */
  async checkExists (output) {
    const { checkExistsInBucket } = this.config;
    if (!checkExistsInBucket) return false;
    try {
      await this.s3.headObject({ Bucket: checkExistsInBucket, Key: output.key }).promise();
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Create a new transcoder job.
   *
   * @param {string} key
   * @param {object[]} outputs an array of outputs { key, presetId, thumbnailPattern }
   *   {string} key output key (bucket is defined in the pipeline)
   *   {string} presetId aws transcoding preset to be used
   *   {string} thumbnailPattern (optional) thumbnail pattern string
   * @return {string}
   */
  async createTranscoderJob (input, outputs) {
    const { key, start = 0, duration } = input;
    const { pipelineId } = this.config;
    const params = {
      Input: {
        Key: key,
        ...((start > 0 || duration) && {
          TimeSpan: {
            ...(start > 0 && { StartTime: Number(start).toFixed(3) }),
            ...(duration && { Duration: Number(duration).toFixed(3) })
          }
        })
      },
      PipelineId: pipelineId,
      Outputs: outputs.map(({ key, presetId, thumbnailPattern }) => ({
        Key: key,
        PresetId: presetId,
        ...(thumbnailPattern && { ThumbnailPattern: thumbnailPattern })
      }))
    };
    debug('creating elastic transcoder job', params);
    const { Job: { Id: jobId } = {} } = await this.elastictranscoder.createJob(params).promise();
    return jobId;
  }

  /**
   * Wait for the transcription job to complete.
   *
   * @param {string} key
   * @param {string} jobId
   * @return {number} duration of the transcoded video.
   * @throws Error
   */
  async waitForTranscoderJob (key, jobId) {
    const { pollInterval = 2000 } = this.config;
    while (true) {
      await delay(pollInterval);
      const status = await this.checkJobStatus(key, jobId);
      if (status !== false) return status;
    }
  }

  /**
   * Check the current job status.
   *
   * @param {string} key
   * @param {string} jobId
   * @return {false|number} false if not done, otherwise the duration of the transcoded video.
   * @throws Error
   */
  async checkJobStatus (key, jobId) {
    const { onProgress } = this.config;
    const { Job: job } = await this.elastictranscoder.readJob({ Id: jobId }).promise();
    const { Status: status, Output: output = {} } = job;
    const { DurationMillis: duration, StatusDetail: statusDetails } = output;

    switch (status) {
      case 'Error':
        throw new Error(`Transcode failed for "${key}"${statusDetails ? `\n${statusDetails}` : ''}`);
      case 'Canceled': {
        const err = new Error(`Transcode cancelled for "${key}".`);
        err.code = 'CANCELLED';
        throw err;
      }
      case 'Complete':
        return duration;
      default:
        // send progress event
        if (typeof onProgress === 'function') onProgress({ status });
        return false;
    }
  }
}

async function transcode (input, outputs, config) {
  if (typeof input === 'string') {
    input = { key: input };
  }
  const transcoder = new AwsTranscoder(config);
  return transcoder.transcode(input, outputs);
}

module.exports = transcode;
