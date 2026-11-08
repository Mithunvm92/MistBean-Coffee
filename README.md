# MistBean Coffee — Cloudflare ordering platform

A deployable starter for MistBean's customer storefront, order intake API, private admin desk, D1 database, R2 invoice storage and WhatsApp Cloud API adapter.

**Current safety mode:** `WHATSAPP_MODE=mock`. The code does not send real WhatsApp messages until Meta onboarding, approved templates and secrets are configured. Nothing in this package changes or migrates the existing phone number.

## Included

- Existing MistBean customer storefront, adapted to submit orders to `/api/orders`.
- Server-side catalogue pricing; browser-submitted prices are never trusted.
- D1 schema for products, orders, admin sessions, audit events, webhook deduplication, rate-limit records and invoice sequence.
- Private admin sign-in and order dashboard.
- Confirm/reject orders, set delivery charge, verify payment, mark dispatch/delivery.
- PDF invoice generation after payment verification, stored in private R2.
- Optional WhatsApp Cloud API template notifications and invoice document delivery.
- WhatsApp webhook verification endpoint with HMAC signature validation when `WHATSAPP_APP_SECRET` is configured.
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
7. Download the invoice or send it through WhatsApp if the Cloud API and approved invoice template are configured.
8. Mark dispatch and delivery.

The admin page is intentionally a separate web page because a business WhatsApp number cannot send commands to itself. It avoids needing a second admin phone number.

## WhatsApp behaviour

- In mock mode, no messages are sent.
- In Meta mode, the customer must tick the optional transactional WhatsApp consent checkbox for automated customer notifications/invoice delivery.
- Template messages are used because business-initiated messages outside the customer-service window require approved templates. Configure approved templates whose names and parameter layouts match `docs/WHATSAPP.md`.
- The same business number cannot be its own admin recipient. Admins operate through `/admin/`; do not configure `ORDER_NOTIFY_PHONE` as the same sender number expecting a self-notification.
- Webhook endpoint: `GET/POST /api/webhooks/whatsapp`.
- The webhook currently verifies/records incoming event IDs; it does not parse incoming free-text commands or control orders from WhatsApp.

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


## Local WhatsApp + UPI manual payment workflow

1. Copy `.dev.vars.example` to `.dev.vars` if you have not already done so.
2. Set `UPI_ID` to the UPI ID that should receive test payments and set `UPI_PAYEE_NAME` to the exact payee name shown by the UPI app. Never put a UPI PIN, OTP, bank password or card credentials in this file.
3. Apply the new local D1 migration: `npx wrangler d1 migrations apply mistbean-db --local`.
4. Start the local app with `npm run dev`.
5. The customer must tick the WhatsApp consent checkbox while placing an order.
6. In `/admin/`, confirm the order and enter the delivery charge. Then choose **Send payment details on WhatsApp**. This opens a prefilled WhatsApp chat; the admin must review and press Send. The message includes the UPI ID, amount, UPI intent link and a QR image link.
7. The customer pays in their own UPI app and replies with the UTR/reference. The admin must independently verify the matching credit in the linked bank account before entering the reference and marking the payment PAID.
8. Generate and download the invoice. Open the invoice WhatsApp message, attach the downloaded PDF and send it. Return to the admin panel and click **Mark invoice sent** only after the message has actually been sent.
9. Record courier/tracking details and mark dispatched. The prefilled dispatch WhatsApp message opens for the admin to review and send.

In local `WHATSAPP_MODE=mock`, WhatsApp is click-to-chat/manual. The project does not send messages automatically. The QR image URL is generated by the external QR Server service and contains only the UPI payment URI (UPI ID, amount and order reference); do not use it if you do not want payment details sent to that service. For production, replace this with a locally generated QR implementation or an approved payment-provider QR. A UTR/reference or screenshot is not proof of payment; confirm the bank credit independently.

## Local integration test build and security notes

- Migration `0004_test_prices_and_admin_security.sql` sets catalogue prices for future orders to ₹1–₹9 and adds login-attempt throttling. Existing orders are not modified.
- Storefront and admin show a TEST MODE warning. Do not use these prices commercially.
- Admin authentication uses an HttpOnly cookie; browser JavaScript no longer stores an admin bearer token in sessionStorage.
- Admin write requests reject cross-origin Origin headers. Login attempts are limited to five per source IP per 15 minutes.
- Regenerate the password hash with `npm run admin:hash -- "your-new-unique-password-at-least-14-chars"` and update local `.dev.vars`. The PBKDF2 salt encoding has been corrected.
- Generate a new random `SESSION_SECRET` (at least 32 characters), e.g. `openssl rand -hex 32`. Rotate any secret ever committed or shared.
- QR download returns a PNG but currently obtains it from `api.qrserver.com`. That provider receives the UPI URI, including UPI ID, payee name, amount and order reference. This is a testing implementation, not the preferred production privacy design; use a locally bundled QR encoder before production.
- Admin clicks **Download UPI QR**, then manually attaches the PNG in WhatsApp. Click-to-chat cannot attach files automatically.
- Frontend JavaScript and API route names cannot be hidden from browser users. Protect endpoints with server-side authentication, authorisation, validation and rate limiting; never put secrets in frontend code.


## Send payment request with QR image

To send the QR image automatically with the payment request, configure WhatsApp Cloud API (`WHATSAPP_MODE=meta`) and get the image-header template `mistbean_payment_request` approved in Meta. Set `WHATSAPP_TEMPLATE_PAYMENT` to that exact template name. The Worker uploads the generated QR PNG to WhatsApp and sends it with the approved template. In `mock` mode, WhatsApp is only opened with prefilled text and image attachment remains manual. See `docs/WHATSAPP.md` for the exact template body and parameter order.
