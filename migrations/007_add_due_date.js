'use strict';

exports.up = (pgm) => {
  pgm.addColumn('equipment', {
    due_date: { type: 'timestamptz', notNull: false, default: null },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('equipment', 'due_date');
};
