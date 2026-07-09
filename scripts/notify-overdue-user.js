'use strict';

require('dotenv').config();

const { config } = require('../src/config');
const logger = require('../src/utils/logger');
const { initDb, closeDb } = require('../src/db');
const { connectRedis, closeRedis } = require('../src/redis');
const { createBot } = require('../src/bot');
const { startNotificationWorker } = require('../src/workers/notification.worker');
const {
  enqueueOverdueNotificationForUser,
  notificationQueue,
} = require('../src/services/notification.service');

async function waitForQueueToDrain(maxAttempts = 20, delayMs = 500) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const counts = await notificationQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'prioritized',
    );

    const pending =
      (counts.waiting || 0) +
      (counts.active || 0) +
      (counts.delayed || 0) +
      (counts.prioritized || 0);

    if (pending === 0) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function main() {
  const rawUserId = process.argv[2];
  const userId = Number(rawUserId);
  const overdueDays = Number(process.argv[3] || config.overdueDays);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Usage: node scripts/notify-overdue-user.js <telegram_user_id> [overdue_days]');
  }

  await connectRedis();
  await initDb();

  const bot = createBot();
  const worker = startNotificationWorker(bot);

  try {
    const result = await enqueueOverdueNotificationForUser(userId, overdueDays);
    await waitForQueueToDrain();

    if (!result.sent) {
      logger.info(
        { userId, overdueDays },
        'Manual user overdue notification finished: no overdue items for user',
      );
      return;
    }

    logger.info(
      { userId, count: result.count, overdueDays },
      'Manual user overdue notification finished',
    );
  } finally {
    await worker.close();
    await closeDb();
    await closeRedis();
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'Manual user overdue notification failed');
    process.exit(1);
  });
}

module.exports = { main };
