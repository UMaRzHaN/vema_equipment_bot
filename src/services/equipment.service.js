'use strict';

const {
  atomicStatusChange,
  createEquipment,
  deleteEquipmentById,
  findEquipmentById,
  findEquipmentBySerial,
  getAllEquipment,
  updateEquipmentDetails,
} = require('../repositories/equipment.repo');
const { STATUS } = require('../utils/constants');

async function listAllEquipment() {
  return getAllEquipment();
}

async function listCategories() {
  const items = await listAllEquipment();
  const set = new Set(items.map((item) => item.category || 'Без категории'));
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}

async function listEquipmentByCategory(categoryName) {
  const items = await listAllEquipment();
  return items.filter((item) => (item.category || 'Без категории') === categoryName);
}

async function getEquipmentStats(items) {
  const all = items ?? (await listAllEquipment());
  const stats = {
    total: all.length,
    inStock: 0,
    withUser: 0,
    repair: 0,
    writtenOff: 0,
    byCategory: new Map(),
  };

  for (const item of all) {
    if (item.status === STATUS.IN_STOCK)    stats.inStock    += 1;
    else if (item.status === STATUS.WITH_USER)  stats.withUser   += 1;
    else if (item.status === STATUS.REPAIR)     stats.repair     += 1;
    else if (item.status === STATUS.WRITTEN_OFF) stats.writtenOff += 1;

    const cat = item.category || 'Без категории';
    const cs = stats.byCategory.get(cat) || { total: 0, inStock: 0, withUser: 0, repair: 0, writtenOff: 0 };
    cs.total += 1;
    if (item.status === STATUS.IN_STOCK)    cs.inStock    += 1;
    else if (item.status === STATUS.WITH_USER)  cs.withUser   += 1;
    else if (item.status === STATUS.REPAIR)     cs.repair     += 1;
    else if (item.status === STATUS.WRITTEN_OFF) cs.writtenOff += 1;
    stats.byCategory.set(cat, cs);
  }
  return stats;
}

async function addEquipment(data) {
  try {
    return await createEquipment({ ...data, status: STATUS.IN_STOCK });
  } catch (err) {
    if (err.message && err.code === '23505') throw new Error('DUPLICATE_SERIAL');
    throw err;
  }
}

async function updateEquipment(id, data) {
  await updateEquipmentDetails({ id, ...data });
  return findEquipmentById(id);
}

async function removeEquipment(id) {
  await deleteEquipmentById(id);
}

async function giveEquipmentToUser(equipment, userId) {
  await atomicStatusChange(
    { id: equipment.id, status: STATUS.WITH_USER, current_holder_user_id: userId, current_issue_date: new Date().toISOString() },
    { equipment_id: equipment.id, action: 'выдано', from_status: STATUS.IN_STOCK, to_status: STATUS.WITH_USER, to_user_id: userId, performed_by_user_id: userId },
  );
  return findEquipmentById(equipment.id);
}

async function returnEquipmentFromUser(equipment, userId) {
  await atomicStatusChange(
    { id: equipment.id, status: STATUS.IN_STOCK, current_holder_user_id: null, current_issue_date: null },
    { equipment_id: equipment.id, action: 'возвращено', from_status: STATUS.WITH_USER, to_status: STATUS.IN_STOCK, from_user_id: userId, performed_by_user_id: userId },
  );
  return findEquipmentById(equipment.id);
}

async function startRepair(equipment, performedByUserId, comment) {
  await atomicStatusChange(
    { id: equipment.id, status: STATUS.REPAIR, current_holder_user_id: null, current_issue_date: null },
    { equipment_id: equipment.id, action: 'в ремонт', from_status: equipment.status, to_status: STATUS.REPAIR, from_user_id: equipment.current_holder_user_id, performed_by_user_id: performedByUserId, comment: comment || null },
  );
  return findEquipmentById(equipment.id);
}

async function completeRepair(equipment, performedByUserId) {
  await atomicStatusChange(
    { id: equipment.id, status: STATUS.IN_STOCK, current_holder_user_id: null, current_issue_date: null },
    { equipment_id: equipment.id, action: 'из ремонта', from_status: STATUS.REPAIR, to_status: STATUS.IN_STOCK, performed_by_user_id: performedByUserId },
  );
  return findEquipmentById(equipment.id);
}

async function writeOffEquipment(equipment, performedByUserId, comment) {
  await atomicStatusChange(
    { id: equipment.id, status: STATUS.WRITTEN_OFF, current_holder_user_id: null, current_issue_date: null },
    { equipment_id: equipment.id, action: 'списано', from_status: equipment.status, to_status: STATUS.WRITTEN_OFF, from_user_id: equipment.current_holder_user_id, performed_by_user_id: performedByUserId, comment: comment || null },
  );
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
  writeOffEquipment,
};
