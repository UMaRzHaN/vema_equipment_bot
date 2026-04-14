'use strict';

const { ensureSession, resetFlow } = require('../utils');
const { getUserByTelegramId } = require('../../services/user.service');

async function renderProfileCard(ctx) {
  const user = await getUserByTelegramId(ctx.from.id);
  if (!user) return ctx.reply('Профиль не найден. Введите /start для регистрации.');

  return ctx.reply(
    `👤 Профиль:\n\nИмя: ${user.first_name || '—'}\nФамилия: ${user.last_name || '—'}\nТелефон: ${user.phone || '—'}`,
    {
      reply_markup: {
        keyboard: [['✏️ Имя'], ['✏️ Фамилия'], ['📱 Телефон'], ['🏠 Главное меню']],
        resize_keyboard: true,
      },
    },
  );
}

function startProfileRegistration(ctx, text = 'Для начала поделитесь номером телефона:') {
  ensureSession(ctx);
  if (ctx.session.flow?.type === 'register_profile') return;

  resetFlow(ctx);
  ctx.session.flow = { type: 'register_profile', step: 1, data: {}, startedAt: Date.now(), version: 1 };

  return ctx.reply(text, {
    reply_markup: {
      keyboard: [[{ text: '📱 Поделиться контактом', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

module.exports = { renderProfileCard, startProfileRegistration };
