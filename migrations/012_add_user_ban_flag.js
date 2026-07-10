'use strict';

/**
 * Migration 012 — add a ban flag for Telegram users.
 * Banned users keep their profile for audit/history, but cannot use the bot.
 */

exports.up = (pgm) => {
  pgm.addColumn('users', {
    is_banned: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'is_banned');
};
