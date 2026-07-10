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
      ? 'рџ›Ў'
      : user.role === 'manager'
        ? 'рџ“‹'
        : 'рџ‘¤';
    const banTag = user.is_banned ? ' [BAN]' : '';
    const pendingTag = user.is_approved === false ? ' [PENDING]' : '';
    return [Markup.button.callback(`${roleTag} ${name}${banTag}${pendingTag}`, `set_role_select_${user.telegram_user_id}_${page}`)];
  });

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('в¬…пёЏ', `users_page_${page - 1}`));
  nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));
  if (page < totalPages - 1) nav.push(Markup.button.callback('вћЎпёЏ', `users_page_${page + 1}`));
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

function buildRoleSelectKeyboard(telegramUserId, { isApproved = true, isBanned = false, page = 0 } = {}) {
  const rows = [
    [
      Markup.button.callback('рџ‘¤ user', `set_role_${telegramUserId}_user`),
      Markup.button.callback('рџ“‹ manager', `set_role_${telegramUserId}_manager`),
      Markup.button.callback('рџ›Ў admin', `set_role_${telegramUserId}_admin`),
    ],
  ];

  if (!isApproved) {
    rows.push([Markup.button.callback('Подтвердить регистрацию', `approve_registration_${telegramUserId}`)]);
  }

  rows.push([Markup.button.callback(isBanned ? 'Р Р°Р·Р±Р°РЅРёС‚СЊ' : 'Р—Р°Р±Р°РЅРёС‚СЊ', `toggle_ban_${telegramUserId}_${isBanned ? 0 : 1}_${page}`)]);
  rows.push([Markup.button.callback('В« РќР°Р·Р°Рґ', `users_page_${page}`)]);
  return Markup.inlineKeyboard(rows);
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
    [Markup.button.locationRequest('РћС‚РїСЂР°РІРёС‚СЊ РіРµРѕР»РѕРєР°С†РёСЋ')],
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

function buildBrandListKeyboard(categoryName, brands, page, totalPages, pageOffset = 0) {
  void categoryName;

  const rows = [
    [Markup.button.callback(LABELS.allBrands, 'brandSelect_all')],
    ...brands.map((name, index) => [
      Markup.button.callback(name, `brandSelect_${pageOffset + index}`),
    ]),
  ];

  if (totalPages > 1) {
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('в¬…пёЏ', `brandPage_${page - 1}`));
    nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));
    if (page < totalPages - 1) nav.push(Markup.button.callback('вћЎпёЏ', `brandPage_${page + 1}`));
    rows.push(nav);
  }

  return Markup.inlineKeyboard(rows);
}

function buildCategoryItemsKeyboard(items, page = 0, options = {}) {
  const totalPages = Math.max(Math.ceil(items.length / ITEMS_PER_PAGE), 1);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + ITEMS_PER_PAGE);
  const showBrand = Boolean(options.showBrand);

  const rows = pageItems.map((item, index) => {
    const brandPrefix = showBrand && item.brand ? `${item.brand} вЂў ` : '';
    const displayIndex = start + index + 1;
    return [
      Markup.button.callback(
        `${displayIndex}. ${brandPrefix}${item.model || '-'} - ${item.serial_number || '-'}`,
        `open_${item.id}`,
      ),
    ];
  });

  if (totalPages > 1) {
    const nav = [];
    if (safePage > 0) nav.push(Markup.button.callback('в¬…пёЏ', `itemsPage_${safePage - 1}`));
    nav.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, 'noop'));
    if (safePage < totalPages - 1) nav.push(Markup.button.callback('вћЎпёЏ', `itemsPage_${safePage + 1}`));
    rows.push(nav);
  }

  rows.push([Markup.button.callback('в†©пёЏ РќР°Р·Р°Рґ', 'back_brandlist')]);
  return Markup.inlineKeyboard(rows);
}

