const {
  createEquipment,
  deleteEquipmentById,
  findEquipmentById,
  findEquipmentBySerial,
  getAllEquipment,
  updateEquipmentDetails,
  updateEquipmentStatus,
} = require("../repositories/equipment.repo");
const { STATUS } = require("../utils/constants");
const { recordHistory } = require("./history.service");

function listAllEquipment() {
  return getAllEquipment();
}

function listCategories() {
  return [...new Set(listAllEquipment().map((item) => item.category || "Без категории"))].sort(
    (left, right) => left.localeCompare(right, "ru"),
  );
}

function listEquipmentByCategory(categoryName) {
  return listAllEquipment().filter(
    (item) => (item.category || "Без категории") === categoryName,
  );
}

function getEquipmentStats(items = listAllEquipment()) {
  const stats = {
    total: items.length,
    inStock: 0,
    withUser: 0,
    repair: 0,
    byCategory: new Map(),
  };

  for (const item of items) {
    if (item.status === STATUS.IN_STOCK) stats.inStock += 1;
    else if (item.status === STATUS.WITH_USER) stats.withUser += 1;
    else if (item.status === STATUS.REPAIR) stats.repair += 1;

    const categoryName = item.category || "Без категории";
    const categoryStats = stats.byCategory.get(categoryName) || {
      total: 0,
      inStock: 0,
      withUser: 0,
      repair: 0,
    };

    categoryStats.total += 1;
    if (item.status === STATUS.IN_STOCK) categoryStats.inStock += 1;
    else if (item.status === STATUS.WITH_USER) categoryStats.withUser += 1;
    else if (item.status === STATUS.REPAIR) categoryStats.repair += 1;

    stats.byCategory.set(categoryName, categoryStats);
  }

  return stats;
}

function addEquipment(data) {
  return createEquipment(data);
}

function updateEquipment(id, data) {
  return updateEquipmentDetails({ id, ...data });
}

function removeEquipment(id) {
  return deleteEquipmentById(id);
}

function startRepair(equipment, performedByUserId, comment, now) {
  updateEquipmentStatus({
    id: equipment.id,
    status: STATUS.REPAIR,
    current_holder_user_id: null,
    current_issue_date: null,
    updated_at: now,
  });

  recordHistory({
    equipment_id: equipment.id,
    action: "в ремонт",
    from_status: equipment.status,
    to_status: STATUS.REPAIR,
    from_user_id: equipment.current_holder_user_id,
    to_user_id: null,
    performed_by_user_id: performedByUserId,
    comment,
    action_date: now,
  });

  return findEquipmentById(equipment.id);
}

function giveEquipmentToUser(equipment, userId, now) {
  updateEquipmentStatus({
    id: equipment.id,
    status: STATUS.WITH_USER,
    current_holder_user_id: userId,
    current_issue_date: now,
    updated_at: now,
  });

  recordHistory({
    equipment_id: equipment.id,
    action: "выдано",
    from_status: STATUS.IN_STOCK,
    to_status: STATUS.WITH_USER,
    to_user_id: userId,
    performed_by_user_id: userId,
    action_date: now,
  });

  return findEquipmentById(equipment.id);
}

function returnEquipmentFromUser(equipment, userId, now) {
  updateEquipmentStatus({
    id: equipment.id,
    status: STATUS.IN_STOCK,
    current_holder_user_id: null,
    current_issue_date: null,
    updated_at: now,
  });

  recordHistory({
    equipment_id: equipment.id,
    action: "возвращено",
    from_status: STATUS.WITH_USER,
    to_status: STATUS.IN_STOCK,
    from_user_id: userId,
    performed_by_user_id: userId,
    action_date: now,
  });

  return findEquipmentById(equipment.id);
}

function completeRepair(equipment, performedByUserId, now) {
  updateEquipmentStatus({
    id: equipment.id,
    status: STATUS.IN_STOCK,
    current_holder_user_id: null,
    current_issue_date: null,
    updated_at: now,
  });

  recordHistory({
    equipment_id: equipment.id,
    action: "из ремонта",
    from_status: STATUS.REPAIR,
    to_status: STATUS.IN_STOCK,
    performed_by_user_id: performedByUserId,
    action_date: now,
  });

  return findEquipmentById(equipment.id);
}

module.exports = {
  STATUS,
  addEquipment,
  completeRepair,
  findEquipmentById,
  findEquipmentBySerial,
  getEquipmentStats,
  giveEquipmentToUser,
  listAllEquipment,
  listCategories,
  listEquipmentByCategory,
  removeEquipment,
  returnEquipmentFromUser,
  startRepair,
  updateEquipment,
};
