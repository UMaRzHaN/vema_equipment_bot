'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateEquipmentCreate, validateEquipmentUpdate } = require('../src/bot/validation/equipment.schema');

describe('validateEquipmentCreate', () => {
  it('accepts valid full payload', () => {
    const result = validateEquipmentCreate({
      category: 'Ноутбуки',
      brand: 'Dell',
      model: 'XPS 13',
      serial_number: 'SN-001',
      purchase_date: '2024-01-15',
      components: ['Чехол', 'Зарядка'],
    });
    assert.equal(result.success, true);
  });

  it('accepts minimal required fields', () => {
    const result = validateEquipmentCreate({
      category: 'Принтеры',
      model: 'HP LaserJet',
      serial_number: 'SN-002',
    });
    assert.equal(result.success, true);
  });

  it('rejects missing category', () => {
    const result = validateEquipmentCreate({
      model: 'HP LaserJet',
      serial_number: 'SN-003',
    });
    assert.equal(result.success, false);
    assert.ok(result.error.errors.some((e) => e.path.includes('category')));
  });

  it('rejects empty category string', () => {
    const result = validateEquipmentCreate({
      category: '',
      model: 'Model',
      serial_number: 'SN-004',
    });
    assert.equal(result.success, false);
    assert.ok(result.error.errors.some((e) => e.path.includes('category')));
  });

  it('rejects missing model', () => {
    const result = validateEquipmentCreate({
      category: 'Мониторы',
      serial_number: 'SN-005',
    });
    assert.equal(result.success, false);
    assert.ok(result.error.errors.some((e) => e.path.includes('model')));
  });

  it('rejects invalid purchase_date format', () => {
    const result = validateEquipmentCreate({
      category: 'Мониторы',
      model: 'Dell U2722D',
      serial_number: 'SN-006',
      purchase_date: '15.01.2024',
    });
    assert.equal(result.success, false);
    assert.ok(result.error.errors.some((e) => e.path.includes('purchase_date')));
  });

  it('accepts null purchase_date', () => {
    const result = validateEquipmentCreate({
      category: 'Мониторы',
      model: 'Dell U2722D',
      serial_number: 'SN-007',
      purchase_date: null,
    });
    assert.equal(result.success, true);
  });

  it('rejects category exceeding max length', () => {
    const result = validateEquipmentCreate({
      category: 'A'.repeat(101),
      model: 'Model',
      serial_number: 'SN-008',
    });
    assert.equal(result.success, false);
  });

  it('rejects too many components', () => {
    const result = validateEquipmentCreate({
      category: 'Ноутбуки',
      model: 'Model',
      serial_number: 'SN-009',
      components: new Array(21).fill('Item'),
    });
    assert.equal(result.success, false);
  });
});

describe('validateEquipmentUpdate', () => {
  it('accepts partial update with one field', () => {
    const result = validateEquipmentUpdate({ model: 'ThinkPad X1' });
    assert.equal(result.success, true);
  });

  it('accepts empty object (partial schema — all optional)', () => {
    const result = validateEquipmentUpdate({});
    assert.equal(result.success, true);
  });

  it('rejects invalid purchase_date in partial update', () => {
    const result = validateEquipmentUpdate({ purchase_date: 'not-a-date' });
    assert.equal(result.success, false);
  });

  it('accepts null values for optional fields in update', () => {
    const result = validateEquipmentUpdate({ components: null });
    assert.equal(result.success, true);
  });
});
