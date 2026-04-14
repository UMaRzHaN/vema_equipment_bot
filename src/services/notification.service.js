const logger = require("../utils/logger");
const { findOverdueEquipment } = require("./history.service");
const { formatDate } = require("../utils/formatters");

// Интервал проверки: каждые 12 часов
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

// По умолчанию: уведомлять если оборудование у пользователя более 7 дней
const DEFAULT_OVERDUE_DAYS = Number(process.env.OVERDUE_DAYS) || 7;

function buildOverdueMessage(items) {
  const lines = items.map((item) => {
    const name = `${item.category || "-"} ${item.model || "-"} (${item.serial_number || item.inventory_number || `#${item.id}`})`;
    const since = formatDate(item.current_issue_date);
    return `• ${name}\n  Выдано: ${since}`;
  });

  return (
    `⚠️ Оборудование не возвращено более ${DEFAULT_OVERDUE_DAYS} дней:\n\n` +
    lines.join("\n\n")
  );
}

function startNotificationScheduler(bot, adminIds) {
  if (!adminIds || adminIds.length === 0) {
    logger.warn("Notification scheduler: no ADMIN_IDS, skipping");
    return;
  }

  logger.info(`Notification scheduler started (every 12h, threshold: ${DEFAULT_OVERDUE_DAYS} days)`);

  async function runCheck() {
    try {
      const overdueItems = findOverdueEquipment(DEFAULT_OVERDUE_DAYS);

      if (overdueItems.length === 0) {
        logger.info("Overdue check: no overdue items");
        return;
      }

      logger.info(`Overdue check: found ${overdueItems.length} overdue items, notifying admins`);

      const message = buildOverdueMessage(overdueItems);

      for (const adminId of adminIds) {
        try {
          await bot.telegram.sendMessage(adminId, message);
        } catch (err) {
          logger.error(`Failed to notify admin ${adminId}:`, { err: err.message });
        }
      }
    } catch (err) {
      logger.error("Overdue check error:", { err: err.message });
    }
  }

  // Запуск через 1 минуту после старта (чтобы бот успел инициализироваться)
  setTimeout(() => {
    runCheck();
    setInterval(runCheck, CHECK_INTERVAL_MS);
  }, 60 * 1000);
}

module.exports = { startNotificationScheduler };
