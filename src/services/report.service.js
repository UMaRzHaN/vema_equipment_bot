const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const PImage = require("pureimage");
const { Writable } = require("stream");
const { getEquipmentStats, listAllEquipment } = require("./equipment.service");
const { getEquipmentTimeline, getLastRepairComment } = require("./history.service");
const { formatUser, getUserByTelegramId } = require("./user.service");
const {
  csvEscape,
  escapeHtml,
  formatDate,
  padString,
  statusLabel,
} = require("../utils/formatters");

function buildSummaryText() {
  const items = listAllEquipment();
  const stats = getEquipmentStats(items);
  const categoriesSorted = [...stats.byCategory.entries()].sort((left, right) =>
    left[0].localeCompare(right[0], "ru"),
  );

  const categoryLines = categoriesSorted
    .map(
      ([name, categoryStats]) =>
        `${name}:\n • Всего: ${categoryStats.total}\n • На складе: ${categoryStats.inStock}\n • У пользователя: ${categoryStats.withUser}\n • В ремонте: ${categoryStats.repair}\n`,
    )
    .join("\n");

  return `📊 Сводка по оборудованию\n\n${categoryLines || "Категории: -"}`;
}

function buildCategoryTable(categoryName, items) {
  if (!items.length) {
    return `📦 ${escapeHtml(categoryName)}\n\nНет оборудования`;
  }

  const header = [
    padString("№", 2),
    padString("Оборудование", 32),
    padString("Статус", 9),
    padString("Польз.", 12),
    padString("Выдано", 11),
    padString("Сдано", 11),
    padString("Ремонт", 11),
    padString("Комм.", 12),
  ].join(" |");

  const separator = header.replace(/./g, "-");
  const rows = items.map((item) => {
    const title = `${item.category || "-"} ${item.model || "-"} - ${item.serial_number || "-"}`;
    const user = item.current_holder_user_id
      ? formatUser(getUserByTelegramId(item.current_holder_user_id))
      : "-";
    const timeline = getEquipmentTimeline(item.id);
    const repairComment = getLastRepairComment(item.id) || "-";

    return [
      padString(item.inventory_number || "-", 2),
      padString(title, 32),
      padString(statusLabel(item.status), 9),
      padString(user, 12),
      padString(formatDate(item.current_issue_date), 11),
      padString(formatDate(timeline.lastReturnDate), 11),
      padString(formatDate(timeline.lastRepairDate), 11),
      padString(repairComment, 12),
    ].join(" |");
  });

  return `📦 ${escapeHtml(categoryName)}\n\n<pre>${escapeHtml([header, separator, ...rows].join("\n"))}</pre>`;
}

function findSystemFontPath() {
  const candidates = [];

  if (process.platform === "win32") {
    const windowsDirectory = process.env.WINDIR || process.env.SYSTEMROOT;
    if (windowsDirectory) {
      candidates.push(path.join(windowsDirectory, "Fonts", "arial.ttf"));
      candidates.push(path.join(windowsDirectory, "Fonts", "calibri.ttf"));
      candidates.push(path.join(windowsDirectory, "Fonts", "tahoma.ttf"));
    }
  }

  candidates.push(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
  );

  return candidates.find((filePath) => fs.existsSync(filePath));
}

let reportFontPromise = null;

function getReportFont() {
  if (reportFontPromise) return reportFontPromise;

  reportFontPromise = new Promise((resolve, reject) => {
    const fontPath = findSystemFontPath();
    if (!fontPath) {
      reject(new Error("System font not found for image rendering"));
      return;
    }
    const font = PImage.registerFont(fontPath, "ReportFont");
    font.loadSync();
    resolve(font);
  });

  return reportFontPromise;
}

function createMemoryBuffer() {
  const chunks = [];
  const writable = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  writable.getBuffer = () => Buffer.concat(chunks);
  return writable;
}

function truncateText(ctx, text, maxWidth) {
  let result = String(text);

  if (ctx.measureText(result).width <= maxWidth) {
    return result;
  }

  while (result.length > 0 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }

  return `${result}…`;
}

