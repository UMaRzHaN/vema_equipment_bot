'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { initDb, closeDb, query } = require('../../src/db');
const {
  addEquipment,
  findEquipmentById,
  giveEquipmentToUser,
  extendEquipmentForUser,
  returnEquipmentFromUser,
} = require('../../src/services/equipment.service');
const { getFullEquipmentHistory, getEquipmentTimeline } = require('../../src/services/history.service');
const { upsertTelegramUser } = require('../../src/repositories/user.repo');

let dbReady = false;

async function ensureDb() {
  if (dbReady) return;
  await initDb();
  dbReady = true;
}

test('history flow is persisted for give, extend, and return', async () => {
  await ensureDb();

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const holderId = 800000000 + Math.floor(Math.random() * 100000);
  const serial = `INT-HISTORY-${suffix}`;

  await upsertTelegramUser({
    id: holderId,
    username: `history_${suffix}`,
    first_name: 'History',
    last_name: 'Test',
  });

  let equipmentId = null;

  try {
    const created = await addEquipment({
      category: 'Интеграционный тест',
      brand: 'Codex',
      model: 'HistoryFlow',
      serial_number: serial,
      purchase_date: '2026-07-09',
      components: [],
    });
    equipmentId = created.id;

    const issued = await giveEquipmentToUser(created, holderId, [{ name: 'Кабель', qty: 1 }]);
    const expectedReturnDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const extended = await extendEquipmentForUser(issued, holderId, expectedReturnDate);
    await returnEquipmentFromUser(extended, holderId, 'Ташкент');

    const history = await getFullEquipmentHistory(equipmentId, 10);
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((entry) => entry.action),
      ['возвращено', 'срок продлен', 'выдано'],
    );

    assert.equal(history[0].from_status, 'у пользователя');
    assert.equal(history[0].to_status, 'на складе');
    assert.equal(history[1].from_status, 'у пользователя');
    assert.equal(history[1].to_status, 'у пользователя');
    assert.match(history[1].comment || '', /Новый срок до/);
    assert.equal(history[2].from_status, 'на складе');
    assert.equal(history[2].to_status, 'у пользователя');

    const timeline = await getEquipmentTimeline(equipmentId);
    assert.ok(timeline.lastIssueDate);
    assert.ok(timeline.lastReturnDate);
    assert.equal(timeline.lastRepairDate, null);

    const finalItem = await findEquipmentById(equipmentId);
    assert.equal(finalItem.status, 'на складе');
    assert.equal(finalItem.current_holder_user_id, null);
    assert.equal(finalItem.warehouse, 'Ташкент');
  } finally {
    if (equipmentId) {
      await query('DELETE FROM equipment WHERE id = $1', [equipmentId]);
    }
    await query('DELETE FROM users WHERE telegram_user_id = $1', [holderId]);
  }
});

test.after(async () => {
  if (dbReady) {
    await closeDb();
    dbReady = false;
  }
});
