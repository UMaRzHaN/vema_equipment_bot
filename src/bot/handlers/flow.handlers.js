'use strict';

const { Markup } = require('telegraf');
const { isEffectiveAdmin, isEffectiveManager } = require('../config');
const logger = require('../../utils/logger');
const { safe } = require('../middlewares/error.handler');
const { EDITABLE_FIELDS, LABELS } = require('../labels');
const { validateEquipmentCreate, validateEquipmentUpdate } = require('../validation/equipment.schema');
const {
  buildBackKeyboard,
  buildGiveComponentsKeyboard,
  mainMenu,
} = require('../views/menus');
const { buildEquipmentMarkup, renderEquipmentCard } = require('../views/equipment.view');
const { finalizeGiveCart } = require('./equipment.handlers');
const { ensureSession, resetFlow } = require('../utils');
const { FLOW_TYPE, ADD_STEP, EDIT_STEP, TOTAL_ADD_STEPS } = require('../fsm/states');
const { makeFlow } = require('../fsm/session.schema');
const { STATUS } = require('../../utils/constants');
const {
  addEquipment,
  extendEquipmentForUser,
  findEquipmentById,
  findEquipmentBySerial,
  listAllEquipment,
  startRepair,
  updateEquipment,
  returnEquipmentFromUser,
} = require('../../services/equipment.service');
const { getCityByCoordinates } = require('../../services/location.service');
const {
  getEquipmentSuggestionText,
  normalizeOptionalValue,
} = require('../helpers/equipmentHints');
const { equipmentActionsTotal } = require('../../utils/metrics');
const { formatDate } = require('../../utils/formatters');
const { getGiveComponentsPreset } = require('../../utils/component-presets');

const MAX_INPUT = 500;
const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [day, month, year] = value.split('.').map(Number);
  return !Number.isNaN(new Date(year, month - 1, day).getTime());
}

