'use strict';

const pino = require('pino');
const { config } = require('../config');

const transport =
  config.nodeEnv === 'development'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } })
    : undefined;

const logger = pino(
  {
    level: config.log.level,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  transport,
);

module.exports = logger;
