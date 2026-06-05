const logger = require('./logger');

async function withRetry(fn, { attempts = 3, delayMs = 1000, label = 'operation' } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const wait = delayMs * i;
        logger.warn(`${label} failed, retrying`, { attempt: i, attempts, wait, error: err.message });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

module.exports = { withRetry };
