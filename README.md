# Whop Webhook Server

Simple Node.js server that receives Whop payment events and logs the customer email and product purchased for every `invoice_paid` event.

## What it does

- Listens for incoming Whop webhook events on `POST /webhook`
- Verifies the `whop-signature` header using HMAC-SHA256
- Filters for `invoice_paid` events, silently ignores everything else
- Logs customer email, product name, amount, and event ID to the console

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

**3. Run the server**
```bash
# Production
npm start

# Development (auto-restarts on file changes, Node 18+)
npm run dev
```

## Exposing the server to Whop

Whop needs a public URL to send webhook events to. During development, use [ngrok](https://ngrok.com):

```bash
npx ngrok http 3000
```

Copy the generated `https://` URL and add it in your Whop dashboard under **App Settings → Webhooks**, then subscribe to the `invoice_paid` event.

## Example log output

```
--- invoice_paid ---
  Customer : customer@example.com
  Product  : VGB Premium
  Amount   : 49.99 USD
  Event ID : inv_abc123
  Time     : 2026-05-13T15:00:00.000Z
--------------------
```

## Webhook verification

Requests are verified using the `whop-signature` header. Set `WHOP_WEBHOOK_SECRET` in your `.env` to enable it. If the secret is not set, verification is skipped (useful for local testing).
