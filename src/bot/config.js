'use strict';

const { config } = require('../config');

function isAdmin(ctx) {
  return Boolean(ctx.from?.id && config.bot.adminIds.includes(ctx.from.id));
}

module.exports = { isAdmin };
