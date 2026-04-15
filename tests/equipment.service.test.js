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
};

const repoStub = {
  atomicStatusChange:    async (...args) => { state.atomicCalls.push(args); },
  findEquipmentById:     async () => state.findResult,
  findEquipmentBySerial: async () => null,
  createEquipment:       async (...args) => state.createImpl(...args),
  deleteEquipmentById:   async (...args) => state.deleteImpl(...args),
  getAllEquipment:        async () => [],
  getEquipmentPage:      async (...args) => state.getEquipmentPageImpl(...args),
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
      category: 'Принтеры', model: 'HP', serial_number: 'SN-Y', brand: 'Hewlett',
    });
    assert.equal(created.brand, 'Hewlett');
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

// ── removeEquipment ───────────────────────────────────────────────────────────
describe('removeEquipment', () => {
  it('calls deleteEquipmentById with the given id', async () => {
    let deletedId = null;
    state.deleteImpl = async (id) => { deletedId = id; };
    await service.removeEquipment(99);
    assert.equal(deletedId, 99);
  });
});
