-- Keep the bearer token encrypted so the owner can resend the same payment link.
-- The lookup hash remains the only token value used for public database lookups.
ALTER TABLE orders ADD COLUMN pay_token_ciphertext TEXT;
