const { saveTelegramUser } = require("../../services/user.service");
const logger = require("../../utils/logger.js");
const { nowIso } = require("../utils");

function registerUserMiddleware(bot) {
  bot.use(async (ctx, next) => {
    if (!ctx.from) {
      return next();
    }

    // Во время регистрации не вмешиваемся в flow
    if (ctx.session?.flow?.type === "register_profile") {
      return next();
    }

    try {
      await saveTelegramUser(ctx.from, nowIso());
    } catch (error) {
      logger.error("User upsert error:", { err: error.message });
    }

    return next();
  });
}

module.exports = {
  registerUserMiddleware,
};