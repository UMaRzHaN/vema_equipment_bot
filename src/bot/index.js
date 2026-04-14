'use strict';

const { Telegraf } = require('telegraf');
const { config } = require('../config');
const logger = require('../utils/logger');
const { botUpdatesTotal, botErrorsTotal } = require('../utils/metrics');

const { sessionMiddleware }       = require('./middlewares/session.middleware');
const { registrationGuard }       = require('./middlewares/registration.guard');
const { createRateLimiter }       = require('./middlewares/rate.limiter');

const { registerUserMiddleware }      = require('./handlers/user.middleware');
const { registerNavigationHandlers }  = require('./handlers/navigation.handlers');
const { registerProfileHandlers }     = require('./handlers/profile.handlers');
const { registerFlowHandlers }        = require('./handlers/flow.handlers');
const { registerEquipmentHandlers }   = require('./handlers/equipment.handlers');

function createBot() {
  const bot = new Telegraf(config.bot.token);

  // ── Middleware chain ──────────────────────────────────────────────────────
  bot.use(sessionMiddleware());
  bot.use(registrationGuard);
  bot.use(createRateLimiter({ windowMs: 60_000, maxCalls: 30, label: 'global' }));

  // ── Count updates for metrics ─────────────────────────────────────────────
  bot.use(async (ctx, next) => {
    botUpdatesTotal.inc({ type: ctx.updateType || 'unknown' });
    return next();
  });

  // ── Handlers ─────────────────────────────────────────────────────────────
  registerUserMiddleware(bot);
  registerNavigationHandlers(bot);
  registerProfileHandlers(bot);
  registerFlowHandlers(bot);
  registerEquipmentHandlers(bot);

  // ── Global error handler ──────────────────────────────────────────────────
  bot.catch(async (err, ctx) => {
    botErrorsTotal.inc();
    logger.error('Bot error', {
      err: err.message,
      updateType: ctx.updateType,
      userId: ctx.from?.id,
    });
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('Произошла ошибка. Попробуйте ещё раз.', { show_alert: true }).catch(() => {});
      } else {
        await ctx.reply('⚠️ Произошла ошибка. Попробуйте ещё раз или нажмите /start.').catch(() => {});
      }
    } catch (_) { /* ignore secondary errors */ }
  });

  return bot;
}

module.exports = { createBot };
