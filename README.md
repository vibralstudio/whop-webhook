# Whop Webhook Server

Node.js server that receives Whop payment events. On every `invoice_paid` event it logs the customer details and automatically emails them a Typeform link via SendGrid.

## What it does

- Listens for incoming Whop webhook events on `POST /webhook`
- Verifies the `whop-signature` header using HMAC-SHA256
- Filters for `invoice_paid` events, silently ignores everything else
- Logs customer email, product name, amount, and event ID to the console
- Emails the customer a Typeform onboarding link via SendGrid

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
| `SENDGRID_API_KEY` | [app.sendgrid.com](https://app.sendgrid.com) → Settings → API Keys |

> The `from` address in `server.js` must be verified in SendGrid under Settings → Sender Authentication before emails will send.

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
https://whop-webhook-production.up.railway.app/webhook
```

Add this URL in your Whop dashboard under **App Settings → Webhooks** and subscribe to the `invoice_paid` event. Set `WHOP_WEBHOOK_SECRET` and `SENDGRID_API_KEY` in Railway's environment variables.

## Local testing

Whop needs a public URL to reach your server. During development, use [ngrok](https://ngrok.com):

```bash
npx ngrok http 3000
```

**Without signature verification** (omit `WHOP_WEBHOOK_SECRET` from `.env`):

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

**With signature verification** (generate a valid `whop-signature`):

```bash
node -e "
const crypto = require('crypto');
const body = '{\"action\":\"invoice_paid\",\"data\":{\"id\":\"inv_test\",\"user\":{\"email\":\"customer@example.com\"},\"plan\":{\"name\":\"VGB Premium\"},\"total\":4999,\"currency\":\"usd\"}}';
const sig = crypto.createHmac('sha256', process.env.WHOP_WEBHOOK_SECRET).update(body).digest('hex');
console.log(sig);
"
# Then pass the output as the whop-signature header in your curl request
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns server status and current timestamp |
| `POST` | `/webhook` | Receives Whop webhook events |

```bash
curl https://whop-webhook-production.up.railway.app/health
# {"status":"ok","timestamp":"2026-05-13T20:12:11.919Z"}
```

## Example log output

```
--- invoice_paid ---
  Customer : customer@example.com
  Product  : VGB Premium
  Amount   : 49.99 USD
  Event ID : inv_abc123
  Time     : 2026-05-13T15:00:00.000Z
  Email sent → customer@example.com
--------------------
```

## Webhook verification

Requests are verified using the `whop-signature` header via HMAC-SHA256. Set `WHOP_WEBHOOK_SECRET` in your `.env` to enable it. If the secret is not set, verification is skipped (useful for local testing).
