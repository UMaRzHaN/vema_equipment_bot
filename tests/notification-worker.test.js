'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const workerState = {
  processor: null,
};

const { isChatNotFoundError, startNotificationWorker } = proxyquire('../src/workers/notification.worker', {
  bullmq: {
    Worker: class WorkerStub {
      constructor(queueName, processor) {
        this.queueName = queueName;
        workerState.processor = processor;
      }

      on() {}
    },
  },
  '../redis': { bullRedis: {} },
  '../utils/logger': {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
  '../utils/metrics': {
    notificationsTotal: {
      inc: () => {},
    },
  },
});

test('isChatNotFoundError detects Telegram chat-not-found failures', () => {
  assert.equal(
    isChatNotFoundError(new Error('400: Bad Request: chat not found')),
    true,
  );
});

test('isChatNotFoundError ignores unrelated Telegram failures', () => {
  assert.equal(
    isChatNotFoundError(new Error('400: Bad Request: can\'t parse entities')),
    false,
  );
});

test('notification worker disables link previews for HTML messages', async () => {
  const calls = [];
  const bot = {
    telegram: {
      async sendMessage(recipientId, message, options) {
        calls.push({ recipientId, message, options });
      },
    },
  };

  startNotificationWorker(bot);
  await workerState.processor({
    id: 'job-1',
    name: 'sendOverdueAdmins',
    data: {
      recipients: [123],
      message: '<a href="https://t.me/test">User</a>',
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.parse_mode, 'HTML');
  assert.deepEqual(calls[0].options.link_preview_options, { is_disabled: true });
});
