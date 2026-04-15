'use strict';

/**
 * Feature Flag система.
 *
 * Два слоя (приоритет по убыванию):
 *   1. Redis overrides  — оператор меняет флаг без перезапуска (runtime toggle)
 *   2. ENV defaults     — значение при отсутствии Redis override
 *
 * Trade-off: не используем LaunchDarkly/Unleash — нет внешней зависимости.
 * Redis overrides хранятся как строки 'true'/'false' с TTL.
 *
 * Использование:
 *   const { flags } = require('./lib/feature-flags');
 *
 *   if (await flags.isEnabled('EXCEL_REPORTS')) {
 *     // новая функция
 *   }
 *
 * Включить флаг через Redis CLI:
 *   redis-cli SET ff:EXCEL_REPORTS true EX 3600
 *
 * Выключить:
 *   redis-cli SET ff:EXCEL_REPORTS false EX 3600
 *
 * Удалить override (вернуть к ENV default):
 *   redis-cli DEL ff:EXCEL_REPORTS
 */

const logger = require('../utils/logger');

// ─── Defaults (из environment) ────────────────────────────────────────────────
const DEFAULTS = {
  // Безопасность — можно временно отключить при атаке
  RATE_LIMITER:         process.env.FF_RATE_LIMITER         !== 'false',
  REGISTRATION_GUARD:   process.env.FF_REGISTRATION_GUARD   !== 'false',

  // Функциональность — для постепенного rollout
  EXCEL_REPORTS:        process.env.FF_EXCEL_REPORTS        !== 'false',
  IMAGE_REPORTS:        process.env.FF_IMAGE_REPORTS        !== 'false',
  OVERDUE_NOTIFICATIONS: process.env.FF_OVERDUE_NOTIFICATIONS !== 'false',

  // Инфраструктура — для emergency fallback
  REDIS_SESSIONS:       process.env.FF_REDIS_SESSIONS       !== 'false',
  BULLMQ_WORKER:        process.env.FF_BULLMQ_WORKER        !== 'false',

  // Новые фичи в разработке (default: off)
  NEW_USER_FLOW:        process.env.FF_NEW_USER_FLOW        === 'true',
};

const REDIS_KEY_PREFIX = 'ff:';
const CACHE_TTL_MS = 5_000; // Кэшируем Redis ответ на 5s чтобы не бить Redis на каждый апдейт

class FeatureFlags {
  constructor() {
    this._redis  = null;  // Lazy inject — Redis может быть не готов при старте
    this._cache  = new Map(); // { flagName → { value: boolean, expiresAt: number } }
  }

  /** Inject Redis client после инициализации */
  setRedis(redisClient) {
    this._redis = redisClient;
  }

  /**
   * Проверяет флаг.
   * Быстро (< 1ms в кэше), graceful при недоступном Redis.
   *
   * @param {keyof typeof DEFAULTS} name
   * @returns {Promise<boolean>}
   */
  async isEnabled(name) {
    if (!(name in DEFAULTS)) {
      logger.warn({ flag: name }, 'Unknown feature flag — returning false');
      return false;
    }

    // Проверяем кэш
    const cached = this._cache.get(name);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    // Redis override
    if (this._redis) {
      try {
        const raw = await this._redis.get(`${REDIS_KEY_PREFIX}${name}`);
        if (raw !== null) {
          const value = raw === 'true';
          this._cache.set(name, { value, expiresAt: Date.now() + CACHE_TTL_MS });
          return value;
        }
      } catch (err) {
        // Redis недоступен — используем ENV default, не ломаем приложение
        logger.warn({ flag: name, err: err.message }, 'feature-flags: Redis read failed, using ENV default');
      }
    }

    // ENV default
    const value = DEFAULTS[name];
    this._cache.set(name, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /**
   * Синхронная проверка (только ENV default, без Redis).
   * Использовать там, где нельзя await: middleware конструкторы, etc.
   */
  isEnabledSync(name) {
    return DEFAULTS[name] ?? false;
  }

  /** Список всех флагов с текущими ENV defaults */
  getAllDefaults() {
    return { ...DEFAULTS };
  }

  /** Инвалидировать кэш (для тестов) */
  clearCache() {
    this._cache.clear();
  }
}

const flags = new FeatureFlags();

module.exports = { flags, DEFAULTS };
