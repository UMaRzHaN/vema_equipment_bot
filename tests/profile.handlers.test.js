'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

function createBotStub() {
  const handlers = { hears: [], action: [], on: [] };
  return {
    handlers,
    hears(trigger, handler) {
      handlers.hears.push({ trigger, handler });
    },
    action(trigger, handler) {
      handlers.action.push({ trigger, handler });
    },
    on(event, handler) {
      handlers.on.push({ event, handler });
    },
  };
}

describe('registerProfileHandlers', () => {
  it('sends one admin notification after successful profile registration', async () => {
    let savedPayload = null;
    const approvalCalls = [];
    const sentMessages = [];

    const { registerProfileHandlers } = proxyquire('../src/bot/handlers/profile.handlers', {
      '../../config': { config: { bot: { adminIds: ['100', '100 '] } } },
      '../../services/user.service': {
        deleteUserAccount: async () => {},
        getAllAdminTelegramIds: async () => [100],
        saveUser: async (payload) => { savedPayload = payload; },
        getUserByTelegramId: async () => ({ telegram_user_id: 200, first_name: 'Ivan', last_name: 'Petrov', phone: '+1234567', username: 'ivan.petrov' }),
        setUserApproved: async (userId, approved) => { approvalCalls.push({ userId, approved }); },
      },
      '../../services/notification.service': {
        buildNewRegistrationMessage: () => 'approve me',
        buildRegistrationApprovalReplyMarkup: () => ({ inline_keyboard: [[{ text: 'ok', callback_data: 'approve_registration_200' }]] }),
      },
      '../../utils/logger': { error: () => {}, warn: () => {} },
      '../utils': {
        ensureSession: () => {},
        resetFlow: (ctx) => { ctx.session.flow = null; },
      },
      '../fsm/session.schema': {
        makeFlow: (type, step, data = {}, extra = {}) => ({ type, step, data, ...extra }),
      },
      '../fsm/states': {
        FLOW_TYPE: { EDIT_PROFILE: 'edit_profile' },
      },
      '../views/menus': {
        mainMenu: () => ({ reply_markup: { keyboard: [['Меню']] } }),
      },
      '../utils/profile.utils': {
        renderProfileCard: async () => {},
        startProfileRegistration: async () => {},
      },
      '../middlewares/error.handler': {
        safe: (fn) => fn,
      },
      telegraf: {
        Markup: {
          inlineKeyboard: () => ({}),
          button: { callback: () => ({}) },
        },
      },
    });

    const bot = createBotStub();
    registerProfileHandlers(bot);

    const textHandler = bot.handlers.on.find((entry) => entry.event === 'text').handler;
    const replies = [];
    const ctx = {
      from: { id: 200 },
      message: { text: 'Petrov' },
      session: {
        flow: {
          type: 'register_profile',
          step: 3,
          data: { phone: '+1234567', firstName: 'Ivan' },
        },
      },
      reply: async (text) => { replies.push(text); },
      telegram: {
        sendMessage: async (chatId, text, options) => { sentMessages.push({ chatId, text, options }); },
      },
    };

    await textHandler(ctx, async () => {});

    assert.deepEqual(savedPayload, {
      telegramId: 200,
      firstName: 'Ivan',
      lastName: 'Petrov',
      phone: '+1234567',
    });
    assert.deepEqual(approvalCalls, [{ userId: 200, approved: false }]);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].chatId, 100);
    assert.equal(sentMessages[0].text, 'approve me');
    assert.equal(ctx.session.flow, null);
    assert.equal(replies.length, 2);
    assert.match(replies[0], /администратору/i);
    assert.match(replies[1], /ожидайте подтверждения/i);
  });

  it('restores the main bottom menu from the profile screen', async () => {
    const { registerProfileHandlers } = proxyquire('../src/bot/handlers/profile.handlers', {
      '../../config': { config: { bot: { adminIds: [100] } } },
      '../../services/user.service': {
        deleteUserAccount: async () => {},
        getAllAdminTelegramIds: async () => [],
        saveUser: async () => {},
        getUserByTelegramId: async () => null,
        setUserApproved: async () => {},
      },
      '../../services/notification.service': {
        buildNewRegistrationMessage: () => '',
        buildRegistrationApprovalReplyMarkup: () => ({}),
      },
      '../../utils/logger': { error: () => {}, warn: () => {} },
      '../utils': {
        ensureSession: () => {},
        resetFlow: () => {},
      },
      '../fsm/session.schema': {
        makeFlow: (type, step, data = {}, extra = {}) => ({ type, step, data, ...extra }),
      },
      '../fsm/states': {
        FLOW_TYPE: { EDIT_PROFILE: 'edit_profile' },
      },
      '../views/menus': {
        mainMenu: () => ({ reply_markup: { keyboard: [['Категории', 'Мое оборудование']] } }),
      },
      '../utils/profile.utils': {
        renderProfileCard: async () => {},
        startProfileRegistration: async () => {},
      },
      '../middlewares/error.handler': {
        safe: (fn) => fn,
      },
      telegraf: {
        Markup: {
          inlineKeyboard: () => ({}),
          button: { callback: () => ({}) },
        },
      },
    });

    const bot = createBotStub();
    registerProfileHandlers(bot);

    const mainMenuHandler = bot.handlers.hears.find((entry) => entry.trigger === '🏠 Главное меню').handler;
    let replyPayload = null;
    const ctx = {
      reply: async (text, markup) => { replyPayload = { text, markup }; },
    };

    await mainMenuHandler(ctx);

    assert.equal(replyPayload.text, 'Главное меню');
    assert.deepEqual(replyPayload.markup, { reply_markup: { keyboard: [['Категории', 'Мое оборудование']] } });
  });
});
