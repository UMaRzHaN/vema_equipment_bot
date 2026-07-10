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
const OVERDUE_LOCK_KEY = "notifications:overdue-check:lock";
const OVERDUE_LOCK_TTL_MS = 10 * 60 * 1000;
const OVERDUE_JOB_TTL_SECONDS = 15 * 60;

function buildUserOverdueReplyMarkup() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("⏳ Продлить", "extendAllMy"),
      Markup.button.callback("↩️ Вернуть", "returnAllMy"),
    ],
  ]).reply_markup;
}

function buildRegistrationApprovalReplyMarkup(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Разрешить регистрацию", `approve_registration_${Number(userId)}`)],
  ]).reply_markup;
}

function buildUserLink(userId, usersMap) {
  const normalizedUserId = String(userId);
  const user = usersMap.get(normalizedUserId) || usersMap.get(Number(userId));
  const label = escapeHtml(formatUser(user) || String(userId));
  if (user?.username) {
    return `<a href="https://t.me/${encodeURIComponent(user.username)}">${label}</a>`;
  }
  return `<a href="tg://user?id=${Number(userId)}">${label}</a>`;
}

function buildSingleUserLink(user) {
  const label = escapeHtml(formatUser(user) || String(user?.telegram_user_id || "unknown"));
  if (user?.username) {
    return `<a href="https://t.me/${encodeURIComponent(user.username)}">${label}</a>`;
  }
  return `<a href="tg://user?id=${Number(user?.telegram_user_id)}">${label}</a>`;
}

async function acquireOverdueCheckLock() {
  const lockValue = `${process.pid}:${Date.now()}`;
  const acquired = await bullRedis.set(
    OVERDUE_LOCK_KEY,
    lockValue,
    "PX",
    OVERDUE_LOCK_TTL_MS,
    "NX",
  );
  return acquired === "OK" ? lockValue : null;
}

async function releaseOverdueCheckLock(lockValue) {
  const currentValue = await bullRedis.get(OVERDUE_LOCK_KEY);
  if (currentValue === lockValue) {
    await bullRedis.del(OVERDUE_LOCK_KEY);
  }
}

function buildNotificationJobOptions(jobId) {
  return {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 20,
  };
}

function buildOverdueJobId(kind, recipientId) {
  const windowKey = Math.floor(Date.now() / (OVERDUE_JOB_TTL_SECONDS * 1000));
  return `${kind}:${recipientId}:${windowKey}`;
}

function buildStableNotificationJobId(kind, entityId) {
  return `${kind}:${entityId}`;
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

function buildNewRegistrationMessage(user) {
  const nameLink = buildSingleUserLink(user);
  const phone = escapeHtml(user?.phone || "—");
  return `🆕 Запрос на регистрацию\n\nПользователь: ${nameLink}\nТелефон: ${phone}\n\nРазрешить регистрацию?`;
}

function buildRegistrationApprovedMessage() {
  return "✅ Администратор подтвердил вашу регистрацию. Теперь бот доступен.";
}

function buildAdminOverdueMessageForRecipient(recipientId, itemsByUser, overdueDays, usersMap) {
  void overdueDays;
  const recipientNumericId = Number(recipientId);
  const sections = Object.entries(itemsByUser)
    .filter(([userId]) => Number(userId) !== recipientNumericId)
    .map(([userId, items]) => buildUserSection(userId, items, usersMap))
    .join("\n\n");

  if (!sections) return null;

  return `⚠️ Есть просроченное оборудование.\n\n${sections}`;
}

function buildUserOverdueMessage(userId, items, overdueDays, usersMap) {
  void overdueDays;
  const greeting = buildUserLink(userId, usersMap);
  const lines = items.map(buildEquipmentLine).join("\n\n");

  return [
    `⚠️ ${greeting}, у вас есть просроченное оборудование.`,
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
      replyMarkup: buildUserOverdueReplyMarkup(),
    },
    buildNotificationJobOptions(buildOverdueJobId("sendOverdueUser", targetUserId)),
  );

  return { sent: true, count: userItems.length, userId: targetUserId };
}

