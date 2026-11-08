ALTER TABLE orders ADD COLUMN payment_reference TEXT;
ALTER TABLE orders ADD COLUMN payment_verified_at TEXT;
ALTER TABLE orders ADD COLUMN payment_details_sent_at TEXT;
ALTER TABLE orders ADD COLUMN invoice_sent_at TEXT;
ALTER TABLE orders ADD COLUMN courier_name TEXT;
ALTER TABLE orders ADD COLUMN tracking_id TEXT;
