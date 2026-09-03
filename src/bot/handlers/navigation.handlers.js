'use strict';

const { LABELS } = require('../labels');
const logger = require('../../utils/logger');
const { isEffectiveAdmin } = require('../config');
const { safe } = require('../middlewares/error.handler');
const { ensureSession, resetFlow } = require('../utils');
const { makeFlow } = require('../fsm/session.schema');
const { FLOW_TYPE, ADD_STEP } = require('../fsm/states');
const {
  listAllEquipment,
  listBrandsByCategory,
  listCategories,
  listEquipmentByCategory,
  listEquipmentByCategoryAndBrand,
} = require('../../services/equipment.service');
const { buildSummaryText, buildCategoryXlsx, createCategoryImage } = require('../../services/report.service');
const {
  assignUserRole,
  deleteUserAccount,
  getUserByTelegramId,
  isUserApproved,
  isUserProfileComplete,
  listAllUsersPaged,
  setUserApproved,
  setUserBanned,
} = require('../../services/user.service');
const {
  buildRegistrationApprovedMessage,
  buildRegistrationDeniedMessage,
} = require('../../services/notification.service');
const { startProfileRegistration, renderProfileCard } = require('../utils/profile.utils');
const { getEquipmentSuggestionText } = require('../helpers/equipmentHints');
const {
  buildBrandListKeyboard,
  buildCategoryExportKeyboard,
  buildCategoryItemsKeyboard,
  buildCategoryListKeyboard,
  buildMyEquipmentKeyboard,
  buildRoleSelectKeyboard,
  buildUserListKeyboard,
  mainMenu,
} = require('../views/menus');

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

function paginateList(items, page = 0, size = 4) {
  const totalPages = Math.max(Math.ceil(items.length / size), 1);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  return {
    items: items.slice(safePage * size, safePage * size + size),
    page: safePage,
    totalPages,
  };
}

function sortItemsForList(items) {
  return [...items].sort((a, b) => {
    const brandOrder = (a.brand || 'Без бренда').localeCompare(b.brand || 'Без бренда', 'ru');
    if (brandOrder !== 0) return brandOrder;
    return (a.model || '').localeCompare(b.model || '', 'ru');
  });
}

async function ensureRegistered(ctx) {
  if (ctx.session?.flow?.type === 'register_profile' || ctx.session?.flow?.type === 'edit_profile') return true;
  const user = await getUserByTelegramId(ctx.from.id);
  if (!isUserProfileComplete(user)) {
    startProfileRegistration(ctx, 'Сначала заполните профиль.');
    return false;
  }
  if (!isUserApproved(user)) {
    await ctx.reply('Ваша регистрация ожидает подтверждения администратора.');
    return false;
  }
  return true;
}

async function renderCategoryMenu(ctx, page = 0) {
  const categories = await listCategories();
  if (!categories.length) return ctx.reply('Нет категорий', mainMenu(ctx));

  const { items, page: safePage, totalPages } = paginateList(categories, page);
  ensureSession(ctx);
  ctx.session.selectedCategory = null;
  ctx.session.selectedBrand = null;

  if (ctx.session.mode === 'summary') ctx.session.summaryPage = safePage;
  else ctx.session.listPage = safePage;

  return ctx.reply('Выберите тип оборудования', buildCategoryListKeyboard(items, safePage, totalPages));
}

async function renderBrandMenu(ctx, categoryName, page = 0, editMessage = false) {
  const brands = await listBrandsByCategory(categoryName);
  const { items, page: safePage, totalPages } = paginateList(brands, page);
  ensureSession(ctx);
  ctx.session.mode = 'brand_list';
  ctx.session.selectedCategory = categoryName;
  ctx.session.selectedBrand = null;
  ctx.session.brandPage = safePage;
  ctx.session.brandList = brands;

  const text = `Выберите бренд для категории "${categoryName}" или нажмите "${LABELS.allBrands}"`;
  const markup = buildBrandListKeyboard(categoryName, items, safePage, totalPages, safePage * 4);
  if (editMessage) return ctx.editMessageText(text, markup);
  return ctx.reply(text, markup);
}

