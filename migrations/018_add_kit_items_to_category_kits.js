'use strict';

// Separates the kit composition (everything offered at give-out) from the
// "full" quick preset. Existing rows keep their current behaviour: the
// composition starts as the old full list.
exports.up = async (pgm) => {
  await pgm.db.query(`ALTER TABLE category_kits ADD COLUMN IF NOT EXISTS kit_items JSONB`);
  await pgm.db.query(`UPDATE category_kits SET kit_items = full_items WHERE kit_items IS NULL`);
  await pgm.db.query(`
    ALTER TABLE category_kits
      ALTER COLUMN kit_items SET DEFAULT '[]'::jsonb,
      ALTER COLUMN kit_items SET NOT NULL
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query('ALTER TABLE category_kits DROP COLUMN IF EXISTS kit_items');
};
