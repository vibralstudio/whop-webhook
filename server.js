const express = require('express');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const config = require('./lib/config');
const logger = require('./lib/logger');
const { withRetry } = require('./lib/retry');
const { fetchTypeformResponse } = require('./lib/fetch-typeform-response');
const { generateBlueprint } = require('./lib/generate-blueprint');
const { generatePDF } = require('./lib/generate-pdf');
const { sendBlueprintEmail } = require('./lib/send-blueprint-email');

// Crash at startup if any required env var is missing
config.validateConfig();

const app = express();

// Raw body required for Whop HMAC verification before JSON parsing
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Signature verification ───────────────────────────────────────────────────

function verifyWhopSignature(rawBody, signatureHeader) {
  if (!config.whopWebhookSecret) return true;
  const expected = crypto
    .createHmac('sha256', config.whopWebhookSecret)
    .update(rawBody)
    .digest('hex');
  // Both buffers must be the same length for timingSafeEqual — check first to
  // avoid a thrown ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on malformed headers
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader ?? '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Whop webhook ─────────────────────────────────────────────────────────────

app.post('/webhook', (req, res) => {
  const signature = req.headers['whop-signature'];

  if (config.whopWebhookSecret && !signature) {
    logger.warn('Missing whop-signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  if (!verifyWhopSignature(req.body, signature)) {
    logger.warn('Invalid Whop webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { action, data } = payload;

  if (action !== 'invoice_paid') {
    return res.status(200).json({ received: true, skipped: action });
  }

  const email    = data?.user?.email ?? data?.customer?.email ?? null;
  const product  = data?.plan?.name ?? data?.product?.name ?? data?.membership?.plan?.name ?? '(unknown product)';
  const amount   = data?.total ?? data?.amount;
  const currency = (data?.currency ?? 'usd').toUpperCase();

  logger.info('invoice_paid', {
    email,
    product,
    amount: amount != null ? `${(amount / 100).toFixed(2)} ${currency}` : null,
    eventId: data?.id,
  });

  if (!email) {
    logger.warn('invoice_paid: no customer email found in payload');
    return res.status(200).json({ received: true });
  }

  sendTypeformEmail(email, product).catch((err) =>
    logger.error('sendTypeformEmail failed', { email, error: err.message }),
  );

  return res.status(200).json({ received: true });
});

async function sendTypeformEmail(customerEmail, product) {
  sgMail.setApiKey(config.sendgridApiKey);
  const typeformUrl = `${config.typeformBaseUrl}?email=${encodeURIComponent(customerEmail)}`;

  await withRetry(
    () =>
      sgMail.send({
        to: customerEmail,
        from: config.fromEmail,
        subject: 'Your Custom Growth Blueprint — here\'s what to do next',
        text: [
          'Thanks for purchasing your Custom Growth Blueprint.',
          '',
          'Please fill out the form below and take your time answering each question.',
          'These answers will teach you a lot about yourself and will help us build your personalized growth system.',
          '',
          typeformUrl,
          '',
          'Talk soon,',
          'Vibral Studio',
        ].join('\n'),
        html: `
          <p>Thanks for purchasing your Custom Growth Blueprint.</p>
          <p>Please fill out the form below and take your time answering each question.
          These answers will teach you a lot about yourself and will help us build your personalized growth system.</p>
          <p><a href="${typeformUrl}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Fill out the form</a></p>
          <p style="color:#666;font-size:13px;">Or copy this link: ${typeformUrl}</p>
          <p>Talk soon,<br>Vibral Studio</p>
        `,
      }),
    { attempts: 3, delayMs: 1000, label: 'Typeform onboarding email' },
  );

  logger.info('Typeform email sent', { email: customerEmail });
}

// ── Typeform webhook ──────────────────────────────────────────────────────────

// Track in-flight pipelines for graceful shutdown
let inFlight = 0;

app.post('/typeform-webhook', (req, res) => {
  // Respond immediately so Typeform doesn't retry
  res.status(200).json({ received: true });

  const responseToken = req.body?.form_response?.token;
  if (!responseToken) {
    logger.warn('typeform-webhook: no form_response.token in payload');
    return;
  }

  inFlight++;
  runBlueprintPipeline(responseToken).finally(() => { inFlight--; });
});

async function runBlueprintPipeline(responseToken) {
  const start = Date.now();
  logger.info('Pipeline started', { token: responseToken });

  try {
    const { email, answers } = await fetchTypeformResponse(responseToken);

    if (!email) {
      logger.error('Pipeline aborted: no email found', { token: responseToken });
      return;
    }

    logger.info('Generating blueprint', { token: responseToken, email, answers: answers.length });
    const blueprintText = await generateBlueprint(answers);

    logger.info('Generating PDF', { token: responseToken });
    const pdfBuffer = await generatePDF(blueprintText);

    logger.info('Sending email', { token: responseToken, email });
    await sendBlueprintEmail(email, pdfBuffer);

    logger.info('Pipeline complete', { token: responseToken, email, ms: Date.now() - start });
  } catch (err) {
    logger.error('Pipeline failed', { token: responseToken, error: err.message, ms: Date.now() - start });
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info(`${signal} received — waiting for in-flight pipelines`, { inFlight });
  const deadline = Date.now() + 30_000;

  const poll = setInterval(() => {
    if (inFlight === 0 || Date.now() > deadline) {
      if (inFlight > 0) logger.warn('Shutdown deadline reached with pipelines still running', { inFlight });
      clearInterval(poll);
      process.exit(0);
    }
  }, 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  logger.info('Server started', { port: config.port, cacheEnabled: true });
  if (!config.whopWebhookSecret) {
    logger.warn('WHOP_WEBHOOK_SECRET not set — skipping signature verification');
  }
});