async function renderEquipmentList(ctx, categoryName, brandName, page = 0, editMessage = false) {
  const items = sortItemsForList(
    brandName
      ? await listEquipmentByCategoryAndBrand(categoryName, brandName)
      : await listEquipmentByCategory(categoryName),
  );

  const title = brandName ? `📦 ${categoryName} • ${brandName}` : `📦 ${categoryName} • все бренды`;
  if (!items.length) {
    const emptyText = brandName
      ? `Нет оборудования бренда ${brandName} в категории ${categoryName}`
      : `Нет оборудования в категории ${categoryName}`;
    if (editMessage) return ctx.editMessageText(emptyText);
    return ctx.reply(emptyText);
  }

  const markup = buildCategoryItemsKeyboard(items, page, {
    category: categoryName,
    brand: brandName || '',
    showBrand: false,
  });
  ensureSession(ctx);
  ctx.session.selectedCategory = categoryName;
  ctx.session.selectedBrand = brandName || null;
  ctx.session.itemsPage = page;
  if (editMessage) return ctx.editMessageText(title, markup);
  return ctx.reply(title, markup);
}

async function renderMyEquipment(ctx) {
  const allItems = await listAllEquipment();
  const items = sortItemsForList(
    allItems.filter((item) => item.status === 'у пользователя' && Number(item.current_holder_user_id) === Number(ctx.from.id)),
  );

  if (!items.length) {
    return ctx.reply('У вас сейчас нет оборудования на руках.', mainMenu(ctx));
  }

  return ctx.reply('🎒 Ваше оборудование:', buildMyEquipmentKeyboard(items));
}

