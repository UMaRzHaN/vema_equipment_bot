'use strict';

/**
 * Migration 013 — require admin approval for newly completed registrations.
 * Existing users remain approved.
 */

exports.up = (pgm) => {
  pgm.addColumn('users', {
    is_approved: { type: 'boolean', notNull: true, default: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'is_approved');
};
