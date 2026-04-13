const { STATUS } = require("./constants");

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status) {
  switch (status) {
    case STATUS.IN_STOCK:
      return "На складе";
    case STATUS.WITH_USER:
      return "У пользователя";
    case STATUS.REPAIR:
      return "В ремонте";
    case STATUS.WRITTEN_OFF:
      return "Списано";
    default:
      return status || "-";
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function padString(value, width) {
  const text = String(value ?? "-")
    .trim()
    .replace(/\s+/g, " ");

  if (text.length > width) {
    return `${text.slice(0, width - 1)}…`;
  }

  return text.padEnd(width, " ");
}

function csvEscape(value) {
  const text = String(value ?? "").replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
}

module.exports = {
  csvEscape,
  escapeHtml,
  formatDate,
  padString,
  statusLabel,
};
