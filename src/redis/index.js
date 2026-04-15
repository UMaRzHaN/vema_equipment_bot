'use strict';

const Redis = require('ioredis');
const { config } = require('../config');
const logger = require('../utils/logger');

/**
 * Factory for Redis clients.
 *
 * Retry strategy: exponential back-off capped at 10 s.
 * We never return null — Redis going down temporarily should not crash the process.
 * The only time we give up is if the instance has been explicitly quit().
 */
function createRedisClient(overrides = {}) {
  const opts = {
    host:                 config.redis.host,
    port:                 config.redis.port,
    password:             config.redis.password || undefined,
    db:                   config.redis.db,
    lazyConnect:          true,
    maxRetriesPerRequest: null,   // Required by BullMQ
    enableReadyCheck:     true,
    connectTimeout:       10_000, // 10 s connection timeout
    commandTimeout:       5_000,  // 5 s per command
    retryStrategy(times) {
      // Exponential back-off: 200ms → 400ms → … → 10 000ms
      // Never stops — Redis outages are temporary; app survives.
      return Math.min(times * 200, 10_000);
    },
    ...overrides,
  };

  const client = new Redis(opts);

  client.on('connect',      ()      => logger.info('Redis connected'));
  client.on('ready',        ()      => logger.info('Redis ready'));
  client.on('error',        (err)   => logger.error({ err: err.message }, 'Redis error'));
  client.on('reconnecting', (delay) => logger.warn({ delay }, 'Redis reconnecting'));
  client.on('close',        ()      => logger.warn('Redis connection closed'));
  client.on('end',          ()      => logger.info('Redis connection ended'));

  return client;
}

// Main client used by the application (sessions, rate limiter, etc.)
const redis = createRedisClient();

// Separate connection for BullMQ — must NOT share with regular client per BullMQ docs.
// commandTimeout must be omitted (undefined): BullMQ uses blocking commands (BLMOVE, XREAD)
// that intentionally wait seconds for jobs. commandTimeout:0 means 0ms in ioredis (immediate
// failure), and any finite value races with BullMQ's internal blocking timeouts.
const bullRedis = createRedisClient({ maxRetriesPerRequest: null, commandTimeout: undefined });

async function connectRedis() {
  await redis.connect();
  // bullRedis connects lazily when BullMQ first uses it
}

async function closeRedis() {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
  try {
    await bullRedis.quit();
  } catch {
    bullRedis.disconnect();
  }
  logger.info('Redis connections closed');
}

module.exports = { redis, bullRedis, connectRedis, closeRedis };
