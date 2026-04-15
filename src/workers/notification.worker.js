'use strict';

const { Worker } = require('bullmq');
const { bullRedis } = require('../redis');
const logger = require('../utils/logger');
const { notificationsTotal } = require('../utils/metrics');

/**
 * Creates and starts the notification BullMQ worker.
 * @param {import('telegraf').Telegraf} bot
 */
function startNotificationWorker(bot) {
  const worker = new Worker(
    'notifications',
    async (job) => {
      const { adminIds, message } = job.data;

      for (const adminId of adminIds) {
        try {
          await bot.telegram.sendMessage(adminId, message);
          notificationsTotal.inc({ status: 'sent' });
        } catch (err) {
          logger.error({ adminId, err: err.message }, 'Failed to send notification to admin');
          notificationsTotal.inc({ status: 'failed' });
        }
      }
    },
    {
      connection: bullRedis,
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Notification job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Notification job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'Notification worker error');
  });

  logger.info('Notification worker started');
  return worker;
}

module.exports = { startNotificationWorker };
