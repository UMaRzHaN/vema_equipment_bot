'use strict';

const { isEffectiveAdmin, isEffectiveManager } = require('../config');
const logger = require('../../utils/logger');
const { safe } = require('../middlewares/error.handler');
const { EDITABLE_FIELDS, LABELS } = require('../labels');
const { validateEquipmentCreate, validateEquipmentUpdate } = require('../validation/equipment.schema');
const { buildBackKeyboard, mainMenu } = require('../views/menus');
const { buildEquipmentMarkup, renderEquipmentCard } = require('../views/equipment.view');
const { ensureSession, resetFlow } = require('../utils');
const { FLOW_TYPE, ADD_STEP, EDIT_STEP, GIVE_STEP, TOTAL_ADD_STEPS } = require('../fsm/states');
const { makeFlow } = require('../fsm/session.schema');
const {
  STATUS,
  addEquipment,
  extendEquipmentDueDate,
  findEquipmentById,
  findEquipmentBySerial,
  giveEquipmentToUser,
  startRepair,
  updateEquipment,
  writeOffEquipment,
  returnEquipmentFromUser,
} = require('../../services/equipment.service');
const { getCityByCoordinates } = require('../../services/location.service');
const {
  getEquipmentSuggestionText,
  normalizeOptionalValue,
} = require('../helpers/equipmentHints');
const { formatDate } = require('../../utils/formatters');
const { equipmentActionsTotal } = require('../../utils/metrics');

const MAX_INPUT = 500;
const DATE_RE   = /^\d{2}\.\d{2}\.\d{4}$/;

function isValidDate(v) {
  if (!DATE_RE.test(v)) return false;
  const [d, m, y] = v.split('.').map(Number);
  return !Number.isNaN(new Date(y, m - 1, d).getTime());
}

