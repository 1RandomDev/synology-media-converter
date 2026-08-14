const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);
const RETRYABLE_ERROR_CODES = new Set([
    'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
    'ENETDOWN', 'ENETUNREACH', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT',
    'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'
]);

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const httpSettings = Object.freeze({
    apiTimeoutMs: positiveInteger(process.env.API_TIMEOUT_MS, 30_000),
    transferTimeoutMs: positiveInteger(process.env.TRANSFER_TIMEOUT_MS, 30 * 60_000),
    retries: positiveInteger(process.env.HTTP_RETRIES, 3),
    retryBaseDelayMs: positiveInteger(process.env.RETRY_BASE_DELAY_MS, 1_000),
    retryMaxDelayMs: positiveInteger(process.env.RETRY_MAX_DELAY_MS, 30_000)
});

function retryAfterMs(value) {
    if(!value) return null;
    const seconds = Number(value);
    if(Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

class HttpStatusError extends Error {
    constructor(status, statusText, retryAfter) {
        super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
        this.name = 'HttpStatusError';
        this.status = status;
        this.retryAfterMs = retryAfterMs(retryAfter);
    }

    static fromResponse(response) {
        return new HttpStatusError(
            response.status,
            response.statusText,
            response.headers.get('retry-after')
        );
    }
}

class SynologyApiError extends Error {
    constructor(message, error) {
        super(`${message} with error ${JSON.stringify(error)}`);
        this.name = 'SynologyApiError';
        this.synologyError = error;
    }
}

function isRetryableError(error) {
    if(error instanceof HttpStatusError) {
        return RETRYABLE_STATUS_CODES.has(error.status) || error.status >= 500;
    }
    if(error?.response?.status) {
        const status = error.response.status;
        return RETRYABLE_STATUS_CODES.has(status) || status >= 500;
    }
    if(error?.cause && isRetryableError(error.cause)) return true;
    return error?.name === 'AbortError' ||
        error?.name === 'TimeoutError' ||
        RETRYABLE_ERROR_CODES.has(error?.code);
}

function errorRetryAfterMs(error) {
    if(error.retryAfterMs != null) return error.retryAfterMs;
    return retryAfterMs(error?.response?.headers?.['retry-after']);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(operation, options = {}) {
    const retries = options.retries ?? httpSettings.retries;
    const baseDelayMs = options.baseDelayMs ?? httpSettings.retryBaseDelayMs;
    const maxDelayMs = options.maxDelayMs ?? httpSettings.retryMaxDelayMs;
    const random = options.random ?? Math.random;
    const wait = options.sleep ?? sleep;
    const label = options.label ?? 'Request';

    for(let attempt = 0; ; attempt++) {
        try {
            return await operation(attempt);
        } catch(error) {
            if(attempt >= retries || !isRetryableError(error)) throw error;

            const retryNumber = attempt + 1;
            const backoff = Math.min(maxDelayMs, baseDelayMs * (2 ** (retryNumber - 1)));
            const jitteredBackoff = Math.round(backoff / 2 + random() * backoff / 2);
            const requestedDelay = errorRetryAfterMs(error);
            const delay = requestedDelay == null
                ? jitteredBackoff
                : Math.max(jitteredBackoff, requestedDelay);
            console.warn(
                `${label} failed (${error.message}); retrying in ${delay}ms `+
                `(attempt ${retryNumber + 1}/${retries + 1})`
            );
            await wait(delay);
        }
    }
}

async function fetchResponse(url, options, timeoutMs) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs)
    });
    if(!response.ok) throw HttpStatusError.fromResponse(response);
    return response;
}

async function fetchJsonWithRetry(url, options, label) {
    return withRetry(async () => {
        const response = await fetchResponse(url, options, httpSettings.apiTimeoutMs);
        try {
            return await response.json();
        } catch(error) {
            // Treat a truncated JSON response as a failed network transfer.
            if(error instanceof SyntaxError) error.code = 'ECONNRESET';
            throw error;
        }
    }, { label });
}

module.exports = {
    HttpStatusError,
    SynologyApiError,
    fetchJsonWithRetry,
    fetchResponse,
    httpSettings,
    isRetryableError,
    withRetry
};
