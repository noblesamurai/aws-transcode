const AWS = require('aws-sdk');
const debug = require('debug')('transcode');
const delay = require('delay');
const s3 = new AWS.S3({ signatureVersion: 'v4' });

/**
 * Transcode a media file that has already been uploaded to s3.
 *
 * @param {string} key
 * @param {object[]} outputs an array of outputs { key, presetId, thumbnailPattern }
 *   {string} key output key (bucket is defined in the pipeline)
 *   {string} presetId aws transcoding preset to be used
 *   {string} thumbnailPattern (optional) thumbnail pattern string
 * @param {string} config.checkExistsInBucket (optional) if set we will check if an output already
 *   exists in the specified bucket. We need the bucket since it is built into the pipeline id and
 *   not available here.
 * @param {function} config.onProgress function to get very basic update events
 * @param {string} config.pipelineId aws transcode pipeline to use
 * @param {number} config.pollInterval time between polling for updates
 * @param {string} config.region region to use for transcoding
 * @return {false|number} false if there was nothing to transcode, or the duration of the
 *   transcoded video if successful
 * @throws Error
 */
async function transcode (key, outputs, config) {
  const {
    checkExistsInBucket,
    onProgress,
    pipelineId,
    pollInterval = 2000,
    region = 'us-east-1'
  } = config;
  const elastictranscoder = new AWS.ElasticTranscoder({ region });
  const filteredOutputs = checkExistsInBucket
    ? await outputs.reduce(async (acc, output) => await checkExists(output) ? acc : [...acc, output], [])
    : outputs;
  if (!filteredOutputs.length) return false;
  const jobId = await createTranscoderJob(key, outputs);
  return waitForTranscoderJob(jobId);

  /**
   * Check if an output already exists or not.
   *
   * @param {string} output.key output key (bucket is defined in the pipeline)
   * @return {boolean}
   */
  async function checkExists (output) {
    try {
      await s3.headObject({ Bucket: checkExistsInBucket, Key: output.key }).promise();
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
  async function createTranscoderJob (key, outputs) {
    const params = {
      Input: { Key: key },
      PipelineId: pipelineId,
      Outputs: outputs.map(({ key, presetId, thumbnailPattern }) => ({
        Key: key,
        PresetId: presetId,
        ...(thumbnailPattern && { ThumbnailPattern: thumbnailPattern })
      }))
    };
    debug('creating elastic transcoder job', params);
    const { Job: { Id: jobId } = {} } = await elastictranscoder.createJob(params).promise();
    return jobId;
  }

  /**
   * Wait for the transcription job to complete.
   *
   * @param {string} jobId
   * @return {number} duration of the transcoded video.
   * @throws Error
   */
  async function waitForTranscoderJob (jobId) {
    while (true) {
      await delay(pollInterval);
      const { Job: job } = await elastictranscoder.readJob({ Id: jobId }).promise();
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
      }
    }
  }
}

module.exports = transcode;
