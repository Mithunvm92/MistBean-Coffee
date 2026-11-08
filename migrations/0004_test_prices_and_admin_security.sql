-- Local integration-test pricing: future orders only; existing orders remain unchanged.
UPDATE products SET price_250=1, price_500=2, price_1000=3 WHERE id='arabica';
UPDATE products SET price_250=4, price_500=5, price_1000=6 WHERE id='robusta';
UPDATE products SET price_250=7, price_500=8, price_1000=9 WHERE id='blend';
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip_time
ON admin_login_attempts(ip_hash, created_at);
