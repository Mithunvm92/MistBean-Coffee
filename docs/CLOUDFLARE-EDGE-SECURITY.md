# MistBean Coffee — Cloudflare edge security runbook

**Status: preparation only.** No Cloudflare dashboard settings, DNS records, proxy status, secrets, migrations or deployments are changed by this document.

## Safety boundary

Do not change nameservers, DNS, Worker custom domains, production variables, D1 bindings or deploy until the owner explicitly approves a production cutover. Cloudflare account configuration must be applied in the dashboard; this repository connection cannot safely change the user's Cloudflare zone.

## 1. Preflight blockers

Before a domain cutover, verify:

- Cloudflare zone `mistbeancoffee.in` is Active and registrar nameserver delegation is confirmed.
- Worker has the real D1 database ID. Current `wrangler.jsonc` contains `REPLACE_AFTER_CREATE`; this is a production blocker.
- R2 bucket `mistbean-invoices` exists and is private.
- Catalogue prices are approved. Migration `0004_test_prices_and_admin_security.sql` currently sets test prices ₹1–₹9; do not sell using these prices.
- Legal seller details, FSSAI/GST applicability, privacy/retention, returns/refunds and delivery policies are reviewed.
- Staging Worker, separate staging D1/R2 and staging secrets exist.
- Production secrets are Worker Secrets, never committed files.

## 2. Domain proxy and HTTPS

For a Worker-hosted storefront, use **Workers Custom Domain**; do not point an orange-cloud DNS record at a guessed origin IP.

1. In Cloudflare Dashboard, select `mistbeancoffee.in` and verify zone status is Active.
2. Open **Workers & Pages → mistbean-coffee → Settings → Domains & Routes**.
3. Add `mistbeancoffee.in` as a Custom Domain only during an approved cutover. Cloudflare provisions DNS and edge certificate for the Worker custom domain.
4. Add `www.mistbeancoffee.in` only if required; decide the canonical host and redirect deliberately.
5. Do not create guessed A/AAAA records or proxy an unrelated origin.
6. In **SSL/TLS → Edge Certificates**, enable **Always Use HTTPS** after HTTPS is verified. Set minimum TLS 1.2 and keep TLS 1.3 enabled.
7. Enable HSTS only after every intended hostname/subdomain is HTTPS-ready. Start with a short max-age; do not enable includeSubDomains or preload until all subdomains are verified.
8. Coordinate DNSSEC DS records with the registrar; do not change nameservers/DS records during this preparation.

Do not enable Cache Everything for the storefront/API.

## 3. Managed WAF

Under **Security → WAF → Managed rules** (dashboard labels may vary):

- Enable Cloudflare Managed Ruleset.
- Enable OWASP Core Ruleset at default sensitivity initially.
- Review Security Events during staging tests before adding exceptions.
- Do not disable a whole ruleset for one false positive; add a narrow, documented exception.
- Enable Bot Fight Mode only after verifying it does not block checkout or webhook clients. Avoid aggressive interactive challenges on API routes.

## 4. Custom WAF rule starting points

Validate expressions in the dashboard expression builder and stage in Log/Simulate mode before Block.

**Block unsupported methods on API paths**:

```text
(http.host in {"mistbeancoffee.in" "www.mistbeancoffee.in"}
 and starts_with(http.request.uri.path, "/api/")
 and not http.request.method in {"GET" "POST" "OPTIONS"})
```

Action: Block. Keep OPTIONS during compatibility testing; remove it only if verified unnecessary.

**Optional admin-path challenge**:

```text
(http.host in {"mistbeancoffee.in" "www.mistbeancoffee.in"}
 and (http.request.uri.path eq "/admin" or starts_with(http.request.uri.path, "/admin/")))
```

Action: Managed Challenge only if needed. Cloudflare Access is the actual admin gate; a challenge is not authentication. Test the admin application and API requests before enforcement.

Do not invent WAF body-size fields or rely on WAF to replace Worker request-body limits.

## 5. Rate limiting

Create **Security → WAF → Rate limiting rules**. Use Log/Simulate first where available; tune against real traffic, then enforce. Suggested starting policies:

| Path | Threshold | Action |
|---|---:|---|
| `/api/admin/login` | 5 requests / minute / source IP | Challenge or block for 10 minutes |
| `/api/orders` | 5 requests / 10 minutes / source IP | Challenge or block for 10 minutes |
| `/api/admin/*` | 60 requests / minute / source IP | Challenge or block for 10 minutes |
| `/api/webhooks/whatsapp` | No interactive challenge | Preserve signature verification; tune a high threshold only if needed |

