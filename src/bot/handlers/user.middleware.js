'use strict';

const { getUserByTelegramId, saveTelegramUser } = require('../../services/user.service');
const logger = require('../../utils/logger');

function registerUserMiddleware(bot) {
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    if (ctx.session?.flow?.type === 'register_profile') return next();
    try {
      await saveTelegramUser(ctx.from);
      const user = await getUserByTelegramId(ctx.from.id);
      ctx.session ??= {};
      ctx.session.userRole = user?.role || 'user';
    } catch (err) {
      logger.error({ err: err.message, userId: ctx.from.id }, 'User upsert error');
    }
    return next();
  });
}

module.exports = { registerUserMiddleware };
