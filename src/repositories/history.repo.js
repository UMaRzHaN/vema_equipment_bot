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

module.exports = {
  addHistory,
  getLastActionDate,
  getLastRepairComment,
  getRecentHistory,
};
