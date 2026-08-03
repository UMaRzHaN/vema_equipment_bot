'use strict';

const { Markup } = require('telegraf');
const { STATUS } = require('../../utils/constants');
const { getEquipmentTimeline, getLastRepairComment } = require('../../services/history.service');
const { formatUser, getUserByTelegramId } = require('../../services/user.service');
const { formatDate, statusLabel } = require('../../utils/formatters');
const { formatComponent, normalizeComponents } = require('../../utils/components');

function buildEquipmentButtons(item, { canAdmin = false, canRepair = false } = {}) {
  const rows = [];
  const canSendToRepair = canRepair
    && item.status !== STATUS.REPAIR
    && item.status !== STATUS.WRITTEN_OFF;

  if (item.status === STATUS.IN_STOCK) {
    const row = [Markup.button.callback('📤 Взять себе', `give_${item.id}`)];
    if (canSendToRepair) row.push(Markup.button.callback('🔧 В ремонт', `repair_${item.id}`));
    rows.push(row);
  }

  if (item.status === STATUS.WITH_USER) {
    rows.push([
      Markup.button.callback('⏳ Продлить', `extend_${item.id}`),
      Markup.button.callback('↩️ Вернуть', `return_${item.id}`),
    ]);
    if (canSendToRepair) {
      rows.push([Markup.button.callback('🔧 В ремонт', `repair_${item.id}`)]);
    }
  }

  if (item.status === STATUS.REPAIR && canRepair) {
    rows.push([Markup.button.callback('♻️ Из ремонта', `fromRepair_${item.id}`)]);
  }

  if (item.status !== STATUS.WRITTEN_OFF) {
    rows.push([Markup.button.callback('📋 История', `history_${item.id}`)]);
  }

  if (canAdmin) {
    rows.push([
      Markup.button.callback('✏️ Редактировать', `edit_${item.id}`),
      Markup.button.callback('🗑️ Удалить', `delete_${item.id}`),
    ]);
  }

  return rows;
}

function buildEquipmentMarkup(item, { canAdmin = false, canRepair = false } = {}) {
  const rows = buildEquipmentButtons(item, { canAdmin, canRepair });

  if (!rows.length && item.id) {
    rows.push([Markup.button.callback('📋 История', `history_${item.id}`)]);
  }

  if (rows.length) {
    return Markup.inlineKeyboard(rows);
  }

  return null;
}

async function renderEquipmentCard(item) {
  const holderUser = item.current_holder_user_id
    ? await getUserByTelegramId(item.current_holder_user_id)
    : null;
  const user = formatUser(holderUser);
  const timeline = await getEquipmentTimeline(item.id);
  const repairComment = await getLastRepairComment(item.id);
  const repairCommentLine = repairComment
    ? `Комментарий к ремонту: ${repairComment}\n`
    : '';
  const components = normalizeComponents(item.components);
  const componentsLine = item.status === STATUS.WITH_USER && components.length
    ? `Комплектующие: ${components.map(formatComponent).join(', ')}\n`
    : '';
  const warehouseLine = item.status === STATUS.IN_STOCK && item.warehouse
    ? `Склад: ${item.warehouse}\n`
    : '';

  return `#${item.position || '-'} ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}

Статус: ${statusLabel(item.status)}
${warehouseLine}${componentsLine}Пользователь: ${user}

Дата выдачи: ${formatDate(item.current_issue_date)}
Дата сдачи: ${formatDate(timeline.lastReturnDate)}
Дата ремонта: ${formatDate(timeline.lastRepairDate)}
${repairCommentLine}`;
}

module.exports = { buildEquipmentMarkup, renderEquipmentCard };
