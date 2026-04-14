'use strict';

const { register } = require('../../utils/metrics');

async function metricsRoutes(fastify) {
  fastify.get('/metrics', { logLevel: 'warn' }, async (_req, reply) => {
    reply
      .header('Content-Type', register.contentType)
      .send(await register.metrics());
  });
}

module.exports = metricsRoutes;
