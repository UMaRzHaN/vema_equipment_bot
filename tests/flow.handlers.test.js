'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const state = {
  items: [],
  extended: [],
  returned: [],
};

const botHandlers = new Map();
const fakeBot = {
  on(event, handler) {
    botHandlers.set(event, handler);
  },
};

const { registerFlowHandlers } = proxyquire('../src/bot/handlers/flow.handlers', {
  telegraf: { Markup: {} },
  '../config': {
    isEffectiveAdmin: () => false,
    isEffectiveManager: () => false,
  },
  '../../utils/logger': {
    warn: () => {},
    error: () => {},
    info: () => {},
  },
  '../middlewares/error.handler': {
    safe: (fn) => fn,
  },
  '../labels': {
    EDITABLE_FIELDS: {},
    LABELS: {
      back: 'Назад',
      categories: 'Категории',
      myEquipment: 'Мое оборудование',
      addEquipment: 'Добавить',
      summary: 'Сводка',
      profile: 'Профиль',
    },
  },
  '../validation/equipment.schema': {
    validateEquipmentCreate: () => ({ success: true, data: {} }),
    validateEquipmentUpdate: () => ({ success: true, data: {} }),
  },
  '../views/menus': {
    buildBackKeyboard: () => ({ back: true }),
    buildGiveComponentsKeyboard: () => ({ components: true }),
    mainMenu: () => ({ menu: true }),
  },
  '../views/equipment.view': {
    buildEquipmentMarkup: () => null,
    renderEquipmentCard: async () => 'card',
  },
  './equipment.handlers': {
    finalizeGiveCart: async () => 'cart',
  },
  '../utils': {
    ensureSession: () => {},
    resetFlow: (ctx) => { ctx.session.flow = null; },
  },
  '../fsm/states': {
    FLOW_TYPE: {
      ADD_EQUIPMENT: 'add_equipment',
      EDIT_EQUIPMENT: 'edit_equipment',
      GIVE_DURATION: 'give_duration',
      GIVE_COMPONENTS: 'give_components',
      REPAIR: 'repair',
      RETURN_LOCATION: 'return_location',
    },
    ADD_STEP: {},
    EDIT_STEP: {},
    TOTAL_ADD_STEPS: 5,
  },
  '../fsm/session.schema': {
    makeFlow: (type, step, data = {}, extra = {}) => ({ type, step, data, ...extra }),
  },
  '../../utils/constants': {
    STATUS: {
      WITH_USER: 'у пользователя',
    },
  },
  '../../services/equipment.service': {
    addEquipment: async () => ({}),
    extendEquipmentForUser: async (item, userId, expectedReturnDate) => {
      state.extended.push({ item, userId, expectedReturnDate });
      return { ...item, expected_return_date: expectedReturnDate };
    },
    findEquipmentById: async () => null,
    findEquipmentBySerial: async () => null,
    listAllEquipment: async () => state.items,
    startRepair: async () => ({}),
    updateEquipment: async () => ({}),
    returnEquipmentFromUser: async (item, userId, warehouse) => {
      state.returned.push({ item, userId, warehouse });
      return { ...item, warehouse };
    },
  },
  '../../services/location.service': {
    getCityByCoordinates: async () => 'Ташкент',
  },
  '../helpers/equipmentHints': {
    getEquipmentSuggestionText: async () => ({ text: 'prompt', options: { reply_markup: { keyboard: [] } } }),
    normalizeOptionalValue: (value) => value,
  },
  '../../utils/metrics': {
    equipmentActionsTotal: { inc: () => {} },
  },
  '../../utils/formatters': {
    formatDate: () => '10.07.2026',
  },
  '../../utils/component-presets': {
    getGiveComponentsPreset: () => [],
  },
});

registerFlowHandlers(fakeBot);

function createCtx(flow, text) {
  const replies = [];
  return {
    from: { id: 70465073 },
    message: { text },
    session: { flow },
    telegram: { deleteMessage: async () => {} },
    reply: async (...args) => {
      replies.push(args);
      return args[0];
    },
    get replies() {
      return replies;
    },
  };
}

describe('multi-select my equipment flows', () => {
  beforeEach(() => {
    state.items = [
      { id: '2', status: 'у пользователя', current_holder_user_id: 70465073, category: 'Камера', model: 'A', serial_number: 'SN-2' },
      { id: '7', status: 'у пользователя', current_holder_user_id: 70465073, category: 'Камера', model: 'B', serial_number: 'SN-7' },
    ];
    state.extended = [];
    state.returned = [];
  });

  it('extends selected equipment even when repository ids are strings', async () => {
    const textHandler = botHandlers.get('text');
    const ctx = createCtx(
      {
        type: 'give_duration',
        extendAllMode: true,
        equipmentIds: [2, 7],
      },
      '5',
    );

    await textHandler(ctx, async () => {});

    assert.equal(state.extended.length, 2);
    assert.match(ctx.replies[0][0], /Продлено на 5 дн/);
  });

  it('returns selected equipment even when repository ids are strings', async () => {
    const textHandler = botHandlers.get('text');
    const ctx = createCtx(
      {
        type: 'return_location',
        returnAllMode: true,
        equipmentIds: [2, 7],
      },
      'Ташкент',
    );

    await textHandler(ctx, async () => {});

    assert.equal(state.returned.length, 2);
    assert.match(ctx.replies[0][0], /Возвращено на склад Ташкент/);
  });
});
