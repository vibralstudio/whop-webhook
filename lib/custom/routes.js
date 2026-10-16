// Custom Growth Blueprint portal: client link, intake API, generation, admin tab, Whop hooks.
const express = require('express');
const fs = require('fs');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const config = require('../config');
const logger = require('../logger');
const { withRetry } = require('../retry');
const store = require('./store');
const { generate, transcript } = require('./generate');

const VIEWS = path.join(__dirname, '..', '..', 'views', 'custom');
const INTAKE = fs.readFileSync(path.join(VIEWS, 'intake.html'), 'utf8');
const BLUEPRINT = fs.readFileSync(path.join(VIEWS, 'blueprint.html'), 'utf8');
const PORTAL_UI = fs.readFileSync(path.join(VIEWS, 'portal-ui.html'), 'utf8');
const ADMIN_CSS = fs.readFileSync(path.join(VIEWS, 'admin.css'), 'utf8');

const BASE_URL = (process.env.BASE_URL || 'https://whop-webhook-production.up.railway.app').replace(/\/$/, '');
const RELEASE_CHECKOUT_URL = process.env.RELEASE_CHECKOUT_URL || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'contact@vibralstudio.com';
const MAX_UPLOAD = 40 * 1024 * 1024;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeJSON = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac' };

// ---------- pages ----------
function page(title, body, { tabs = false } = {}) {
  const nav = tabs ? `<header class="bar"><div class="mark">VIBRAL<span>.</span></div><nav class="tabs"><a href="/admin">VGB</a><a href="/admin/custom" class="on">Custom</a></nav><span></span></header>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${ADMIN_CSS}
.tabs{display:flex;gap:6px}.tabs a{color:var(--muted);padding:8px 14px;border-radius:999px;font-weight:600;font-size:13.5px;border:1px solid transparent}.tabs a.on{color:var(--ink);border-color:var(--line);background:var(--surface)}.tabs a:hover{text-decoration:none;color:var(--ink)}</style></head><body>${nav}${body}</body></html>`;
}
function notFound(res) {
  res.status(404).send(page('Not found', `<main class="center"><div class="mark">VIBRAL<span>.</span></div><h1>This link doesn't exist.</h1><p class="muted">Check the link in your email, or write to contact@vibralstudio.com.</p></main>`));
}
async function renderBlueprint(client, n) {
  const v = n ? await store.version(client.id, n) : await store.latest(client.id);
  if (!v) return null;
  const versions = await store.versions(client.id);
  const vb = { token: client.token, n: v.n, versions: versions.map((x) => ({ n: x.n, label: x.label, kind: x.kind })), credits: client.credits, checkout: RELEASE_CHECKOUT_URL, latest: versions[versions.length - 1].n };
  return BLUEPRINT.replace('__BP_DATA__', safeJSON(v.content)).replace('<!--VB-PORTAL-->', PORTAL_UI.replace('__VB__', safeJSON(vb)));
}

// ---------- generation ----------
const running = new Set();
async function runGeneration(clientId, { release = null } = {}) {
  if (running.has(clientId)) return;
  running.add(clientId);
  const t0 = Date.now();
  const client = await store.byId(clientId);
  const prev = await store.latest(clientId);
  try {
    await store.setStatus(clientId, 'generating', { stage: 'read', done: [] });
    const content = await generate(client.answers || {}, {
      getFile: async (url) => { const id = path.basename(String(url)).replace(/\..*$/, ''); const f = await store.file(clientId, id); return f && { data: f.data, mime: f.mime }; },
      onProgress: (p) => store.setProgress(clientId, p).catch(() => {}),
      release,
      previous: release && prev ? prev.content : null,
    });
    const n = prev ? prev.n + 1 : 1;
    const label = release ? release.title : n === 1 ? (content.release && content.release.title) || 'Blueprint' : 'Rebuilt';
    await store.addVersion(clientId, n, label, release ? 'release' : 'initial', release, content);
    await store.setStatus(clientId, 'ready', { done: ['read', 'core', 'world', 'concepts', 'plan', 'captions'] });
    logger.info('Custom blueprint ready', { clientId, version: n, ms: Date.now() - t0 });
    notifyAdmin(client, n, release).catch((e) => logger.warn('Custom admin notify failed', { error: e.message }));
  } catch (err) {
    logger.error('Custom generation failed', { clientId, error: err.message });
    if (release && prev) { await store.addCredits(clientId, 1); await store.setStatus(clientId, 'ready', {}, 'Release update failed: ' + err.message); }
    else await store.setStatus(clientId, 'error', {}, err.message);
  } finally {
    running.delete(clientId);
  }
}
async function resumeInterrupted() {
  try {
    for (const c of await store.generating()) {
      if (await store.latest(c.id)) await store.setStatus(c.id, 'ready', {}, 'Interrupted by a restart');
      else runGeneration(c.id);
    }
  } catch (e) { logger.warn('Custom resume skipped', { error: e.message }); }
}

