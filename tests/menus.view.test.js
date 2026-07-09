'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCategoryItemsKeyboard,
  buildMyEquipmentSelectionKeyboard,
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

    assert.equal(backButton.callback_data, `back_brandlist_${encodeURIComponent('Камера')}`);
  });
});
