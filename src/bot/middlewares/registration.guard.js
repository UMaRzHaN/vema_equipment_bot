'use strict';

const { getUserByTelegramId, isUserBanned, isUserProfileComplete } = require('../../services/user.service');
const { resetFlow } = require('../utils');
const logger = require('../../utils/logger');

async function registrationGuard(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return next();
  try {

  // Already in registration — let it continue
  if (ctx.session?.flow?.type === 'register_profile') return next();

  const user = await getUserByTelegramId(userId);
  if (isUserBanned(user)) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Доступ к боту заблокирован.', { show_alert: true }).catch(() => {});
    }

    resetFlow(ctx);
    return ctx.reply('Ваш доступ к боту заблокирован. Обратитесь к администратору.');
  }

  if (isUserProfileComplete(user)) return next();

  // Answer pending callback so button doesn't hang
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

  resetFlow(ctx);

  // Inline import to avoid circular deps
  const { startProfileRegistration } = require('../utils/profile.utils');
  return startProfileRegistration(ctx);
  } catch (err) {
    logger.error({
      errType: typeof err,
      errStr: String(err),
      errMsg: err?.message,
      errCode: err?.code,
      stack: err?.stack,
      userId,
    }, 'registrationGuard error');
    throw err;
  }
}

module.exports = { registrationGuard };
