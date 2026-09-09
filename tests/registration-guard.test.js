'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

function makeCtx(overrides = {}) {
  return {
    from: { id: 99 },
    session: { flow: null },
    callbackQuery: null,
    reply: async () => {},
    answerCbQuery: async () => {},
    ...overrides,
  };
}

function loadGuard({ user = null, profileComplete = false } = {}) {
  const { registrationGuard } = proxyquire('../src/bot/middlewares/registration.guard', {
    '../../services/user.service': {
      getUserByTelegramId: async () => user,
      isUserApproved: () => user?.is_approved !== false,
      isUserBanned: () => Boolean(user?.is_banned),
      isUserProfileComplete: () => profileComplete,
    },
    '../utils': {
      resetFlow: (ctx) => { ctx.session.flow = null; },
    },
    '../../utils/logger': { error: () => {}, warn: () => {} },
    '../utils/profile.utils': {
      startProfileRegistration: async (ctx) => { ctx._registrationStarted = true; },
    },
  });
  return registrationGuard;
}

describe('registrationGuard - no ctx.from', () => {
  it('calls next() when ctx.from is missing', async () => {
    const guard = loadGuard();
    const ctx = makeCtx({ from: null });
    let nextCalled = false;
    await guard(ctx, async () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});

describe('registrationGuard - already in register_profile flow', () => {
  it('calls next() without checking DB', async () => {
    const guard = loadGuard({ user: null, profileComplete: false });
    const ctx = makeCtx({ session: { flow: { type: 'register_profile' } } });
    let nextCalled = false;
    await guard(ctx, async () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.ok(!ctx._registrationStarted, 'should not restart registration');
  });
});

describe('registrationGuard - profile complete', () => {
  it('calls next() when profile is complete', async () => {
    const guard = loadGuard({
      user: { id: 99, first_name: 'Ivan', last_name: 'Petrov', phone: '+79001234567', is_approved: true },
      profileComplete: true,
    });
    const ctx = makeCtx();
    let nextCalled = false;
    await guard(ctx, async () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.ok(!ctx._registrationStarted);
  });
});

describe('registrationGuard - legacy pending approval', () => {
  it('allows complete profiles without admin approval', async () => {
    const guard = loadGuard({
      user: { id: 99, first_name: 'Ivan', last_name: 'Petrov', phone: '+79001234567', is_approved: false },
      profileComplete: true,
    });
    const ctx = makeCtx({
      session: { flow: { type: 'add_equipment' } },
    });
    let nextCalled = false;

    await guard(ctx, async () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.deepEqual(ctx.session.flow, { type: 'add_equipment' });
  });
});

describe('registrationGuard - banned user', () => {
  it('blocks access and does not continue to next()', async () => {
    const guard = loadGuard({
      user: { id: 99, first_name: 'Ivan', last_name: 'Petrov', phone: '+79001234567', is_banned: true },
      profileComplete: true,
    });
    const replies = [];
    const ctx = makeCtx({
      reply: async (text) => { replies.push(text); },
      session: { flow: { type: 'add_equipment' } },
    });
    let nextCalled = false;

    await guard(ctx, async () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(ctx.session.flow, null);
    assert.match(replies[0], /заблокирован/i);
  });
});

describe('registrationGuard - incomplete profile', () => {
  it('starts registration instead of calling next()', async () => {
    const guard = loadGuard({ user: { id: 99, first_name: 'Ivan' }, profileComplete: false });
    const ctx = makeCtx();
    let nextCalled = false;
    await guard(ctx, async () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(ctx._registrationStarted, true);
  });

  it('answers pending callback query before redirecting', async () => {
    const guard = loadGuard({ user: null, profileComplete: false });
    let cbAnswered = false;
    const ctx = makeCtx({
      callbackQuery: { id: 'abc' },
      answerCbQuery: async () => { cbAnswered = true; },
    });
    await guard(ctx, async () => {});
    assert.equal(cbAnswered, true);
  });

  it('resets any active flow before starting registration', async () => {
    const guard = loadGuard({ user: null, profileComplete: false });
    const ctx = makeCtx({ session: { flow: { type: 'add_equipment', step: 1, data: {}, startedAt: Date.now(), version: 1 } } });
    await guard(ctx, async () => {});
    assert.equal(ctx.session.flow, null);
    assert.equal(ctx._registrationStarted, true);
  });
});

describe('registrationGuard - user not found in DB', () => {
  it('starts registration when user is null', async () => {
    const guard = loadGuard({ user: null, profileComplete: false });
    const ctx = makeCtx();
    let nextCalled = false;
    await guard(ctx, async () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(ctx._registrationStarted, true);
  });
});
