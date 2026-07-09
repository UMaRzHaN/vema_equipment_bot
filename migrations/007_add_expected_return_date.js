'use strict';

exports.up = (pgm) => {
  pgm.addColumn('equipment', {
    expected_return_date: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('equipment', 'expected_return_date');
};
