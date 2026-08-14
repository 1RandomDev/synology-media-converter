const net = require('net');
const os = require('os');
const path = require('path');

const DEFAULT_LOCK_NAME = process.platform === 'linux'
    ? '\0synology-media-converter'
    : path.join(os.tmpdir(), 'synology-media-converter.sock');

function acquireInstanceLock(lockName = DEFAULT_LOCK_NAME) {
    return new Promise((resolve, reject) => {
        const lock = net.createServer();

        lock.once('error', err => {
            if(err.code == 'EADDRINUSE') {
                resolve(null);
                return;
            }
            reject(err);
        });

        lock.listen(lockName, () => {
            // The lock should not keep Node alive after conversion work finishes.
            lock.unref();
            resolve(lock);
        });
    });
}

module.exports = { acquireInstanceLock };
