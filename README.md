# MistBean Coffee — Cloudflare ordering platform

A deployable starter for MistBean's customer storefront, order intake API, private admin desk, D1 database and R2 invoice storage. WhatsApp communication is personal-account click-to-chat and manual only.

**WhatsApp policy:** personal WhatsApp only. The application prepares messages and opens official wa.me click-to-chat drafts. An owner must review and press Send. No WhatsApp Business API, unofficial libraries, browser automation, background sending or webhook-based messaging is used.

## Included

- Existing MistBean customer storefront, adapted to submit orders to `/api/orders`.
- Server-side catalogue pricing; browser-submitted prices are never trusted.
- D1 schema for products, orders, admin sessions, audit events, webhook deduplication, rate-limit records and invoice sequence.
- Private admin sign-in and order dashboard.
- Confirm/reject orders, set delivery charge, verify payment, mark dispatch/delivery.
- PDF invoice generation after payment verification, stored in private R2.
- Copy-ready payment, invoice and shipping WhatsApp messages for manual sending.
- No WhatsApp API integration or automatic message sending.
- Order creation rate limit (five submissions per source IP per ten minutes) plus additional Cloudflare edge rate limiting recommended.
- Setup, security, business-readiness and deployment guides.

## Architecture

Cloudflare Worker serves the static site and API. D1 stores order data. R2 stores private invoice PDFs. No customer login, marketing analytics, payment gateway or customer account is included. The admin page is `/admin/` and uses an HttpOnly, Secure, SameSite=Strict cookie session; WhatsApp is the customer communication channel, not the admin control plane.

## Local development

Prerequisites: Node.js 20+ and npm. This repository uses Wrangler 4.

1. Install dependencies:

   ```bash
   npm install
   ```
2. Create local D1 database and R2 bucket (local R2 is emulated by Wrangler):

   ```bash
   npx wrangler d1 create mistbean-db
   npx wrangler r2 bucket create mistbean-invoices
   ```
3. Put the D1 `database_id` returned by Cloudflare into `wrangler.jsonc` in place of `REPLACE_AFTER_CREATE`.
4. Apply the local migration:

   ```bash
   npm run db:local
   ```
5. Create `.dev.vars` from `.dev.vars.example`. Generate a password hash:

   ```bash
   npm run admin:hash -- "your-unique-password-of-at-least-14-characters"
   ```
   Put the printed hash in `ADMIN_PASSWORD_HASH`. Set `ADMIN_EMAIL`, a random `SESSION_SECRET` of at least 32 characters, and `WHATSAPP_MODE=mock`.
6. Run locally:

   ```bash
   npm run dev
   ```
7. Open the local URL printed by Wrangler. Admin: `/admin/`.

The local development flow needs Cloudflare's local D1 emulator; it does not need Docker or PostgreSQL.

## Cloudflare setup and deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Do not run production migrations or deploy until the business configuration and number onboarding decisions have been reviewed.

## Admin workflow

1. Open `/admin/` and sign in.
2. Review a pending order.
3. Confirm it and enter the delivery charge, or reject it with a reason.
4. Collect payment through the business's UPI method.
5. Verify the actual bank/UPI credit; do not rely on a customer screenshot alone.
6. Mark payment as verified and generate the invoice.
7. Download the invoice PDF and attach it manually to the personal WhatsApp message.
8. Mark dispatch and delivery.

The admin page is intentionally a separate web page because a business WhatsApp number cannot send commands to itself. It avoids needing a second admin phone number.

## WhatsApp behaviour — manual only

- No WhatsApp Business Cloud API, Meta templates, API tokens, webhook sending or unofficial WhatsApp automation.
- Admin actions prepare a message and open the official wa.me click-to-chat draft. The owner must review and press Send.
- Invoice PDFs are downloaded from the private admin dashboard and attached manually in WhatsApp.
- Dashboard status is marked sent only after the owner confirms that they personally sent the message.
- Keep customer contact details limited to order fulfilment and applicable privacy requirements.

## Important launch blockers

- Prices in the seed migration are provisional and must be confirmed.
- Delivery charges are entered manually by the admin at confirmation.
- Roast choice is not offered because actual roast availability has not been confirmed.
- Ground coffee is recorded as a form preference; grind size is confirmed manually before fulfilment.
- Business legal name/address, FSSAI registration/licence details, GST position and invoice wording must be verified before sale.
- The invoice PDF is a basic commercial invoice layout, not a CA-reviewed statutory/tax invoice. Its legal fields need review.
- No inventory reservation, refunds, cancellations, return workflow, shipping-provider integration or automated reconciliation is included.
- Configure Cloudflare WAF/rate limiting, custom domain, backups, alerting and production access controls before launch.

## Security notes

- Never commit `.dev.vars`, API tokens, admin hashes, session secrets or customer data.
- Use Cloudflare Worker Secrets for production credentials.
- Use a unique admin password and rotate it if exposed. Add Cloudflare Access or another MFA-protected access layer to `/admin/*` before public launch.
- Restrict admin access; do not expose D1 or R2 publicly.
- Keep WhatsApp opt-in explicit and store the consent flag with the order.
- The order API stores customer phone/address to fulfil the order. Set a reviewed retention schedule and follow applicable Indian privacy, tax and food-business obligations.


## Manual WhatsApp + UPI workflow

1. Configure UPI_ID, UPI_PAYEE_NAME and PUBLIC_BASE_URL as needed. Never store a UPI PIN, OTP or bank password.
2. Run npm run db:local and npm run dev.
3. Customer places an order; it appears in /admin/.
4. Owner confirms the order and enters delivery charge. The dashboard shows product subtotal, delivery and final payable amount.
5. Choose Request Payment. The app opens the customer's WhatsApp chat with a payment-page link. Review and press Send manually. The customer opens the branded payment page and can tap Pay using UPI app, scan the order-specific QR, or copy the UPI ID.
6. Customer pays and shares UTR/screenshot. Owner independently checks the bank app, enters the UTR and marks payment PAID.
7. Generate invoice, download its PDF, copy the invoice message, open WhatsApp, attach the PDF and press Send manually. Then mark invoice sent.
8. Enter courier/tracking details. Copy the shipping update, open WhatsApp and send manually. Mark dispatched only after sending.

No message is sent by the server. A UTR or screenshot alone never proves payment. The payment page's UPI deep link and QR prefill the exact order amount and order reference. UPI app availability and deep-link handling depend on the customer's device. The customer must review the payee and amount before authorising payment. Localhost payment links are not reachable by external customers; set PUBLIC_BASE_URL to the public HTTPS storefront origin before real customer orders.

## Local integration test build and security notes

- Migration `0004_test_prices_and_admin_security.sql` sets catalogue prices for future orders to ₹1–₹9 and adds login-attempt throttling. Existing orders are not modified.
- Storefront and admin show a TEST MODE warning. Do not use these prices commercially.
- Admin authentication uses an HttpOnly cookie; browser JavaScript no longer stores an admin bearer token in sessionStorage.
- Admin write requests reject cross-origin Origin headers. Login attempts are limited to five per source IP per 15 minutes.
- Generate a new random `SESSION_SECRET` (at least 32 characters), e.g. `openssl rand -hex 32`. Keep all local secrets in ignored `.dev.vars`.
- Frontend JavaScript and API route names cannot be hidden from browser users. Protect endpoints with server-side authentication, authorisation, validation and rate limiting; never put secrets in frontend code.
