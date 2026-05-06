'use strict';

const { Queue } = require('bullmq');
const { bullRedis } = require('../redis');
const { config } = require('../config');
const logger = require('../utils/logger');
const { findOverdueEquipment } = require('./history.service');
const { getUsersByRole } = require('../repositories/user.repo');
const { formatDate } = require('../utils/formatters');

// Queue is created lazily — bullRedis connects only when the first job is added
const notificationQueue = new Queue('notifications', { connection: bullRedis });

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

function buildOverdueMessage(items, overdueDays, isForUser = false) {
  const lines = items.map((item) => {
    const name = `${item.category || '-'} ${item.model || '-'} (${item.serial_number || `#${item.id}`})`;
    return `• ${name}\n  Выдано: ${formatDate(item.current_issue_date)}`;
  });
  const prefix = isForUser
    ? `⚠️ У вас есть просроченное оборудование (более ${overdueDays} дней):`
    : `⚠️ Оборудование не возвращено более ${overdueDays} дней:`;
  return `${prefix}\n\n${lines.join('\n\n')}`;
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
async function scheduleOverdueCheck(envAdminIds, overdueDays) {
  if (!envAdminIds || envAdminIds.length === 0) {
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

      // Get all admin IDs: env + role-based
      const roleAdmins = await getUsersByRole('admin');
      const allAdminIds = [...new Set([...envAdminIds, ...roleAdmins.map(u => u.telegram_user_id)])];

      // Send to admins
      const adminMessage = buildOverdueMessage(overdueItems, overdueDays, false);
      await notificationQueue.add(
        'sendOverdueAdmins',
        { recipients: allAdminIds, message: adminMessage },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );

      // Group by user and send to each user (excluding admins)
      const itemsByUser = overdueItems.reduce((acc, item) => {
        const userId = item.current_holder_user_id;
        if (!acc[userId]) acc[userId] = [];
        acc[userId].push(item);
        return acc;
      }, {});

      for (const [userId, userItems] of Object.entries(itemsByUser)) {
        // Skip if user is an admin
        if (allAdminIds.includes(Number(userId))) continue;
        const userMessage = buildOverdueMessage(userItems, overdueDays, true);
        await notificationQueue.add(
          'sendOverdueUser',
          { recipients: [Number(userId)], message: userMessage },
          { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        );
      }
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
