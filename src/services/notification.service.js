"use strict";

const { Queue } = require("bullmq");
const { Markup } = require("telegraf");
const { bullRedis } = require("../redis");
const logger = require("../utils/logger");
const { findOverdueEquipment } = require("./history.service");
const { getUsersByRole } = require("../repositories/user.repo");
const { formatDate, escapeHtml } = require("../utils/formatters");
const { getUsersByTelegramIds, formatUser } = require("./user.service");
const { formatComponent, normalizeComponents } = require("../utils/components");

const notificationQueue = new Queue("notifications", { connection: bullRedis });
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

function buildUserOverdueReplyMarkup(items = []) {
  const rows = items.map((item) => ([
    Markup.button.callback(
      `⏳ ${item.model || item.serial_number || item.id}`,
      `extend_${item.id}`,
    ),
    Markup.button.callback(
      `↩️ ${item.model || item.serial_number || item.id}`,
      `return_${item.id}`,
    ),
  ]));

  rows.push([
    Markup.button.callback("⏳ Продлить всё", "extendAllMy"),
    Markup.button.callback("↩️ Вернуть всё", "returnAllMy"),
  ]);

  return Markup.inlineKeyboard(rows).reply_markup;
}

function buildUserLink(userId, usersMap) {
  const normalizedUserId = String(userId);
  const user = usersMap.get(normalizedUserId) || usersMap.get(Number(userId));
  const label = escapeHtml(formatUser(user) || String(userId));
  return `<a href="tg://user?id=${Number(userId)}">${label}</a>`;
}

function formatComponentsText(components) {
  const normalized = normalizeComponents(components);
  if (!normalized.length) return "без комплектующих";
  return normalized.map(formatComponent).map(escapeHtml).join(", ");
}

function buildEquipmentLine(item) {
  const name = escapeHtml(
    `${item.category || "-"} ${item.model || "-"} (${item.serial_number || `#${item.id}`})`,
  );
  const components = formatComponentsText(item.components);

  return `• ${name}\n  Комплект: ${components}\n  Выдано: ${escapeHtml(formatDate(item.current_issue_date))}`;
}

function buildUserSection(userId, items, usersMap) {
  const lines = items.map(buildEquipmentLine).join("\n\n");
  return [`Пользователь: ${buildUserLink(userId, usersMap)}`, lines].join("\n");
}

function buildAdminOverdueMessage(itemsByUser, overdueDays, usersMap) {
  const sections = Object.entries(itemsByUser)
    .map(([userId, items]) => buildUserSection(userId, items, usersMap))
    .join("\n\n");

  return `⚠️ Есть просроченное оборудование.\nПорог для позиций без плановой даты возврата: ${overdueDays} дн.\n\n${sections}`;
}

function buildUserOverdueMessage(userId, items, overdueDays, usersMap) {
  const greeting = buildUserLink(userId, usersMap);
  const lines = items.map(buildEquipmentLine).join("\n\n");

  return [
    `⚠️ ${greeting}, у вас есть просроченное оборудование.`,
    `Порог для позиций без плановой даты возврата: ${overdueDays} дн.`,
    "",
    lines,
  ].join("\n");
}

async function enqueueOverdueNotificationForUser(userId, overdueDays = 7) {
  const targetUserId = Number(userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new Error("Invalid telegram_user_id");
  }

  const overdueItems = await findOverdueEquipment(overdueDays);
  const userItems = overdueItems.filter(
    (item) => Number(item.current_holder_user_id) === targetUserId,
  );

  if (!userItems.length) {
    return { sent: false, count: 0, userId: targetUserId };
  }

  const usersMap = await getUsersByTelegramIds([targetUserId]);
  const userMessage = buildUserOverdueMessage(
    targetUserId,
    userItems,
    overdueDays,
    usersMap,
  );

  await notificationQueue.add(
    "sendOverdueUser",
    {
      recipients: [targetUserId],
      message: userMessage,
      replyMarkup: buildUserOverdueReplyMarkup(userItems),
    },
    { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  );

  return { sent: true, count: userItems.length, userId: targetUserId };
}

async function runOverdueCheck(envAdminIds, overdueDays) {
  if (!envAdminIds || envAdminIds.length === 0) {
    logger.warn("Notification scheduler: no ADMIN_IDS, skipping");
    return { sent: false, count: 0 };
  }

  try {
    const overdueItems = await findOverdueEquipment(overdueDays);
    if (overdueItems.length === 0) {
      logger.info("Overdue check: no overdue items");
      return { sent: false, count: 0 };
    }

    logger.info(
      { count: overdueItems.length },
      `Overdue check: ${overdueItems.length} overdue items`,
    );

    const roleAdmins = await getUsersByRole("admin");
    const allAdminIds = [
      ...new Set([
        ...envAdminIds,
        ...roleAdmins.map((user) => user.telegram_user_id),
      ]),
    ];

    const itemsByUser = overdueItems.reduce((accumulator, item) => {
      const holderId = item.current_holder_user_id;
      if (!holderId) return accumulator;
      if (!accumulator[holderId]) accumulator[holderId] = [];
      accumulator[holderId].push(item);
      return accumulator;
    }, {});

    const userIds = Object.keys(itemsByUser).map(Number);
    const usersMap = await getUsersByTelegramIds(userIds);

    const adminMessage = buildAdminOverdueMessage(
      itemsByUser,
      overdueDays,
      usersMap,
    );
    logger.info(
      { recipients: allAdminIds },
      'Adding sendOverdueAdmins job to queue',
    );
    const adminJob = await notificationQueue.add(
      "sendOverdueAdmins",
      { recipients: allAdminIds, message: adminMessage },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    );
    logger.info(
      { jobId: adminJob.id, jobName: adminJob.name },
      'sendOverdueAdmins job added to queue',
    );

    // Give the admin job a moment to be picked up by the worker
    await new Promise((resolve) => setTimeout(resolve, 50));

    for (const [userId, userItems] of Object.entries(itemsByUser)) {
      if (allAdminIds.includes(Number(userId))) continue;

      const userMessage = buildUserOverdueMessage(
        userId,
        userItems,
        overdueDays,
        usersMap,
      );
      logger.info(
        { userId, itemCount: userItems.length },
        'Adding sendOverdueUser job to queue',
      );
      const userJob = await notificationQueue.add(
        "sendOverdueUser",
        {
          recipients: [Number(userId)],
          message: userMessage,
          replyMarkup: buildUserOverdueReplyMarkup(userItems),
        },
        { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
      );
      logger.info(
        { jobId: userJob.id, userId, itemCount: userItems.length },
        'sendOverdueUser job added to queue',
      );
    }

    return { sent: true, count: overdueItems.length };
  } catch (err) {
    logger.error({ err: err.message }, "Overdue check failed");
    throw err;
  }
}

async function scheduleOverdueCheck(envAdminIds, overdueDays) {
  let intervalHandle = null;

  async function runCheck() {
    try {
      await runOverdueCheck(envAdminIds, overdueDays);
    } catch (_) {
      // Already logged in runOverdueCheck
    }
  }

  const initialTimeout = setTimeout(() => {
    runCheck();
    intervalHandle = setInterval(runCheck, CHECK_INTERVAL_MS);
  }, 60_000);

  logger.info(
    `Notification scheduler started (interval=12h, threshold=${overdueDays}d)`,
  );

  return {
    initialTimeout,
    get interval() {
      return intervalHandle;
    },
  };
}

module.exports = {
  buildUserOverdueReplyMarkup,
  enqueueOverdueNotificationForUser,
  notificationQueue,
  runOverdueCheck,
  scheduleOverdueCheck,
};
