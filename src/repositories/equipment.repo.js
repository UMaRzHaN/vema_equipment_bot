'use strict';

const { query, transaction } = require('../db');
const MAX_HISTORY_ENTRIES = 8;

async function createEquipment(data) {
  const result = await query(
    `INSERT INTO equipment
       (category, brand, model, serial_number,
        purchase_date, status, components, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
     RETURNING *`,
    [
      data.category,
      data.brand || null,
      data.model,
      data.serial_number,
      data.purchase_date || null,
      data.status,
      JSON.stringify(data.components || []),
    ],
  );
  return result.rows[0];
}

async function findEquipmentById(id) {
  const result = await query(
    `SELECT * FROM (
       SELECT e.*,
              u.first_name, u.last_name, u.username,
              ROW_NUMBER() OVER (PARTITION BY e.category ORDER BY e.id ASC) AS position
       FROM equipment e
       LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     ) sub
     WHERE sub.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

async function findEquipmentBySerial(serialNumber) {
  const result = await query(
    'SELECT * FROM equipment WHERE serial_number = $1',
    [serialNumber],
  );
  return result.rows[0] || null;
}

async function getAllEquipment() {
  const result = await query(
    `SELECT e.*,
            u.first_name, u.last_name, u.username,
            ROW_NUMBER() OVER (PARTITION BY e.category ORDER BY e.id ASC) AS position
     FROM equipment e
     LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     ORDER BY e.category ASC, e.id ASC`,
  );
  return result.rows;
}

async function getEquipmentPage(limit, offset) {
  const result = await query(
    `SELECT e.*,
            u.first_name, u.last_name, u.username,
            ROW_NUMBER() OVER (PARTITION BY e.category ORDER BY e.id ASC) AS position
     FROM equipment e
     LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     ORDER BY e.category ASC, e.id ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

async function countEquipment() {
  const result = await query('SELECT COUNT(*) AS cnt FROM equipment');
  return Number(result.rows[0].cnt);
}

async function getDistinctCategories() {
  const result = await query(
    `SELECT DISTINCT COALESCE(NULLIF(category, ''), 'Без категории') AS category
     FROM equipment
     ORDER BY category`,
  );
  return result.rows.map((r) => r.category);
}

async function getDistinctBrandsByCategory(categoryName) {
  const result = await query(
    `SELECT DISTINCT COALESCE(NULLIF(brand, ''), 'Без бренда') AS brand
     FROM equipment
     WHERE COALESCE(NULLIF(category, ''), 'Без категории') = $1
     ORDER BY brand`,
    [categoryName],
  );
  return result.rows.map((r) => r.brand);
}

async function getEquipmentByCategoryName(categoryName) {
  const result = await query(
    `SELECT e.*, u.first_name, u.last_name, u.username,
            ROW_NUMBER() OVER (PARTITION BY e.category ORDER BY e.id ASC) AS position
     FROM equipment e
     LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     WHERE COALESCE(NULLIF(e.category, ''), 'Без категории') = $1
     ORDER BY e.id ASC`,
    [categoryName],
  );
  return result.rows;
}

async function getEquipmentByCategoryAndBrand(categoryName, brandName) {
  const result = await query(
    `SELECT e.*, u.first_name, u.last_name, u.username,
            ROW_NUMBER() OVER (PARTITION BY e.category ORDER BY e.id ASC) AS position
     FROM equipment e
     LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     WHERE COALESCE(NULLIF(e.category, ''), 'Без категории') = $1
       AND COALESCE(NULLIF(e.brand, ''), 'Без бренда') = $2
     ORDER BY e.id ASC`,
    [categoryName, brandName],
  );
  return result.rows;
}

async function searchEquipment(searchQuery) {
  if (!searchQuery || searchQuery.trim().length < 2) return [];
  const term = searchQuery.trim();
  const like = `%${term}%`;
  const result = await query(
    `SELECT e.*,
            u.first_name, u.last_name, u.username,
            ROW_NUMBER() OVER (PARTITION BY e.category ORDER BY e.id ASC) AS position,
            similarity(
              coalesce(e.category,'') || ' ' ||
              coalesce(e.brand,'')    || ' ' ||
              coalesce(e.model,'')    || ' ' ||
              coalesce(e.serial_number,''),
              $2
            ) AS _score
     FROM equipment e
     LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     WHERE e.category ILIKE $1
        OR e.brand ILIKE $1
        OR e.model ILIKE $1
        OR e.serial_number ILIKE $1
     ORDER BY _score DESC, e.id ASC
     LIMIT 20`,
    [like, term],
  );
  return result.rows;
}

async function updateEquipmentStatus(data) {
  await query(
    `UPDATE equipment
     SET status = $1,
         current_holder_user_id = $2,
         current_issue_date = $3,
         expected_return_date = $4,
         updated_at = NOW()
     WHERE id = $5`,
    [
      data.status,
      data.current_holder_user_id ?? null,
      data.current_issue_date ?? null,
      data.expected_return_date ?? null,
      data.id,
    ],
  );
}

async function updateEquipmentDetails(data) {
  const allowed = ['category', 'brand', 'model', 'serial_number', 'purchase_date', 'components', 'warehouse'];
  const parts = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      if (key === 'warehouse') {
        parts.push(`warehouse = CASE WHEN status = 'на складе' THEN $${idx++} ELSE NULL END`);
      } else {
        parts.push(`${key} = $${idx++}`);
      }
      values.push(key === 'components' && data[key] != null ? JSON.stringify(data[key]) : data[key]);
    }
  }

  if (!parts.length) throw new Error('No fields to update');

  parts.push('updated_at = NOW()');
  values.push(data.id);

  await query(
    `UPDATE equipment SET ${parts.join(', ')} WHERE id = $${idx}`,
    values,
  );
}

