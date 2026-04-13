const {
  findUserByTelegramId,
  upsertTelegramUser,
  updateUserProfile,
} = require("../repositories/user.repo");

function saveTelegramUser(from, createdAt) {
  return upsertTelegramUser(from, createdAt);
}

function saveUser({ telegramId, firstName, lastName, phone }) {
  const existing = findUserByTelegramId(telegramId);

  // Если записи ещё нет, создаём её
  if (!existing) {
    upsertTelegramUser(
      {
        id: telegramId,
        username: null,
        first_name: firstName || null,
        last_name: lastName || null,
      },
      new Date().toISOString(),
    );
  }

  const data = {};
  if (firstName !== undefined) data.first_name = firstName;
  if (lastName !== undefined) data.last_name = lastName;
  if (phone !== undefined) data.phone = phone;

  return updateUserProfile(telegramId, data);
}

function getUserByTelegramId(telegramId) {
  return findUserByTelegramId(telegramId);
}

function isUserProfileComplete(user) {
  return !!(user && user.first_name && user.last_name && user.phone);
}

function formatUser(user) {
  if (!user) return "—";
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  if (user.username) return `@${user.username}`;
  return String(user.telegram_user_id);
}

module.exports = {
  formatUser,
  saveTelegramUser,
  saveUser,
  getUserByTelegramId,
  isUserProfileComplete,
};