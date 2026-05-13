const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WHOP_WEBHOOK_SECRET;

// Raw body needed for signature verification
app.use(express.raw({ type: "application/json" }));

function verifySignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return true; // skip verification if no secret configured
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

app.post("/webhook", (req, res) => {
  const signature = req.headers["whop-signature"];

  if (WEBHOOK_SECRET && !signature) {
    console.warn("Missing whop-signature header");
    return res.status(401).json({ error: "Missing signature" });
  }

  if (WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    console.warn("Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let payload;
  try {
    payload = JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { action, data } = payload;

  if (action !== "invoice_paid") {
    return res.status(200).json({ received: true, skipped: action });
  }

  const email = data?.user?.email ?? data?.customer?.email ?? "(unknown email)";
  const product = data?.plan?.name ?? data?.product?.name ?? data?.membership?.plan?.name ?? "(unknown product)";
  const amount = data?.total ?? data?.amount;
  const currency = (data?.currency ?? "usd").toUpperCase();

  console.log("--- invoice_paid ---");
  console.log(`  Customer : ${email}`);
  console.log(`  Product  : ${product}`);
  if (amount != null) {
    console.log(`  Amount   : ${(amount / 100).toFixed(2)} ${currency}`);
  }
  console.log(`  Event ID : ${data?.id ?? "(none)"}`);
  console.log(`  Time     : ${new Date().toISOString()}`);
  console.log("--------------------");

  res.status(200).json({ received: true });
});

app.listen(PORT, () => {
  console.log(`Whop webhook server listening on port ${PORT}`);
  if (!WEBHOOK_SECRET) {
    console.warn("Warning: WHOP_WEBHOOK_SECRET not set — skipping signature verification");
  }
});
