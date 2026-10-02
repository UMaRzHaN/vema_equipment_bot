'use strict';

exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE IF NOT EXISTS category_kits (
      category       TEXT PRIMARY KEY,
      has_kit        BOOLEAN NOT NULL DEFAULT TRUE,
      full_items     JSONB NOT NULL DEFAULT '[]'::jsonb,
      minimal_items  JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_by     BIGINT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query('DROP TABLE IF EXISTS category_kits');
};