// ---------- email ----------
async function sendMail(msg, label) {
  if (!config.sendgridApiKey) return logger.warn('SendGrid not configured', { label });
  sgMail.setApiKey(config.sendgridApiKey);
  await withRetry(() => sgMail.send({ from: config.fromEmail, ...msg }), { attempts: 3, delayMs: 1000, label });
}
function mailHtml(title, lines, cta, url) {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0A0A08;color:#F0EDE6;padding:40px 32px;">
    <p style="font-size:11px;letter-spacing:0.2em;color:#C8A96E;text-transform:uppercase;margin-bottom:32px;">VIBRAL STUDIO</p>
    <h1 style="font-size:28px;font-weight:800;color:#F0EDE6;margin-bottom:12px;line-height:1.1;">${title}</h1>
    ${lines.map((l) => `<p style="color:#A8A49B;font-size:14px;line-height:1.7;margin:0 0 14px;">${l}</p>`).join('')}
    <a href="${url}" style="display:inline-block;margin-top:14px;padding:16px 32px;background:#C8A96E;color:#0A0A08;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">${cta}</a>
    <p style="color:#888880;font-size:12px;margin-top:24px;">Or copy this link: ${url}</p>
    <p style="color:#555;font-size:11px;margin-top:32px;border-top:1px solid #2A2A28;padding-top:20px;">Questions? Reply to this email · contact@vibralstudio.com</p></div>`;
}
async function sendIntakeEmail(email, token) {
  const url = `${BASE_URL}/c/${token}`;
  await sendMail({
    to: email,
    subject: "Let's build your Custom Growth Blueprint",
    text: `Thanks for getting your Custom Growth Blueprint.\n\nStart here (about 9 minutes, it saves as you go):\n${url}\n\nThe moment you finish, your Blueprint opens on the same link. Bookmark it, it's yours to keep.\n\nVibral Studio`,
    html: mailHtml("Let's build<br>your world.", ['About 9 minutes. It saves as you go, so you can stop and come back.', 'The moment you finish, your Blueprint opens on this same link. Bookmark it, it\'s yours to keep.'], 'Start my Blueprint →', url),
  }, 'Custom intake email');
}
async function sendReleaseEmail(email, token) {
  const url = `${BASE_URL}/c/${token}`;
  await sendMail({
    to: email,
    subject: 'Your next release plan is unlocked',
    text: `Your next release plan is unlocked.\n\nOpen your Blueprint, tap "Next release" and tell us about the new track:\n${url}\n\nVibral Studio`,
    html: mailHtml('Your next release<br>is unlocked.', ['Open your Blueprint, tap <b style="color:#F0EDE6">Next release</b> and tell us about the new track. Your plan rebuilds around it in a few minutes.'], 'Open my Blueprint →', url),
  }, 'Custom release email');
}
async function notifyAdmin(client, n, release) {
  await sendMail({
    to: ADMIN_EMAIL,
    subject: `${release ? 'New release plan' : 'New Custom Blueprint'} · ${(client.answers && client.answers.name) || client.name || client.email}`,
    text: `v${n} is live: ${BASE_URL}/c/${client.token}\nAdmin: ${BASE_URL}/admin/custom/${client.id}`,
  }, 'Custom admin notify');
}

// ---------- Whop hooks (called from server.js /webhook) ----------
async function handleCustomPurchase(email, name) {
  if (await store.recentWhop(email)) return null; // duplicate event for the same purchase
  const existing = await store.byEmail(email);
  if (existing && !(await store.latest(existing.id))) {
    await sendIntakeEmail(email, existing.token); // bought again before finishing: resend the same link
    return existing;
  }
  const c = await store.createClient({ email, name: name || '', source: 'whop' });
  await sendIntakeEmail(email, c.token);
  logger.info('Custom client created from Whop', { email, id: c.id });
  return c;
}
async function handleReleasePurchase(email) {
  const c = await store.byEmail(email);
  if (!c) { logger.warn('Release credit: no Custom client for email', { email }); return null; }
  if (!(await store.creditOnce(c.id))) return c; // duplicate event for the same purchase
  await sendReleaseEmail(email, c.token);
  logger.info('Release credit added', { email, id: c.id });
  return c;
}

