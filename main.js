const fs = require('fs');
const readline = require('readline');
const childProcess = require('child_process');
const { downloadFile } = require('./download-file');
const { acquireInstanceLock } = require('./instance-lock');
const {
    SynologyApiError,
    fetchJsonWithRetry
} = require('./http-retry');
const { uploadFiles } = require('./upload-files');
const {
    fastVideoThumbnailArgs,
    fullVaapiVideoArgs,
    softwareVideoArgs,
    vaapiEncodeVideoArgs
} = require('./video-conversion');
const config = require('./config.json');

const videoThumbnailStrategy = process.env.VIDEO_THUMBNAIL_STRATEGY ?? 'best';
if(!['best', 'fast'].includes(videoThumbnailStrategy)) {
    throw new Error(`Invalid VIDEO_THUMBNAIL_STRATEGY "${videoThumbnailStrategy}"; expected "best" or "fast".`);
}

async function login(account) {
    const session = { url: account.url };
    const res = await fetchJsonWithRetry(account.url+'/webapi/entry.cgi', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            api: 'SYNO.API.Auth',
            version: 7,
            method: 'login',
            enable_syno_token: 'yes',
            enable_device_token: 'yes',
            format: 'sid',
            device_name: 'SynologyMediaConverter',
            device_id: account.deviceId || '',
            account: account.username,
            passwd: account.password,
            otp_code: account.otpCode || ''
        })
    }, 'Login');
    if(!res.success) {
        if(res.error.code == 403) {
            session.requireOtp = true;
            return session;
        } else {
            throw new SynologyApiError('Authentication failed', res.error);
        }
    }

    session.did = res.data.device_id;
    session.sid = res.data.sid;
    session.synoToken = res.data.synotoken;
    return session;
}

async function checkConversionNeeded(session) {
    const res = await fetchJsonWithRetry(session.url+'/webapi/entry.cgi', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Syno-Token': session.synoToken,
            'Cookie': `did=${session.did}; id=${session.sid}`
        },
        body: new URLSearchParams({
            api: 'SYNO.Foto.Upload.ConvertedFile',
            version: 3,
            method: 'list_convert_needed',
            type: '["photo","video","live_video"]',
            preset: 'windows'
        })
    }, 'Conversion list request');
    if(!res.success) throw new SynologyApiError('Requesting conversion needed failed', res.error);
    return res.data.list;
}

async function setBroken(session, unitId) {
    if(process.env.EXIT_ON_FAIL == 'true') {
        throw new Error('Exit on broken file is enabled.');
    }

    const res = await fetchJsonWithRetry(session.url+'/webapi/entry.cgi?'+new URLSearchParams({
        api: 'SYNO.Foto.Upload.ConvertedFile',
        version: 3,
        method: 'set_broken',
        id: '['+unitId+']',
        type: '["photo","video"]' // TODO: only set affacted types broken
    }), {
        headers: {
            'X-Syno-Token': session.synoToken,
            'Cookie': `did=${session.did}; id=${session.sid}`
        }
    }, `Marking file ${unitId} as broken`);
    if(!res.success) {
        throw new SynologyApiError(`Marking file ${unitId} as broken failed`, res.error);
    }
}

function executeCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = childProcess.spawn(cmd, args);
        //console.log(cmd, args.join(' '));

        let buffer = '', errbuffer = '';
        proc.stdout.on('data', data => buffer += data);
        proc.stderr.on('data', data => errbuffer += data);

        proc.on('close', code => {
            if(code != 0) {
                reject(new Error(errbuffer.trim()));
                return;
            }
            resolve(buffer);
        });
        proc.on('error', err => reject(new Error(err)));
    });
}

