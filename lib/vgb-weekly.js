// Weekly VGB update, fully on the server (no Mac needed).
// Every Monday: scrape the tracked Instagram accounts with Apify, write the new
// "09 — This Week's Data" section with Claude, save it as the draft, build the
// app dashboard, then publish it (or email for approval if VGB_AUTO_PUBLISH=off).
const { Pool } = require('pg');
const sgMail = require('@sendgrid/mail');
const logger = require('./logger');
const { callJSON } = require('./custom/claude');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DEFAULT_ACCOUNTS = ['musicbylukas', 'ruffmusicofficial', 'omgadrian', 'rapvilleuk', 'kallawaymarketing',
  'iamchrischung', 'its21master', 'promo_god33', 'devinjatho'];
const ACCOUNTS = (process.env.VGB_ACCOUNTS || '').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
const accounts = () => (ACCOUNTS.length ? ACCOUNTS : DEFAULT_ACCOUNTS);
const POSTS_PER_ACCOUNT = Number(process.env.VGB_POSTS_PER_ACCOUNT) || 10;
// Monday 14:00 UTC = 9 or 10 am Eastern. Runs then, or at the next check if the server was down.
const RUN_DAY = 1;
const RUN_HOUR_UTC = Number(process.env.VGB_RUN_HOUR_UTC) || 14;
const autoPublish = () => String(process.env.VGB_AUTO_PUBLISH || 'on').toLowerCase() !== 'off';

