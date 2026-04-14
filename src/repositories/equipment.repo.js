'use strict';

const { query, transaction } = require('../db');

async function createEquipment(data) {
  const result = await query(
    `INSERT INTO equipment
       (category, brand, model, serial_number, inventory_number,
        purchase_date, status, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
     RETURNING *`,
    [
      data.category,
      data.brand || null,
      data.model,
      data.serial_number,
      data.inventory_number || null,
      data.purchase_date || null,
      data.status,
      data.notes || null,
    ],
  );
  return result.rows[0];
}

async function findEquipmentById(id) {
  const result = await query(
    `SELECT e.*,
            u.first_name, u.last_name, u.username
     FROM equipment e
     LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     WHERE e.id = $1`,
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
            u.first_name, u.last_name, u.username
     FROM equipment e
     LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     ORDER BY e.inventory_number ASC NULLS LAST, e.id ASC`,
  );
  return result.rows;
}

async function searchEquipment(searchQuery) {
  const like = `%${searchQuery}%`;
  const result = await query(
    `SELECT e.*,
            u.first_name, u.last_name, u.username
     FROM equipment e
     LEFT JOIN users u ON u.telegram_user_id = e.current_holder_user_id
     WHERE e.category ILIKE $1
        OR e.brand ILIKE $1
        OR e.model ILIKE $1
        OR e.serial_number ILIKE $1
        OR e.inventory_number ILIKE $1
     ORDER BY e.inventory_number ASC NULLS LAST, e.id ASC
     LIMIT 20`,
    [like],
  );
  return result.rows;
}

async function updateEquipmentStatus(data) {
  await query(
    `UPDATE equipment
     SET status = $1,
         current_holder_user_id = $2,
         current_issue_date = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [
      data.status,
      data.current_holder_user_id ?? null,
      data.current_issue_date ?? null,
      data.id,
    ],
  );
}

async function updateEquipmentDetails(data) {
  const allowed = ['category', 'brand', 'model', 'serial_number', 'inventory_number', 'purchase_date', 'notes'];
  const parts = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      parts.push(`${key} = $${idx++}`);
      values.push(data[key]);
    }
  }

  if (!parts.length) throw new Error('No fields to update');

  parts.push(`updated_at = NOW()`);
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
       COUNT(*) FILTER (WHERE true)                     AS total,
       COUNT(*) FILTER (WHERE status = 'на складе')    AS in_stock,
       COUNT(*) FILTER (WHERE status = 'у пользователя') AS with_user,
       COUNT(*) FILTER (WHERE status = 'в ремонте')    AS repair,
       COUNT(*) FILTER (WHERE status = 'списано')       AS written_off
     FROM equipment`,
  );
  const r = result.rows[0];
  return {
    total:      Number(r.total),
    inStock:    Number(r.in_stock),
    withUser:   Number(r.with_user),
    repair:     Number(r.repair),
    writtenOff: Number(r.written_off),
  };
}

/**
 * Atomically update equipment status AND insert a history record.
 * Uses a DB transaction — either both succeed or both fail.
 */
async function atomicStatusChange(statusData, historyData) {
  return transaction(async (client) => {
    await client.query(
      `UPDATE equipment
       SET status = $1,
           current_holder_user_id = $2,
           current_issue_date = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [
        statusData.status,
        statusData.current_holder_user_id ?? null,
        statusData.current_issue_date ?? null,
        statusData.id,
      ],
    );

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
  });
}

async function getSuggestionsForField(field) {
  const allowed = new Set(['category', 'brand', 'model', 'inventory_number', 'purchase_date']);
  if (!allowed.has(field)) return [];
  const result = await query(
    `SELECT DISTINCT ${field} AS value
     FROM equipment
     WHERE ${field} IS NOT NULL AND ${field} != ''
     ORDER BY value
     LIMIT 6`,
  );
  return result.rows.map((r) => r.value).filter(Boolean);
}

module.exports = {
  atomicStatusChange,
  createEquipment,
  deleteEquipmentById,
  findEquipmentById,
  findEquipmentBySerial,
  getAllEquipment,
  getEquipmentStats,
  getSuggestionsForField,
  searchEquipment,
  updateEquipmentDetails,
  updateEquipmentStatus,
};
