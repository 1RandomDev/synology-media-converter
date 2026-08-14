const fs = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const {
    SynologyApiError,
    fetchResponse,
    httpSettings,
    withRetry
} = require('./http-retry');

async function downloadFile(session, unitId, savePath, options = {}) {
    const request = options.fetchResponse ?? fetchResponse;
    await withRetry(async () => {
        await fs.promises.rm(savePath, { force: true });
        const res = await request(session.url+'/webapi/entry.cgi?'+new URLSearchParams({
            api: 'SYNO.Foto.Download',
            version: 1,
            method: 'download',
            unit_id: '['+unitId+']'
        }), {
            headers: {
                'X-Syno-Token': session.synoToken,
                'Cookie': `did=${session.did}; id=${session.sid}`
            }
        }, httpSettings.transferTimeoutMs);
        if(res.headers.get('content-type')?.includes('json')) {
            const data = await res.json();
            if(!data.success) {
                throw new SynologyApiError(`Download of file ${unitId} failed`, data.error);
            }
            return;
        }
        await pipeline(
            Readable.fromWeb(res.body),
            fs.createWriteStream(savePath, { flags: 'w' })
        );
    }, {
        label: `Download of file ${unitId}`,
        ...options.retry
    });
}

module.exports = { downloadFile };
