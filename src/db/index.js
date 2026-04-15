'use strict';

const { Pool } = require('pg');
const { config } = require('../config');
const logger = require('../utils/logger');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'PostgreSQL pool error');
});

/**
 * Called at startup. Verifies DB connectivity and required extensions.
 * Schema migrations are handled by node-pg-migrate (npm run migrate).
 */
async function initDb() {
  // 1. Connectivity check — fail fast if DB is unreachable
  await pool.query('SELECT 1');
  logger.info('Database connection OK');

  // 2. Verify pg_trgm extension (required for similarity() in equipment search)
  const res = await pool.query(
    "SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'",
  );
  if (res.rowCount === 0) {
    logger.warn(
      'pg_trgm extension not installed — fuzzy search will be degraded. ' +
      'Fix: run as superuser: CREATE EXTENSION IF NOT EXISTS pg_trgm;',
    );
  } else {
    logger.info('pg_trgm extension OK');
  }
}

/**
 * Execute a single query using a pool client.
 * @param {string} text  SQL text
 * @param {any[]}  [params]
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run multiple statements in a single transaction.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closeDb() {
  await pool.end();
  logger.info('Database pool closed');
}

module.exports = { pool, query, transaction, initDb, closeDb };
