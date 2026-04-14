'use strict';

const { isAdmin } = require('../config');
const logger = require('../../utils/logger');
const { EDITABLE_FIELDS, LABELS } = require('../labels');
const { buildBackKeyboard, mainMenu } = require('../views/menus');
const { buildEquipmentMarkup, renderEquipmentCard } = require('../views/equipment.view');
const { ensureSession, resetFlow } = require('../utils');
const { FLOW_TYPE, ADD_STEP, EDIT_STEP, TOTAL_ADD_STEPS } = require('../fsm/states');
const { makeFlow } = require('../fsm/session.schema');
const {
  addEquipment,
  findEquipmentById,
  findEquipmentBySerial,
  startRepair,
  updateEquipment,
  writeOffEquipment,
} = require('../../services/equipment.service');
const {
  getEquipmentSuggestionText,
  normalizeOptionalValue,
} = require('../helpers/equipmentHints');
const { equipmentActionsTotal } = require('../../utils/metrics');

const MAX_INPUT = 500;
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(v) {
  if (!DATE_RE.test(v)) return false;
  return !Number.isNaN(new Date(v).getTime());
}

function stepLabel(step) {
  return `[${step}/${TOTAL_ADD_STEPS}]`;
}

function mergeWithBackKeyboard(options) {
  const base = options?.reply_markup?.keyboard || [];
  return {
    reply_markup: {
      keyboard: [...base, [{ text: LABELS.back }]],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

async function sendAddPrompt(ctx, step) {
  switch (step) {
    case ADD_STEP.CATEGORY: {
      const p = await getEquipmentSuggestionText('category', `${stepLabel(step)} Введите категорию:`);
      return ctx.reply(p.text, mergeWithBackKeyboard(p.options));
    }
    case ADD_STEP.BRAND: {
      const p = await getEquipmentSuggestionText('brand', `${stepLabel(step)} Введите бренд:`);
      return ctx.reply(p.text, mergeWithBackKeyboard(p.options));
    }
    case ADD_STEP.MODEL: {
      const p = await getEquipmentSuggestionText('model', `${stepLabel(step)} Введите модель:`);
      return ctx.reply(p.text, mergeWithBackKeyboard(p.options));
    }
    case ADD_STEP.SERIAL:
      return ctx.reply(`${stepLabel(step)} Введите серийный номер:`, buildBackKeyboard());
    case ADD_STEP.INVENTORY:
      return ctx.reply(`${stepLabel(step)} Введите инвентарный номер (или оставьте пустым):`, buildBackKeyboard());
    case ADD_STEP.PURCHASE_DATE: {
      const p = await getEquipmentSuggestionText('purchase_date', `${stepLabel(step)} Введите дату покупки (YYYY-MM-DD) или оставьте пустым:`);
      return ctx.reply(p.text, mergeWithBackKeyboard(p.options));
    }
    case ADD_STEP.NOTES:
      return ctx.reply(`${stepLabel(step)} Введите примечания или оставьте пустым:`, buildBackKeyboard());
    default:
      return ctx.reply('Введите значение:', buildBackKeyboard());
  }
}

function rememberMessage(message) {
  if (!message) return null;
  return { chatId: message.chat.id, messageId: message.message_id };
}

async function safeDelete(ctx, ref, label) {
  if (!ref) return;
  try { await ctx.telegram.deleteMessage(ref.chatId, ref.messageId); }
  catch (err) { logger.warn(`${label}: ${err.message}`); }
}

// ── Add Equipment flow ────────────────────────────────────────────────────────
async function handleAddEquipment(ctx, text, flow) {
  if (text === LABELS.back) { resetFlow(ctx); return ctx.reply('Добавление отменено.', mainMenu(ctx)); }

  const data = flow.data || {};

  switch (flow.step) {
    case ADD_STEP.CATEGORY:
      if (!text) return ctx.reply('Категория не может быть пустой.');
      data.category = text;
      ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.BRAND, data);
      return sendAddPrompt(ctx, ADD_STEP.BRAND);

    case ADD_STEP.BRAND:
      data.brand = text || null;
      ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.MODEL, data);
      return sendAddPrompt(ctx, ADD_STEP.MODEL);

    case ADD_STEP.MODEL:
      if (!text) return ctx.reply('Модель не может быть пустой.');
      data.model = text;
      ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.SERIAL, data);
      return sendAddPrompt(ctx, ADD_STEP.SERIAL);

    case ADD_STEP.SERIAL:
      if (await findEquipmentBySerial(text)) {
        return ctx.reply('Оборудование с таким серийным номером уже существует. Введите другой:');
      }
      data.serial_number = text;
      ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.INVENTORY, data);
      return sendAddPrompt(ctx, ADD_STEP.INVENTORY);

    case ADD_STEP.INVENTORY:
      data.inventory_number = normalizeOptionalValue(text);
      ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.PURCHASE_DATE, data);
      return sendAddPrompt(ctx, ADD_STEP.PURCHASE_DATE);

    case ADD_STEP.PURCHASE_DATE: {
      const dateVal = normalizeOptionalValue(text);
      if (dateVal && !isValidDate(dateVal)) return ctx.reply('Неверный формат даты. Используйте YYYY-MM-DD или оставьте пустым:');
      data.purchase_date = dateVal;
      ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.NOTES, data);
      return sendAddPrompt(ctx, ADD_STEP.NOTES);
    }

    case ADD_STEP.NOTES:
      data.notes = normalizeOptionalValue(text);
      try {
        const created = await addEquipment(data);
        equipmentActionsTotal.inc({ action: 'created' });
        resetFlow(ctx);
        const markup = buildEquipmentMarkup(created, isAdmin(ctx));
        const card   = await renderEquipmentCard(created);
        await ctx.reply('✅ Оборудование добавлено успешно.');
        return ctx.reply(card, markup || mainMenu(ctx));
      } catch (err) {
        logger.error('Create equipment error', { err: err.message });
        resetFlow(ctx);
        if (err.message === 'DUPLICATE_SERIAL') return ctx.reply('Серийный номер уже существует. Начните заново.', mainMenu(ctx));
        return ctx.reply('Не удалось добавить оборудование.', mainMenu(ctx));
      }

    default:
      resetFlow(ctx);
      return ctx.reply('Ошибка. Попробуйте снова.', mainMenu(ctx));
  }
}

