'use strict';

const {
  atomicStatusChange,
  countEquipment,
  createEquipment,
  deleteEquipmentById,
  findEquipmentById,
  findEquipmentBySerial,
  getAllEquipment,
  getDistinctCategories,
  getEquipmentByCategoryName,
  getEquipmentPage,
  updateEquipmentDetails,
} = require('../repositories/equipment.repo');
const { STATUS } = require('../utils/constants');

// 60-second in-process cache — avoids a full table scan on every catchAll message
const _catCache = { value: null, expiresAt: 0 };
const CATEGORIES_TTL_MS = 60_000;

function invalidateCategoriesCache() {
  _catCache.value = null;
}

async function listAllEquipment() {
  return getAllEquipment();
}

async function listEquipmentPaged({ page = 0, limit = 20 } = {}) {
  const offset = page * limit;
  const [items, total] = await Promise.all([
    getEquipmentPage(limit, offset),
    countEquipment(),
  ]);
  return { items, total, page, limit, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

async function listCategories() {
  const now = Date.now();
  if (_catCache.value && now < _catCache.expiresAt) return _catCache.value;
  const cats = await getDistinctCategories();
  _catCache.value    = cats;
  _catCache.expiresAt = now + CATEGORIES_TTL_MS;
  return cats;
}

async function listEquipmentByCategory(categoryName) {
  return getEquipmentByCategoryName(categoryName);
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
    const result = await createEquipment({ ...data, status: STATUS.IN_STOCK });
    invalidateCategoriesCache();
    return result;
  } catch (err) {
    if (err.message && err.code === '23505') throw new Error('DUPLICATE_SERIAL');
    throw err;
  }
}

async function updateEquipment(id, data) {
  await updateEquipmentDetails({ id, ...data });
  if (data.category !== undefined) invalidateCategoriesCache();
  return findEquipmentById(id);
}

async function removeEquipment(id) {
  await deleteEquipmentById(id);
  invalidateCategoriesCache();
}

async function giveEquipmentToUser(equipment, userId) {
  try {
    await atomicStatusChange(
      { id: equipment.id, status: STATUS.WITH_USER, current_holder_user_id: userId, current_issue_date: new Date().toISOString(), warehouse: null },
      { equipment_id: equipment.id, action: 'выдано', from_status: STATUS.IN_STOCK, to_status: STATUS.WITH_USER, to_user_id: userId, performed_by_user_id: userId },
    );
  } catch (err) {
    if (err.code === 'STATUS_CONFLICT') throw Object.assign(new Error('Оборудование уже недоступно.'), { code: 'STATUS_CONFLICT' });
    throw err;
  }
  return findEquipmentById(equipment.id);
}

function wrapStatusConflict(err) {
  if (err.code === 'STATUS_CONFLICT') return Object.assign(new Error('Статус оборудования изменился. Обновите карточку.'), { code: 'STATUS_CONFLICT' });
  return err;
}

async function returnEquipmentFromUser(equipment, userId, warehouse) {
  try {
    await atomicStatusChange(
      {
        id: equipment.id,
        status: STATUS.IN_STOCK,
        current_holder_user_id: null,
        current_issue_date: null,
        warehouse: warehouse || 'Ташкент',
      },
      {
        equipment_id: equipment.id,
        action: 'возвращено',
        from_status: STATUS.WITH_USER,
        to_status: STATUS.IN_STOCK,
        from_user_id: userId,
        performed_by_user_id: userId,
      },
    );
  } catch (err) { throw wrapStatusConflict(err); }
  return findEquipmentById(equipment.id);
}

async function startRepair(equipment, performedByUserId, comment) {
  try {
    await atomicStatusChange(
      { id: equipment.id, status: STATUS.REPAIR, current_holder_user_id: null, current_issue_date: null, warehouse: null },
      { equipment_id: equipment.id, action: 'в ремонт', from_status: equipment.status, to_status: STATUS.REPAIR, from_user_id: equipment.current_holder_user_id, performed_by_user_id: performedByUserId, comment: comment || null },
    );
  } catch (err) { throw wrapStatusConflict(err); }
  return findEquipmentById(equipment.id);
}

async function completeRepair(equipment, performedByUserId) {
  try {
    await atomicStatusChange(
      { id: equipment.id, status: STATUS.IN_STOCK, current_holder_user_id: null, current_issue_date: null },
      { equipment_id: equipment.id, action: 'из ремонта', from_status: STATUS.REPAIR, to_status: STATUS.IN_STOCK, performed_by_user_id: performedByUserId },
    );
  } catch (err) { throw wrapStatusConflict(err); }
  return findEquipmentById(equipment.id);
}

async function writeOffEquipment(equipment, performedByUserId, comment) {
  try {
    await atomicStatusChange(
      { id: equipment.id, status: STATUS.WRITTEN_OFF, current_holder_user_id: null, current_issue_date: null, warehouse: null },
      { equipment_id: equipment.id, action: 'списано', from_status: equipment.status, to_status: STATUS.WRITTEN_OFF, from_user_id: equipment.current_holder_user_id, performed_by_user_id: performedByUserId, comment: comment || null },
    );
  } catch (err) { throw wrapStatusConflict(err); }
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
  invalidateCategoriesCache,
  listAllEquipment,
  listCategories,
  listEquipmentByCategory,
  listEquipmentPaged,
  removeEquipment,
  returnEquipmentFromUser,
  startRepair,
  updateEquipment,
  writeOffEquipment,
};
