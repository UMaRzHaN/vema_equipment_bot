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
          logger.error('Failed to send notification to admin', { adminId, err: err.message });
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
    logger.info('Notification job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Notification job failed', { jobId: job?.id, err: err.message });
  });

  worker.on('error', (err) => {
    logger.error('Notification worker error', { err: err.message });
  });

  logger.info('Notification worker started');
  return worker;
}

module.exports = { startNotificationWorker };
