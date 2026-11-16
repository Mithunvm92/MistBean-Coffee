-- Public payment links use random bearer tokens; only SHA-256 hashes are stored.
ALTER TABLE orders ADD COLUMN pay_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pay_token_hash ON orders(pay_token_hash) WHERE pay_token_hash IS NOT NULL;

-- Lightweight application-level throttling for payment page and QR requests.
CREATE TABLE IF NOT EXISTS payment_page_rate_limits (
  ip_hash TEXT NOT NULL,
  route TEXT NOT NULL CHECK(route IN ('pay','qr')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_page_rate_limits_ip_time
  ON payment_page_rate_limits(ip_hash, route, created_at);
