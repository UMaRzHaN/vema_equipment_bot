'use strict';

/**
 * Circuit Breaker — защита от каскадных отказов.
 *
 * Состояния:
 *   CLOSED   → нормальная работа; накапливает failures
 *   OPEN     → быстрый отказ; не вызывает fn() вообще
 *   HALF_OPEN → пробный запрос; success → CLOSED, failure → OPEN
 *
 * Trade-off: простота реализации vs библиотека (cockatiel, opossum).
 * Своя реализация — 0 зависимостей, полный контроль над метриками.
 */

const logger = require('../utils/logger');

const STATE = Object.freeze({
  CLOSED:    'CLOSED',
  OPEN:      'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

class CircuitBreaker {
  /**
   * @param {string} name         Имя для логов/метрик (e.g. 'postgres', 'redis')
   * @param {object} opts
   * @param {number} opts.threshold    Кол-во consecutive failures → OPEN (default: 5)
   * @param {number} opts.timeout      Мс в OPEN до попытки HALF_OPEN (default: 30_000)
   * @param {number} opts.halfOpenMax  Параллельных запросов в HALF_OPEN (default: 1)
   */
  constructor(name, { threshold = 5, timeout = 30_000, halfOpenMax = 1 } = {}) {
    this.name         = name;
    this.threshold    = threshold;
    this.timeout      = timeout;
    this.halfOpenMax  = halfOpenMax;

    this._state       = STATE.CLOSED;
    this._failures    = 0;
    this._openedAt    = null;
    this._halfOpenReqs = 0;
  }

  get state() { return this._state; }

  /**
   * Выполняет fn() через circuit breaker.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   * @throws {CircuitOpenError} если цепь разомкнута
   */
  async execute(fn) {
    this._maybeTransitionToHalfOpen();

    if (this._state === STATE.OPEN) {
      const err = new CircuitOpenError(this.name);
      logger.warn({ circuit: this.name, state: STATE.OPEN }, 'Circuit OPEN — fast fail');
      throw err;
    }

    if (this._state === STATE.HALF_OPEN) {
      if (this._halfOpenReqs >= this.halfOpenMax) {
        throw new CircuitOpenError(this.name);
      }
      this._halfOpenReqs++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    } finally {
      if (this._state === STATE.HALF_OPEN) {
        this._halfOpenReqs = Math.max(0, this._halfOpenReqs - 1);
      }
    }
  }

  _onSuccess() {
    if (this._state === STATE.HALF_OPEN) {
      logger.info({ circuit: this.name }, 'Circuit HALF_OPEN → CLOSED (probe succeeded)');
    }
    this._state    = STATE.CLOSED;
    this._failures = 0;
    this._openedAt = null;
  }

  _onFailure(err) {
    this._failures++;

    if (this._state === STATE.HALF_OPEN) {
      // Probe failed — back to OPEN
      logger.warn(
        { circuit: this.name, err: err.message },
        'Circuit HALF_OPEN → OPEN (probe failed)',
      );
      this._trip();
      return;
    }

    if (this._failures >= this.threshold) {
      logger.error(
        { circuit: this.name, failures: this._failures, err: err.message },
        `Circuit CLOSED → OPEN (${this._failures} consecutive failures)`,
      );
      this._trip();
    }
  }

  _trip() {
    this._state    = STATE.OPEN;
    this._openedAt = Date.now();
  }

  _maybeTransitionToHalfOpen() {
    if (
      this._state === STATE.OPEN &&
      this._openedAt !== null &&
      Date.now() - this._openedAt >= this.timeout
    ) {
      logger.info(
        { circuit: this.name, timeoutMs: this.timeout },
        'Circuit OPEN → HALF_OPEN (timeout elapsed, probing…)',
      );
      this._state        = STATE.HALF_OPEN;
      this._halfOpenReqs = 0;
    }
  }

  /** Принудительно сбросить в CLOSED (для тестов / оператора) */
  reset() {
    this._state    = STATE.CLOSED;
    this._failures = 0;
    this._openedAt = null;
    logger.info({ circuit: this.name }, 'Circuit manually reset to CLOSED');
  }

  toJSON() {
    return {
      name:    this.name,
      state:   this._state,
      failures: this._failures,
      openedAt: this._openedAt,
    };
  }
}

class CircuitOpenError extends Error {
  constructor(circuitName) {
    super(`Circuit '${circuitName}' is OPEN — request rejected`);
    this.name    = 'CircuitOpenError';
    this.code    = 'CIRCUIT_OPEN';
    this.circuit = circuitName;
  }
}

module.exports = { CircuitBreaker, CircuitOpenError, STATE };
