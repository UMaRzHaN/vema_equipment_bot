'use strict';

const { Queue } = require('bullmq');
const { bullRedis } = require('../redis');
const { config } = require('../config');
const logger = require('../utils/logger');
const { findOverdueEquipment } = require('./history.service');
const { formatDate } = require('../utils/formatters');

// Queue is created lazily — bullRedis connects only when the first job is added
const notificationQueue = new Queue('notifications', { connection: bullRedis });

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

function buildOverdueMessage(items, overdueDays) {
  const lines = items.map((item) => {
    const name = `${item.category || '-'} ${item.model || '-'} (${item.serial_number || `#${item.id}`})`;
    return `• ${name}\n  Выдано: ${formatDate(item.current_issue_date)}`;
  });
  return `⚠️ Оборудование не возвращено более ${overdueDays} дней:\n\n${lines.join('\n\n')}`;
}

/**
 * Schedules periodic checks for overdue equipment.
 *
 * Returns timer handles so the caller (app.js) can cancel them during shutdown:
 *   const timers = scheduleOverdueCheck(adminIds, days);
 *   clearTimeout(timers.initialTimeout);
 *   clearInterval(timers.interval);
 *
 * @returns {{ initialTimeout: NodeJS.Timeout, interval: NodeJS.Timeout | null }}
 */
function scheduleOverdueCheck(adminIds, overdueDays) {
  if (!adminIds || adminIds.length === 0) {
    logger.warn('Notification scheduler: no ADMIN_IDS, skipping');
    return { initialTimeout: null, interval: null };
  }

  let intervalHandle = null;

  async function runCheck() {
    try {
      const overdueItems = await findOverdueEquipment(overdueDays);
      if (overdueItems.length === 0) {
        logger.info('Overdue check: no overdue items');
        return;
      }
      logger.info({ count: overdueItems.length }, `Overdue check: ${overdueItems.length} overdue items`);
      const message = buildOverdueMessage(overdueItems, overdueDays);

      await notificationQueue.add(
        'sendOverdue',
        { adminIds, message },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      logger.error({ err: err.message }, 'Overdue check failed');
    }
  }

  // First check after 1 minute, then every 12 hours
  const initialTimeout = setTimeout(() => {
    runCheck();
    intervalHandle = setInterval(runCheck, CHECK_INTERVAL_MS);
  }, 60_000);

  logger.info(`Notification scheduler started (interval=12h, threshold=${overdueDays}d)`);

  return {
    initialTimeout,
    get interval() { return intervalHandle; },
  };
}

module.exports = { scheduleOverdueCheck, notificationQueue };