async function enqueueNewRegistrationNotification(userId, envAdminIds = []) {
  const targetUserId = Number(userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new Error("Invalid telegram_user_id");
  }

  const roleAdmins = await getUsersByRole("admin");
  const allAdminIds = [
    ...new Set([
      ...envAdminIds,
      ...roleAdmins.map((user) => user.telegram_user_id),
    ]),
  ]
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!allAdminIds.length) {
    logger.warn({ userId: targetUserId }, "Skipping new registration notification: no admins configured");
    return { sent: false, recipients: 0 };
  }

  const usersMap = await getUsersByTelegramIds([targetUserId]);
  const user = usersMap.get(String(targetUserId)) || null;
  if (!user) {
    logger.warn({ userId: targetUserId }, "Skipping new registration notification: user missing from users table");
    return { sent: false, recipients: 0 };
  }

  const notificationJob = await notificationQueue.add(
    "sendNewRegistrationAdmins",
    {
      recipients: allAdminIds,
      message: buildNewRegistrationMessage(user),
      replyMarkup: buildRegistrationApprovalReplyMarkup(targetUserId),
    },
    buildNotificationJobOptions(buildStableNotificationJobId("sendNewRegistrationAdmins", targetUserId)),
  );

  logger.info(
    { jobId: notificationJob.id, jobName: notificationJob.name, userId: targetUserId, recipientCount: allAdminIds.length },
    "sendNewRegistrationAdmins job added to queue",
  );

  return { sent: true, recipients: allAdminIds.length };
}

async function enqueueRegistrationApprovedNotification(userId) {
  const targetUserId = Number(userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new Error("Invalid telegram_user_id");
  }

  const notificationJob = await notificationQueue.add(
    "sendRegistrationApprovedUser",
    {
      recipients: [targetUserId],
      message: buildRegistrationApprovedMessage(),
    },
    buildNotificationJobOptions(buildStableNotificationJobId("sendRegistrationApprovedUser", targetUserId)),
  );

  logger.info(
    { jobId: notificationJob.id, jobName: notificationJob.name, userId: targetUserId },
    "sendRegistrationApprovedUser job added to queue",
  );

  return { sent: true, recipients: 1 };
}

async function runOverdueCheck(envAdminIds, overdueDays) {
  if (!envAdminIds || envAdminIds.length === 0) {
    logger.warn("Notification scheduler: no ADMIN_IDS, skipping");
    return { sent: false, count: 0 };
  }

  const lockValue = await acquireOverdueCheckLock();
  if (!lockValue) {
    logger.warn("Overdue check skipped: another instance is already running");
    return { sent: false, count: 0, skipped: true };
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
    ]
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);

    const itemsByUser = overdueItems.reduce((accumulator, item) => {
      const holderId = item.current_holder_user_id;
      if (!holderId) return accumulator;
      if (!accumulator[holderId]) accumulator[holderId] = [];
      accumulator[holderId].push(item);
      return accumulator;
    }, {});

    const userIds = Object.keys(itemsByUser).map(Number);
    const usersMap = await getUsersByTelegramIds(userIds);

    for (const adminId of allAdminIds) {
      const adminMessage = buildAdminOverdueMessageForRecipient(
        adminId,
        itemsByUser,
        overdueDays,
        usersMap,
      );
      if (!adminMessage) continue;

      logger.info(
        { recipient: adminId },
        "Adding sendOverdueAdmins job to queue",
      );
      const adminJob = await notificationQueue.add(
        "sendOverdueAdmins",
        { recipients: [adminId], message: adminMessage },
        buildNotificationJobOptions(buildOverdueJobId("sendOverdueAdmins", adminId)),
      );
      logger.info(
        { jobId: adminJob.id, jobName: adminJob.name, recipient: adminId },
        "sendOverdueAdmins job added to queue",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    for (const [userId, userItems] of Object.entries(itemsByUser)) {
      if (allAdminIds.includes(Number(userId))) continue;
      if (!usersMap.has(String(userId))) {
        logger.warn(
          { userId, itemCount: userItems.length },
          "Skipping sendOverdueUser job: holder is missing from users table",
        );
        continue;
      }

      const userMessage = buildUserOverdueMessage(
        userId,
        userItems,
        overdueDays,
        usersMap,
      );
      logger.info(
        { userId, itemCount: userItems.length },
        "Adding sendOverdueUser job to queue",
      );
      const userJob = await notificationQueue.add(
        "sendOverdueUser",
        {
          recipients: [Number(userId)],
          message: userMessage,
          replyMarkup: buildUserOverdueReplyMarkup(),
        },
        buildNotificationJobOptions(buildOverdueJobId("sendOverdueUser", Number(userId))),
      );
      logger.info(
        { jobId: userJob.id, userId, itemCount: userItems.length },
        "sendOverdueUser job added to queue",
      );
    }

    return { sent: true, count: overdueItems.length };
  } catch (err) {
    logger.error({ err: err.message }, "Overdue check failed");
    throw err;
  } finally {
    await releaseOverdueCheckLock(lockValue);
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
  buildNewRegistrationMessage,
  buildRegistrationApprovalReplyMarkup,
  buildRegistrationApprovedMessage,
  buildUserOverdueReplyMarkup,
  enqueueNewRegistrationNotification,
  enqueueOverdueNotificationForUser,
  enqueueRegistrationApprovedNotification,
  notificationQueue,
  runOverdueCheck,
  scheduleOverdueCheck,
};
