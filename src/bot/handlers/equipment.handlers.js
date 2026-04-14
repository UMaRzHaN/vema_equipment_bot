'use strict';

const { Markup } = require('telegraf');
const { isAdmin } = require('../config');
const logger = require('../../utils/logger');
const { buildEditEquipmentKeyboard, mainMenu } = require('../views/menus');
const { buildEquipmentMarkup, renderEquipmentCard } = require('../views/equipment.view');
const { ensureSession } = require('../utils');
const { formatDate, statusLabel } = require('../../utils/formatters');
const { getUserByTelegramId, formatUser } = require('../../services/user.service');
const { getFullEquipmentHistory } = require('../../services/history.service');
const { redis } = require('../../redis');
const {
  STATUS,
  completeRepair,
  findEquipmentById,
  giveEquipmentToUser,
  removeEquipment,
  returnEquipmentFromUser,
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

function registerEquipmentHandlers(bot) {
  // Open equipment card
  bot.action(/open_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const id = parseId(ctx.match[1]);
      if (!id) return ctx.reply('Неверный идентификатор.');
      const item = await findEquipmentById(id);
      if (!item) return ctx.editMessageText('Оборудование не найдено.');
      const markup = buildEquipmentMarkup(item, isAdmin(ctx));
      const text   = await renderEquipmentCard(item);
      return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
    } catch (err) {
      logger.error('open action error', { err: err.message });
    }
  });

  // Equipment history
  bot.action(/history_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const id = parseId(ctx.match[1]);
      if (!id) return ctx.reply('Неверный идентификатор.');
      const item    = await findEquipmentById(id);
      if (!item) return ctx.editMessageText('Оборудование не найдено.');
      const entries = await getFullEquipmentHistory(id, 10);
      return ctx.editMessageText(renderHistoryText(item, entries), {
        reply_markup: { inline_keyboard: [[{ text: '← К карточке', callback_data: `open_${id}` }]] },
      });
    } catch (err) {
      logger.error('history action error', { err: err.message });
    }
  });

  // Give equipment
  bot.action(/give_(\d+)/, async (ctx) => {
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery('Неверный идентификатор.', { show_alert: true }); return; }

    const locked = await acquireLock(`lock:give:${id}`);
    if (!locked) { await ctx.answerCbQuery('Действие уже выполняется…', { show_alert: true }); return; }

    try {
      const item = await findEquipmentById(id);
      if (!item) { await ctx.answerCbQuery('Оборудование не найдено.', { show_alert: true }); return; }
      if (item.status !== STATUS.IN_STOCK) { await ctx.answerCbQuery('Оборудование недоступно для выдачи.', { show_alert: true }); return; }
      await ctx.answerCbQuery('✅ Выдано');
      const updated = await giveEquipmentToUser(item, ctx.from.id);
      equipmentActionsTotal.inc({ action: 'given' });
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));
      const text   = await renderEquipmentCard(updated);
      return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
    } catch (err) {
      logger.error('give action error', { err: err.message });
      await ctx.reply('Ошибка при выдаче оборудования.').catch(() => {});
    }
  });

  // Return equipment
  bot.action(/return_(\d+)/, async (ctx) => {
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery('Неверный идентификатор.', { show_alert: true }); return; }

    const locked = await acquireLock(`lock:return:${id}`);
    if (!locked) { await ctx.answerCbQuery('Действие уже выполняется…', { show_alert: true }); return; }

    try {
      const item = await findEquipmentById(id);
      if (!item) { await ctx.answerCbQuery('Оборудование не найдено.', { show_alert: true }); return; }
      if (item.status !== STATUS.WITH_USER) { await ctx.answerCbQuery('Оборудование не выдано.', { show_alert: true }); return; }
      if (Number(item.current_holder_user_id) !== ctx.from.id) {
        await ctx.answerCbQuery('Это оборудование выдано другому пользователю.', { show_alert: true }); return;
      }
      await ctx.answerCbQuery('✅ Возвращено');
      const updated = await returnEquipmentFromUser(item, ctx.from.id);
      equipmentActionsTotal.inc({ action: 'returned' });
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));
      const text   = await renderEquipmentCard(updated);
      return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
    } catch (err) {
      logger.error('return action error', { err: err.message });
      await ctx.reply('Ошибка при возврате оборудования.').catch(() => {});
    }
  });

  // Send to repair
  bot.action(/repair_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const id = parseId(ctx.match[1]);
      if (!id) return ctx.reply('Неверный идентификатор.');
      const item = await findEquipmentById(id);
      if (!item) return ctx.reply('Оборудование не найдено.');
      if (item.status === STATUS.REPAIR) return ctx.reply('Оборудование уже в ремонте.');
      ensureSession(ctx);
      ctx.session.flow = { type: 'repair', equipmentId: id, sourceMessage: rememberMessage(ctx.callbackQuery?.message), startedAt: Date.now(), version: 1 };
      const prompt = await ctx.reply('Введите причину ремонта:');
      ctx.session.flow.promptMessage = rememberMessage(prompt);
    } catch (err) {
      logger.error('repair action error', { err: err.message });
    }
  });

  // Complete repair
  bot.action(/fromRepair_(\d+)/, async (ctx) => {
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery('Неверный идентификатор.', { show_alert: true }); return; }

    const locked = await acquireLock(`lock:fromRepair:${id}`);
    if (!locked) { await ctx.answerCbQuery('Действие уже выполняется…', { show_alert: true }); return; }

    try {
      const item = await findEquipmentById(id);
      if (!item) { await ctx.answerCbQuery('Оборудование не найдено.', { show_alert: true }); return; }
      if (item.status !== STATUS.REPAIR) { await ctx.answerCbQuery('Оборудование не в ремонте.', { show_alert: true }); return; }
      await ctx.answerCbQuery('✅ Возвращено из ремонта');
      const updated = await completeRepair(item, ctx.from.id);
      equipmentActionsTotal.inc({ action: 'repair_completed' });
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));
      const text   = await renderEquipmentCard(updated);
      return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
    } catch (err) {
      logger.error('fromRepair action error', { err: err.message });
      await ctx.reply('Ошибка при завершении ремонта.').catch(() => {});
    }
  });

  // Write-off
  bot.action(/writeoff_(\d+)/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Только администратор может списывать.', { show_alert: true });
      await ctx.answerCbQuery();
      const id = parseId(ctx.match[1]);
      if (!id) return ctx.reply('Неверный идентификатор.');
      const item = await findEquipmentById(id);
      if (!item) return ctx.editMessageText('Оборудование не найдено.');
      if (item.status === STATUS.WRITTEN_OFF) return ctx.editMessageText('Уже списано.');
      ensureSession(ctx);
      ctx.session.flow = { type: 'writeoff', equipmentId: id, sourceMessage: rememberMessage(ctx.callbackQuery?.message), startedAt: Date.now(), version: 1 };
      const prompt = await ctx.reply('Введите причину списания (или отправьте — чтобы пропустить):');
      ctx.session.flow.promptMessage = rememberMessage(prompt);
    } catch (err) {
      logger.error('writeoff action error', { err: err.message });
    }
  });

  // Edit
  bot.action(/edit_(\d+)/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Только администратор может редактировать.', { show_alert: true });
      await ctx.answerCbQuery();
      const id = parseId(ctx.match[1]);
      if (!id) return ctx.reply('Неверный идентификатор.');
      const item = await findEquipmentById(id);
      if (!item) return ctx.editMessageText('Оборудование не найдено.');
      ensureSession(ctx);
      ctx.session.flow = { type: 'edit_equipment', step: 1, equipmentId: id, data: {}, sourceMessage: rememberMessage(ctx.callbackQuery?.message), startedAt: Date.now(), version: 1 };
      const sel = await ctx.reply('Выберите поле для редактирования:', buildEditEquipmentKeyboard());
      ctx.session.flow.selectorMessage = rememberMessage(sel);
    } catch (err) {
      logger.error('edit action error', { err: err.message });
    }
  });

  // Delete (ask confirmation)
  bot.action(/delete_(\d+)/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Только администратор может удалять.', { show_alert: true });
      await ctx.answerCbQuery();
      const id = parseId(ctx.match[1]);
      if (!id) return ctx.reply('Неверный идентификатор.');
      const item = await findEquipmentById(id);
      if (!item) return ctx.editMessageText('Оборудование не найдено.');
      const label = `${item.category || '-'} ${item.model || '-'} — ${item.serial_number || item.inventory_number || `#${item.id}`}`;
      return ctx.editMessageText(
        `❓ Удалить оборудование?\n\n${label}\n\nЭто действие необратимо.`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Да, удалить', `confirmDelete_${item.id}`),
            Markup.button.callback('❌ Отмена',      `open_${item.id}`),
          ],
        ]),
      );
    } catch (err) {
      logger.error('delete action error', { err: err.message });
    }
  });

  // Confirm delete
  bot.action(/confirmDelete_(\d+)/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Нет прав.', { show_alert: true });
      await ctx.answerCbQuery();
      const id = parseId(ctx.match[1]);
      if (!id) return ctx.reply('Неверный идентификатор.');
      const item = await findEquipmentById(id);
      if (!item) return ctx.editMessageText('Оборудование уже удалено.');
      const label = `${item.category || '-'} ${item.model || '-'} — ${item.serial_number || item.inventory_number || `#${item.id}`}`;
      await removeEquipment(id);
      equipmentActionsTotal.inc({ action: 'deleted' });
      await ctx.editMessageText(`🗑️ Оборудование удалено: ${label}`);
      return ctx.reply('Выберите действие:', mainMenu(ctx));
    } catch (err) {
      logger.error('confirmDelete action error', { err: err.message });
    }
  });
}

module.exports = { registerEquipmentHandlers };
