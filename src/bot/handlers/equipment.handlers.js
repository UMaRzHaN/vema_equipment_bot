const { isAdmin } = require("../config");
const logger = require("../../utils/logger.js");
const { buildEditEquipmentKeyboard } = require("../views/menus");
const {
  buildEquipmentMarkup,
  renderEquipmentCard,
} = require("../views/equipment.view");
const { ensureSession, nowIso } = require("../utils");
const {
  STATUS,
  completeRepair,
  findEquipmentById,
  giveEquipmentToUser,
  removeEquipment,
  returnEquipmentFromUser,
} = require("../../services/equipment.service");

function rememberMessage(message) {
  if (!message) {
    return null;
  }

  return {
    chatId: message.chat.id,
    messageId: message.message_id,
  };
}

function registerEquipmentHandlers(bot) {
  bot.action(/open_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const item = findEquipmentById(Number(ctx.match[1]));
      if (!item) {
        return ctx.editMessageText("Оборудование не найдено");
      }

      const markup = buildEquipmentMarkup(item, isAdmin(ctx));
      const text = renderEquipmentCard(item);

      return markup
        ? ctx.editMessageText(text, markup)
        : ctx.editMessageText(text);
    } catch (error) {
      logger.error("Open card error:", { err: error.message });
      return ctx.reply("Ошибка при открытии карточки");
    }
  });

  bot.action(/edit_(\d+)/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) {
        return ctx.answerCbQuery(
          "Только администратор может редактировать оборудование",
          { show_alert: true },
        );
      }

      await ctx.answerCbQuery();

      const item = findEquipmentById(Number(ctx.match[1]));
      if (!item) {
        return ctx.editMessageText("Оборудование не найдено");
      }

      ensureSession(ctx);
      ctx.session.flow = {
        type: "edit_equipment",
        step: 1,
        equipmentId: item.id,
        data: {},
        sourceMessage: rememberMessage(ctx.callbackQuery?.message),
      };

      const selectorMessage = await ctx.reply(
        "Выберите поле для редактирования:",
        buildEditEquipmentKeyboard(),
      );

      ctx.session.flow.selectorMessage = rememberMessage(selectorMessage);
      return selectorMessage;
    } catch (error) {
      logger.error("Edit action error:", { err: error.message });
      return ctx.reply("Ошибка при запуске редактирования оборудования");
    }
  });

  bot.action(/delete_(\d+)/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) {
        return ctx.answerCbQuery(
          "Только администратор может удалить оборудование",
          { show_alert: true },
        );
      }

      await ctx.answerCbQuery();

      const item = findEquipmentById(Number(ctx.match[1]));
      if (!item) {
        return ctx.editMessageText("Оборудование не найдено");
      }

      removeEquipment(item.id);
      return ctx.editMessageText(`Оборудование #${item.id} удалено.`);
    } catch (error) {
      logger.error("Delete action error:", { err: error.message });
      return ctx.reply("Ошибка при удалении оборудования");
    }
  });

  bot.action(/give_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const item = findEquipmentById(Number(ctx.match[1]));
      if (!item) return ctx.reply("Оборудование не найдено");
      if (item.status !== STATUS.IN_STOCK) {
        return ctx.reply("Оборудование уже недоступно для выдачи.");
      }

      const updated = giveEquipmentToUser(item, ctx.from.id, nowIso());
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));

      return markup
        ? ctx.editMessageText(renderEquipmentCard(updated), markup)
        : ctx.editMessageText(renderEquipmentCard(updated));
    } catch (error) {
      logger.error("Give equipment error:", { err: error.message });
      return ctx.reply("Ошибка при выдаче оборудования. Попробуйте ещё раз.");
    }
  });

  bot.action(/return_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const item = findEquipmentById(Number(ctx.match[1]));
      if (!item) return ctx.reply("Оборудование не найдено");
      if (item.status !== STATUS.WITH_USER) return ctx.reply("Оборудование не выдано.");
      if (item.current_holder_user_id !== ctx.from.id) {
        return ctx.reply("Это оборудование выдано другому пользователю.");
      }

      const updated = returnEquipmentFromUser(item, ctx.from.id, nowIso());
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));

      return markup
        ? ctx.editMessageText(renderEquipmentCard(updated), markup)
        : ctx.editMessageText(renderEquipmentCard(updated));
    } catch (error) {
      logger.error("Return equipment error:", { err: error.message });
      return ctx.reply("Ошибка при возврате оборудования. Попробуйте ещё раз.");
    }
  });

  bot.action(/repair_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const item = findEquipmentById(Number(ctx.match[1]));
      if (!item) return ctx.reply("Оборудование не найдено");
      if (item.status === STATUS.REPAIR) return ctx.reply("Оборудование уже в ремонте.");

      ensureSession(ctx);
      ctx.session.flow = {
        type: "repair",
        equipmentId: item.id,
        sourceMessage: rememberMessage(ctx.callbackQuery?.message),
      };

      const promptMessage = await ctx.reply("Введи причину ремонта:");
      ctx.session.flow.promptMessage = rememberMessage(promptMessage);

      return promptMessage;
    } catch (error) {
      logger.error("Repair action error:", { err: error.message });
      return ctx.reply("Ошибка при отправке в ремонт. Попробуйте ещё раз.");
    }
  });

  bot.action(/fromRepair_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const item = findEquipmentById(Number(ctx.match[1]));
      if (!item) return ctx.reply("Оборудование не найдено");
      if (item.status !== STATUS.REPAIR) return ctx.reply("Оборудование не в ремонте.");

      const updated = completeRepair(item, ctx.from.id, nowIso());
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));

      return markup
        ? ctx.editMessageText(renderEquipmentCard(updated), markup)
        : ctx.editMessageText(renderEquipmentCard(updated));
    } catch (error) {
      logger.error("FromRepair action error:", { err: error.message });
      return ctx.reply("Ошибка при завершении ремонта. Попробуйте ещё раз.");
    }
  });
}

module.exports = {
  registerEquipmentHandlers,
};
