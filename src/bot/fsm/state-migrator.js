'use strict';

/**
 * FSM Session State Migrator.
 *
 * Проблема: при деплое с изменённой схемой сессии старые сессии в Redis
 * могут вызывать ошибки или некорректное поведение.
 *
 * Решение: при загрузке каждой сессии прогоняем её через цепочку миграций.
 * Каждая миграция имеет вид:
 *   { from: number, to: number, migrate: (session) => session }
 *
 * Текущая версия схемы: CURRENT_SCHEMA_VERSION
 * Если в сессии нет schemaVersion, считаем её v0 и мигрируем до current.
 *
 * Trade-off: миграция происходит при загрузке сессии, пока не встретится
 * актуальная версия. После миграции сессия сохраняется уже с новой версией.
 * Это позволяет деплоить изменения без простоя: старые сессии не ломаются,
 * а плавно обновляются.
 *
 * Добавление новой миграции:
 * 1. Увеличить CURRENT_SCHEMA_VERSION
 * 2. Добавить объект в MIGRATIONS: { from: N-1, to: N, migrate: fn }
 * 3. migrate(session) должна возвращать новую версию сессии
 */

const logger = require('../../utils/logger');

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Цепочка миграций. Применяется последовательно.
 * @type {Array<{from: number, to: number, migrate: (s: object) => object}>}
 */
const MIGRATIONS = [
  {
    from: 0,
    to: 1,
    /**
     * v0 -> v1:
     * - добавляем schemaVersion в сессию
     * - нормализуем flow.version
     * - сбрасываем flow с неизвестным типом
     */
    migrate(session) {
      const migrated = {
        flow: session.flow ?? null,
        mode: session.mode ?? null,
        listPage: session.listPage ?? 0,
        summaryPage: session.summaryPage ?? 0,
        userRole: session.userRole ?? undefined,
      };

      if (migrated.flow && typeof migrated.flow === 'object') {
        migrated.flow = {
          ...migrated.flow,
          version: migrated.flow.version ?? 1,
          startedAt: migrated.flow.startedAt ?? Date.now(),
        };

        const VALID_FLOW_TYPES = new Set([
          'add_equipment',
          'edit_equipment',
          'give_duration',
          'give_components',
          'repair',
          'writeoff',
          'register_profile',
          'edit_profile',
          'assign_role',
          'return_location',
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
  //   to: 2,
  //   migrate(session) {
  //     return { ...session, newField: defaultValue };
  //   },
  // },
];

/**
 * Мигрирует сессию до CURRENT_SCHEMA_VERSION.
 * Если сессия уже актуальна, возвращает её без изменений.
 *
 * @param {object} session Сырая сессия из Redis
 * @returns {object|null} Мигрированная сессия или null при сбое
 */
function migrateSession(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  let current = session;
  let version = current.schemaVersion ?? 0;

  if (version === CURRENT_SCHEMA_VERSION) {
    return current;
  }

  const migrations = MIGRATIONS
    .filter((migration) => migration.from >= version && migration.from < CURRENT_SCHEMA_VERSION)
    .sort((a, b) => a.from - b.from);

  for (const migration of migrations) {
    try {
      current = migration.migrate(current);
      version = migration.to;
      logger.debug(
        { fromVersion: migration.from, toVersion: migration.to },
        'FSM session migrated',
      );
    } catch (err) {
      logger.error(
        { fromVersion: migration.from, toVersion: migration.to, err: err.message },
        'FSM migration failed, resetting session',
      );
      return null;
    }
  }

  current.schemaVersion = CURRENT_SCHEMA_VERSION;
  return current;
}

module.exports = { migrateSession, CURRENT_SCHEMA_VERSION };
