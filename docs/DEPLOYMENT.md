# Cloudflare deployment checklist

## A. Before touching production

- [ ] Confirm final products, prices, blend options and stock.
- [ ] Confirm delivery zones, charges and delivery timelines.
- [ ] Confirm seller legal name and full business address.
- [ ] Obtain/verify applicable FSSAI registration/licence and packaged-food label details.
- [ ] Have an accountant confirm GST registration and invoice requirements.
- [ ] Approve privacy, cancellation, refund, shipping and terms policies.
- [ ] Decide customer-data retention period and deletion process.
- [ ] Confirm whether the existing phone number will be moved from personal WhatsApp Messenger to WhatsApp Business App. Do not migrate without a backup and owner approval.

## B. Create Cloudflare resources

1. Create/login to the Cloudflare account.
2. From this project directory run:

   ```bash
   npm install
   npx wrangler login
   npx wrangler d1 create mistbean-db
   npx wrangler r2 bucket create mistbean-invoices
   ```
3. Copy the D1 database ID into `wrangler.jsonc`. Keep the R2 bucket name consistent.
4. Review the Worker name, compatibility date and asset binding.
5. Apply the schema only after confirming you are targeting the intended database:

   ```bash
   npm run db:remote
   ```

## C. Configure production secrets

Generate a password hash locally with `npm run admin:hash -- "..."`. Then configure secrets (never put them in `wrangler.jsonc`):

```bash
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put SESSION_SECRET
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
```

`ADMIN_EMAIL` is stored as a secret for simplicity. Set a unique high-entropy session secret. Only configure WhatsApp credentials after Meta onboarding and template approval. Set `WHATSAPP_MODE` to `meta` only after a controlled test; leave it `mock` otherwise.

Set non-secret variables in `wrangler.jsonc` or Cloudflare Worker settings: `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_ORDER_RECEIVED`, `WHATSAPP_TEMPLATE_ORDER_UPDATE`, `WHATSAPP_TEMPLATE_INVOICE`, `SELLER_LEGAL_NAME`, `SELLER_ADDRESS`, `SELLER_GSTIN`, `FSSAI_LICENSE_NUMBER`, `UPI_ID`, and `UPI_PAYEE_NAME`.

## D. Deploy to a staging URL first

Create a separate staging Worker with its own D1 database, R2 bucket and secrets before deploying. Do not point staging at production data. Once the staging configuration is set up, deploy that staging configuration with Wrangler. This starter deliberately does not preconfigure named environments to avoid accidentally sharing a production database. The production `wrangler deploy` command should only be run after staging sign-off and explicit owner approval.

Run the smoke tests in `docs/TESTING.md`. Confirm the admin page is protected and that mock mode does not send messages.

## E. Protect the admin route

Before production, configure Cloudflare Access (or an equivalent MFA-backed access proxy) for `/admin/*`. Keep the application login as a second layer. Add Cloudflare WAF custom rules/rate limiting for `/api/admin/login` and `/api/orders`. Do not rely solely on the application-level order rate limit.

## F. Domain and go-live

1. Connect the MistBean domain to the Worker/custom domain using Cloudflare DNS.
2. Verify HTTPS, redirects, caching and security headers.
3. Verify the website's customer form and admin page on mobile and desktop.
4. Test one end-to-end order with a test number and mock mode.
5. Test WhatsApp templates using Meta's test number before connecting the real number.
6. Only after business and Meta checks, decide whether to enable the real number and set `WHATSAPP_MODE=meta`.
7. Review Cloudflare D1 backups/restore and R2 retention settings.
8. Keep the existing website as rollback until the new site is accepted.

## Rollback

Cloudflare Workers supports versioned deployments. Keep the previous production version available and use the Cloudflare dashboard/CLI rollback controls if a deployment fails. D1/R2 data changes are separate from Worker code versions; take a database backup before schema changes.
