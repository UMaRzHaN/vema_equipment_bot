'use strict';

/**
 * Migration 001 — initial schema.
 * Translates src/db/schema.sql into node-pg-migrate format.
 * Uses ifNotExists: true everywhere so it is idempotent on an existing database.
 */

exports.up = (pgm) => {
  pgm.createTable(
    'users',
    {
      id:               { type: 'bigserial', primaryKey: true },
      telegram_user_id: { type: 'bigint',    notNull: true,  unique: true },
      username:         { type: 'text' },
      first_name:       { type: 'text' },
      last_name:        { type: 'text' },
      phone:            { type: 'text' },
      created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('users', 'telegram_user_id', { name: 'idx_users_telegram_user_id', ifNotExists: true });

  pgm.createTable(
    'equipment',
    {
      id:                     { type: 'bigserial',   primaryKey: true },
      category:               { type: 'text',        notNull: true },
      brand:                  { type: 'text' },
      model:                  { type: 'text',        notNull: true },
      serial_number:          { type: 'text',        notNull: true, unique: true },
      inventory_number:       { type: 'text' },
      purchase_date:          { type: 'date' },
      status:                 { type: 'text',        notNull: true, default: "'на складе'" },
      current_holder_user_id: { type: 'bigint' },
      current_issue_date:     { type: 'timestamptz' },
      notes:                  { type: 'text' },
      created_at:             { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at:             { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('equipment', 'status',                  { name: 'idx_equipment_status',          ifNotExists: true });
  pgm.createIndex('equipment', 'category',                { name: 'idx_equipment_category',        ifNotExists: true });
  pgm.createIndex('equipment', 'current_holder_user_id',  { name: 'idx_equipment_holder_user_id',  ifNotExists: true });

  pgm.createTable(
    'history',
    {
      id:                   { type: 'bigserial',   primaryKey: true },
      equipment_id:         { type: 'bigint',      notNull: true },
      action:               { type: 'text',        notNull: true },
      from_status:          { type: 'text' },
      to_status:            { type: 'text' },
      from_user_id:         { type: 'bigint' },
      to_user_id:           { type: 'bigint' },
      performed_by_user_id: { type: 'bigint' },
      comment:              { type: 'text' },
      action_date:          { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        fk_history_equipment: {
          type: 'FOREIGN KEY',
          columns: 'equipment_id',
          references: 'equipment(id)',
          onDelete: 'CASCADE',
        },
      },
    },
  );

  pgm.createIndex('history', 'equipment_id', { name: 'idx_history_equipment_id', ifNotExists: true });
  pgm.createIndex('history', 'action_date',  { name: 'idx_history_action_date',  ifNotExists: true, order: 'DESC' });

  pgm.createTable(
    'sessions',
    {
      user_id:    { type: 'bigint',      primaryKey: true },
      data:       { type: 'text',        notNull: true },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );
};

exports.down = (pgm) => {
  pgm.dropTable('sessions');
  pgm.dropTable('history');
  pgm.dropTable('equipment');
  pgm.dropTable('users');
};