Plan capabilities, counting characteristics and action availability vary. Do not challenge WhatsApp webhook POSTs; Meta cannot solve browser challenges. Retain application/D1 rate limits as defence in depth.

## 6. Cloudflare Access for admin

Under **Zero Trust → Access → Applications → Add application → Self-hosted**, protect:

- `mistbeancoffee.in/admin/*`
- `mistbeancoffee.in/api/admin/*`

If path matching requires separate applications, create two. Use Allow only for the owner's verified email (and explicitly authorised staff), require MFA, and set a reasonable session lifetime. Never allow Everyone.

Keep the existing MistBean application login as a second layer. Do not protect public customer paths such as `/`, `/api/content`, `/api/orders`, `/pay/*`, or the WhatsApp webhook.

Test in a private browser:
1. Admin page prompts for Access authentication.
2. Existing MistBean admin login is still required.
3. Admin API works only after both layers.
4. Customer order flow, payment route and WhatsApp webhook remain publicly reachable as intended.

## 7. Cache rules

Under **Caching → Cache Rules**, bypass cache for:

- `/api/*`
- `/pay/*`
- `/admin/*`
- `/api/admin/*`

Never cache customer PII, order/payment state, sessions, invoices or webhook responses. Static versioned assets may use normal asset caching. Preserve `Cache-Control: no-store` for sensitive responses.

## 8. Additional edge/account controls

- Enable Browser Integrity Check if staging confirms no legitimate-client breakage.
- Confirm Cloudflare DDoS protection is active (network protection is generally automatic).
- Configure notifications for WAF blocks, rate-limit events and unusual traffic where supported.
- Protect the Cloudflare account with MFA and least-privilege member roles.
- Keep D1/R2 private; invoice retrieval must remain authenticated.
- Store Worker credentials as secrets. Never put tokens in `wrangler.jsonc`, browser JavaScript, GitHub or screenshots.
- Preserve raw-body WhatsApp webhook HMAC verification and event deduplication; do not apply interactive challenges to it.

## 9. Application checks required in addition to edge security

Before production verify:
- Every admin API route checks application session and authorisation server-side.
- Login throttling, strong password hashing, session expiry and logout/revocation work.
- State-changing requests have Origin/CSRF protection as well as SameSite cookies.
- JSON body size is bounded before parsing and unsupported content types are rejected.
- Order endpoint validates all fields and calculates prices from D1 only.
- Payment redirect accepts confirmed unpaid orders only and derives amount/payee server-side.
- Webhook HMAC is checked against the raw body and event IDs are deduplicated.
- Errors/logs do not expose stack traces, secrets, session cookies or customer PII.
- CSP is tested against actual storefront/admin assets; do not add wildcard script sources or unsafe-eval to silence violations.

## 10. Staging acceptance

- [ ] HTTPS and HTTP→HTTPS redirect work for every intended hostname.
- [ ] Valid certificate and TLS policy.
- [ ] WAF managed rules enabled; no false positives on checkout.
- [ ] Rate limits trigger at expected thresholds.
- [ ] Admin requires Access MFA and application login.
- [ ] Customer order flow remains public and functional.
- [ ] WhatsApp webhook works without challenge and rejects invalid signatures.
- [ ] API/payment/admin/invoice responses are not cached.
- [ ] D1/R2 are not public.
- [ ] Unknown, pending, rejected and already-paid orders cannot redirect to UPI.
- [ ] Test prices replaced by approved catalogue prices before commercial use.
- [ ] D1 backup/restore and R2 retention tested.

## 11. Production cutover — separate explicit approval required

Only after staging sign-off and explicit owner approval:
1. Confirm the correct Cloudflare account and Active zone.
2. Export current DNS records and document rollback.
3. Verify Worker, D1, R2 and production secrets.
4. Approve canonical hostname and Worker Custom Domain.
5. Apply Access, WAF, rate limits, cache bypass and TLS controls.
6. Connect custom domain and verify DNS/certificate.
7. Deploy the approved Worker version.
8. Run production smoke tests and monitor Security Events.
9. Keep the previous site and DNS rollback plan available.

**No production DNS, proxy, Cloudflare dashboard, secrets, migrations or deployment changes have been made by preparing this runbook.**
