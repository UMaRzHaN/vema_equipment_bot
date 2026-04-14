'use strict';

const { getUserByTelegramId, isUserProfileComplete } = require('../../services/user.service');
const { resetFlow } = require('../utils');

async function registrationGuard(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return next();

  // Already in registration — let it continue
  if (ctx.session?.flow?.type === 'register_profile') return next();

  const user = await getUserByTelegramId(userId);
  if (isUserProfileComplete(user)) return next();

  // Answer pending callback so button doesn't hang
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

  resetFlow(ctx);

  // Inline import to avoid circular deps
  const { startProfileRegistration } = require('../utils/profile.utils');
  return startProfileRegistration(ctx);
}

module.exports = { registrationGuard };