function registerNavigationHandlers(bot) {
  bot.start(safe(async (ctx) => {
    resetFlow(ctx);
    if (!await ensureRegistered(ctx)) return;
    return ctx.reply('Система учета оборудования', mainMenu(ctx));
  }, 'start'));

  bot.hears(LABELS.profile, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    return renderProfileCard(ctx);
  }, 'profile'));

  bot.hears(LABELS.myEquipment, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    resetFlow(ctx);
    return renderMyEquipment(ctx);
  }, 'myEquipment'));

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
    ctx.session.flow = makeFlow(FLOW_TYPE.ADD_EQUIPMENT, ADD_STEP.CATEGORY);
    const prompt = await getEquipmentSuggestionText(
      'category',
      'Введите категорию оборудования:',
    );
    return ctx.reply(prompt.text, mergeWithBackKeyboard(prompt.options));
  }, 'addEquipment'));

  bot.hears(LABELS.previousPage, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    ensureSession(ctx);

    const page = ctx.session.mode === 'summary'
      ? Math.max((ctx.session.summaryPage || 0) - 1, 0)
      : Math.max((ctx.session.listPage || 0) - 1, 0);
    return renderCategoryMenu(ctx, page);
  }, 'previousPage'));

  bot.hears(LABELS.nextPage, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    ensureSession(ctx);

    const page = ctx.session.mode === 'summary'
      ? (ctx.session.summaryPage || 0) + 1
      : (ctx.session.listPage || 0) + 1;
    return renderCategoryMenu(ctx, page);
  }, 'nextPage'));

  bot.hears(LABELS.back, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = null;
    ctx.session.selectedCategory = null;
    ctx.session.selectedBrand = null;
    return ctx.reply('Главное меню', mainMenu(ctx));
  }, 'back'));

  bot.action('back_categories', safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    await ctx.answerCbQuery();
    ensureSession(ctx);

    if (ctx.session.mode === 'brand_list') {
      ctx.session.mode = 'list';
      ctx.session.selectedCategory = null;
      ctx.session.selectedBrand = null;
      return renderCategoryMenu(ctx, ctx.session.listPage || 0);
    }

    if (ctx.session.selectedCategory) {
      return renderBrandMenu(ctx, ctx.session.selectedCategory, ctx.session.brandPage || 0, true);
    }

    const page = ctx.session.mode === 'summary' ? ctx.session.summaryPage || 0 : ctx.session.listPage || 0;
    return renderCategoryMenu(ctx, page);
  }, 'back_categories'));

  bot.action(/^back_brandlist$/, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    await ctx.answerCbQuery();

    ensureSession(ctx);
    const categoryName = ctx.session.selectedCategory;
    if (!categoryName) return renderCategoryMenu(ctx, ctx.session.listPage || 0);
    ctx.session.selectedCategory = categoryName;
    ctx.session.selectedBrand = null;
    return renderBrandMenu(ctx, categoryName, ctx.session.brandPage || 0, true);
  }, 'back_brandlist'));

  bot.action(/^brandPage_(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    const categoryName = ctx.session.selectedCategory;
    if (!categoryName) return renderCategoryMenu(ctx, ctx.session.listPage || 0);
    const page = Number(ctx.match[1]) || 0;
    return renderBrandMenu(ctx, categoryName, page, true);
  }, 'brandPage'));

  bot.action(/^brandSelect_(all|\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery();

    ensureSession(ctx);
    const categoryName = ctx.session.selectedCategory;
    if (!categoryName) return renderCategoryMenu(ctx, ctx.session.listPage || 0);
    const token = ctx.match[1];
    const brandName = token === 'all'
      ? null
      : ctx.session.brandList?.[Number(token)] || null;
    ctx.session.selectedCategory = categoryName;
    ctx.session.selectedBrand = brandName;
    return renderEquipmentList(ctx, categoryName, brandName, 0, true);
  }, 'brandSelect'));

  bot.action(/excelCategory_(.+)/, safe(async (ctx) => {
    if (!await ensureRegistered(ctx)) return;
    await ctx.answerCbQuery('Генерирую Excel...');
    let categoryName;
    try { categoryName = decodeURIComponent(ctx.match[1]); } catch { categoryName = ctx.match[1]; }
    const items = await listEquipmentByCategory(categoryName);
    if (!items.length) return ctx.reply(`Нет оборудования в категории ${categoryName}`);
    const buffer = await buildCategoryXlsx(categoryName, items);
    const safeName = categoryName.replace(/[\\/:*?"<>|]/g, '_');
    return ctx.replyWithDocument({ source: buffer, filename: `category-${safeName}.xlsx` });
  }, 'excelCategory'));

  bot.action(/^itemsPage_(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    const categoryName = ctx.session.selectedCategory;
    const brandName = ctx.session.selectedBrand || null;
    if (!categoryName) return renderCategoryMenu(ctx, ctx.session.listPage || 0);
    const page = Number(ctx.match[1]) || 0;
    return renderEquipmentList(ctx, categoryName, brandName, page, true);
  }, 'itemsPage'));

  bot.action('noop', (ctx) => ctx.answerCbQuery());

  bot.hears(LABELS.manageUsers, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) return ctx.reply('Нет прав.', mainMenu(ctx));
    const { users, totalPages } = await listAllUsersPaged({ page: 0 });
    return ctx.reply('👥 Пользователи:', buildUserListKeyboard(users, 0, totalPages));
  }, 'manageUsers'));

  bot.action(/users_page_(\d+)/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const page = Number(ctx.match[1]) || 0;
    const { users, totalPages } = await listAllUsersPaged({ page });
    return ctx.editMessageText('👥 Пользователи:', buildUserListKeyboard(users, page, totalPages));
  }, 'users_page'));

  bot.action(/set_role_select_(\d+)_(\d+)/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const telegramUserId = Number(ctx.match[1]);
    const page = Number(ctx.match[2]) || 0;
    const user = await getUserByTelegramId(telegramUserId);
    if (!user) return ctx.answerCbQuery('Пользователь не найден.', { show_alert: true });
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `#${telegramUserId}`;
    const status = user.is_banned
      ? 'заблокирован'
      : user.is_approved === false
        ? 'ожидает подтверждения'
        : 'активен';
    return ctx.editMessageText(
      `👤 ${name}\nТелефон: ${user.phone || '—'}\nТекущая роль: ${user.role || 'user'}\nСтатус: ${status}\n\nВыберите действие:`,
      buildRoleSelectKeyboard(telegramUserId, { isApproved: Boolean(user.is_approved), isBanned: Boolean(user.is_banned), page }),
    );
  }, 'set_role_select'));

  bot.action(/set_role_(\d+)_(user|manager|admin)/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }
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

  bot.action(/toggle_ban_(\d+)_(0|1)_(\d+)/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }

    const telegramUserId = Number(ctx.match[1]);
    const shouldBan = ctx.match[2] === '1';
    const page = Number(ctx.match[3]) || 0;

    if (telegramUserId === ctx.from?.id) {
      await ctx.answerCbQuery('Нельзя забанить самого себя.', { show_alert: true });
      return;
    }

    const user = await getUserByTelegramId(telegramUserId);
    const name = user
      ? ([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `#${telegramUserId}`)
      : `#${telegramUserId}`;

    if (shouldBan) {
      try {
        await deleteUserAccount(telegramUserId);
      } catch (err) {
        if (err.code === 'HAS_EQUIPMENT') {
          await ctx.answerCbQuery('Нельзя удалить пользователя с активным оборудованием.', { show_alert: true });
          return;
        }
        throw err;
      }

      await ctx.answerCbQuery('Пользователь заблокирован и удалён.');
      return ctx.editMessageText(`❌ Пользователь ${name} заблокирован и удалён из базы.`);
    }

    await setUserBanned(telegramUserId, false);
    await ctx.answerCbQuery('Пользователь разблокирован.');
    const status = 'активен';

    return ctx.editMessageText(
      `✅ Статус пользователя ${name} обновлён.\nТекущий статус: ${status}`,
      buildRoleSelectKeyboard(telegramUserId, { isBanned: false, page }),
    );
  }, 'toggle_ban'));

  bot.action(/approve_registration_(\d+)/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }

    const telegramUserId = Number(ctx.match[1]);
    const user = await getUserByTelegramId(telegramUserId);
    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден.', { show_alert: true });
      return;
    }

    if (user.is_banned) {
      await ctx.answerCbQuery('Пользователь заблокирован.', { show_alert: true });
      return;
    }

    if (isUserApproved(user)) {
      await ctx.answerCbQuery('Регистрация уже подтверждена.');
      return;
    }

    await setUserApproved(telegramUserId, true);
    await ctx.telegram.sendMessage(telegramUserId, buildRegistrationApprovedMessage(), {
      link_preview_options: { is_disabled: true },
      ...mainMenu({
        from: { id: telegramUserId },
        session: { userRole: user.role || 'user' },
      }),
    });
    await ctx.answerCbQuery('Регистрация подтверждена.');

    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `#${telegramUserId}`;
    return ctx.editMessageText(`✅ Регистрация пользователя ${name} подтверждена.`);
  }, 'approve_registration'));

  bot.action(/deny_registration_(\d+)/, safe(async (ctx) => {
    if (!isEffectiveAdmin(ctx)) { await ctx.answerCbQuery('Нет прав.', { show_alert: true }); return; }

    const telegramUserId = Number(ctx.match[1]);
    const user = await getUserByTelegramId(telegramUserId);
    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден.', { show_alert: true });
      return;
    }

    if (isUserApproved(user)) {
      await ctx.answerCbQuery('Регистрация уже подтверждена.');
      return;
    }

    try {
      await deleteUserAccount(telegramUserId);
    } catch (err) {
      if (err.code === 'HAS_EQUIPMENT') {
        await ctx.answerCbQuery('Нельзя отклонить пользователя с активным оборудованием.', { show_alert: true });
        return;
      }
      throw err;
    }

    await ctx.telegram.sendMessage(telegramUserId, buildRegistrationDeniedMessage(), {
      link_preview_options: { is_disabled: true },
    }).catch(() => {});
    await ctx.answerCbQuery('Регистрация отклонена.');

    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `#${telegramUserId}`;
    return ctx.editMessageText(`❌ Регистрация пользователя ${name} отклонена.`);
  }, 'deny_registration'));

  bot.hears(/.*/, safe(async (ctx, next) => {
    if (!await ensureRegistered(ctx)) return;
    const text = ctx.message?.text;
    if (!text) return next();
    ensureSession(ctx);
    if (ctx.session.flow) return next();

    const menuTexts = [
      LABELS.back, LABELS.previousPage, LABELS.nextPage,
      LABELS.categories, LABELS.myEquipment, LABELS.summary,
      LABELS.addEquipment, LABELS.profile, LABELS.manageUsers,
    ];
    if (menuTexts.includes(text)) return next();

    const categories = await listCategories();
    if (!categories.includes(text)) return next();

    if (ctx.session.mode === 'summary') {
      const items = await listEquipmentByCategory(text);
      const loading = await ctx.reply('Генерируется изображение, подождите...');
      const safeName = text.replace(/[\\/:*?"<>|]/g, '_');
      try {
        const buf = await createCategoryImage(items);
        const response = await ctx.replyWithPhoto(
          { source: buf, filename: `category-${safeName}.png` },
          { caption: `📦 ${text}`, parse_mode: 'HTML', ...buildCategoryExportKeyboard(text) },
        );
        await ctx.deleteMessage(loading.message_id).catch(() => {});
        return response;
      } catch (err) {
        logger.error({ err: err.message }, 'Image generation error');
        try {
          const buffer = await buildCategoryXlsx(text, items);
          await ctx.deleteMessage(loading.message_id).catch(() => {});
          await ctx.reply('Не удалось собрать PNG-изображение. Отправляю Excel-файл этой категории.');
          return ctx.replyWithDocument(
            { source: buffer, filename: `category-${safeName}.xlsx` },
            { caption: `📦 ${text}` },
          );
        } catch (fallbackErr) {
          logger.error({ err: fallbackErr.message }, 'Category export fallback error');
          await ctx.deleteMessage(loading.message_id).catch(() => {});
          return ctx.reply('Ошибка при создании изображения и резервного файла Excel.');
        }
      }
    }

    return renderBrandMenu(ctx, text, 0);
  }, 'catchAll'));
}

module.exports = { registerNavigationHandlers };
