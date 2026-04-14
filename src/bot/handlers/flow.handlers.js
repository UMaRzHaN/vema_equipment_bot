const { isAdmin } = require("../config");
const logger = require("../../utils/logger.js");
const { EDITABLE_FIELDS, LABELS } = require("../labels");
const { buildBackKeyboard, mainMenu } = require("../views/menus");
const {
  buildEquipmentMarkup,
  renderEquipmentCard,
} = require("../views/equipment.view");
const { ensureSession, nowIso, resetFlow } = require("../utils");
const {
  STATUS,
  addEquipment,
  findEquipmentById,
  findEquipmentBySerial,
  startRepair,
  updateEquipment,
  writeOffEquipment,
} = require("../../services/equipment.service");
const {
  rememberEquipmentHint,
  rememberEquipmentHints,
  getEquipmentSuggestionText,
  normalizeOptionalValue,
} = require("../helpers/equipmentHints");

function isVisibleMenuText(ctx, text) {
  const topButtons = [
    LABELS.categories,
    LABELS.addEquipment,
    LABELS.summary,
    LABELS.profile,
    LABELS.back,
    LABELS.previousPage,
    LABELS.nextPage,
  ];

  return topButtons.includes(text);
}

async function safeDeleteMessage(ctx, messageRef, logLabel) {
  if (!messageRef) {
    return;
  }

  try {
    await ctx.telegram.deleteMessage(messageRef.chatId, messageRef.messageId);
  } catch (error) {
    logger.error(`${logLabel}:`, { err: error.message });
  }
}

function rememberMessage(message) {
  if (!message) {
    return null;
  }

  return {
    chatId: message.chat.id,
    messageId: message.message_id,
  };
}

function sendAddEquipmentPrompt(ctx, step) {
  switch (step) {
    case 1: {
      const prompt = getEquipmentSuggestionText(
        "category",
        "Введите категорию:",
      );
      return ctx.reply(prompt.text, prompt.options);
    }
    case 2: {
      const prompt = getEquipmentSuggestionText("brand", "Введите бренд:");
      return ctx.reply(prompt.text, prompt.options);
    }
    case 3: {
      const prompt = getEquipmentSuggestionText("model", "Введите модель:");
      return ctx.reply(prompt.text, prompt.options);
    }
    case 4:
      return ctx.reply("Введите серийный номер:");
    case 5:
      return ctx.reply("Введите инвентарный номер (или оставьте пустым):");
    case 6: {
      const prompt = getEquipmentSuggestionText(
        "purchase_date",
        "Введите дату покупки (YYYY-MM-DD) или оставьте пустым:",
      );
      return ctx.reply(prompt.text, prompt.options);
    }
    case 7:
      return ctx.reply("Введите примечания или оставьте пустым:");
    default:
      return ctx.reply("Введите значение:");
  }
}

