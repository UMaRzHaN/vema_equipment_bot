'use strict';

const { isEffectiveAdmin } = require('../config');
const { LABELS } = require('../labels');
const { safe } = require('../middlewares/error.handler');
const { ensureSession, resetFlow } = require('../utils');
const { makeFlow } = require('../fsm/session.schema');
const { FLOW_TYPE } = require('../fsm/states');
const {
  ITEMS_PER_PAGE,
  buildBackKeyboard,
  buildCategoryKitKeyboard,
  buildKitCategoryListKeyboard,
  mainMenu,
} = require('../views/menus');
const { listCategories } = require('../../services/equipment.service');
const {
  getCategoryKit,
  resetCategoryKit,
  saveCategoryKit,
} = require('../../services/category-kit.service');
const { formatKitItems, parseKitInput } = require('../../utils/component-presets');

const FIELD_LABELS = { full: 'полный комплект', minimal: 'минимум' };

function renderKitCard(kit) {
  const source = kit.configured ? 'настроено админом' : 'по умолчанию';
  const state = kit.hasKit ? 'есть' : 'нет';

  return [
    `🧰 Категория: ${kit.category}`,
    '',
    `Комплект: ${state} (${source})`,
    `Полный комплект: ${formatKitItems(kit.fullItems)}`,
    `Минимум: ${formatKitItems(kit.minimalItems)}`,
  ].join('\n');
}

async function renderKitCategoryList(ctx, page, edit = false) {
  ensureSession(ctx);
  const categories = await listCategories();
  ctx.session.kitCategories = categories;

  if (!categories.length) {
    const text = 'Категорий пока нет. Сначала добавьте оборудование.';
    return edit ? ctx.editMessageText(text) : ctx.reply(text, mainMenu(ctx));
  }

  const totalPages = Math.max(Math.ceil(categories.length / ITEMS_PER_PAGE), 1);
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * ITEMS_PER_PAGE;

  const entries = [];
  for (const [offset, name] of categories.slice(start, start + ITEMS_PER_PAGE).entries()) {
    const kit = await getCategoryKit(name);
    entries.push({ name, index: start + offset, hasKit: kit.hasKit });
  }

  const text = '🧰 Комплекты по категориям\n\n🧰 — при выдаче спрашиваем комплектующие\n🚫 — комплекта нет, шаг пропускается';
  const keyboard = buildKitCategoryListKeyboard(entries, safePage, totalPages);
  return edit ? ctx.editMessageText(text, keyboard) : ctx.reply(text, keyboard);
}

function resolveCategory(ctx, index) {
  ensureSession(ctx);
  return ctx.session.kitCategories?.[index] || null;
}

async function showKitCard(ctx, index, edit = true) {
  const category = resolveCategory(ctx, index);
  if (!category) {
    await ctx.answerCbQuery('Список категорий устарел, откройте его заново.', { show_alert: true });
    return renderKitCategoryList(ctx, 0, edit);
  }

  const kit = await getCategoryKit(category);
  const text = renderKitCard(kit);
  const keyboard = buildCategoryKitKeyboard(index, kit);
  return edit ? ctx.editMessageText(text, keyboard) : ctx.reply(text, keyboard);
}

async function handleCategoryKitInput(ctx, text, flow) {
  const { category, field } = flow.data || {};

  if (text === LABELS.back) {
    resetFlow(ctx);
    return renderKitCategoryList(ctx, 0);
  }
  if (!category || !field) {
    resetFlow(ctx);
    return ctx.reply('Настройка устарела, откройте «Комплекты» заново.', mainMenu(ctx));
  }

  const parsed = parseKitInput(text);
  if (parsed.error) return ctx.reply(parsed.error);

  const changes = field === 'full' ? { fullItems: parsed.items } : { minimalItems: parsed.items };
  if (field === 'full') {
    const names = new Set(parsed.items.map((item) => item.name));
    const current = await getCategoryKit(category);
    changes.minimalItems = current.minimalItems.filter((item) => names.has(item.name));
  }

  const kit = await saveCategoryKit(category, changes, ctx.from.id);
  const index = ctx.session.kitCategories?.indexOf(category) ?? -1;
  resetFlow(ctx);

  await ctx.reply(`✅ Сохранено: ${FIELD_LABELS[field]} для «${category}».`, mainMenu(ctx));
  return ctx.reply(renderKitCard(kit), buildCategoryKitKeyboard(index, kit));
}

function registerCategoryKitHandlers(bot) {
  bot.hears(LABELS.categoryKits, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) return ctx.reply('Нет прав.', mainMenu(ctx));
    resetFlow(ctx);
    return renderKitCategoryList(ctx, 0);
  }, 'categoryKits'));

  bot.action(/^kitPage_(\d+)$/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    return renderKitCategoryList(ctx, Number(ctx.match[1]) || 0, true);
  }, 'kitPage'));

  bot.action(/^kitCategory_(\d+)$/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    return showKitCard(ctx, Number(ctx.match[1]));
  }, 'kitCategory'));

  bot.action(/^kitToggle_(\d+)$/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    const index = Number(ctx.match[1]);
    const category = resolveCategory(ctx, index);
    if (!category) {
      await ctx.answerCbQuery('Список категорий устарел, откройте его заново.', { show_alert: true });
      return renderKitCategoryList(ctx, 0, true);
    }

    const current = await getCategoryKit(category);
    await saveCategoryKit(category, { hasKit: !current.hasKit }, ctx.from.id);
    await ctx.answerCbQuery(current.hasKit ? 'Комплект выключен' : 'Комплект включен');
    return showKitCard(ctx, index);
  }, 'kitToggle'));

  bot.action(/^kitReset_(\d+)$/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    const index = Number(ctx.match[1]);
    const category = resolveCategory(ctx, index);
    if (!category) {
      await ctx.answerCbQuery('Список категорий устарел, откройте его заново.', { show_alert: true });
      return renderKitCategoryList(ctx, 0, true);
    }

    await resetCategoryKit(category);
    await ctx.answerCbQuery('Настройка сброшена');
    return showKitCard(ctx, index);
  }, 'kitReset'));

  bot.action(/^kitEdit_(\d+)_(full|minimal)$/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    const index = Number(ctx.match[1]);
    const field = ctx.match[2];
    const category = resolveCategory(ctx, index);
    if (!category) {
      await ctx.answerCbQuery('Список категорий устарел, откройте его заново.', { show_alert: true });
      return renderKitCategoryList(ctx, 0, true);
    }

    await ctx.answerCbQuery();
    ensureSession(ctx);
    const kit = await getCategoryKit(category);
    const current = field === 'full' ? kit.fullItems : kit.minimalItems;

    ctx.session.flow = makeFlow(FLOW_TYPE.EDIT_CATEGORY_KIT, 1, { category, field });

    return ctx.reply(
      [
        `Категория «${category}» — ${FIELD_LABELS[field]}.`,
        `Сейчас: ${formatKitItems(current)}`,
        '',
        'Отправьте позиции через запятую. Для позиций с количеством добавьте xN:',
        'Штатив, Анемометр, Батарейка x2',
        '',
        field === 'minimal'
          ? 'Позиции, которых нет в полном комплекте, будут пропущены.'
          : 'Чтобы очистить список, отправьте «-».',
      ].join('\n'),
      buildBackKeyboard(),
    );
  }, 'kitEdit'));
}

module.exports = { handleCategoryKitInput, registerCategoryKitHandlers, renderKitCard };
