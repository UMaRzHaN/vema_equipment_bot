'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Isolate DEFAULTS from any previous ENV pollution
process.env.FF_NEW_USER_FLOW = undefined;

const { flags } = require('../src/lib/feature-flags');

// ── isEnabledSync (ENV-only, synchronous) ────────────────────────────────────
describe('FeatureFlags.isEnabledSync', () => {
  it('returns true for flags that default on', () => {
    assert.equal(flags.isEnabledSync('EXCEL_REPORTS'), true);
    assert.equal(flags.isEnabledSync('RATE_LIMITER'), true);
    assert.equal(flags.isEnabledSync('REDIS_SESSIONS'), true);
  });

  it('returns false for unknown flag', () => {
    assert.equal(flags.isEnabledSync('NONEXISTENT_FLAG'), false);
  });
});

// ── isEnabled without Redis (ENV fallback) ───────────────────────────────────
describe('FeatureFlags.isEnabled — no Redis', () => {
  beforeEach(() => {
    flags.clearCache();
    flags.setRedis(null); // ensure no Redis
  });

  it('returns ENV default when Redis not set', async () => {
    const result = await flags.isEnabled('EXCEL_REPORTS');
    assert.equal(result, true);
  });

  it('returns false for unknown flag and warns', async () => {
    const result = await flags.isEnabled('UNKNOWN_FLAG_XYZ');
    assert.equal(result, false);
  });
});

// ── isEnabled with Redis override ────────────────────────────────────────────
describe('FeatureFlags.isEnabled — Redis override', () => {
  beforeEach(() => {
    flags.clearCache();
  });

  it('returns true when Redis returns "true"', async () => {
    flags.setRedis({ get: async () => 'true' });
    const result = await flags.isEnabled('EXCEL_REPORTS');
    assert.equal(result, true);
  });

  it('returns false when Redis returns "false" (overrides ENV default=true)', async () => {
    flags.setRedis({ get: async () => 'false' });
    const result = await flags.isEnabled('EXCEL_REPORTS');
    assert.equal(result, false);
  });

  it('falls back to ENV default when Redis key is null (no override)', async () => {
    flags.setRedis({ get: async () => null });
    const result = await flags.isEnabled('EXCEL_REPORTS');
    assert.equal(result, true); // ENV default
  });

  it('falls back to ENV default when Redis throws', async () => {
    flags.setRedis({ get: async () => { throw new Error('Redis down'); } });
    const result = await flags.isEnabled('EXCEL_REPORTS');
    assert.equal(result, true); // graceful fallback
  });
});

// ── In-process cache ─────────────────────────────────────────────────────────
describe('FeatureFlags — in-process cache', () => {
  it('returns cached value without hitting Redis on second call', async () => {
    flags.clearCache();
    let calls = 0;
    flags.setRedis({ get: async () => { calls++; return 'true'; } });

    await flags.isEnabled('RATE_LIMITER');
    await flags.isEnabled('RATE_LIMITER');

    assert.equal(calls, 1, 'Redis should only be called once due to cache');
  });

  it('clearCache forces a fresh Redis read', async () => {
    flags.clearCache();
    let calls = 0;
    flags.setRedis({ get: async () => { calls++; return 'true'; } });

    await flags.isEnabled('RATE_LIMITER');
    flags.clearCache();
    await flags.isEnabled('RATE_LIMITER');

    assert.equal(calls, 2, 'Redis should be called again after clearCache()');
  });
});
