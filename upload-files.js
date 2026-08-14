const fs = require('fs');
const axios = require('axios');
const { SynologyApiError, httpSettings, withRetry } = require('./http-retry');

async function uploadFiles(session, unitId, filePaths, options = {}) {
    const postForm = options.postForm ?? axios.postForm;
    await withRetry(async () => {
        const streams = [];
        const form = {
            api: 'SYNO.Foto.Upload.ConvertedFile',
            version: 3,
            method: 'upload',
            unit_id: unitId
        };
        for(const name in filePaths) {
            const stream = fs.createReadStream(filePaths[name]);
            streams.push(stream);
            form[name] = stream;
        }
        try {
            const res = await postForm(session.url+'/webapi/entry.cgi', form, {
                timeout: httpSettings.transferTimeoutMs,
                headers: {
                    'X-Syno-Token': session.synoToken,
                    'Cookie': `did=${session.did}; id=${session.sid}`
                }
            });
            if(!res.data.success) {
                throw new SynologyApiError(`Upload of file ${unitId} failed`, res.data.error);
            }
        } finally {
            streams.forEach(stream => stream.destroy());
        }
    }, {
        label: `Upload of file ${unitId}`,
        ...options.retry
    });
}

module.exports = { uploadFiles };
