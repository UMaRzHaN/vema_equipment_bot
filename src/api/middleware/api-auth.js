'use strict';

const { config } = require('../../config');

/**
 * Fastify hook that validates the X-API-Key header for protected routes.
 *
 * If API_KEY is not configured, the middleware is a no-op (warns on startup via config).
 * Requests to /health and /metrics are always allowed through (used by Docker + Prometheus).
 *
 * Usage: register as a global preHandler in createApi()
 */
async function apiAuthHook(req, reply) {
  // Public endpoints — never require auth
  const PUBLIC_PATHS = new Set(['/health', '/ready', '/metrics', '/webhook']);
  if (PUBLIC_PATHS.has(req.routeOptions?.url || req.url)) return;

  // Auth not configured — allow all (warned at startup)
  if (!config.apiKey) return;

  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== config.apiKey) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

module.exports = { apiAuthHook };
