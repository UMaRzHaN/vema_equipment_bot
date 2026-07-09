'use strict';

const {
  getEquipmentHistory,
  getEquipmentTimelinesBatch,
  getLastActionDate,
  getLastRepairComment,
  getLastRepairCommentsBatch,
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

async function getFullEquipmentHistory(equipmentId, options = 10) {
  return getEquipmentHistory(equipmentId, options);
}

async function findOverdueEquipment(thresholdDays = 7) {
  return getOverdueEquipment(thresholdDays);
}

module.exports = {
  findOverdueEquipment,
  getEquipmentTimeline,
  getEquipmentTimelinesBatch,
  getFullEquipmentHistory,
  getLastRepairComment,
  getLastRepairCommentsBatch,
};
