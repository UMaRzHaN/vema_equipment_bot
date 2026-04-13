const { Markup } = require("telegraf");
const { STATUS } = require("../../utils/constants");
const { getEquipmentTimeline, getLastRepairComment } = require("../../services/history.service");
const { formatUser, getUserByTelegramId } = require("../../services/user.service");
const { formatDate, statusLabel } = require("./formatters");

function buildEquipmentButtons(item, canManage = false) {
  const rows = [];

  if (item.status === STATUS.IN_STOCK) {
    rows.push([
      Markup.button.callback("📤 Выдать", `give_${item.id}`),
      Markup.button.callback("🔧 В ремонт", `repair_${item.id}`),
    ]);
  }

  if (item.status === STATUS.WITH_USER) {
    rows.push([Markup.button.callback("↩️ Вернуть", `return_${item.id}`)]);
  }

  if (item.status === STATUS.REPAIR) {
    rows.push([Markup.button.callback("♻️ Из ремонта", `fromRepair_${item.id}`)]);
  }

  if (canManage) {
    rows.push([
      Markup.button.callback("✏️ Редактировать", `edit_${item.id}`),
      Markup.button.callback("🗑️ Удалить", `delete_${item.id}`),
    ]);
  }

  return rows;
}

function buildEquipmentMarkup(item, canManage = false) {
  const rows = buildEquipmentButtons(item, canManage);
  return rows.length ? Markup.inlineKeyboard(rows) : null;
}

function renderEquipmentCard(item) {
  const user = item.current_holder_user_id
    ? formatUser(getUserByTelegramId(item.current_holder_user_id))
    : "-";
  const timeline = getEquipmentTimeline(item.id);
  const repairComment = getLastRepairComment(item.id);
  const commentLine = repairComment
    ? `Комментарий к ремонту: ${repairComment}\n`
    : "";

  return `${item.category || "-"} ${item.model || "-"} - ${item.serial_number || "-"}

Статус: ${statusLabel(item.status)}
Пользователь: ${user}

Дата выдачи: ${formatDate(item.current_issue_date)}
Дата сдачи: ${formatDate(timeline.lastReturnDate)}
Дата ремонта: ${formatDate(timeline.lastRepairDate)}
${commentLine}`;
}

module.exports = {
  buildEquipmentMarkup,
  renderEquipmentCard,
};