// ── Job state (stored next to the VGB content) ──────────────────────────────
async function ensureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS vgb_content (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
}
async function getState() {
  await ensureTable();
  const r = await pool.query('SELECT data FROM vgb_content WHERE id = $1', ['weekly_job']);
  return r.rows[0] ? r.rows[0].data : null;
}
async function setState(patch) {
  const cur = (await getState()) || {};
  const next = { ...cur, ...patch };
  await pool.query(
    `INSERT INTO vgb_content (id, data) VALUES ('weekly_job', $1) ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
    [JSON.stringify(next)]
  );
  return next;
}

// ISO week key like "2026-W44" (weeks start Monday).
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
function isDue(now, state) {
  if (state && state.lastWeek === weekKey(now)) return false;
  const day = now.getUTCDay() || 7; // Monday=1 … Sunday=7
  return day > RUN_DAY || now.getUTCHours() >= RUN_HOUR_UTC;
}

// ── Apify scrape ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function apify(path, opts = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is not set in Railway Variables');
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.apify.com/v2${path}${sep}token=${encodeURIComponent(token)}`, opts);
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
async function scrape() {
  const input = {
    directUrls: accounts().map((u) => `https://www.instagram.com/${u}/`),
    resultsType: 'posts',
    resultsLimit: POSTS_PER_ACCOUNT,
  };
  const run = await apify('/acts/apify~instagram-scraper/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  const id = run.data.id;
  const deadline = Date.now() + 20 * 60 * 1000;
  let status = run.data.status, datasetId = run.data.defaultDatasetId;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    if (Date.now() > deadline) throw new Error('Apify scrape took longer than 20 minutes');
    await sleep(15000);
    const r = await apify(`/actor-runs/${id}`);
    status = r.data.status; datasetId = r.data.defaultDatasetId;
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify run ${status}`);
  const items = await apify(`/datasets/${datasetId}/items?clean=true&format=json`);
  return Array.isArray(items) ? items.filter((p) => p && !p.error) : [];
}

function formatPosts(posts) {
  const by = {};
  for (const p of posts) {
    const owner = p.ownerUsername || p.username || 'unknown';
    (by[owner] = by[owner] || []).push(p);
  }
  const lines = [];
  for (const [acct, list] of Object.entries(by)) {
    lines.push(`\n## Account ${acct} (${list.length} posts)`);
    list.forEach((p, i) => {
      const likes = p.likesCount ?? 0, comments = p.commentsCount ?? 0;
      const views = p.videoViewCount || p.videoPlayCount || 0;
      const type = String(p.type || 'image').toUpperCase();
      const date = String(p.timestamp || '').slice(0, 10);
      const cap = String(p.caption || '(no caption)').replace(/\s+/g, ' ').slice(0, 300);
      let line = `${i + 1}. [${type}] ${date} | Likes: ${likes.toLocaleString('en-US')} | Comments: ${comments.toLocaleString('en-US')}`;
      if (views) line += ` | Views: ${views.toLocaleString('en-US')}`;
      lines.push(line + `\n   Caption: ${cap}`);
    });
  }
  return lines.join('\n');
}

// ── Claude: write the This Week section ─────────────────────────────────────
const SYSTEM = `You write the weekly "This Week's Data" section of the Viral Growth Blueprint, a paid guide for independent music artists and DJs.
You get this week's raw Instagram data from the top music and creator marketing accounts, plus last week's section as the style reference.

Rules:
- Use ONLY numbers that appear in the data. Never invent, estimate or round a figure up. Ratios and multiples you compute from two numbers in the data are fine (say which two).
- Never name the accounts or their creators. Say "one account", "another account", "a smaller account". Artist names that appear inside a quoted caption are fine.
- Write in clear, direct English that a 19-year-old artist understands in one read. Same voice and depth as last week's section.
- Find what is NEW this week. Do not repeat last week's patterns unless this week's data shows them again with new numbers.
- Every card must end with what the artist should do.

Return one JSON object:
{
  "cards": [ 6 to 8 of { "label": "Pattern 0N — Short Name", "title": "the headline, with the key figure", "body": "90 to 160 words: the proof from the data, what it means, what to do" } ],
  "insight": "70 to 130 words: the single read of the week, tying the patterns together",
  "weeklyUpdate": "60 to 110 words: the three things to do this week, in order, each with its proof"
}`;

function numbersIn(text, skipComputed) {
  const out = [];
  const re = /\d[\d,]*(?:\.\d+)?(\s*(?:%|×|x\b|times\b))?/gi;
  let m;
  while ((m = re.exec(String(text)))) {
    if (skipComputed && m[1]) continue; // ratios and multiples computed from two figures
    out.push(m[0].replace(/[^\d.]/g, ''));
  }
  return out;
}
// Figures of 3+ digits in the output that do not appear anywhere in the source data.
function unverified(section, source) {
  const known = new Set(numbersIn(source));
  const out = new Set();
  const text = [section.insight, section.weeklyUpdate, ...(section.cards || []).flatMap((c) => [c.title, c.body])].join(' ');
  for (const n of numbersIn(text, true)) {
    const plain = n.split('.')[0];
    if (plain.length >= 3 && !known.has(plain) && !/^20\d\d$/.test(plain)) out.add(n);
  }
  return [...out];
}

async function writeWeekSection(data, lastWeek, postCount) {
  const ref = lastWeek ? JSON.stringify({ cards: lastWeek.cards, insight: lastWeek.insight, weeklyUpdate: lastWeek.weeklyUpdate }) : '(none)';
  let content = `THIS WEEK'S DATA (${postCount} posts):\n${data}\n\nLAST WEEK'S SECTION (style reference only, do not reuse its numbers):\n${ref}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callJSON({ system: SYSTEM, content, toolName: 'write_week', description: 'Write the This Week section JSON.', maxTokens: 12000 });
    const cards = (Array.isArray(raw.cards) ? raw.cards : [])
      .map((c) => ({ label: String(c.label || '').trim(), title: String(c.title || '').trim(), body: String(c.body || '').trim() }))
      .filter((c) => c.label && c.title && c.body).slice(0, 8);
    const section = { cards, insight: String(raw.insight || '').trim(), weeklyUpdate: String(raw.weeklyUpdate || '').trim() };
    if (cards.length < 4 || !section.insight) { content += '\n\nYour last answer was incomplete. Return 6 to 8 cards, an insight and a weeklyUpdate.'; continue; }
    const bad = unverified(section, data);
    if (!bad.length) return section;
    logger.warn('VGB weekly: unverified numbers, retrying', { bad });
    if (attempt === 1) throw new Error(`Numbers not found in the data: ${bad.join(', ')}`);
    content += `\n\nThese numbers in your answer are not in the data: ${bad.join(', ')}. Rewrite using only numbers from the data.`;
  }
  throw new Error('Claude did not return a complete section');
}

function nextWeekLabel(published) {
  const texts = [published && published.weekLabel];
  for (const s of (published && published.sections) || []) if (s.dashboard) texts.push(s.dashboard.weekLabel);
  const n = Math.max(0, ...texts.map((t) => { const m = /Week\s+(\d+)/i.exec(t || ''); return m ? Number(m[1]) : 0; }));
  return n ? `Week ${n + 1}` : `Week of ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// ── Notify ──────────────────────────────────────────────────────────────────
async function notify(adminEmail, subject, lines, link) {
  try {
    sgMail.setApiKey((process.env.SENDGRID_API_KEY || '').trim());
    await sgMail.send({
      to: adminEmail, from: 'contact@vibralstudio.com', subject,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0A0A08;color:#F0EDE6;padding:36px 30px;">
        <p style="font-size:11px;letter-spacing:.2em;color:#C8A96E;text-transform:uppercase;">VIBRAL STUDIO · VGB WEEKLY</p>
        ${lines.map((l) => `<p style="font-size:14px;line-height:1.7;color:#D8D5CD;">${l}</p>`).join('')}
        ${link ? `<a href="${link}" style="display:inline-block;margin-top:12px;padding:14px 28px;background:#C8A96E;color:#0A0A08;text-decoration:none;font-weight:700;font-size:13px;">Open the admin →</a>` : ''}
      </div>`,
    });
  } catch (e) { logger.error('VGB weekly email failed', { error: e.message }); }
}

// ── The job ─────────────────────────────────────────────────────────────────
let running = false;
async function runWeekly(deps, { reason = 'schedule' } = {}) {
  if (running) return { started: false, message: 'Already running' };
  running = true;
  const t0 = Date.now();
  const wk = weekKey();
  await setState({ status: 'running', startedAt: new Date().toISOString(), reason, error: null });
  try {
    logger.info('VGB weekly: scraping', { accounts: accounts().length });
    const posts = await scrape();
    if (posts.length < 20) throw new Error(`Only ${posts.length} posts came back from Apify`);
    const data = formatPosts(posts);

    const published = await deps.getPublished();
    const lastWeek = ((published && published.sections) || []).find(deps.isWeek);
    const sec = await writeWeekSection(data, lastWeek, posts.length);
    const weekLabel = nextWeekLabel(published);
    const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const week = {
      num: "09 — This Week's Data",
      title: "WHAT'S WORKING RIGHT NOW",
      lead: `Fresh data from this week's scrape — ${posts.length} posts analyzed across the top music and creator marketing accounts, ${date}. These patterns are pulled straight from real posts this week, not theory.`,
      cards: sec.cards,
      insight: sec.insight,
      weeklyUpdate: sec.weeklyUpdate,
    };

    await deps.saveDraft(deps.mergeWeeklyDraft([week], published, weekLabel), weekLabel);
    await deps.buildDashboardFor('draft', await deps.getDraft());

    let published_ = false;
    if (autoPublish()) { await deps.publishDraft(); published_ = true; }
    await setState({ status: 'ok', lastWeek: wk, finishedAt: new Date().toISOString(), weekLabel, posts: posts.length, published: published_, error: null });
    logger.info('VGB weekly: done', { weekLabel, posts: posts.length, published: published_, ms: Date.now() - t0 });
    await notify(deps.adminEmail,
      published_ ? `VGB ${weekLabel} is live` : `VGB ${weekLabel} draft ready`,
      [published_
        ? `This week's update is live for every subscriber: <strong>${posts.length} posts</strong> scraped and analyzed, new This Week section and dashboard.`
        : `This week's draft is ready: <strong>${posts.length} posts</strong> scraped and analyzed. Preview it, then publish.`],
      `${deps.baseUrl}/admin`);
    return { started: true };
  } catch (err) {
    logger.error('VGB weekly failed', { error: err.message });
    // Mark the week as attempted so it does not loop all week; "Run now" in the admin retries.
    await setState({ status: 'failed', lastWeek: wk, finishedAt: new Date().toISOString(), error: err.message }).catch(() => {});
    await notify(deps.adminEmail, 'VGB weekly update failed',
      [`The automatic Monday update did not go through.`, `<strong>Reason:</strong> ${String(err.message).replace(/</g, '&lt;')}`,
       `The live app still shows last week. Fix the cause, then hit <strong>Run weekly update now</strong> in the admin.`],
      `${deps.baseUrl}/admin`);
    return { started: true, error: err.message };
  } finally {
    running = false;
  }
}

function startWeeklyScheduler(deps) {
  const tick = async () => {
    try {
      let state = await getState();
      // First start: count the current week as done, so a mid-week deploy does not publish a duplicate week.
      if (!state) state = await setState({ status: 'idle', lastWeek: weekKey(), note: 'Scheduler installed' });
      if (!running && isDue(new Date(), state)) await runWeekly(deps, { reason: 'schedule' });
    } catch (e) { logger.error('VGB weekly scheduler', { error: e.message }); }
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 10 * 60 * 1000);
  logger.info('VGB weekly scheduler on', { day: 'Monday', hourUTC: RUN_HOUR_UTC, autoPublish: autoPublish() });
}

module.exports = { startWeeklyScheduler, runWeekly, getWeeklyState: getState, isWeeklyRunning: () => running, _test: { weekKey, isDue, unverified, formatPosts, nextWeekLabel } };
