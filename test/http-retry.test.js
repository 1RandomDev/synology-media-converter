const assert = require('node:assert/strict');
const test = require('node:test');
const {
    HttpStatusError,
    SynologyApiError,
    isRetryableError,
    withRetry
} = require('../http-retry');

test('retries transient failures three times with exponential jittered backoff', async () => {
    const delays = [];
    let attempts = 0;

    await assert.rejects(() => withRetry(async () => {
        attempts++;
        const error = new Error('connection reset');
        error.code = 'ECONNRESET';
        throw error;
    }, {
        retries: 3,
        baseDelayMs: 1_000,
        maxDelayMs: 30_000,
        random: () => 0,
        sleep: async delay => delays.push(delay)
    }));

    assert.equal(attempts, 4);
    assert.deepEqual(delays, [500, 1_000, 2_000]);
});

test('does not retry permanent HTTP or Synology API errors', async () => {
    for(const error of [
        new HttpStatusError(400, 'Bad Request'),
        new SynologyApiError('DSM rejected request', { code: 400 })
    ]) {
        let attempts = 0;
        await assert.rejects(() => withRetry(async () => {
            attempts++;
            throw error;
        }, { retries: 3, sleep: async () => {} }));
        assert.equal(attempts, 1);
    }
});

test('retries rate limits, server failures, and timeouts', () => {
    assert.equal(isRetryableError(new HttpStatusError(429, 'Too Many Requests')), true);
    assert.equal(isRetryableError(new HttpStatusError(503, 'Unavailable')), true);
    assert.equal(isRetryableError(Object.assign(new Error(), { name: 'TimeoutError' })), true);
    assert.equal(isRetryableError(Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error(), { code: 'UND_ERR_SOCKET' })
    })), true);
});
