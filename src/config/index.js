'use strict';

require('dotenv').config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'production',
  port: Number(process.env.PORT) || 3000,

  bot: {
    token: process.env.BOT_TOKEN || '',
    webhookUrl: process.env.WEBHOOK_URL || '',
    webhookSecret: process.env.WEBHOOK_SECRET || 'webhook-secret-not-set',
    adminIds: process.env.ADMIN_IDS
      ? process.env.ADMIN_IDS.split(',').map((id) => Number(id.trim())).filter(Boolean)
      : [],
  },

  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'vema_bot',
    user: process.env.POSTGRES_USER || 'vema',
    password: process.env.POSTGRES_PASSWORD || '',
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: 0,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  },

  session: {
    ttl: Number(process.env.SESSION_TTL) || 1800, // seconds
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },

  overdueDays: Number(process.env.OVERDUE_DAYS) || 7,
};

function assertConfig() {
  if (!config.bot.token) {
    throw new Error('BOT_TOKEN is required');
  }
  if (!config.bot.webhookUrl) {
    throw new Error('WEBHOOK_URL is required (e.g. https://yourdomain.com)');
  }
  if (config.bot.adminIds.length === 0) {
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        msg: 'ADMIN_IDS not configured — admin functions will be unavailable',
      }) + '\n',
    );
  }
}

module.exports = { config, assertConfig };
