const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { downloadFile } = require('../download-file');

test('download retries when the response body fails mid-stream', async () => {
    const filePath = path.join(os.tmpdir(), `smc-download-test-${process.pid}`);
    let attempts = 0;

    try {
        await downloadFile({ url: 'http://nas', sid: 'sid', did: 'did', synoToken: 'token' },
            123, filePath, {
                fetchResponse: async () => {
                    attempts++;
                    if(attempts === 1) {
                        return new Response(new ReadableStream({
                            start(controller) {
                                controller.enqueue(new TextEncoder().encode('partial'));
                                const error = new Error('connection reset');
                                error.code = 'ECONNRESET';
                                controller.error(error);
                            }
                        }), { headers: { 'content-type': 'application/octet-stream' } });
                    }
                    return new Response('complete', {
                        headers: { 'content-type': 'application/octet-stream' }
                    });
                },
                retry: {
                    retries: 1,
                    sleep: async () => {},
                    random: () => 0
                }
            });

        assert.equal(attempts, 2);
        assert.equal(fs.readFileSync(filePath, 'utf8'), 'complete');
    } finally {
        fs.rmSync(filePath, { force: true });
    }
});
