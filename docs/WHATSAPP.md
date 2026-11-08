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


### Payment request with QR image (Cloud API mode)

The admin action **Send payment details on WhatsApp** sends the QR as an actual image message only when `WHATSAPP_MODE=meta`. The Worker generates the QR PNG, uploads it to the WhatsApp media endpoint, then sends an approved image-header template to the customer. It does not open a prefilled chat in this mode.

Create and get approval for a template named `mistbean_payment_request` (or set `WHATSAPP_TEMPLATE_PAYMENT` to the exact approved name):

- Category: Utility (Meta makes the final classification)
- Language: English (`en`)
- Header: Image
- Body: `Hello {{1}}, your MistBean order {{2}} is confirmed. Total payable: {{3}}. UPI ID: {{4}}. Use this UPI payment link: {{5}}. After paying, reply with your UTR. We will verify the credit before dispatch.`
- Body parameter order: customer name, order reference, total payable (INR), UPI ID, UPI URI.

The image header is populated with the generated QR media ID. The approved template is required so the business can initiate the payment message outside the 24-hour customer-service window. The customer must still have opted in. Meta approval and correct template name/language/header/body parameter order are required for successful sending.

Set `WHATSAPP_MODE=meta`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`, and `WHATSAPP_TEMPLATE_PAYMENT` as Worker secrets/variables (for local testing, use `.dev.vars`). Never put the token in frontend JavaScript or commit it. With `WHATSAPP_MODE=mock`, the app only opens a prefilled WhatsApp chat; it cannot attach an image automatically and the admin must attach the QR PNG manually.

**QR privacy note:** this implementation currently retrieves the PNG from `api.qrserver.com`. That service receives the UPI URI (UPI ID, payee name, amount and order reference). Before production, replace it with a QR encoder bundled locally in the Worker if you do not want a third party to receive payment URI data.

## Customer consent and messaging window

The order form has an optional explicit checkbox for WhatsApp order updates and invoice delivery. Customers who do not opt in can still submit an order, but the system will not send automated customer messages or invoices to them. For business-initiated messages outside the customer-service window, use approved templates. Respect opt-outs and current WhatsApp policies.

## Admin channel

The sender number cannot message itself as a separate admin recipient. This build uses the private `/admin/` portal for admin actions. The WhatsApp number is used for customer communications. If you later want WhatsApp-based admin commands, use a separate authorised admin number and implement strict sender allowlisting; that is not included in this release.
