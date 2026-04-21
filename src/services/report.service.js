'use strict';

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const PImage = require('pureimage');
const { Writable } = require('stream');
const { getEquipmentStats, listAllEquipment } = require('./equipment.service');
const { getEquipmentTimelinesBatch, getLastRepairCommentsBatch } = require('./history.service');
const { formatUser, getUsersByTelegramIds } = require('./user.service');
const { escapeHtml, formatDate, padString, statusLabel } = require('../utils/formatters');

async function buildSummaryText() {
  const items = await listAllEquipment();
  const stats = await getEquipmentStats(items);
  const categoriesSorted = [...stats.byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));

  const lines = categoriesSorted.map(
    ([name, cs]) =>
      `${name}:\n • Всего: ${cs.total}\n • На складе: ${cs.inStock}\n • У пользователя: ${cs.withUser}\n • В ремонте: ${cs.repair}`,
  );

  return `📊 Сводка по оборудованию\n\n${lines.join('\n\n') || 'Категории: -'}`;
}

function findSystemFontPath() {
  const candidates = [
    path.join(__dirname, '../../assets/fonts/DejaVuSans.ttf'),
  ];
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
  return candidates.find((p) => fs.existsSync(p));
}

let reportFontPromise = null;
function getReportFont() {
  if (reportFontPromise) return reportFontPromise;
  reportFontPromise = new Promise((resolve, reject) => {
    const fontPath = findSystemFontPath();
    if (!fontPath) { reject(new Error('System font not found for image rendering')); return; }
    const font = PImage.registerFont(fontPath, 'ReportFont');
    font.loadSync();
    resolve(font);
  });
  return reportFontPromise;
}

async function createCategoryImage(categoryName, items) {
  await getReportFont();

  const rowHeight = 34;
  const padding = 24;
  const columns = [
    { title: '№',           width: 70  },
    { title: 'Оборудование', width: 360 },
    { title: 'Статус',      width: 130 },
    { title: 'Пользователь', width: 180 },
    { title: 'Выдано',      width: 160 },
    { title: 'Сдано',       width: 160 },
    { title: 'Ремонт',      width: 160 },
    { title: 'Комментарий', width: 250 },
  ];

  const width  = columns.reduce((s, c) => s + c.width, 0) + padding * 2;
  const height = padding * 2 + rowHeight * (items.length + 1);
  const image  = PImage.make(width, height);
  const ctx    = image.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(padding, padding, width - padding * 2, rowHeight);
  ctx.fillStyle = '#000000';
  ctx.font = '18pt ReportFont';

  let x = padding;
  for (const col of columns) { ctx.fillText(col.title, x + 4, padding + 24); x += col.width; }

  // Batch-fetch all timeline, comment, and user data — 3 parallel queries total
  const ids       = items.map((i) => i.id);
  const holderIds = [...new Set(items.map((i) => i.current_holder_user_id).filter(Boolean))];
  const EMPTY_TIMELINE = { lastIssueDate: null, lastReturnDate: null, lastRepairDate: null };

  const [timelinesMap, commentsMap, usersMap] = await Promise.all([
    getEquipmentTimelinesBatch(ids),
    getLastRepairCommentsBatch(ids),
    getUsersByTelegramIds(holderIds),
  ]);

  let y = padding + rowHeight;
  for (const item of items) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(padding, y, width - padding * 2, rowHeight);
    ctx.fillStyle = '#000000'; ctx.font = '16pt ReportFont';

    const timeline = timelinesMap.get(item.id) || EMPTY_TIMELINE;
    const holder   = item.current_holder_user_id
      ? formatUser(usersMap.get(item.current_holder_user_id))
      : '-';

    const rowVals = [
      item.inventory_number || '-',
      `${item.category || '-'} ${item.model || '-'} - ${item.serial_number || '-'}`,
      statusLabel(item.status),
      holder,
      formatDate(item.current_issue_date),
      formatDate(timeline.lastReturnDate),
      formatDate(timeline.lastRepairDate),
      commentsMap.get(item.id) || '-',
    ];

    x = padding;
    for (let i = 0; i < columns.length; i++) {
      const val = truncateText(ctx, rowVals[i], columns[i].width - 12);
      ctx.fillText(val, x + 4, y + 24);
      x += columns[i].width;
    }
    y += rowHeight;
  }

  const chunks = [];
  const writable = new Writable({ write(chunk, _, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  await PImage.encodePNGToStream(image, writable);
  return Buffer.concat(chunks);
}

function truncateText(ctx, text, maxWidth) {
  let result = String(text);
  if (ctx.measureText(result).width <= maxWidth) return result;
  while (result.length > 0 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

async function buildCategoryXlsx(categoryName, items) {
  const workbook = new ExcelJS.Workbook();
  const sheet    = workbook.addWorksheet(String(categoryName).slice(0, 31));

  sheet.columns = [
    { header: 'Инв. номер',     key: 'inventory_number',      width: 15 },
    { header: 'Категория',      key: 'category',              width: 20 },
    { header: 'Бренд',          key: 'brand',                 width: 24 },
    { header: 'Модель',         key: 'model',                 width: 18 },
    { header: 'Серийный номер', key: 'serial_number',         width: 18 },
    { header: 'Статус',         key: 'status',                width: 14 },
    { header: 'Пользователь',   key: 'holder',                width: 18 },
    { header: 'Дата выдачи',    key: 'current_issue_date',    width: 20 },
    { header: 'Дата сдачи',     key: 'last_return_date',      width: 20 },
    { header: 'Дата ремонта',   key: 'last_repair_date',      width: 20 },
    { header: 'Комментарий',    key: 'repair_comment',        width: 30 },
  ];

  // Batch-fetch all timeline, comment, and user data — 3 parallel queries total
  const ids       = items.map((i) => i.id);
  const holderIds = [...new Set(items.map((i) => i.current_holder_user_id).filter(Boolean))];
  const EMPTY_TIMELINE = { lastIssueDate: null, lastReturnDate: null, lastRepairDate: null };

  const [timelinesMap, commentsMap, usersMap] = await Promise.all([
    getEquipmentTimelinesBatch(ids),
    getLastRepairCommentsBatch(ids),
    getUsersByTelegramIds(holderIds),
  ]);

  for (const item of items) {
    const timeline = timelinesMap.get(item.id) || EMPTY_TIMELINE;
    const holder   = item.current_holder_user_id
      ? formatUser(usersMap.get(item.current_holder_user_id))
      : '';
    sheet.addRow({
      inventory_number:   item.inventory_number || '',
      category:           item.category || '',
      brand:              item.brand || '',
      model:              item.model || '',
      serial_number:      item.serial_number || '',
      status:             statusLabel(item.status),
      holder,
      current_issue_date: formatDate(item.current_issue_date),
      last_return_date:   formatDate(timeline.lastReturnDate),
      last_repair_date:   formatDate(timeline.lastRepairDate),
      repair_comment:     commentsMap.get(item.id) || '',
    });
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildCategoryXlsx, buildSummaryText, createCategoryImage };
