'use strict';

const { query } = require('../db');

async function findUserByTelegramId(telegramId) {
  const result = await query(
    'SELECT * FROM users WHERE telegram_user_id = $1',
    [telegramId],
  );
  return result.rows[0] || null;
}

async function upsertTelegramUser(user) {
  await query(
    `INSERT INTO users (telegram_user_id, username, first_name, last_name, phone, created_at)
     VALUES ($1, $2, $3, $4, NULL, NOW())
     ON CONFLICT (telegram_user_id) DO UPDATE
       SET username = EXCLUDED.username`,
    [user.id, user.username || null, user.first_name || null, user.last_name || null],
  );
}

async function updateUserProfile(telegramId, data) {
  const allowed = ['first_name', 'last_name', 'phone'];
  const parts = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      parts.push(`${key} = $${idx++}`);
      values.push(data[key]);
    }
  }

  if (!parts.length) throw new Error('No profile fields to update');

  values.push(telegramId);
  await query(
    `UPDATE users SET ${parts.join(', ')} WHERE telegram_user_id = $${idx}`,
    values,
  );
}

async function setUserRole(telegramUserId, role) {
  await query(
    'UPDATE users SET role = $1 WHERE telegram_user_id = $2',
    [role, telegramUserId],
  );
}

async function getAllUsers({ limit = 20, offset = 0 } = {}) {
  const result = await query(
    'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return result.rows;
}

async function countUsers() {
  const result = await query('SELECT COUNT(*) AS cnt FROM users');
  return Number(result.rows[0].cnt);
}

module.exports = { countUsers, findUserByTelegramId, getAllUsers, setUserRole, upsertTelegramUser, updateUserProfile };
