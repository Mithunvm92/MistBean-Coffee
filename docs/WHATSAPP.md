# WhatsApp Cloud API onboarding and templates

## Number status and decision

The current MistBean number is on personal WhatsApp Messenger. This project does not migrate it. First back up chats and decide whether to convert to WhatsApp Business App. Check current Meta eligibility and supported onboarding/coexistence options in the Meta Business Portfolio. Coexistence is associated with eligible WhatsApp Business App numbers; do not assume a personal Messenger number can be connected directly while retaining the same app setup.

Meta developer entry point: https://whatsappbusiness.com/developers/developer-hub/

## Required Meta assets

- Meta Business Portfolio and WhatsApp Business Account.
- Meta developer app with WhatsApp product.
- Phone Number ID, permanent/system-user access token and app secret.
- Verified webhook callback URL: `https://YOUR_DOMAIN/api/webhooks/whatsapp`.
- A random verify token matching `WHATSAPP_VERIFY_TOKEN`.
- Appropriate messaging permissions and approved message templates.

Keep access tokens in Worker Secrets only. Never commit them or place them in browser code.

## Template layouts used by this project

Create and get approval for utility templates in English with the exact names below (or change the Worker variables to the approved names). Match the parameter count and order exactly.

### `mistbean_order_received`

Body: `Hello {{1}}, we received your MistBean order {{2}} for {{3}} ({{4}}). Your current product subtotal is {{5}}. We will confirm availability and delivery charges before payment.`

Parameters: customer name, order reference, product name, pack and quantity, subtotal.

### `mistbean_order_update`

Body: `Hello {{1}}, your MistBean order {{2}} status is {{3}}. {{4}}. Please contact us if you need help.`

Parameters: customer name, order reference, status, final amount/reason/status note.

### `mistbean_invoice`

Header: Document (PDF)

Body: `Your MistBean Coffee invoice {{1}} is attached. Thank you for your order.`

Parameter: invoice number.

The code uses template messages for order and status notifications. Invoice sending uploads the PDF to Meta media and sends it using the approved document-header template. Confirm template category, language code and current Meta policies in the Business Manager before enabling.


### UPI payment link (Cloud API and manual mode)

The payment sequence is **confirm first, then pay**. An admin confirms stock and delivery charges. Only then can the admin send the payment request. The Worker reads the final total from D1 and creates an HTTPS link in this format: `https://YOUR_DOMAIN/pay/ORDER_REFERENCE`. On a mobile device, opening that link redirects to a `upi://pay` URI with the configured payee, UPI ID, exact confirmed amount, INR currency and order reference. UPI app hand-off depends on the customer's device and installed payment apps.

Create and get approval for a body-only utility template named `mistbean_payment_request` (or set `WHATSAPP_TEMPLATE_PAYMENT` to the exact approved name):

- Category: Utility (Meta makes the final classification)
- Language: English (`en`)
- Header: None
- Body: `Hello {{1}}, your MistBean order {{2}} is confirmed. Total payable: {{3}}. UPI ID: {{4}}. Tap this link to pay using your UPI app: {{5}}. After payment, reply with your UTR. We will verify the credit before dispatch. Thank you, MistBean Coffee.`
- Body parameter order: customer name, order reference, total payable (INR), UPI ID, HTTPS payment URL.

The template must be approved by Meta before Cloud API mode can send it. In `WHATSAPP_MODE=mock`, the admin portal opens a prefilled WhatsApp chat containing the HTTPS payment link; the admin reviews and sends it. Customer WhatsApp opt-in is required for either mode.

Set `PUBLIC_BASE_URL` to the public HTTPS storefront origin (for example `https://mistbeancoffee.in`) before sending live payment links. For local Wrangler development, the Worker may use its localhost origin when `PUBLIC_BASE_URL` is not set. Do not set a path, query string or fragment in `PUBLIC_BASE_URL`.

The public payment endpoint reveals no customer PII, does not accept an amount or UPI ID from the browser, and only redirects confirmed unpaid orders. It returns an error for unknown, unconfirmed or already-paid orders. The UPI link is not proof of payment: an admin must independently verify the actual bank credit and UTR before marking the order paid. Invoice and dispatch checks remain unchanged.

## Customer consent and messaging window

The order form has an optional explicit checkbox for WhatsApp order updates and invoice delivery. Customers who do not opt in can still submit an order, but the system will not send automated customer messages or invoices to them. For business-initiated messages outside the customer-service window, use approved templates. Respect opt-outs and current WhatsApp policies.

## Admin channel

The sender number cannot message itself as a separate admin recipient. This build uses the private `/admin/` portal for admin actions. The WhatsApp number is used for customer communications. If you later want WhatsApp-based admin commands, use a separate authorised admin number and implement strict sender allowlisting; that is not included in this release.
