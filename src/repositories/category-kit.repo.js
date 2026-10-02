'use strict';

const { query } = require('../db');

async function findCategoryKit(category) {
  const result = await query('SELECT * FROM category_kits WHERE category = $1', [category]);
  return result.rows[0] || null;
}

async function upsertCategoryKit(category, { hasKit, fullItems, minimalItems, updatedBy }) {
  const result = await query(
    `INSERT INTO category_kits (category, has_kit, full_items, minimal_items, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (category) DO UPDATE
       SET has_kit = EXCLUDED.has_kit,
           full_items = EXCLUDED.full_items,
           minimal_items = EXCLUDED.minimal_items,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING *`,
    [category, hasKit, JSON.stringify(fullItems), JSON.stringify(minimalItems), updatedBy || null],
  );
  return result.rows[0];
}

async function deleteCategoryKit(category) {
  await query('DELETE FROM category_kits WHERE category = $1', [category]);
}

module.exports = { deleteCategoryKit, findCategoryKit, upsertCategoryKit };