async function createCategoryImage(categoryName, items) {
  await getReportFont();

  const rowHeight = 34;
  const padding = 24;
  const columns = [
    { title: "№", width: 70 },
    { title: "Оборудование", width: 360 },
    { title: "Статус", width: 130 },
    { title: "Пользователь", width: 180 },
    { title: "Выдано", width: 160 },
    { title: "Сдано", width: 160 },
    { title: "Ремонт", width: 160 },
    { title: "Комментарий", width: 250 },
  ];

  const width = columns.reduce((sum, column) => sum + column.width, 0) + padding * 2;
  const height = padding * 2 + rowHeight * (items.length + 1);
  const image = PImage.make(width, height);
  const ctx = image.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const headerY = padding;
  ctx.fillStyle = "#f2f2f2";
  ctx.fillRect(padding, headerY, width - padding * 2, rowHeight);

  ctx.fillStyle = "#000000";
  ctx.font = "18pt ReportFont";

  let x = padding;
  for (const column of columns) {
    ctx.fillText(column.title, x + 4, headerY + 24);
    x += column.width;
  }

  let y = headerY + rowHeight;
  for (const item of items) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(padding, y, width - padding * 2, rowHeight);
    ctx.fillStyle = "#000000";
    ctx.font = "16pt ReportFont";

    const timeline = getEquipmentTimeline(item.id);
    const rowValues = [
      item.inventory_number || "-",
      `${item.category || "-"} ${item.model || "-"} - ${item.serial_number || "-"}`,
      statusLabel(item.status),
      item.current_holder_user_id
        ? formatUser(getUserByTelegramId(item.current_holder_user_id))
        : "-",
      formatDate(item.current_issue_date),
      formatDate(timeline.lastReturnDate),
      formatDate(timeline.lastRepairDate),
      getLastRepairComment(item.id) || "-",
    ];

    x = padding;
    for (let index = 0; index < columns.length; index += 1) {
      const value = truncateText(ctx, rowValues[index], columns[index].width - 12);
      ctx.fillText(value, x + 4, y + 24);
      x += columns[index].width;
    }

    y += rowHeight;
  }

  // pureimage does not call writable.end() after encoding,
  // so we cannot rely on the 'finish' event.
  // Instead, collect chunks directly and resolve after encodePNGToStream settles.
  const chunks = [];
  const writable = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  await PImage.encodePNGToStream(image, writable);
  return Buffer.concat(chunks);
}

function buildCategoryCsv(categoryName, items) {
  const headers = [
    "inventory_number",
    "category",
    "brand",
    "model",
    "serial_number",
    "status",
    "current_holder_user_id",
    "current_issue_date",
    "last_return_date",
    "last_repair_date",
    "repair_comment",
  ];

  const rows = items.map((item) => {
    const timeline = getEquipmentTimeline(item.id);

    return [
      item.inventory_number || "",
      item.category || "",
      item.brand || "",
      item.model || "",
      item.serial_number || "",
      statusLabel(item.status),
      item.current_holder_user_id || "",
      formatDate(item.current_issue_date),
      formatDate(timeline.lastReturnDate),
      formatDate(timeline.lastRepairDate),
      getLastRepairComment(item.id) || "",
    ]
      .map(csvEscape)
      .join(",");
  });

  return Buffer.from(`\uFEFF${[headers.join(","), ...rows].join("\n")}`, "utf-8");
}

async function buildCategoryXlsx(categoryName, items) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(String(categoryName).slice(0, 31));

  sheet.columns = [
    { header: "Инв. номер", key: "inventory_number", width: 15 },
    { header: "Категория", key: "category", width: 20 },
    { header: "Бренд", key: "brand", width: 24 },
    { header: "Модель", key: "model", width: 18 },
    { header: "Серийный номер", key: "serial_number", width: 18 },
    { header: "Статус", key: "status", width: 14 },
    { header: "Пользователь", key: "current_holder_user_id", width: 18 },
    { header: "Дата выдачи", key: "current_issue_date", width: 20 },
    { header: "Дата сдачи", key: "last_return_date", width: 20 },
    { header: "Дата ремонта", key: "last_repair_date", width: 20 },
    { header: "Комментарий", key: "repair_comment", width: 30 },
  ];

  for (const item of items) {
    const timeline = getEquipmentTimeline(item.id);

    sheet.addRow({
      inventory_number: item.inventory_number || "",
      category: item.category || "",
      brand: item.brand || "",
      model: item.model || "",
      serial_number: item.serial_number || "",
      status: statusLabel(item.status),
      current_holder_user_id: item.current_holder_user_id
        ? formatUser(getUserByTelegramId(item.current_holder_user_id))
        : "",
      current_issue_date: formatDate(item.current_issue_date),
      last_return_date: formatDate(timeline.lastReturnDate),
      last_repair_date: formatDate(timeline.lastRepairDate),
      repair_comment: getLastRepairComment(item.id) || "",
    });
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  buildCategoryXlsx,
  buildSummaryText,
  createCategoryImage,
};
