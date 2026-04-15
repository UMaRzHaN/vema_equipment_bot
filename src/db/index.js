'use strict';

const { Pool } = require('pg');
const { config } = require('../config');
const logger = require('../utils/logger');
const { CircuitBreaker, CircuitOpenError } = require('../lib/circuit-breaker');
const { withRetry, isTransientDbError } = require('../lib/retry');
const {
  dbQueryDuration,
  dbErrorsTotal,
  circuitBreakerState,
  circuitBreakerTrips,
} = require('../utils/metrics');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'PostgreSQL pool error');
});

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
// 5 consecutive failures → OPEN; пробуем снова через 30s
const dbBreaker = new CircuitBreaker('postgres', {
  threshold: 5,
  timeout:   30_000,
});

// Синхронизируем состояние breaker с Prometheus gauge
function syncBreakerMetrics() {
  const STATE_CODE = { CLOSED: 0, OPEN: 1, HALF_OPEN: 2 };
  const current = dbBreaker.state;
  circuitBreakerState.set({ circuit: 'postgres' }, STATE_CODE[current] ?? 0);
}

// Патчим _trip() чтобы инкрементировать счётчик trips
const originalTrip = dbBreaker._trip.bind(dbBreaker);
dbBreaker._trip = function () {
  originalTrip();
  circuitBreakerTrips.inc({ circuit: 'postgres' });
  syncBreakerMetrics();
};
dbBreaker._onSuccess = function () {
  CircuitBreaker.prototype._onSuccess.call(this);
  syncBreakerMetrics();
};

// ─── Query wrapper ────────────────────────────────────────────────────────────
/**
 * Execute a single query.
 * Wrapped with:
 *   - Circuit breaker (fast fail if DB is consistently down)
 *   - Retry (2 attempts for transient connection errors only)
 *   - Prometheus latency histogram
 *
 * DO NOT use for queries inside transaction() — the transaction client
 * has its own direct access.
 */
async function query(text, params) {
  const end = dbQueryDuration.startTimer({ operation: 'query' });
  try {
    const result = await dbBreaker.execute(() =>
      withRetry(() => pool.query(text, params), {
        maxAttempts: 2,
        base:        50,
        isTransient: isTransientDbError,
        label:       'db.query',
      }),
    );
    end({ success: 'true' });
    return result;
  } catch (err) {
    end({ success: 'false' });
    if (err instanceof CircuitOpenError) {
      dbErrorsTotal.inc({ type: 'circuit_open' });
    } else if (isTransientDbError(err)) {
      dbErrorsTotal.inc({ type: 'transient' });
    } else {
      dbErrorsTotal.inc({ type: 'permanent' });
    }
    throw err;
  }
}

/**
 * Run multiple statements in a single transaction.
 *
 * The transaction itself is NOT automatically retried (that's the caller's job
 * — they control whether the operation is idempotent).
 * The circuit breaker still applies — if DB is OPEN, transaction() throws immediately.
 */
async function transaction(fn) {
  const end = dbQueryDuration.startTimer({ operation: 'transaction' });
  try {
    const result = await dbBreaker.execute(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn(client);
        await client.query('COMMIT');
        return r;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
    end({ success: 'true' });
    return result;
  } catch (err) {
    end({ success: 'false' });
    if (err instanceof CircuitOpenError) {
      dbErrorsTotal.inc({ type: 'circuit_open' });
    } else if (isTransientDbError(err)) {
      dbErrorsTotal.inc({ type: 'transient' });
    } else {
      dbErrorsTotal.inc({ type: 'permanent' });
    }
    throw err;
  }
}

/**
 * Called at startup. Verifies DB connectivity and required extensions.
 * Schema migrations are handled by node-pg-migrate (npm run migrate).
 */
async function initDb() {
  // 1. Connectivity check — fail fast if DB is unreachable on startup
  await pool.query('SELECT 1');
  logger.info('Database connection OK');

  // 2. Verify pg_trgm extension (required for similarity() in equipment search)
  const res = await pool.query(
    "SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'",
  );
  if (res.rowCount === 0) {
    logger.warn(
      'pg_trgm extension not installed — fuzzy search degraded. ' +
      'Fix: CREATE EXTENSION IF NOT EXISTS pg_trgm;',
    );
  } else {
    logger.info('pg_trgm extension OK');
  }

  // 3. Init circuit breaker metric
  syncBreakerMetrics();
}

async function closeDb() {
  await pool.end();
  logger.info('Database pool closed');
}

/** Expose circuit breaker for /ready endpoint and admin resets */
function getDbCircuitBreaker() {
  return dbBreaker;
}

module.exports = { pool, query, transaction, initDb, closeDb, getDbCircuitBreaker };
