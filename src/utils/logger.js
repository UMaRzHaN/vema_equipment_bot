'use strict';

const pino = require('pino');

// Read directly from env — avoids importing config (which validates the full
// env schema and calls process.exit). Logger must be safe to require in tests
// that run without POSTGRES_PASSWORD set.
const _level   = process.env.LOG_LEVEL   || 'info';
const _nodeEnv = process.env.NODE_ENV    || 'production';

const transport =
  _nodeEnv === 'development'
    ? pino.transport({
        target:  'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid' },
      })
    : undefined;

/**
 * Базовый логгер.
 * В production — JSON в stdout (подхватывается Docker logging driver).
 * В development — pino-pretty для читаемости.
 */
const logger = pino(
  {
    level: _level,
    base:  { pid: process.pid, service: 'vema-equipment-bot' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) { return { level: label }; },
    },
    // Редактируем чувствительные поля — они никогда не попадут в логи
    redact: {
      paths:  ['req.headers.authorization', 'req.headers["x-api-key"]', '*.password', '*.token'],
      censor: '[REDACTED]',
    },
  },
  transport,
);

/**
 * Создаёт дочерний логгер с закреплённым контекстом.
 * Использовать в обработчиках запросов:
 *   const log = childLogger({ reqId: req.correlationId, userId: ctx.from?.id });
 *   log.info('equipment added');
 *
 * @param {Record<string, unknown>} bindings
 * @returns {pino.Logger}
 */
function childLogger(bindings) {
  return logger.child(bindings);
}

module.exports = logger;
module.exports.childLogger = childLogger;
