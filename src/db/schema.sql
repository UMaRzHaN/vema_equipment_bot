-- PostgreSQL schema for vema_equipment_bot

CREATE TABLE IF NOT EXISTS users (
  id                BIGSERIAL PRIMARY KEY,
  telegram_user_id  BIGINT NOT NULL UNIQUE,
  username          TEXT,
  first_name        TEXT,
  last_name         TEXT,
  phone             TEXT,
  role              TEXT NOT NULL DEFAULT 'user',
  is_banned         BOOLEAN NOT NULL DEFAULT FALSE,
  is_approved       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_user_id ON users (telegram_user_id);

CREATE TABLE IF NOT EXISTS equipment (
  id                       BIGSERIAL PRIMARY KEY,
  category                 TEXT NOT NULL,
  brand                    TEXT,
  model                    TEXT NOT NULL,
  serial_number            TEXT NOT NULL UNIQUE,
  purchase_date            DATE,
  status                   TEXT NOT NULL DEFAULT 'на складе',
  current_holder_user_id   BIGINT,
  current_issue_date       TIMESTAMPTZ,
  expected_return_date     TIMESTAMPTZ,
  components               JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_status          ON equipment (status);
CREATE INDEX IF NOT EXISTS idx_equipment_category        ON equipment (category);
CREATE INDEX IF NOT EXISTS idx_equipment_holder_user_id  ON equipment (current_holder_user_id);

CREATE TABLE IF NOT EXISTS history (
  id                    BIGSERIAL PRIMARY KEY,
  equipment_id          BIGINT NOT NULL,
  action                TEXT NOT NULL,
  from_status           TEXT,
  to_status             TEXT,
  from_user_id          BIGINT,
  to_user_id            BIGINT,
  performed_by_user_id  BIGINT,
  comment               TEXT,
  action_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_history_equipment FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_equipment_id  ON history (equipment_id);
CREATE INDEX IF NOT EXISTS idx_history_action_date   ON history (action_date DESC);

CREATE TABLE IF NOT EXISTS sessions (
  user_id     BIGINT PRIMARY KEY,
  data        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
