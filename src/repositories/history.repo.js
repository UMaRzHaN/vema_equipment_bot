'use strict';

const { query } = require('../db');

async function addHistory(data) {
  await query(
    `INSERT INTO history
       (equipment_id, action, from_status, to_status,
        from_user_id, to_user_id, performed_by_user_id, comment, action_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [
      data.equipment_id,
      data.action,
      data.from_status || null,
      data.to_status || null,
      data.from_user_id || null,
      data.to_user_id || null,
      data.performed_by_user_id || null,
      data.comment || null,
    ],
  );
}

async function getEquipmentHistory(equipmentId, limit = 10) {
  const result = await query(
    `SELECT h.action, h.from_status, h.to_status, h.comment, h.action_date,
            u.first_name, u.last_name, u.username
     FROM history h
     LEFT JOIN users u ON u.telegram_user_id = h.performed_by_user_id
     WHERE h.equipment_id = $1
     ORDER BY h.action_date DESC
     LIMIT $2`,
    [equipmentId, limit],
  );
  return result.rows;
}

async function getLastActionDate(equipmentId, actions) {
  const placeholders = actions.map((_, i) => `$${i + 2}`).join(', ');
  const result = await query(
    `SELECT action_date
     FROM history
     WHERE equipment_id = $1
       AND action IN (${placeholders})
     ORDER BY action_date DESC
     LIMIT 1`,
    [equipmentId, ...actions],
  );
  return result.rows[0]?.action_date || null;
}

async function getLastRepairComment(equipmentId) {
  const result = await query(
    `SELECT comment
     FROM history
     WHERE equipment_id = $1 AND action = 'в ремонт'
     ORDER BY action_date DESC
     LIMIT 1`,
    [equipmentId],
  );
  return result.rows[0]?.comment || null;
}

async function getOverdueEquipment(thresholdDays) {
  const result = await query(
    `SELECT e.id, e.category, e.brand, e.model,
            e.serial_number, e.inventory_number,
            e.current_holder_user_id, e.current_issue_date
     FROM equipment e
     WHERE e.status = 'у пользователя'
       AND e.current_issue_date IS NOT NULL
       AND e.current_issue_date < NOW() - ($1 || ' days')::INTERVAL`,
    [thresholdDays],
  );
  return result.rows;
}

module.exports = {
  addHistory,
  getEquipmentHistory,
  getLastActionDate,
  getLastRepairComment,
  getOverdueEquipment,
};
