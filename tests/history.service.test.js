'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const state = {
  calls: [],
  rows: [],
};

const service = proxyquire('../src/services/history.service', {
  '../repositories/history.repo': {
    getEquipmentHistory: async (...args) => {
      state.calls.push(args);
      return state.rows;
    },
    getEquipmentTimelinesBatch: async () => new Map(),
    getLastActionDate: async () => null,
    getLastRepairComment: async () => null,
    getLastRepairCommentsBatch: async () => new Map(),
    getOverdueEquipment: async () => [],
  },
});

describe('getFullEquipmentHistory', () => {
  beforeEach(() => {
    state.calls = [];
    state.rows = [{ action: 'выдано' }];
  });

  it('keeps backward compatibility with numeric limit', async () => {
    const result = await service.getFullEquipmentHistory(7, 10);
    assert.deepEqual(result, state.rows);
    assert.deepEqual(state.calls[0], [7, 10]);
  });

  it('passes pagination options through to repository', async () => {
    const result = await service.getFullEquipmentHistory(7, { limit: 11, offset: 20 });
    assert.deepEqual(result, state.rows);
    assert.deepEqual(state.calls[0], [7, { limit: 11, offset: 20 }]);
  });
});
