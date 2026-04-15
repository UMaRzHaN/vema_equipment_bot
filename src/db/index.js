'use strict';

const { Pool } = require('pg');
const { config } = require('../config');
const logger = require('../utils/logger');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'PostgreSQL pool error');
});

async function initDb() {
  // Schema is now managed by node-pg-migrate.
  // Run `npm run migrate` (or the docker-compose command) to apply pending migrations.
  logger.info('Database schema managed by node-pg-migrate');
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
