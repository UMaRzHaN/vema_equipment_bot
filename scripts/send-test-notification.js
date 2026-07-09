'use strict';

require('dotenv').config();

const { config } = require('../src/config');
const logger = require('../src/utils/logger');
const { initDb, closeDb } = require('../src/db');
const { connectRedis, closeRedis } = require('../src/redis');
const { createBot } = require('../src/bot');
const { startNotificationWorker } = require('../src/workers/notification.worker');
const { notificationQueue } = require('../src/services/notification.service');

function buildTestMessage(customText) {
  if (customText && customText.trim()) {
    return customText.trim();
  }

  return [
    '🧪 Тестовое уведомление',
    '',
    'Если вы видите это сообщение, значит отправка уведомлений работает.',
    `Время: ${new Date().toLocaleString('ru-RU', { timeZone: config.timezone })}`,
  ].join('\n');
}

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
  const customText = process.argv.slice(3).join(' ');

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Usage: node scripts/send-test-notification.js <telegram_user_id> [message]');
  }

  await connectRedis();
  await initDb();

  const bot = createBot();
  const worker = startNotificationWorker(bot);

  try {
    const message = buildTestMessage(customText);

    await notificationQueue.add(
      'sendTestNotification',
      {
        recipients: [userId],
        message,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    await waitForQueueToDrain();

    logger.info(
      { userId },
      'Manual test notification finished',
    );
  } finally {
    await worker.close();
    await closeDb();
    await closeRedis();
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'Manual test notification failed');
    process.exit(1);
  });
}

module.exports = { main };
