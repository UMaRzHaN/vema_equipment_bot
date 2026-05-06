'use strict';

const { Worker } = require('bullmq');
const { bullRedis } = require('../redis');
const logger = require('../utils/logger');
const { notificationsTotal } = require('../utils/metrics');

/**
 * Creates and starts the BullMQ notification worker.
 *
 * Returns the worker instance so the caller can close it during graceful shutdown:
 *   const worker = startNotificationWorker(bot);
 *   await worker.close();
 *
 * @param {import('telegraf').Telegraf} bot
 * @returns {import('bullmq').Worker}
 */
function startNotificationWorker(bot) {
  const worker = new Worker(
    'notifications',
    async (job) => {
      const { recipients, message } = job.data;

      const extra = { parse_mode: 'HTML' };
      if (job.data.replyMarkup) extra.reply_markup = job.data.replyMarkup;

      for (const recipientId of recipients) {
        try {
          await bot.telegram.sendMessage(recipientId, message, extra);
          notificationsTotal.inc({ status: 'sent' });
        } catch (err) {
          // Log per-recipient failures but continue to next recipient
          logger.error({ recipientId, err: err.message }, 'Failed to send notification to recipient');
          notificationsTotal.inc({ status: 'failed' });
        }
      }
    },
    {
      connection: bullRedis,
      concurrency: 1,
      // Graceful: finish current job before stopping when worker.close() is called
      skipStalledCheck: false,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'Notification job completed');
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