function parseDMY(value) {
  const [day, month, year] = value.split('.').map(Number);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseComponentsInput(value) {
  const normalized = normalizeOptionalValue(value);
  if (!normalized || ['-', 'нет', 'none'].includes(normalized.toLowerCase())) return [];
  return normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20);
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
  const brand = ctx.session?.flow?.data?.brand || null;
  switch (step) {
    case ADD_STEP.CATEGORY: {
      const prompt = await getEquipmentSuggestionText(
        'category',
        `${stepLabel(step)} Введите категорию оборудования:`,
      );
      return ctx.reply(prompt.text, mergeWithBackKeyboard(prompt.options));
    }
    case ADD_STEP.BRAND: {
      const prompt = await getEquipmentSuggestionText('brand', `${stepLabel(step)} Введите бренд:`, category);
      return ctx.reply(prompt.text, mergeWithBackKeyboard(prompt.options));
    }
    case ADD_STEP.MODEL: {
      const prompt = await getEquipmentSuggestionText(
        'model',
        `${stepLabel(step)} Введите модель:`,
        category,
        brand,
      );
      return ctx.reply(prompt.text, mergeWithBackKeyboard(prompt.options));
    }
    case ADD_STEP.SERIAL:
      return ctx.reply(`${stepLabel(step)} Введите серийный номер:`, buildBackKeyboard());
    case ADD_STEP.PURCHASE_DATE:
      return ctx.reply(
        `${stepLabel(step)} Введите дату покупки (ДД.ММ.ГГГГ) или оставьте пустым:`,
        buildBackKeyboard(),
      );
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
  try {
    await ctx.telegram.deleteMessage(ref.chatId, ref.messageId);
  } catch (err) {
    logger.warn({ label, err: err.message }, 'safeDelete failed');
  }
}

function getSelectedMyEquipmentItems(allItems, flow, userId) {
  const selectedIds = new Set(
    (Array.isArray(flow?.equipmentIds) ? flow.equipmentIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0),
  );

  if (!selectedIds.size) return [];

  return allItems.filter((item) =>
    selectedIds.has(Number(item.id))
    && item.status === STATUS.WITH_USER
    && Number(item.current_holder_user_id) === Number(userId));
}

async function finalizeAddEquipment(ctx, data) {
  const validation = validateEquipmentCreate(data);
  if (!validation.success) {
    resetFlow(ctx);
    const message = validation.error.errors.map((entry) => entry.message).join(', ');
    return ctx.reply(`Ошибка данных: ${message}. Начните заново.`, mainMenu(ctx));
  }

  try {
    const created = await addEquipment(validation.data);
    equipmentActionsTotal.inc({ action: 'created' });
    resetFlow(ctx);
    const markup = buildEquipmentMarkup(created, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
    const card = await renderEquipmentCard(created);
    await ctx.reply('✅ Оборудование добавлено успешно.');
    return ctx.reply(card, markup || mainMenu(ctx));
  } catch (err) {
    logger.error({ err: err.message }, 'Create equipment error');
    resetFlow(ctx);
    if (err.message === 'DUPLICATE_SERIAL') {
      return ctx.reply('Серийный номер уже существует. Начните заново.', mainMenu(ctx));
    }
    return ctx.reply('Не удалось добавить оборудование.', mainMenu(ctx));
  }
}

async function handleAddEquipment(ctx, text, flow) {
  if (text === LABELS.back) {
    resetFlow(ctx);
    return ctx.reply('Добавление отменено.', mainMenu(ctx));
  }

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
      const dateValue = normalizeOptionalValue(text);
      if (dateValue && !isValidDate(dateValue)) {
        return ctx.reply('Неверный формат даты. Используйте ДД.ММ.ГГГГ или оставьте пустым:');
      }
      data.purchase_date = dateValue ? parseDMY(dateValue) : null;
      data.components = [];
      return finalizeAddEquipment(ctx, data);
    }

    default:
      resetFlow(ctx);
      return ctx.reply('Ошибка. Попробуйте снова.', mainMenu(ctx));
  }
}

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
  if (markup) {
    return ctx.reply(await renderEquipmentCard(updated), markup);
  } else {
    return ctx.reply(await renderEquipmentCard(updated), mainMenu(ctx));
  }
}