async function processVideo(srcPath, needThumbnails, needVideo) {
    // Sizes (fit short edge): SM 240    M 320    XL 1280    H264 720
    let dimensions = await executeCommand('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'flat', srcPath]);
    dimensions = {
        width: dimensions.match(/width=(.+)/)[1],
        height: dimensions.match(/height=(.+)/)[1],
        rotation: dimensions.match(/rotation=(.+)/)?.[1],
    };
    if(dimensions.rotation == '90' || dimensions.rotation == '-90') {
        [dimensions.width, dimensions.height] = [dimensions.height, dimensions.width];
        delete dimensions.rotation;
    }
    const landscape = dimensions.width > dimensions.height;

    let thumbs = {};
    if(needVideo) thumbs['film_h264'] = 720;
    if(needThumbnails) {
        thumbs['thumb_sm'] = 240;
        thumbs['thumb_m'] = 320;
        thumbs['thumb_xl'] = 1280;
    }
    const fastThumbnailPath = srcPath.replace(/\..+$/, '')+'-thumbnail-source.jpg';
    let fastThumbnailCreated = false;
    try {
        for(const thumbType in thumbs) {
            const maxSize = thumbs[thumbType];
            const scale = landscape ? `'-2:min(${maxSize},ih)'` : `'min(${maxSize},iw):-2'`;
            let newPath = srcPath.replace(/\..+$/, '')+'-'+thumbType;

            if(thumbType != 'film_h264') {
                newPath += '.jpg';
                if(videoThumbnailStrategy == 'fast') {
                    if(!fastThumbnailCreated) {
                        await executeCommand('ffmpeg', fastVideoThumbnailArgs(srcPath, fastThumbnailPath));
                        fastThumbnailCreated = true;
                    }
                    await executeCommand('magick', ['convert', fastThumbnailPath, '-resize', `${maxSize}x${maxSize}^>`, newPath]);
                } else {
                    await executeCommand('ffmpeg', ['-v', 'error', '-y', '-i', srcPath, '-filter:v', 'thumbnail,scale='+scale, '-frames:v', '1', newPath]);
                }
            } else {
                newPath += '.mp4';
                let convertedWithVaapi = false;
                if(process.env.USE_VAAPI == 'true') {
                    try {
                        await executeCommand('ffmpeg', fullVaapiVideoArgs(srcPath, scale, newPath));
                        convertedWithVaapi = true;
                    } catch(err) {
                        console.warn('Full VAAPI conversion failed; retrying with software decoding:', err.message);
                        await fs.promises.rm(newPath, { force: true });
                    }

                    if(!convertedWithVaapi) {
                        try {
                            // Some common camera formats (for example HEVC 10-bit 4:2:2)
                            // cannot be decoded by older VAAPI devices. Decode and apply
                            // autorotation in software, then upload frames for accelerated
                            // scaling and H.264 encoding.
                            await executeCommand('ffmpeg', vaapiEncodeVideoArgs(srcPath, scale, newPath));
                            convertedWithVaapi = true;
                        } catch(err) {
                            console.warn('VAAPI encoding failed; retrying with software encoding:', err.message);
                            await fs.promises.rm(newPath, { force: true });
                        }
                    }
                }
                if(!convertedWithVaapi) {
                    await executeCommand('ffmpeg', softwareVideoArgs(srcPath, scale, newPath));
                }
            }
            thumbs[thumbType] = newPath;
        }
    } finally {
        await fs.promises.rm(fastThumbnailPath, { force: true });
    }
    return thumbs;
}

async function processImage(srcPath) {
    let thumbs = {
        thumb_sm: 240,
        thumb_m: 320,
        thumb_xl: 1280
    };

    for(const thumbType in thumbs) {
        const maxSize = thumbs[thumbType];
        let newPath = srcPath.replace(/\..+$/, '')+'-'+thumbType+'.jpg';
        await executeCommand('magick', ['convert', srcPath, '-resize', `${maxSize}x${maxSize}^>`, newPath]);
        thumbs[thumbType] = newPath;
    }
    return thumbs;
}

async function cleanupFiles(filePaths) {
    for(const path of Object.values(filePaths)) {
        await fs.promises.unlink(path);
    }
}

function readLine(prompt) {
    return new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(prompt, text => {
            rl.close();
            resolve(text);
        });
    });
}


(async () => {
    const instanceLock = await acquireInstanceLock();
    if(!instanceLock) {
        console.log('Another converter instance is already running, exiting');
        return;
    }

    if(!fs.existsSync('tmp')) {
        fs.mkdirSync('tmp');
    }

    try {
        for(const account of config.accounts) {
            console.log(`Logging in as ${account.username} on ${account.url}`);
            let session = await login(account);
            if(session.requireOtp) {
                account.otpCode = await readLine('Account requires 2FA, please enter OTP code: ');
                session = await login(account);
                delete account.otpCode;
            }
            if(!account.deviceId) {
                account.deviceId = session.did;
                fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
            }
            
            checkLoop: while(true) {
                console.log('Checking if conversion is needed');
                const conversionNeeded = await checkConversionNeeded(session);
                if(conversionNeeded.length == 0) {
                    console.log('Finished, no files for conversion left');
                    break;
                }
                
                for(const fileInfo of conversionNeeded) {
                    try {
                        console.log(`Converting file "${fileInfo.filename}" (${fileInfo.unit_id})`);
                        const srcPath = 'tmp/'+fileInfo.filename;
                        let filePaths = {};
                        
                        await downloadFile(session, fileInfo.unit_id, srcPath);
                        try {
                            switch(fileInfo.type) {
                                case 0:
                                    filePaths = await processImage(srcPath);
                                    break;
                                case 1:
                                    filePaths = await processVideo(srcPath, fileInfo.need_thumbnail, fileInfo.need_video);
                                    break;
                            }
                        } catch(err) {
                            console.error('Marking file as broken:', err);
                            await setBroken(session, fileInfo.unit_id);
                            continue;
                        }
                        await uploadFiles(session, fileInfo.unit_id, filePaths);
                        filePaths['src'] = srcPath;
                        await cleanupFiles(filePaths);
                    } catch(err) {
                        console.error(err);
                        break checkLoop;
                    }
                }
            }
        }
    } catch(err) {
        console.error(err);
    }

    // Clean up left temp files
    const files = fs.readdirSync('tmp');
    files.forEach(file => {
        fs.unlinkSync('tmp/'+file);
    });
})();
