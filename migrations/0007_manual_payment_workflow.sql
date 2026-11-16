-- Manual UPI payment ledger, reconciliation and lifecycle events.
ALTER TABLE orders ADD COLUMN payable_paise INTEGER;
ALTER TABLE orders ADD COLUMN payment_request_sent_at TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN shipped_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
ALTER TABLE orders ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE orders ADD COLUMN unique_amount_suffix INTEGER;

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  utr TEXT NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
  source TEXT NOT NULL CHECK(source IN ('bank_alert','whatsapp','manual')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bank_credits (
  id TEXT PRIMARY KEY,
  utr TEXT NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
  narration TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  matched_order_id TEXT REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bank_credits_match ON bank_credits(matched_order_id, received_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  wa_message_id TEXT UNIQUE,
  order_id TEXT REFERENCES orders(id),
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  body TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id, created_at);
