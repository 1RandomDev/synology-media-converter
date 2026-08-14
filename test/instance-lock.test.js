const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { acquireInstanceLock } = require('../instance-lock');

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

test('only one process can hold an instance lock', async () => {
    const lockName = path.join(os.tmpdir(), `smc-lock-test-${process.pid}.sock`);
    const first = await acquireInstanceLock(lockName);

    try {
        assert.ok(first);
        assert.equal(await acquireInstanceLock(lockName), null);
    } finally {
        await close(first);
    }

    const next = await acquireInstanceLock(lockName);
    assert.ok(next);
    await close(next);
});
