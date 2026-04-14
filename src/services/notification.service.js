'use strict';

const { Queue } = require('bullmq');
const { bullRedis } = require('../redis');
const { config } = require('../config');
const logger = require('../utils/logger');
const { findOverdueEquipment } = require('./history.service');
const { formatDate } = require('../utils/formatters');

const notificationQueue = new Queue('notifications', { connection: bullRedis });

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

function buildOverdueMessage(items, overdueDays) {
  const lines = items.map((item) => {
    const name = `${item.category || '-'} ${item.model || '-'} (${item.serial_number || item.inventory_number || `#${item.id}`})`;
    return `• ${name}\n  Выдано: ${formatDate(item.current_issue_date)}`;
  });
  return `⚠️ Оборудование не возвращено более ${overdueDays} дней:\n\n${lines.join('\n\n')}`;
}

async function scheduleOverdueCheck(adminIds, overdueDays) {
  if (!adminIds || adminIds.length === 0) {
    logger.warn('Notification scheduler: no ADMIN_IDS, skipping');
    return;
  }

  async function runCheck() {
    try {
      const overdueItems = await findOverdueEquipment(overdueDays);
      if (overdueItems.length === 0) {
        logger.info('Overdue check: no overdue items');
        return;
      }
      logger.info(`Overdue check: ${overdueItems.length} overdue items`, { count: overdueItems.length });
      const message = buildOverdueMessage(overdueItems, overdueDays);

      // Push job to BullMQ — notification.worker processes it
      await notificationQueue.add(
        'sendOverdue',
        { adminIds, message },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      logger.error('Overdue check failed', { err: err.message });
    }
  }

  // First check after 1 minute, then every 12 hours
  setTimeout(() => {
    runCheck();
    setInterval(runCheck, CHECK_INTERVAL_MS);
  }, 60_000);

  logger.info(`Notification scheduler started (interval=12h, threshold=${overdueDays}d)`);
}

module.exports = { scheduleOverdueCheck, notificationQueue };
