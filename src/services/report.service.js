'use strict';

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const PImage = require('pureimage');
const { Writable } = require('stream');
const { getEquipmentStats, listAllEquipment } = require('./equipment.service');
const { getEquipmentTimelinesBatch } = require('./history.service');
const { formatUser, getUsersByTelegramIds } = require('./user.service');
const { formatDate, formatDateOnly, statusLabel } = require('../utils/formatters');
const { formatComponent, normalizeComponents } = require('../utils/components');
const { STATUS } = require('../utils/constants');

const DEFAULT_BRAND = 'Без бренда';
const DEFAULT_WAREHOUSE = 'Ташкент';
const EMPTY_TIMELINE = { lastIssueDate: null, lastReturnDate: null, lastRepairDate: null };

function sortByBrandThenModel(items) {
  return [...items].sort((a, b) => {
    const brandOrder = (a.brand || DEFAULT_BRAND).localeCompare(b.brand || DEFAULT_BRAND, 'ru');
    if (brandOrder !== 0) return brandOrder;

    const modelOrder = (a.model || '').localeCompare(b.model || '', 'ru');
    if (modelOrder !== 0) return modelOrder;

    return String(a.serial_number || '').localeCompare(String(b.serial_number || ''), 'ru');
  });
}

function groupByBrand(items) {
  const groups = new Map();

  for (const item of sortByBrandThenModel(items)) {
    const brand = item.brand || DEFAULT_BRAND;
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand).push(item);
  }

  return [...groups.entries()];
}

async function buildSummaryText() {
  const items = await listAllEquipment();
  const stats = await getEquipmentStats(items);
  const categoriesSorted = [...stats.byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));

  const lines = categoriesSorted.map(
    ([name, categoryStats]) =>
      `${name}:\n • Всего: ${categoryStats.total}\n • На складе: ${categoryStats.inStock}\n • У пользователя: ${categoryStats.withUser}\n • В ремонте: ${categoryStats.repair}`,
  );

  return `📊 Сводка по оборудованию\n\n${lines.join('\n\n') || 'Категории: -'}`;
}

function findSystemFontPath() {
  const candidates = [path.join(__dirname, '../../assets/fonts/DejaVuSans.ttf')];

  if (process.platform === 'win32') {
    const winDir = process.env.WINDIR || process.env.SYSTEMROOT;
    if (winDir) {
      candidates.push(path.join(winDir, 'Fonts', 'arial.ttf'));
      candidates.push(path.join(winDir, 'Fonts', 'calibri.ttf'));
    }
  }

  candidates.push(
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  );

  return candidates.find((filePath) => {
    try {
      const stats = fs.statSync(filePath);
      return stats.isFile() && stats.size > 0;
    } catch {
      return false;
    }
  });
}

let reportFontPromise = null;

function getReportFont() {
  if (reportFontPromise) return reportFontPromise;

  reportFontPromise = new Promise((resolve, reject) => {
    const fontPath = findSystemFontPath();
    if (!fontPath) {
      reject(new Error('System font not found for image rendering'));
      return;
    }

    const font = PImage.registerFont(fontPath, 'ReportFont');
    font.loadSync();
    resolve(font);
  });

  return reportFontPromise;
}

function truncateText(ctx, text, maxWidth) {
  let result = String(text);
  if (ctx.measureText(result).width <= maxWidth) return result;

  while (result.length > 0 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }

  return `${result}…`;
}

async function buildReportMaps(items) {
  const equipmentIds = items.map((item) => item.id);
  const holderIds = [...new Set(items.map((item) => item.current_holder_user_id).filter(Boolean))];

  const [timelinesMap, usersMap] = await Promise.all([
    getEquipmentTimelinesBatch(equipmentIds),
    getUsersByTelegramIds(holderIds),
  ]);

  return { timelinesMap, usersMap };
}

function formatComponentsText(components) {
  const normalized = normalizeComponents(components);
  return normalized.length ? normalized.map(formatComponent).join(', ') : '-';
}