// ── Repair flow ───────────────────────────────────────────────────────────────
async function handleRepair(ctx, text, flow) {
  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  const updated = await startRepair(equipment, ctx.from.id, text);
  equipmentActionsTotal.inc({ action: 'repair_started' });
  const markup = buildEquipmentMarkup(updated, isAdmin(ctx));

  await safeDelete(ctx, flow.sourceMessage, 'repair:source');
  await safeDelete(ctx, flow.promptMessage, 'repair:prompt');
  resetFlow(ctx);
  await ctx.reply(`Отправлено в ремонт:\n${equipment.category} ${equipment.model} - ${equipment.serial_number || equipment.inventory_number}\nПричина: ${text}`);
  return ctx.reply(await renderEquipmentCard(updated), markup || undefined);
}

// ── Write-off flow ────────────────────────────────────────────────────────────
async function handleWriteoff(ctx, text, flow) {
  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  const comment = text === '—' ? null : text;
  const updated = await writeOffEquipment(equipment, ctx.from.id, comment);
  equipmentActionsTotal.inc({ action: 'written_off' });
  const markup = buildEquipmentMarkup(updated, isAdmin(ctx));

  await safeDelete(ctx, flow.sourceMessage, 'writeoff:source');
  await safeDelete(ctx, flow.promptMessage, 'writeoff:prompt');
  resetFlow(ctx);
  await ctx.reply(`Оборудование списано:\n${equipment.category} ${equipment.model} - ${equipment.serial_number || equipment.inventory_number}`);
  return ctx.reply(await renderEquipmentCard(updated), markup || undefined);
}

