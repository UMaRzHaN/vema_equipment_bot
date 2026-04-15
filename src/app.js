'use strict';

// MUST be first — instruments HTTP/PG/Redis before any other require
require('./tracing').setup();

require('dotenv').config();

const { assertConfig, config } = require('./config');
assertConfig();

const logger = require('./utils/logger');
const { initDb, closeDb } = require('./db');
const { redis, connectRedis, closeRedis } = require('./redis');
const { createBot } = require('./bot');
const { createApi } = require('./api');
const { startNotificationWorker } = require('./workers/notification.worker');
const { scheduleOverdueCheck } = require('./services/notification.service');
const { flags } = require('./lib/feature-flags');

// Held in module scope so shutdown() can close them
let notificationWorker = null;
let overdueTimer = null;

async function main() {
  // ── 1. Databases ──────────────────────────────────────────────────────────
  await connectRedis();
  await initDb();

  // Inject Redis into feature flags after connection is established
  flags.setRedis(redis);

  // ── 3. Telegram bot ───────────────────────────────────────────────────────
  const bot = createBot();

  // ── 4. BullMQ notification worker ────────────────────────────────────────
  notificationWorker = startNotificationWorker(bot);

  // ── 5. Fastify API + webhook route ────────────────────────────────────────
  const api = createApi(bot, config.bot.webhookSecret);
  await api.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`API listening on port ${config.port}`);

  // ── 6. Register Telegram webhook ─────────────────────────────────────────
  const webhookUrl = `${config.bot.webhookUrl}/webhook`;
  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: config.bot.webhookSecret,
    drop_pending_updates: true,
  });
  logger.info(`Webhook set → ${webhookUrl}`);

  // ── 7. Overdue notification scheduler ────────────────────────────────────
  overdueTimer = scheduleOverdueCheck(config.bot.adminIds, config.overdueDays);

  logger.info('Bot started in webhook mode');
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down…`);
  try {
    // Stop accepting new jobs; finish current job first
    if (notificationWorker) {
      await notificationWorker.close();
      logger.info('Notification worker closed');
    }
    // Cancel the overdue check timer so it doesn't fire during shutdown
    if (overdueTimer) {
      clearTimeout(overdueTimer.initialTimeout);
      clearInterval(overdueTimer.interval);
    }
    await closeDb();
    await closeRedis();
    logger.info('Shutdown complete');
  } catch (err) {
    logger.error({ err: err.message }, 'Shutdown error');
  }
  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Startup error');
  process.exit(1);
});
