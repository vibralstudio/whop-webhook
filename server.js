const express = require("express");
const crypto = require("crypto");
const sgMail = require("@sendgrid/mail");
const { fetchTypeformResponse } = require("./lib/fetch-typeform-response");
const { generateBlueprint } = require("./lib/generate-blueprint");
const { generatePDF } = require("./lib/generate-pdf");
const { sendBlueprintEmail } = require("./lib/send-blueprint-email");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WHOP_WEBHOOK_SECRET;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const TYPEFORM_BASE_URL = "https://form.typeform.com/to/EIeqF5OS";

if (SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);

// Raw body needed for signature verification on Whop webhook
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

function verifyWhopSignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

// ── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Whop webhook ─────────────────────────────────────────────────────────────

app.post("/webhook", (req, res) => {
  const signature = req.headers["whop-signature"];

  if (WEBHOOK_SECRET && !signature) {
    console.warn("Missing whop-signature header");
    return res.status(401).json({ error: "Missing signature" });
  }

  if (WEBHOOK_SECRET && !verifyWhopSignature(req.body, signature)) {
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
  if (amount != null) console.log(`  Amount   : ${(amount / 100).toFixed(2)} ${currency}`);
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
  // Pre-fill customer email as a Typeform hidden field via URL param
  const typeformUrl = `${TYPEFORM_BASE_URL}?email=${encodeURIComponent(customerEmail)}`;

  await sgMail.send({
    to: customerEmail,
    from: "contact@vibralstudio.com",
    subject: "Your Custom Growth Blueprint — here's what to do next",
    text: [
      "Thanks for purchasing your Custom Growth Blueprint.",
      "",
      "Please fill out the form below and take your time answering each question. These answers will teach you a lot about yourself and will help us build your personalized growth system.",
      "",
      typeformUrl,
      "",
      "Talk soon,",
      "Vibral Studio",
    ].join("\n"),
    html: `
      <p>Thanks for purchasing your Custom Growth Blueprint.</p>
      <p>Please fill out the form below and take your time answering each question. These answers will teach you a lot about yourself and will help us build your personalized growth system.</p>
      <p><a href="${typeformUrl}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Fill out the form</a></p>
      <p style="color:#666;font-size:13px;">Or copy this link: ${typeformUrl}</p>
      <p>Talk soon,<br>Vibral Studio</p>
    `,
  });
  console.log(`  Typeform email sent → ${customerEmail}`);
}

// ── Typeform webhook ──────────────────────────────────────────────────────────

app.post("/typeform-webhook", async (req, res) => {
  // Respond immediately so Typeform doesn't retry
  res.status(200).json({ received: true });

  const responseToken = req.body?.form_response?.token;
  if (!responseToken) {
    console.warn("Typeform webhook: no form_response.token in payload");
    return;
  }

  try {
    console.log(`  Fetching response ${responseToken} from Typeform API...`);
    const { email, answers } = await fetchTypeformResponse(responseToken);

    if (!email) {
      console.warn("Typeform webhook: could not determine email from response");
      return;
    }

    console.log(`--- typeform_response ---`);
    console.log(`  Token   : ${responseToken}`);
    console.log(`  Email   : ${email}`);
    console.log(`  Answers : ${answers.length}`);
    console.log(`-------------------------`);

    console.log(`  Generating blueprint with Claude...`);
    const blueprintText = await generateBlueprint(answers);

    console.log(`  Generating PDF...`);
    const pdfBuffer = await generatePDF(blueprintText);

    console.log(`  Sending blueprint email → ${email}`);
    await sendBlueprintEmail(email, pdfBuffer);

    console.log(`  Blueprint delivered to ${email}`);
  } catch (err) {
    console.error("Blueprint pipeline error:", err.message);
    if (err.response?.body) console.error("SendGrid detail:", JSON.stringify(err.response.body));
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Whop webhook server listening on port ${PORT}`);
  if (!WEBHOOK_SECRET) {
    console.warn("Warning: WHOP_WEBHOOK_SECRET not set — skipping signature verification");
  }
});
