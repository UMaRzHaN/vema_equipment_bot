'use strict';

const {
  countUsers,
  deleteUserByTelegramId,
  findUserByTelegramId,
  findUsersByTelegramIds,
  getAllUsers,
  hasActiveEquipment,
  setUserApprovalStatus,
  setUserBanStatus,
  setUserRole,
  upsertTelegramUser,
  updateUserProfile,
} = require('../repositories/user.repo');

async function saveTelegramUser(from) {
  return upsertTelegramUser(from);
}

async function saveUser({ telegramId, firstName, lastName, phone }) {
  const existing = await findUserByTelegramId(telegramId);

  if (!existing) {
    await upsertTelegramUser({
      id: telegramId,
      username: null,
      first_name: firstName || null,
      last_name: lastName || null,
    });
  }

  const data = {};
  if (firstName !== undefined) data.first_name = firstName;
  if (lastName !== undefined) data.last_name = lastName;
  if (phone !== undefined) data.phone = phone;

  await updateUserProfile(telegramId, data);
}

async function getUserByTelegramId(telegramId) {
  return findUserByTelegramId(telegramId);
}

async function getUsersByTelegramIds(telegramIds) {
  const users = await findUsersByTelegramIds(telegramIds);
  return new Map(users.map((u) => [String(u.telegram_user_id), u]));
}

function isUserProfileComplete(user) {
  return !!(user && user.first_name && user.last_name && user.phone);
}

function isUserBanned(user) {
  return Boolean(user?.is_banned);
}

function isUserApproved(user) {
  return Boolean(user?.is_approved);
}

function formatUser(user) {
  if (!user) return '-';
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (user.username) return `@${user.username}`;
  return String(user.telegram_user_id);
}

async function listAllUsersPaged({ page = 0, limit = 5 } = {}) {
  const offset = page * limit;
  const [users, total] = await Promise.all([
    getAllUsers({ limit, offset }),
    countUsers(),
  ]);
  return { users, total, page, limit, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

async function assignUserRole(telegramUserId, role) {
  await setUserRole(telegramUserId, role);
}

async function setUserBanned(telegramUserId, isBanned) {
  await setUserBanStatus(telegramUserId, isBanned);
}

async function setUserApproved(telegramUserId, isApproved) {
  await setUserApprovalStatus(telegramUserId, isApproved);
}

async function deleteUserAccount(telegramUserId) {
  const active = await hasActiveEquipment(telegramUserId);
  if (active) {
    throw Object.assign(
      new Error('Верните все оборудование перед удалением профиля.'),
      { code: 'HAS_EQUIPMENT' },
    );
  }
  await deleteUserByTelegramId(telegramUserId);
}

module.exports = {
  assignUserRole,
  deleteUserAccount,
  formatUser,
  getUserByTelegramId,
  getUsersByTelegramIds,
  isUserApproved,
  isUserBanned,
  isUserProfileComplete,
  listAllUsersPaged,
  saveTelegramUser,
  saveUser,
  setUserApproved,
  setUserBanned,
};
