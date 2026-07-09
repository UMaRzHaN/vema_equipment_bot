'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

// ── Mutable state (mutated per-test; wrappers always call through) ────────────
const state = {
  atomicCalls:        [],
  findResult:         null,
  createImpl:         async (d) => ({ ...d, id: 1 }),
  deleteImpl:         async () => {},
  getEquipmentPageImpl: async () => [],
  countEquipmentImpl: async () => 0,
  getDistinctBrandsByCategoryImpl: async () => [],
  getEquipmentByCategoryAndBrandImpl: async () => [],
};

const repoStub = {
  atomicStatusChange:    async (...args) => { state.atomicCalls.push(args); },
  findEquipmentById:     async () => state.findResult,
  findEquipmentBySerial: async () => null,
  createEquipment:       async (...args) => state.createImpl(...args),
  deleteEquipmentById:   async (...args) => state.deleteImpl(...args),
  getAllEquipment:        async () => [],
  getDistinctBrandsByCategory: async (...args) => state.getDistinctBrandsByCategoryImpl(...args),
  getEquipmentPage:      async (...args) => state.getEquipmentPageImpl(...args),
  getEquipmentByCategoryAndBrand: async (...args) => state.getEquipmentByCategoryAndBrandImpl(...args),
  countEquipment:        async (...args) => state.countEquipmentImpl(...args),
  updateEquipmentDetails: async () => {},
  searchEquipment:       async () => [],
};

const service = proxyquire('../src/services/equipment.service', {
  '../repositories/equipment.repo': repoStub,
});

// ── giveEquipmentToUser ───────────────────────────────────────────────────────
describe('giveEquipmentToUser', () => {
  beforeEach(() => {
    state.atomicCalls = [];
    state.findResult  = { id: 1, status: 'у пользователя', current_holder_user_id: 42 };
  });

  it('calls atomicStatusChange with WITH_USER status', async () => {
    await service.giveEquipmentToUser({ id: 1, status: 'на складе' }, 42);
    assert.equal(state.atomicCalls.length, 1);
    const [equipUpdate] = state.atomicCalls[0];
    assert.equal(equipUpdate.status, 'у пользователя');
    assert.equal(equipUpdate.current_holder_user_id, 42);
    assert.equal(equipUpdate.warehouse, null);
  });

  it('writes correct history payload for issuance', async () => {
    await service.giveEquipmentToUser({ id: 1, status: 'на складе' }, 42, [{ name: 'Кабель', qty: 1 }], '2026-07-20T00:00:00.000Z');
    const [, historyEntry] = state.atomicCalls[0];
    assert.equal(historyEntry.equipment_id, 1);
    assert.equal(historyEntry.action, 'выдано');
    assert.equal(historyEntry.from_status, 'на складе');
    assert.equal(historyEntry.to_status, 'у пользователя');
    assert.equal(historyEntry.to_user_id, 42);
    assert.equal(historyEntry.performed_by_user_id, 42);
  });

  it('returns refreshed item from findEquipmentById', async () => {
    const result = await service.giveEquipmentToUser({ id: 1, status: 'на складе' }, 42);
    assert.equal(result.status, 'у пользователя');
  });
});

// ── returnEquipmentFromUser ───────────────────────────────────────────────────
describe('returnEquipmentFromUser', () => {
  beforeEach(() => {
    state.atomicCalls = [];
    state.findResult  = { id: 2, status: 'на складе', current_holder_user_id: null };
  });

  it('calls atomicStatusChange with IN_STOCK status', async () => {
    await service.returnEquipmentFromUser({ id: 2, status: 'у пользователя', current_holder_user_id: 7 }, 7);
    assert.equal(state.atomicCalls.length, 1);
    const [equipUpdate] = state.atomicCalls[0];
    assert.equal(equipUpdate.status, 'на складе');
    assert.equal(equipUpdate.current_holder_user_id, null);
  });

  it('writes correct history payload for return', async () => {
    await service.returnEquipmentFromUser({ id: 2, status: 'у пользователя', current_holder_user_id: 7 }, 7, 'Ташкент');
    const [, historyEntry] = state.atomicCalls[0];
    assert.equal(historyEntry.equipment_id, 2);
    assert.equal(historyEntry.action, 'возвращено');
    assert.equal(historyEntry.from_status, 'у пользователя');
    assert.equal(historyEntry.to_status, 'на складе');
    assert.equal(historyEntry.from_user_id, 7);
    assert.equal(historyEntry.performed_by_user_id, 7);
  });
});

