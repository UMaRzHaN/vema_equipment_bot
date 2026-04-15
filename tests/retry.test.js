'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { withRetry, isTransientDbError, isTransientRedisError, backoffMs } = require('../src/lib/retry');

// ── backoffMs ─────────────────────────────────────────────────────────────────
describe('backoffMs', () => {
  it('returns exponentially increasing values', () => {
    const d0 = backoffMs(0, { base: 100, max: 10_000 });
    const d1 = backoffMs(1, { base: 100, max: 10_000 });
    const d2 = backoffMs(2, { base: 100, max: 10_000 });
    // Base component doubles each step (jitter adds a bit)
    assert.ok(d1 > d0, 'd1 should be > d0');
    assert.ok(d2 > d1, 'd2 should be > d1');
  });

  it('never exceeds max', () => {
    for (let i = 0; i < 20; i++) {
      assert.ok(backoffMs(i, { base: 1000, max: 500 }) <= 500);
    }
  });
});

// ── isTransientDbError ────────────────────────────────────────────────────────
describe('isTransientDbError', () => {
  it('returns true for ECONNREFUSED', () => {
    assert.ok(isTransientDbError(Object.assign(new Error(), { code: 'ECONNREFUSED' })));
  });

  it('returns true for PG admin_shutdown (57P01)', () => {
    assert.ok(isTransientDbError(Object.assign(new Error(), { code: '57P01' })));
  });

  it('returns true for serialization failure (40001)', () => {
    assert.ok(isTransientDbError(Object.assign(new Error(), { code: '40001' })));
  });

  it('returns false for unique_violation (23505)', () => {
    assert.ok(!isTransientDbError(Object.assign(new Error(), { code: '23505' })));
  });

  it('returns false for null', () => {
    assert.ok(!isTransientDbError(null));
  });
});

// ── isTransientRedisError ─────────────────────────────────────────────────────
describe('isTransientRedisError', () => {
  it('returns true for ECONNREFUSED', () => {
    assert.ok(isTransientRedisError(Object.assign(new Error(), { code: 'ECONNREFUSED' })));
  });

  it('returns true for "connection is closed" message', () => {
    assert.ok(isTransientRedisError(new Error('ERR Connection is closed.')));
  });

  it('returns false for non-transient error', () => {
    assert.ok(!isTransientRedisError(new Error('WRONGTYPE Operation')));
  });
});

// ── withRetry ─────────────────────────────────────────────────────────────────
describe('withRetry', () => {
  it('returns result on first success', async () => {
    let calls = 0;
    const result = await withRetry(() => { calls++; return Promise.resolve(42); });
    assert.equal(result, 42);
    assert.equal(calls, 1);
  });

  it('retries on transient error and succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 3) {
          const err = Object.assign(new Error('conn refused'), { code: 'ECONNREFUSED' });
          return Promise.reject(err);
        }
        return Promise.resolve('recovered');
      },
      { maxAttempts: 3, base: 1, isTransient: isTransientDbError },
    );
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  it('does NOT retry non-transient errors', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(
        () => { calls++; return Promise.reject(Object.assign(new Error('dup'), { code: '23505' })); },
        { maxAttempts: 3, base: 1, isTransient: isTransientDbError },
      ),
    );
    assert.equal(calls, 1, 'should not retry non-transient error');
  });

  it('throws after maxAttempts transient failures', async () => {
    let calls = 0;
    const transientErr = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    await assert.rejects(
      () => withRetry(
        () => { calls++; return Promise.reject(transientErr); },
        { maxAttempts: 3, base: 1, isTransient: isTransientDbError },
      ),
    );
    assert.equal(calls, 3, 'should attempt maxAttempts times');
  });
});
