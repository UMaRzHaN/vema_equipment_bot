'use strict';

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const logger = require('../utils/logger');
const { httpRequestDuration, httpRequestsTotal } = require('../utils/metrics');
const { apiAuthHook } = require('./middleware/api-auth');

function createApi(bot, webhookSecret) {
  const fastify = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024, // 1 MB
  });

  // CORS
  fastify.register(cors, { origin: false });

  // API key authentication — applied to all routes except /health, /metrics, /webhook
  fastify.addHook('preHandler', apiAuthHook);

  // Request timing + metrics hook
  fastify.addHook('onRequest', async (req) => {
    req.startTime = Date.now();
  });

  fastify.addHook('onResponse', async (req, reply) => {
    const duration = (Date.now() - req.startTime) / 1000;
    const route   = req.routeOptions?.url || req.url;
    const method  = req.method;
    const status  = String(reply.statusCode);

    httpRequestDuration.observe({ method, route, status }, duration);
    httpRequestsTotal.inc({ method, route, status });

    logger.info({
      method,
      url:    req.url,
      status: reply.statusCode,
      ms:     Math.round(duration * 1000),
      userId: req.headers['x-user-id'] || undefined,
    }, 'http');
  });

  // Telegram Webhook
  fastify.post('/webhook', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== webhookSecret) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    try {
      await bot.handleUpdate(req.body);
    } catch (err) {
      logger.error({ err: err.message }, 'Webhook handle error');
    }
    // Always return 200 to Telegram to prevent retries
    return reply.code(200).send({ ok: true });
  });

  // Application routes
  fastify.register(require('./routes/health'));
  fastify.register(require('./routes/equipment'));
  fastify.register(require('./routes/actions'));
  fastify.register(require('./routes/metrics'));

  // Global error handler
  fastify.setErrorHandler(async (err, req, reply) => {
    logger.error({
      err: err.message,
      url: req.url,
      method: req.method,
    }, 'API error');
    return reply.code(500).send({ error: 'Internal server error' });
  });

  return fastify;
}

module.exports = { createApi };