// ── repair transitions ───────────────────────────────────────────────────────
describe('non-stock status transitions', () => {
  beforeEach(() => {
    state.atomicCalls = [];
    state.findResult = { id: 3, status: 'в ремонте', current_holder_user_id: null };
  });

  it('clears warehouse when sending equipment to repair', async () => {
    await service.startRepair({ id: 3, status: 'на складе' }, 42, null);
    const [equipUpdate] = state.atomicCalls[0];
    assert.equal(equipUpdate.status, 'в ремонте');
    assert.equal(equipUpdate.warehouse, null);
  });

  it('writes correct history payload for repair start', async () => {
    await service.startRepair({ id: 3, status: 'на складе', current_holder_user_id: 11 }, 42, 'Диагностика');
    const [, historyEntry] = state.atomicCalls[0];
    assert.equal(historyEntry.equipment_id, 3);
    assert.equal(historyEntry.action, 'в ремонте');
    assert.equal(historyEntry.from_status, 'на складе');
    assert.equal(historyEntry.to_status, 'в ремонте');
    assert.equal(historyEntry.from_user_id, 11);
    assert.equal(historyEntry.performed_by_user_id, 42);
    assert.equal(historyEntry.comment, 'Диагностика');
  });

  it('rejects repair start when equipment is not in stock', async () => {
    await assert.rejects(
      () => service.startRepair({ id: 3, status: 'у пользователя', current_holder_user_id: 11 }, 42, null),
      { code: 'REPAIR_ONLY_FROM_STOCK', message: 'Оборудование должно быть на складе.' },
    );
    assert.equal(state.atomicCalls.length, 0);
  });

  it('writes correct history payload for repair completion', async () => {
    await service.completeRepair({ id: 3, status: 'в ремонте', warehouse: null }, 42);
    const [equipUpdate, historyEntry] = state.atomicCalls[0];
    assert.equal(equipUpdate.status, 'на складе');
    assert.equal(equipUpdate.warehouse, 'Ташкент');
    assert.equal(historyEntry.equipment_id, 3);
    assert.equal(historyEntry.action, 'из ремонта');
    assert.equal(historyEntry.from_status, 'в ремонте');
    assert.equal(historyEntry.to_status, 'на складе');
    assert.equal(historyEntry.performed_by_user_id, 42);
  });

});

describe('extendEquipmentForUser', () => {
  beforeEach(() => {
    state.atomicCalls = [];
    state.findResult = { id: 4, status: 'у пользователя', current_holder_user_id: 7 };
  });

  it('writes correct history payload for extension', async () => {
    const expectedReturnDate = '2026-07-20T00:00:00.000Z';
    await service.extendEquipmentForUser({
      id: 4,
      status: 'у пользователя',
      current_holder_user_id: 7,
      current_issue_date: '2026-07-10T00:00:00.000Z',
      components: [{ name: 'Кабель', qty: 1 }],
      warehouse: null,
    }, 7, expectedReturnDate);

    const [equipUpdate, historyEntry] = state.atomicCalls[0];
    assert.equal(equipUpdate.status, 'у пользователя');
    assert.equal(equipUpdate.expected_return_date, expectedReturnDate);
    assert.deepEqual(equipUpdate.components, [{ name: 'Кабель', qty: 1 }]);
    assert.equal(historyEntry.equipment_id, 4);
    assert.equal(historyEntry.action, 'срок продлен');
    assert.equal(historyEntry.from_status, 'у пользователя');
    assert.equal(historyEntry.to_status, 'у пользователя');
    assert.equal(historyEntry.from_user_id, 7);
    assert.equal(historyEntry.to_user_id, 7);
    assert.equal(historyEntry.performed_by_user_id, 7);
    assert.match(historyEntry.comment, /2026-07-20T00:00:00.000Z/);
  });
});

