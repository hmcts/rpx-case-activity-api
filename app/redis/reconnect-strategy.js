const config = require('config');

const DEFAULT_MIN_DELAY_MS = 5000;
const DEFAULT_MAX_DELAY_MS = 10000;
const RETRY_STEP_MS = 1000;

function getPositiveIntegerConfig(key, fallback) {
  if (!config.has(key)) {
    return fallback;
  }

  const value = Number.parseInt(config.get(key), 10);
  return value > 0 ? value : fallback;
}

function getReconnectBounds() {
  const minDelayMs = getPositiveIntegerConfig(
    'redis.reconnect.minDelayMs',
    DEFAULT_MIN_DELAY_MS
  );
  const configuredMaxDelayMs = getPositiveIntegerConfig(
    'redis.reconnect.maxDelayMs',
    DEFAULT_MAX_DELAY_MS
  );

  return {
    minDelayMs,
    maxDelayMs: Math.max(minDelayMs, configuredMaxDelayMs)
  };
}

function redisReconnectDelay(retries) {
  const retryCount = Math.max(Number.parseInt(retries, 10) || 1, 1);
  const { minDelayMs, maxDelayMs } = getReconnectBounds();
  // Keep Redis reconnect attempts periodic and bounded between the configured limits.
  const delayMs = minDelayMs + ((retryCount - 1) * RETRY_STEP_MS);

  return Math.min(delayMs, maxDelayMs);
}

module.exports = {
  redisReconnectDelay
};
