'use strict';

const { Markup } = require('telegraf');
const { isEffectiveAdmin } = require('../config');
const { LABELS } = require('../labels');
const { isQuantityComponent } = require('../../utils/component-presets');

const ITEMS_PER_PAGE = 8;

function buildComponentKey(kind, index) {
  return `${kind}${index}`;
}

function mainMenu(ctx) {
  const firstRow = [LABELS.categories, LABELS.myEquipment];
  if (isEffectiveAdmin(ctx)) firstRow.push(LABELS.addEquipment);

  const secondRow = [LABELS.summary, LABELS.profile];
  if (isEffectiveAdmin(ctx)) secondRow.push(LABELS.manageUsers);

  return Markup.keyboard([firstRow, secondRow]).resize();
}

function buildUserListKeyboard(users, page, totalPages) {
  const rows = users.map((user) => {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
      || user.username
      || `#${user.telegram_user_id}`;
    const roleTag = user.role === 'admin'
      ? '🛡'
      : user.role === 'manager'
        ? '📋'
        : '👤';
    return [Markup.button.callback(`${roleTag} ${name}`, `set_role_select_${user.telegram_user_id}`)];
  });

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️', `users_page_${page - 1}`));
  nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));
  if (page < totalPages - 1) nav.push(Markup.button.callback('➡️', `users_page_${page + 1}`));
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

function buildRoleSelectKeyboard(telegramUserId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('👤 user', `set_role_${telegramUserId}_user`),
      Markup.button.callback('📋 manager', `set_role_${telegramUserId}_manager`),
      Markup.button.callback('🛡 admin', `set_role_${telegramUserId}_admin`),
    ],
    [Markup.button.callback('« Назад', 'users_page_0')],
  ]);
}

function buildEditEquipmentKeyboard() {
  return Markup.keyboard([
    [LABELS.editCategory, LABELS.editBrand, LABELS.editModel],
    [LABELS.editSerialNumber, LABELS.editPurchaseDate],
    [LABELS.editNotes, LABELS.back],
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

function buildLocationRequestKeyboard() {
  return Markup.keyboard([
    [Markup.button.locationRequest('Отправить геолокацию')],
    [LABELS.back],
  ]).resize();
}

function buildCategoryListKeyboard(categories, page, totalPages) {
  const keyboard = categories.map((name) => [name]);
  const nav = [];
  if (page > 0) nav.push(LABELS.previousPage);
  if (page < totalPages - 1) nav.push(LABELS.nextPage);
  if (nav.length) keyboard.push(nav);
  keyboard.push([LABELS.back]);
  return Markup.keyboard(keyboard).resize();
}

function buildBrandListKeyboard(categoryName, brands, page, totalPages) {
  const encodedCategory = encodeURIComponent(categoryName);
  const rows = [
    [Markup.button.callback(LABELS.allBrands, `brandSelect_${encodedCategory}__`)],
    ...brands.map((name) => [Markup.button.callback(name, `brandSelect_${encodedCategory}__${encodeURIComponent(name)}`)]),
  ];

  if (totalPages > 1) {
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️', `brandPage_${encodedCategory}__${page - 1}`));
    nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));
    if (page < totalPages - 1) nav.push(Markup.button.callback('➡️', `brandPage_${encodedCategory}__${page + 1}`));
    rows.push(nav);
  }

  return Markup.inlineKeyboard(rows);
}

function buildCategoryItemsKeyboard(items, page = 0, options = {}) {
  const totalPages = Math.max(Math.ceil(items.length / ITEMS_PER_PAGE), 1);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + ITEMS_PER_PAGE);
  const encodedCategory = encodeURIComponent(options.category || items[0]?.category || '');
  const encodedBrand = encodeURIComponent(options.brand || '');
  const showBrand = !options.brand;

  const rows = pageItems.map((item) => {
    const brandPrefix = showBrand && item.brand ? `${item.brand} • ` : '';
    return [
      Markup.button.callback(
        `${item.position || item.id}. ${brandPrefix}${item.model || '-'} - ${item.serial_number || '-'}`,
        `open_${item.id}`,
      ),
    ];
  });

  if (totalPages > 1) {
    const nav = [];
    if (safePage > 0) nav.push(Markup.button.callback('⬅️', `itemsPage_${encodedCategory}__${encodedBrand}__${safePage - 1}`));
    nav.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, 'noop'));
    if (safePage < totalPages - 1) nav.push(Markup.button.callback('➡️', `itemsPage_${encodedCategory}__${encodedBrand}__${safePage + 1}`));
    rows.push(nav);
  }

  rows.push([Markup.button.callback('↩️ Назад', `back_brandlist_${encodedCategory}`)]);
  return Markup.inlineKeyboard(rows);
}

function buildCategoryExportKeyboard(categoryName) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📄 Экспорт в Excel', `excelCategory_${encodeURIComponent(categoryName)}`)],
  ]);
}

