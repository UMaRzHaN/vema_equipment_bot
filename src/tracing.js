'use strict';

/**
 * OpenTelemetry distributed tracing.
 *
 * Включается через OTEL_ENABLED=true в .env
 * При отсутствии — нулевой overhead (модуль не загружается).
 *
 * Что инструментируется автоматически:
 *   - HTTP запросы (Fastify) → http.server.duration span
 *   - PostgreSQL запросы (pg) → db.postgresql.query span
 *   - Redis операции (ioredis) → db.redis.* span
 *
 * Экспортёры:
 *   OTEL_EXPORTER=console  → stdout (для разработки / дебага)
 *   OTEL_EXPORTER=otlp     → OTLP HTTP (Jaeger, Grafana Tempo, Honeycomb, etc.)
 *
 * Переменные для OTLP:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
 *   OTEL_SERVICE_NAME=vema-equipment-bot
 *
 * ВАЖНО: этот файл должен быть импортирован ПЕРВЫМ в app.js
 * через: require('./tracing');
 *
 * Установка зависимостей:
 *   npm install \
 *     @opentelemetry/sdk-node \
 *     @opentelemetry/auto-instrumentations-node \
 *     @opentelemetry/exporter-trace-otlp-http \
 *     @opentelemetry/resources \
 *     @opentelemetry/semantic-conventions
 */

if (process.env.OTEL_ENABLED !== 'true') {
  // OTEL не включён — экспортируем no-op функцию, нулевой overhead
  module.exports = { setup: () => {} };
  return;
}

let sdk;

function setup() {
  // Lazy require — пакеты не установлены по умолчанию
  let NodeSDK, getNodeAutoInstrumentations, OTLPTraceExporter, ConsoleSpanExporter, Resource, SEMRESATTRS_SERVICE_NAME;

  try {
    ({ NodeSDK } = require('@opentelemetry/sdk-node'));
    ({ getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node'));
    ({ Resource } = require('@opentelemetry/resources'));
    ({ SEMRESATTRS_SERVICE_NAME } = require('@opentelemetry/semantic-conventions'));
  } catch {
    console.error('[tracing] OTEL_ENABLED=true but @opentelemetry packages not installed.');
    console.error('[tracing] Run: npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node');
    console.error('[tracing] Continuing without tracing.');
    return;
  }

  const exporter = (() => {
    const type = process.env.OTEL_EXPORTER || 'otlp';
    if (type === 'console') {
      const { ConsoleSpanExporter: CSE } = require('@opentelemetry/sdk-trace-base');
      return new CSE();
    }
    // Default: OTLP HTTP
    const { OTLPTraceExporter: OTE } = require('@opentelemetry/exporter-trace-otlp-http');
    return new OTE({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
        : 'http://localhost:4318/v1/traces',
    });
  })();

  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'vema-equipment-bot',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Инструментируем только нужное — меньше overhead
        '@opentelemetry/instrumentation-fs':     { enabled: false },
        '@opentelemetry/instrumentation-dns':    { enabled: false },
        '@opentelemetry/instrumentation-net':    { enabled: false },
        '@opentelemetry/instrumentation-http':   { enabled: true  },
        '@opentelemetry/instrumentation-pg':     { enabled: true  },
        '@opentelemetry/instrumentation-ioredis':{ enabled: true  },
      }),
    ],
  });

  sdk.start();
  console.log(`[tracing] OpenTelemetry started (exporter: ${process.env.OTEL_EXPORTER || 'otlp'})`);

  // Graceful shutdown
  process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
}

module.exports = { setup };
