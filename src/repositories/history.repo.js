const db = require("../db");

function addHistory(data) {
  const stmt = db.prepare(`
    INSERT INTO history (
      equipment_id,
      action,
      from_status,
      to_status,
      from_user_id,
      to_user_id,
      performed_by_user_id,
      comment,
      action_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    data.equipment_id,
    data.action,
    data.from_status || null,
    data.to_status || null,
    data.from_user_id || null,
    data.to_user_id || null,
    data.performed_by_user_id || null,
    data.comment || null,
    data.action_date,
  );
}

function getRecentHistory(limit = 5) {
  return db
    .prepare(
      `
        SELECT
          h.*,
          e.brand,
          e.model,
          u.first_name,
          u.last_name,
          u.username
        FROM history h
        JOIN equipment e ON e.id = h.equipment_id
        LEFT JOIN users u ON u.telegram_user_id = h.performed_by_user_id
        ORDER BY h.action_date DESC
        LIMIT ?
      `,
    )
    .all(limit);
}

function getLastActionDate(equipmentId, actions) {
  const placeholders = actions.map(() => "?").join(", ");

  const row = db
    .prepare(
      `
        SELECT action_date
        FROM history
        WHERE equipment_id = ?
          AND action IN (${placeholders})
        ORDER BY datetime(action_date) DESC
        LIMIT 1
      `,
    )
    .get(equipmentId, ...actions);

  return row?.action_date || null;
}

function getLastRepairComment(equipmentId) {
  const row = db
    .prepare(
      `
        SELECT comment
        FROM history
        WHERE equipment_id = ?
          AND action = ?
        ORDER BY datetime(action_date) DESC
        LIMIT 1
      `,
    )
    .get(equipmentId, "в ремонт");

  return row?.comment || null;
}

// Полная история по конкретному оборудованию (для карточки)
function getEquipmentHistory(equipmentId, limit = 10) {
  return db
    .prepare(
      `
        SELECT
          h.action,
          h.from_status,
          h.to_status,
          h.comment,
          h.action_date,
          u.first_name,
          u.last_name,
          u.username
        FROM history h
        LEFT JOIN users u ON u.telegram_user_id = h.performed_by_user_id
        WHERE h.equipment_id = ?
        ORDER BY datetime(h.action_date) DESC
        LIMIT ?
      `,
    )
    .all(equipmentId, limit);
}

// Оборудование у пользователей дольше N дней — для уведомлений
function getOverdueEquipment(thresholdDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - thresholdDays);
  const cutoffIso = cutoff.toISOString();

  return db
    .prepare(
      `
        SELECT
          e.id,
          e.category,
          e.brand,
          e.model,
          e.serial_number,
          e.inventory_number,
          e.current_holder_user_id,
          e.current_issue_date
        FROM equipment e
        WHERE e.status = 'у пользователя'
          AND e.current_issue_date IS NOT NULL
          AND e.current_issue_date < ?
      `,
    )
    .all(cutoffIso);
}

module.exports = {
  addHistory,
  getEquipmentHistory,
  getLastActionDate,
  getLastRepairComment,
  getOverdueEquipment,
  getRecentHistory,
};
