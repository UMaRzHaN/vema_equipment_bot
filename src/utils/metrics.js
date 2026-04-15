'use strict';

const client = require('prom-client');

// Enable default Node.js process metrics (event loop, memory, GC, etc.)
client.collectDefaultMetrics({ prefix: 'vema_' });

// ─── Bot ─────────────────────────────────────────────────────────────────────
const botUpdatesTotal = new client.Counter({
  name:       'vema_bot_updates_total',
  help:       'Total number of bot updates processed',
  labelNames: ['type'],
});

const botErrorsTotal = new client.Counter({
  name: 'vema_bot_errors_total',
  help: 'Total number of bot handler errors',
});

// ─── Equipment ────────────────────────────────────────────────────────────────
const equipmentActionsTotal = new client.Counter({
  name:       'vema_equipment_actions_total',
  help:       'Total equipment status change actions',
  labelNames: ['action'],
});

const equipmentTotal = new client.Gauge({
  name: 'vema_equipment_total',
  help: 'Current total number of equipment records',
});

// ─── HTTP ─────────────────────────────────────────────────────────────────────
const httpRequestDuration = new client.Histogram({
  name:       'vema_http_request_duration_seconds',
  help:       'HTTP API request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets:    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const httpRequestsTotal = new client.Counter({
  name:       'vema_http_requests_total',
  help:       'Total HTTP API requests',
  labelNames: ['method', 'route', 'status'],
});

// ─── Database ─────────────────────────────────────────────────────────────────
/**
 * DB query latency — позволяет выявить медленные запросы и деградацию DB.
 * Labels:
 *   operation: 'query' | 'transaction'
 *   success:   'true' | 'false'
 */
const dbQueryDuration = new client.Histogram({
  name:       'vema_db_query_duration_seconds',
  help:       'PostgreSQL query/transaction duration in seconds',
  labelNames: ['operation', 'success'],
  buckets:    [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const dbErrorsTotal = new client.Counter({
  name:       'vema_db_errors_total',
  help:       'Total PostgreSQL errors by type',
  labelNames: ['type'],  // 'transient' | 'permanent' | 'circuit_open'
});

// ─── Redis ────────────────────────────────────────────────────────────────────
/**
 * Redis operation latency — sessions, rate limiter, BullMQ.
 */
const redisOperationDuration = new client.Histogram({
  name:       'vema_redis_operation_duration_seconds',
  help:       'Redis operation duration in seconds',
  labelNames: ['operation', 'success'],
  buckets:    [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
});

const redisErrorsTotal = new client.Counter({
  name:       'vema_redis_errors_total',
  help:       'Total Redis errors by type',
  labelNames: ['type'],
});

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
/**
 * Gauge для мониторинга состояния circuit breaker.
 * 0 = CLOSED (нормально), 1 = OPEN (проблема!), 2 = HALF_OPEN
 */
const circuitBreakerState = new client.Gauge({
  name:       'vema_circuit_breaker_state',
  help:       'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
  labelNames: ['circuit'],
});

const circuitBreakerTrips = new client.Counter({
  name:       'vema_circuit_breaker_trips_total',
  help:       'Total circuit breaker trips (CLOSED → OPEN)',
  labelNames: ['circuit'],
});

// ─── Notifications ────────────────────────────────────────────────────────────
const notificationsTotal = new client.Counter({
  name:       'vema_notifications_total',
  help:       'Total overdue notifications sent',
  labelNames: ['status'],
});

// ─── Sessions ─────────────────────────────────────────────────────────────────
const sessionOperationsTotal = new client.Counter({
  name:       'vema_session_operations_total',
  help:       'Total Redis session read/write operations',
  labelNames: ['operation', 'success'],  // operation: 'get'|'set', success: 'true'|'false'
});

module.exports = {
  register: client.register,
  // Bot
  botUpdatesTotal,
  botErrorsTotal,
  // Equipment
  equipmentActionsTotal,
  equipmentTotal,
  // HTTP
  httpRequestDuration,
  httpRequestsTotal,
  // Database
  dbQueryDuration,
  dbErrorsTotal,
  // Redis
  redisOperationDuration,
  redisErrorsTotal,
  // Circuit Breaker
  circuitBreakerState,
  circuitBreakerTrips,
  // Notifications
  notificationsTotal,
  // Sessions
  sessionOperationsTotal,
};
