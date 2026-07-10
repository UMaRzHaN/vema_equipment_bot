'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBrandListKeyboard,
  buildCategoryItemsKeyboard,
  buildMyEquipmentSelectionKeyboard,
  buildRoleSelectKeyboard,
  buildUserListKeyboard,
} = require('../src/bot/views/menus');

describe('buildMyEquipmentSelectionKeyboard', () => {
  const items = [
    { id: 10, category: 'Камера', model: 'FLIR C5', serial_number: 'SN-10' },
    { id: 11, category: 'Ноутбук', model: 'Dell 5420', serial_number: 'SN-11' },
  ];

  it('marks selected items and provides confirm action', () => {
    const markup = buildMyEquipmentSelectionKeyboard(items, 'extend', [10]);
    const inline = markup.reply_markup.inline_keyboard;

    assert.match(inline[0][0].text, /✅/);
    assert.equal(inline[0][0].callback_data, 'toggleMyEquipmentSelection_extend_10');
    assert.equal(inline[1][0].callback_data, 'toggleMyEquipmentSelection_extend_11');
    assert.equal(inline[2][0].callback_data, 'toggleAllMyEquipmentSelection_extend');
    assert.equal(inline[3][0].callback_data, 'confirmMyEquipmentSelection_extend');
    assert.equal(inline[4][0].callback_data, 'cancelMyEquipmentSelection');
  });

  it('switches confirm caption for return mode', () => {
    const markup = buildMyEquipmentSelectionKeyboard(items, 'return', []);
    const inline = markup.reply_markup.inline_keyboard;
    assert.match(inline[3][0].text, /Вернуть/);
    assert.equal(inline[3][0].callback_data, 'confirmMyEquipmentSelection_return');
  });
});

describe('buildCategoryItemsKeyboard', () => {
  it('builds back button to return to brand list', () => {
    const markup = buildCategoryItemsKeyboard(
      [{ id: 7, position: 1, model: 'Gfx320', serial_number: 'SN-7', category: 'Камера' }],
      0,
      { category: 'Камера', brand: 'Flir' },
    );
    const inline = markup.reply_markup.inline_keyboard;
    const backButton = inline[inline.length - 1][0];

    assert.equal(backButton.callback_data, 'back_brandlist');
  });

  it('does not show brand in item text for all-brands mode', () => {
    const markup = buildCategoryItemsKeyboard(
      [{ id: 8, position: 1, brand: 'AddGlobe LLC', model: 'GFM 2.0', serial_number: 'SN-8' }],
      0,
      { category: 'Sampler', showBrand: false },
    );
    const inline = markup.reply_markup.inline_keyboard;

    assert.equal(inline[0][0].text, '1. GFM 2.0 - SN-8');
  });

  it('uses list order instead of database id for item numbering', () => {
    const markup = buildCategoryItemsKeyboard(
      [
        { id: 10, model: 'Mileva 33', serial_number: 'SER-10' },
        { id: 11, model: 'Mileva 33', serial_number: 'SER-11' },
      ],
      0,
      { category: 'Камера (OGI)', showBrand: false },
    );
    const inline = markup.reply_markup.inline_keyboard;

    assert.equal(inline[0][0].text, '1. Mileva 33 - SER-10');
    assert.equal(inline[1][0].text, '2. Mileva 33 - SER-11');
  });
});

describe('buildBrandListKeyboard', () => {
  it('keeps callbacks short for long category names', () => {
    const markup = buildBrandListKeyboard('Камера (OGI)', ['Очень длинный бренд оборудования'], 0, 1, 0);
    const inline = markup.reply_markup.inline_keyboard;

    assert.equal(inline[0][0].callback_data, 'brandSelect_all');
    assert.equal(inline[1][0].callback_data, 'brandSelect_0');
    assert.ok(Buffer.byteLength(inline[1][0].callback_data, 'utf8') <= 64);
  });
});

describe('user admin keyboards', () => {
  it('marks banned users in the list and preserves page in callback', () => {
    const markup = buildUserListKeyboard([
      { telegram_user_id: 123, first_name: 'Ivan', last_name: 'Petrov', role: 'user', is_banned: true },
    ], 2, 4);
    const inline = markup.reply_markup.inline_keyboard;

    assert.match(inline[0][0].text, /\[BAN\]/);
    assert.equal(inline[0][0].callback_data, 'set_role_select_123_2');
  });

  it('shows unban action when user is already banned', () => {
    const markup = buildRoleSelectKeyboard(123, { isBanned: true, page: 2 });
    const inline = markup.reply_markup.inline_keyboard;

    assert.equal(inline[1][0].callback_data, 'toggle_ban_123_0_2');
    assert.equal(inline[2][0].callback_data, 'users_page_2');
  });
});
