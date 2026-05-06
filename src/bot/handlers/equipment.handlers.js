'use strict';

const { Markup } = require('telegraf');
const { isAdmin, hasRole, isEffectiveAdmin, isEffectiveManager } = require('../config');
const logger = require('../../utils/logger');
const { safe } = require('../middlewares/error.handler');
const { buildBackKeyboard, buildEditEquipmentKeyboard, buildLocationRequestKeyboard, mainMenu } = require('../views/menus');
const { buildEquipmentMarkup, renderEquipmentCard } = require('../views/equipment.view');
const { ensureSession } = require('../utils');
const { makeFlow } = require('../fsm/session.schema');
const { FLOW_TYPE, EDIT_STEP } = require('../fsm/states');
const { formatDate, statusLabel } = require('../../utils/formatters');
const { getUserByTelegramId, formatUser } = require('../../services/user.service');
const { getFullEquipmentHistory } = require('../../services/history.service');
const { redis } = require('../../redis');
const { ACTIONS_REGEX, LABELS } = require('../constants');
const {
  STATUS,
  completeRepair,
  findEquipmentById,
  removeEquipment,
} = require('../../services/equipment.service');
const { equipmentActionsTotal } = require('../../utils/metrics');

function rememberMessage(message) {
  if (!message) return null;
  return { chatId: message.chat.id, messageId: message.message_id };
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Acquire a short-lived Redis lock to prevent double-click races */
async function acquireLock(key, ttlMs = 3000) {
  const result = await redis.set(key, '1', 'NX', 'PX', ttlMs);
  return result === 'OK';
}

function renderHistoryText(item, entries) {
  const title = `📋 История: ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}\n\n`;
  if (!entries.length) return `${title}Записей нет.`;

  const lines = entries.map((e) => {
    const who = e.first_name
      ? `${e.first_name}${e.last_name ? ' ' + e.last_name : ''}`
      : e.username ? `@${e.username}` : '—';
    const statusChange = e.from_status && e.to_status
      ? ` (${statusLabel(e.from_status)} → ${statusLabel(e.to_status)})` : '';
    const comment = e.comment ? `\n   💬 ${e.comment}` : '';
    return `• ${formatDate(e.action_date)} — ${e.action}${statusChange}\n   👤 ${who}${comment}`;
  });

  return `${title}${lines.join('\n\n')}`;
}

/** Fast env-based check first; falls back to DB role lookup. */
async function canAdminEquipment(ctx) {
  if (isAdmin(ctx)) return true;
  const user = await getUserByTelegramId(ctx.from.id);
  return user?.role === 'admin';
}

/** manager or admin can manage repairs; regular users cannot. */
async function canManageEquipment(ctx) {
  if (isAdmin(ctx)) return true;
  const user = await getUserByTelegramId(ctx.from.id);
  return hasRole(user?.role, 'manager');
}

function registerEquipmentHandlers(bot) {
  // Open equipment card
  bot.action(ACTIONS_REGEX.OPEN, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply(LABELS.ERR_INVALID_ID);
    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    const markup = buildEquipmentMarkup(item, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
    const text   = await renderEquipmentCard(item);
    return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
  }, 'open'));

  // Equipment history
  bot.action(ACTIONS_REGEX.HISTORY, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply(LABELS.ERR_INVALID_ID);
    const item    = await findEquipmentById(id);
    if (!item) return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    const entries = await getFullEquipmentHistory(id, 10);
    return ctx.editMessageText(renderHistoryText(item, entries), {
      reply_markup: { inline_keyboard: [[{ text: '← К карточке', callback_data: `open_${id}` }]] },
    });
  }, 'history'));

  // Give equipment — ask for duration first
  bot.action(ACTIONS_REGEX.GIVE, safe(async (ctx) => {
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery(LABELS.ERR_INVALID_ID, { show_alert: true }); return; }

    const item = await findEquipmentById(id);
    if (!item) { await ctx.answerCbQuery(LABELS.ERR_NOT_FOUND, { show_alert: true }); return; }
    if (item.status !== STATUS.IN_STOCK) { await ctx.answerCbQuery('Оборудование недоступно для выдачи.', { show_alert: true }); return; }

    await ctx.answerCbQuery();
    ensureSession(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.GIVE_EQUIPMENT, 1, {}, {
      equipmentId: id,
      sourceMessage: rememberMessage(ctx.callbackQuery?.message),
    });
    const prompt = await ctx.reply('На сколько дней берёте оборудование? Введите число:', buildBackKeyboard());
    ctx.session.flow.promptMessage = rememberMessage(prompt);
  }, 'give'));

  // Extend due date
  bot.action(/extend_(\d+)/, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return;
    const item = await findEquipmentById(id);
    if (!item) return ctx.reply('Оборудование не найдено.');
    if (item.status !== STATUS.WITH_USER) return ctx.reply('Оборудование уже возвращено.');
    if (Number(item.current_holder_user_id) !== ctx.from.id && !isEffectiveAdmin(ctx)) {
      return ctx.reply('Это оборудование не у вас.');
    }
    ensureSession(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.EXTEND_EQUIPMENT, 1, {}, { equipmentId: id });
    const prompt = await ctx.reply('На сколько дней продлить срок? Введите число:', buildBackKeyboard());
    ctx.session.flow.promptMessage = rememberMessage(prompt);
  }, 'extend'));

  // Return equipment
  bot.action(/return_(\d+)/, safe(async (ctx) => {
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery('Неверный идентификатор.', { show_alert: true }); return; }

    const locked = await acquireLock(`lock:return:${id}`);
    if (!locked) { await ctx.answerCbQuery('Действие уже выполняется…', { show_alert: true }); return; }

    const item = await findEquipmentById(id);
    if (!item) { await ctx.answerCbQuery('Оборудование не найдено.', { show_alert: true }); return; }
    if (item.status !== STATUS.WITH_USER) { await ctx.answerCbQuery('Оборудование не выдано.', { show_alert: true }); return; }
    if (Number(item.current_holder_user_id) !== ctx.from.id) {
      await ctx.answerCbQuery('Это оборудование выдано другому пользователю.', { show_alert: true }); return;
    }

    await ctx.answerCbQuery();
    ensureSession(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.RETURN_LOCATION, 1, {}, { equipmentId: id, sourceMessage: rememberMessage(ctx.callbackQuery?.message) });
    const prompt = await ctx.reply(
      'Отправьте вашу локацию или введите название города вручную:',
      buildLocationRequestKeyboard(),
    );
    ctx.session.flow.promptMessage = rememberMessage(prompt);
  }, 'return'));

  // Send to repair
  bot.action(/repair_(\d+)/, safe(async (ctx) => {
    if (!await canManageEquipment(ctx)) return ctx.answerCbQuery('Нет прав для этого действия.', { show_alert: true });
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply('Неверный идентификатор.');
    const item = await findEquipmentById(id);
    if (!item) return ctx.reply('Оборудование не найдено.');
    if (item.status === STATUS.REPAIR) return ctx.reply('Оборудование уже в ремонте.');
    ensureSession(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.REPAIR, 1, {}, { equipmentId: id, sourceMessage: rememberMessage(ctx.callbackQuery?.message) });
    const prompt = await ctx.reply('Введите причину ремонта:');
    ctx.session.flow.promptMessage = rememberMessage(prompt);
  }, 'repair'));

  // Complete repair
  bot.action(/fromRepair_(\d+)/, safe(async (ctx) => {
    if (!await canManageEquipment(ctx)) { await ctx.answerCbQuery('Нет прав для этого действия.', { show_alert: true }); return; }
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery('Неверный идентификатор.', { show_alert: true }); return; }

    const locked = await acquireLock(`lock:fromRepair:${id}`);
    if (!locked) { await ctx.answerCbQuery('Действие уже выполняется…', { show_alert: true }); return; }

    const item = await findEquipmentById(id);
    if (!item) { await ctx.answerCbQuery('Оборудование не найдено.', { show_alert: true }); return; }
    if (item.status !== STATUS.REPAIR) { await ctx.answerCbQuery('Оборудование не в ремонте.', { show_alert: true }); return; }
    await ctx.answerCbQuery('✅ Возвращено из ремонта');
    const updated = await completeRepair(item, ctx.from.id);
    equipmentActionsTotal.inc({ action: 'repair_completed' });
    const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
    const text   = await renderEquipmentCard(updated);
    return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
  }, 'fromRepair'));

  // Write-off
  bot.action(/writeoff_(\d+)/, safe(async (ctx) => {
    if (!await canAdminEquipment(ctx)) return ctx.answerCbQuery('Только администратор может списывать.', { show_alert: true });
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply('Неверный идентификатор.');
    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText('Оборудование не найдено.');
    if (item.status === STATUS.WRITTEN_OFF) return ctx.editMessageText('Уже списано.');
    ensureSession(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.WRITEOFF, 1, {}, { equipmentId: id, sourceMessage: rememberMessage(ctx.callbackQuery?.message) });
    const prompt = await ctx.reply('Введите причину списания (или отправьте — чтобы пропустить):');
    ctx.session.flow.promptMessage = rememberMessage(prompt);
  }, 'writeoff'));

  // Edit
  bot.action(/edit_(\d+)/, safe(async (ctx) => {
    if (!await canAdminEquipment(ctx)) return ctx.answerCbQuery('Только администратор может редактировать.', { show_alert: true });
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply('Неверный идентификатор.');
    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText('Оборудование не найдено.');
    ensureSession(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.EDIT_EQUIPMENT, EDIT_STEP.SELECT_FIELD, {}, { equipmentId: id, sourceMessage: rememberMessage(ctx.callbackQuery?.message) });
    const sel = await ctx.reply('Выберите поле для редактирования:', buildEditEquipmentKeyboard({ isInStock: item.status === STATUS.IN_STOCK }));
    ctx.session.flow.selectorMessage = rememberMessage(sel);
  }, 'edit'));

  // Delete (ask confirmation)
  bot.action(/delete_(\d+)/, safe(async (ctx) => {
    if (!await canAdminEquipment(ctx)) return ctx.answerCbQuery('Только администратор может удалять.', { show_alert: true });
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply('Неверный идентификатор.');
    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText('Оборудование не найдено.');
    const label = `${item.category || '-'} ${item.model || '-'} — ${item.serial_number || `#${item.id}`}`;
    return ctx.editMessageText(
      `❓ Удалить оборудование?\n\n${label}\n\nЭто действие необратимо.`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Да, удалить', `confirmDelete_${item.id}`),
          Markup.button.callback('❌ Отмена',      `open_${item.id}`),
        ],
      ]),
    );
  }, 'delete'));

  // Confirm delete
  bot.action(/confirmDelete_(\d+)/, safe(async (ctx) => {
    if (!await canAdminEquipment(ctx)) return ctx.answerCbQuery('Нет прав.', { show_alert: true });
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply('Неверный идентификатор.');
    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText('Оборудование уже удалено.');
    const label = `${item.category || '-'} ${item.model || '-'} — ${item.serial_number || `#${item.id}`}`;
    await removeEquipment(id);
    equipmentActionsTotal.inc({ action: 'deleted' });
    await ctx.editMessageText(`🗑️ Оборудование удалено: ${label}`);
    return ctx.reply('Выберите действие:', mainMenu(ctx));
  }, 'confirmDelete'));
}

module.exports = { registerEquipmentHandlers };