const MAX_INPUT_LENGTH = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function registerFlowHandlers(bot) {
  bot.on("text", async (ctx, next) => {
    const text = (ctx.message?.text || "").trim();
    if (text.startsWith("/")) {
      return next();
    }

    // Global length guard — reject oversized input in any flow
    if (text.length > MAX_INPUT_LENGTH) {
      return ctx.reply(
        `Слишком длинный текст. Максимум ${MAX_INPUT_LENGTH} символов.`,
      );
    }

    ensureSession(ctx);
    const flow = ctx.session.flow;

    if (flow && isVisibleMenuText(ctx, text) && text !== LABELS.back) {
      resetFlow(ctx);
      return next();
    }

    if (flow?.type === "repair") {
      const equipment = findEquipmentById(flow.equipmentId);

      if (!equipment) {
        resetFlow(ctx);
        return ctx.reply("Оборудование не найдено.");
      }

      const updated = startRepair(equipment, ctx.from.id, text, nowIso());
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));

      await safeDeleteMessage(
        ctx,
        flow.sourceMessage,
        "Repair source card delete error",
      );
      await safeDeleteMessage(
        ctx,
        flow.promptMessage,
        "Repair prompt delete error",
      );

      resetFlow(ctx);
      await ctx.reply(
        `Отправлено в ремонт:\n${equipment.category} ${equipment.model} - ${equipment.serial_number || equipment.inventory_number}\nПричина: ${text}`,
      );

      return ctx.reply(renderEquipmentCard(updated), markup || undefined);
    }

    if (flow?.type === "writeoff") {
      const equipment = findEquipmentById(flow.equipmentId);

      if (!equipment) {
        resetFlow(ctx);
        return ctx.reply("Оборудование не найдено.");
      }

      // "—" означает пустой комментарий
      const comment = text === "—" ? null : text;

      const updated = writeOffEquipment(
        equipment,
        ctx.from.id,
        comment,
        nowIso(),
      );
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));

      await safeDeleteMessage(
        ctx,
        flow.sourceMessage,
        "Writeoff source card delete error",
      );
      await safeDeleteMessage(
        ctx,
        flow.promptMessage,
        "Writeoff prompt delete error",
      );

      resetFlow(ctx);
      await ctx.reply(
        `Оборудование списано:\n${equipment.category} ${equipment.model} - ${equipment.serial_number || equipment.inventory_number}`,
      );

      return ctx.reply(renderEquipmentCard(updated), markup || undefined);
    }

    if (flow?.type === "add_equipment") {
      const data = flow.data || {};
      const now = nowIso();

      switch (flow.step) {
        case 1:
          data.category = text;
          rememberEquipmentHint("category", text);
          ctx.session.flow = { type: "add_equipment", step: 2, data };
          return sendAddEquipmentPrompt(ctx, 2);
        case 2:
          data.brand = text;
          rememberEquipmentHint("brand", text);
          ctx.session.flow = { type: "add_equipment", step: 3, data };
          return sendAddEquipmentPrompt(ctx, 3);
        case 3:
          data.model = text;
          rememberEquipmentHint("model", text);
          ctx.session.flow = { type: "add_equipment", step: 4, data };
          return sendAddEquipmentPrompt(ctx, 4);
        case 4:
          if (findEquipmentBySerial(text)) {
            return ctx.reply(
              "Оборудование с таким серийным номером уже существует. Введите другой серийный номер:",
            );
          }
          data.serial_number = text;
          ctx.session.flow = { type: "add_equipment", step: 5, data };
          return sendAddEquipmentPrompt(ctx, 5);
        case 5:
          data.inventory_number = normalizeOptionalValue(text);
          rememberEquipmentHint("inventory_number", data.inventory_number);
          ctx.session.flow = { type: "add_equipment", step: 6, data };
          return sendAddEquipmentPrompt(ctx, 6);
        case 6: {
          const dateVal = normalizeOptionalValue(text);
          if (dateVal && !isValidDate(dateVal)) {
            return ctx.reply(
              "Неверный формат даты. Введите дату в формате YYYY-MM-DD или оставьте пустым:",
            );
          }
          data.purchase_date = dateVal;
          rememberEquipmentHint("purchase_date", data.purchase_date);
          ctx.session.flow = { type: "add_equipment", step: 7, data };
          return sendAddEquipmentPrompt(ctx, 7);
        }
        case 7:
          data.notes = normalizeOptionalValue(text);
          data.status = STATUS.IN_STOCK;
          data.created_at = now;
          data.updated_at = now;

          try {
            const result = addEquipment(data);
            rememberEquipmentHints(data);
            resetFlow(ctx);
            return ctx.reply(
              `Оборудование добавлено успешно. ID: ${result.lastInsertRowid}`,
            );
          } catch (error) {
            logger.error("Create equipment error:", { err: error.message });
            resetFlow(ctx);
            if (error.message === "DUPLICATE_SERIAL") {
              return ctx.reply(
                "Оборудование с таким серийным номером уже существует. Начните добавление заново.",
              );
            }
            return ctx.reply(
              "Не удалось добавить оборудование. Попробуйте ещё раз.",
            );
          }
        default:
          resetFlow(ctx);
          return ctx.reply("Ошибка добавления. Попробуйте снова.");
      }
    }

    if (flow?.type !== "edit_equipment") {
      return next();
    }

    const equipment = findEquipmentById(flow.equipmentId);
    if (!equipment) {
      resetFlow(ctx);
      return ctx.reply("Оборудование не найдено.");
    }

    if (flow.step === 1) {
      if (text === LABELS.back) {
        await safeDeleteMessage(
          ctx,
          flow.selectorMessage,
          "Edit selector delete error",
        );
        resetFlow(ctx);
        return ctx.reply("Редактирование отменено.", mainMenu(ctx));
      }

      const field = EDITABLE_FIELDS[text];
      if (!field) {
        return ctx.reply(
          "Пожалуйста, выберите поле из списка или нажмите 🔙 Назад.",
        );
      }

      const promptMessage = await ctx.reply(
        `Введите новое значение для ${text}:`,
        buildBackKeyboard(),
      );

      // Явно сохраняем все нужные поля, не полагаясь на spread из изменившегося flow
      ctx.session.flow = {
        type: "edit_equipment",
        step: 2,
        equipmentId: flow.equipmentId,
        sourceMessage: flow.sourceMessage,
        selectorMessage: flow.selectorMessage,
        data: { field, fieldLabel: text },
        promptMessage: rememberMessage(promptMessage),
      };

      return promptMessage;
    }

    if (text === LABELS.back) {
      await safeDeleteMessage(
        ctx,
        flow.selectorMessage,
        "Edit selector delete error",
      );
      await safeDeleteMessage(
        ctx,
        flow.promptMessage,
        "Edit prompt delete error",
      );
      resetFlow(ctx);
      return ctx.reply("Редактирование отменено.", mainMenu(ctx));
    }

    const field = flow.data?.field;
    if (field === "serial_number") {
      const existing = findEquipmentBySerial(text);
      if (existing && existing.id !== equipment.id) {
        return ctx.reply(
          "Оборудование с таким серийным номером уже существует. Введите другой серийный номер:",
        );
      }
    }

    if (field === "purchase_date" && text) {
      if (!isValidDate(text)) {
        return ctx.reply(
          "Неверный формат даты. Введите дату в формате YYYY-MM-DD или оставьте пустым:",
        );
      }
    }

    try {
      updateEquipment(equipment.id, {
        [field]: text || null,
        updated_at: nowIso(),
      });

      if (
        [
          "category",
          "brand",
          "model",
          "inventory_number",
          "purchase_date",
        ].includes(field)
      ) {
        rememberEquipmentHint(field, text || null);
      }

      const updated = findEquipmentById(equipment.id);
      const markup = buildEquipmentMarkup(updated, isAdmin(ctx));

      await safeDeleteMessage(
        ctx,
        flow.sourceMessage,
        "Edit source card delete error",
      );
      await safeDeleteMessage(
        ctx,
        flow.selectorMessage,
        "Edit selector delete error",
      );
      await safeDeleteMessage(
        ctx,
        flow.promptMessage,
        "Edit prompt delete error",
      );

      resetFlow(ctx);
      await ctx.reply("Данные обновлены.");

      return ctx.reply(renderEquipmentCard(updated), markup || mainMenu(ctx));
    } catch (error) {
      logger.error("Update equipment error:", { err: error.message });
      resetFlow(ctx);
      return ctx.reply(
        "Не удалось сохранить изменения. Попробуйте снова.",
        mainMenu(ctx),
      );
    }
  });
}

module.exports = {
  registerFlowHandlers,
};