function buildGiveComponentsKeyboard(equipmentId, preset, selectedComponents = []) {
  const orderedNames = Array.from(new Set([
    ...((Array.isArray(preset?.full) ? preset.full : [])
      .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
      .filter(Boolean)),
    ...((Array.isArray(preset?.minimal) ? preset.minimal : [])
      .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
      .filter(Boolean)),
    ...(Array.isArray(preset?.single) ? preset.single : []),
    ...(Array.isArray(preset?.quantity) ? preset.quantity : []),
  ].filter(Boolean)));

  const quantityNames = new Set(Array.isArray(preset?.quantity) ? preset.quantity : []);
  const singleIndexByName = new Map();
  const quantityIndexByName = new Map();
  let singleIndex = 0;
  let quantityIndex = 0;

  for (const name of orderedNames) {
    if (quantityNames.has(name)) quantityIndexByName.set(name, quantityIndex++);
    else singleIndexByName.set(name, singleIndex++);
  }

  const selectedMap = new Map(selectedComponents.map((item) => [item.name, item.qty]));
  const rows = [
    [
      Markup.button.callback('Минимум', `applyGivePreset_${equipmentId}_minimal`),
      Markup.button.callback('Полный комплект', `applyGivePreset_${equipmentId}_full`),
    ],
  ];

  for (const name of orderedNames) {
    const qty = selectedMap.get(name) || 0;
    const isQuantity = quantityNames.has(name);
    const selected = isQuantity ? qty > 0 : selectedMap.has(name);
    const componentKey = isQuantity
      ? buildComponentKey('q', quantityIndexByName.get(name))
      : buildComponentKey('s', singleIndexByName.get(name));

    rows.push([
      Markup.button.callback(
        `${selected ? '✅' : '⬜'} ${name}`,
        `toggleGiveComponent_${equipmentId}_${componentKey}`,
      ),
    ]);

    if (selected && isQuantity && isQuantityComponent(name, preset)) {
      rows.push([
        Markup.button.callback('−', `decrementGiveComponent_${equipmentId}_${componentKey}`),
        Markup.button.callback(`${qty}`, 'noop'),
        Markup.button.callback('+', `incrementGiveComponent_${equipmentId}_${componentKey}`),
      ]);
    }
  }

  rows.push([
    Markup.button.callback('🗑 Очистить', `applyGivePreset_${equipmentId}_clear`),
    Markup.button.callback('✅ Готово', `finishGiveComponents_${equipmentId}`),
    Markup.button.callback('↩️ Назад', `open_${equipmentId}`),
  ]);

  return Markup.inlineKeyboard(rows);
}

function buildMyEquipmentKeyboard(items) {
  const rows = items.map((item) => [
    Markup.button.callback(
      `${item.category || '-'} • ${item.model || '-'} - ${item.serial_number || '-'}`,
      `open_${item.id}`,
    ),
  ]);
  rows.push([
    Markup.button.callback('⏳ Продлить', 'extendAllMy'),
    Markup.button.callback('↩️ Вернуть', 'returnAllMy'),
  ]);
  return Markup.inlineKeyboard(rows);
}

function buildMyEquipmentSelectionKeyboard(items, mode, selectedIds = []) {
  const selectedSet = new Set((selectedIds || []).map((id) => Number(id)));
  const allSelected = items.length > 0 && items.every((item) => selectedSet.has(Number(item.id)));
  const rows = items.map((item) => {
    const isSelected = selectedSet.has(Number(item.id));
    const marker = isSelected ? '✅' : '⬜';
    return [
      Markup.button.callback(
        `${marker} ${item.category || '-'} • ${item.model || '-'} - ${item.serial_number || '-'}`,
        `toggleMyEquipmentSelection_${mode}_${item.id}`,
      ),
    ];
  });

  if (items.length > 1) {
    rows.push([
      Markup.button.callback(
        allSelected ? '☑️ Снять всё' : '✅ Выбрать всё',
        `toggleAllMyEquipmentSelection_${mode}`,
      ),
    ]);
  }

  rows.push([
    Markup.button.callback(
      mode === 'extend'
        ? '⏳ Продлить выбранное'
        : '↩️ Вернуть выбранное',
      `confirmMyEquipmentSelection_${mode}`,
    ),
  ]);
  rows.push([
    Markup.button.callback('❌ Отмена', 'cancelMyEquipmentSelection'),
  ]);

  return Markup.inlineKeyboard(rows);
}

module.exports = {
  ITEMS_PER_PAGE,
  buildBackKeyboard,
  buildBrandListKeyboard,
  buildCategoryExportKeyboard,
  buildCategoryItemsKeyboard,
  buildCategoryListKeyboard,
  buildEditEquipmentKeyboard,
  buildGiveComponentsKeyboard,
  buildLocationRequestKeyboard,
  buildMyEquipmentKeyboard,
  buildMyEquipmentSelectionKeyboard,
  buildPhoneRequestKeyboard,
  buildRoleSelectKeyboard,
  buildUserListKeyboard,
  mainMenu,
};
