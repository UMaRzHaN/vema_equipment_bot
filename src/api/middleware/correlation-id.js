'use strict';

const { randomUUID } = require('crypto');

/**
 * Fastify preHandler hook: обеспечивает correlation ID для каждого запроса.
 *
 * Алгоритм:
 *   1. Берём X-Correlation-Id из входящего заголовка (если клиент передал)
 *   2. Если нет — генерируем UUID v4
 *   3. Кладём в req.correlationId (для handler-ов)
 *   4. Возвращаем в X-Correlation-Id ответа (для client-side tracing)
 *
 * Trade-off: не используем cls-hooked / AsyncLocalStorage для автоматического
 * propagation через весь call stack — это overhead для бота этого масштаба.
 * Вместо этого передаём correlationId явно в лог-вызовах где нужен контекст.
 */
async function correlationIdHook(req, reply) {
  const incoming = req.headers['x-correlation-id'];
  // Принимаем только UUID v4 формат — не доверяем произвольным строкам от клиента
  const isValidUUID = incoming && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming);

  req.correlationId = isValidUUID ? incoming : randomUUID();
  reply.header('X-Correlation-Id', req.correlationId);
}

module.exports = { correlationIdHook };
