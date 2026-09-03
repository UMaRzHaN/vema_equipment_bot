'use strict';

/**
 * Reset equipment statistics.
 *
 * Clears the whole operation history and returns every piece of equipment to
 * the "на складе" state. Equipment rows themselves are never deleted.
 *
 * Usage:
 *   node scripts/reset-stats.js --dry-run   # show what would change
 *   node scripts/reset-stats.js --yes       # actually apply
 */

require('dotenv').config();

const readline = require('readline');
const logger = require('../src/utils/logger');
const { initDb, closeDb, query, transaction } = require('../src/db');
const { STATUS } = require('../src/utils/constants');

const DEFAULT_WAREHOUSE = 'Ташкент';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const autoConfirm = args.includes('--yes') || args.includes('-y');

async function hasColumn(name) {
  const { rows } = await query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_name = 'equipment' AND column_name = $1`,
    [name],
  );
  return rows.length > 0;
}

async function collectStats() {
  const [{ rows: equipmentRows }, { rows: historyRows }, { rows: statusRows }] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM equipment'),
    query('SELECT COUNT(*)::int AS count FROM history'),
    query('SELECT status, COUNT(*)::int AS count FROM equipment GROUP BY status ORDER BY status'),
  ]);

  return {
    equipment: equipmentRows[0].count,
    history: historyRows[0].count,
    byStatus: statusRows,
  };
}

function printStats(title, stats) {
  console.log(`\n${title}`);
  console.log(`  Оборудование: ${stats.equipment}`);
  console.log(`  Записей истории: ${stats.history}`);
  for (const row of stats.byStatus) {
    console.log(`  • ${row.status}: ${row.count}`);
  }
}

async function confirm() {
  if (autoConfirm) return true;
  if (!process.stdin.isTTY) {
    console.error('\nНеинтерактивный запуск: добавьте --yes для подтверждения.');
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question('\nОчистить всю историю и вернуть всё оборудование на склад? (yes/no) ', resolve);
  });
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function main() {
  await initDb();

  const before = await collectStats();
  printStats('Текущее состояние:', before);

  if (before.equipment === 0) {
    console.log('\nОборудования нет — нечего сбрасывать.');
    return;
  }

  if (dryRun) {
    console.log('\n--dry-run: изменения не применялись.');
    return;
  }

  if (!(await confirm())) {
    console.log('Отменено.');
    return;
  }

  const hasWarehouse = await hasColumn('warehouse');
  const hasExpectedReturn = await hasColumn('expected_return_date');
  const hasDueDate = await hasColumn('due_date');

  const assignments = [
    `status = $1`,
    `current_holder_user_id = NULL`,
    `current_issue_date = NULL`,
    `updated_at = NOW()`,
  ];
  if (hasExpectedReturn) assignments.push('expected_return_date = NULL');
  if (hasDueDate) assignments.push('due_date = NULL');
  // Equipment that was issued or in repair has warehouse = NULL (check constraint);
  // give those the default warehouse, keep the one already set for stock items.
  if (hasWarehouse) assignments.push(`warehouse = COALESCE(warehouse, $2)`);

  const params = hasWarehouse ? [STATUS.IN_STOCK, DEFAULT_WAREHOUSE] : [STATUS.IN_STOCK];

  const result = await transaction(async (client) => {
    const deleted = await client.query('DELETE FROM history');
    const updated = await client.query(
      `UPDATE equipment SET ${assignments.join(', ')}`,
      params,
    );
    return { deleted: deleted.rowCount, updated: updated.rowCount };
  });

  logger.info(result, 'Equipment statistics reset');

  const after = await collectStats();
  printStats('После сброса:', after);
  console.log(`\nУдалено записей истории: ${result.deleted}; обновлено единиц оборудования: ${result.updated}.`);
}

main()
  .catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'Reset failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
