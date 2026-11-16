-- Customer-submitted payment details are unverified until an administrator checks the bank credit.
ALTER TABLE orders ADD COLUMN payment_submitted_reference TEXT;
ALTER TABLE orders ADD COLUMN payment_submitted_amount INTEGER;
ALTER TABLE orders ADD COLUMN payment_submitted_at TEXT;
