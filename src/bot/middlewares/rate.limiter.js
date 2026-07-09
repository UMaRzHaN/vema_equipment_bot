'use strict';

const { redis } = require('../../redis');
const logger = require('../../utils/logger');

/**
 * Per-user rate limiter backed by Redis.
 * Survives container restarts unlike the previous in-memory Map.
 * Fails open: if Redis is unavailable, the request is allowed through.
 * @param {{ windowMs?: number, maxCalls?: number, label?: string }} opts
 */
function createRateLimiter({ windowMs = 60_000, maxCalls = 30, label = 'global' } = {}) {
  const windowSec = Math.ceil(windowMs / 1000);

  return async function rateLimiter(ctx, next) {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const key = `rl:${label}:${userId}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);

      if (count > maxCalls) {
        const ttl = await redis.ttl(key);
        const secsLeft = Math.max(ttl, 1);
        logger.warn({ userId }, `Rate limit [${label}]`);
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery(`Слишком много запросов. Подождите ${secsLeft} сек.`, { show_alert: true }).catch(() => {});
        } else {
          await ctx.reply(`⏳ Слишком много запросов. Подождите ${secsLeft} сек.`).catch(() => {});
        }
        return;
      }
    } catch (err) {
      // Redis unavailable: fail open so users are never blocked by infrastructure issues.
      logger.warn({ err: err.message }, 'Rate limiter Redis error, skipping');
    }

    return next();
  };
}

module.exports = { createRateLimiter };
