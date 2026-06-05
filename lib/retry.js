const logger = require('./logger');

// HTTP status codes that are permanent failures — retrying them is guaranteed
// to fail again and wastes time, quota, and log noise
function isPermanentFailure(err) {
  const status = err.status ?? err.code ?? err.response?.status;
  if (typeof status === 'number') {
    // 4xx errors except 429 (rate limit) are permanent auth/client errors
    return status >= 400 && status < 500 && status !== 429;
  }
  return false;
}

// Exponential backoff with jitter: base * 2^attempt + random(0, 200ms)
function backoff(base, attempt) {
  return base * Math.pow(2, attempt - 1) + Math.random() * 200;
}

async function withRetry(fn, { attempts = 3, delayMs = 1000, label = 'operation' } = {}) {
  let lastErr;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      if (isPermanentFailure(err)) {
        logger.error(`${label} failed with permanent error — will not retry`, {
          attempt: i,
          status: err.status ?? err.response?.status,
          error: err.message,
        });
        throw err;
      }

      if (i < attempts) {
        const wait = Math.round(backoff(delayMs, i));
        logger.warn(`${label} failed, retrying`, { attempt: i, attempts, waitMs: wait, error: err.message });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  throw lastErr;
}

module.exports = { withRetry };
