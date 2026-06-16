const express  = require('express');
const crypto   = require('crypto');
const sgMail   = require('@sendgrid/mail');
const config   = require('./lib/config');
const logger   = require('./lib/logger');
const { withRetry }              = require('./lib/retry');
const { fetchTypeformResponse }  = require('./lib/fetch-typeform-response');
const { generateBlueprint }      = require('./lib/generate-blueprint');
const { renderTemplate }         = require('./lib/render-template');
const { generatePDF }            = require('./lib/generate-pdf');
const { sendBlueprintEmail }     = require('./lib/send-blueprint-email');

const { addSubscriber, getSubscriberByToken, getAllSubscribers, getActiveCount } = require('./lib/vgb-store');
const { getPublished, getDraft, saveDraft, publishDraft, publishDirect }        = require('./lib/vgb-content-store');
const { sendVGBAccessEmail, sendApprovalEmail }                                 = require('./lib/vgb-email');
const { renderVGBPage }                                                          = require('./lib/render-vgb');
const { renderAdminDashboard }                                                   = require('./lib/render-admin');

const fs   = require('fs');
const path = require('path');

config.validateConfig();

const app = express();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vibral2026';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'contact@vibralstudio.com';
const VGB_PRODUCT    = process.env.VGB_PRODUCT_NAME || 'The Viral Growth Blueprint';
const BASE_URL       = process.env.BASE_URL || 'https://whop-webhook-production.up.railway.app';

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function adminAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="VGB Admin"');
    return res.status(401).send('Authentication required.');
  }
  const [, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (pass !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="VGB Admin"');
    return res.status(401).send('Wrong password.');
  }
  next();
}

app.get('/health', async (_req, res) => {
  const count = await getActiveCount();
  res.json({ status: 'ok', timestamp: new Date().toISOString(), vgbSubscribers: count });
});

app.get('/free-blueprint', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'free-blueprint.html'));
});

// ── Whop webhook ─────────────────────────────────────────────────────────────

app.post('/webhook', (req, res) => {
  // Always respond 200 immediately so Whop doesn't retry
  res.status(200).json({ received: true });

  let payload;
  try { payload = JSON.parse(req.body); }
  catch { return; }

  const { action, data } = payload;

  logger.info('WHOP EVENT', { action, raw: JSON.stringify(payload).slice(0, 2000) });

  // Extract email from all possible Whop payload shapes
  const email = 
    data?.user?.email ??
    data?.customer?.email ??
    data?.membership?.user?.email ??
    data?.email ??
    null;

  // Extract product name from all possible Whop payload shapes  
  const product =
    data?.plan?.name ??
    data?.product?.name ??
    data?.membership?.plan?.name ??
    data?.access_pass?.name ??
    data?.plan?.product?.name ??
    '';

  logger.info('Parsed', { email, product, action });

  if (!email) {
    logger.warn('No email found in payload');
    return;
  }

  const isVGB = product.toLowerCase().includes('viral growth blueprint') || product === VGB_PRODUCT;

  if (isVGB) {
    handleVGBPurchase(email, product).catch(err =>
      logger.error('handleVGBPurchase failed', { email, error: err.message })
    );
  } else if (product.toLowerCase().includes('custom')) {
    sendTypeformEmail(email, product).catch(err =>
      logger.error('sendTypeformEmail failed', { email, error: err.message })
    );
  } else {
    logger.info('Unknown product — skipping', { product });
  }
});

async function handleVGBPurchase(email, product) {
  logger.info('VGB purchase — creating subscriber', { email });
  const token = await addSubscriber(email, product);
  await sendVGBAccessEmail(email, token);
  logger.info('VGB access email sent', { email });
}

// ── VGB subscriber page ──────────────────────────────────────────────────────

app.get('/vgb/:token', async (req, res) => {
  const subscriber = await getSubscriberByToken(req.params.token);
  if (!subscriber) {
    return res.status(404).send(`
      <html><body style="background:#0A0A08;color:#F0EDE6;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
        <div>
          <p style="color:#C8A96E;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:16px;">Vibral Studio</p>
          <h1 style="font-size:24px;margin-bottom:12px;">Link not found.</h1>
          <p style="color:#888880;">Check your email or contact <a href="mailto:contact@vibralstudio.com" style="color:#C8A96E;">contact@vibralstudio.com</a></p>
        </div>
      </body></html>
    `);
  }
  const published = await getPublished();
  res.send(renderVGBPage(published, subscriber.email));
});

