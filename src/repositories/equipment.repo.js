const db = require("../db");
const { STATUS } = require("../utils/constants");

function createEquipment(data) {
  const stmt = db.prepare(`
    INSERT INTO equipment (
      category,
      brand,
      model,
      serial_number,
      inventory_number,
      purchase_date,
      status,
      current_holder_user_id,
      current_issue_date,
      notes,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
  `);

  return stmt.run(
    data.category,
    data.brand,
    data.model,
    data.serial_number,
    data.inventory_number,
    data.purchase_date,
    data.status,
    data.notes,
    data.created_at,
    data.updated_at,
  );
}

function findEquipmentBySerial(serialNumber) {
  return db
    .prepare(
      `
        SELECT *
        FROM equipment
        WHERE serial_number = ?
      `,
    )
    .get(serialNumber);
}

function getAllEquipment(limit) {
  const query = `
    SELECT e.*,
           u.first_name,
           u.last_name,
           u.username
    FROM equipment e
    LEFT JOIN users u
      ON u.telegram_user_id = e.current_holder_user_id
    ORDER BY e.inventory_number ASC, e.id ASC
  `;

  if (typeof limit === "number") {
    return db.prepare(`${query}\nLIMIT ?`).all(limit);
  }

  return db.prepare(query).all();
}

function searchEquipment(query) {
  const like = `%${query}%`;

  return db
    .prepare(
      `
        SELECT e.*,
               u.first_name,
               u.last_name,
               u.username
        FROM equipment e
        LEFT JOIN users u
          ON u.telegram_user_id = e.current_holder_user_id
        WHERE e.category LIKE ?
           OR e.brand LIKE ?
           OR e.model LIKE ?
           OR e.serial_number LIKE ?
           OR e.inventory_number LIKE ?
        ORDER BY e.inventory_number ASC, e.id ASC
        LIMIT 20
      `,
    )
    .all(like, like, like, like, like);
}

function findEquipmentById(id) {
  return db
    .prepare(
      `
        SELECT *
        FROM equipment
        WHERE id = ?
      `,
    )
    .get(id);
}

function updateEquipmentStatus(data) {
  return db
    .prepare(
      `
        UPDATE equipment
        SET status = ?,
            current_holder_user_id = ?,
            current_issue_date = ?,
            updated_at = ?
        WHERE id = ?
      `,
    )
    .run(
      data.status,
      data.current_holder_user_id,
      data.current_issue_date,
      data.updated_at,
      data.id,
    );
}

function updateEquipmentDetails(data) {
  const allowed = [
    "category",
    "brand",
    "model",
    "serial_number",
    "inventory_number",
    "purchase_date",
    "notes",
  ];
  const parts = [];
  const values = [];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      parts.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (!parts.length) {
    throw new Error("No fields to update");
  }

  parts.push("updated_at = ?");
  values.push(data.updated_at, data.id);

  return db
    .prepare(
      `
        UPDATE equipment
        SET ${parts.join(", ")}
        WHERE id = ?
      `,
    )
    .run(...values);
}

function deleteEquipmentById(id) {
  return db
    .prepare(
      `
        DELETE FROM equipment
        WHERE id = ?
      `,
    )
    .run(id);
}

function clearHolder(id, updatedAt) {
  return db
    .prepare(
      `
        UPDATE equipment
        SET current_holder_user_id = NULL,
            current_issue_date = NULL,
            updated_at = ?
        WHERE id = ?
      `,
    )
    .run(updatedAt, id);
}

function getEquipmentStats() {
  return {
    total: db.prepare("SELECT COUNT(*) AS count FROM equipment").get().count,
    inStock: db
      .prepare("SELECT COUNT(*) AS count FROM equipment WHERE status = ?")
      .get(STATUS.IN_STOCK).count,
    withUser: db
      .prepare("SELECT COUNT(*) AS count FROM equipment WHERE status = ?")
      .get(STATUS.WITH_USER).count,
    repair: db
      .prepare("SELECT COUNT(*) AS count FROM equipment WHERE status = ?")
      .get(STATUS.REPAIR).count,
    writtenOff: db
      .prepare("SELECT COUNT(*) AS count FROM equipment WHERE status = ?")
      .get(STATUS.WRITTEN_OFF).count,
  };
}

function updateEquipmentFull(data) {
  return updateEquipmentStatus(data);
}

module.exports = {
  clearHolder,
  createEquipment,
  deleteEquipmentById,
  findEquipmentById,
  findEquipmentBySerial,
  getAllEquipment,
  getEquipmentStats,
  searchEquipment,
  updateEquipmentDetails,
  updateEquipmentFull,
  updateEquipmentStatus,
};
