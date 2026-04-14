'use strict';

const { pool } = require('../../db');
const { redis } = require('../../redis');

async function healthRoutes(fastify) {
  fastify.get('/health', { logLevel: 'warn' }, async (_req, reply) => {
    const checks = {};

    // Check PostgreSQL
    try {
      await pool.query('SELECT 1');
      checks.postgres = 'ok';
    } catch (err) {
      checks.postgres = 'error';
    }

    // Check Redis
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch (err) {
      checks.redis = 'error';
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      uptime: process.uptime(),
      checks,
      ts: new Date().toISOString(),
    });
  });
}

module.exports = healthRoutes;
