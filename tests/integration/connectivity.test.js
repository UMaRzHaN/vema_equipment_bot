'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

function waitForTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish(new Error(`Timeout connecting to ${host}:${port}`)));
    socket.once('error', (err) => finish(err));
    socket.connect(port, host);
  });
}

test('postgres is reachable over docker network', async () => {
  const host = process.env.POSTGRES_HOST || 'postgres';
  const port = Number(process.env.POSTGRES_PORT || 5432);

  await assert.doesNotReject(() => waitForTcp(host, port, 7000));
});

test('redis is reachable over docker network', async () => {
  const host = process.env.REDIS_HOST || 'redis';
  const port = Number(process.env.REDIS_PORT || 6379);

  await assert.doesNotReject(() => waitForTcp(host, port, 7000));
});