async function handleGiveDuration(ctx, text, flow) {
  if (flow.extendAllMode) {
    if (text === LABELS.back) {
      await safeDelete(ctx, flow.promptMessage, 'extendAll:prompt');
      resetFlow(ctx);
      return ctx.reply('Продление отменено.', mainMenu(ctx));
    }

    if (!/^\d+$/.test(text)) {
      return ctx.reply('Введите срок в днях целым числом, например: 5');
    }

    const durationDays = Number(text);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      return ctx.reply('Введите срок от 1 до 365 дней.');
    }

    const allItems = await listAllEquipment();
    const items = getSelectedMyEquipmentItems(allItems, flow, ctx.from.id);

    if (!items.length) {
      resetFlow(ctx);
      return ctx.reply('Оборудование для продления не найдено.', mainMenu(ctx));
    }

    const extended = [];
    for (const item of items) {
      const baseDate = item.expected_return_date ? new Date(item.expected_return_date) : new Date();
      const nextDate = baseDate > new Date() ? new Date(baseDate) : new Date();
      nextDate.setDate(nextDate.getDate() + durationDays);
      await extendEquipmentForUser(item, ctx.from.id, nextDate.toISOString());
      equipmentActionsTotal.inc({ action: 'extended' });
      extended.push({ item, expectedReturnDate: nextDate.toISOString() });
    }

    await safeDelete(ctx, flow.sourceMessage, 'extendAll:source');
    await safeDelete(ctx, flow.promptMessage, 'extendAll:prompt');
    resetFlow(ctx);

    return ctx.reply(
      `⏳ Продлено на ${durationDays} дн.:\n${extended.map(({ item, expectedReturnDate }) => `• ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'} (до ${formatDate(expectedReturnDate)})`).join('\n')}`,
      mainMenu(ctx),
    );
  }

  if (flow.extendMode) {
    const equipment = await findEquipmentById(flow.equipmentId);
    if (!equipment) {
      resetFlow(ctx);
      return ctx.reply('Оборудование не найдено.');
    }

    if (text === LABELS.back) {
      await safeDelete(ctx, flow.promptMessage, 'extend:prompt');
      resetFlow(ctx);
      const markup = buildEquipmentMarkup(equipment, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
      return ctx.reply(await renderEquipmentCard(equipment), markup || mainMenu(ctx));
    }

    if (!/^\d+$/.test(text)) {
      return ctx.reply('Введите срок в днях целым числом, например: 5');
    }

    const durationDays = Number(text);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      return ctx.reply('Введите срок от 1 до 365 дней.');
    }

    const baseDate = equipment.expected_return_date ? new Date(equipment.expected_return_date) : new Date();
    const nextDate = baseDate > new Date() ? new Date(baseDate) : new Date();
    nextDate.setDate(nextDate.getDate() + durationDays);

    const updated = await extendEquipmentForUser(equipment, ctx.from.id, nextDate.toISOString());
    equipmentActionsTotal.inc({ action: 'extended' });
    const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

    await safeDelete(ctx, flow.sourceMessage, 'extend:source');
    await safeDelete(ctx, flow.promptMessage, 'extend:prompt');
    resetFlow(ctx);

    await ctx.reply(
      `⏳ Продлено на ${durationDays} дн. Новый срок: ${formatDate(nextDate.toISOString())}`,
      mainMenu(ctx),
    );
    return ctx.reply(await renderEquipmentCard(updated), markup || mainMenu(ctx));
  }

  if (flow.cartMode) {
    if (text === LABELS.back) {
      await safeDelete(ctx, flow.promptMessage, 'give:cartDurationPrompt');
      resetFlow(ctx);
      return ctx.reply('Выдача из корзины отменена.', mainMenu(ctx));
    }

    if (!/^\d+$/.test(text)) {
      return ctx.reply('Введите общий срок в днях целым числом, например: 5');
    }

    const durationDays = Number(text);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      return ctx.reply('Введите срок от 1 до 365 дней.');
    }

    ensureSession(ctx);
    if (!ctx.session.giveCart?.items?.length) {
      resetFlow(ctx);
      return ctx.reply('Корзина пуста.', mainMenu(ctx));
    }

    const expectedReturnDate = new Date();
    expectedReturnDate.setDate(expectedReturnDate.getDate() + durationDays);
    ctx.session.giveCart.items = ctx.session.giveCart.items.map((item) => ({
      ...item,
      durationDays,
      expectedReturnDate: expectedReturnDate.toISOString(),
    }));

    await safeDelete(ctx, flow.promptMessage, 'give:cartDurationPrompt');
    resetFlow(ctx);
    return finalizeGiveCart(ctx);
  }

  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) {
    resetFlow(ctx);
    return ctx.reply('Оборудование не найдено.');
  }

  if (text === LABELS.back) {
    await safeDelete(ctx, flow.promptMessage, 'give:durationPrompt');
    resetFlow(ctx);
    const markup = buildEquipmentMarkup(equipment, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
    return ctx.reply(await renderEquipmentCard(equipment), markup || mainMenu(ctx));
  }

  if (!/^\d+$/.test(text)) {
    return ctx.reply('Введите срок в днях целым числом, например: 5');
  }

  const durationDays = Number(text);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
    return ctx.reply('Введите срок от 1 до 365 дней.');
  }

  const expectedReturnDate = new Date();
  expectedReturnDate.setDate(expectedReturnDate.getDate() + durationDays);
  const preset = getGiveComponentsPreset(equipment);

  const selectionMessage = await ctx.reply(
    [
      `📦 Выдача: ${equipment.category || '-'} ${equipment.model || '-'} - ${equipment.serial_number || '-'}`,
      '',
      `Срок: ${durationDays} дн. (до ${formatDate(expectedReturnDate.toISOString())})`,
      '',
      'Выберите комплектующие в отдельном сообщении:',
      'Можно быстро нажать "Минимум" или "Полный комплект".',
      '',
      'Сейчас выбрано:',
      '• Пока ничего не выбрано',
    ].join('\n'),
    buildGiveComponentsKeyboard(equipment.id, preset, []),
  );

  ctx.session.flow = makeFlow(
    FLOW_TYPE.GIVE_COMPONENTS,
    1,
    {
      components: [],
      preset,
      durationDays,
      expectedReturnDate: expectedReturnDate.toISOString(),
    },
    {
      equipmentId: flow.equipmentId,
      sourceMessage: flow.sourceMessage,
      promptMessage: flow.promptMessage,
      selectionMessage: rememberMessage(selectionMessage),
    },
  );

  return selectionMessage;
}

