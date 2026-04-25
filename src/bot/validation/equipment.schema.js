'use strict';

const { z } = require('zod');

const equipmentCreateSchema = z.object({
  category:         z.string().min(1, 'Укажите категорию').max(100),
  brand:            z.string().max(100).optional().nullable(),
  model:            z.string().min(1, 'Укажите модель').max(100),
  serial_number:    z.string().min(1, 'Укажите серийный номер').max(100),
  purchase_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты: YYYY-MM-DD').optional().nullable(),
  notes:            z.string().max(500).optional().nullable(),
});

const equipmentUpdateSchema = equipmentCreateSchema.partial();

function validateEquipmentCreate(data) {
  return equipmentCreateSchema.safeParse(data);
}

function validateEquipmentUpdate(data) {
  return equipmentUpdateSchema.safeParse(data);
}

module.exports = { validateEquipmentCreate, validateEquipmentUpdate };