async function createCategoryImage(items) {
  await getReportFont();

  const grouped = groupByBrand(items);
  const rowHeight = 34;
  const brandRowHeight = 30;
  const padding = 24;
  const columns = [
    { title: '№', width: 60 },
    { title: 'Оборудование', width: 280 },
    { title: 'Комплект', width: 220 },
    { title: 'Склад', width: 140 },
    { title: 'Статус', width: 120 },
    { title: 'Пользователь', width: 170 },
    { title: 'Выдано', width: 140 },
  ];

  const width = columns.reduce((sum, column) => sum + column.width, 0) + padding * 2;
  const height = padding * 2 + rowHeight + (grouped.length * brandRowHeight) + (items.length * rowHeight);
  const image = PImage.make(width, height);
  const ctx = image.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(padding, padding, width - padding * 2, rowHeight);
  ctx.fillStyle = '#000000';
  ctx.font = '18pt ReportFont';

  let x = padding;
  for (const column of columns) {
    ctx.fillText(column.title, x + 4, padding + 24);
    x += column.width;
  }

  const { usersMap } = await buildReportMaps(items);

  let y = padding + rowHeight;
  let index = 1;

  for (const [brand, brandItems] of grouped) {
    ctx.fillStyle = '#dfe8f5';
    ctx.fillRect(padding, y, width - padding * 2, brandRowHeight);
    ctx.fillStyle = '#000000';
    ctx.font = '16pt ReportFont';
    ctx.fillText(`Бренд: ${brand}`, padding + 6, y + 21);
    y += brandRowHeight;

    for (const item of brandItems) {
      const holder = item.current_holder_user_id ? formatUser(usersMap.get(item.current_holder_user_id)) : '-';
      const warehouse = item.status === STATUS.WITH_USER ? '' : (item.warehouse || DEFAULT_WAREHOUSE);
      const rowValues = [
        String(index),
        `${item.model || '-'} - ${item.serial_number || '-'}`,
        formatComponentsText(item.components),
        warehouse,
        statusLabel(item.status),
        holder,
        formatDate(item.current_issue_date),
      ];

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(padding, y, width - padding * 2, rowHeight);
      ctx.fillStyle = '#000000';
      ctx.font = '15pt ReportFont';

      x = padding;
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const value = truncateText(ctx, rowValues[columnIndex], columns[columnIndex].width - 12);
        ctx.fillText(value, x + 4, y + 23);
        x += columns[columnIndex].width;
      }

      y += rowHeight;
      index += 1;
    }
  }

  const chunks = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  await PImage.encodePNGToStream(image, writable);
  return Buffer.concat(chunks);
}

async function buildCategoryXlsx(categoryName, items) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(String(categoryName).slice(0, 31));

  sheet.columns = [
    { header: '№', key: 'position', width: 3 },
    { header: 'Категория', key: 'category', width: 20 },
    { header: 'Бренд', key: 'brand', width: 24 },
    { header: 'Модель', key: 'model', width: 20 },
    { header: 'Комплектующие', key: 'components', width: 34 },
    { header: 'Склад', key: 'warehouse', width: 18 },
    { header: 'Серийный номер', key: 'serial_number', width: 20 },
    { header: 'Дата покупки', key: 'purchase_date', width: 18 },
    { header: 'Статус', key: 'status', width: 16 },
    { header: 'Пользователь', key: 'holder', width: 22 },
    { header: 'Дата выдачи', key: 'current_issue_date', width: 20 },
    { header: 'Дата сдачи', key: 'last_return_date', width: 20 },
    { header: 'Дата ремонта', key: 'last_repair_date', width: 20 },
  ];

  const { timelinesMap, usersMap } = await buildReportMaps(items);
  let index = 1;

  for (const [brand, brandItems] of groupByBrand(items)) {
    const brandRow = sheet.addRow({ category: `Бренд: ${brand}` });
    sheet.mergeCells(`A${brandRow.number}:M${brandRow.number}`);
    brandRow.font = { bold: true };
    brandRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'DCE6F2' },
    };

    for (const item of brandItems) {
      const timeline = timelinesMap.get(item.id) || EMPTY_TIMELINE;
      const holder = item.current_holder_user_id ? formatUser(usersMap.get(item.current_holder_user_id)) : '';
      const componentsText = formatComponentsText(item.components);

      const warehouse = item.status === STATUS.WITH_USER ? '' : (item.warehouse || DEFAULT_WAREHOUSE);

      sheet.addRow({
        position: index,
        category: item.category || '',
        brand: item.brand || '',
        model: item.model || '',
        components: componentsText === '-' ? '' : componentsText,
        serial_number: item.serial_number || '',
        warehouse,
        purchase_date: formatDateOnly(item.purchase_date),
        status: statusLabel(item.status),
        holder,
        current_issue_date: formatDate(item.current_issue_date),
        last_return_date: formatDate(timeline.lastReturnDate),
        last_repair_date: formatDate(timeline.lastRepairDate),
      });
      index += 1;
    }
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  buildCategoryXlsx,
  buildSummaryText,
  createCategoryImage,
};
