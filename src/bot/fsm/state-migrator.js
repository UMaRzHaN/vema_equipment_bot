'use strict';

/**
 * FSM Session State Migrator.
 *
 * Проблема: при деплое с изменённой схемой сессии старые сессии в Redis
 * могут вызывать ошибки или некорректное поведение.
 *
 * Решение: при загрузке каждой сессии прогоняем через цепочку миграций.
 * Каждая миграция: { from: number, to: number, migrate: (session) => session }
 *
 * Текущая схема версии: CURRENT_SCHEMA_VERSION
 * Если сессия не имеет schemaVersion → считаем v0, мигрируем до CURRENT.
 *
 * Trade-off: миграция происходит при каждой загрузке сессии пока не
 * встретится актуальная версия. После миграции сессия сохраняется с новой версией.
 * Это делает деплой zero-downtime: старые сессии не ломаются, а плавно мигрируют.
 *
 * Добавление новой миграции:
 *   1. Увеличь CURRENT_SCHEMA_VERSION
 *   2. Добавь объект в MIGRATIONS: { from: N-1, to: N, migrate: fn }
 *   3. migrate(session) должна возвращать новую версию сессии
 */

const logger = require('../../utils/logger');

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Цепочка миграций. Применяются последовательно.
 * @type {Array<{from: number, to: number, migrate: (s: object) => object}>}
 */
const MIGRATIONS = [
  {
    from: 0,
    to:   1,
    /**
     * v0 → v1: добавляем schemaVersion к сессии.
     * До v1 сессии не имели schemaVersion вообще.
     * Также нормализуем flow.version: если flow существует, убеждаемся что version = 1.
     */
    migrate(session) {
      const migrated = {
        flow:        session.flow        ?? null,
        mode:        session.mode        ?? null,
        listPage:    session.listPage    ?? 0,
        summaryPage: session.summaryPage ?? 0,
        userRole:    session.userRole    ?? undefined,
      };

      // Нормализуем flow если он есть
      if (migrated.flow && typeof migrated.flow === 'object') {
        migrated.flow = {
          ...migrated.flow,
          version:   migrated.flow.version ?? 1,
          startedAt: migrated.flow.startedAt ?? Date.now(),
        };

        // Сбрасываем flow с неизвестным типом — лучше потерять шаг чем сломать хендлер
        const VALID_FLOW_TYPES = new Set([
          'add_equipment', 'edit_equipment', 'repair', 'writeoff',
          'register_profile', 'edit_profile', 'assign_role',
        ]);
        if (migrated.flow.type && !VALID_FLOW_TYPES.has(migrated.flow.type)) {
          logger.warn({ flowType: migrated.flow.type }, 'FSM migration: unknown flow type, resetting');
          migrated.flow = null;
        }
      }

      return migrated;
    },
  },

  // Шаблон для следующей миграции:
  // {
  //   from: 1,
  //   to:   2,
  //   migrate(session) {
  //     // Transform session from v1 to v2
  //     return { ...session, newField: defaultValue };
  //   },
  // },
];

/**
 * Мигрирует сессию до CURRENT_SCHEMA_VERSION.
 * Если сессия уже актуальна — возвращает без изменений (O(1)).
 *
 * @param {object} session  Сырая сессия из Redis
 * @returns {object}        Мигрированная сессия
 */
function migrateSession(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  let current = session;
  let version = current.schemaVersion ?? 0;

  if (version === CURRENT_SCHEMA_VERSION) {
    // Горячий путь — большинство сессий уже актуальны
    return current;
  }

  // Нужна миграция
  const migrations = MIGRATIONS.filter(
    (m) => m.from >= version && m.from < CURRENT_SCHEMA_VERSION,
  ).sort((a, b) => a.from - b.from);

  for (const m of migrations) {
    try {
      current = m.migrate(current);
      version = m.to;
      logger.debug(
        { fromVersion: m.from, toVersion: m.to },
        'FSM session migrated',
      );
    } catch (err) {
      logger.error(
        { fromVersion: m.from, toVersion: m.to, err: err.message },
        'FSM migration failed — resetting session',
      );
      return null; // Вернём null → session.middleware вернёт defaultSession()
    }
  }

  current.schemaVersion = CURRENT_SCHEMA_VERSION;
  return current;
}

module.exports = { migrateSession, CURRENT_SCHEMA_VERSION };
