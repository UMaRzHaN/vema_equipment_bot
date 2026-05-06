'use strict';

exports.up = (pgm) => {
  pgm.sql(`UPDATE equipment SET warehouse = NULL WHERE status != 'на складе'`);
};

exports.down = () => {};
