'use strict';

const {
  getEquipmentHistory,
  getLastActionDate,
  getLastRepairComment,
  getOverdueEquipment,
} = require('../repositories/history.repo');

async function getEquipmentTimeline(equipmentId) {
  const [lastIssueDate, lastReturnDate, lastRepairDate] = await Promise.all([
    getLastActionDate(equipmentId, ['выдано']),
    getLastActionDate(equipmentId, ['возвращено']),
    getLastActionDate(equipmentId, ['из ремонта']),
  ]);
  return { lastIssueDate, lastReturnDate, lastRepairDate };
}

async function getFullEquipmentHistory(equipmentId, limit = 10) {
  return getEquipmentHistory(equipmentId, limit);
}

async function findOverdueEquipment(thresholdDays = 7) {
  return getOverdueEquipment(thresholdDays);
}

module.exports = {
  findOverdueEquipment,
  getEquipmentTimeline,
  getFullEquipmentHistory,
  getLastRepairComment,
};
