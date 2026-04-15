'use strict';

const logger = require('../../utils/logger');

/**
 * Wraps an async Telegraf handler with a catch-all error handler.
 * On error: logs with label context, sends a user-facing message, then returns.
 * The `next` argument (if any) is passed through via ...args.
 *
 * Usage:
 *   bot.action(/pattern/, safe(async (ctx) => { ... }, 'actionName'));
 *   bot.hears(label, safe(async (ctx) => { ... }, 'labelName'));
 *   bot.on('text', safe(async (ctx, next) => { ... }, 'textHandler'));
 */
function safe(fn, label = 'handler') {
  return async (ctx, ...args) => {
    try {
      return await fn(ctx, ...args);
    } catch (err) {
      logger.error(`[${label}] error`, { err: err.message, stack: err.stack, userId: ctx.from?.id });
      try {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery('Произошла ошибка.', { show_alert: true }).catch(() => {});
        } else {
          await ctx.reply('⚠️ Произошла ошибка. Попробуйте ещё раз.').catch(() => {});
        }
      } catch (_) {
        // secondary error — ignore
      }
    }
  };
}

module.exports = { safe };
