# aws-transcode

> A simple wrapper to transcoding with AWS elastic transcoder.

## Installation

This module is installed via npm:

``` bash
$ npm install aws-transcode
```

## Usage

```js
const transcode = require('aws-transcode');
const input = 'input/video.mp4';
const outputs = [
  {
    key: 'output/video_1080p.mp4',
    presetId: '1351620000001-000001',
    thumbnailPattern: 'output/video_{count}'
  },
  {
    key: 'output/video_preview_360p.mp4',
    presetId: '1351620000001-000040'
  }
];
const config = {
  checkExistsInBucket: 'OPTIONALLY_CHECK_IN_THIS_BUCKET',
  onProgress: status => console.log(status),
  pipelineId: 'REPLACE_WITH_YOUR_PIPELINE_ID',
  pollInterval: 2000, // get status updates every 2 seconds
  region: 'us-east-1'
};

const res = await transcode(input, outputs, config);

if (res === false) {
  // res will be false if there was nothing to be transcoded (ie. no outputs were
  // passed in or all outputs already exist in the `checkExistsInBucket` bucket.
} else {
  // res will be the duration of the transcoded video in ms.
}
```

### Extracting a part of the input file.

The `input` can also be an object with a `key` (required) and `start`, `duration` values (optional).

```js
const input = { key: 'input/video.mp4', start: 5, duration: 10 };
const res = await transcode(input, outputs, config);
```

## License

The BSD License

Copyright (c) 2020, Andrew Harris

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this
  list of conditions and the following disclaimer in the documentation and/or
  other materials provided with the distribution.

* Neither the name of the Andrew Harris nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
