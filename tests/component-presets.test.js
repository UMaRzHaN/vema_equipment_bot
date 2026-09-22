'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getGiveComponentsPreset, requiresGiveComponents } = require('../src/utils/component-presets');

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

  it('applies sampler preset by category name', () => {
    const preset = getGiveComponentsPreset({
      category: 'Sampler',
      brand: 'Vema',
      model: 'X1',
    });

    assert.deepEqual(preset.quantity, ['Розовый мешок']);
    assert.match(preset.single.join(' | '), /Воронка/);
    assert.match(preset.single.join(' | '), /Конус/);
  });

  it('applies camera preset for camera ogi category', () => {
    const preset = getGiveComponentsPreset({
      category: 'Камера (OGI)',
      brand: 'Mileva',
      model: 'Gx620',
    });

    assert.deepEqual(preset.quantity, ['Батарейка']);
    assert.match(preset.single.join(' | '), /Штатив/);
    assert.match(preset.single.join(' | '), /Анемометр/);
    assert.doesNotMatch(preset.single.join(' | '), /Воронка/);
    assert.doesNotMatch(preset.single.join(' | '), /Конус/);
  });
});

describe('requiresGiveComponents', () => {
  it('skips components step for gas analyzers', () => {
    assert.equal(requiresGiveComponents({ category: 'Газоанализатор' }), false);
    assert.equal(requiresGiveComponents({ category: 'газоанализаторы' }), false);
  });

  it('keeps components step for other categories', () => {
    assert.equal(requiresGiveComponents({ category: 'Камера' }), true);
    assert.equal(requiresGiveComponents({}), true);
  });
});
