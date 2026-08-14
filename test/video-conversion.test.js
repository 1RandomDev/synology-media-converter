const assert = require('node:assert/strict');
const test = require('node:test');
const {
    fastVideoThumbnailArgs,
    fullVaapiVideoArgs,
    softwareVideoArgs,
    vaapiEncodeVideoArgs
} = require('../video-conversion');

test('full VAAPI conversion keeps decoding, scaling, and encoding in hardware', () => {
    const args = fullVaapiVideoArgs('input.mov', "'-2:min(720,ih)'", 'output.mp4');

    assert.equal(args[args.indexOf('-hwaccel') + 1], 'vaapi');
    assert.equal(args[args.indexOf('-hwaccel_output_format') + 1], 'vaapi');
    assert.equal(args[args.indexOf('-filter:v') + 1], "scale_vaapi='-2:min(720,ih)'");
    assert.equal(args[args.indexOf('-c:v') + 1], 'h264_vaapi');
});

test('VAAPI encoding fallback decodes in software before uploading frames', () => {
    const args = vaapiEncodeVideoArgs('input.mov', "'-2:min(720,ih)'", 'output.mp4');

    assert.equal(args.includes('-hwaccel'), false);
    assert.deepEqual(args.slice(3, 5), ['-vaapi_device', '/dev/dri/renderD128']);
    assert.equal(args[args.indexOf('-filter:v') + 1], "format=nv12,hwupload,scale_vaapi='-2:min(720,ih)'");
    assert.equal(args[args.indexOf('-c:v') + 1], 'h264_vaapi');
});

test('software fallback uses the software scaler and H.264 encoder', () => {
    const args = softwareVideoArgs('input.mov', "'-2:min(720,ih)'", 'output.mp4');

    assert.equal(args[args.indexOf('-filter:v') + 1], "scale='-2:min(720,ih)'");
    assert.equal(args[args.indexOf('-c:v') + 1], 'h264');
});

test('fast video thumbnails decode only the first frame', () => {
    const args = fastVideoThumbnailArgs('input.mov', 'thumbnail-source.jpg');

    assert.deepEqual(args, [
        '-v', 'error', '-y', '-i', 'input.mov',
        '-frames:v', '1', 'thumbnail-source.jpg'
    ]);
    assert.equal(args.includes('-filter:v'), false);
});
