'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const state = {
  adds: [],
  overdueItems: [],
  admins: [],
  usersMap: new Map(),
  redisStore: new Map(),
};

class QueueStub {
  async add(name, data) {
    state.adds.push({ name, data });
    return { id: state.adds.length, name };
  }
}

const service = proxyquire('../src/services/notification.service', {
  bullmq: { Queue: QueueStub },
  telegraf: {
    Markup: {
      inlineKeyboard(buttons) {
        return { reply_markup: { inline_keyboard: buttons } };
      },
      button: {
        callback(text, callback_data) {
          return { text, callback_data };
        },
      },
    },
  },
  '../redis': {
    bullRedis: {
      async set(key, value, mode, ttl, condition) {
        if (mode !== 'PX' || condition !== 'NX') throw new Error('Unexpected lock options');
        if (state.redisStore.has(key)) return null;
        state.redisStore.set(key, value);
        return 'OK';
      },
      async get(key) {
        return state.redisStore.get(key) || null;
      },
      async del(key) {
        state.redisStore.delete(key);
      },
    },
  },
  './history.service': {
    findOverdueEquipment: async () => state.overdueItems,
  },
  '../repositories/user.repo': {
    getUsersByRole: async () => state.admins,
  },
  '../utils/formatters': {
    formatDate: () => '09.07.2026, 22:49',
    escapeHtml: (value) => String(value),
  },
  './user.service': {
    getUsersByTelegramIds: async () => state.usersMap,
    formatUser: (user) => user?.name || String(user?.telegram_user_id || 'unknown'),
  },
  '../utils/components': {
    normalizeComponents: (components) => components || [],
    formatComponent: (component) => component.name || String(component),
  },
  '../utils/logger': {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
});

describe('runOverdueCheck', () => {
  beforeEach(() => {
    state.adds = [];
    state.admins = [{ telegram_user_id: 100 }, { telegram_user_id: 999 }];
    state.redisStore = new Map();
    state.overdueItems = [
      {
        id: 1,
        category: 'Камера',
        model: 'Admin Cam',
        serial_number: 'A-1',
        current_holder_user_id: 100,
        current_issue_date: '2026-07-09T17:49:00.000Z',
        components: [],
      },
      {
        id: 2,
        category: 'Камера',
        model: 'Worker Cam',
        serial_number: 'B-2',
        current_holder_user_id: 200,
        current_issue_date: '2026-07-09T17:49:00.000Z',
        components: [],
      },
    ];
    state.usersMap = new Map([
      ['100', { telegram_user_id: 100, name: 'Admin Self' }],
      ['200', { telegram_user_id: 200, name: 'Worker User', username: 'worker.user' }],
    ]);
  });

  it('sends separate admin notifications and excludes self-owned equipment', async () => {
    const result = await service.runOverdueCheck([100], 7);

    assert.deepEqual(result, { sent: true, count: 2 });

    const adminJobs = state.adds.filter((job) => job.name === 'sendOverdueAdmins');
    assert.equal(adminJobs.length, 2);

    const admin100Job = adminJobs.find((job) => job.data.recipients[0] === 100);
    assert.ok(admin100Job);
    assert.equal(admin100Job.data.recipients.length, 1);
    assert.match(admin100Job.data.message, /Worker User/);
    assert.match(admin100Job.data.message, /<a href="https:\/\/t\.me\/worker\.user">Worker User<\/a>/);
    assert.doesNotMatch(admin100Job.data.message, /Admin Self/);
    assert.doesNotMatch(admin100Job.data.message, /tg:\/\/user\?id=100/);

    const admin999Job = adminJobs.find((job) => job.data.recipients[0] === 999);
    assert.ok(admin999Job);
    assert.match(admin999Job.data.message, /Admin Self/);
    assert.match(admin999Job.data.message, /Worker User/);
    assert.match(admin999Job.data.message, /<a href="tg:\/\/user\?id=100">Admin Self<\/a>/);
    assert.match(admin999Job.data.message, /<a href="https:\/\/t\.me\/worker\.user">Worker User<\/a>/);

    const userJobs = state.adds.filter((job) => job.name === 'sendOverdueUser');
    assert.equal(userJobs.length, 1);
    assert.deepEqual(userJobs[0].data.recipients, [200]);
    assert.match(userJobs[0].data.message, /<a href="https:\/\/t\.me\/worker\.user">Worker User<\/a>/);
  });

  it('skips duplicate overdue check while lock is held', async () => {
    state.redisStore.set('notifications:overdue-check:lock', 'busy');

    const result = await service.runOverdueCheck([100], 7);

    assert.deepEqual(result, { sent: false, count: 0, skipped: true });
    assert.equal(state.adds.length, 0);
  });
});