async function handleReturnLocation(ctx, text, flow) {
  if (flow.returnAllMode) {
    if (text === LABELS.back) {
      await safeDelete(ctx, flow.promptMessage, 'returnAll:prompt');
      resetFlow(ctx);
      return ctx.reply('Возврат отменен.', mainMenu(ctx));
    }

    const warehouse = text?.trim();
    if (!warehouse) {
      return ctx.reply('Введите город склада, куда возвращаете оборудование:');
    }

    const allItems = await listAllEquipment();
    const items = getSelectedMyEquipmentItems(allItems, flow, ctx.from.id);

    if (!items.length) {
      resetFlow(ctx);
      return ctx.reply('Оборудование для возврата не найдено.');
    }

    const returned = [];
    for (const item of items) {
      await returnEquipmentFromUser(item, ctx.from.id, warehouse);
      equipmentActionsTotal.inc({ action: 'returned' });
      returned.push(item);
    }

    await safeDelete(ctx, flow.sourceMessage, 'returnAll:source');
    await safeDelete(ctx, flow.promptMessage, 'returnAll:prompt');
    resetFlow(ctx);

    return ctx.reply(
      `✅ Возвращено на склад ${warehouse}:\n${returned.map((item) => `• ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}`).join('\n')}`,
      mainMenu(ctx),
    );
  }

  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  if (text === LABELS.back) {
    await safeDelete(ctx, flow.promptMessage, 'return:prompt');
    resetFlow(ctx);
    return ctx.reply('Возврат отменен.', mainMenu(ctx));
  }

  const warehouse = text?.trim();
  if (!warehouse) {
    return ctx.reply('Введите город склада, куда возвращаете оборудование:');
  }

  const updated = await returnEquipmentFromUser(equipment, ctx.from.id, warehouse);
  equipmentActionsTotal.inc({ action: 'returned' });
  const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

  await safeDelete(ctx, flow.sourceMessage, 'return:source');
  await safeDelete(ctx, flow.promptMessage, 'return:prompt');
  resetFlow(ctx);

  await ctx.reply(`✅ Оборудование возвращено на склад: ${warehouse}`, mainMenu(ctx));
  if (markup) {
    return ctx.reply(await renderEquipmentCard(updated), markup);
  }
  return ctx.reply(await renderEquipmentCard(updated));
}

