-- Phone-number customer accounts and verified payment ledger.
-- Existing orders are backfilled by their existing Indian mobile number.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  account_ref TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO customers(id,account_ref,phone,display_name)
SELECT 'cust_' || customer_phone, 'MB-C-' || customer_phone, customer_phone, MAX(customer_name)
FROM orders
GROUP BY customer_phone;

ALTER TABLE orders ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE orders ADD COLUMN customer_account_ref TEXT;

UPDATE orders
SET customer_id=(SELECT id FROM customers WHERE customers.phone=orders.customer_phone),
    customer_account_ref=(SELECT account_ref FROM customers WHERE customers.phone=orders.customer_phone)
WHERE customer_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_created
ON orders(customer_id,created_at DESC);

CREATE TABLE IF NOT EXISTS customer_payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  amount INTEGER NOT NULL CHECK(amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_method TEXT NOT NULL DEFAULT 'UPI',
  payment_reference TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer
ON customer_payments(customer_id,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_payments_reference
ON customer_payments(payment_reference);
