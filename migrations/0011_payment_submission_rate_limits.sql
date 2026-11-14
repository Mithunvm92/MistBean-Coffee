-- Rate limit public UTR submissions independently from payment-page and QR reads.
CREATE TABLE IF NOT EXISTS payment_submission_rate_limits (
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_submission_rate_limits_ip_time
  ON payment_submission_rate_limits(ip_hash, created_at);
