const db = require("./src/db");


function printTable(name) {
  try {
    const rows = db.prepare(`SELECT * FROM ${name}`).all();
    console.log(`\n===== ${name.toUpperCase()} =====`);
    console.table(rows);
  } catch (e) {
    console.log(`Ошибка при чтении ${name}:`, e.message);
  }
}

// список таблиц
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
  .all()
  .map(t => t.name);

console.log("TABLES:", tables);

// вывод всех таблиц
tables.forEach(printTable);

db.prepare(`
  UPDATE equipment
  SET 
    status = 'на складе',
    current_holder_user_id = NULL,
    current_issue_date = NULL
  WHERE current_issue_date = 308362442
    AND status = 'у пользователя'
`).run();