async function deleteEquipmentById(id) {
  await query('DELETE FROM equipment WHERE id = $1', [id]);
}

async function getEquipmentStats() {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE true) AS total,
       COUNT(*) FILTER (WHERE status = 'на складе') AS in_stock,
       COUNT(*) FILTER (WHERE status = 'у пользователя') AS with_user,
       COUNT(*) FILTER (WHERE status = 'в ремонте') AS repair,
       COUNT(*) FILTER (WHERE status = 'списано') AS written_off
     FROM equipment`,
  );
  const r = result.rows[0];
  return {
    total: Number(r.total),
    inStock: Number(r.in_stock),
    withUser: Number(r.with_user),
    repair: Number(r.repair),
    writtenOff: Number(r.written_off),
  };
}

async function atomicStatusChange(statusData, historyData) {
  return transaction(async (client) => {
    const setParts = [
      'status = $1',
      'current_holder_user_id = $2',
      'current_issue_date = $3',
      'expected_return_date = $4',
    ];
    const values = [
      statusData.status,
      statusData.current_holder_user_id ?? null,
      statusData.current_issue_date ?? null,
      statusData.expected_return_date ?? null,
      statusData.id,
      historyData.from_status ?? null,
    ];
    let nextIndex = 7;

    if (Object.prototype.hasOwnProperty.call(statusData, 'warehouse')) {
      setParts.push(`warehouse = $${nextIndex++}`);
      values.push(statusData.warehouse);
    }

    if (Object.prototype.hasOwnProperty.call(statusData, 'components')) {
      setParts.push(`components = $${nextIndex++}`);
      values.push(JSON.stringify(statusData.components || []));
    }

    if (Object.prototype.hasOwnProperty.call(statusData, 'project')) {
      setParts.push(`project = $${nextIndex++}`);
      values.push(statusData.project ?? null);
    }

    const updateResult = await client.query(
      `UPDATE equipment
       SET ${setParts.join(', ')},
           updated_at = NOW()
       WHERE id = $5
         AND ($6::text IS NULL OR status = $6)`,
      values,
    );
    if (updateResult.rowCount === 0) {
      throw Object.assign(new Error('STATUS_CONFLICT'), { code: 'STATUS_CONFLICT' });
    }

    await client.query(
      `INSERT INTO history
         (equipment_id, action, from_status, to_status,
          from_user_id, to_user_id, performed_by_user_id, comment, action_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [
        historyData.equipment_id,
        historyData.action,
        historyData.from_status ?? null,
        historyData.to_status ?? null,
        historyData.from_user_id ?? null,
        historyData.to_user_id ?? null,
        historyData.performed_by_user_id ?? null,
        historyData.comment ?? null,
      ],
    );

    await client.query(
      `DELETE FROM history
       WHERE equipment_id = $1
         AND id IN (
           SELECT id
           FROM history
           WHERE equipment_id = $1
           ORDER BY action_date DESC, id DESC
           OFFSET $2
         )`,
      [historyData.equipment_id, MAX_HISTORY_ENTRIES],
    );
  });
}

async function getSuggestionsForField(field, category = null, brand = null) {
  const FIELD_MAP = {
    category: {
      select: 'category',
      where: "category IS NOT NULL AND category != ''",
    },
    brand: {
      select: 'brand',
      where: "brand IS NOT NULL AND brand != ''",
    },
    model: {
      select: 'model',
      where: "model IS NOT NULL AND model != ''",
    },
    purchase_date: {
      select: "TO_CHAR(purchase_date, 'DD.MM.YYYY')",
      where: 'purchase_date IS NOT NULL',
    },
  };
  const config = FIELD_MAP[field];
  if (!config) return [];
  const params = [];
  const categoryFilter = category ? (params.push(category), `AND category = $${params.length}`) : '';
  const brandFilter = brand ? (params.push(brand), `AND brand = $${params.length}`) : '';
  const result = await query(
    `SELECT DISTINCT ${config.select} AS value
     FROM equipment
     WHERE ${config.where}
     ${categoryFilter}
     ${brandFilter}
     ORDER BY value
     LIMIT 6`,
    params,
  );
  return result.rows.map((r) => r.value).filter(Boolean);
}

module.exports = {
  atomicStatusChange,
  countEquipment,
  createEquipment,
  deleteEquipmentById,
  findEquipmentById,
  findEquipmentBySerial,
  getAllEquipment,
  getDistinctBrandsByCategory,
  getDistinctCategories,
  getEquipmentByCategoryAndBrand,
  getEquipmentByCategoryName,
  getEquipmentPage,
  getEquipmentStats,
  getSuggestionsForField,
  searchEquipment,
  updateEquipmentDetails,
  updateEquipmentStatus,
};
