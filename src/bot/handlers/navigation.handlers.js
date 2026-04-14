'use strict';

const { LABELS } = require('../labels');
const logger = require('../../utils/logger');
const { isAdmin } = require('../config');
const { ensureSession, resetFlow } = require('../utils');
const { listCategories, listEquipmentByCategory } = require('../../services/equipment.service');
const { buildSummaryText, buildCategoryXlsx, createCategoryImage } = require('../../services/report.service');
const { getUserByTelegramId, isUserProfileComplete } = require('../../services/user.service');
const { startProfileRegistration, renderProfileCard } = require('../utils/profile.utils');
const {
  buildCategoryExportKeyboard,
  buildCategoryItemsKeyboard,
  buildCategoryListKeyboard,
  mainMenu,
} = require('../views/menus');

async function ensureRegistered(ctx) {
  if (ctx.session?.flow?.type === 'register_profile' || ctx.session?.flow?.type === 'edit_profile') return true;
  const user = await getUserByTelegramId(ctx.from.id);
  if (!isUserProfileComplete(user)) {
    startProfileRegistration(ctx, 'Сначала заполните профиль.');
    return false;
  }
  return true;
}

function paginateCategories(categories, page = 0, size = 4) {
  const totalPages = Math.max(Math.ceil(categories.length / size), 1);
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  return { items: categories.slice(safePage * size, safePage * size + size), page: safePage, totalPages };
}

async function renderCategoryMenu(ctx, page = 0) {
  const categories = await listCategories();
  if (!categories.length) return ctx.reply('Нет категорий', mainMenu(ctx));

  const { items, page: safePage, totalPages } = paginateCategories(categories, page);
  ensureSession(ctx);
  if (ctx.session.mode === 'summary') ctx.session.summaryPage = safePage;
  else                                ctx.session.listPage    = safePage;

  return ctx.reply('Выберите категорию', buildCategoryListKeyboard(items, safePage, totalPages));
}

function registerNavigationHandlers(bot) {
  bot.start(async (ctx) => {
    resetFlow(ctx);
    if (!await ensureRegistered(ctx)) return;
    return ctx.reply('Система учёта оборудования', mainMenu(ctx));
  });

  bot.hears(LABELS.profile, async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    return renderProfileCard(ctx);
  });

  bot.hears(LABELS.categories, async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = 'list';
    return renderCategoryMenu(ctx, ctx.session.listPage || 0);
  });

  bot.hears(LABELS.summary, async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = 'summary';
    await ctx.reply(await buildSummaryText(), { parse_mode: 'HTML' });
    return renderCategoryMenu(ctx, ctx.session.summaryPage || 0);
  });

  bot.hears(LABELS.addEquipment, async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    if (!isAdmin(ctx)) return ctx.reply('Только администратор может добавлять оборудование.', mainMenu(ctx));
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.flow = { type: 'add_equipment', step: 1, data: {}, startedAt: Date.now(), version: 1 };
    return ctx.reply('Введите категорию оборудования:');
  });

  bot.hears(LABELS.previousPage, async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    ensureSession(ctx);
    const page = ctx.session.mode === 'summary'
      ? Math.max((ctx.session.summaryPage || 0) - 1, 0)
      : Math.max((ctx.session.listPage    || 0) - 1, 0);
    return renderCategoryMenu(ctx, page);
  });

  bot.hears(LABELS.nextPage, async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    ensureSession(ctx);
    const page = ctx.session.mode === 'summary'
      ? (ctx.session.summaryPage || 0) + 1
      : (ctx.session.listPage    || 0) + 1;
    return renderCategoryMenu(ctx, page);
  });

  bot.hears(LABELS.back, async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = null;
    return ctx.reply('Главное меню', mainMenu(ctx));
  });

  bot.action('back_categories', async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    await ctx.answerCbQuery();
    ensureSession(ctx);
    const page = ctx.session.mode === 'summary' ? ctx.session.summaryPage || 0 : ctx.session.listPage || 0;
    return renderCategoryMenu(ctx, page);
  });

  bot.action(/excelCategory_(.+)/, async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    await ctx.answerCbQuery('Генерирую Excel…');
    let categoryName;
    try { categoryName = decodeURIComponent(ctx.match[1]); } catch { categoryName = ctx.match[1]; }
    try {
      const items = await listEquipmentByCategory(categoryName);
      if (!items.length) return ctx.reply(`Нет оборудования в категории ${categoryName}`);
      const buffer   = await buildCategoryXlsx(categoryName, items);
      const safeName = categoryName.replace(/[\\/:*?"<>|]/g, '_');
      return ctx.replyWithDocument({ source: buffer, filename: `category-${safeName}.xlsx` });
    } catch (err) {
      logger.error('Excel export error', { err: err.message });
      return ctx.reply('Ошибка при создании Excel-файла.');
    }
  });

  bot.action(/itemsPage_(.+)_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      let categoryName;
      try { categoryName = decodeURIComponent(ctx.match[1]); } catch { categoryName = ctx.match[1]; }
      const page  = Number(ctx.match[2]) || 0;
      const items = await listEquipmentByCategory(categoryName);
      if (!items.length) return ctx.editMessageText(`Нет оборудования в категории ${categoryName}`);
      return ctx.editMessageText(`📦 ${categoryName}`, buildCategoryItemsKeyboard(items, page));
    } catch (err) {
      logger.error('ItemsPage error', { err: err.message });
    }
  });

  bot.action('noop', (ctx) => ctx.answerCbQuery());

  // Catch-all text — check if it matches a category name
  bot.hears(/.*/, async (ctx, next) => {
    if (!await ensureRegistered(ctx)) return;
    const text = ctx.message?.text;
    if (!text) return next();
    ensureSession(ctx);
    if (ctx.session.flow) return next();

    const MENU_TEXTS = [LABELS.back, LABELS.previousPage, LABELS.nextPage, LABELS.categories, LABELS.summary, LABELS.addEquipment, LABELS.profile];
    if (MENU_TEXTS.includes(text)) return next();

    const categories = await listCategories();
    if (!categories.includes(text)) return next();

    const items = await listEquipmentByCategory(text);

    if (ctx.session.mode === 'summary') {
      const loading = await ctx.reply('Генерируется изображение, подождите…');
      try {
        const buf      = await createCategoryImage(text, items);
        const safeName = text.replace(/[\\/:*?"<>|]/g, '_');
        const response = await ctx.replyWithPhoto(
          { source: buf, filename: `category-${safeName}.png` },
          { caption: `📦 ${text}`, parse_mode: 'HTML', ...buildCategoryExportKeyboard(text) },
        );
        await ctx.deleteMessage(loading.message_id).catch(() => {});
        return response;
      } catch (err) {
        logger.error('Image generation error', { err: err.message });
        await ctx.deleteMessage(loading.message_id).catch(() => {});
        return ctx.reply('Ошибка при создании изображения.');
      }
    }

    return ctx.reply(`📦 ${text}`, buildCategoryItemsKeyboard(items, 0));
  });
}

module.exports = { registerNavigationHandlers };
