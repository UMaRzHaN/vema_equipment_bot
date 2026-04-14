const { LABELS } = require("../labels");
const logger = require("../../utils/logger.js");
const { isAdmin } = require("../config");
const { ensureSession, resetFlow } = require("../utils");
const { listCategories, listEquipmentByCategory } = require("../../services/equipment.service");
const { buildSummaryText, buildCategoryXlsx, createCategoryImage } = require("../../services/report.service");
const { getUserByTelegramId, isUserProfileComplete } = require("../../services/user.service");
const { startProfileRegistration, renderProfileCard } = require("../utils/profile.utils");
const {
  buildCategoryExportKeyboard,
  buildCategoryItemsKeyboard,
  buildCategoryListKeyboard,
  mainMenu,
} = require("../views/menus");

function ensureRegistered(ctx) {
  if (ctx.session?.flow?.type === "register_profile" || ctx.session?.flow?.type === "edit_profile") {
    return true;
  }

  const user = getUserByTelegramId(ctx.from.id);

  if (!isUserProfileComplete(user)) {
    startProfileRegistration(ctx, "Сначала заполните профиль.");
    return false;
  }

  return true;
}

function paginateCategories(categories, page = 0, size = 4) {
  const totalPages = Math.max(Math.ceil(categories.length / size), 1);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * size;

  return {
    items: categories.slice(start, start + size),
    page: safePage,
    totalPages,
  };
}

function renderCategoryMenu(ctx, page = 0) {
  const categories = listCategories();

  if (!categories.length) {
    return ctx.reply("Нет категорий", mainMenu(ctx));
  }

  const { items, page: safePage, totalPages } = paginateCategories(categories, page);

  ensureSession(ctx);
  if (ctx.session.mode === "summary") {
    ctx.session.summaryPage = safePage;
  } else {
    ctx.session.listPage = safePage;
  }

  return ctx.reply(
    "Выберите категорию",
    buildCategoryListKeyboard(items, safePage, totalPages),
  );
}

