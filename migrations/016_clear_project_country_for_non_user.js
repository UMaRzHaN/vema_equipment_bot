'use strict';

exports.up = (pgm) => {
  pgm.sql(`UPDATE equipment SET project = NULL, country = NULL WHERE status != 'у пользователя'`);

  pgm.addConstraint(
    'equipment',
    'chk_project_country_only_with_user',
    `CHECK (status = 'у пользователя' OR (project IS NULL AND country IS NULL))`
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint('equipment', 'chk_project_country_only_with_user');
};
