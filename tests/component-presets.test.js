'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPresetFromKit,
  getGiveComponentsPreset,
  parseKitInput,
  requiresGiveComponents,
} = require('../src/utils/component-presets');

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

describe('parseKitInput', () => {
  it('parses plain and counted items', () => {
    const { items } = parseKitInput('Штатив, Батарейка x2, Анемометр');

    assert.deepEqual(items, [
      { name: 'Штатив', qty: 1, counted: false },
      { name: 'Батарейка', qty: 2, counted: true },
      { name: 'Анемометр', qty: 1, counted: false },
    ]);
  });

  it('treats a dash as an empty kit', () => {
    assert.deepEqual(parseKitInput('-').items, []);
  });

  it('rejects an invalid quantity', () => {
    assert.match(parseKitInput('Батарейка x0').error, /от 1 до 99/);
  });

  it('keeps the last entry for a repeated name', () => {
    assert.deepEqual(parseKitInput('Штатив, Штатив x3').items, [{ name: 'Штатив', qty: 3, counted: true }]);
  });
});

describe('buildPresetFromKit', () => {
  it('splits counted items into the quantity group', () => {
    const preset = buildPresetFromKit({
      full_items: [
        { name: 'Штатив', qty: 1, counted: false },
        { name: 'Батарейка', qty: 2, counted: true },
      ],
      minimal_items: [{ name: 'Батарейка', qty: 2, counted: true }],
    });

    assert.deepEqual(preset.single, ['Штатив']);
    assert.deepEqual(preset.quantity, ['Батарейка']);
    assert.deepEqual(preset.full, [{ name: 'Штатив', qty: 1 }, { name: 'Батарейка', qty: 2 }]);
    assert.deepEqual(preset.minimal, [{ name: 'Батарейка', qty: 2 }]);
  });
});
