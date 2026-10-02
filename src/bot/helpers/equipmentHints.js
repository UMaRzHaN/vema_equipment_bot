'use strict';

const { getSuggestionsForField } = require('../../repositories/equipment.repo');
const logger = require('../../utils/logger');

// Long hint lists are laid out in two columns so the keyboard stays compact.
const TWO_COLUMN_THRESHOLD = 6;

function chunkRows(values) {
  if (values.length <= TWO_COLUMN_THRESHOLD) return values.map((v) => [v]);
  const rows = [];
  for (let i = 0; i < values.length; i += 2) rows.push(values.slice(i, i + 2));
  return rows;
}

async function buildSuggestionsKeyboard(field, category = null, brand = null) {
  try {
    const suggestions = await getSuggestionsForField(field, category, brand);
    if (!suggestions.length) return null;
    return {
      reply_markup: {
        keyboard: chunkRows(suggestions),
        resize_keyboard: true,
        one_time_keyboard: false,
        selective: true,
      },
    };
  } catch (err) {
    logger.error({ field, category, brand, err: err.message }, 'equipmentHints error');
    return null;
  }
}

async function getEquipmentSuggestionText(field, baseText, category = null, brand = null) {
  const keyboard = await buildSuggestionsKeyboard(field, category, brand);
  if (!keyboard) return { text: baseText, options: undefined };
  return {
    text:    `${baseText}\n\nМожно выбрать из подсказок ниже или ввести вручную.`,
    options: keyboard,
  };
}

function normalizeOptionalValue(text) {
  const value = String(text ?? '').trim();
  if (!value || value === '-' || value === '—') return null;
  return value;
}

// Kept for backward compatibility. No-ops since hints come from DB directly.
function rememberEquipmentHint() {}
function rememberEquipmentHints() {}

module.exports = {
  buildSuggestionsKeyboard,
  getEquipmentSuggestionText,
  normalizeOptionalValue,
  rememberEquipmentHint,
  rememberEquipmentHints,
};
