-- Commercial mode: premium expiry + payment orders
-- One-shot migrate; re-running ALTER may fail if premium_until already exists.

ALTER TABLE users ADD COLUMN premium_until TEXT;

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL, -- monthly | yearly
  amount REAL NOT NULL,
  pay_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
  trade_no TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
