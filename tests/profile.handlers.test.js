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
  it('enqueues admin notification after successful profile registration', async () => {
    let savedPayload = null;
    let notifiedUserId = null;
    const approvalCalls = [];

    const { registerProfileHandlers } = proxyquire('../src/bot/handlers/profile.handlers', {
      '../../config': { config: { bot: { adminIds: [100] } } },
      '../../services/user.service': {
        deleteUserAccount: async () => {},
        saveUser: async (payload) => { savedPayload = payload; },
        getUserByTelegramId: async () => ({ first_name: 'Ivan', last_name: 'Petrov', phone: '+1234567' }),
        setUserApproved: async (userId, approved) => { approvalCalls.push({ userId, approved }); },
      },
      '../../services/notification.service': {
        enqueueNewRegistrationNotification: async (userId) => { notifiedUserId = userId; },
      },
      '../../utils/logger': { error: () => {} },
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
    };

    await textHandler(ctx, async () => {});

    assert.deepEqual(savedPayload, {
      telegramId: 200,
      firstName: 'Ivan',
      lastName: 'Petrov',
      phone: '+1234567',
    });
    assert.deepEqual(approvalCalls, [{ userId: 200, approved: false }]);
    assert.equal(notifiedUserId, 200);
    assert.equal(ctx.session.flow, null);
    assert.equal(replies.length, 2);
    assert.match(replies[0], /администратору/i);
    assert.match(replies[1], /ожидайте подтверждения/i);
  });
});
