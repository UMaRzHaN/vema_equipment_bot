'use strict';

require('dotenv').config();

const { config } = require('../src/config');
const logger = require('../src/utils/logger');
const { initDb, closeDb } = require('../src/db');
const { connectRedis, closeRedis } = require('../src/redis');
const { createBot } = require('../src/bot');
const { startNotificationWorker } = require('../src/workers/notification.worker');
const { runOverdueCheck, notificationQueue } = require('../src/services/notification.service');

async function waitForQueueToDrain(maxAttempts = 40, delayMs = 500) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const counts = await notificationQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'prioritized',
      'completed',
      'failed',
    );

    const pending =
      (counts.waiting || 0) +
      (counts.active || 0) +
      (counts.delayed || 0) +
      (counts.prioritized || 0);

    if (pending === 0) {
      logger.info(
        { attempt, counts },
        'Queue drained - checking for completed jobs',
      );
      // Give worker a moment to mark jobs as completed
      await new Promise((resolve) => setTimeout(resolve, 100));
      return;
    }
    if (attempt % 5 === 0) {
      logger.info(
        { attempt, pending, counts },
        'Waiting for notification queue to drain',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function main() {
  await connectRedis();
  await initDb();

  const bot = createBot();
  const worker = startNotificationWorker(bot);

  try {
    const result = await runOverdueCheck(config.bot.adminIds, config.overdueDays);
    
    // Give jobs a moment to be added to queue
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    await waitForQueueToDrain();

    if (!result.sent) {
      logger.info('Manual overdue check finished: no overdue items');
      return;
    }

    logger.info(
      { count: result.count, overdueDays: config.overdueDays },
      'Manual overdue check finished',
    );
  } finally {
    logger.info('Closing notification worker...');
    await worker.close();
    logger.info('Notification worker closed');
    await closeDb();
    await closeRedis();
  }
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Manual overdue check failed');
  process.exit(1);
});
