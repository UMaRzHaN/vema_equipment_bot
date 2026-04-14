'use strict';

const { ensureSession, resetFlow } = require('../utils');
const { saveUser, getUserByTelegramId } = require('../../services/user.service');
const { mainMenu } = require('../views/menus');
const { renderProfileCard, startProfileRegistration } = require('../utils/profile.utils');

function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } };
}

function phoneKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: '📱 Поделиться контактом', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

function hintKeyboard(hint) {
  if (!hint) return removeKeyboard();
  return { reply_markup: { keyboard: [[hint]], resize_keyboard: true, one_time_keyboard: true } };
}

function normalizePhone(input) {
  const cleaned = String(input).replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

function isValidPhone(phone) {
  return phone.replace(/[^\d]/g, '').length >= 7;
}

function registerProfileHandlers(bot) {
  bot.hears('✏️ Имя', (ctx) => {
    ensureSession(ctx); resetFlow(ctx);
    ctx.session.flow = { type: 'edit_profile', field: 'first_name', startedAt: Date.now(), version: 1 };
    return ctx.reply('Введите новое имя:', removeKeyboard());
  });

  bot.hears('✏️ Фамилия', (ctx) => {
    ensureSession(ctx); resetFlow(ctx);
    ctx.session.flow = { type: 'edit_profile', field: 'last_name', startedAt: Date.now(), version: 1 };
    return ctx.reply('Введите новую фамилию:', removeKeyboard());
  });

  bot.hears('📱 Телефон', (ctx) => {
    ensureSession(ctx); resetFlow(ctx);
    ctx.session.flow = { type: 'edit_profile', field: 'phone', startedAt: Date.now(), version: 1 };
    return ctx.reply('Введите номер или нажмите кнопку:', phoneKeyboard());
  });

  bot.hears('🏠 Главное меню', (ctx) => {
    resetFlow(ctx);
    return ctx.reply('Главное меню', mainMenu(ctx));
  });

  // ── TEXT ──────────────────────────────────────────────────────────────────
  bot.on('text', async (ctx, next) => {
    ensureSession(ctx);
    const flow = ctx.session.flow;
    if (!flow) return next();

    const text = ctx.message.text.trim();

    // ── register_profile flow ─────────────────────────────────────────────
    if (flow.type === 'register_profile') {
      if (flow.step === 1) {
        const phone = normalizePhone(text);
        if (!phone || !isValidPhone(phone)) {
          return ctx.reply('Некорректный номер телефона. Минимум 7 цифр, или нажмите кнопку ниже:', phoneKeyboard());
        }
        ctx.session.flow = { ...flow, step: 2, data: { ...flow.data, phone, firstNameHint: null, lastNameHint: null } };
        return ctx.reply('Введите ваше имя:', removeKeyboard());
      }

      if (flow.step === 2) {
        ctx.session.flow = { ...flow, step: 3, data: { ...flow.data, firstName: text } };
        return ctx.reply('Введите фамилию:', hintKeyboard(flow.data.lastNameHint));
      }

      if (flow.step === 3) {
        const { phone, firstName } = flow.data;
        if (!phone || !firstName) { resetFlow(ctx); return ctx.reply('Сессия устарела. Начните регистрацию заново.'); }
        await saveUser({ telegramId: ctx.from.id, firstName, lastName: text, phone });
        resetFlow(ctx);
        await ctx.reply('✅ Профиль сохранён', removeKeyboard());
        return ctx.reply('Главное меню', mainMenu(ctx));
      }
    }

    // ── edit_profile flow ─────────────────────────────────────────────────
    if (flow.type === 'edit_profile') {
      const user = await getUserByTelegramId(ctx.from.id);
      const updated = {
        telegramId: ctx.from.id,
        firstName:  user.first_name,
        lastName:   user.last_name,
        phone:      user.phone,
      };
      if (flow.field === 'first_name') updated.firstName = text;
      if (flow.field === 'last_name')  updated.lastName  = text;
      if (flow.field === 'phone')      updated.phone     = normalizePhone(text);
      await saveUser(updated);
      resetFlow(ctx);
      await ctx.reply('✅ Обновлено', removeKeyboard());
      return renderProfileCard(ctx);
    }

    return next();
  });

  // ── CONTACT ───────────────────────────────────────────────────────────────
  bot.on('contact', async (ctx, next) => {
    ensureSession(ctx);
    const flow = ctx.session.flow;
    if (!flow) return next();

    const contact      = ctx.message.contact;
    const phone        = normalizePhone(contact.phone_number);
    const firstNameHint = contact.first_name?.trim() || null;
    const lastNameHint  = contact.last_name?.trim()  || null;

    if (flow.type === 'register_profile' && flow.step === 1) {
      ctx.session.flow = { ...flow, step: 2, data: { phone, firstNameHint, lastNameHint } };
      const hint = firstNameHint ? '\n\nПодсказка из контакта: нажмите кнопку или введите своё.' : '';
      return ctx.reply(`Телефон принят ✅\n\nВведите ваше имя:${hint}`, hintKeyboard(firstNameHint));
    }

    if (flow.type === 'edit_profile' && flow.field === 'phone') {
      const user = await getUserByTelegramId(ctx.from.id);
      await saveUser({ telegramId: ctx.from.id, firstName: user.first_name, lastName: user.last_name, phone });
      resetFlow(ctx);
      await ctx.reply('✅ Телефон обновлён', removeKeyboard());
      return renderProfileCard(ctx);
    }

    return next();
  });
}

module.exports = { registerProfileHandlers, startProfileRegistration, renderProfileCard };
