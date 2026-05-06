'use strict';

const { Queue } = require('bullmq');
const { bullRedis } = require('../redis');
const logger = require('../utils/logger');
const { findOverdueEquipment } = require('./history.service');
const { findDueEquipment } = require('./equipment.service');
const { getUsersByRole, findUsersByTelegramIds } = require('../repositories/user.repo');
const { formatDate, escapeHtml } = require('../utils/formatters');

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 50 },
};

// Queue is created lazily — bullRedis connects only when the first job is added
const notificationQueue = new Queue('notifications', { connection: bullRedis });

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

function buildOverdueMessage(items, overdueDays, isForUser = false, usersMap = new Map()) {
  const lines = items.map((item) => {
    const name = escapeHtml(`${item.category || '-'} ${item.model || '-'} (${item.serial_number || `#${item.id}`})`);
    let line = `• ${name}\n  Выдано: ${formatDate(item.current_issue_date)}`;
    if (!isForUser) {
      const user = usersMap.get(Number(item.current_holder_user_id));
      if (user) {
        const fullName = escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '-');
        const link = `<a href="tg://user?id=${user.telegram_user_id}">${fullName}</a>`;
        const phone = user.phone ? `\n  Тел: ${escapeHtml(user.phone)}` : '';
        line += `\n  Держатель: ${link}${phone}`;
      }
    }
    return line;
  });
  const prefix = isForUser
    ? `⚠️ У вас есть просроченное оборудование (более ${overdueDays} дней):`
    : `⚠️ Оборудование не возвращено более ${overdueDays} дней:`;
  return `${prefix}\n\n${lines.join('\n\n')}`;
}

function buildDueMessage(item, isForUser = false) {
  const name = escapeHtml(`${item.category || '-'} ${item.model || '-'} (${item.serial_number || `#${item.id}`})`);
  const now = new Date();
  const due = new Date(item.due_date);
  const isOverdue = due <= now;
  if (isForUser) {
    const status = isOverdue ? '⏰ Срок сдачи истёк!' : '⏰ Срок сдачи истекает сегодня!';
    return `${status}\n\n• ${name}\n  Срок: ${formatDate(item.due_date)}\n\nВерните оборудование или нажмите кнопку ниже чтобы продлить срок.`;
  }
  const status = isOverdue ? 'Срок истёк' : 'Срок истекает сегодня';
  return `⏰ ${status}:\n\n• ${name}\n  Срок: ${formatDate(item.due_date)}`;
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
    // Slot: YYYY-MM-DD-HH rounded to 12h window — prevents duplicate jobs on restart
    const now = new Date();
    const slot = `${now.toISOString().slice(0, 10)}-${now.getUTCHours() < 12 ? '00' : '12'}`;

    try {
      // ── Overdue by global threshold ───────────────────────────────────────
      const overdueItems = await findOverdueEquipment(overdueDays);
      if (overdueItems.length > 0) {
        logger.info({ count: overdueItems.length }, `Overdue check: ${overdueItems.length} overdue items`);

        const roleAdmins = await getUsersByRole('admin');
        const allAdminIds = [...new Set([...envAdminIds, ...roleAdmins.map(u => Number(u.telegram_user_id))])];

        const holderIds = [...new Set(overdueItems.map(i => Number(i.current_holder_user_id)))];
        const holders = await findUsersByTelegramIds(holderIds);
        const usersMap = new Map(holders.map(u => [Number(u.telegram_user_id), u]));

        const adminMessage = buildOverdueMessage(overdueItems, overdueDays, false, usersMap);
        await notificationQueue.add(
          'sendOverdueAdmins',
          { recipients: allAdminIds, message: adminMessage },
          { ...JOB_OPTS, jobId: `overdue-admins-${slot}` },
        );

        const itemsByUser = overdueItems.reduce((acc, item) => {
          const userId = item.current_holder_user_id;
          if (!acc[userId]) acc[userId] = [];
          acc[userId].push(item);
          return acc;
        }, {});

        for (const [userId, userItems] of Object.entries(itemsByUser)) {
          if (allAdminIds.includes(Number(userId))) continue;
          for (const item of userItems) {
            const userMessage = buildOverdueMessage([item], overdueDays, true);
            await notificationQueue.add(
              'sendOverdueUser',
              {
                recipients: [Number(userId)],
                message: userMessage,
                replyMarkup: {
                  inline_keyboard: [[{ text: '🔄 Продлить срок', callback_data: `extend_${item.id}` }]],
                },
              },
              { ...JOB_OPTS, jobId: `overdue-user-${userId}-${item.id}-${slot}` },
            );
          }
        }
      } else {
        logger.info('Overdue check: no overdue items');
      }

      // ── Due date check ────────────────────────────────────────────────────
      const dueItems = await findDueEquipment();
      if (dueItems.length > 0) {
        logger.info({ count: dueItems.length }, `Due date check: ${dueItems.length} items due`);

        const roleAdmins2 = await getUsersByRole('admin');
        const allAdminIds2 = [...new Set([...envAdminIds, ...roleAdmins2.map(u => Number(u.telegram_user_id))])];

        for (const item of dueItems) {
          const userId = Number(item.current_holder_user_id);

          // Notify user with extend button
          const userMessage = buildDueMessage(item, true);
          await notificationQueue.add(
            'sendDueUser',
            {
              recipients: [userId],
              message: userMessage,
              replyMarkup: {
                inline_keyboard: [[{ text: '🔄 Продлить срок', callback_data: `extend_${item.id}` }]],
              },
            },
            { ...JOB_OPTS, jobId: `due-user-${userId}-${item.id}-${slot}` },
          );

          // Notify admins (without extend button)
          const adminIds = allAdminIds2.filter(id => id !== userId);
          if (adminIds.length > 0) {
            const adminMessage = buildDueMessage(item, false);
            await notificationQueue.add(
              'sendDueAdmins',
              { recipients: adminIds, message: adminMessage },
              { ...JOB_OPTS, jobId: `due-admins-${item.id}-${slot}` },
            );
          }
        }
      } else {
        logger.info('Due date check: no items due');
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
