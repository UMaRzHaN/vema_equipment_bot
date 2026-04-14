'use strict';

const client = require('prom-client');

// Enable default Node.js process metrics
client.collectDefaultMetrics({ prefix: 'vema_' });

// --- Bot metrics ---
const botUpdatesTotal = new client.Counter({
  name: 'vema_bot_updates_total',
  help: 'Total number of bot updates processed',
  labelNames: ['type'],
});

const botErrorsTotal = new client.Counter({
  name: 'vema_bot_errors_total',
  help: 'Total number of bot handler errors',
});

// --- Equipment metrics ---
const equipmentActionsTotal = new client.Counter({
  name: 'vema_equipment_actions_total',
  help: 'Total equipment status change actions',
  labelNames: ['action'],
});

const equipmentTotal = new client.Gauge({
  name: 'vema_equipment_total',
  help: 'Current total number of equipment records',
});

// --- API metrics ---
const httpRequestDuration = new client.Histogram({
  name: 'vema_http_request_duration_seconds',
  help: 'HTTP API request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const httpRequestsTotal = new client.Counter({
  name: 'vema_http_requests_total',
  help: 'Total HTTP API requests',
  labelNames: ['method', 'route', 'status'],
});

// --- Notification metrics ---
const notificationsTotal = new client.Counter({
  name: 'vema_notifications_total',
  help: 'Total overdue notifications sent',
  labelNames: ['status'],
});

module.exports = {
  register: client.register,
  botUpdatesTotal,
  botErrorsTotal,
  equipmentActionsTotal,
  equipmentTotal,
  httpRequestDuration,
  httpRequestsTotal,
  notificationsTotal,
};
