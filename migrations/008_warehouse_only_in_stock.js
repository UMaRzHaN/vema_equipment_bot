'use strict';

exports.up = async (pgm) => {
  pgm.alterColumn('equipment', 'warehouse', { notNull: false, default: null });

  await pgm.db.query(`
    ALTER TABLE equipment
    DROP CONSTRAINT IF EXISTS chk_warehouse_only_in_stock
  `);

  pgm.sql(`UPDATE equipment SET warehouse = NULL WHERE status != 'на складе'`);

  pgm.addConstraint(
    'equipment',
    'chk_warehouse_only_in_stock',
    `CHECK (status = 'на складе' OR warehouse IS NULL)`
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint('equipment', 'chk_warehouse_only_in_stock');
  pgm.alterColumn('equipment', 'warehouse', {
    notNull: true,
    default: "'Ташкент'",
  });
  pgm.sql(`UPDATE equipment SET warehouse = 'Ташкент' WHERE warehouse IS NULL`);
};
