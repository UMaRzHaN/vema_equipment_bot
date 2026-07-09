'use strict';

exports.up = (pgm) => {
  // Drop NOT NULL and default first, then clean data, then add constraint
  pgm.alterColumn('equipment', 'warehouse', { notNull: false, default: null });

  pgm.sql(`UPDATE equipment SET warehouse = NULL WHERE status != 'на складе'`);

  pgm.addConstraint('equipment', 'chk_warehouse_only_in_stock',
    `CHECK (status = 'на складе' OR warehouse IS NULL)`);
};

exports.down = (pgm) => {
  pgm.dropConstraint('equipment', 'chk_warehouse_only_in_stock');
  pgm.alterColumn('equipment', 'warehouse', { notNull: true, default: "'Ташкент'" });
  pgm.sql(`UPDATE equipment SET warehouse = 'Ташкент' WHERE warehouse IS NULL`);
};
