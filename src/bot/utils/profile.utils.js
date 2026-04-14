const { ensureSession, resetFlow } = require("../utils");
const { getUserByTelegramId } = require("../../services/user.service");

function renderProfileCard(ctx) {
  const user = getUserByTelegramId(ctx.from.id);

  if (!user) {
    return ctx.reply("Профиль не найден. Введите /start для регистрации.");
  }

  return ctx.reply(
    `👤 Профиль:\n\nИмя: ${user.first_name || "—"}\nФамилия: ${user.last_name || "—"}\nТелефон: ${user.phone || "—"}`,
    {
      reply_markup: {
        keyboard: [
          ["✏️ Имя"],
          ["✏️ Фамилия"],
          ["📱 Телефон"],
          ["🏠 Главное меню"],
        ],
        resize_keyboard: true,
      },
    }
  );
}

/**
 * Запускает регистрацию с шага 1 — запрос телефона через контакт.
 * Имя и фамилия запрашиваются после, с подсказками из контакта.
 */
function startProfileRegistration(ctx, text = "Для начала поделитесь номером телефона:") {
  ensureSession(ctx);

  if (ctx.session.flow?.type === "register_profile") return;

  resetFlow(ctx);

  ctx.session.flow = {
    type: "register_profile",
    // step 1 = ждём контакт/телефон
    // step 2 = ждём имя (с подсказкой из контакта)
    // step 3 = ждём фамилию (с подсказкой из контакта)
    step: 1,
    data: {},
  };

  return ctx.reply(text, {
    reply_markup: {
      keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

module.exports = {
  renderProfileCard,
  startProfileRegistration,
};
