'use strict';

const { Markup } = require('telegraf');
const { STATUS } = require('../../utils/constants');
const { getEquipmentTimeline, getLastRepairComment } = require('../../services/history.service');
const { formatUser, getUserByTelegramId } = require('../../services/user.service');
const { formatDate, statusLabel } = require('../../utils/formatters');

function buildEquipmentButtons(item, { canAdmin = false, canRepair = false } = {}) {
  const rows = [];

  if (item.status === STATUS.IN_STOCK) {
    const row = [Markup.button.callback('📤 Взять себе', `give_${item.id}`)];
    if (canRepair) row.push(Markup.button.callback('🔧 В ремонт', `repair_${item.id}`));
    rows.push(row);
  }
  if (item.status === STATUS.WITH_USER) {
    rows.push([Markup.button.callback('↩️ Вернуть', `return_${item.id}`)]);
  }
  if (item.status === STATUS.REPAIR && canRepair) {
    rows.push([Markup.button.callback('♻️ Из ремонта', `fromRepair_${item.id}`)]);
  }
  if (item.status !== STATUS.WRITTEN_OFF) {
    rows.push([Markup.button.callback('📋 История', `history_${item.id}`)]);
  }
  if (canAdmin) {
    const adminRow = [
      Markup.button.callback('✏️ Редактировать', `edit_${item.id}`),
      Markup.button.callback('🗑️ Удалить', `delete_${item.id}`),
    ];
    if (item.status !== STATUS.WRITTEN_OFF) {
      adminRow.push(Markup.button.callback('📴 Списать', `writeoff_${item.id}`));
    }
    rows.push(adminRow);
  }

  return rows;
}

function buildEquipmentMarkup(item, { canAdmin = false, canRepair = false } = {}) {
  const rows = buildEquipmentButtons(item, { canAdmin, canRepair });
  return rows.length ? Markup.inlineKeyboard(rows) : null;
}

async function renderEquipmentCard(item) {
  const holderUser = item.current_holder_user_id
    ? await getUserByTelegramId(item.current_holder_user_id)
    : null;
  const user     = formatUser(holderUser);
  const timeline = await getEquipmentTimeline(item.id);
  const repairComment = await getLastRepairComment(item.id);
  const commentLine   = repairComment ? `Комментарий к ремонту: ${repairComment}\n` : '';

  return `#${item.inventory_number || '-'} ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}

Статус: ${statusLabel(item.status)}
Пользователь: ${user}

Дата выдачи: ${formatDate(item.current_issue_date)}
Дата сдачи: ${formatDate(timeline.lastReturnDate)}
Дата ремонта: ${formatDate(timeline.lastRepairDate)}
${commentLine}`;
}

module.exports = { buildEquipmentMarkup, renderEquipmentCard };
