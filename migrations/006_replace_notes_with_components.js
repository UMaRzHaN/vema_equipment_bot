'use strict';

exports.up = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '[]'::jsonb
  `);

  await pgm.db.query(`
    UPDATE equipment
    SET components = CASE
      WHEN notes IS NULL OR btrim(notes) = '' THEN '[]'::jsonb
      ELSE to_jsonb(regexp_split_to_array(notes, '\\s*,\\s*'))
    END
    WHERE components = '[]'::jsonb
  `);

  await pgm.db.query(`
    ALTER TABLE equipment
    DROP COLUMN IF EXISTS notes
  `);
};

exports.down = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS notes text
  `);

  await pgm.db.query(`
    UPDATE equipment
    SET notes = CASE
      WHEN jsonb_typeof(components) = 'array'
      THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(components)), ', ')
      ELSE NULL
    END
  `);

  await pgm.db.query(`
    ALTER TABLE equipment
    DROP COLUMN IF EXISTS components
  `);
};
