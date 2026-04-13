const db = require("../../db/index.js");
const logger = require("../../utils/logger.js");

const HINTABLE_FIELDS = new Set([
  "category",
  "brand",
  "model",
  "inventory_number",
  "purchase_date",
]);

function normalizeHintValue(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized || normalized === "-" || normalized === "—") {
    return null;
  }

  return normalized;
}

// ❌ больше ничего не запоминаем
function rememberEquipmentHint() {}
function rememberEquipmentHints() {}

function getSuggestionsFromDb(field) {
  if (!HINTABLE_FIELDS.has(field)) {
    return [];
  }

  try {
    return db
      .prepare(
        `SELECT DISTINCT ${field} 
         FROM equipment 
         WHERE ${field} IS NOT NULL AND ${field} != ''
         ORDER BY updated_at DESC
         LIMIT 6`
      )
      .all()
      .map((row) => row[field])
      .filter(Boolean);
  } catch (e) {
    logger.error("Hints DB error:", { err: e.message });
    return [];
  }
}

function buildSuggestionsKeyboard(field) {
  const suggestions = getSuggestionsFromDb(field);

  if (!suggestions.length) {
    return null;
  }

  return {
    reply_markup: {
      keyboard: suggestions.slice(0, 4).map((value) => [value]),
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

function getEquipmentSuggestionText(field, baseText) {
  const keyboard = buildSuggestionsKeyboard(field);

  if (!keyboard) {
    return {
      text: baseText,
      options: undefined,
    };
  }

  return {
    text: `${baseText}\n\nМожно выбрать из подсказок ниже или ввести вручную.`,
    options: keyboard,
  };
}

function normalizeOptionalValue(text) {
  const value = String(text ?? "").trim();

  if (!value || value === "-" || value === "—") {
    return null;
  }

  return value;
}

module.exports = {
  rememberEquipmentHint,
  rememberEquipmentHints,
  buildSuggestionsKeyboard,
  getEquipmentSuggestionText,
  normalizeOptionalValue,
};