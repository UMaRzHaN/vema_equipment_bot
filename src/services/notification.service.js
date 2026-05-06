'use strict';

const { Queue } = require('bullmq');
const { bullRedis, redis } = require('../redis');
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

function buildOverdueAdminMessageGrouped(items, overdueDays, usersMap = new Map()) {
  const itemsByHolder = items.reduce((acc, item) => {
    const userId = Number(item.current_holder_user_id);
    if (!Number.isFinite(userId) || userId <= 0) return acc;
    if (!acc[userId]) acc[userId] = [];
    acc[userId].push(item);
    return acc;
  }, {});

  const blocks = Object.entries(itemsByHolder).map(([userIdStr, userItems]) => {
    const userId = Number(userIdStr);
    const user = usersMap.get(userId);
    let header = `Держатель: ${userId}`;
    if (user) {
      const fullName = escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '-');
      header = `Держатель: <a href="tg://user?id=${user.telegram_user_id}">${fullName}</a>`;
      if (user.phone) header += ` (Тел: ${escapeHtml(user.phone)})`;
    }

    const lines = userItems.map((item) => {
      const name = escapeHtml(`${item.category || '-'} ${item.model || '-'} (${item.serial_number || `#${item.id}`})`);
      return `• ${name}\n  Выдано: ${formatDate(item.current_issue_date)}`;
    });

    return `${header}\n${lines.join('\n')}`;
  });

  const prefix = `⚠️ Оборудование не возвращено более ${overdueDays} дней (по держателям):`;
  return `${prefix}\n\n${blocks.join('\n\n')}`;
}

function buildOverdueAdminMessageForHolder(holderUserId, items, overdueDays, usersMap = new Map()) {
  const user = usersMap.get(Number(holderUserId));
  let header = `Держатель: ${holderUserId}`;
  if (user) {
    const fullName = escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '-');
    header = `Держатель: <a href="tg://user?id=${user.telegram_user_id}">${fullName}</a>`;
    if (user.phone) header += ` (Тел: ${escapeHtml(user.phone)})`;
  }

  const lines = items.map((item) => {
    const name = escapeHtml(`${item.category || '-'} ${item.model || '-'} (${item.serial_number || `#${item.id}`})`);
    return `• ${name}\n  Выдано: ${formatDate(item.current_issue_date)}`;
  });

  const prefix = `⚠️ Оборудование не возвращено более ${overdueDays} дней:`;
  return `${prefix}\n\n${header}\n${lines.join('\n')}`;
}

function buildExtendKeyboardChunk(itemsChunk) {
  const rows = itemsChunk.map((item) => {
    const labelBase = `${item.category || ''} ${item.model || ''}`.trim() || `#${item.id}`;
    const label = labelBase.length > 28 ? `${labelBase.slice(0, 25)}…` : labelBase;
    return [{ text: `🔄 Продлить: ${label}`, callback_data: `extend_${item.id}` }];
  });
  return { inline_keyboard: rows };
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
    const now = new Date();
    const slot = `${now.toISOString().slice(0, 10)}-${now.getUTCHours() < 12 ? '00' : '12'}`;
    const sentKey = `notif-sent:${slot}`;

    try {
      // Skip if already sent in this 12h window (survives restarts)
      const alreadySent = await redis.get(sentKey);
      if (alreadySent) {
        logger.info({ slot }, 'Notifications already sent for this slot, skipping');
        return;
      }
      // ── Overdue by global threshold ───────────────────────────────────────
      const overdueItems = await findOverdueEquipment(overdueDays);
      if (overdueItems.length > 0) {
        logger.info({ count: overdueItems.length }, `Overdue check: ${overdueItems.length} overdue items`);

        const roleAdmins = await getUsersByRole('admin');
        const allAdminIds = [...new Set([...envAdminIds, ...roleAdmins.map(u => Number(u.telegram_user_id))])];

        const holderIds = [...new Set(overdueItems.map(i => Number(i.current_holder_user_id)))];
        const holders = await findUsersByTelegramIds(holderIds);
        const usersMap = new Map(holders.map(u => [Number(u.telegram_user_id), u]));

        // 1) Общие сообщения держателям: по одному сообщению на держателя со списком его просрочек
        const itemsByHolder = overdueItems.reduce((acc, item) => {
          const userId = Number(item.current_holder_user_id);
          if (!Number.isFinite(userId) || userId <= 0) return acc;
          if (!acc[userId]) acc[userId] = [];
          acc[userId].push(item);
          return acc;
        }, {});

        for (const [userIdStr, userItems] of Object.entries(itemsByHolder)) {
          const userId = Number(userIdStr);
          const userMessage = buildOverdueMessage(userItems, overdueDays, true);
          await notificationQueue.add(
            'sendOverdueUser',
            {
              recipients: [userId],
              message: userMessage,
            },
              { ...JOB_OPTS, jobId: `overdue-user-${userId}-${slot}` },
            );

          // Telegram inline keyboards have a practical button limit per message.
          // To avoid "limits on extension", send additional messages with buttons in chunks.
          const chunkSize = 20;
          for (let i = 0; i < userItems.length; i += chunkSize) {
            const chunk = userItems.slice(i, i + chunkSize);
            await notificationQueue.add(
              'sendOverdueUser',
              {
                recipients: [userId],
                message: `Выберите оборудование для продления (${Math.floor(i / chunkSize) + 1}/${Math.ceil(userItems.length / chunkSize)}):`,
                replyMarkup: buildExtendKeyboardChunk(chunk),
              },
              { ...JOB_OPTS, jobId: `overdue-user-${userId}-kb-${Math.floor(i / chunkSize)}-${slot}` },
            );
          }
        }

        // 2) Админам: отдельное сообщение на каждого держателя ("пользователь -> какие оборудования просрочил")
        for (const [holderIdStr, holderItems] of Object.entries(itemsByHolder)) {
          const holderId = Number(holderIdStr);
          const recipients = allAdminIds.filter(id => Number(id) !== holderId);
          if (recipients.length === 0) continue;

          const adminMessage = buildOverdueAdminMessageForHolder(holderId, holderItems, overdueDays, usersMap);
          await notificationQueue.add(
            'sendOverdueAdmins',
            { recipients, message: adminMessage },
            { ...JOB_OPTS, jobId: `overdue-admins-${holderId}-${slot}` },
          );
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

      // Mark this slot as done — 13h TTL so it expires before the next check cycle
      await redis.set(sentKey, '1', 'EX', 13 * 60 * 60);
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
