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

## Phone-linked customer accounts and post-payment invoice workflow

1. Apply all migrations locally, including `0005_phone_customer_accounts_and_payment_ledger.sql`:
   ```bash
   npx wrangler d1 migrations apply mistbean-db --local
   ```
2. Submit two test orders using the same valid Indian mobile number and different order details.
3. In the admin order list, confirm both orders display the same `MB-C-...` customer account reference. The reference must not contain the phone number.
4. Confirm one order, set a test delivery charge, and prepare its UPI payment request.
5. Verify the test payment only after checking the test bank/payment simulation. Enter a test UTR.
6. Confirm the order becomes PAID and a row is created in `customer_payments` for the customer account, order, exact total amount, UPI reference, verifier and verification timestamp.
7. If seller identity/address and R2 are configured, confirm the invoice is generated automatically, stored in private R2, and linked to the same order/customer account. The PDF should show invoice number, order, paid amount, UPI reference and verification time.
8. If invoice generation cannot complete because seller details or R2 are missing, payment must remain PAID, an `INVOICE_AUTO_GENERATION_FAILED` audit event should be recorded, and the admin should be able to retry **Generate invoice** after fixing configuration.
9. Confirm a second verification attempt cannot create a duplicate payment ledger row or invoice number.
10. Confirm invoice download remains admin-authenticated and returns `Cache-Control: no-store`.
11. Confirm a customer phone number change creates/links a different phone account for future orders; historical orders remain attached to their original account.
12. Do not use real customer data or real money in local testing.

Phone-based association is an internal customer record, not an authenticated customer portal. Do not expose invoices or order history publicly based only on a phone number. A future customer self-service portal must verify phone ownership with OTP before showing private records.
