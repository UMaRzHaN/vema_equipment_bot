'use strict';

const { redis } = require('../../redis');
const { config } = require('../../config');
const { defaultSession, isFlowExpired } = require('../fsm/session.schema');
const logger = require('../../utils/logger');

function sessionKey(userId) {
  return `session:${userId}`;
}

async function getSession(userId) {
  try {
    const raw = await redis.get(sessionKey(userId));
    return raw ? JSON.parse(raw) : defaultSession();
  } catch (err) {
    logger.warn({ userId, err: err.message }, 'session:get error');
    return defaultSession();
  }
}

async function saveSession(userId, session) {
  try {
    await redis.set(sessionKey(userId), JSON.stringify(session), 'EX', config.session.ttl);
  } catch (err) {
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