// ---------- router ----------
function customRouter({ adminAuth }) {
  const r = express.Router();

  // Client link: intake until built, then the Blueprint.
  r.get('/c/:token', async (req, res, next) => {
    try {
      const c = await store.byToken(req.params.token);
      if (!c) return notFound(res);
      res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex');
      if (c.status !== 'generating' && (await store.latest(c.id))) {
        const html = await renderBlueprint(c, parseInt(req.query.v, 10) || 0);
        if (html) return res.send(html);
      }
      res.send(INTAKE.replace('__VB__', safeJSON({ token: c.token, status: c.status, answers: c.answers || {}, cur: c.cur })));
    } catch (e) { next(e); }
  });

  const client = async (req, res, next) => {
    try { req.client = await store.byToken(req.params.token); } catch (e) { return next(e); }
    if (!req.client) return res.status(404).json({ error: 'not_found' });
    next();
  };
  r.put('/api/c/:token/state', express.json({ limit: '2mb' }), client, async (req, res) => {
    const c = req.client;
    if (c.status === 'generating' || c.status === 'ready') return res.json({ ok: true, locked: true });
    await store.saveState(c.id, req.body.answers, req.body.cur);
    res.json({ ok: true });
  });
  r.post('/api/c/:token/upload', express.raw({ type: () => true, limit: MAX_UPLOAD }), client, async (req, res) => {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!/^(image|audio)\//.test(mime) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'bad_file' });
    const name = String(req.query.name || 'file').slice(0, 200);
    const id = await store.addFile(req.client.id, String(req.query.field || '').slice(0, 40), name, mime, req.body);
    const ext = EXT[mime] || path.extname(name).toLowerCase().replace(/[^.\w]/g, '');
    res.json({ url: `/u/${req.client.token}/${id}${ext}`, name });
  });
  r.get('/u/:token/:file', async (req, res) => {
    const c = await store.byToken(req.params.token);
    const f = c && (await store.file(c.id, req.params.file.replace(/\..*$/, '')));
    if (!f) return res.sendStatus(404);
    res.set('Content-Type', f.mime).set('Cache-Control', 'private, max-age=86400').send(f.data);
  });
  r.post('/api/c/:token/submit', express.json({ limit: '2mb' }), client, async (req, res) => {
    const c = req.client;
    if (c.status === 'generating') return res.json({ ok: true });
    if (await store.latest(c.id)) return res.status(409).json({ error: 'already_built' });
    if (req.body && req.body.answers) await store.saveState(c.id, req.body.answers, req.body.cur);
    await store.submitted(c.id);
    await store.setStatus(c.id, 'generating', { stage: 'read', done: [] });
    runGeneration(c.id);
    res.json({ ok: true });
  });
  r.get('/api/c/:token/status', client, (req, res) => res.json({ status: req.client.status, ...(req.client.progress || {}) }));
  r.post('/api/c/:token/release', express.json(), client, async (req, res) => {
    const c = req.client;
    const { title, date, notes, track } = req.body || {};
    if (!title || !date) return res.status(400).json({ error: 'missing' });
    if (c.status === 'generating') return res.status(409).json({ error: 'busy' });
    if (!(await store.latest(c.id))) return res.status(409).json({ error: 'no_blueprint' });
    if (c.credits < 1) return res.status(402).json({ error: 'no_credit', checkout: RELEASE_CHECKOUT_URL });
    await store.addCredits(c.id, -1);
    await store.setStatus(c.id, 'generating', { stage: 'read', done: [] });
    runGeneration(c.id, { release: { title: String(title).slice(0, 120), date: String(date).slice(0, 10), notes: String(notes || '').slice(0, 3000), track: track || null } });
    res.json({ ok: true });
  });

  // Whop "Redirect after checkout" → /start (buyer confirms checkout email, lands on intake).
  r.get('/start', (req, res) => {
    res.send(page('Start · Vibral', `<main class="center"><div class="mark">VIBRAL<span>.</span></div><h1>Welcome in.</h1><p class="muted">Enter the email you used at checkout to open your Blueprint. We also sent the link to your inbox.</p>
    <form id="f" class="row"><input type="email" name="email" required placeholder="you@email.com"><button>Open →</button></form><p id="m" class="muted"></p>
    <script>var f=document.getElementById("f"),m=document.getElementById("m"),tries=0;function go(){fetch("/api/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:f.email.value})}).then(function(r){return r.json()}).then(function(d){if(d.url){location.href=d.url;return}if(++tries<12){m.textContent="Confirming your payment…";setTimeout(go,2500)}else{m.textContent="We couldn't find that checkout yet. Check your inbox for your link, or write to contact@vibralstudio.com."}})}f.onsubmit=function(e){e.preventDefault();tries=0;go()}</script></main>`));
  });
  r.post('/api/start', express.json(), async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim();
    const c = email && (await store.byEmail(email));
    res.json(c && c.source === 'whop' ? { url: '/c/' + c.token } : {});
  });

  // ---------- admin ----------
  const STATUS = { new: ['Link sent', 'dim'], intake: ['Filling intake', 'blue'], generating: ['Building…', 'gold'], ready: ['Ready', 'green'], error: ['Failed', 'red'] };
  const badge = (s) => `<span class="badge ${STATUS[s] ? STATUS[s][1] : ''}">${STATUS[s] ? STATUS[s][0] : esc(s)}</span>`;
  const copyJs = `<script>document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(!b)return;var t=b.textContent;function ok(){b.textContent="Copied ✓";setTimeout(function(){b.textContent=t},1200)}try{navigator.clipboard.writeText(b.dataset.copy).then(ok,function(){prompt("Copy:",b.dataset.copy)})}catch(_){prompt("Copy:",b.dataset.copy)}})</script>`;

  r.get('/admin/custom', adminAuth, async (req, res) => {
    const rows = await store.all();
    res.send(page('Custom · Admin', `<main>
    <section class="card"><h2>New client</h2><form method="post" action="/admin/custom/new" class="row"><input name="name" placeholder="Artist name" required><input name="email" type="email" placeholder="Email (optional)"><label class="small muted" style="display:flex;gap:6px;align-items:center;white-space:nowrap"><input type="checkbox" name="send" value="1" style="flex:none"> Email them the link</label><button>Create link →</button></form><p class="muted small">Whop purchases create clients automatically. Use this for deals you close by hand.</p></section>
    <section class="card"><h2>Custom Blueprints <span class="muted">${rows.length}</span></h2>${rows.length ? `<table><thead><tr><th>Artist</th><th>Status</th><th>Versions</th><th>Release credits</th><th>Created</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td><a href="/admin/custom/${c.id}"><b>${esc(c.artist || c.name || '—')}</b></a><div class="muted small">${esc(c.email || '')}${c.source === 'whop' ? ' · Whop' : ''}</div></td><td>${badge(c.status)}</td><td>${c.nv}</td><td>${c.credits}</td><td class="small muted">${fmtDate(c.created_at)}</td><td class="actions"><button class="ghost sm" data-copy="${BASE_URL}/c/${c.token}">Copy link</button>${c.nv ? `<a class="ghost sm" href="/c/${c.token}" target="_blank">Open</a>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No Custom clients yet.</p>'}</section></main>${copyJs}`, { tabs: true }));
  });
  r.post('/admin/custom/new', adminAuth, express.urlencoded({ extended: false }), async (req, res) => {
    const email = String(req.body.email || '').trim().slice(0, 200);
    const c = await store.createClient({ name: String(req.body.name || '').slice(0, 120), email, source: 'admin' });
    if (req.body.send && email) await sendIntakeEmail(email, c.token).catch((e) => logger.error('Intake email failed', { error: e.message }));
    res.redirect('/admin/custom/' + c.id);
  });
  r.get('/admin/custom/:id', adminAuth, async (req, res) => {
    const c = await store.byId(parseInt(req.params.id, 10) || 0);
    if (!c) return res.redirect('/admin/custom');
    const a = c.answers || {};
    const vs = await store.versions(c.id);
    const latest = vs.length ? await store.latest(c.id) : null;
    const link = `${BASE_URL}/c/${c.token}`;
    const up = a._up || {};
    const files = Object.keys(up).flatMap((k) => (up[k] || []).map((u) => `<a href="${esc(u.url)}" target="_blank" class="file">${/\.(jpe?g|png|webp|gif)$/i.test(u.url) ? `<img src="${esc(u.url)}" alt="">` : '<span style="font-size:28px">♪</span>'}<span>${esc(k)} · ${esc(u.name)}</span></a>`)).join('');
    res.send(page(`${a.name || c.name || 'Client'} · Admin`, `<main>
    <p><a href="/admin/custom">← All Custom Blueprints</a></p>
    <section class="card"><div class="head"><div><h1>${esc(a.name || c.name || 'Client')}</h1><div class="muted">${esc(c.email || '')} ${badge(c.status)}</div></div><div class="actions"><button class="primary" data-copy="${link}">Copy client link</button>${vs.length ? `<a class="ghost" href="/c/${c.token}" target="_blank">Open Blueprint ↗</a>` : ''}</div></div>
    <a class="link" href="${esc(link)}" target="_blank" rel="noopener">${esc(link)} ↗</a>
    ${c.error ? `<p class="err">Last error: ${esc(c.error)}</p>` : ''}
    <div class="row wrap">
      <form method="post" action="/admin/custom/${c.id}/credit"><input type="hidden" name="d" value="1"><button class="ghost">+1 release credit</button></form>
      <form method="post" action="/admin/custom/${c.id}/credit"><input type="hidden" name="d" value="-1"><button class="ghost">−1</button></form>
      <span class="muted">Credits: <b>${c.credits}</b></span>
      ${c.email ? `<form method="post" action="/admin/custom/${c.id}/resend"><button class="ghost">Resend link by email</button></form>` : ''}
      ${a.name && c.status !== 'generating' ? `<form method="post" action="/admin/custom/${c.id}/rebuild"><button class="ghost">↻ Rebuild from answers</button></form>` : ''}
    </div>
    <details class="danger-zone"><summary class="muted small">Delete this client</summary><form method="post" action="/admin/custom/${c.id}/delete" class="row"><input name="confirm" placeholder="Type DELETE to confirm"><button class="ghost danger">Delete for good</button></form></details>
    </section>
    ${vs.length ? `<section class="card"><h2>Versions</h2><ul class="versions">${vs.map((v) => `<li><a href="/c/${c.token}?v=${v.n}" target="_blank">v${v.n} · ${esc(v.label || '')}</a> <span class="muted small">${esc(v.kind)} · ${fmtDate(v.created_at)}</span></li>`).join('')}</ul></section>` : ''}
    ${latest ? `<section class="card"><h2>Edit the latest version (v${latest.n})</h2><p class="muted small">Change any text, then save. The artist sees it on refresh. Wrap a word in *asterisks* to make it a gold keyword.</p><form method="post" action="/admin/custom/${c.id}/edit"><textarea name="content" spellcheck="false">${esc(JSON.stringify(latest.content, null, 2))}</textarea><button class="primary">Save changes</button></form></section>` : ''}
    ${files ? `<section class="card"><h2>Uploads</h2><div class="files">${files}</div></section>` : ''}
    <section class="card"><h2>Intake answers</h2>${Object.keys(a).length ? `<pre class="answers">${esc(transcript(a))}</pre>` : '<p class="muted">Nothing yet.</p>'}</section>
    </main>${copyJs}`, { tabs: true }));
  });
  const form = express.urlencoded({ extended: false, limit: '4mb' });
  r.post('/admin/custom/:id/credit', adminAuth, form, async (req, res) => { await store.addCredits(parseInt(req.params.id, 10), req.body.d === '-1' ? -1 : 1); res.redirect('/admin/custom/' + req.params.id); });
  r.post('/admin/custom/:id/rebuild', adminAuth, async (req, res) => { const id = parseInt(req.params.id, 10); await store.setStatus(id, 'generating', { stage: 'read', done: [] }); runGeneration(id); res.redirect('/admin/custom/' + id); });
  r.post('/admin/custom/:id/resend', adminAuth, async (req, res) => {
    const c = await store.byId(parseInt(req.params.id, 10));
    if (c && c.email) await sendIntakeEmail(c.email, c.token).catch((e) => logger.error('Resend failed', { error: e.message }));
    res.redirect('/admin/custom/' + req.params.id);
  });
  r.post('/admin/custom/:id/delete', adminAuth, form, async (req, res) => {
    if (req.body.confirm === 'DELETE') await store.remove(parseInt(req.params.id, 10));
    res.redirect(req.body.confirm === 'DELETE' ? '/admin/custom' : '/admin/custom/' + req.params.id);
  });
  r.post('/admin/custom/:id/edit', adminAuth, form, async (req, res) => {
    const c = await store.byId(parseInt(req.params.id, 10));
    const v = c && (await store.latest(c.id));
    let parsed = null;
    try { parsed = JSON.parse(req.body.content); } catch {}
    if (!v || !parsed || typeof parsed !== 'object') return res.status(400).send(page('Error', `<main class="center"><h1>That JSON has an error.</h1><p class="muted">Nothing was saved. Go back and check commas and quotes.</p><a class="ghost" href="/admin/custom/${esc(req.params.id)}">← Back</a></main>`));
    await store.editVersion(v.id, parsed);
    res.redirect('/admin/custom/' + c.id);
  });

  r.use('/img', express.static(path.join(__dirname, '..', '..', 'public', 'img'), { maxAge: '7d' }));
  return r;
}

module.exports = { customRouter, handleCustomPurchase, handleReleasePurchase, resumeInterrupted };
