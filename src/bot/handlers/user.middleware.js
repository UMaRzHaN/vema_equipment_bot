'use strict';

const { saveTelegramUser } = require('../../services/user.service');
const logger = require('../../utils/logger');

function registerUserMiddleware(bot) {
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    if (ctx.session?.flow?.type === 'register_profile') return next();
    try {
      await saveTelegramUser(ctx.from);
    } catch (err) {
      logger.error('User upsert error', { err: err.message, userId: ctx.from.id });
    }
    return next();
  });
}

module.exports = { registerUserMiddleware };
