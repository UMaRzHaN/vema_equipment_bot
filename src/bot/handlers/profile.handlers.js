'use strict';

const { Markup } = require('telegraf');
const { ensureSession, resetFlow } = require('../utils');
const { makeFlow } = require('../fsm/session.schema');
const { FLOW_TYPE } = require('../fsm/states');
const {
  deleteUserAccount,
  saveUser,
  getUserByTelegramId,
  setUserApproved,
} = require('../../services/user.service');
const { mainMenu } = require('../views/menus');
const { renderProfileCard, startProfileRegistration } = require('../utils/profile.utils');
const { safe } = require('../middlewares/error.handler');

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
  bot.hears('✏️ Имя', safe((ctx) => {
    ensureSession(ctx);
    resetFlow(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.EDIT_PROFILE, 1, {}, { field: 'first_name' });
    return ctx.reply('Введите новое имя:', removeKeyboard());
  }, 'profile:editName'));

  bot.hears('✏️ Фамилия', safe((ctx) => {
    ensureSession(ctx);
    resetFlow(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.EDIT_PROFILE, 1, {}, { field: 'last_name' });
    return ctx.reply('Введите новую фамилию:', removeKeyboard());
  }, 'profile:editLastName'));

  bot.hears('📱 Телефон', safe((ctx) => {
    ensureSession(ctx);
    resetFlow(ctx);
    ctx.session.flow = makeFlow(FLOW_TYPE.EDIT_PROFILE, 1, {}, { field: 'phone' });
    return ctx.reply('Введите номер или нажмите кнопку:', phoneKeyboard());
  }, 'profile:editPhone'));

  bot.hears('🏠 Главное меню', safe((ctx) => {
    resetFlow(ctx);
    return ctx.reply('Главное меню', mainMenu(ctx));
  }, 'profile:mainMenu'));

  bot.hears('🗑️ Удалить профиль', safe((ctx) => {
    resetFlow(ctx);
    return ctx.reply(
      '⚠️ Удалить профиль?\n\nВсе ваши данные будут удалены безвозвратно.',
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить', 'confirm_delete_profile')],
        [Markup.button.callback('❌ Отмена', 'cancel_delete_profile')],
      ]),
    );
  }, 'profile:deletePrompt'));

  bot.action('confirm_delete_profile', safe(async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await deleteUserAccount(ctx.from.id);
    } catch (err) {
      if (err.code === 'HAS_EQUIPMENT') {
        return ctx.editMessageText(`❌ ${err.message}`);
      }
      throw err;
    }

    ctx.session = {};
    await ctx.editMessageText('✅ Профиль удалён.');
    return ctx.reply('Для повторной регистрации нажмите /start.');
  }, 'profile:confirmDelete'));

  bot.action('cancel_delete_profile', safe(async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    return renderProfileCard(ctx);
  }, 'profile:cancelDelete'));

  bot.on('text', safe(async (ctx, next) => {
    ensureSession(ctx);
    const flow = ctx.session.flow;
    if (!flow) return next();

    const text = ctx.message.text.trim();

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
        if (!phone || !firstName) {
          resetFlow(ctx);
          return ctx.reply('Сессия устарела. Начните регистрацию заново.');
        }

        await saveUser({ telegramId: ctx.from.id, firstName, lastName: text, phone });
        await setUserApproved(ctx.from.id, true);
        resetFlow(ctx);
        return ctx.reply('✅ Регистрация завершена.', removeKeyboard());
      }
    }

    if (flow.type === 'edit_profile') {
      const user = await getUserByTelegramId(ctx.from.id);
      const updated = {
        telegramId: ctx.from.id,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
      };

      if (flow.field === 'first_name') updated.firstName = text;
      if (flow.field === 'last_name') updated.lastName = text;
      if (flow.field === 'phone') updated.phone = normalizePhone(text);

      await saveUser(updated);
      resetFlow(ctx);
      await ctx.reply('✅ Обновлено', removeKeyboard());
      return renderProfileCard(ctx);
    }

    return next();
  }, 'profile:text'));

  bot.on('contact', safe(async (ctx, next) => {
    ensureSession(ctx);
    const flow = ctx.session.flow;
    if (!flow) return next();

    const contact = ctx.message.contact;
    const phone = normalizePhone(contact.phone_number);
    const firstNameHint = contact.first_name?.trim() || null;
    const lastNameHint = contact.last_name?.trim() || null;

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
  }, 'profile:contact'));
}

module.exports = { registerProfileHandlers, startProfileRegistration, renderProfileCard };
