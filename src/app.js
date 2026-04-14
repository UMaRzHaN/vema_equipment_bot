'use strict';

require('dotenv').config();

const { assertConfig, config } = require('./config');
assertConfig();

const logger = require('./utils/logger');
const { initDb, closeDb } = require('./db');
const { connectRedis, closeRedis } = require('./redis');
const { createBot } = require('./bot');
const { createApi } = require('./api');
const { startNotificationWorker } = require('./workers/notification.worker');
const { scheduleOverdueCheck } = require('./services/notification.service');

async function main() {
  // ── 1. Databases ──────────────────────────────────────────────────────────
  await connectRedis();
  await initDb();

  // ── 2. Telegram bot ───────────────────────────────────────────────────────
  const bot = createBot();

  // ── 3. BullMQ notification worker ────────────────────────────────────────
  startNotificationWorker(bot);

  // ── 4. Fastify API + webhook route ────────────────────────────────────────
  const api = createApi(bot, config.bot.webhookSecret);
  await api.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`API listening on port ${config.port}`);

  // ── 5. Register Telegram webhook ─────────────────────────────────────────
  const webhookUrl = `${config.bot.webhookUrl}/webhook`;
  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: config.bot.webhookSecret,
    drop_pending_updates: true,
  });
  logger.info(`Webhook set → ${webhookUrl}`);

  // ── 6. Overdue notification scheduler ────────────────────────────────────
  scheduleOverdueCheck(config.bot.adminIds, config.overdueDays);

  logger.info('Bot started in webhook mode');
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down…`);
  try {
    await closeDb();
    await closeRedis();
  } catch (err) {
    logger.error('Shutdown error', { err: err.message });
  }
  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  logger.error('Startup error', { err: err.message, stack: err.stack });
  process.exit(1);
});
