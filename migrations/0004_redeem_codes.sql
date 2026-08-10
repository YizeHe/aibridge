-- Activation / redeem codes

CREATE TABLE IF NOT EXISTS redeem_codes (
  code TEXT PRIMARY KEY,
  days INTEGER NOT NULL DEFAULT 2,
  max_uses INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited total uses
  used_count INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS redeem_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_redeem_uses_user ON redeem_uses(user_id);

-- Seed default code: RemoteAiGENT → 2 days, each account once
INSERT OR IGNORE INTO redeem_codes (code, days, max_uses, note)
VALUES ('RemoteAiGENT', 2, 0, 'default promo');
