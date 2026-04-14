'use strict';

function ensureSession(ctx) {
  ctx.session ??= {};
}

function resetFlow(ctx) {
  ensureSession(ctx);
  ctx.session.flow = null;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { ensureSession, nowIso, resetFlow };
