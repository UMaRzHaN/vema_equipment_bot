'use strict';

exports.up = (pgm) => {
  pgm.addColumn('equipment', {
    warehouse: { type: 'text', notNull: true, default: 'Ташкент' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('equipment', 'warehouse');
};
