'use strict';

/**
 * Retry с exponential backoff.
 *
 * Trade-off: не используем `p-retry` / `async-retry`, чтобы не тянуть
 * зависимость и полностью контролировать, какие ошибки считаются retryable.
 *
 * ВАЖНО: не оборачивать transaction() — retry применяется снаружи транзакции
 * целиком, а не к отдельным запросам внутри неё.
 */

const logger = require('../utils/logger');

/**
 * Задержка с jitter для предотвращения thundering herd.
 * base * 2^attempt + случайный jitter до base/2
 */
function backoffMs(attempt, { base = 100, max = 10_000 } = {}) {
  const exp = Math.pow(2, attempt) * base;
  const jitter = Math.random() * (base / 2);
  return Math.min(exp + jitter, max);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Transient errors для PostgreSQL:
 *   08006 connection_failure
 *   08001 sqlclient_unable_to_establish_sqlconnection
 *   57P01 admin_shutdown
 *   ECONNREFUSED / ENOTFOUND (node socket level)
 *
 * NOT retryable: 23505 unique_violation, 42xxx syntax errors, etc.
 */
function isTransientDbError(err) {
  if (!err) return false;
  const TRANSIENT_PG_CODES = new Set(['08006', '08001', '08003', '08004', '57P01', '40001', '40P01']);
  if (TRANSIENT_PG_CODES.has(err.code)) return true;
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code)) return true;
  return false;
}

/**
 * Transient errors для Redis:
 *   ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ECONNRESET
 *   ioredis specific: 'ERR Connection is closed'
 */
function isTransientRedisError(err) {
  if (!err) return false;
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code)) return true;
  if (typeof err.message === 'string') {
    const msg = err.message.toLowerCase();
    if (msg.includes('connection is closed') || msg.includes('socket closed')) return true;
  }
  return false;
}

/**
 * Выполняет fn() с повторами при transient-ошибках.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} opts
 * @param {number} opts.maxAttempts
 * @param {number} opts.base
 * @param {number} opts.max
 * @param {(err: Error) => boolean} opts.isTransient
 * @param {string} opts.label
 * @returns {Promise<T>}
 */
async function withRetry(fn, {
  maxAttempts = 3,
  base = 100,
  max = 10_000,
  isTransient = isTransientDbError,
  label = 'operation',
} = {}) {
  let lastErr;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const willRetry = attempt + 1 < maxAttempts && isTransient(err);
      if (!willRetry) {
        throw err;
      }

      const delay = backoffMs(attempt, { base, max });
      logger.warn(
        {
          label,
          attempt: attempt + 1,
          maxAttempts,
          delayMs: Math.round(delay),
          err: err.message,
        },
        `Retry: attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms`,
      );

      await sleep(delay);
    }
  }

  throw lastErr;
}

module.exports = { withRetry, isTransientDbError, isTransientRedisError, backoffMs };