async function handleReturnLocationWithGeo(ctx, flow) {
  if (flow.returnAllMode) {
    const location = ctx.message.location;
    if (!location) return ctx.reply('Пожалуйста, отправьте локацию склада или введите город вручную.');

    const city = await getCityByCoordinates(location.latitude, location.longitude);
    if (!city) {
      return ctx.reply('Не удалось определить город по локации. Введите город склада вручную:');
    }

    const allItems = await listAllEquipment();
    const items = getSelectedMyEquipmentItems(allItems, flow, ctx.from.id);

    if (!items.length) {
      resetFlow(ctx);
      return ctx.reply('Оборудование для возврата не найдено.');
    }

    const returned = [];
    for (const item of items) {
      await returnEquipmentFromUser(item, ctx.from.id, city);
      equipmentActionsTotal.inc({ action: 'returned' });
      returned.push(item);
    }

    await safeDelete(ctx, flow.sourceMessage, 'returnAll:source');
    await safeDelete(ctx, flow.promptMessage, 'returnAll:prompt');
    resetFlow(ctx);

    return ctx.reply(
      `✅ Возвращено на склад ${city}:\n${returned.map((item) => `• ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}`).join('\n')}`,
      mainMenu(ctx),
    );
  }

  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  const location = ctx.message.location;
  if (!location) return ctx.reply('Пожалуйста, отправьте локацию склада или введите город вручную.');

  const city = await getCityByCoordinates(location.latitude, location.longitude);
  if (!city) {
    return ctx.reply('Не удалось определить город по локации. Введите город склада вручную:');
  }

  const updated = await returnEquipmentFromUser(equipment, ctx.from.id, city);
  equipmentActionsTotal.inc({ action: 'returned' });
  const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

  await safeDelete(ctx, flow.sourceMessage, 'return:source');
  await safeDelete(ctx, flow.promptMessage, 'return:prompt');
  resetFlow(ctx);

  await ctx.reply(`✅ Оборудование возвращено на склад: ${city}`, mainMenu(ctx));
  if (markup) {
    return ctx.reply(await renderEquipmentCard(updated), markup);
  }
  return ctx.reply(await renderEquipmentCard(updated));
}

