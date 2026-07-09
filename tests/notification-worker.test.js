'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isChatNotFoundError } = require('../src/workers/notification.worker');

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
