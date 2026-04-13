require('dotenv').config();
const logger = require("./utils/logger.js");

const { bot } = require('./bot');
const db = require('./db');

async function startBot() {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch({ dropPendingUpdates: true });
    logger.info('Bot started');
  } catch (err) {
    logger.error('Bot launch error:', { err: err.message });
    process.exit(1);
  }
}

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  bot.stop(signal);
  try {
    db.close();
    logger.info('Database closed.');
  } catch (err) {
    logger.error('Error closing database:', { err: err.message });
  }
  process.exit(0);
}

startBot();

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
