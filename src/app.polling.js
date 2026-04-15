'use strict';

require('dotenv').config();

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { config } = require('./config');

if (!config.bot.token) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}

const logger = require('./utils/logger');
const { initDb, closeDb } = require('./db');
const { connectRedis, closeRedis } = require('./redis');
const { createBot } = require('./bot');
const { startNotificationWorker } = require('./workers/notification.worker');
const { scheduleOverdueCheck } = require('./services/notification.service');

let notificationWorker = null;
let overdueTimer = null;

async function main() {
  await connectRedis();
  await initDb();

  const bot = createBot();

  // Remove any existing webhook so polling works
  await bot.telegram.deleteWebhook({ drop_pending_updates: true });

  notificationWorker = startNotificationWorker(bot);
  overdueTimer = scheduleOverdueCheck(config.bot.adminIds, config.overdueDays);

  await bot.launch();
  logger.info('Bot started in polling mode');
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down…`);
  try {
    if (notificationWorker) {
      await notificationWorker.close();
      logger.info('Notification worker closed');
    }
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
