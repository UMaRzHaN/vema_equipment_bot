const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  inventory_number TEXT,
  purchase_date TEXT,
  status TEXT NOT NULL DEFAULT 'на складе',
  current_holder_user_id INTEGER,
  current_issue_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  from_user_id INTEGER,
  to_user_id INTEGER,
  performed_by_user_id INTEGER,
  comment TEXT,
  action_date TEXT NOT NULL
);
`;

module.exports = { schema };
