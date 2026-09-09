'use strict';

exports.up = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS country TEXT
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE equipment
    DROP COLUMN IF EXISTS country
  `);
};
