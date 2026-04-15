'use strict';

/**
 * Migration 003 — add pg_trgm extension and GIN index for fuzzy equipment search.
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction, so noTransaction = true.
 */

exports.up = async (pgm) => {
  await pgm.db.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await pgm.db.query(`
    CREATE INDEX IF NOT EXISTS idx_equipment_trgm_search
    ON equipment USING GIN (
      (
        coalesce(category, '') || ' ' ||
        coalesce(brand, '')    || ' ' ||
        coalesce(model, '')    || ' ' ||
        coalesce(serial_number, '') || ' ' ||
        coalesce(inventory_number, '')
      ) gin_trgm_ops
    )
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query('DROP INDEX IF EXISTS idx_equipment_trgm_search');
};
