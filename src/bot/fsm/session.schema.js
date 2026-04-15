'use strict';

const { CURRENT_SCHEMA_VERSION } = require('./state-migrator');

/** @returns {import('./types').BotSession} */
function defaultSession() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    flow:          null,
    mode:          null,
    listPage:      0,
    summaryPage:   0,
  };
}

/**
 * Returns true if an active flow has exceeded its TTL.
 * @param {object} session
 * @param {number} [ttlMs=30 * 60 * 1000]
 */
function isFlowExpired(session, ttlMs = 30 * 60 * 1000) {
  if (!session?.flow?.startedAt) return false;
  return Date.now() - session.flow.startedAt > ttlMs;
}

/**
 * Creates a new flow object with the current timestamp.
 * Always use this instead of manually setting ctx.session.flow = {...}
 * @param {string} type  FLOW_TYPE constant
 * @param {number} step  Initial step number
 * @param {object} [data]  Accumulated flow data
 */
function makeFlow(type, step, data = {}) {
  return { type, step, data, startedAt: Date.now(), version: 1 };
}

module.exports = { defaultSession, isFlowExpired, makeFlow };
