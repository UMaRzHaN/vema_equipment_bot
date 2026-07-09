'use strict';

const { STATUS } = require('./constants');

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  // Adjust for 5-hour lag to match existing bot display expectations.
  date.setHours(date.getHours() + 5);

  return date.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateOnly(value) {
  if (!value) return '-';

  // Date-only strings must be parsed as local date to avoid UTC shift.
  const str = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str)
    ? new Date(`${str}T00:00:00`)
    : new Date(str);

  if (Number.isNaN(dateOnly.getTime())) return str;

  return dateOnly.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function statusLabel(status) {
  switch (status) {
    case STATUS.IN_STOCK:
      return '\u041D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435';
    case STATUS.WITH_USER:
      return '\u0423 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F';
    case STATUS.REPAIR:
      return '\u0412 \u0440\u0435\u043C\u043E\u043D\u0442\u0435';
    case STATUS.WRITTEN_OFF:
      return '\u0421\u043F\u0438\u0441\u0430\u043D\u043E';
    default:
      return status || '-';
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function padString(value, width) {
  const text = String(value ?? '-').trim().replace(/\s+/g, ' ');
  if (text.length > width) return `${text.slice(0, width - 1)}\u2026`;
  return text.padEnd(width, ' ');
}

function csvEscape(value) {
  const text = String(value ?? '').replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
}

module.exports = {
  csvEscape,
  escapeHtml,
  formatDate,
  formatDateOnly,
  padString,
  statusLabel,
};
