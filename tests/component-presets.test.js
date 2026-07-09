'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getGiveComponentsPreset } = require('../src/utils/component-presets');

describe('getGiveComponentsPreset', () => {
  it('applies sampler preset by model name', () => {
    const preset = getGiveComponentsPreset({
      category: 'Sampler',
      brand: 'Vema',
      model: 'Sampler Pro',
    });

    assert.deepEqual(preset.quantity, ['Розовый мешок']);
    assert.match(preset.single.join(' | '), /Воронка/);
    assert.match(preset.single.join(' | '), /Большой мешок/);
    assert.match(preset.single.join(' | '), /Маленький мешок/);
    assert.match(preset.single.join(' | '), /Конус/);
    assert.equal(preset.defaultQtyByName['Розовый мешок'], 1);
  });
});
