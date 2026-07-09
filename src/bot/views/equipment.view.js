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
    const row = [Markup.button.callback('\uD83D\uDCE4 \u0412\u0437\u044F\u0442\u044C \u0441\u0435\u0431\u0435', `give_${item.id}`)];
    if (canSendToRepair) row.push(Markup.button.callback('\uD83D\uDD27 \u0412 \u0440\u0435\u043C\u043E\u043D\u0442', `repair_${item.id}`));
    rows.push(row);
  }

  if (item.status === STATUS.WITH_USER) {
    rows.push([
      Markup.button.callback('\u23F3 \u041F\u0440\u043E\u0434\u043B\u0438\u0442\u044C', `extend_${item.id}`),
      Markup.button.callback('\u21A9\uFE0F \u0412\u0435\u0440\u043D\u0443\u0442\u044C', `return_${item.id}`),
    ]);
    if (canSendToRepair) {
      rows.push([Markup.button.callback('\uD83D\uDD27 \u0412 \u0440\u0435\u043C\u043E\u043D\u0442', `repair_${item.id}`)]);
    }
  }

  if (item.status === STATUS.REPAIR && canRepair) {
    rows.push([Markup.button.callback('\u267B\uFE0F \u0418\u0437 \u0440\u0435\u043C\u043E\u043D\u0442\u0430', `fromRepair_${item.id}`)]);
  }

  if (item.status !== STATUS.WRITTEN_OFF) {
    rows.push([Markup.button.callback('\uD83D\uDCCB \u0418\u0441\u0442\u043E\u0440\u0438\u044F', `history_${item.id}`)]);
  }

  if (canAdmin) {
    const adminRow = [
      Markup.button.callback('\u270F\uFE0F \u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C', `edit_${item.id}`),
      Markup.button.callback('\uD83D\uDDD1\uFE0F \u0423\u0434\u0430\u043B\u0438\u0442\u044C', `delete_${item.id}`),
    ];
    if (item.status !== STATUS.WRITTEN_OFF) {
      adminRow.push(Markup.button.callback('\uD83D\uDCF4 \u0421\u043F\u0438\u0441\u0430\u0442\u044C', `writeoff_${item.id}`));
    }
    rows.push(adminRow);
  }

  return rows;
}

function buildEquipmentMarkup(item, { canAdmin = false, canRepair = false } = {}) {
  const rows = buildEquipmentButtons(item, { canAdmin, canRepair });
  
  // Always include history button if equipment exists and no other buttons
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
    ? `\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u043A \u0440\u0435\u043C\u043E\u043D\u0442\u0443: ${repairComment}\n`
    : '';
  const components = normalizeComponents(item.components);
  const componentsLine = item.status === STATUS.WITH_USER && components.length
    ? `\u041A\u043E\u043C\u043F\u043B\u0435\u043A\u0442\u0443\u044E\u0449\u0438\u0435: ${components.map(formatComponent).join(', ')}\n`
    : '';
  const warehouseLine = item.warehouse ? `\u0421\u043A\u043B\u0430\u0434: ${item.warehouse}\n` : '';

  return `#${item.position || '-'} ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}

\u0421\u0442\u0430\u0442\u0443\u0441: ${statusLabel(item.status)}
${warehouseLine}${componentsLine}\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C: ${user}

\u0414\u0430\u0442\u0430 \u0432\u044B\u0434\u0430\u0447\u0438: ${formatDate(item.current_issue_date)}
\u0414\u0430\u0442\u0430 \u0441\u0434\u0430\u0447\u0438: ${formatDate(timeline.lastReturnDate)}
\u0414\u0430\u0442\u0430 \u0440\u0435\u043C\u043E\u043D\u0442\u0430: ${formatDate(timeline.lastRepairDate)}
${repairCommentLine}`;
}

module.exports = { buildEquipmentMarkup, renderEquipmentCard };