// ── Admin ─────────────────────────────────────────────────────────────────────

app.get('/admin', adminAuth, async (req, res) => {
  const subscribers = await getAllSubscribers();
  const published   = await getPublished();
  const draft       = await getDraft();
  res.send(renderAdminDashboard(subscribers, published, draft));
});

app.post('/admin/save', adminAuth, async (req, res) => {
  try {
    const { sectionsJson, weekLabel } = req.body;
    const sections = JSON.parse(sectionsJson);
    await publishDirect(sections, weekLabel);
    logger.info('Admin published VGB update', { weekLabel, sections: sections.length });
    res.redirect('/admin?success=1');
  } catch (err) {
    logger.error('Admin save failed', { error: err.message });
    res.status(400).send(`Error: ${err.message} — <a href="/admin" style="color:#C8A96E;">Go back</a>`);
  }
});

app.post('/admin/publish', adminAuth, async (req, res) => {
  try {
    await publishDraft();
    logger.info('Admin published weekly draft');
    res.redirect('/admin?success=1');
  } catch (err) {
    res.status(400).send(`Error: ${err.message}`);
  }
});

app.post('/admin/draft', async (req, res) => {
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { sections, weekLabel } = req.body;
    if (!sections || !Array.isArray(sections)) {
      return res.status(400).json({ error: 'Invalid sections' });
    }
    await saveDraft(sections, weekLabel);
    logger.info('Weekly draft received', { weekLabel, sections: sections.length });
    const approveUrl = `${BASE_URL}/admin`;
    await sendApprovalEmail(ADMIN_EMAIL, weekLabel || 'This week', approveUrl).catch(err =>
      logger.error('Approval email failed', { error: err.message })
    );
    return res.status(200).json({ received: true, weekLabel });
  } catch (err) {
    logger.error('Draft receive failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ── Custom Blueprint — Typeform ───────────────────────────────────────────────

async function sendTypeformEmail(customerEmail, product) {
  sgMail.setApiKey(config.sendgridApiKey);
  const typeformUrl = `${config.typeformBaseUrl}?email=${encodeURIComponent(customerEmail)}`;
  await withRetry(
    () => sgMail.send({
      to: customerEmail,
      from: config.fromEmail,
      subject: "Your Custom Growth Blueprint — here's what to do next",
      text: [
        'Thanks for purchasing your Custom Growth Blueprint.',
        '',
        'Please fill out the form below and take your time.',
        '',
        typeformUrl,
        '',
        'Talk soon,',
        'Vibral Studio',
      ].join('\n'),
      html: `
        <p>Thanks for purchasing your Custom Growth Blueprint.</p>
        <p>Please fill out the form and take your time answering each question.</p>
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

let inFlight = 0;

app.post('/typeform-webhook', (req, res) => {
  res.status(200).json({ received: true });
  const responseToken = req.body?.form_response?.token;
  if (!responseToken) { logger.warn('typeform-webhook: no token'); return; }
  inFlight++;
  runBlueprintPipeline(responseToken).finally(() => { inFlight--; });
});

async function runBlueprintPipeline(responseToken) {
  const start = Date.now();
  logger.info('Pipeline started', { token: responseToken });
  try {
    const { email, answers } = await fetchTypeformResponse(responseToken);
    if (!email) { logger.error('Pipeline aborted: no email', { token: responseToken }); return; }
    const blueprintJson = await generateBlueprint(answers);
    const blueprintHtml = renderTemplate(blueprintJson);
    const pdfBuffer     = await generatePDF(blueprintHtml);
    await sendBlueprintEmail(email, pdfBuffer);
    logger.info('Pipeline complete', { token: responseToken, email, ms: Date.now() - start });
  } catch (err) {
    logger.error('Pipeline failed', { token: responseToken, error: err.message });
  }
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info(`${signal} received`, { inFlight });
  const deadline = Date.now() + 30_000;
  const poll = setInterval(() => {
    if (inFlight === 0 || Date.now() > deadline) { clearInterval(poll); process.exit(0); }
  }, 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  logger.info('Server started', { port: config.port });
  if (!config.whopWebhookSecret) logger.warn('WHOP_WEBHOOK_SECRET not set');
});
