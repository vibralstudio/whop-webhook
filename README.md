# Whop Webhook Server

Node.js/Express server that powers the Vibral Studio Custom Growth Blueprint pipeline. Handles Whop payment events, sends customers a Typeform onboarding link, then processes Typeform submissions end-to-end: Claude generates a personalized blueprint, pdfkit renders it as a branded PDF, and SendGrid delivers it to the customer.

## How it works

```
Whop invoice_paid  →  /webhook  →  sends Typeform link to customer
                                              ↓
                              customer fills out 45-question form
                                              ↓
Typeform submit  →  /typeform-webhook  →  Claude generates blueprint
                                              ↓
                                        pdfkit renders PDF
                                              ↓
                                        SendGrid sends PDF to customer
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns server status and current timestamp |
| `POST` | `/webhook` | Receives Whop `invoice_paid` events, emails customer a Typeform link |
| `POST` | `/typeform-webhook` | Receives Typeform submissions, generates and delivers blueprint PDF |

## Setup

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to get it |
|----------|----------------|
| `PORT` | Port to run the server on (default: `3000`) |
| `WHOP_WEBHOOK_SECRET` | Whop dashboard → Your app → Webhooks → Signing secret |
| `TYPEFORM_API_TOKEN` | [admin.typeform.com](https://admin.typeform.com) → Account → Personal tokens |
| `SENDGRID_API_KEY` | [app.sendgrid.com](https://app.sendgrid.com) → Settings → API Keys |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |

> The `from` address (`contact@vibralstudio.com`) must be verified in SendGrid under Settings → Sender Authentication before emails will send.

**3. Run the server**
```bash
# Production
npm start

# Development (auto-restarts on file changes, Node 18+)
npm run dev
```

## Deployment

The server is deployed on Railway at:
```
https://whop-webhook-production.up.railway.app
```

Set **all five** environment variables in Railway's dashboard (Variables tab):

| Variable | Required |
|----------|----------|
| `WHOP_WEBHOOK_SECRET` | Yes |
| `TYPEFORM_API_TOKEN` | Yes — get from admin.typeform.com → Account → Personal tokens |
| `SENDGRID_API_KEY` | Yes |
| `ANTHROPIC_API_KEY` | Yes |
| `PORT` | No (Railway sets this automatically) |

> `TYPEFORM_API_TOKEN` is required since the server fetches Typeform answers via API. Without it the server will refuse to start.

**Whop**: Add `https://whop-webhook-production.up.railway.app/webhook` in your Whop dashboard under **App Settings → Webhooks** and subscribe to the `invoice_paid` event.

**Typeform**: Add `https://whop-webhook-production.up.railway.app/typeform-webhook` as a webhook in your Typeform form settings. Also add `email` as a hidden field in the form — the Whop webhook pre-fills it via URL parameter so it flows through to the Typeform submission.

## Project structure

```
server.js                    # Express app, webhook handlers
lib/
  generate-blueprint.js      # Calls Claude to write the personalized blueprint
  generate-pdf.js            # Renders blueprint markdown → branded PDF via pdfkit
  send-blueprint-email.js    # Sends the PDF attachment via SendGrid
assets/
  vgb-base.txt               # VGB framework document (source material for Claude)
  Syne-Bold.ttf              # Custom font — headers and labels
  Syne-Regular.ttf           # Custom font — body text
```

## Local testing

**Health check**
```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-05-13T20:12:11.919Z"}
```

**Whop webhook (without signature verification)**

Omit `WHOP_WEBHOOK_SECRET` from `.env`, then:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "action": "invoice_paid",
    "data": {
      "id": "inv_test",
      "user": { "email": "customer@example.com" },
      "plan": { "name": "VGB Premium" },
      "total": 4999,
      "currency": "usd"
    }
  }'
```

**Whop webhook (with signature verification)**

```bash
node -e "
const crypto = require('crypto');
const body = '{\"action\":\"invoice_paid\",\"data\":{\"id\":\"inv_test\",\"user\":{\"email\":\"customer@example.com\"},\"plan\":{\"name\":\"VGB Premium\"},\"total\":4999,\"currency\":\"usd\"}}';
const sig = crypto.createHmac('sha256', process.env.WHOP_WEBHOOK_SECRET).update(body).digest('hex');
console.log(sig);
"
```

Pass the output as the `whop-signature` header in your curl request.

**Typeform webhook**

The server now fetches answers from the Typeform API using the `form_response.token` from the webhook payload. Pass a real response token (find one in your Typeform Results tab):

```bash
curl -X POST http://localhost:3000/typeform-webhook \
  -H "Content-Type: application/json" \
  -d '{"form_response": {"token": "YOUR_RESPONSE_TOKEN_HERE"}}'
```

## Example log output

```
--- invoice_paid ---
  Customer : customer@example.com
  Product  : VGB Premium
  Amount   : 49.99 USD
  Event ID : inv_abc123
  Time     : 2026-05-13T15:00:00.000Z
  Typeform email sent → customer@example.com
--------------------

--- typeform_response ---
  Token   : a3a12ec67a1365927098a606107fac15
  Email   : customer@example.com
  Answers : 45
-------------------------
  Generating blueprint with Claude...
  Generating PDF...
  Sending blueprint email → customer@example.com
  Blueprint delivered to customer@example.com
```

## Webhook verification

Whop requests are verified using the `whop-signature` header via HMAC-SHA256. Set `WHOP_WEBHOOK_SECRET` in your `.env` to enable it. If the secret is not set, verification is skipped (useful for local testing).
