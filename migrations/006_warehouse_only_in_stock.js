'use strict';

exports.up = (pgm) => {
  // Clean up stale data before adding the constraint
  pgm.sql(`UPDATE equipment SET warehouse = NULL WHERE status != 'на складе'`);

  // Drop NOT NULL and default — warehouse is only meaningful when in stock
  pgm.alterColumn('equipment', 'warehouse', { notNull: false, default: null });

  // Enforce at DB level: warehouse must be NULL when not in stock
  pgm.addConstraint('equipment', 'chk_warehouse_only_in_stock',
    `CHECK (status = 'на складе' OR warehouse IS NULL)`);
};

exports.down = (pgm) => {
  pgm.dropConstraint('equipment', 'chk_warehouse_only_in_stock');
  pgm.alterColumn('equipment', 'warehouse', { notNull: true, default: "'Ташкент'" });
  pgm.sql(`UPDATE equipment SET warehouse = 'Ташкент' WHERE warehouse IS NULL`);
};
