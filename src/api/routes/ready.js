'use strict';

const { pool } = require('../../db');
const { getDbCircuitBreaker } = require('../../db');
const { redis } = require('../../redis');

/**
 * /ready — Readiness probe.
 *
 * Отличие от /health:
 *   /health  = liveness.  "Процесс жив?" — только проверяет что сервер отвечает.
 *   /ready   = readiness. "Готов принимать трафик?" — проверяет все зависимости.
 *
 * Возвращает 200 только если ВСЕ критичные зависимости работают.
 * Возвращает 503 если хотя бы одна — нет (LoadBalancer исключит pod из ротации).
 *
 * Дополнительно: показывает состояние circuit breaker-ов — видно деградацию
 * до того как она стала outage.
 */
async function readyRoutes(fastify) {
  fastify.get('/ready', { logLevel: 'warn' }, async (_req, reply) => {
    const checks = {};
    let healthy = true;

    // ── PostgreSQL ────────────────────────────────────────────────────────────
    const dbBreaker = getDbCircuitBreaker();
    checks.postgres = {
      circuitState: dbBreaker.state,
    };

    if (dbBreaker.state === 'OPEN') {
      checks.postgres.status = 'circuit_open';
      healthy = false;
    } else {
      try {
        const t0 = Date.now();
        await pool.query('SELECT 1');
        checks.postgres.status = 'ok';
        checks.postgres.latencyMs = Date.now() - t0;
      } catch (err) {
        checks.postgres.status = 'error';
        checks.postgres.error  = err.message;
        healthy = false;
      }
    }

    // ── Redis ─────────────────────────────────────────────────────────────────
    try {
      const t0 = Date.now();
      await redis.ping();
      checks.redis = { status: 'ok', latencyMs: Date.now() - t0 };
    } catch (err) {
      checks.redis = { status: 'error', error: err.message };
      healthy = false;
    }

    // ── Process ───────────────────────────────────────────────────────────────
    checks.process = {
      status:   'ok',
      uptimeSec: Math.floor(process.uptime()),
      memMb:    Math.round(process.memoryUsage().rss / 1024 / 1024),
    };

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ready' : 'not_ready',
      checks,
      ts: new Date().toISOString(),
    });
  });
}

module.exports = readyRoutes;
