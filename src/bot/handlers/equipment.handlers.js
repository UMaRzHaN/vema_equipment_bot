'use strict';

const { Markup } = require('telegraf');
const { isAdmin, hasRole, isEffectiveAdmin, isEffectiveManager } = require('../config');
const logger = require('../../utils/logger');
const { safe } = require('../middlewares/error.handler');
const {
  buildEditEquipmentKeyboard,
  buildGiveComponentsKeyboard,
  buildBackKeyboard,
  buildCategoryListKeyboard,
  buildLocationRequestKeyboard,
  buildMyEquipmentKeyboard,
  buildMyEquipmentSelectionKeyboard,
  mainMenu,
} = require('../views/menus');
const { buildEquipmentMarkup, renderEquipmentCard } = require('../views/equipment.view');
const { ensureSession, resetFlow } = require('../utils');
const { makeFlow } = require('../fsm/session.schema');
const { FLOW_TYPE, EDIT_STEP } = require('../fsm/states');
const { formatDate, statusLabel } = require('../../utils/formatters');
const { getUserByTelegramId } = require('../../services/user.service');
const { getFullEquipmentHistory } = require('../../services/history.service');
const { redis } = require('../../redis');
const { ACTIONS_REGEX, LABELS } = require('../constants');
const {
  STATUS,
  completeRepair,
  extendEquipmentForUser,
  findEquipmentById,
  giveEquipmentToUser,
  listAllEquipment,
  listCategories,
  removeEquipment,
  startRepair,
} = require('../../services/equipment.service');
const { equipmentActionsTotal } = require('../../utils/metrics');
const { formatComponent, normalizeComponents } = require('../../utils/components');
const { buildPresetComponents, getGiveComponentsPreset, isQuantityComponent } = require('../../utils/component-presets');

