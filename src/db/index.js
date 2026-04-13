const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { schema } = require("./schema");

const dbPath = process.env.DB_PATH || "./data/inventory.db";
const dir = path.dirname(dbPath);

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(schema);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn("users", "phone", "TEXT");

module.exports = db;