// ── Edit Equipment flow ───────────────────────────────────────────────────────
async function handleEditEquipment(ctx, text, flow) {
  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  // Step 1: select field
  if (flow.step === EDIT_STEP.SELECT_FIELD) {
    if (text === LABELS.back) {
      await safeDelete(ctx, flow.selectorMessage, 'edit:selector');
      resetFlow(ctx);
      return ctx.reply('Редактирование отменено.', mainMenu(ctx));
    }
    const field = EDITABLE_FIELDS[text];
    if (!field) return ctx.reply('Пожалуйста, выберите поле из списка или нажмите 🔙 Назад.');

    const promptMsg = await ctx.reply(`Введите новое значение для ${text}:`, buildBackKeyboard());
    ctx.session.flow = {
      type: FLOW_TYPE.EDIT_EQUIPMENT,
      step: EDIT_STEP.ENTER_VALUE,
      equipmentId: flow.equipmentId,
      sourceMessage: flow.sourceMessage,
      selectorMessage: flow.selectorMessage,
      data: { field, fieldLabel: text },
      promptMessage: rememberMessage(promptMsg),
      startedAt: flow.startedAt,
      version: flow.version,
    };
    return promptMsg;
  }

  // Step 2: enter value
  if (text === LABELS.back) {
    await safeDelete(ctx, flow.selectorMessage, 'edit:selector');
    await safeDelete(ctx, flow.promptMessage,  'edit:prompt');
    resetFlow(ctx);
    return ctx.reply('Редактирование отменено.', mainMenu(ctx));
  }

  const { field } = flow.data;
  const REQUIRED = ['category', 'model', 'serial_number'];
  if (REQUIRED.includes(field) && !text) return ctx.reply('Это поле не может быть пустым.');

  if (field === 'serial_number') {
    const existing = await findEquipmentBySerial(text);
    if (existing && Number(existing.id) !== Number(equipment.id)) return ctx.reply('Серийный номер уже существует. Введите другой:');
  }
  if (field === 'purchase_date' && text && !isValidDate(text)) return ctx.reply('Неверный формат. Используйте YYYY-MM-DD:');

  try {
    await updateEquipment(equipment.id, { [field]: text || null });
    const updated = await findEquipmentById(equipment.id);
    const markup  = buildEquipmentMarkup(updated, isAdmin(ctx));

    await safeDelete(ctx, flow.sourceMessage,   'edit:source');
    await safeDelete(ctx, flow.selectorMessage, 'edit:selector');
    await safeDelete(ctx, flow.promptMessage,   'edit:prompt');
    resetFlow(ctx);
    await ctx.reply('Данные обновлены.');
    return ctx.reply(await renderEquipmentCard(updated), markup || mainMenu(ctx));
  } catch (err) {
    logger.error('Update equipment error', { err: err.message });
    resetFlow(ctx);
    return ctx.reply('Не удалось сохранить изменения.', mainMenu(ctx));
  }
}

// ── Main FSM router ───────────────────────────────────────────────────────────
function registerFlowHandlers(bot) {
  bot.on('text', async (ctx, next) => {
    const text = (ctx.message?.text || '').trim();
    if (text.startsWith('/')) return next();
    if (text.length > MAX_INPUT) return ctx.reply(`Слишком длинный текст. Максимум ${MAX_INPUT} символов.`);

    ensureSession(ctx);
    const flow = ctx.session.flow;
    if (!flow) return next();

    // Menu button pressed while inside a flow (except Back) → exit flow
    const MENU_LABELS = [LABELS.categories, LABELS.addEquipment, LABELS.summary, LABELS.profile];
    if (MENU_LABELS.includes(text)) { resetFlow(ctx); return next(); }

    switch (flow.type) {
      case FLOW_TYPE.ADD_EQUIPMENT:  return handleAddEquipment(ctx, text, flow);
      case FLOW_TYPE.REPAIR:         return handleRepair(ctx, text, flow);
      case FLOW_TYPE.WRITEOFF:       return handleWriteoff(ctx, text, flow);
      case FLOW_TYPE.EDIT_EQUIPMENT: return handleEditEquipment(ctx, text, flow);
      default:
        resetFlow(ctx);
        return next();
    }
  });
}

module.exports = { registerFlowHandlers };
