'use strict';

require('dotenv').config();

const { z } = require('zod');

// ─── Zod schema — single source of truth for all env vars ────────────────────
const envSchema = z.object({
  // Telegram
  BOT_TOKEN:      z.string().min(10, 'BOT_TOKEN is required').optional(),
  WEBHOOK_URL:    z.preprocess((v) => v || undefined, z.string().url('WEBHOOK_URL must be a valid HTTPS URL').optional()),
  WEBHOOK_SECRET: z.string().min(8).default('webhook-secret-not-set'),
  ADMIN_IDS:      z.string().optional(),

  // Server
  PORT:     z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),

  // PostgreSQL
  POSTGRES_HOST:     z.string().min(1).default('localhost'),
  POSTGRES_PORT:     z.coerce.number().int().default(5432),
  POSTGRES_DB:       z.string().min(1).default('vema_bot'),
  POSTGRES_USER:     z.string().min(1).default('vema'),
  POSTGRES_PASSWORD: z.string().min(1, 'POSTGRES_PASSWORD is required').optional(),

  // Redis
  REDIS_HOST:     z.string().min(1).default('localhost'),
  REDIS_PORT:     z.coerce.number().int().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // App
  LOG_LEVEL:   z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  OVERDUE_DAYS: z.coerce.number().int().min(1).default(7),
  SESSION_TTL:  z.coerce.number().int().min(60).default(1800),
  API_KEY:      z.string().optional(),
});

// Parse once at module load. Throws ZodError with clear message on bad config.
const _parsed = envSchema.safeParse(process.env);
if (!_parsed.success) {
  // Print all issues at once so the operator can fix in one deploy cycle.
  const issues = _parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // Write to stderr before logger is available
  process.stderr.write(`[config] Environment validation failed:\n${issues}\n`);
  process.exit(1);
}

const env = _parsed.data;

const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,

  bot: {
    token:         env.BOT_TOKEN || '',
    webhookUrl:    env.WEBHOOK_URL || '',
    webhookSecret: env.WEBHOOK_SECRET,
    adminIds:      env.ADMIN_IDS
      ? env.ADMIN_IDS.split(',').map((id) => Number(id.trim())).filter(Boolean)
      : [],
  },

  db: {
    host:                    env.POSTGRES_HOST,
    port:                    env.POSTGRES_PORT,
    database:                env.POSTGRES_DB,
    user:                    env.POSTGRES_USER,
    password:                 env.POSTGRES_PASSWORD || '',
    max:                     20,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout:       30_000, // 30s hard cap — prevents slow queries from holding connections
  },

  redis: {
    host:                 env.REDIS_HOST,
    port:                 env.REDIS_PORT,
    password:             env.REDIS_PASSWORD || undefined,
    db:                   0,
    lazyConnect:          true,
    maxRetriesPerRequest: null,
  },

  session: {
    ttl: env.SESSION_TTL,
  },

  log: {
    level: env.LOG_LEVEL,
  },

  overdueDays: env.OVERDUE_DAYS,
  apiKey:      env.API_KEY || null,
};

/**
 * Additional semantic validation run at startup (after logger is available).
 * Warns about non-fatal misconfigurations rather than throwing.
 */
function assertConfig() {
  if (!config.bot.token && config.nodeEnv === 'production') {
    throw new Error('BOT_TOKEN is required in production mode');
  }
  if (!config.db.password && config.nodeEnv === 'production') {
    throw new Error('POSTGRES_PASSWORD is required in production mode');
  }
  if (!config.bot.webhookUrl && config.nodeEnv === 'production') {
    throw new Error('WEBHOOK_URL is required in production mode');
  }
  if (config.bot.adminIds.length === 0) {
    process.stderr.write(
      JSON.stringify({
        ts:    new Date().toISOString(),
        level: 'warn',
        msg:   'ADMIN_IDS not configured — admin functions will be unavailable',
      }) + '\n',
    );
  }
  if (config.bot.webhookSecret === 'webhook-secret-not-set' && config.nodeEnv === 'production') {
    throw new Error('WEBHOOK_SECRET must be set in production (use: openssl rand -hex 32)');
  }
  if (!config.apiKey && config.nodeEnv === 'production') {
    throw new Error('API_KEY must be set in production — REST API is publicly exposed without it');
  }
}

module.exports = { config, assertConfig };
