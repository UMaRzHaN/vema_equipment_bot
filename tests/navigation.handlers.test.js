'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

function createBotStub() {
  const handlers = { action: [] };
  return {
    handlers,
    start() {}
    ,
    hears() {}
    ,
    on() {}
    ,
    action(trigger, handler) {
      handlers.action.push({ trigger, handler });
    },
  };
}

describe('registerNavigationHandlers', () => {
  it('approves pending registration and notifies the user', async () => {
    const approvalCalls = [];
    const notifications = [];
    const userMenu = { reply_markup: { keyboard: [['Сводка', 'Профиль']] } };

    const { registerNavigationHandlers } = proxyquire('../src/bot/handlers/navigation.handlers', {
      '../labels': { LABELS: {} },
      '../../utils/logger': { error: () => {} },
      '../config': { isAdmin: () => true, isEffectiveAdmin: () => true },
      '../middlewares/error.handler': { safe: (fn) => fn },
      '../utils': { ensureSession: () => {}, resetFlow: () => {} },
      '../fsm/session.schema': { makeFlow: () => ({}) },
      '../fsm/states': { FLOW_TYPE: {}, ADD_STEP: {} },
      '../../services/equipment.service': {
        listAllEquipment: async () => [],
        listBrandsByCategory: async () => [],
        listCategories: async () => [],
        listEquipmentByCategory: async () => [],
        listEquipmentByCategoryAndBrand: async () => [],
      },
      '../../services/report.service': {
        buildSummaryText: async () => '',
        buildCategoryXlsx: async () => Buffer.from(''),
        createCategoryImage: async () => Buffer.from(''),
      },
      '../../services/user.service': {
        assignUserRole: async () => {},
        deleteUserAccount: async () => {},
        getUserByTelegramId: async () => ({
          telegram_user_id: 200,
          first_name: 'Ivan',
          last_name: 'Petrov',
          phone: '+1234567',
          is_banned: false,
          is_approved: false,
        }),
        isUserApproved: (user) => Boolean(user?.is_approved),
        isUserProfileComplete: () => true,
        listAllUsersPaged: async () => ({ users: [], totalPages: 1 }),
        setUserApproved: async (userId, approved) => { approvalCalls.push({ userId, approved }); },
        setUserBanned: async () => {},
      },
      '../../services/notification.service': {
        buildRegistrationApprovedMessage: () => 'approved',
        buildRegistrationDeniedMessage: () => 'denied',
      },
      '../utils/profile.utils': {
        startProfileRegistration: async () => {},
        renderProfileCard: async () => {},
      },
      '../helpers/equipmentHints': { getEquipmentSuggestionText: async () => ({ text: '', options: {} }) },
      '../views/menus': {
        buildBrandListKeyboard: () => ({}),
        buildCategoryExportKeyboard: () => ({}),
        buildCategoryItemsKeyboard: () => ({}),
        buildCategoryListKeyboard: () => ({}),
        buildMyEquipmentKeyboard: () => ({}),
        buildRoleSelectKeyboard: () => ({}),
        buildUserListKeyboard: () => ({}),
        mainMenu: () => userMenu,
      },
    });

    const bot = createBotStub();
    registerNavigationHandlers(bot);

    const entry = bot.handlers.action.find((item) => String(item.trigger) === '/approve_registration_(\\d+)/');
    const ctx = {
      from: { id: 100 },
      match: ['approve_registration_200', '200'],
      answerCbQuery: async () => {},
      editMessageText: async (text) => { ctx.edited = text; },
      telegram: {
        sendMessage: async (chatId, text, options) => { notifications.push({ chatId, text, options }); },
      },
    };

    await entry.handler(ctx);

    assert.deepEqual(approvalCalls, [{ userId: 200, approved: true }]);
    assert.deepEqual(notifications, [{ chatId: 200, text: 'approved', options: { link_preview_options: { is_disabled: true }, ...userMenu } }]);
    assert.match(ctx.edited, /подтверждена/i);
  });

  it('denies pending registration and notifies the user', async () => {
    const deletedUsers = [];
    const notifications = [];

    const { registerNavigationHandlers } = proxyquire('../src/bot/handlers/navigation.handlers', {
      '../labels': { LABELS: {} },
      '../../utils/logger': { error: () => {} },
      '../config': { isAdmin: () => true, isEffectiveAdmin: () => true },
      '../middlewares/error.handler': { safe: (fn) => fn },
      '../utils': { ensureSession: () => {}, resetFlow: () => {} },
      '../fsm/session.schema': { makeFlow: () => ({}) },
      '../fsm/states': { FLOW_TYPE: {}, ADD_STEP: {} },
      '../../services/equipment.service': {
        listAllEquipment: async () => [],
        listBrandsByCategory: async () => [],
        listCategories: async () => [],
        listEquipmentByCategory: async () => [],
        listEquipmentByCategoryAndBrand: async () => [],
      },
      '../../services/report.service': {
        buildSummaryText: async () => '',
        buildCategoryXlsx: async () => Buffer.from(''),
        createCategoryImage: async () => Buffer.from(''),
      },
      '../../services/user.service': {
        assignUserRole: async () => {},
        deleteUserAccount: async (userId) => { deletedUsers.push(userId); },
        getUserByTelegramId: async () => ({
          telegram_user_id: 200,
          first_name: 'Ivan',
          last_name: 'Petrov',
          phone: '+1234567',
          is_banned: false,
          is_approved: false,
        }),
        isUserApproved: (user) => Boolean(user?.is_approved),
        isUserProfileComplete: () => true,
        listAllUsersPaged: async () => ({ users: [], totalPages: 1 }),
        setUserApproved: async () => {},
        setUserBanned: async () => {},
      },
      '../../services/notification.service': {
        buildRegistrationApprovedMessage: () => 'approved',
        buildRegistrationDeniedMessage: () => 'denied',
      },
      '../utils/profile.utils': {
        startProfileRegistration: async () => {},
        renderProfileCard: async () => {},
      },
      '../helpers/equipmentHints': { getEquipmentSuggestionText: async () => ({ text: '', options: {} }) },
      '../views/menus': {
        buildBrandListKeyboard: () => ({}),
        buildCategoryExportKeyboard: () => ({}),
        buildCategoryItemsKeyboard: () => ({}),
        buildCategoryListKeyboard: () => ({}),
        buildMyEquipmentKeyboard: () => ({}),
        buildRoleSelectKeyboard: () => ({}),
        buildUserListKeyboard: () => ({}),
        mainMenu: () => ({}),
      },
    });

    const bot = createBotStub();
    registerNavigationHandlers(bot);

    const entry = bot.handlers.action.find((item) => String(item.trigger) === '/deny_registration_(\\d+)/');
    const ctx = {
      from: { id: 100 },
      match: ['deny_registration_200', '200'],
      answerCbQuery: async () => {},
      editMessageText: async (text) => { ctx.edited = text; },
      telegram: {
        sendMessage: async (chatId, text) => { notifications.push({ chatId, text }); },
      },
    };

    await entry.handler(ctx);

    assert.deepEqual(deletedUsers, [200]);
    assert.deepEqual(notifications, [{ chatId: 200, text: 'denied' }]);
    assert.match(ctx.edited, /отклонена/i);
  });

  it('deletes user from database on ban', async () => {
    const deletedUsers = [];

    const { registerNavigationHandlers } = proxyquire('../src/bot/handlers/navigation.handlers', {
      '../labels': { LABELS: {} },
      '../../utils/logger': { error: () => {} },
      '../config': { isAdmin: () => true, isEffectiveAdmin: () => true },
      '../middlewares/error.handler': { safe: (fn) => fn },
      '../utils': { ensureSession: () => {}, resetFlow: () => {} },
      '../fsm/session.schema': { makeFlow: () => ({}) },
      '../fsm/states': { FLOW_TYPE: {}, ADD_STEP: {} },
      '../../services/equipment.service': {
        listAllEquipment: async () => [],
        listBrandsByCategory: async () => [],
        listCategories: async () => [],
        listEquipmentByCategory: async () => [],
        listEquipmentByCategoryAndBrand: async () => [],
      },
      '../../services/report.service': {
        buildSummaryText: async () => '',
        buildCategoryXlsx: async () => Buffer.from(''),
        createCategoryImage: async () => Buffer.from(''),
      },
      '../../services/user.service': {
        assignUserRole: async () => {},
        deleteUserAccount: async (userId) => { deletedUsers.push(userId); },
        getUserByTelegramId: async () => ({
          telegram_user_id: 200,
          first_name: 'Ivan',
          last_name: 'Petrov',
          phone: '+1234567',
          is_banned: false,
          is_approved: true,
        }),
        isUserApproved: (user) => Boolean(user?.is_approved),
        isUserProfileComplete: () => true,
        listAllUsersPaged: async () => ({ users: [], totalPages: 1 }),
        setUserApproved: async () => {},
        setUserBanned: async () => {},
      },
      '../../services/notification.service': {
        buildRegistrationApprovedMessage: () => 'approved',
        buildRegistrationDeniedMessage: () => 'denied',
      },
      '../utils/profile.utils': {
        startProfileRegistration: async () => {},
        renderProfileCard: async () => {},
      },
      '../helpers/equipmentHints': { getEquipmentSuggestionText: async () => ({ text: '', options: {} }) },
      '../views/menus': {
        buildBrandListKeyboard: () => ({}),
        buildCategoryExportKeyboard: () => ({}),
        buildCategoryItemsKeyboard: () => ({}),
        buildCategoryListKeyboard: () => ({}),
        buildMyEquipmentKeyboard: () => ({}),
        buildRoleSelectKeyboard: () => ({}),
        buildUserListKeyboard: () => ({}),
        mainMenu: () => ({}),
      },
    });

    const bot = createBotStub();
    registerNavigationHandlers(bot);

    const entry = bot.handlers.action.find((item) => String(item.trigger) === '/toggle_ban_(\\d+)_(0|1)_(\\d+)/');
    const answers = [];
    const ctx = {
      from: { id: 100 },
      match: ['toggle_ban_200_1_0', '200', '1', '0'],
      answerCbQuery: async (text) => { answers.push(text); },
      editMessageText: async (text) => { ctx.edited = text; },
    };

    await entry.handler(ctx);

    assert.deepEqual(deletedUsers, [200]);
    assert.match(answers[0], /удалён/i);
    assert.match(ctx.edited, /удалён из базы/i);
  });
});
