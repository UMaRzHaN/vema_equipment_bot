'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const logger = require('../utils/logger');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error', { err: err.message });
});

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(schema);
    logger.info('Database schema applied');
  } finally {
    client.release();
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