function parseDMY(v) {
  const [d, m, y] = v.split('.').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
  const category = ctx.session?.flow?.data?.category || null;
  switch (step) {
    case ADD_STEP.CATEGORY: {
      const p = await getEquipmentSuggestionText('category', `${stepLabel(step)} Введите категорию:`);
      return ctx.reply(p.text, mergeWithBackKeyboard(p.options));
    }
    case ADD_STEP.BRAND: {
      const p = await getEquipmentSuggestionText('brand', `${stepLabel(step)} Введите бренд:`, category);
      return ctx.reply(p.text, mergeWithBackKeyboard(p.options));
    }
    case ADD_STEP.MODEL: {
      const p = await getEquipmentSuggestionText('model', `${stepLabel(step)} Введите модель:`, category);
      return ctx.reply(p.text, mergeWithBackKeyboard(p.options));
    }
    case ADD_STEP.SERIAL:
      return ctx.reply(`${stepLabel(step)} Введите серийный номер:`, buildBackKeyboard());
    case ADD_STEP.PURCHASE_DATE: {
      const p = await getEquipmentSuggestionText('purchase_date', `${stepLabel(step)} Введите дату покупки (ДД.ММ.ГГГГ) или оставьте пустым:`, category);
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
  catch (err) { logger.warn({ label, err: err.message }, 'safeDelete failed'); }
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
      ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.PURCHASE_DATE, data);
      return sendAddPrompt(ctx, ADD_STEP.PURCHASE_DATE);

    case ADD_STEP.PURCHASE_DATE: {
      const dateVal = normalizeOptionalValue(text);
      if (dateVal && !isValidDate(dateVal)) return ctx.reply('Неверный формат даты. Используйте ДД.ММ.ГГГГ или оставьте пустым:');
      data.purchase_date = dateVal ? parseDMY(dateVal) : null;
      ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.NOTES, data);
      return sendAddPrompt(ctx, ADD_STEP.NOTES);
    }

    case ADD_STEP.NOTES:
      data.notes = normalizeOptionalValue(text);
      {
        const validation = validateEquipmentCreate(data);
        if (!validation.success) {
          resetFlow(ctx);
          const msg = validation.error.errors.map((e) => e.message).join(', ');
          return ctx.reply(`Ошибка данных: ${msg}. Начните заново.`, mainMenu(ctx));
        }
        try {
          const created = await addEquipment(validation.data);
          equipmentActionsTotal.inc({ action: 'created' });
          resetFlow(ctx);
          const markup = buildEquipmentMarkup(created, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
          const card   = await renderEquipmentCard(created);
          await ctx.reply('✅ Оборудование добавлено успешно.');
          return ctx.reply(card, markup || mainMenu(ctx));
        } catch (err) {
          logger.error({ err: err.message }, 'Create equipment error');
          resetFlow(ctx);
          if (err.message === 'DUPLICATE_SERIAL') return ctx.reply('Серийный номер уже существует. Начните заново.', mainMenu(ctx));
          return ctx.reply('Не удалось добавить оборудование.', mainMenu(ctx));
        }
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
  const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

  await safeDelete(ctx, flow.sourceMessage, 'repair:source');
  await safeDelete(ctx, flow.promptMessage, 'repair:prompt');
  resetFlow(ctx);
  await ctx.reply(`Отправлено в ремонт:\n${equipment.category} ${equipment.model} - ${equipment.serial_number}\nПричина: ${text}`);
  return ctx.reply(await renderEquipmentCard(updated), markup || undefined);
}

async function handleReturnLocation(ctx, text, flow) {
  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  if (text === LABELS.back) {
    await safeDelete(ctx, flow.promptMessage, 'return:prompt');
    resetFlow(ctx);
    return ctx.reply('Возврат отменён.', mainMenu(ctx));
  }

  const warehouse = text?.trim();
  if (!warehouse) {
    return ctx.reply('Введите название города или нажмите кнопку "📍 Отправить мою локацию".');
  }

  const updated = await returnEquipmentFromUser(equipment, ctx.from.id, warehouse);
  equipmentActionsTotal.inc({ action: 'returned' });
  const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

  await safeDelete(ctx, flow.sourceMessage, 'return:source');
  await safeDelete(ctx, flow.promptMessage, 'return:prompt');
  resetFlow(ctx);

  await ctx.reply(`✅ Оборудование возвращено на склад: ${warehouse}`, mainMenu(ctx));
  return ctx.reply(await renderEquipmentCard(updated), markup || undefined);
}

async function handleReturnLocationWithGeo(ctx, flow) {
  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  const location = ctx.message.location;
  if (!location) return ctx.reply('Пожалуйста, отправьте локацию склада или введите город вручную.');

  const city = await getCityByCoordinates(location.latitude, location.longitude);
  if (!city) {
    return ctx.reply('Не удалось определить город по локации. Введите название города вручную:');
  }

  const updated = await returnEquipmentFromUser(equipment, ctx.from.id, city);
  equipmentActionsTotal.inc({ action: 'returned' });
  const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

  await safeDelete(ctx, flow.sourceMessage, 'return:source');
  await safeDelete(ctx, flow.promptMessage, 'return:prompt');
  resetFlow(ctx);

  await ctx.reply(`✅ Оборудование возвращено на склад: ${city}`, mainMenu(ctx));
  return ctx.reply(await renderEquipmentCard(updated), markup || undefined);
}

// ── Write-off flow ────────────────────────────────────────────────────────────
async function handleWriteoff(ctx, text, flow) {
  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  const comment = text === '—' ? null : text;
  const updated = await writeOffEquipment(equipment, ctx.from.id, comment);
  equipmentActionsTotal.inc({ action: 'written_off' });
  const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

  await safeDelete(ctx, flow.sourceMessage, 'writeoff:source');
  await safeDelete(ctx, flow.promptMessage, 'writeoff:prompt');
  resetFlow(ctx);
  await ctx.reply(`Оборудование списано:\n${equipment.category} ${equipment.model} - ${equipment.serial_number}`);
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
    if (field === 'warehouse' && equipment.status !== STATUS.IN_STOCK) {
      return ctx.reply('Склад можно указать только когда оборудование находится на складе.');
    }

    const promptSuffix = field === 'purchase_date' ? ' (ДД.ММ.ГГГГ)' : '';
    const promptMsg = await ctx.reply(`Введите новое значение для ${text}${promptSuffix}:`, buildBackKeyboard());
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

  let inputValue = text || null;
  if (field === 'purchase_date' && inputValue) {
    if (!isValidDate(inputValue)) return ctx.reply('Неверный формат даты. Используйте ДД.ММ.ГГГГ:');
    inputValue = parseDMY(inputValue);
  }

  // Validate via Zod before touching the DB
  const valResult = validateEquipmentUpdate({ [field]: inputValue });
  if (!valResult.success) return ctx.reply(`Неверное значение: ${valResult.error.errors[0]?.message}`);

  if (field === 'serial_number') {
    const existing = await findEquipmentBySerial(text);
    if (existing && Number(existing.id) !== Number(equipment.id)) return ctx.reply('Серийный номер уже существует. Введите другой:');
  }

  try {
    await updateEquipment(equipment.id, { [field]: inputValue });
    const updated = await findEquipmentById(equipment.id);
    const markup  = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

    await safeDelete(ctx, flow.sourceMessage,   'edit:source');
    await safeDelete(ctx, flow.selectorMessage, 'edit:selector');
    await safeDelete(ctx, flow.promptMessage,   'edit:prompt');
    resetFlow(ctx);
    await ctx.reply('Данные обновлены.');
    return ctx.reply(await renderEquipmentCard(updated), markup || mainMenu(ctx));
  } catch (err) {
    logger.error({ err: err.message }, 'Update equipment error');
    resetFlow(ctx);
    return ctx.reply('Не удалось сохранить изменения.', mainMenu(ctx));
  }
}

// ── Give Equipment flow ───────────────────────────────────────────────────────
async function handleGiveEquipment(ctx, text, flow) {
  if (text === LABELS.back) {
    await safeDelete(ctx, flow.promptMessage, 'give:prompt');
    resetFlow(ctx);
    return ctx.reply('Взятие отменено.', mainMenu(ctx));
  }

  const days = parseInt(text, 10);
  if (!days || days < 1 || days > 365) {
    return ctx.reply('Введите количество дней от 1 до 365:');
  }

  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.', mainMenu(ctx)); }
  if (equipment.status !== STATUS.IN_STOCK) {
    resetFlow(ctx);
    return ctx.reply('Оборудование уже недоступно для выдачи.', mainMenu(ctx));
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  try {
    const updated = await giveEquipmentToUser(equipment, ctx.from.id, dueDate.toISOString());
    equipmentActionsTotal.inc({ action: 'given' });
    const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

    await safeDelete(ctx, flow.sourceMessage, 'give:source');
    await safeDelete(ctx, flow.promptMessage,  'give:prompt');
    resetFlow(ctx);

    await ctx.reply(`✅ Оборудование выдано. Срок сдачи: ${formatDate(dueDate)}`, mainMenu(ctx));
    return ctx.reply(await renderEquipmentCard(updated), markup || undefined);
  } catch (err) {
    if (err.code === 'STATUS_CONFLICT') {
      resetFlow(ctx);
      return ctx.reply('Оборудование уже недоступно — кто-то взял его раньше.', mainMenu(ctx));
    }
    throw err;
  }
}

// ── Extend due date flow ──────────────────────────────────────────────────────
async function handleExtendEquipment(ctx, text, flow) {
  if (text === LABELS.back) {
    await safeDelete(ctx, flow.promptMessage, 'extend:prompt');
    resetFlow(ctx);
    return ctx.reply('Продление отменено.', mainMenu(ctx));
  }

  const days = parseInt(text, 10);
  if (!days || days < 1 || days > 365) {
    return ctx.reply('Введите количество дней от 1 до 365:');
  }

  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.', mainMenu(ctx)); }

  const updated = await extendEquipmentDueDate(equipment, days);
  await safeDelete(ctx, flow.promptMessage, 'extend:prompt');
  resetFlow(ctx);

  return ctx.reply(`✅ Срок продлён до ${formatDate(updated.due_date)}`, mainMenu(ctx));
}

// ── Main FSM router ───────────────────────────────────────────────────────────
function registerFlowHandlers(bot) {
  bot.on('location', safe(async (ctx, next) => {
    ensureSession(ctx);
    const flow = ctx.session.flow;
    if (!flow || flow.type !== FLOW_TYPE.RETURN_LOCATION) return next();
    return handleReturnLocationWithGeo(ctx, flow);
  }, 'flow:location'));

  bot.on('text', safe(async (ctx, next) => {
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
      case FLOW_TYPE.ADD_EQUIPMENT:      return handleAddEquipment(ctx, text, flow);
      case FLOW_TYPE.GIVE_EQUIPMENT:     return handleGiveEquipment(ctx, text, flow);
      case FLOW_TYPE.EXTEND_EQUIPMENT:   return handleExtendEquipment(ctx, text, flow);
      case FLOW_TYPE.REPAIR:             return handleRepair(ctx, text, flow);
      case FLOW_TYPE.WRITEOFF:           return handleWriteoff(ctx, text, flow);
      case FLOW_TYPE.EDIT_EQUIPMENT:     return handleEditEquipment(ctx, text, flow);
      case FLOW_TYPE.RETURN_LOCATION:    return handleReturnLocation(ctx, text, flow);
      default:
        resetFlow(ctx);
        return next();
    }
  }, 'flow:text'));
}

module.exports = { registerFlowHandlers };
