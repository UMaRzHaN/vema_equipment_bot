const { ensureSession, resetFlow } = require("../utils");
const { saveUser, getUserByTelegramId } = require("../../services/user.service");
const { mainMenu } = require("../views/menus");

function removeKeyboard() {
  return {
    reply_markup: { remove_keyboard: true },
  };
}

function phoneKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

function profileMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ["✏️ Имя"],
        ["✏️ Фамилия"],
        ["📱 Телефон"],
        ["🏠 Главное меню"],
      ],
      resize_keyboard: true,
    },
  };
}

function normalizePhone(input) {
  const cleaned = String(input).replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned;
  return `+${cleaned}`;
}

// 📋 карточка профиля
function renderProfileCard(ctx) {
  const user = getUserByTelegramId(ctx.from.id);

  if (!user) {
    return ctx.reply("Профиль не найден. Введите /start для регистрации.");
  }

  return ctx.reply(
    `👤 Профиль:\n\nИмя: ${user.first_name || "—"}\nФамилия: ${user.last_name || "—"}\nТелефон: ${user.phone || "—"}`,
    profileMenuKeyboard()
  );
}

// 🚀 регистрация
function startProfileRegistration(ctx, text = "Введите имя:") {
  ensureSession(ctx);

  if (ctx.session.flow?.type === "register_profile") return;

  resetFlow(ctx);

  ctx.session.flow = {
    type: "register_profile",
    step: 1,
    data: {},
  };

  return ctx.reply(text);
}

function registerProfileHandlers(bot) {

  // ====== кнопки меню профиля ======
  bot.hears("✏️ Имя", (ctx) => {
    ensureSession(ctx);
    resetFlow(ctx);

    ctx.session.flow = { type: "edit_profile", field: "first_name" };
    return ctx.reply("Введите новое имя:");
  });

  bot.hears("✏️ Фамилия", (ctx) => {
    ensureSession(ctx);
    resetFlow(ctx);

    ctx.session.flow = { type: "edit_profile", field: "last_name" };
    return ctx.reply("Введите новую фамилию:");
  });

  bot.hears("📱 Телефон", (ctx) => {
    ensureSession(ctx);
    resetFlow(ctx);

    ctx.session.flow = { type: "edit_profile", field: "phone" };
    return ctx.reply("Введите номер или нажмите кнопку:", phoneKeyboard());
  });

  bot.hears("🏠 Главное меню", (ctx) => {
    resetFlow(ctx);
    return ctx.reply("Главное меню", mainMenu(ctx));
  });

  // ====== TEXT ======
  bot.on("text", async (ctx, next) => {
    ensureSession(ctx);

    const flow = ctx.session.flow;
    if (!flow) return next();

    const text = ctx.message.text.trim();

    // ====== регистрация ======
    if (flow.type === "register_profile") {
      if (flow.step === 1) {
        flow.data.firstName = text;
        flow.step = 2;
        return ctx.reply("Введите фамилию:");
      }

      if (flow.step === 2) {
        flow.data.lastName = text;
        flow.step = 3;
        return ctx.reply("Введите телефон:", phoneKeyboard());
      }

      if (flow.step === 3) {
        const phone = normalizePhone(text);

        if (!flow.data.firstName || !flow.data.lastName) {
          resetFlow(ctx);
          return ctx.reply("Сессия устарела. Начните регистрацию заново.");
        }

        await saveUser({
          telegramId: ctx.from.id,
          firstName: flow.data.firstName,
          lastName: flow.data.lastName,
          phone,
        });

        resetFlow(ctx);

        await ctx.reply("✅ Профиль сохранён", removeKeyboard());
        return ctx.reply("Главное меню", mainMenu(ctx));
      }
    }

    // ====== редактирование ======
    if (flow.type === "edit_profile") {
      const user = getUserByTelegramId(ctx.from.id);

      const updated = {
        telegramId: ctx.from.id,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
      };

      if (flow.field === "first_name") updated.firstName = text;
      if (flow.field === "last_name") updated.lastName = text;
      if (flow.field === "phone") updated.phone = normalizePhone(text);

      await saveUser(updated);

      resetFlow(ctx);

      await ctx.reply("✅ Обновлено", removeKeyboard());
      return renderProfileCard(ctx);
    }

    return next();
  });

  // ====== CONTACT ======
  bot.on("contact", async (ctx, next) => {
    ensureSession(ctx);

    const flow = ctx.session.flow;
    if (!flow) return next();

    const phone = normalizePhone(ctx.message.contact.phone_number);

    if (flow.type === "register_profile") {
      if (!flow.data.firstName || !flow.data.lastName) {
        resetFlow(ctx);
        return ctx.reply("Сессия устарела. Начните регистрацию заново.");
      }

      await saveUser({
        telegramId: ctx.from.id,
        firstName: flow.data.firstName,
        lastName: flow.data.lastName,
        phone,
      });

      resetFlow(ctx);

      await ctx.reply("✅ Профиль сохранён", removeKeyboard());
      return ctx.reply("Главное меню", mainMenu(ctx));
    }

    if (flow.type === "edit_profile" && flow.field === "phone") {
      const user = getUserByTelegramId(ctx.from.id);

      await saveUser({
        telegramId: ctx.from.id,
        firstName: user.first_name,
        lastName: user.last_name,
        phone,
      });

      resetFlow(ctx);

      await ctx.reply("✅ Телефон обновлён", removeKeyboard());
      return renderProfileCard(ctx);
    }

    return next();
  });
}

module.exports = {
  registerProfileHandlers,
  startProfileRegistration,
  renderProfileCard,
};