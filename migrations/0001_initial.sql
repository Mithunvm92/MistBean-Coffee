PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  price_250 INTEGER NOT NULL,
  price_500 INTEGER NOT NULL,
  price_1000 INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_ref TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  pin_code TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  pack_grams INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  grind_preference TEXT NOT NULL,
  blend_ratio TEXT,
  notes TEXT NOT NULL DEFAULT '',
  unit_price INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_charge INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  customer_whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
  invoice_number TEXT UNIQUE,
  invoice_key TEXT,
  rejection_reason TEXT,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  order_id TEXT,
  actor TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO products(id,name,description,price_250,price_500,price_1000) VALUES
('arabica','Arabica','100% Arabica coffee. Batch details to be confirmed.',349,649,1199),
('robusta','Robusta','100% Robusta coffee. Batch details to be confirmed.',299,549,999),
('blend','House Blend','Default blend 80% Arabica / 20% Robusta.',329,599,1099);

CREATE TABLE IF NOT EXISTS invoice_sequence (id INTEGER PRIMARY KEY CHECK(id=1), next_number INTEGER NOT NULL);
INSERT OR IGNORE INTO invoice_sequence(id,next_number) VALUES(1,1);
CREATE TABLE IF NOT EXISTS rate_limits (ip_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_time ON rate_limits(ip_hash,created_at);
