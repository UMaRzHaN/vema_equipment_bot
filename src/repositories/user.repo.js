const db = require("../db");

function findUserByTelegramId(telegramId) {
  return db
    .prepare(
      `
        SELECT *
        FROM users
        WHERE telegram_user_id = ?
      `,
    )
    .get(telegramId);
}

function upsertTelegramUser(user, createdAt) {
  return db
    .prepare(
      `
        INSERT INTO users (
          telegram_user_id,
          username,
          first_name,
          last_name,
          phone,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_user_id) DO UPDATE SET
          username = excluded.username
      `,
    )
    .run(
      user.id,
      user.username || null,
      user.first_name || null,
      user.last_name || null,
      null,
      createdAt,
    );
}

function updateUserProfile(telegramId, data) {
  const allowed = ["first_name", "last_name", "phone"];
  const parts = [];
  const values = [];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      parts.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (!parts.length) {
    throw new Error("No profile fields to update");
  }

  values.push(telegramId);

  return db
    .prepare(
      `
        UPDATE users
        SET ${parts.join(", ")}
        WHERE telegram_user_id = ?
      `,
    )
    .run(...values);
}

module.exports = {
  findUserByTelegramId,
  updateUserProfile,
  upsertTelegramUser,
};