// ── addEquipment ──────────────────────────────────────────────────────────────
describe('addEquipment', () => {
  beforeEach(() => {
    state.createImpl = async (d) => ({ ...d, id: 1 });
  });

  it('creates equipment with IN_STOCK status', async () => {
    const created = await service.addEquipment({ category: 'Ноутбуки', model: 'XPS', serial_number: 'SN-X' });
    assert.equal(created.status, 'на складе');
  });

  it('includes all provided fields', async () => {
    const created = await service.addEquipment({
      category: 'Принтеры', model: 'HP', serial_number: 'SN-Y', brand: 'Hewlett', components: ['Кабель'],
    });
    assert.equal(created.brand, 'Hewlett');
    assert.deepEqual(created.components, ['Кабель']);
  });

  it('wraps 23505 pg error as DUPLICATE_SERIAL', async () => {
    state.createImpl = async () => {
      const err = new Error('unique constraint'); err.code = '23505'; throw err;
    };
    await assert.rejects(
      () => service.addEquipment({ category: 'X', model: 'Y', serial_number: 'DUP' }),
      { message: 'DUPLICATE_SERIAL' },
    );
  });
});

// ── listEquipmentPaged ────────────────────────────────────────────────────────
describe('listEquipmentPaged', () => {
  beforeEach(() => {
    state.getEquipmentPageImpl = async () => [];
    state.countEquipmentImpl   = async () => 0;
  });

  it('returns structure with items, total, page, limit, totalPages', async () => {
    state.getEquipmentPageImpl = async () => [{ id: 1 }, { id: 2 }];
    state.countEquipmentImpl   = async () => 2;

    const result = await service.listEquipmentPaged({ page: 0, limit: 10 });
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 2);
    assert.equal(result.page, 0);
    assert.equal(result.totalPages, 1);
  });

  it('calculates totalPages correctly', async () => {
    state.getEquipmentPageImpl = async () => new Array(10).fill({ id: 1 });
    state.countEquipmentImpl   = async () => 25;

    const result = await service.listEquipmentPaged({ page: 0, limit: 10 });
    assert.equal(result.totalPages, 3);
  });

  it('returns totalPages 1 when count is 0', async () => {
    const result = await service.listEquipmentPaged({ page: 0, limit: 10 });
    assert.equal(result.totalPages, 1);
  });
});

describe('category brand navigation', () => {
  it('returns brand list for category', async () => {
    state.getDistinctBrandsByCategoryImpl = async (category) => ['FLIR', `for-${category}`];
    const result = await service.listBrandsByCategory('Камеры');
    assert.deepEqual(result, ['FLIR', 'for-Камеры']);
  });

  it('returns equipment filtered by category and brand', async () => {
    state.getEquipmentByCategoryAndBrandImpl = async (category, brand) => [{ id: 5, category, brand }];
    const result = await service.listEquipmentByCategoryAndBrand('Камеры', 'FLIR');
    assert.deepEqual(result, [{ id: 5, category: 'Камеры', brand: 'FLIR' }]);
  });
});

// ── removeEquipment ───────────────────────────────────────────────────────────
describe('removeEquipment', () => {
  it('calls deleteEquipmentById with the given id', async () => {
    let deletedId = null;
    state.deleteImpl = async (id) => { deletedId = id; };
    await service.removeEquipment(99);
    assert.equal(deletedId, 99);
  });
});