function rememberMessage(message) {
  if (!message) return null;
  return { chatId: message.chat.id, messageId: message.message_id };
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function resolveComponentName(preset, rawKey) {
  const key = String(rawKey || '').trim();
  const match = /^([sq])(\d+)$/.exec(key);
  if (!match) return null;

  const [, kind, indexRaw] = match;
  const index = Number(indexRaw);
  const source = kind === 's' ? preset?.single : preset?.quantity;
  if (!Array.isArray(source)) return null;
  return source[index] || null;
}

function incrementComponent(components, name) {
  const current = normalizeComponents(components);
  const found = current.find((item) => item.name === name);
  if (found) {
    found.qty = Math.min(found.qty + 1, 99);
    return current;
  }
  return [...current, { name, qty: 1 }];
}

function decrementComponent(components, name) {
  return normalizeComponents(components)
    .map((item) => (item.name === name ? { ...item, qty: item.qty - 1 } : item))
    .filter((item) => item.qty > 0);
}

function toggleComponent(components, name) {
  const current = normalizeComponents(components);
  const exists = current.some((item) => item.name === name);
  return exists
    ? current.filter((item) => item.name !== name)
    : [...current, { name, qty: 1 }];
}

function formatEquipmentIssueLabel(item) {
  return [
    item.category || '-',
    item.brand || '-',
    item.model || '-',
    item.serial_number || '-',
  ].join(' - ');
}

function applyPreset(kind, preset) {
  if (kind === 'clear') return [];
  if (kind === 'minimal') return buildPresetComponents(preset.minimal);
  return buildPresetComponents(preset.full);
}

async function acquireLock(key, ttlMs = 3000) {
  const result = await redis.set(key, '1', 'NX', 'PX', ttlMs);
  return result === 'OK';
}

async function safeDelete(ctx, ref, label) {
  if (!ref) return;
  try {
    await ctx.telegram.deleteMessage(ref.chatId, ref.messageId);
  } catch (err) {
    logger.warn({ label, err: err.message }, 'safeDelete failed');
  }
}

function renderHistoryText(item, entries) {
  const title = `📋 История: ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}\n\n`;
  if (!entries.length) return `${title}Записей нет.`;

  const lines = entries.map((entry) => {
    const who = entry.first_name
      ? `${entry.first_name}${entry.last_name ? ` ${entry.last_name}` : ''}`
      : entry.username ? `@${entry.username}` : '—';
    const statusChange = entry.from_status && entry.to_status
      ? ` (${statusLabel(entry.from_status)} → ${statusLabel(entry.to_status)})`
      : '';
    const comment = entry.comment ? `\n   💬 ${entry.comment}` : '';
    return `• ${formatDate(entry.action_date)} — ${entry.action}${statusChange}\n   👤 ${who}${comment}`;
  });

  return `${title}${lines.join('\n\n')}`;
}

function buildHistoryKeyboard(equipmentId, page, hasPrev, hasNext) {
  const rows = [];
  const paginationRow = [];

  if (hasPrev) {
    paginationRow.push({ text: '← Назад', callback_data: `history_${equipmentId}_${page - 1}` });
  }
  if (hasNext) {
    paginationRow.push({ text: 'Дальше →', callback_data: `history_${equipmentId}_${page + 1}` });
  }
  if (paginationRow.length) {
    rows.push(paginationRow);
  }

  rows.push([{ text: '← К карточке', callback_data: `open_${equipmentId}` }]);
  return { inline_keyboard: rows };
}

function renderDurationSelectionText(item) {
  return [
    `📦 Выдача: ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}`,
    '',
    'На какой срок вы хотите взять оборудование?',
  ].join('\n');
}

function renderGiveSelectionText(item, selectedComponents = [], durationDays = null, expectedReturnDate = null) {
  const normalized = normalizeComponents(selectedComponents);
  const selectedText = normalized.length
    ? normalized.map((component) => `• ${formatComponent(component)}`).join('\n')
    : '• Пока ничего не выбрано';
  const durationLine = durationDays && expectedReturnDate
    ? `Срок: ${durationDays} дн. (до ${formatDate(expectedReturnDate)})`
    : null;

  return [
    `📦 Выдача: ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}`,
    '',
    ...(durationLine ? [durationLine, ''] : []),
    'Быстрые кнопки:',
    'Минимум — базовый набор, Полный комплект — все для этого бренда или модели.',
    '',
    'Сейчас выбрано:',
    selectedText,
  ].join('\n');
}

function renderGiveConfirmationText(item, components, durationDays, expectedReturnDate) {
  const normalized = normalizeComponents(components);
  const componentsText = normalized.length
    ? normalized.map((component) => `• ${formatComponent(component)}`).join('\n')
    : '• Без комплектующих';
  const durationLine = durationDays && expectedReturnDate
    ? `Срок: ${durationDays} дн.\nВернуть до: ${formatDate(expectedReturnDate)}`
    : null;

  return [
    '📦 Вы собираетесь взять:',
    `${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}`,
    '',
    ...(durationLine ? [durationLine, ''] : []),
    'Комплект:',
    componentsText,
    '',
    'Подтвердить выдачу?',
  ].join('\n');
}

function getGiveCart(session) {
  if (!session.giveCart || !Array.isArray(session.giveCart.items)) {
    session.giveCart = { items: [] };
  }
  return session.giveCart;
}

function clearGiveCart(session) {
  session.giveCart = { items: [] };
}

function upsertGiveCartItem(session, cartItem) {
  const cart = getGiveCart(session);
  const nextItems = cart.items.filter((item) => Number(item.equipmentId) !== Number(cartItem.equipmentId));
  nextItems.push(cartItem);
  cart.items = nextItems;
  return cart;
}

function removeGiveCartItem(session, equipmentId) {
  const cart = getGiveCart(session);
  cart.items = cart.items.filter((item) => Number(item.equipmentId) !== Number(equipmentId));
  return cart;
}

function buildGiveCartKeyboard(items) {
  const rows = items.map((item) => [
    Markup.button.callback(
      `❌ ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}`,
      `removeFromGiveCart_${item.equipmentId}`,
    ),
  ]);

  rows.push([
    Markup.button.callback('➕ Добавить ещё', 'addMoreGiveCart'),
    Markup.button.callback('✅ Выдать всё', 'confirmGiveCart'),
  ]);
  rows.push([Markup.button.callback('🗑️ Очистить корзину', 'clearGiveCart')]);
  return Markup.inlineKeyboard(rows);
}

function renderGiveCartText(items) {
  if (!items.length) {
    return [
      '🛒 Корзина выдачи пуста.',
      '',
      'Нажмите "Добавить ещё", чтобы выбрать оборудование.',
    ].join('\n');
  }

  const lines = items.map((item, index) => {
    const components = normalizeComponents(item.components || []);
    const componentsText = components.length
      ? components.map(formatComponent).join(', ')
      : 'Без комплектующих';
    const durationLine = item.durationDays && item.expectedReturnDate
      ? `Срок: ${item.durationDays} дн. (до ${formatDate(item.expectedReturnDate)})`
      : null;

    return [
      `${index + 1}. ${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}`,
      durationLine,
      `Комплектующие: ${componentsText}`,
    ].filter(Boolean).join('\n');
  });

  return [
    '🛒 Корзина выдачи:',
    '',
    lines.join('\n\n'),
    '',
    'Можно добавить ещё оборудование или выдать всё сразу.',
  ].join('\n');
}

async function showGiveCart(ctx, editMessage = true) {
  ensureSession(ctx);
  const cart = getGiveCart(ctx.session);
  const text = renderGiveCartText(cart.items);
  const markup = buildGiveCartKeyboard(cart.items);

  if (editMessage && ctx.callbackQuery?.message) {
    try {
      return await ctx.editMessageText(text, markup);
    } catch (err) {
      if (String(err?.message || '').includes('message is not modified')) return null;
      throw err;
    }
  }

  return ctx.reply(text, markup);
}

async function promptAddMoreEquipment(ctx) {
  const categories = await listCategories();
  if (!categories.length) return ctx.reply('Нет категорий.', mainMenu(ctx));
  ensureSession(ctx);
  ctx.session.mode = 'list';
  ctx.session.listPage = 0;
  const pageItems = categories.slice(0, 8);
  const totalPages = Math.max(Math.ceil(categories.length / 8), 1);
  return ctx.reply('Выберите ещё оборудование:', buildCategoryListKeyboard(pageItems, 0, totalPages));
}

async function getCurrentUserEquipmentItems(ctx) {
  const allItems = await listAllEquipment();
  return allItems
    .filter((item) => item.status === STATUS.WITH_USER && Number(item.current_holder_user_id) === Number(ctx.from.id))
    .sort((a, b) => {
      const brandOrder = (a.brand || 'Без бренда').localeCompare(b.brand || 'Без бренда', 'ru');
      if (brandOrder !== 0) return brandOrder;
      return (a.model || '').localeCompare(b.model || '', 'ru');
    });
}

async function showCurrentUserEquipment(ctx) {
  const items = await getCurrentUserEquipmentItems(ctx);

  if (!items.length) {
    return ctx.reply('У вас сейчас нет оборудования на руках.', mainMenu(ctx));
  }

  await ctx.reply('🎒 Ваше оборудование:', buildMyEquipmentKeyboard(items));
  return ctx.reply('Выберите действие:', mainMenu(ctx));
}

function getMyEquipmentSelectionText(mode, selectedCount, totalCount) {
  const actionLine = mode === 'extend'
    ? 'Выберите оборудование, которое нужно продлить.'
    : 'Выберите оборудование, которое нужно вернуть.';
  return [
    '🎒 Ваше оборудование',
    '',
    actionLine,
    `Выбрано: ${selectedCount} из ${totalCount}`,
  ].join('\n');
}

async function showMyEquipmentSelection(ctx, mode, editMessage = true) {
  const items = await getCurrentUserEquipmentItems(ctx);
  if (!items.length) {
    ensureSession(ctx);
    delete ctx.session.myEquipmentSelection;
    const text = mode === 'extend'
      ? 'У вас нет оборудования для продления.'
      : 'У вас нет оборудования для возврата.';
    if (editMessage && ctx.callbackQuery?.message) {
      return ctx.editMessageText(text);
    }
    return ctx.reply(text);
  }

  ensureSession(ctx);
  const selectedIds = Array.isArray(ctx.session.myEquipmentSelection?.selectedIds)
    ? ctx.session.myEquipmentSelection.selectedIds.map((id) => Number(id))
    : items.map((item) => Number(item.id));
  const allowedIds = new Set(items.map((item) => Number(item.id)));
  const normalizedSelection = selectedIds.filter((id) => allowedIds.has(id));

  ctx.session.myEquipmentSelection = { mode, selectedIds: normalizedSelection };
  const text = getMyEquipmentSelectionText(mode, normalizedSelection.length, items.length);
  const markup = buildMyEquipmentSelectionKeyboard(items, mode, normalizedSelection);

  if (editMessage && ctx.callbackQuery?.message) {
    return ctx.editMessageText(text, markup);
  }
  return ctx.reply(text, markup);
}

async function canAdminEquipment(ctx) {
  if (isAdmin(ctx)) return true;
  const user = await getUserByTelegramId(ctx.from.id);
  return user?.role === 'admin';
}

async function canManageEquipment(ctx) {
  if (isAdmin(ctx)) return true;
  const user = await getUserByTelegramId(ctx.from.id);
  return hasRole(user?.role, 'manager');
}

async function updateGiveSelectionMessage(ctx, item, flow) {
  const selectedComponents = normalizeComponents(flow?.data?.components || []);
  const preset = flow?.data?.preset || getGiveComponentsPreset(item);
  const text = renderGiveSelectionText(
    item,
    selectedComponents,
    flow?.data?.durationDays || null,
    flow?.data?.expectedReturnDate || null,
  );
  const markup = buildGiveComponentsKeyboard(item.id, preset, selectedComponents);

  try {
    return await ctx.editMessageText(text, markup);
  } catch (err) {
    if (String(err?.message || "").includes("message is not modified")) {
      return null;
    }
    throw err;
  }
}

async function addCurrentItemToGiveCart(ctx, id, components = [], durationDays = null, expectedReturnDate = null) {
  const item = await findEquipmentById(id);
  if (!item) {
    resetFlow(ctx);
    await ctx.answerCbQuery(LABELS.ERR_NOT_FOUND, { show_alert: true });
    return;
  }
  if (item.status !== STATUS.IN_STOCK) {
    resetFlow(ctx);
    await ctx.answerCbQuery('Оборудование недоступно для выдачи.', { show_alert: true });
    return;
  }

  ensureSession(ctx);
  upsertGiveCartItem(ctx.session, {
    equipmentId: item.id,
    category: item.category,
    brand: item.brand,
    model: item.model,
    serial_number: item.serial_number,
    components: normalizeComponents(components),
    durationDays,
    expectedReturnDate,
  });

  await safeDelete(ctx, ctx.session?.flow?.promptMessage, 'give:prompt');
  resetFlow(ctx);
  await ctx.answerCbQuery('Добавлено в корзину');
  return showGiveCart(ctx, true);
}

async function finalizeGiveCart(ctx) {
  const notify = async (text, options = {}) => {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery(text, options);
    }
    if (text) {
      return ctx.reply(text);
    }
    return null;
  };

  const renderResult = async (text, markup = undefined) => {
    if (ctx.callbackQuery?.message) {
      return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
    }
    return markup ? ctx.reply(text, markup) : ctx.reply(text);
  };

  const lockKey = `lock:give:cart:${ctx.from.id}`;
  const locked = await acquireLock(lockKey);
  if (!locked) {
    await notify(LABELS.ERR_ACTION_IN_PROGRESS, { show_alert: true });
    return;
  }

  try {
    ensureSession(ctx);
    const cart = getGiveCart(ctx.session);
    if (!cart.items.length) {
      await notify('Корзина пуста.', { show_alert: true });
      return;
    }

    const issued = [];
    const failed = [];

    for (const cartItem of cart.items) {
      const item = await findEquipmentById(cartItem.equipmentId);
      if (!item || item.status !== STATUS.IN_STOCK) {
        failed.push({ ...cartItem, reason: 'недоступно' });
        continue;
      }

      try {
        await giveEquipmentToUser(
          item,
          ctx.from.id,
          normalizeComponents(cartItem.components || []),
          cartItem.expectedReturnDate || null,
          cartItem.project || null,
          cartItem.country || null,
        );
        equipmentActionsTotal.inc({ action: 'given' });
        issued.push(cartItem);
      } catch (err) {
        failed.push({
          ...cartItem,
          reason: err.code === 'STATUS_CONFLICT' ? 'статус изменился' : 'ошибка выдачи',
        });
      }
    }

    ctx.session.giveCart = { items: failed.map(({ reason, ...item }) => item) };

    const successLines = issued.map((item) => `• ${formatEquipmentIssueLabel(item)}`);
    const failedLines = failed.map((item) => `• ${formatEquipmentIssueLabel(item)} (${item.reason})`);
    const resultText = [
      issued.length ? `✅ Выдано:\n${successLines.join('\n')}` : null,
      failed.length ? `⚠️ Осталось в корзине:\n${failedLines.join('\n')}` : null,
    ].filter(Boolean).join('\n\n');

    if (ctx.callbackQuery || !issued.length) {
      await notify(
        issued.length ? LABELS.OK_GIVEN : 'Не удалось выдать оборудование.',
        { show_alert: !issued.length },
      );
    }

    if (failed.length) {
      return renderResult(resultText, buildGiveCartKeyboard(ctx.session.giveCart.items));
    }

    await renderResult(resultText || '✅ Оборудование выдано.');
    return showCurrentUserEquipment(ctx);
  } finally {
    await redis.del(lockKey);
  }
}

