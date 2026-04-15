'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { migrateSession, CURRENT_SCHEMA_VERSION } = require('../src/bot/fsm/state-migrator');

// ── No migration needed ───────────────────────────────────────────────────────
describe('migrateSession — already current', () => {
  it('returns session unchanged if schemaVersion matches current', () => {
    const session = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      flow:          null,
      mode:          null,
      listPage:      0,
      summaryPage:   0,
    };
    const result = migrateSession(session);
    assert.deepEqual(result, session);
    assert.equal(result, session, 'should return same object reference (no copy)');
  });
});

// ── v0 → v1 migration ─────────────────────────────────────────────────────────
describe('migrateSession — v0 → v1', () => {
  it('adds schemaVersion to session without one', () => {
    const old = { flow: null, mode: null, listPage: 0, summaryPage: 0 };
    const result = migrateSession(old);
    assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION);
  });

  it('preserves existing fields', () => {
    const old = { flow: null, mode: 'list', listPage: 2, summaryPage: 1, userRole: 'admin' };
    const result = migrateSession(old);
    assert.equal(result.mode, 'list');
    assert.equal(result.listPage, 2);
    assert.equal(result.userRole, 'admin');
  });

  it('normalizes flow.version when missing', () => {
    const old = {
      flow: { type: 'add_equipment', step: 2, data: {}, startedAt: Date.now() },
      mode: null, listPage: 0, summaryPage: 0,
    };
    const result = migrateSession(old);
    assert.equal(result.flow.version, 1);
  });

  it('resets flow with unknown type', () => {
    const old = {
      flow: { type: 'obsolete_flow', step: 1, data: {}, startedAt: Date.now(), version: 1 },
      mode: null, listPage: 0, summaryPage: 0,
    };
    const result = migrateSession(old);
    assert.equal(result.flow, null, 'unknown flow type should be reset to null');
  });

  it('keeps flow with valid type', () => {
    const old = {
      flow: { type: 'add_equipment', step: 3, data: { category: 'Ноутбуки' }, startedAt: Date.now(), version: 1 },
      mode: null, listPage: 0, summaryPage: 0,
    };
    const result = migrateSession(old);
    assert.equal(result.flow.type, 'add_equipment');
    assert.equal(result.flow.step, 3);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────
describe('migrateSession — edge cases', () => {
  it('returns null for null input', () => {
    assert.equal(migrateSession(null), null);
  });

  it('returns null for non-object input', () => {
    assert.equal(migrateSession('bad-session'), null);
  });

  it('handles session with only flow set', () => {
    const old = { flow: { type: 'repair', step: 1, data: {}, startedAt: Date.now() } };
    const result = migrateSession(old);
    assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(result.flow.type, 'repair');
  });
});
