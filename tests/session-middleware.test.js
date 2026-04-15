'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

// ── Helpers ───────────────────────────────────────────────────────────────────
const CURRENT_SCHEMA_VERSION = 1;

function makeDefaultSession() {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, flow: null, mode: null, listPage: 0, summaryPage: 0 };
}

function makeCtx(overrides = {}) {
  return {
    from: { id: 42 },
    session: null,
    ...overrides,
  };
}

// ── Stub factories ────────────────────────────────────────────────────────────
function makeRedisMock({ storedJson = null, getThrows = false, setThrows = false } = {}) {
  return {
    get: async () => {
      if (getThrows) throw new Error('Redis get error');
      return storedJson;
    },
    set: async () => {
      if (setThrows) throw new Error('Redis set error');
    },
  };
}

function loadMiddleware(redisMock) {
  return proxyquire('../src/bot/middlewares/session.middleware', {
    '../../redis': { redis: redisMock },
    '../../config': { config: { session: { ttl: 1800 } } },
    '../../utils/metrics': {
      sessionOperationsTotal: { inc: () => {} },
    },
    '../../utils/logger': {
      warn:  () => {},
      error: () => {},
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('sessionMiddleware — no ctx.from', () => {
  it('calls next() immediately when ctx.from is missing', async () => {
    const { sessionMiddleware } = loadMiddleware(makeRedisMock());
    const ctx = makeCtx({ from: null });
    let called = false;
    await sessionMiddleware()(ctx, async () => { called = true; });
    assert.equal(called, true);
    assert.equal(ctx.session, null, 'session should not be set');
  });
});

describe('sessionMiddleware — no stored session', () => {
  it('uses defaultSession when Redis returns null', async () => {
    const { sessionMiddleware } = loadMiddleware(makeRedisMock({ storedJson: null }));
    const ctx = makeCtx();
    await sessionMiddleware()(ctx, async () => {});
    assert.equal(ctx.session.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(ctx.session.flow, null);
  });
});

describe('sessionMiddleware — stored session', () => {
  it('deserializes and migrates stored session', async () => {
    const stored = JSON.stringify({ flow: null, mode: 'list', listPage: 2, summaryPage: 0 }); // v0
    const { sessionMiddleware } = loadMiddleware(makeRedisMock({ storedJson: stored }));
    const ctx = makeCtx();
    await sessionMiddleware()(ctx, async () => {});
    // After migration: schemaVersion should be added
    assert.equal(ctx.session.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(ctx.session.mode, 'list');
    assert.equal(ctx.session.listPage, 2);
  });

  it('resets expired flow automatically', async () => {
    const oldFlow = {
      type: 'add_equipment', step: 1, data: {},
      startedAt: Date.now() - 31 * 60 * 1000, // 31 minutes ago — expired
      version: 1,
    };
    const stored = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, flow: oldFlow, mode: null, listPage: 0, summaryPage: 0 });
    const { sessionMiddleware } = loadMiddleware(makeRedisMock({ storedJson: stored }));
    const ctx = makeCtx();
    await sessionMiddleware()(ctx, async () => {});
    assert.equal(ctx.session.flow, null, 'expired flow should be reset to null');
  });

  it('preserves unexpired flow', async () => {
    const activeFlow = {
      type: 'add_equipment', step: 2, data: { category: 'Ноутбуки' },
      startedAt: Date.now() - 60_000, // 1 minute ago — not expired
      version: 1,
    };
    const stored = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, flow: activeFlow, mode: null, listPage: 0, summaryPage: 0 });
    const { sessionMiddleware } = loadMiddleware(makeRedisMock({ storedJson: stored }));
    const ctx = makeCtx();
    await sessionMiddleware()(ctx, async () => {});
    assert.equal(ctx.session.flow?.type, 'add_equipment');
    assert.equal(ctx.session.flow?.step, 2);
  });
});

describe('sessionMiddleware — Redis errors', () => {
  it('uses defaultSession when Redis.get throws', async () => {
    const { sessionMiddleware } = loadMiddleware(makeRedisMock({ getThrows: true }));
    const ctx = makeCtx();
    await sessionMiddleware()(ctx, async () => {});
    assert.equal(ctx.session.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(ctx.session.flow, null);
  });

  it('does not throw when Redis.set throws (save failure is non-fatal)', async () => {
    const { sessionMiddleware } = loadMiddleware(makeRedisMock({ setThrows: true }));
    const ctx = makeCtx();
    // Should not reject
    await assert.doesNotReject(() => sessionMiddleware()(ctx, async () => {}));
  });
});

describe('sessionMiddleware — session saved after next()', () => {
  it('saves session even if next() throws', async () => {
    let savedSession = null;
    const redisMock = {
      get: async () => null,
      set: async (_key, json) => { savedSession = JSON.parse(json); },
    };
    const { sessionMiddleware } = loadMiddleware(redisMock);
    const ctx = makeCtx();
    try {
      await sessionMiddleware()(ctx, async () => { throw new Error('handler error'); });
    } catch {
      // expected
    }
    assert.ok(savedSession !== null, 'session should be saved even on handler error');
  });
});
