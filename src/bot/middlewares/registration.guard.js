const { getUserByTelegramId, isUserProfileComplete } = require('../../services/user.service');
const { startProfileRegistration } = require('../utils/profile.utils');
const { resetFlow } = require('../utils');

async function registrationGuard(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return next();

  // ❗ ВАЖНО: если уже идет регистрация — пропускаем
  if (ctx.session?.flow?.type === "register_profile") {
    return next();
  }

  const user = getUserByTelegramId(userId);

  const isRegistered = isUserProfileComplete(user);

  if (!isRegistered) {
    // Ответить на callback_query, чтобы кнопка не зависала
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery().catch(() => {});
    }
    resetFlow(ctx);
    return startProfileRegistration(ctx);
  }

  return next();
}

module.exports = {
  registrationGuard
};