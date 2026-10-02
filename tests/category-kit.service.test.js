'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const state = { row: null, upserts: [], deletes: [] };

const repoStub = {
  findCategoryKit: async () => state.row,
  upsertCategoryKit: async (category, data) => {
    state.upserts.push({ category, data });
    return {
      category,
      has_kit: data.hasKit,
      full_items: data.fullItems,
      minimal_items: data.minimalItems,
    };
  },
  deleteCategoryKit: async (category) => { state.deletes.push(category); },
};

const service = proxyquire('../src/services/category-kit.service', {
  '../repositories/category-kit.repo': repoStub,
});

beforeEach(() => {
  state.row = null;
  state.upserts = [];
  state.deletes = [];
});

describe('getCategoryKit', () => {
  it('falls back to the code preset when a category is not configured', async () => {
    const kit = await service.getCategoryKit('Камера');

    assert.equal(kit.configured, false);
    assert.equal(kit.hasKit, true);
    assert.ok(kit.fullItems.some((item) => item.name === 'Штатив'));
    assert.ok(kit.fullItems.some((item) => item.name === 'Батарейка' && item.counted));
  });

  it('keeps gas analyzers without a kit by default', async () => {
    const kit = await service.getCategoryKit('Газоанализатор');

    assert.equal(kit.configured, false);
    assert.equal(kit.hasKit, false);
  });

  it('prefers the stored settings', async () => {
    state.row = {
      category: 'Камера',
      has_kit: true,
      full_items: [{ name: 'Кофр', qty: 1, counted: false }],
      minimal_items: [],
    };

    const kit = await service.getCategoryKit('Камера');

    assert.equal(kit.configured, true);
    assert.deepEqual(kit.fullItems, [{ name: 'Кофр', qty: 1, counted: false }]);
  });
});

describe('saveCategoryKit', () => {
  it('drops minimal items that are not part of the kit', async () => {
    state.row = {
      category: 'Камера',
      has_kit: true,
      full_items: [{ name: 'Кофр', qty: 1, counted: false }],
      minimal_items: [{ name: 'Штатив', qty: 1, counted: false }],
    };

    const kit = await service.saveCategoryKit('Камера', {}, 42);

    assert.deepEqual(kit.minimalItems, []);
    assert.equal(state.upserts[0].data.updatedBy, 42);
  });
});

describe('getItemKit', () => {
  it('disables the step when the admin turned the kit off', async () => {
    state.row = { category: 'Камера', has_kit: false, full_items: [], minimal_items: [] };

    const kit = await service.getItemKit({ category: 'Камера' });

    assert.equal(kit.enabled, false);
  });

  it('disables the step when the configured kit is empty', async () => {
    state.row = { category: 'Камера', has_kit: true, full_items: [], minimal_items: [] };

    assert.equal((await service.getItemKit({ category: 'Камера' })).enabled, false);
  });

  it('uses the configured kit for the give-out keyboard', async () => {
    state.row = {
      category: 'Камера',
      has_kit: true,
      full_items: [
        { name: 'Кофр', qty: 1, counted: false },
        { name: 'Батарейка', qty: 2, counted: true },
      ],
      minimal_items: [{ name: 'Батарейка', qty: 2, counted: true }],
    };

    const kit = await service.getItemKit({ category: 'Камера' });

    assert.equal(kit.enabled, true);
    assert.deepEqual(kit.preset.single, ['Кофр']);
    assert.deepEqual(kit.preset.quantity, ['Батарейка']);
  });

  it('falls back to the code preset when nothing is configured', async () => {
    const kit = await service.getItemKit({ category: 'Газоанализатор' });

    assert.equal(kit.enabled, false);
  });
});

describe('resetCategoryKit', () => {
  it('removes the stored row', async () => {
    await service.resetCategoryKit('Камера');
    assert.deepEqual(state.deletes, ['Камера']);
  });
});
