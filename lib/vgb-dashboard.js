// Builds the "This Week" dashboard for the VGB app (hero, stats, chart, to-do, lessons)
// from the weekly "This Week's Data" section. Runs on the server when a draft arrives,
// so the Mac pipeline does not need to change.
const { callJSON } = require('./custom/claude');

const TARGETS = ['week', 'rules', 'hooks', 'hooks:num', 'hooks:stake', 'hooks:conf', 'hooks:proof', 'hooks:asp', 'hooks:brk',
  'concepts', 'concepts:0', 'concepts:1', 'concepts:2', 'concepts:3', 'concepts:4', 'concepts:5', 'concepts:6', 'concepts:7', 'concepts:8',
  'release', 'brand', 'prompts', 'tracker'];

const SYSTEM = `You turn a weekly Instagram data report for independent music artists into the dashboard of a member app.
Write in plain, punchy English a 19-year-old artist understands in one read. Short lines. No jargon.
Use ONLY numbers that appear in the source text. Never invent, round up or estimate a figure. If a number is not in the text, leave it out.
Never name accounts or creators; say "one account", "a page", etc. Named artists inside a quote from a caption are fine.

Return one JSON object:
{
  "thesis": "The week's single idea in 3 to 7 words. Wrap the key word in *asterisks* for the gold highlight.",
  "stats": [ exactly 3 of { "big": "a short figure from the text, like 100× or 18× or 1.28M", "label": "2 to 5 words", "detail": "one sentence with the proof, max 22 words" } ],
  "todo": [ exactly 3 of { "t": "an action to do this week, imperative, max 8 words", "s": "one short supporting line, max 14 words" } ],
  "posts": [ 4 to 8 of { "name": "what the post was, 2 to 4 words, no account names", "note": "max 7 words", "views": number, "likes": number, "comments": number } ]  // only posts where views, likes AND comments all appear in the text; otherwise return []
  "notes": { "views": "one sentence on reading the chart by views", "lv": "one sentence on like rate (likes ÷ views)", "comments": "one sentence on comments" },
  "reroll": null or { "title": "max 6 words", "before": number, "after": number, "beforeLabel": "max 5 words", "afterLabel": "max 5 words", "note": "one sentence" }  // only when the text has a before/after pair
  "lessons": [ 5 to 8 of { "lesson": "max 9 words", "proof": "max 18 words, with the figure", "cta": "2 to 5 words, imperative", "to": one of ${JSON.stringify(TARGETS)} } ]
}
"to" sends the artist to the tab where they act on the lesson: hooks (first lines), concepts:N (0 Aesthetic setting, 1 Standing vibe, 2 Bench glitch, 3 DJ set crowd reaction, 4 Studio BTS, 5 Playback reaction, 6 Motivational / storytelling, 7 Music video, 8 Before / after — use 8 for case studies and results), release (presave and release plan), brand (identity), tracker (logging and re-uploads), prompts (AI visuals), rules.`;

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : null);

function clean(raw) {
  const d = {};
  d.thesis = str(raw.thesis, 80);
  d.stats = (Array.isArray(raw.stats) ? raw.stats : []).slice(0, 3)
    .map((x) => ({ big: str(x.big, 10), label: str(x.label, 40), detail: str(x.detail, 200) })).filter((x) => x.big && x.label);
  d.todo = (Array.isArray(raw.todo) ? raw.todo : []).slice(0, 3)
    .map((x) => ({ t: str(x.t, 70), s: str(x.s, 120) })).filter((x) => x.t);
  d.posts = (Array.isArray(raw.posts) ? raw.posts : []).slice(0, 8)
    .map((p) => ({ name: str(p.name, 40), note: str(p.note, 60), views: num(p.views), likes: num(p.likes), comments: num(p.comments) }))
    .filter((p) => p.name && p.views && p.likes != null && p.comments != null);
  if (d.posts.length < 3) delete d.posts;
  if (raw.notes && typeof raw.notes === 'object') d.notes = { views: str(raw.notes.views, 200), lv: str(raw.notes.lv, 200), comments: str(raw.notes.comments, 200) };
  const r = raw.reroll;
  if (r && num(r.before) && num(r.after) && r.after > r.before) {
    d.reroll = { title: str(r.title, 50), before: num(r.before), after: num(r.after), beforeLabel: str(r.beforeLabel, 40), afterLabel: str(r.afterLabel, 40), note: str(r.note, 200) };
  }
  d.lessons = (Array.isArray(raw.lessons) ? raw.lessons : []).slice(0, 8)
    .map((l) => ({ lesson: str(l.lesson, 80), proof: str(l.proof, 160), cta: str(l.cta, 40), to: TARGETS.includes(l.to) ? l.to : 'hooks' }))
    .filter((l) => l.lesson && l.cta);
  if (!d.thesis || d.stats.length < 3 || d.lessons.length < 3) throw new Error('Dashboard came back incomplete');
  if (!d.todo.length) delete d.todo;
  return d;
}

function findWeekIndex(sections) {
  if (!Array.isArray(sections)) return -1;
  let i = sections.findIndex((s) => /this week/i.test(s.num || ''));
  if (i < 0) i = sections.findIndex((s) => /working right now/i.test(s.title || ''));
  return i;
}

async function buildDashboard(section, weekLabel) {
  if (process.env.VB_MOCK) return require('./vgb-dashboard-example.json');
  const source = [
    `Week: ${weekLabel || ''}`,
    `Title: ${section.title || ''}`,
    `Lead: ${section.lead || ''}`,
    ...(section.cards || []).map((c) => `\n[${c.label}] ${c.title}\n${c.body}`),
    section.insight ? `\nInsight: ${section.insight}` : '',
    section.weeklyUpdate ? `\nDo this week: ${section.weeklyUpdate}` : '',
  ].join('\n');
  const raw = await callJSON({ system: SYSTEM, content: source, toolName: 'write_dashboard', description: 'Write the dashboard JSON.', maxTokens: 6000 });
  return clean(raw);
}

// Returns a copy of `sections` with the dashboard added to the This Week section (unchanged if not found).
async function withDashboard(sections, weekLabel) {
  const i = findWeekIndex(sections);
  if (i < 0) return { sections, built: false };
  const posts = /(\d[\d,]*)\s+posts/i.exec(sections[i].lead || '');
  const dash = await buildDashboard(sections[i], weekLabel);
  dash.weekLabel = [weekLabel, posts ? `${posts[1]} posts analyzed` : ''].filter(Boolean).join(' · ');
  const out = sections.slice();
  out[i] = { ...sections[i], dashboard: dash };
  return { sections: out, built: true };
}

module.exports = { withDashboard, findWeekIndex, clean };
