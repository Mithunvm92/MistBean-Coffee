# Local smoke-test plan

1. Run `npm run typecheck`.
2. Apply local migration with `npm run db:local`.
3. Configure `.dev.vars` with a local admin email, PBKDF2 password hash and random session secret. Keep `WHATSAPP_MODE=mock`.
4. Run `npm run dev`.
5. Open `/` and submit a test order with a valid 10-digit Indian mobile, full address and six-digit PIN. Do not use a real customer's data.
6. Confirm the response shows an order reference and that no WhatsApp message is sent in mock mode.
7. Open `/admin/`, sign in and confirm the order appears.
8. Confirm the order with a test delivery charge. Verify the total equals subtotal plus delivery.
9. Click **Send UPI payment link on WhatsApp** in mock mode. Check that the prefilled message contains an HTTPS localhost `/pay/ORDER_REFERENCE` link and the confirmed amount.
10. Open the payment link. A confirmed unpaid order should respond with a 302 redirect to `upi://pay` containing the configured UPI ID, payee name, amount, INR currency and order reference. Check that unknown, pending and paid orders do not redirect.
11. Mark payment as verified only in a test database. Generate and download a sample PDF invoice. Check seller identity and legal fields before any real invoice use.
12. Mark dispatched and delivered.
13. Submit six orders rapidly from the same local source IP; the application-level limit should reject excess attempts.
14. Try the admin API without a token; it should return 401.
15. Try invalid product/pack/quantity/phone/PIN values; the API should reject them.
16. Confirm `/api/health` returns `ok: true`.

## Not covered by automated tests yet

Meta webhook signature integration tests, approved template sends, invoice document sends, concurrency/load tests, backup restore, accessibility audit, legal invoice review and Cloudflare Access policy verification must be completed before launch.

## Local test prices and admin security

Apply migration locally only: `npx wrangler d1 migrations apply mistbean-db --local`.
It updates catalogue prices for future orders to ₹1–₹9 and creates the admin login throttle table. Existing orders remain unchanged. Sign in again after updating code, regenerate the admin password hash and SESSION_SECRET in `.dev.vars`.
