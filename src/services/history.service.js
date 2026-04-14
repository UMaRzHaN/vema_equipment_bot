const {
  addHistory,
  getEquipmentHistory,
  getLastActionDate,
  getLastRepairComment,
  getOverdueEquipment,
  getRecentHistory,
} = require("../repositories/history.repo");

function recordHistory(entry) {
  return addHistory(entry);
}

function getEquipmentTimeline(equipmentId) {
  return {
    lastIssueDate: getLastActionDate(equipmentId, ["выдано"]),
    lastReturnDate: getLastActionDate(equipmentId, ["возвращено"]),
    lastRepairDate: getLastActionDate(equipmentId, ["из ремонта"]),
  };
}

function getFullEquipmentHistory(equipmentId, limit = 10) {
  return getEquipmentHistory(equipmentId, limit);
}

function findOverdueEquipment(thresholdDays = 7) {
  return getOverdueEquipment(thresholdDays);
}

module.exports = {
  findOverdueEquipment,
  getEquipmentTimeline,
  getFullEquipmentHistory,
  getLastRepairComment,
  getRecentHistory,
  recordHistory,
};
