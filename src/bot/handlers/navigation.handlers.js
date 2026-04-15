'use strict';

const { LABELS } = require('../labels');
const logger = require('../../utils/logger');
const { isAdmin, isEffectiveAdmin } = require('../config');
const { safe } = require('../middlewares/error.handler');
const { ensureSession, resetFlow } = require('../utils');
const { listCategories, listEquipmentByCategory } = require('../../services/equipment.service');
const { buildSummaryText, buildCategoryXlsx, createCategoryImage } = require('../../services/report.service');
const { assignUserRole, getUserByTelegramId, isUserProfileComplete, listAllUsersPaged } = require('../../services/user.service');
const { startProfileRegistration, renderProfileCard } = require('../utils/profile.utils');
const {
  buildCategoryExportKeyboard,
  buildCategoryItemsKeyboard,
  buildCategoryListKeyboard,
  buildRoleSelectKeyboard,
  buildUserListKeyboard,
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
  bot.start(safe(async (ctx) => {
    resetFlow(ctx);
    if (!await ensureRegistered(ctx)) return;
    return ctx.reply('Система учёта оборудования', mainMenu(ctx));
  }, 'start'));

  bot.hears(LABELS.profile, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    return renderProfileCard(ctx);
  }, 'profile'));

  bot.hears(LABELS.categories, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = 'list';
    return renderCategoryMenu(ctx, ctx.session.listPage || 0);
  }, 'categories'));

  bot.hears(LABELS.summary, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = 'summary';
    await ctx.reply(await buildSummaryText(), { parse_mode: 'HTML' });
    return renderCategoryMenu(ctx, ctx.session.summaryPage || 0);
  }, 'summary'));

  bot.hears(LABELS.addEquipment, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    if (!isEffectiveAdmin(ctx)) return ctx.reply('Только администратор может добавлять оборудование.', mainMenu(ctx));
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.flow = { type: 'add_equipment', step: 1, data: {}, startedAt: Date.now(), version: 1 };
    return ctx.reply('Введите категорию оборудования:');
  }, 'addEquipment'));

  bot.hears(LABELS.previousPage, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    ensureSession(ctx);
    const page = ctx.session.mode === 'summary'
      ? Math.max((ctx.session.summaryPage || 0) - 1, 0)
      : Math.max((ctx.session.listPage    || 0) - 1, 0);
    return renderCategoryMenu(ctx, page);
  }, 'previousPage'));

  bot.hears(LABELS.nextPage, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    ensureSession(ctx);
    const page = ctx.session.mode === 'summary'
      ? (ctx.session.summaryPage || 0) + 1
      : (ctx.session.listPage    || 0) + 1;
    return renderCategoryMenu(ctx, page);
  }, 'nextPage'));

  bot.hears(LABELS.back, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = null;
    return ctx.reply('Главное меню', mainMenu(ctx));
  }, 'back'));

  bot.action('back_categories', safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    await ctx.answerCbQuery();
    ensureSession(ctx);
    const page = ctx.session.mode === 'summary' ? ctx.session.summaryPage || 0 : ctx.session.listPage || 0;
    return renderCategoryMenu(ctx, page);
  }, 'back_categories'));

  // ── Category Excel export ─────────────────────────────────────────────────
  bot.action(/excelCategory_(.+)/, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    await ctx.answerCbQuery('Генерирую Excel…');
    let categoryName;
    try { categoryName = decodeURIComponent(ctx.match[1]); } catch { categoryName = ctx.match[1]; }
    const items = await listEquipmentByCategory(categoryName);
    if (!items.length) return ctx.reply(`Нет оборудования в категории ${categoryName}`);
    const buffer   = await buildCategoryXlsx(categoryName, items);
    const safeName = categoryName.replace(/[\\/:*?"<>|]/g, '_');
    return ctx.replyWithDocument({ source: buffer, filename: `category-${safeName}.xlsx` });
  }, 'excelCategory'));

  // ── Category items pagination ─────────────────────────────────────────────
  bot.action(/itemsPage_(.+)_(\d+)/, safe(async (ctx) => {
    await ctx.answerCbQuery();
    let categoryName;
    try { categoryName = decodeURIComponent(ctx.match[1]); } catch { categoryName = ctx.match[1]; }
    const page  = Number(ctx.match[2]) || 0;
    const items = await listEquipmentByCategory(categoryName);
    if (!items.length) return ctx.editMessageText(`Нет оборудования в категории ${categoryName}`);
    return ctx.editMessageText(`📦 ${categoryName}`, buildCategoryItemsKeyboard(items, page));
  }, 'itemsPage'));

  bot.action('noop', (ctx) => ctx.answerCbQuery());

  // ── User management (admin only) ──────────────────────────────────────────
  bot.hears(LABELS.manageUsers, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) return ctx.reply('Нет прав.', mainMenu(ctx));
    const { users, totalPages } = await listAllUsersPaged({ page: 0 });
    return ctx.reply('👥 Пользователи:', buildUserListKeyboard(users, 0, totalPages));
  }, 'manageUsers'));

  bot.action(/users_page_(\d+)/, safe(async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const page = Number(ctx.match[1]) || 0;
    const { users, totalPages } = await listAllUsersPaged({ page });
    return ctx.editMessageText('👥 Пользователи:', buildUserListKeyboard(users, page, totalPages));
  }, 'users_page'));

  bot.action(/set_role_select_(\d+)/, safe(async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const telegramUserId = Number(ctx.match[1]);
    const user = await getUserByTelegramId(telegramUserId);
    if (!user) return ctx.answerCbQuery('Пользователь не найден.', { show_alert: true });
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `#${telegramUserId}`;
    return ctx.editMessageText(
      `👤 ${name}\nТелефон: ${user.phone || '—'}\nТекущая роль: ${user.role || 'user'}\n\nВыберите новую роль:`,
      buildRoleSelectKeyboard(telegramUserId),
    );
  }, 'set_role_select'));

  bot.action(/set_role_(\d+)_(user|manager|admin)/, safe(async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const telegramUserId = Number(ctx.match[1]);
    const newRole = ctx.match[2];
    await assignUserRole(telegramUserId, newRole);
    const user = await getUserByTelegramId(telegramUserId);
    const name = user
      ? ([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `#${telegramUserId}`)
      : `#${telegramUserId}`;
    return ctx.editMessageText(`✅ Роль пользователя ${name} изменена на: ${newRole}`);
  }, 'set_role'));

  // ── Catch-all text — check if it matches a category name ─────────────────
  bot.hears(/.*/, safe(async (ctx, next) => {
    if (!await ensureRegistered(ctx)) return;
    const text = ctx.message?.text;
    if (!text) return next();
    ensureSession(ctx);
    if (ctx.session.flow) return next();

    const MENU_TEXTS = [
      LABELS.back, LABELS.previousPage, LABELS.nextPage,
      LABELS.categories, LABELS.summary,
      LABELS.addEquipment, LABELS.profile, LABELS.manageUsers,
    ];
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
        logger.error({ err: err.message }, 'Image generation error');
        await ctx.deleteMessage(loading.message_id).catch(() => {});
        return ctx.reply('Ошибка при создании изображения.');
      }
    }

    return ctx.reply(`📦 ${text}`, buildCategoryItemsKeyboard(items, 0));
  }, 'catchAll'));
}

module.exports = { registerNavigationHandlers };
