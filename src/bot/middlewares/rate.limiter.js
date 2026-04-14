'use strict';

const logger = require('../../utils/logger');

/**
 * In-memory per-user rate limiter.
 * @param {{ windowMs?: number, maxCalls?: number, label?: string }} opts
 */
function createRateLimiter({ windowMs = 60_000, maxCalls = 30, label = 'global' } = {}) {
  const map = new Map(); // userId → { count, resetAt }

  return async function rateLimiter(ctx, next) {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now   = Date.now();
    const entry = map.get(userId);

    if (!entry || now >= entry.resetAt) {
      map.set(userId, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= maxCalls) {
      const secsLeft = Math.ceil((entry.resetAt - now) / 1000);
      logger.warn(`Rate limit [${label}]`, { userId });
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(`Слишком много запросов. Подождите ${secsLeft} сек.`, { show_alert: true }).catch(() => {});
      } else {
        await ctx.reply(`⏳ Слишком много запросов. Подождите ${secsLeft} сек.`).catch(() => {});
      }
      return;
    }

    entry.count += 1;
    return next();
  };
}

module.exports = { createRateLimiter };
