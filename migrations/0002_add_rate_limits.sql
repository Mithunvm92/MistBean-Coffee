CREATE TABLE IF NOT EXISTS rate_limits (
    ip_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_time
ON rate_limits(ip_hash, created_at);