async function handleEditEquipment(ctx, text, flow) {
  const equipment = await findEquipmentById(flow.equipmentId);
  if (!equipment) { resetFlow(ctx); return ctx.reply('Оборудование не найдено.'); }

  if (flow.step === EDIT_STEP.SELECT_FIELD) {
    if (text === LABELS.back) {
      await safeDelete(ctx, flow.selectorMessage, 'edit:selector');
      resetFlow(ctx);
      return ctx.reply('Редактирование отменено.', mainMenu(ctx));
    }

    const field = EDITABLE_FIELDS[text];
    if (!field) return ctx.reply('Пожалуйста, выберите поле из списка или нажмите Назад.');
    if (field === 'components' && equipment.status !== STATUS.WITH_USER) {
      return ctx.reply('Комплектующие можно заполнять только когда оборудование у пользователя.');
    }
    if (field === 'warehouse' && equipment.status !== STATUS.IN_STOCK) {
      return ctx.reply('Склад можно редактировать только для оборудования со статусом «На складе». При ремонте значение склада очищается автоматически.');
    }

    const promptSuffix = field === 'purchase_date'
      ? ' (ДД.ММ.ГГГГ)'
      : field === 'components'
        ? ' (через запятую)'
        : field === 'warehouse'
          ? ' («-» — очистить)'
          : '';
    const promptMessage = await ctx.reply(`Введите новое значение для ${text}${promptSuffix}:`, buildBackKeyboard());
    ctx.session.flow = {
      type: FLOW_TYPE.EDIT_EQUIPMENT,
      step: EDIT_STEP.ENTER_VALUE,
      equipmentId: flow.equipmentId,
      sourceMessage: flow.sourceMessage,
      selectorMessage: flow.selectorMessage,
      data: { field, fieldLabel: text },
      promptMessage: rememberMessage(promptMessage),
      startedAt: flow.startedAt,
      version: flow.version,
    };
    return promptMessage;
  }

  if (text === LABELS.back) {
    await safeDelete(ctx, flow.selectorMessage, 'edit:selector');
    await safeDelete(ctx, flow.promptMessage, 'edit:prompt');
    resetFlow(ctx);
    return ctx.reply('Редактирование отменено.', mainMenu(ctx));
  }

  const { field } = flow.data;
  let inputValue = text || null;

  if (field === 'purchase_date' && inputValue) {
    if (!isValidDate(inputValue)) return ctx.reply('Неверный формат даты. Используйте ДД.ММ.ГГГГ:');
    inputValue = parseDMY(inputValue);
  }

  if (field === 'components') {
    if (equipment.status !== STATUS.WITH_USER) {
      return ctx.reply('Комплектующие можно заполнять только когда оборудование у пользователя.');
    }
    inputValue = parseComponentsInput(text);
  }

  if (field === 'warehouse') {
    if (equipment.status !== STATUS.IN_STOCK) {
      await updateEquipment(equipment.id, { warehouse: null });
      await safeDelete(ctx, flow.selectorMessage, 'edit:selector');
      await safeDelete(ctx, flow.promptMessage, 'edit:prompt');
      resetFlow(ctx);
      return ctx.reply('Статус оборудования изменился. Поле склада очищено, так как оборудование не находится на складе.', mainMenu(ctx));
    }
    inputValue = normalizeOptionalValue(text);
  }

  const validation = validateEquipmentUpdate({ [field]: inputValue });
  if (!validation.success) {
    return ctx.reply(`Неверное значение: ${validation.error.errors[0]?.message}`);
  }

  if (field === 'serial_number') {
    const existing = await findEquipmentBySerial(text);
    if (existing && Number(existing.id) !== Number(equipment.id)) {
      return ctx.reply('Серийный номер уже существует. Введите другой:');
    }
  }

  try {
    await updateEquipment(equipment.id, { [field]: inputValue });
    const updated = await findEquipmentById(equipment.id);
    const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });

    await safeDelete(ctx, flow.sourceMessage, 'edit:source');
    await safeDelete(ctx, flow.selectorMessage, 'edit:selector');
    await safeDelete(ctx, flow.promptMessage, 'edit:prompt');
    resetFlow(ctx);
    await ctx.reply('Данные обновлены.', mainMenu(ctx));

    logger.info(
      {
        equipmentId: updated.id,
        status: updated.status,
        canAdmin: isEffectiveAdmin(ctx),
        canRepair: isEffectiveManager(ctx),
        hasMarkup: Boolean(markup),
      },
      'Equipment updated',
    );

    if (markup) {
      return ctx.reply(await renderEquipmentCard(updated), markup);
    }
    return ctx.reply(await renderEquipmentCard(updated));
  } catch (err) {
    logger.error({ err: err.message }, 'Update equipment error');
    resetFlow(ctx);
    return ctx.reply('Не удалось сохранить изменения.', mainMenu(ctx));
  }
}

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

    const menuLabels = [LABELS.categories, LABELS.myEquipment, LABELS.addEquipment, LABELS.summary, LABELS.profile];
    if (menuLabels.includes(text)) {
      resetFlow(ctx);
      return next();
    }

    switch (flow.type) {
      case FLOW_TYPE.ADD_EQUIPMENT:
        return handleAddEquipment(ctx, text, flow);
      case FLOW_TYPE.GIVE_DURATION:
        return handleGiveDuration(ctx, text, flow);
      case FLOW_TYPE.GIVE_COMPONENTS:
        return ctx.reply('Для выбора комплектующих используйте кнопки под сообщением.');
      case FLOW_TYPE.REPAIR:
        return handleRepair(ctx, text, flow);
      case FLOW_TYPE.EDIT_EQUIPMENT:
        return handleEditEquipment(ctx, text, flow);
      case FLOW_TYPE.RETURN_LOCATION:
        return handleReturnLocation(ctx, text, flow);
      default:
        resetFlow(ctx);
        return next();
    }
  }, 'flow:text'));
}

module.exports = { registerFlowHandlers };
