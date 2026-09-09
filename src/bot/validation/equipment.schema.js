'use strict';

const { z } = require('zod');

const componentSchema = z.union([
  z.string().min(1).max(100).transform((name) => ({ name, qty: 1 })),
  z.object({
    name: z.string().min(1).max(100),
    qty: z.number().int().min(1).max(99),
  }),
]);

const categorySchema = z.string()
  .min(1, 'Укажите категорию')
  .max(100);

const equipmentCreateSchema = z.object({
  category: categorySchema,
  brand: z.string().max(100).optional().nullable(),
  model: z.string().min(1, 'Укажите модель').max(100),
  serial_number: z.string().min(1, 'Укажите серийный номер').max(100),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты: YYYY-MM-DD').optional().nullable(),
  components: z.array(componentSchema).max(20).optional().nullable(),
});

const equipmentUpdateSchema = equipmentCreateSchema.partial().extend({
  warehouse: z.string().max(100).optional().nullable(),
  project: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
});

function validateEquipmentCreate(data) {
  return equipmentCreateSchema.safeParse(data);
}

function validateEquipmentUpdate(data) {
  return equipmentUpdateSchema.safeParse(data);
}

module.exports = { validateEquipmentCreate, validateEquipmentUpdate };
