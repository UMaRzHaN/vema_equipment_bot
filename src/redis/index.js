'use strict';

const Redis = require('ioredis');
const { config } = require('../config');
const logger = require('../utils/logger');

function createRedisClient(overrides = {}) {
  const opts = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    db: config.redis.db,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times) {
      if (times > 10) return null; // stop retrying
      return Math.min(times * 200, 3000);
    },
    ...overrides,
  };

  const client = new Redis(opts);

  client.on('connect', () => logger.info('Redis connected'));
  client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting'));

  return client;
}

// Main client used by the application
const redis = createRedisClient();

// Separate connection for BullMQ (must not share with regular client)
const bullRedis = createRedisClient({ maxRetriesPerRequest: null });

async function connectRedis() {
  await redis.connect();
}

async function closeRedis() {
  await redis.quit();
  await bullRedis.quit();
  logger.info('Redis connections closed');
}

module.exports = { redis, bullRedis, connectRedis, closeRedis };