function registerEquipmentHandlers(bot) {
  bot.action(ACTIONS_REGEX.OPEN, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply(LABELS.ERR_INVALID_ID);

    if (
      (ctx.session?.flow?.type === FLOW_TYPE.GIVE_COMPONENTS || ctx.session?.flow?.type === FLOW_TYPE.GIVE_DURATION)
      && Number(ctx.session.flow.equipmentId) === id
    ) {
      resetFlow(ctx);
    }

    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    const markup = buildEquipmentMarkup(item, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
    const text = await renderEquipmentCard(item);
    return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
  }, 'open'));

  bot.action(ACTIONS_REGEX.HISTORY, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    const rawPage = Number(ctx.match[2] || 0);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0;
    const pageSize = 10;
    if (!id) return ctx.reply(LABELS.ERR_INVALID_ID);
    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    const entries = await getFullEquipmentHistory(id, { limit: pageSize + 1, offset: page * pageSize });
    const hasNext = entries.length > pageSize;
    const pageEntries = hasNext ? entries.slice(0, pageSize) : entries;
    return ctx.editMessageText(renderHistoryText(item, pageEntries), {
      reply_markup: buildHistoryKeyboard(id, page, page > 0, hasNext),
    });
  }, 'history'));

  bot.action(ACTIONS_REGEX.GIVE, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply(LABELS.ERR_INVALID_ID);

    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    if (item.status !== STATUS.IN_STOCK) {
      return ctx.answerCbQuery('Оборудование недоступно для выдачи.', { show_alert: true });
    }

    ensureSession(ctx);
    const preset = getGiveComponentsPreset(item);
    const selectionMessage = await ctx.reply(
      renderGiveSelectionText(item, [], null, null),
      buildGiveComponentsKeyboard(item.id, preset, []),
    );

    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_COMPONENTS,
      1,
      {
        components: [],
        preset,
        durationDays: null,
        expectedReturnDate: null,
      },
      {
        equipmentId: id,
        sourceMessage: rememberMessage(ctx.callbackQuery?.message),
        selectionMessage: rememberMessage(selectionMessage),
      },
    );

    return selectionMessage;
  }, 'give'));

  bot.action(ACTIONS_REGEX.SELECT_GIVE_DURATION, safe(async (ctx) => {
    await ctx.answerCbQuery();
  }, 'selectGiveDuration'));

  bot.action(ACTIONS_REGEX.APPLY_GIVE_PRESET, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    const presetKind = ctx.match[2];
    const flow = ctx.session?.flow;
    if (!id || !flow || flow.type !== FLOW_TYPE.GIVE_COMPONENTS || Number(flow.equipmentId) !== id) {
      return ctx.answerCbQuery('Список комплектующих устарел.', { show_alert: true });
    }

    const item = await findEquipmentById(id);
    if (!item) {
      resetFlow(ctx);
      return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    }

    const preset = flow.data?.preset || getGiveComponentsPreset(item);
    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_COMPONENTS,
      1,
      {
        components: applyPreset(presetKind, preset),
        preset,
        durationDays: flow.data?.durationDays || null,
        expectedReturnDate: flow.data?.expectedReturnDate || null,
      },
      { equipmentId: id, sourceMessage: flow.sourceMessage, promptMessage: flow.promptMessage, selectionMessage: flow.selectionMessage },
    );

    return updateGiveSelectionMessage(ctx, item, ctx.session.flow);
  }, 'applyGivePreset'));

  bot.action(ACTIONS_REGEX.TOGGLE_GIVE_COMPONENT, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    const componentKey = ctx.match[2];
    const flow = ctx.session?.flow;
    if (!id || !componentKey || !flow || flow.type !== FLOW_TYPE.GIVE_COMPONENTS || Number(flow.equipmentId) !== id) {
      return ctx.answerCbQuery('Список комплектующих устарел.', { show_alert: true });
    }

    const item = await findEquipmentById(id);
    if (!item) {
      resetFlow(ctx);
      return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    }

    const preset = flow.data?.preset || getGiveComponentsPreset(item);
    const componentName = resolveComponentName(preset, componentKey);
    if (!componentName) {
      return ctx.answerCbQuery('Не удалось определить комплектующее.', { show_alert: true });
    }
    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_COMPONENTS,
      1,
      {
        components: toggleComponent(flow.data?.components || [], componentName),
        preset,
        durationDays: flow.data?.durationDays || null,
        expectedReturnDate: flow.data?.expectedReturnDate || null,
      },
      { equipmentId: id, sourceMessage: flow.sourceMessage, promptMessage: flow.promptMessage, selectionMessage: flow.selectionMessage },
    );

    return updateGiveSelectionMessage(ctx, item, ctx.session.flow);
  }, 'toggleGiveComponent'));

  bot.action(ACTIONS_REGEX.INCREMENT_GIVE_COMPONENT, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    const componentKey = ctx.match[2];
    const flow = ctx.session?.flow;
    if (!id || !componentKey || !flow || flow.type !== FLOW_TYPE.GIVE_COMPONENTS || Number(flow.equipmentId) !== id) {
      return ctx.answerCbQuery('Список комплектующих устарел.', { show_alert: true });
    }

    const item = await findEquipmentById(id);
    if (!item) {
      resetFlow(ctx);
      return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    }

    const preset = flow.data?.preset || getGiveComponentsPreset(item);
    const componentName = resolveComponentName(preset, componentKey);
    if (!componentName) {
      return ctx.answerCbQuery('Не удалось определить комплектующее.', { show_alert: true });
    }
    if (!isQuantityComponent(componentName, preset)) {
      return ctx.answerCbQuery('Для этой позиции количество не меняется.', { show_alert: true });
    }

    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_COMPONENTS,
      1,
      {
        components: incrementComponent(flow.data?.components || [], componentName),
        preset,
        durationDays: flow.data?.durationDays || null,
        expectedReturnDate: flow.data?.expectedReturnDate || null,
      },
      { equipmentId: id, sourceMessage: flow.sourceMessage, promptMessage: flow.promptMessage, selectionMessage: flow.selectionMessage },
    );

    return updateGiveSelectionMessage(ctx, item, ctx.session.flow);
  }, 'incrementGiveComponent'));

  bot.action(ACTIONS_REGEX.DECREMENT_GIVE_COMPONENT, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    const componentKey = ctx.match[2];
    const flow = ctx.session?.flow;
    if (!id || !componentKey || !flow || flow.type !== FLOW_TYPE.GIVE_COMPONENTS || Number(flow.equipmentId) !== id) {
      return ctx.answerCbQuery('Список комплектующих устарел.', { show_alert: true });
    }

    const item = await findEquipmentById(id);
    if (!item) {
      resetFlow(ctx);
      return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    }

    const preset = flow.data?.preset || getGiveComponentsPreset(item);
    const componentName = resolveComponentName(preset, componentKey);
    if (!componentName) {
      return ctx.answerCbQuery('Не удалось определить комплектующее.', { show_alert: true });
    }
    if (!isQuantityComponent(componentName, preset)) {
      return ctx.answerCbQuery('Для этой позиции количество не меняется.', { show_alert: true });
    }

    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_COMPONENTS,
      1,
      {
        components: decrementComponent(flow.data?.components || [], componentName),
        preset,
        durationDays: flow.data?.durationDays || null,
        expectedReturnDate: flow.data?.expectedReturnDate || null,
      },
      { equipmentId: id, sourceMessage: flow.sourceMessage, promptMessage: flow.promptMessage, selectionMessage: flow.selectionMessage },
    );

    return updateGiveSelectionMessage(ctx, item, ctx.session.flow);
  }, 'decrementGiveComponent'));

  bot.action(ACTIONS_REGEX.CLEAR_GIVE_COMPONENTS, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    const flow = ctx.session?.flow;
    if (!id || !flow || flow.type !== FLOW_TYPE.GIVE_COMPONENTS || Number(flow.equipmentId) !== id) {
      return ctx.answerCbQuery('Список комплектующих устарел.', { show_alert: true });
    }

    const item = await findEquipmentById(id);
    if (!item) {
      resetFlow(ctx);
      return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    }

    const preset = flow.data?.preset || getGiveComponentsPreset(item);
    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_COMPONENTS,
      1,
      {
        components: [],
        preset,
        durationDays: flow.data?.durationDays || null,
        expectedReturnDate: flow.data?.expectedReturnDate || null,
      },
      { equipmentId: id, sourceMessage: flow.sourceMessage, promptMessage: flow.promptMessage, selectionMessage: flow.selectionMessage },
    );

    return updateGiveSelectionMessage(ctx, item, ctx.session.flow);
  }, 'clearGiveComponents'));

  bot.action(ACTIONS_REGEX.FINISH_GIVE_COMPONENTS, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    const flow = ctx.session?.flow;
    if (!id || !flow || flow.type !== FLOW_TYPE.GIVE_COMPONENTS || Number(flow.equipmentId) !== id) {
      return ctx.answerCbQuery('Список комплектующих устарел.', { show_alert: true });
    }

    const item = await findEquipmentById(id);
    if (!item) {
      resetFlow(ctx);
      return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    }

    const components = normalizeComponents(flow.data?.components || []);
    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_COMPONENTS,
      2,
      {
        components,
        preset: flow.data?.preset || getGiveComponentsPreset(item),
        durationDays: flow.data?.durationDays || null,
        expectedReturnDate: flow.data?.expectedReturnDate || null,
      },
      { equipmentId: id, sourceMessage: flow.sourceMessage, promptMessage: flow.promptMessage, selectionMessage: flow.selectionMessage },
    );

    return ctx.editMessageText(
      renderGiveConfirmationText(
        item,
        components,
        flow.data?.durationDays || null,
        flow.data?.expectedReturnDate || null,
      ),
      Markup.inlineKeyboard([
        [Markup.button.callback('🛒 В корзину', `confirmGive_${id}`)],
        [Markup.button.callback('↩️ Назад к комплекту', `backToGiveComponents_${id}`)],
      ]),
    );
  }, 'finishGiveComponents'));

  bot.action(ACTIONS_REGEX.BACK_TO_GIVE_COMPONENTS, safe(async (ctx) => {
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    const flow = ctx.session?.flow;
    if (!id || !flow || flow.type !== FLOW_TYPE.GIVE_COMPONENTS || Number(flow.equipmentId) !== id) {
      return ctx.answerCbQuery('Список комплектующих устарел.', { show_alert: true });
    }

    const item = await findEquipmentById(id);
    if (!item) {
      resetFlow(ctx);
      return ctx.editMessageText(LABELS.ERR_NOT_FOUND);
    }

    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_COMPONENTS,
      1,
      {
        components: normalizeComponents(flow.data?.components || []),
        preset: flow.data?.preset || getGiveComponentsPreset(item),
        durationDays: flow.data?.durationDays || null,
        expectedReturnDate: flow.data?.expectedReturnDate || null,
      },
      { equipmentId: id, sourceMessage: flow.sourceMessage, promptMessage: flow.promptMessage, selectionMessage: flow.selectionMessage },
    );

    return updateGiveSelectionMessage(ctx, item, ctx.session.flow);
  }, 'backToGiveComponents'));

  bot.action(ACTIONS_REGEX.CONFIRM_GIVE, safe(async (ctx) => {
    const id = parseId(ctx.match[1]);
    if (!id) {
      await ctx.answerCbQuery(LABELS.ERR_INVALID_ID, { show_alert: true });
      return;
    }

    const flow = ctx.session?.flow;
    const components = flow?.type === FLOW_TYPE.GIVE_COMPONENTS && Number(flow.equipmentId) === id
      ? flow.data?.components || []
      : [];
    const durationDays = flow?.type === FLOW_TYPE.GIVE_COMPONENTS && Number(flow.equipmentId) === id
      ? flow.data?.durationDays || null
      : null;
    const expectedReturnDate = flow?.type === FLOW_TYPE.GIVE_COMPONENTS && Number(flow.equipmentId) === id
      ? flow.data?.expectedReturnDate || null
      : null;

    return addCurrentItemToGiveCart(ctx, id, components, durationDays, expectedReturnDate);
  }, 'confirmGive'));

  bot.action(ACTIONS_REGEX.ADD_MORE_GIVE_CART, safe(async (ctx) => {
    await ctx.answerCbQuery();
    return promptAddMoreEquipment(ctx);
  }, 'addMoreGiveCart'));

  bot.action(ACTIONS_REGEX.CLEAR_GIVE_CART, safe(async (ctx) => {
    await ctx.answerCbQuery('Корзина очищена');
    ensureSession(ctx);
    clearGiveCart(ctx.session);
    return showGiveCart(ctx, true);
  }, 'clearGiveCart'));

  bot.action(ACTIONS_REGEX.REMOVE_FROM_GIVE_CART, safe(async (ctx) => {
    await ctx.answerCbQuery('Позиция удалена');
    ensureSession(ctx);
    removeGiveCartItem(ctx.session, Number(ctx.match[1]));
    return showGiveCart(ctx, true);
  }, 'removeFromGiveCart'));

  bot.action(ACTIONS_REGEX.CONFIRM_GIVE_CART, safe(async (ctx) => {
    ensureSession(ctx);
    const cart = getGiveCart(ctx.session);
    if (!cart.items.length) {
      await ctx.answerCbQuery('Корзина пуста.', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery();
    const prompt = await ctx.reply('Введите название проекта:', buildBackKeyboard());
    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_PROJECT,
      1,
      {},
      {
        cartMode: true,
        promptMessage: rememberMessage(prompt),
        sourceMessage: rememberMessage(ctx.callbackQuery?.message),
      },
    );
    return prompt;
  }, 'confirmGiveCart'));

  bot.action(ACTIONS_REGEX.RETURN, safe(async (ctx) => {
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery('Неверный идентификатор.', { show_alert: true }); return; }

    const item = await findEquipmentById(id);
    if (!item) { await ctx.answerCbQuery('Оборудование не найдено.', { show_alert: true }); return; }
    if (item.status !== STATUS.WITH_USER) { await ctx.answerCbQuery('Оборудование не выдано.', { show_alert: true }); return; }
    if (Number(item.current_holder_user_id) !== ctx.from.id) {
      await ctx.answerCbQuery('Это оборудование выдано другому пользователю.', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery();
    ensureSession(ctx);
    ctx.session.flow = makeFlow(
      FLOW_TYPE.RETURN_LOCATION,
      1,
      {},
      { equipmentId: id, sourceMessage: rememberMessage(ctx.callbackQuery?.message) },
    );
    const prompt = await ctx.reply(
      'Отправьте геолокацию склада кнопкой ниже или введите город вручную:',
      buildLocationRequestKeyboard(),
    );
    ctx.session.flow.promptMessage = rememberMessage(prompt);
  }, 'return'));

  bot.action(ACTIONS_REGEX.EXTEND, safe(async (ctx) => {
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery('Неверный идентификатор.', { show_alert: true }); return; }

    const item = await findEquipmentById(id);
    if (!item) { await ctx.answerCbQuery('Оборудование не найдено.', { show_alert: true }); return; }
    if (item.status !== STATUS.WITH_USER) { await ctx.answerCbQuery('Оборудование не выдано.', { show_alert: true }); return; }
    if (Number(item.current_holder_user_id) !== Number(ctx.from.id)) {
      await ctx.answerCbQuery('Это оборудование выдано другому пользователю.', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery();
    ensureSession(ctx);
    const prompt = await ctx.reply('Введите, на сколько дней продлить эту позицию:', buildBackKeyboard());
    ctx.session.flow = makeFlow(
      FLOW_TYPE.GIVE_DURATION,
      1,
      {},
      {
        extendMode: true,
        equipmentId: id,
        promptMessage: rememberMessage(prompt),
        sourceMessage: rememberMessage(ctx.callbackQuery?.message),
      },
    );
    return prompt;
  }, 'extend'));

  bot.action(ACTIONS_REGEX.RETURN_ALL_MY, safe(async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    ctx.session.myEquipmentSelection = null;
    return showMyEquipmentSelection(ctx, 'return', true);
  }, 'returnAllMy'));

  bot.action(ACTIONS_REGEX.EXTEND_ALL_MY, safe(async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    ctx.session.myEquipmentSelection = null;
    return showMyEquipmentSelection(ctx, 'extend', true);
  }, 'extendAllMy'));

  bot.action(ACTIONS_REGEX.TOGGLE_MY_EQUIPMENT_SELECTION, safe(async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);

    const mode = ctx.match[1];
    const equipmentId = Number(ctx.match[2]);
    const selection = ctx.session.myEquipmentSelection;
    if (!selection || selection.mode !== mode) {
      ctx.session.myEquipmentSelection = null;
      return showMyEquipmentSelection(ctx, mode, true);
    }

    const selectedSet = new Set((selection.selectedIds || []).map((id) => Number(id)));
    if (selectedSet.has(equipmentId)) selectedSet.delete(equipmentId);
    else selectedSet.add(equipmentId);
    selection.selectedIds = Array.from(selectedSet);
    return showMyEquipmentSelection(ctx, mode, true);
  }, 'toggleMyEquipmentSelection'));

  bot.action(ACTIONS_REGEX.TOGGLE_ALL_MY_EQUIPMENT_SELECTION, safe(async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);

    const mode = ctx.match[1];
    const items = await getCurrentUserEquipmentItems(ctx);
    const allIds = items.map((item) => Number(item.id));
    const current = new Set((ctx.session.myEquipmentSelection?.selectedIds || []).map((id) => Number(id)));
    const allSelected = allIds.length > 0 && allIds.every((id) => current.has(id));

    ctx.session.myEquipmentSelection = {
      mode,
      selectedIds: allSelected ? [] : allIds,
    };
    return showMyEquipmentSelection(ctx, mode, true);
  }, 'toggleAllMyEquipmentSelection'));

  bot.action(ACTIONS_REGEX.CONFIRM_MY_EQUIPMENT_SELECTION, safe(async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);

    const mode = ctx.match[1];
    const selectedIds = (ctx.session.myEquipmentSelection?.selectedIds || []).map((id) => Number(id));
    if (!selectedIds.length) {
      return ctx.answerCbQuery('Сначала выберите оборудование.', { show_alert: true });
    }

    if (mode === 'extend') {
      const prompt = await ctx.reply('Введите, на сколько дней продлить выбранное оборудование:', buildBackKeyboard());
      ctx.session.flow = makeFlow(
        FLOW_TYPE.GIVE_DURATION,
        1,
        {},
        {
          extendAllMode: true,
          equipmentIds: selectedIds,
          promptMessage: rememberMessage(prompt),
          sourceMessage: rememberMessage(ctx.callbackQuery?.message),
        },
      );
      delete ctx.session.myEquipmentSelection;
      return prompt;
    }

    ctx.session.flow = makeFlow(
      FLOW_TYPE.RETURN_LOCATION,
      1,
      {},
      {
        returnAllMode: true,
        equipmentIds: selectedIds,
        sourceMessage: rememberMessage(ctx.callbackQuery?.message),
      },
    );
    const prompt = await ctx.reply(
      'Отправьте геолокацию склада кнопкой ниже или введите город вручную для возврата выбранного оборудования:',
      buildLocationRequestKeyboard(),
    );
    ctx.session.flow.promptMessage = rememberMessage(prompt);
    delete ctx.session.myEquipmentSelection;
    return prompt;
  }, 'confirmMyEquipmentSelection'));

  bot.action(ACTIONS_REGEX.CANCEL_MY_EQUIPMENT_SELECTION, safe(async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    delete ctx.session.myEquipmentSelection;
    const items = await getCurrentUserEquipmentItems(ctx);
    if (!items.length) {
      return ctx.editMessageText('У вас сейчас нет оборудования на руках.');
    }
    return ctx.editMessageText('🎒 Ваше оборудование:', buildMyEquipmentKeyboard(items));
  }, 'cancelMyEquipmentSelection'));

  bot.action(ACTIONS_REGEX.REPAIR, safe(async (ctx) => {
    if (!await canManageEquipment(ctx)) return ctx.answerCbQuery('Нет прав для этого действия.', { show_alert: true });
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply('Неверный идентификатор.');

    const item = await findEquipmentById(id);
    if (!item) return ctx.reply('Оборудование не найдено.');
    if (item.status === STATUS.WRITTEN_OFF) return ctx.answerCbQuery('Списанное оборудование нельзя отправить в ремонт.', { show_alert: true });
    if (item.status !== STATUS.IN_STOCK) return ctx.answerCbQuery('В ремонт можно отправить только оборудование на складе.', { show_alert: true });

    const locked = await acquireLock(`lock:repair:${id}`);
    if (!locked) return ctx.answerCbQuery('Действие уже выполняется...', { show_alert: true });

    try {
      await ctx.answerCbQuery('✅ Отправлено в ремонт');
      const updated = await startRepair(item, ctx.from.id, null);
      equipmentActionsTotal.inc({ action: 'repair_started' });
      const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
      const text = await renderEquipmentCard(updated);
      return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
    } finally {
      await redis.del(`lock:repair:${id}`);
    }
  }, 'repair'));

  bot.action(ACTIONS_REGEX.FROM_REPAIR, safe(async (ctx) => {
    if (!await canManageEquipment(ctx)) { await ctx.answerCbQuery('Нет прав для этого действия.', { show_alert: true }); return; }
    const id = parseId(ctx.match[1]);
    if (!id) { await ctx.answerCbQuery('Неверный идентификатор.', { show_alert: true }); return; }

    const locked = await acquireLock(`lock:fromRepair:${id}`);
    if (!locked) { await ctx.answerCbQuery('Действие уже выполняется...', { show_alert: true }); return; }

    const item = await findEquipmentById(id);
    if (!item) { await ctx.answerCbQuery('Оборудование не найдено.', { show_alert: true }); return; }
    if (item.status !== STATUS.REPAIR) { await ctx.answerCbQuery('Оборудование не в ремонте.', { show_alert: true }); return; }
    await ctx.answerCbQuery('✅ Возвращено из ремонта');
    const updated = await completeRepair(item, ctx.from.id);
    equipmentActionsTotal.inc({ action: 'repair_completed' });
    const markup = buildEquipmentMarkup(updated, { canAdmin: isEffectiveAdmin(ctx), canRepair: isEffectiveManager(ctx) });
    const text = await renderEquipmentCard(updated);
    return markup ? ctx.editMessageText(text, markup) : ctx.editMessageText(text);
  }, 'fromRepair'));

  bot.action(ACTIONS_REGEX.EDIT, safe(async (ctx) => {
    if (!await canAdminEquipment(ctx)) return ctx.answerCbQuery('Только администратор может редактировать.', { show_alert: true });
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply('Неверный идентификатор.');
    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText('Оборудование не найдено.');
    ensureSession(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.EDIT_EQUIPMENT, EDIT_STEP.SELECT_FIELD, {}, { equipmentId: id, sourceMessage: rememberMessage(ctx.callbackQuery?.message) });
    const selector = await ctx.reply('Выберите поле для редактирования:', buildEditEquipmentKeyboard());
    ctx.session.flow.selectorMessage = rememberMessage(selector);
  }, 'edit'));

  bot.action(ACTIONS_REGEX.DELETE, safe(async (ctx) => {
    if (!await canAdminEquipment(ctx)) return ctx.answerCbQuery('Только администратор может удалять.', { show_alert: true });
    await ctx.answerCbQuery();
    const id = parseId(ctx.match[1]);
    if (!id) return ctx.reply('Неверный идентификатор.');
    const item = await findEquipmentById(id);
    if (!item) return ctx.editMessageText('Оборудование не найдено.');
    const label = `${item.category || '-'} ${item.model || '-'} — ${item.serial_number || `#${item.id}`}`;
    return ctx.editMessageText(
      `❓ Удалить оборудование?\n\n${label}\n\nЭто действие необратимо.`,
      Markup.inlineKeyboard([[
        Markup.button.callback('✅ Да, удалить', `confirmDelete_${item.id}`),
        Markup.button.callback('❌ Отмена', `open_${item.id}`),
      ]]),
    );
  }, 'delete'));

  bot.action(ACTIONS_REGEX.CONFIRM_DELETE, safe(async (ctx) => {
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

module.exports = {
  finalizeGiveCart,
  registerEquipmentHandlers,
  renderGiveConfirmationText,
  renderGiveSelectionText,
  updateGiveSelectionMessage,
};
