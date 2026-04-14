const { Telegraf } = require("telegraf");
const logger = require("../utils/logger.js");
const LocalSession = require("telegraf-session-local");
const { assertBotConfig } = require("./config");

const { registrationGuard } = require("./middlewares/registration.guard");
const { createRateLimiter } = require("./middlewares/rate.limiter");

const { registerUserMiddleware } = require("./handlers/user.middleware");
const {
  registerNavigationHandlers,
} = require("./handlers/navigation.handlers");
const { registerProfileHandlers } = require("./handlers/profile.handlers");
const { registerFlowHandlers } = require("./handlers/flow.handlers");
const { registerEquipmentHandlers } = require("./handlers/equipment.handlers");

assertBotConfig();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Persistent file-based session (survives restarts)
const localSession = new LocalSession({
  database: process.env.SESSION_PATH || "./data/sessions.json",
  property: "session",
  storage: LocalSession.storageFileAsync,
  format: { serialize: JSON.stringify, deserialize: JSON.parse },
});
bot.use(localSession.middleware());

bot.use(registrationGuard);

// Rate limit: не более 30 любых действий в минуту на пользователя
bot.use(createRateLimiter({ windowMs: 60_000, maxCalls: 30, label: "global" }));

registerUserMiddleware(bot);
registerNavigationHandlers(bot);
registerProfileHandlers(bot);
registerFlowHandlers(bot);
registerEquipmentHandlers(bot);

bot.catch(async (error, ctx) => {
  logger.error(`Bot error for ${ctx.updateType}:`, {
    err: error.message,
    userId: ctx.from?.id,
    update: ctx.updateType,
  });

  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("Произошла ошибка. Попробуйте ещё раз.", { show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("⚠️ Произошла ошибка. Попробуйте ещё раз или нажмите /start.").catch(() => {});
    }
  } catch (_) {
    // ignore secondary errors
  }
});

module.exports = { bot };