function buildCategoryExportKeyboard(categoryName) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('рџ“„ Р­РєСЃРїРѕСЂС‚ РІ Excel', `excelCategory_${encodeURIComponent(categoryName)}`)],
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
  const rows = [[
    Markup.button.callback('РњРёРЅРёРјСѓРј', `applyGivePreset_${equipmentId}_minimal`),
    Markup.button.callback('РџРѕР»РЅС‹Р№ РєРѕРјРїР»РµРєС‚', `applyGivePreset_${equipmentId}_full`),
  ]];

  for (const name of orderedNames) {
    const qty = selectedMap.get(name) || 0;
    const isQuantity = quantityNames.has(name);
    const selected = isQuantity ? qty > 0 : selectedMap.has(name);
    const componentKey = isQuantity
      ? buildComponentKey('q', quantityIndexByName.get(name))
      : buildComponentKey('s', singleIndexByName.get(name));

    rows.push([
      Markup.button.callback(
        `${selected ? 'вњ…' : 'в¬њ'} ${name}`,
        `toggleGiveComponent_${equipmentId}_${componentKey}`,
      ),
    ]);

    if (selected && isQuantity && isQuantityComponent(name, preset)) {
      rows.push([
        Markup.button.callback('в€’', `decrementGiveComponent_${equipmentId}_${componentKey}`),
        Markup.button.callback(`${qty}`, 'noop'),
        Markup.button.callback('+', `incrementGiveComponent_${equipmentId}_${componentKey}`),
      ]);
    }
  }

  rows.push([
    Markup.button.callback('рџ—‘ РћС‡РёСЃС‚РёС‚СЊ', `applyGivePreset_${equipmentId}_clear`),
    Markup.button.callback('вњ… Р“РѕС‚РѕРІРѕ', `finishGiveComponents_${equipmentId}`),
    Markup.button.callback('в†©пёЏ РќР°Р·Р°Рґ', `open_${equipmentId}`),
  ]);

  return Markup.inlineKeyboard(rows);
}

function buildMyEquipmentKeyboard(items) {
  const rows = items.map((item) => [
    Markup.button.callback(
      `${item.category || '-'} вЂў ${item.model || '-'} - ${item.serial_number || '-'}`,
      `open_${item.id}`,
    ),
  ]);
  rows.push([
    Markup.button.callback('вЏі РџСЂРѕРґР»РёС‚СЊ', 'extendAllMy'),
    Markup.button.callback('в†©пёЏ Р’РµСЂРЅСѓС‚СЊ', 'returnAllMy'),
  ]);
  return Markup.inlineKeyboard(rows);
}

function buildMyEquipmentSelectionKeyboard(items, mode, selectedIds = []) {
  const selectedSet = new Set((selectedIds || []).map((id) => Number(id)));
  const allSelected = items.length > 0 && items.every((item) => selectedSet.has(Number(item.id)));
  const rows = items.map((item) => {
    const isSelected = selectedSet.has(Number(item.id));
    const marker = isSelected ? 'вњ…' : 'в¬њ';
    return [
      Markup.button.callback(
        `${marker} ${item.category || '-'} вЂў ${item.model || '-'} - ${item.serial_number || '-'}`,
        `toggleMyEquipmentSelection_${mode}_${item.id}`,
      ),
    ];
  });

  if (items.length > 1) {
    rows.push([
      Markup.button.callback(
        allSelected ? 'в‘пёЏ РЎРЅСЏС‚СЊ РІСЃС‘' : 'вњ… Р’С‹Р±СЂР°С‚СЊ РІСЃС‘',
        `toggleAllMyEquipmentSelection_${mode}`,
      ),
    ]);
  }

  rows.push([
    Markup.button.callback(
      mode === 'extend' ? 'вЏі РџСЂРѕРґР»РёС‚СЊ РІС‹Р±СЂР°РЅРЅРѕРµ' : 'в†©пёЏ Р’РµСЂРЅСѓС‚СЊ РІС‹Р±СЂР°РЅРЅРѕРµ',
      `confirmMyEquipmentSelection_${mode}`,
    ),
  ]);
  rows.push([Markup.button.callback('вќЊ РћС‚РјРµРЅР°', 'cancelMyEquipmentSelection')]);

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
