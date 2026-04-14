'use strict';

const { z } = require('zod');
const {
  findEquipmentById,
  startRepair,
  completeRepair,
  giveEquipmentToUser,
  returnEquipmentFromUser,
  writeOffEquipment,
} = require('../../services/equipment.service');
const { STATUS } = require('../../utils/constants');
const { equipmentActionsTotal } = require('../../utils/metrics');

const repairSchema = z.object({
  equipment_id:           z.number().int().positive(),
  performed_by_user_id:   z.number().int().positive(),
  comment:                z.string().max(500).optional(),
});

async function actionsRoutes(fastify) {
  // POST /actions/repair — start repair
  fastify.post('/actions/repair', async (req, reply) => {
    const parsed = repairSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    }
    const { equipment_id, performed_by_user_id, comment } = parsed.data;
    const item = await findEquipmentById(equipment_id);
    if (!item) return reply.code(404).send({ error: 'Equipment not found' });
    if (item.status === STATUS.REPAIR) {
      return reply.code(409).send({ error: 'Equipment is already in repair' });
    }
    const updated = await startRepair(item, performed_by_user_id, comment || null);
    equipmentActionsTotal.inc({ action: 'repair_started' });
    return reply.send(updated);
  });

  // POST /actions/complete-repair
  fastify.post('/actions/complete-repair', async (req, reply) => {
    const parsed = z.object({ equipment_id: z.number().int().positive(), performed_by_user_id: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    const { equipment_id, performed_by_user_id } = parsed.data;
    const item = await findEquipmentById(equipment_id);
    if (!item) return reply.code(404).send({ error: 'Equipment not found' });
    if (item.status !== STATUS.REPAIR) return reply.code(409).send({ error: 'Equipment is not in repair' });
    const updated = await completeRepair(item, performed_by_user_id);
    equipmentActionsTotal.inc({ action: 'repair_completed' });
    return reply.send(updated);
  });

  // POST /actions/give
  fastify.post('/actions/give', async (req, reply) => {
    const parsed = z.object({ equipment_id: z.number().int().positive(), user_id: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    const { equipment_id, user_id } = parsed.data;
    const item = await findEquipmentById(equipment_id);
    if (!item) return reply.code(404).send({ error: 'Equipment not found' });
    if (item.status !== STATUS.IN_STOCK) return reply.code(409).send({ error: 'Equipment is not in stock' });
    const updated = await giveEquipmentToUser(item, user_id);
    equipmentActionsTotal.inc({ action: 'given' });
    return reply.send(updated);
  });

  // POST /actions/return
  fastify.post('/actions/return', async (req, reply) => {
    const parsed = z.object({ equipment_id: z.number().int().positive(), user_id: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    const { equipment_id, user_id } = parsed.data;
    const item = await findEquipmentById(equipment_id);
    if (!item) return reply.code(404).send({ error: 'Equipment not found' });
    if (item.status !== STATUS.WITH_USER) return reply.code(409).send({ error: 'Equipment is not with user' });
    if (item.current_holder_user_id !== user_id) return reply.code(403).send({ error: 'Equipment belongs to another user' });
    const updated = await returnEquipmentFromUser(item, user_id);
    equipmentActionsTotal.inc({ action: 'returned' });
    return reply.send(updated);
  });
}

module.exports = actionsRoutes;
