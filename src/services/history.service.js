const {
  addHistory,
  getLastActionDate,
  getLastRepairComment,
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

module.exports = {
  getEquipmentTimeline,
  getLastRepairComment,
  getRecentHistory,
  recordHistory,
};
