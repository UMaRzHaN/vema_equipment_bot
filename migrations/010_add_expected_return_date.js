'use strict';

exports.up = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS expected_return_date timestamptz
  `);

  await pgm.db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'equipment'
          AND column_name = 'due_date'
      ) THEN
        UPDATE equipment
        SET expected_return_date = due_date
        WHERE expected_return_date IS NULL
          AND due_date IS NOT NULL;
      END IF;
    END
    $$;
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE equipment
    DROP COLUMN IF EXISTS expected_return_date
  `);
};
