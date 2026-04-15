"use strict";

const { findEquipmentById } = require("../../services/equipment.service");
const { LABELS } = require("../constants/labels");
const { ACTIONS } = require("../constants/actions");

/**
 * Извлекает ID оборудования из callback_data.
 * @param {RegExpMatchArray} match — результат ctx.match
 * @returns {number|null}
 */
function parseEquipmentId(match) {
  if (!match || !match[1]) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Middleware для валидации ID оборудования.
 * Прерывает выполнение если ID невалиден или оборудование не найдено.
 * Устанавливает ctx.equipmentId и ctx.equipmentItem при успехе.
 */
function equipmentIdMiddleware(actionType, fetchItem = true) {
  return async (ctx, next) => {
    const id = parseEquipmentId(ctx.match);
    if (!id) {
      await ctx.answerCbQuery(LABELS.ERR_INVALID_ID, { show_alert: true });
      return;
    }

    if (!fetchItem) {
      ctx.equipmentId = id;
      return next();
    }

    const item = await findEquipmentById(id);
    if (!item) {
      await ctx.answerCbQuery(LABELS.ERR_NOT_FOUND, { show_alert: true });
      return;
    }

    ctx.equipmentId = id;
    ctx.equipmentItem = item;
    return next();
  };
}

/**
 * Фабрика middleware с lock для операций.
 * @param {string} lockPrefix — префикс ключа блокировки (напр. 'give', 'return')
 * @param {Function} action — async функция-действие
 * @returns {Function} middleware
 */
function withLock(lockPrefix, action) {
  return async (ctx, next) => {
    const { redis } = require("../../redis");
    const lockKey = `lock:${lockPrefix}:${ctx.equipmentId}`;

    const locked = await redis.set(lockKey, "1", "NX", "PX", 3000);
    if (!locked) {
      await ctx.answerCbQuery(LABELS.ERR_ACTION_IN_PROGRESS, {
        show_alert: true,
      });
      return;
    }

    try {
      return await action(ctx, next);
    } finally {
      await redis.del(lockKey);
    }
  };
}

/**
 * Проверка прав администратора.
 */
function requireAdmin(ctx) {
  const { isAdmin } = require("../config");
  const { getUserByTelegramId } = require("../../services/user.service");
  return isAdmin(ctx);
}

module.exports = {
  parseEquipmentId,
  equipmentIdMiddleware,
  withLock,
  requireAdmin,
};
