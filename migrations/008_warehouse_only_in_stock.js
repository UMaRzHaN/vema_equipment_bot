'use strict';

exports.up = (pgm) => {
  // First allow NULLs, then clean existing rows, then enforce the new rule.
  pgm.alterColumn('equipment', 'warehouse', { notNull: false, default: null });

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
