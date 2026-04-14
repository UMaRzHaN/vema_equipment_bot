'use strict';

const { z } = require('zod');
const {
  listAllEquipment,
  addEquipment,
  findEquipmentById,
} = require('../../services/equipment.service');
const { equipmentActionsTotal } = require('../../utils/metrics');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createEquipmentSchema = z.object({
  category:         z.string().min(1).max(100),
  brand:            z.string().max(100).nullable().optional(),
  model:            z.string().min(1).max(100),
  serial_number:    z.string().min(1).max(100),
  inventory_number: z.string().max(100).nullable().optional(),
  purchase_date:    z.string().regex(DATE_RE, 'Format YYYY-MM-DD').nullable().optional(),
  notes:            z.string().max(500).nullable().optional(),
});

async function equipmentRoutes(fastify) {
  // GET /equipment — list all
  fastify.get('/equipment', async (_req, reply) => {
    const items = await listAllEquipment();
    return reply.send({ items, total: items.length });
  });

  // GET /equipment/:id — single item
  fastify.get('/equipment/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const item = await findEquipmentById(id);
    if (!item) return reply.code(404).send({ error: 'Not found' });
    return reply.send(item);
  });

  // POST /equipment — create
  fastify.post('/equipment', async (req, reply) => {
    const parsed = createEquipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    }

    try {
      const item = await addEquipment(parsed.data);
      equipmentActionsTotal.inc({ action: 'created' });
      return reply.code(201).send(item);
    } catch (err) {
      if (err.message === 'DUPLICATE_SERIAL') {
        return reply.code(409).send({ error: 'Serial number already exists' });
      }
      throw err;
    }
  });
}

module.exports = equipmentRoutes;
