'use strict';

const { config } = require('../config');

function isAdmin(ctx) {
  return Boolean(ctx.from?.id && config.bot.adminIds.includes(ctx.from.id));
}

/**
 * Role-based check. Supports hierarchy: admin > manager > user.
 * @param {string|null|undefined} userRole   The role stored in DB
 * @param {'user'|'manager'|'admin'} requiredRole
 */
function hasRole(userRole, requiredRole) {
  const LEVELS = { user: 0, manager: 1, admin: 2 };
  return (LEVELS[userRole] ?? 0) >= (LEVELS[requiredRole] ?? 99);
}

/** env-admin OR session role === 'admin' */
function isEffectiveAdmin(ctx) {
  return isAdmin(ctx) || ctx.session?.userRole === 'admin';
}

/** env-admin OR session role === 'manager' or 'admin' */
function isEffectiveManager(ctx) {
  return isAdmin(ctx) || hasRole(ctx.session?.userRole, 'manager');
}

module.exports = { hasRole, isAdmin, isEffectiveAdmin, isEffectiveManager };
