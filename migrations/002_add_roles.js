'use strict';

/**
 * Migration 002 — add role column to users table.
 * Supports 3 roles: 'user' | 'manager' | 'admin'
 * Default is 'user' so all existing rows stay valid.
 */

exports.up = (pgm) => {
  pgm.addColumn('users', {
    role: { type: 'text', notNull: true, default: "'user'" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'role');
};
