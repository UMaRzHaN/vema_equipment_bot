'use strict';

exports.noTransaction = true;

exports.up = async (pgm) => {
  await pgm.db.query('DROP INDEX IF EXISTS idx_equipment_trgm_search');
  await pgm.db.query('ALTER TABLE equipment DROP COLUMN IF EXISTS inventory_number');
  await pgm.db.query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_equipment_trgm_search
    ON equipment USING GIN (
      (
        coalesce(category, '') || ' ' ||
        coalesce(brand, '')    || ' ' ||
        coalesce(model, '')    || ' ' ||
        coalesce(serial_number, '')
      ) gin_trgm_ops
    )
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query('DROP INDEX IF EXISTS idx_equipment_trgm_search');
  await pgm.db.query('ALTER TABLE equipment ADD COLUMN IF NOT EXISTS inventory_number TEXT');
  await pgm.db.query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_equipment_trgm_search
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
