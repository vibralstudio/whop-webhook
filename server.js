const express = require("express");
const crypto = require("crypto");
const sgMail = require("@sendgrid/mail");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WHOP_WEBHOOK_SECRET;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const TYPEFORM_URL = "https://form.typeform.com/to/EIeqF5OS";

if (SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);

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

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

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

  if (SENDGRID_API_KEY && email !== "(unknown email)") {
    sendTypeformEmail(email, product).catch((err) =>
      console.error("SendGrid error:", err.response?.body ?? err.message)
    );
  } else if (!SENDGRID_API_KEY) {
    console.warn("SENDGRID_API_KEY not set — skipping email");
  }

  res.status(200).json({ received: true });
});

async function sendTypeformEmail(customerEmail, product) {
  await sgMail.send({
    to: customerEmail,
    from: "vibralstudio@gmail.com",
    subject: "One quick thing before you get started",
    text: [
      `Thanks for purchasing ${product}!`,
      "",
      "Before you dive in, we'd love to learn a bit more about you so we can make your experience as good as possible.",
      "",
      `Fill out this quick form (takes 2 minutes): ${TYPEFORM_URL}`,
      "",
      "Talk soon,",
      "Vibral Studio",
    ].join("\n"),
    html: `
      <p>Thanks for purchasing <strong>${product}</strong>!</p>
      <p>Before you dive in, we'd love to learn a bit more about you so we can make your experience as good as possible.</p>
      <p><a href="${TYPEFORM_URL}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Fill out the quick form</a></p>
      <p style="color:#666;font-size:13px;">Or copy this link: ${TYPEFORM_URL}</p>
      <p>Talk soon,<br>Vibral Studio</p>
    `,
  });
  console.log(`  Email sent → ${customerEmail}`);
}

app.listen(PORT, () => {
  console.log(`Whop webhook server listening on port ${PORT}`);
  if (!WEBHOOK_SECRET) {
    console.warn("Warning: WHOP_WEBHOOK_SECRET not set — skipping signature verification");
  }
});
