'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { CircuitBreaker, CircuitOpenError, STATE } = require('../src/lib/circuit-breaker');

// ── Helpers ───────────────────────────────────────────────────────────────────
const success = () => Promise.resolve('ok');
const fail    = (msg = 'error') => Promise.reject(new Error(msg));

function makeBreaker(opts = {}) {
  return new CircuitBreaker('test', { threshold: 3, timeout: 100, ...opts });
}

// ── CLOSED state ──────────────────────────────────────────────────────────────
describe('CircuitBreaker — CLOSED state', () => {
  it('passes through successful calls', async () => {
    const cb = makeBreaker();
    const result = await cb.execute(success);
    assert.equal(result, 'ok');
    assert.equal(cb.state, STATE.CLOSED);
  });

  it('propagates errors without tripping below threshold', async () => {
    const cb = makeBreaker({ threshold: 3 });
    await assert.rejects(() => cb.execute(fail));
    await assert.rejects(() => cb.execute(fail));
    assert.equal(cb.state, STATE.CLOSED); // 2 < 3 threshold
  });

  it('resets failure count on success', async () => {
    const cb = makeBreaker({ threshold: 3 });
    await assert.rejects(() => cb.execute(fail));
    await assert.rejects(() => cb.execute(fail));
    await cb.execute(success);             // success resets count
    await assert.rejects(() => cb.execute(fail));
    await assert.rejects(() => cb.execute(fail));
    assert.equal(cb.state, STATE.CLOSED);  // still 2 < 3
  });
});

// ── CLOSED → OPEN transition ──────────────────────────────────────────────────
describe('CircuitBreaker — CLOSED → OPEN', () => {
  it('trips to OPEN after threshold consecutive failures', async () => {
    const cb = makeBreaker({ threshold: 3 });
    await assert.rejects(() => cb.execute(fail));
    await assert.rejects(() => cb.execute(fail));
    await assert.rejects(() => cb.execute(fail)); // 3rd failure → OPEN
    assert.equal(cb.state, STATE.OPEN);
  });

  it('throws CircuitOpenError when OPEN', async () => {
    const cb = makeBreaker({ threshold: 1 });
    await assert.rejects(() => cb.execute(fail));  // trips to OPEN

    await assert.rejects(
      () => cb.execute(success),
      (err) => {
        assert.ok(err instanceof CircuitOpenError);
        assert.equal(err.code, 'CIRCUIT_OPEN');
        return true;
      },
    );
  });

  it('does not call fn() when OPEN (fast fail)', async () => {
    const cb = makeBreaker({ threshold: 1 });
    await assert.rejects(() => cb.execute(fail));

    let called = false;
    await assert.rejects(() => cb.execute(() => { called = true; return Promise.resolve(); }));
    assert.equal(called, false, 'fn should not be called when circuit is OPEN');
  });
});

// ── OPEN → HALF_OPEN → CLOSED ─────────────────────────────────────────────────
describe('CircuitBreaker — HALF_OPEN recovery', () => {
  it('transitions to HALF_OPEN after timeout', async () => {
    const cb = makeBreaker({ threshold: 1, timeout: 50 }); // 50ms timeout
    await assert.rejects(() => cb.execute(fail)); // trips
    assert.equal(cb.state, STATE.OPEN);

    await new Promise((r) => setTimeout(r, 60)); // wait for timeout
    // Execute attempt should try (not fast-fail) → HALF_OPEN probe
    await cb.execute(success); // probe succeeds → CLOSED
    assert.equal(cb.state, STATE.CLOSED);
  });

  it('returns to OPEN if HALF_OPEN probe fails', async () => {
    const cb = makeBreaker({ threshold: 1, timeout: 50 });
    await assert.rejects(() => cb.execute(fail)); // trips

    await new Promise((r) => setTimeout(r, 60));
    await assert.rejects(() => cb.execute(fail)); // probe fails → back to OPEN
    assert.equal(cb.state, STATE.OPEN);
  });
});

// ── Manual reset ──────────────────────────────────────────────────────────────
describe('CircuitBreaker — reset()', () => {
  it('resets to CLOSED from OPEN', async () => {
    const cb = makeBreaker({ threshold: 1 });
    await assert.rejects(() => cb.execute(fail));
    assert.equal(cb.state, STATE.OPEN);

    cb.reset();
    assert.equal(cb.state, STATE.CLOSED);

    const result = await cb.execute(success);
    assert.equal(result, 'ok');
  });
});
