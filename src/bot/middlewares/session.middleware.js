'use strict';

const { redis } = require('../../redis');
const { config } = require('../../config');
const { defaultSession, isFlowExpired } = require('../fsm/session.schema');
const { migrateSession } = require('../fsm/state-migrator');
const logger = require('../../utils/logger');
const { sessionOperationsTotal } = require('../../utils/metrics');

function sessionKey(userId) {
  return `session:${userId}`;
}

async function getSession(userId) {
  const t0 = Date.now();
  try {
    const raw = await redis.get(sessionKey(userId));
    sessionOperationsTotal.inc({ operation: 'get', success: 'true' });

    if (!raw) return defaultSession();

    const parsed = JSON.parse(raw);
    // Migrate stale session schema (handles deploys with changed session structure)
    return migrateSession(parsed);
  } catch (err) {
    sessionOperationsTotal.inc({ operation: 'get', success: 'false' });
    logger.warn({ userId, err: err.message, ms: Date.now() - t0 }, 'session:get error — using default');
    return defaultSession();
  }
}

async function saveSession(userId, session) {
  try {
    await redis.set(sessionKey(userId), JSON.stringify(session), 'EX', config.session.ttl);
    sessionOperationsTotal.inc({ operation: 'set', success: 'true' });
  } catch (err) {
    sessionOperationsTotal.inc({ operation: 'set', success: 'false' });
    logger.error({ userId, err: err.message }, 'session:save error');
  }
}

/**
 * Telegraf middleware.
 * Reads session BEFORE the handler chain, saves AFTER (even on error).
 */
function sessionMiddleware() {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    ctx.session = await getSession(userId);

    // Auto-reset expired flows
    if (isFlowExpired(ctx.session)) {
      logger.warn({ userId, flowType: ctx.session.flow?.type }, 'session:flow expired, resetting');
      ctx.session.flow = null;
    }

    try {
      await next();
    } finally {
      await saveSession(userId, ctx.session);
    }
  };
}

module.exports = { sessionMiddleware };
