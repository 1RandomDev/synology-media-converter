function softwareVideoArgs(srcPath, scale, destinationPath) {
    return ['-v', 'error', '-y', '-i', srcPath, '-filter:v', 'scale='+scale, '-c:v', 'h264', '-preset', 'slow', destinationPath];
}

function fullVaapiVideoArgs(srcPath, scale, destinationPath) {
    return [
        '-v', 'error', '-y',
        '-vaapi_device', '/dev/dri/renderD128',
        '-hwaccel', 'vaapi',
        '-hwaccel_output_format', 'vaapi',
        '-i', srcPath,
        '-filter:v', 'scale_vaapi='+scale,
        '-c:v', 'h264_vaapi',
        '-preset', 'slow',
        destinationPath
    ];
}

function vaapiEncodeVideoArgs(srcPath, scale, destinationPath) {
    return [
        '-v', 'error', '-y',
        '-vaapi_device', '/dev/dri/renderD128',
        '-i', srcPath,
        '-filter:v', 'format=nv12,hwupload,scale_vaapi='+scale,
        '-c:v', 'h264_vaapi',
        '-preset', 'slow',
        destinationPath
    ];
}

function fastVideoThumbnailArgs(srcPath, destinationPath) {
    return ['-v', 'error', '-y', '-i', srcPath, '-frames:v', '1', destinationPath];
}

module.exports = {
    fastVideoThumbnailArgs,
    fullVaapiVideoArgs,
    softwareVideoArgs,
    vaapiEncodeVideoArgs
};
