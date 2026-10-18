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

const { addSubscriber, getSubscriberByToken, getAllSubscribers, getActiveCount, deactivateSubscriber } = require('./lib/vgb-store');
const { getPublished, getDraft, saveDraft, publishDraft, publishDirect, replaceDraftSections, replacePublishedSections } = require('./lib/vgb-content-store');
const { withDashboard } = require('./lib/vgb-dashboard');
const { sendVGBAccessEmail, sendApprovalEmail }                                 = require('./lib/vgb-email');
const { renderVGBPage }                                                          = require('./lib/render-vgb');
const { renderVGBApp }                                                           = require('./lib/render-vgb-app');
const { renderAdminDashboard }                                                   = require('./lib/render-admin');
const { customRouter, handleCustomPurchase, handleReleasePurchase, resumeInterrupted } = require('./lib/custom/routes');
const { setSubscriberActive }                                                    = require('./lib/vgb-store');

const fs   = require('fs');
const path = require('path');

config.validateConfig();

const app = express();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vibral2026';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'contact@vibralstudio.com';
const VGB_PRODUCT    = process.env.VGB_PRODUCT_NAME || 'The Viral Growth Blueprint';
const BASE_URL       = process.env.BASE_URL || 'https://whop-webhook-production.up.railway.app';

// Custom Blueprint portal (/c/:token, /api/c/*, /start, /admin/custom). Mounted before the global
// body parsers so its own size limits apply (uploads, large Blueprint edits).
app.use(customRouter({ adminAuth }));

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

  // Whop sends the event name as "type" (e.g. "membership.activated"),
  // not "action" — keep both for safety in case Whop changes the field name.
  const action = payload.type ?? payload.action;
  const data   = payload.data;

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
    data?.product?.title ??
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

  // Activation/payment events (Whop can send several per purchase).
  const isPurchase = /activated|went_valid|payment\.succeeded|invoice_paid|payment_succeeded/.test(String(action || ''));

  // Membership cancelled/deactivated → mark subscriber inactive, no email sent
  if (action === 'membership.deactivated' || action === 'membership.cancelled') {
    if (isVGB) {
      deactivateSubscriber(email).catch(err =>
        logger.error('deactivateSubscriber failed', { email, error: err.message })
      );
      logger.info('VGB subscriber deactivated', { email });
    }
    return;
  }

  if (isVGB) {
    handleVGBPurchase(email, product).catch(err =>
      logger.error('handleVGBPurchase failed', { email, error: err.message })
    );
  } else if (!isPurchase) {
    // Custom + release: only act on activation/payment events, VGB keeps its own dedupe above
    logger.info('Event ignored (not a purchase)', { action, product });
  } else if (product.toLowerCase().includes('release')) {
    // "Next release" add-on ($100): +1 credit on the artist's Custom Blueprint
    handleReleasePurchase(email).catch(err =>
      logger.error('handleReleasePurchase failed', { email, error: err.message })
    );
  } else if (product.toLowerCase().includes('custom')) {
    // Custom Growth Blueprint: create the client and email their private intake link
    const name = data?.user?.name ?? data?.user?.username ?? '';
    handleCustomPurchase(email, name).catch(err =>
      logger.error('handleCustomPurchase failed', { email, error: err.message })
    );
  } else {
    logger.info('Unknown product — skipping', { product });
  }
});

async function handleVGBPurchase(email, product) {
  logger.info('VGB purchase — creating subscriber', { email });
  const { token, isNew } = await addSubscriber(email, product);
  if (!isNew) {
    logger.info('VGB subscriber already exists — skipping email', { email });
    return;
  }
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
  if (req.query.classic === '1') return res.send(renderVGBPage(published, subscriber.email));
  res.set('Cache-Control', 'no-store');
  res.send(renderVGBApp(published));
});

// ── Admin ─────────────────────────────────────────────────────────────────────
app.get('/admin/preview', adminAuth, async (req, res) => {
  const published = await getPublished();
  if (req.query.classic === '1') return res.send(renderVGBPage(published, 'preview@vibralstudio.com'));
  res.send(renderVGBApp(published));
});
app.get('/admin/preview/draft', adminAuth, async (req, res) => {
  const draft = await getDraft();
  if (!draft) return res.status(404).send('No draft right now. <a href="/admin">Back</a>');
  res.send(renderVGBApp(draft));
});
app.get('/admin', adminAuth, async (req, res) => {
  const subscribers = await getAllSubscribers();
  const published   = await getPublished();
  const draft       = await getDraft();
  res.send(renderAdminDashboard(subscribers, published, draft));
});

