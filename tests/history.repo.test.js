'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const state = {
  calls: [],
  rows: [],
};

const repo = proxyquire('../src/repositories/history.repo', {
  '../db': {
    query: async (...args) => {
      state.calls.push(args);
      return { rows: state.rows };
    },
  },
});

describe('history.repo', () => {
  beforeEach(() => {
    state.calls = [];
    state.rows = [];
  });

  it('trims history to last 8 entries after insert', async () => {
    await repo.addHistory({
      equipment_id: 5,
      action: 'выдано',
      from_status: 'на складе',
      to_status: 'у пользователя',
      from_user_id: null,
      to_user_id: 42,
      performed_by_user_id: 42,
      comment: null,
    });

    assert.equal(state.calls.length, 2);
    assert.match(state.calls[1][0], /DELETE FROM history/);
    assert.deepEqual(state.calls[1][1], [5, 8]);
  });

  it('caps requested history limit at 8 entries', async () => {
    await repo.getEquipmentHistory(7, { limit: 20, offset: 3 });

    assert.equal(state.calls.length, 1);
    assert.deepEqual(state.calls[0][1], [7, 8, 3]);
  });
});
