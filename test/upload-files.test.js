const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { uploadFiles } = require('../upload-files');

test('upload retries use fresh file streams', async () => {
    const filePath = path.join(os.tmpdir(), `smc-upload-test-${process.pid}`);
    fs.writeFileSync(filePath, 'thumbnail');
    const streams = [];
    let attempts = 0;

    try {
        await uploadFiles({ url: 'http://nas', sid: 'sid', did: 'did', synoToken: 'token' },
            123, { thumb_sm: filePath }, {
                postForm: async (_url, form) => {
                    streams.push(form.thumb_sm);
                    form.thumb_sm.resume();
                    await once(form.thumb_sm, 'end');
                    attempts++;
                    if(attempts === 1) {
                        const error = new Error('connection reset');
                        error.code = 'ECONNRESET';
                        throw error;
                    }
                    return { data: { success: true } };
                },
                retry: {
                    retries: 1,
                    sleep: async () => {},
                    random: () => 0
                }
            });
    } finally {
        fs.rmSync(filePath, { force: true });
    }

    assert.equal(attempts, 2);
    assert.notEqual(streams[0], streams[1]);
    assert.equal(streams[0].destroyed, true);
    assert.equal(streams[1].destroyed, true);
});