function registerNavigationHandlers(bot) {
  bot.start((ctx) => {
    resetFlow(ctx);

    if (!ensureRegistered(ctx)) return;

    return ctx.reply("Система учета оборудования", mainMenu(ctx));
  });

  bot.hears(LABELS.profile, (ctx) => {
    if (!ensureRegistered(ctx)) return;

    return renderProfileCard(ctx);
  });

  bot.hears(LABELS.categories, (ctx) => {
    if (!ensureRegistered(ctx)) return;

    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = "list";
    return renderCategoryMenu(ctx, ctx.session.listPage || 0);
  });

  bot.hears(LABELS.summary, async (ctx) => {
    if (!ensureRegistered(ctx)) return;

    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = "summary";

    await ctx.reply(buildSummaryText(), { parse_mode: "HTML" });
    return renderCategoryMenu(ctx, ctx.session.summaryPage || 0);
  });

  bot.hears(LABELS.addEquipment, (ctx) => {
    if (!ensureRegistered(ctx)) return;

    if (!isAdmin(ctx)) {
      return ctx.reply(
        "Только администратор может добавлять оборудование.",
        mainMenu(ctx),
      );
    }

    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.flow = {
      type: "add_equipment",
      step: 1,
      data: {},
    };

    return ctx.reply("Введите категорию оборудования:");
  });

  bot.hears(LABELS.previousPage, (ctx) => {
    if (!ensureRegistered(ctx)) return;

    ensureSession(ctx);

    const page =
      ctx.session.mode === "summary"
        ? Math.max((ctx.session.summaryPage || 0) - 1, 0)
        : Math.max((ctx.session.listPage || 0) - 1, 0);

    return renderCategoryMenu(ctx, page);
  });

  bot.hears(LABELS.nextPage, (ctx) => {
    if (!ensureRegistered(ctx)) return;

    ensureSession(ctx);

    const page =
      ctx.session.mode === "summary"
        ? (ctx.session.summaryPage || 0) + 1
        : (ctx.session.listPage || 0) + 1;

    return renderCategoryMenu(ctx, page);
  });

  bot.hears(LABELS.back, (ctx) => {
    if (!ensureRegistered(ctx)) return;

    resetFlow(ctx);
    ensureSession(ctx);
    ctx.session.mode = null;
    return ctx.reply("Главное меню", mainMenu(ctx));
  });

  bot.action("back_categories", async (ctx) => {
    if (!ensureRegistered(ctx)) return;

    await ctx.answerCbQuery();

    ensureSession(ctx);
    const page =
      ctx.session.mode === "summary"
        ? ctx.session.summaryPage || 0
        : ctx.session.listPage || 0;

    return renderCategoryMenu(ctx, page);
  });

  bot.action(/excelCategory_(.+)/, async (ctx) => {
    if (!ensureRegistered(ctx)) return;

    await ctx.answerCbQuery("Генерирую Excel...");

    const encoded = ctx.match[1] || "";
    let categoryName;

    try {
      categoryName = decodeURIComponent(encoded);
    } catch {
      categoryName = encoded;
    }

    try {
      const items = listEquipmentByCategory(categoryName);
      if (!items.length) {
        return ctx.reply(`Нет оборудования в категории ${categoryName}`);
      }

      const xlsxBuffer = await buildCategoryXlsx(categoryName, items);
      const safeName = categoryName.replace(/[\\/:*?"<>|]/g, "_");

      return ctx.replyWithDocument({
        source: xlsxBuffer,
        filename: `category-${safeName}.xlsx`,
      });
    } catch (error) {
      logger.error("Excel export error:", { err: error.message });
      return ctx.reply("Ошибка при создании Excel-файла. Попробуйте позже.");
    }
  });

  // #7 — пагинация внутри категории
  bot.action(/itemsPage_(.+)_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      let categoryName;
      try {
        categoryName = decodeURIComponent(ctx.match[1]);
      } catch {
        categoryName = ctx.match[1];
      }
      const page = Number(ctx.match[2]) || 0;

      const items = listEquipmentByCategory(categoryName);
      if (!items.length) {
        return ctx.editMessageText(`Нет оборудования в категории ${categoryName}`);
      }

      return ctx.editMessageText(
        `📦 ${categoryName}`,
        buildCategoryItemsKeyboard(items, page),
      );
    } catch (error) {
      logger.error("ItemsPage action error:", { err: error.message });
      return ctx.reply("Ошибка при переключении страницы");
    }
  });

  // noop — заглушка для кнопки "X/Y" (текущая страница)
  bot.action("noop", (ctx) => ctx.answerCbQuery());

  bot.hears(/.*/, async (ctx, next) => {
    if (!ensureRegistered(ctx)) return;

    const text = ctx.message?.text;
    if (!text) return next();

    ensureSession(ctx);
    if (ctx.session.flow) return next();

    if (
      [
        LABELS.back,
        LABELS.previousPage,
        LABELS.nextPage,
        LABELS.categories,
        LABELS.summary,
        LABELS.addEquipment,
        LABELS.profile,
      ].includes(text)
    ) {
      return next();
    }

    const categories = listCategories();
    if (!categories.includes(text)) return next();

    const items = listEquipmentByCategory(text);

    if (ctx.session.mode === "summary") {
      const loadingMessage = await ctx.reply("Генерируется изображение, подождите...");

      try {
        const imageBuffer = await createCategoryImage(text, items);
        const safeName = text.replace(/[\\/:*?"<>|]/g, "_");

        const response = await ctx.replyWithPhoto(
          { source: imageBuffer, filename: `category-${safeName}.png` },
          {
            caption: `📦 ${text}`,
            parse_mode: "HTML",
            ...buildCategoryExportKeyboard(text),
          },
        );

        await ctx.deleteMessage(loadingMessage.message_id).catch(() => {});
        return response;
      } catch (error) {
        logger.error("Image generation error:", { err: error.message });
        await ctx.deleteMessage(loadingMessage.message_id).catch(() => {});
        return ctx.reply("Ошибка при создании изображения. Попробуйте позже.");
      }
    }

    return ctx.reply(`📦 ${text}`, buildCategoryItemsKeyboard(items, 0));
  });
}

module.exports = {
  registerNavigationHandlers,
};