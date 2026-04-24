'use strict';

const { Markup } = require('telegraf');
const { isEffectiveAdmin } = require('../config');
const { LABELS } = require('../labels');

const ITEMS_PER_PAGE = 8;

function mainMenu(ctx) {
  const firstRow = [LABELS.categories];
  if (isEffectiveAdmin(ctx)) firstRow.push(LABELS.addEquipment);
  const secondRow = [LABELS.summary, LABELS.profile];
  if (isEffectiveAdmin(ctx)) secondRow.push(LABELS.manageUsers);
  return Markup.keyboard([firstRow, secondRow]).resize();
}

function buildUserListKeyboard(users, page, totalPages) {
  const rows = users.map((u) => {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || `#${u.telegram_user_id}`;
    const roleTag = u.role === 'admin' ? '👑' : u.role === 'manager' ? '📋' : '👤';
    return [Markup.button.callback(
      `${roleTag} ${name}`,
      `set_role_select_${u.telegram_user_id}`,
    )];
  });
  const nav = [];
  if (page > 0)              nav.push(Markup.button.callback('⬅️', `users_page_${page - 1}`));
  nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));
  if (page < totalPages - 1) nav.push(Markup.button.callback('➡️', `users_page_${page + 1}`));
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

function buildRoleSelectKeyboard(telegramUserId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('👤 user',    `set_role_${telegramUserId}_user`),
      Markup.button.callback('📋 manager', `set_role_${telegramUserId}_manager`),
      Markup.button.callback('👑 admin',   `set_role_${telegramUserId}_admin`),
    ],
    [Markup.button.callback('« Назад', `users_page_0`)],
  ]);
}


function buildEditEquipmentKeyboard() {
  return Markup.keyboard([
    [LABELS.editCategory,      LABELS.editBrand,           LABELS.editModel],
    [LABELS.editSerialNumber,  LABELS.editInventoryNumber, LABELS.editPurchaseDate],
    [LABELS.editNotes,         LABELS.back],
  ]).resize();
}

function buildBackKeyboard() {
  return Markup.keyboard([[LABELS.back]]).resize();
}

function buildPhoneRequestKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest(LABELS.sharePhone)],
    [LABELS.back],
  ]).resize();
}

function buildCategoryListKeyboard(categories, page, totalPages) {
  const keyboard = categories.map((name) => [name]);
  const nav = [];
  if (page > 0)            nav.push(LABELS.previousPage);
  if (page < totalPages - 1) nav.push(LABELS.nextPage);
  if (nav.length) keyboard.push(nav);
  keyboard.push([LABELS.back]);
  return Markup.keyboard(keyboard).resize();
}

function buildCategoryItemsKeyboard(items, page = 0) {
  const totalPages = Math.max(Math.ceil(items.length / ITEMS_PER_PAGE), 1);
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  const start      = safePage * ITEMS_PER_PAGE;
  const pageItems  = items.slice(start, start + ITEMS_PER_PAGE);

  const rows = pageItems.map((item) => [
    Markup.button.callback(
      `${item.position || item.id}. ${item.model || '-'} - ${item.serial_number || '-'}`,
      `open_${item.id}`,
    ),
  ]);

  if (totalPages > 1) {
    const nav = [];
    const cat = encodeURIComponent(items[0]?.category || '');
    if (safePage > 0)            nav.push(Markup.button.callback('⬅️', `itemsPage_${cat}_${safePage - 1}`));
    nav.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, 'noop'));
    if (safePage < totalPages - 1) nav.push(Markup.button.callback('➡️', `itemsPage_${cat}_${safePage + 1}`));
    rows.push(nav);
  }

  return Markup.inlineKeyboard(rows);
}

function buildCategoryExportKeyboard(categoryName) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📄 Экспорт в Excel', `excelCategory_${encodeURIComponent(categoryName)}`)],
  ]);
}

module.exports = {
  ITEMS_PER_PAGE,
  buildBackKeyboard,
  buildCategoryExportKeyboard,
  buildCategoryItemsKeyboard,
  buildCategoryListKeyboard,
  buildEditEquipmentKeyboard,
  buildPhoneRequestKeyboard,
  buildRoleSelectKeyboard,
  buildUserListKeyboard,
  mainMenu,
};