app.post('/admin/vgb/:id/resend', adminAuth, async (req, res) => {
  try {
    const sub = (await getAllSubscribers()).find((x) => String(x.id) === String(req.params.id));
    if (!sub) return res.status(404).send('Subscriber not found. <a href="/admin">Back</a>');
    await sendVGBAccessEmail(sub.email, sub.token);
    logger.info('VGB access email resent', { email: sub.email });
    res.redirect('/admin?resent=1');
  } catch (err) {
    logger.error('Resend failed', { error: err.message });
    res.status(500).send(`Error: ${err.message} — <a href="/admin">Back</a>`);
  }
});

app.post('/admin/vgb/:id/active', adminAuth, async (req, res) => {
  try {
    await setSubscriberActive(parseInt(req.params.id, 10), req.body.active === '1');
    res.redirect('/admin');
  } catch (err) {
    logger.error('Toggle subscriber failed', { error: err.message });
    res.status(400).send(`Error: ${err.message}`);
  }
});

app.post('/admin/save', adminAuth, async (req, res) => {
  try {
    const { sectionsJson, weekLabel } = req.body;
    const sections = JSON.parse(sectionsJson);
    await publishDirect(sections, weekLabel);
    logger.info('Admin published VGB update', { weekLabel, sections: sections.length });
    const week = sections.find((x) => /this week/i.test(x.num || ''));
    if (week && !week.dashboard) getPublished().then((p) => buildDashboardFor('published', p));
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

const dashboardJobs = new Set();
async function buildDashboardFor(kind, doc) {
  if (!doc || dashboardJobs.has(kind)) return false;
  dashboardJobs.add(kind);
  try {
    const { sections, built } = await withDashboard(doc.sections, doc.weekLabel);
    if (!built) return false;
    const ok = kind === 'draft'
      ? await replaceDraftSections(doc.createdAt, sections)
      : await replacePublishedSections(doc.lastUpdated, sections);
    logger.info('VGB dashboard built', { kind, saved: ok });
    return ok;
  } catch (err) {
    logger.error('VGB dashboard failed', { kind, error: err.message });
    return false;
  } finally {
    dashboardJobs.delete(kind);
  }
}

app.post('/admin/dashboard/:kind', adminAuth, async (req, res) => {
  const kind = req.params.kind === 'draft' ? 'draft' : 'published';
  const doc = kind === 'draft' ? await getDraft() : await getPublished();
  buildDashboardFor(kind, doc);
  res.redirect('/admin?building=' + kind);
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
    res.status(200).json({ received: true, weekLabel });
    // Build the app dashboard for this week, then send the approval email (with or without it).
    const draft = await getDraft();
    await buildDashboardFor('draft', draft);
    const approveUrl = `${BASE_URL}/admin`;
    await sendApprovalEmail(ADMIN_EMAIL, weekLabel || 'This week', approveUrl).catch(err =>
      logger.error('Approval email failed', { error: err.message })
    );
    return;
  } catch (err) {
    logger.error('Draft receive failed', { error: err.message });
    if (!res.headersSent) return res.status(500).json({ error: err.message });
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

    // Send to admin for approval — NOT to the client
    await sendBlueprintEmail(ADMIN_EMAIL, pdfBuffer, `[APPROVAL NEEDED] Custom Blueprint for ${email}`);

    logger.info('Pipeline complete — sent for approval', { token: responseToken, clientEmail: email, ms: Date.now() - start });
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


// ============ TYPEFORM WEBHOOK — Pipeline v2 (Standard FENNO.) ============
app.post('/typeform-webhook', express.json({ limit: '2mb' }), (req, res) => {
  res.status(200).json({ received: true });
  try {
    const raw = (typeof req.body === 'string' || Buffer.isBuffer(req.body))
      ? req.body.toString()
      : JSON.stringify(req.body);
    fs.writeFileSync('/tmp/answers.json', raw);
    const { execFile } = require('child_process');
    execFile('python3', ['generate_blueprint.py', '/tmp/answers.json'],
      { cwd: __dirname, timeout: 600000 },
      (err, stdout, stderr) => {
        logger.info('PIPELINE V2', { out: (stdout || '').slice(0, 2000) });
        if (err) logger.error('PIPELINE V2 FAILED', { error: (stderr || err.message).slice(0, 2000) });
      });
    logger.info('Typeform submission received - pipeline v2 started');
  } catch (e) {
    logger.error('typeform-webhook error', { error: e.message });
  }
});

app.use((err, req, res, _next) => {
  logger.error('Unhandled route error', { path: req.path, error: err.message });
  res.status(500).send('Something went wrong.');
});

app.listen(config.port, () => {
  resumeInterrupted();
  logger.info('Server started', { port: config.port });
  if (!config.whopWebhookSecret) logger.warn('WHOP_WEBHOOK_SECRET not set');
});
