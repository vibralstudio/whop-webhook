// Turns intake answers into the Blueprint content JSON the template renders.
// Stage 1 (core) writes the strategy. Stage 2 runs 4 calls in parallel: concepts, plan, captions, prompt builder.
const fs = require("fs");
const path = require("path");
const { callJSON, withRetry } = require("./claude");

const EXAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, "example.json"), "utf8"));

const WORLDS = {
  nightride: "Night Ride (freedom, youth, wind)", cosmic: "Cosmic Dream (escape, scale, the drop)", city: "City Lights (motion, night, dreamy)",
  lofi: "Lo-Fi Memories (nostalgia, intimacy)", golden: "Golden Hour (warmth, peace, freedom)", underground: "Underground (raw energy, the club)",
  festival: "Summer Festival (sun, crowd, celebration)", machine: "Dark Machine (futuristic, chrome, dark)", nature: "Epic Nature (vast, surreal, alive)",
  heaven: "Heaven (clouds, light, beyond)", organic: "Organic (earth, light, stillness)", romance: "Dark Romance (night, two people, tension)",
};
const CONCEPT_TYPES = ["studio", "sunrise", "laptop", "walkout", "travel", "crowd", "dayinlife", "decks", "surreal", "car", "rooftop", "fans"];

const LABELS = [
  ["name", "Artist name"], ["fear", "What they're afraid people think about them / what they avoid posting"], ["story", "The story of why they make music"],
  ["genre", "Genre"], ["subgenre", "Sub-genre"], ["sound1", "Sounds like (1)"], ["sound2", "Sounds like (2)"], ["sound3", "Sounds like (3)"],
  ["model", "Careers they want to model, and why"], ["emotion", "3 words for their music"], ["moment", "The life moment their music belongs to"],
  ["proud", "The moment in their music they're most proud of"], ["relTitle", "Next release title"], ["relDate", "Next release date"],
  ["unreleased", "Finished unreleased tracks"], ["fan", "Their #1 fan as a human"], ["become", "What the fan wants to become / fights against"],
  ["defend", "What the fan says to defend them"], ["fbHas", "Fanbase has a name?"], ["fbName", "Fanbase name"],
  ["moodNames", "Worlds picked (if their music was a film)"], ["customName", "Their own world name"], ["palette", "Palette"],
  ["symbol", "Symbol picked"], ["symbolOther", "Own symbol described"], ["feel", "In 3 seconds on their IG people should feel"],
  ["refs", "Visual references they gave"], ["camera", "On camera (0 = face on camera, 100 = let the music speak)"],
  ["ai", "AI in content (0 = 100% real, 100 = 100% AI)"], ["lnIg", "Instagram"], ["lnTt", "TikTok"], ["lnSp", "Spotify"], ["lnYt", "YouTube"],
  ["platform", "Most natural platform"], ["label", "Status"], ["achievement", "Biggest achievement"], ["holding", "What's holding them back"],
  ["bestLink", "Best post link"], ["bestWhy", "Why they think it worked"], ["tried", "Tried and didn't work"], ["triedNote", "Other things tried"],
  ["hours", "Hours per week for content"], ["budget", "Monthly content budget"], ["team", "Team"], ["footage", "Footage they have"],
  ["live", "Plays live"], ["shows", "Upcoming shows"], ["goal", "#1 goals for 12 months"], ["vision", "Success in 3 years"], ["tenten", "What would make this a 10/10"],
];

function transcript(a) {
  const x = { ...a };
  x.moodNames = (a.mood || []).map((m) => (m === "custom" ? `Their own world: "${a.customName || "unnamed"}" (they uploaded reference images)` : WORLDS[m] || m));
  if (a.palette) x.palette = `${a.palette.n || "Custom"} ${JSON.stringify(a.palette.c || [])}`;
  const out = [];
  for (const [k, l] of LABELS) {
    let v = x[k];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (Array.isArray(v)) v = v.join(", ");
    out.push(`${l}: ${String(v).trim()}`);
  }
  const up = a._up || {};
  if (up.relFile && up.relFile.length) out.push("They uploaded their next track (audio).");
  if (up.photos && up.photos.length) out.push(`They uploaded ${up.photos.length} photo(s) of themselves (attached as images).`);
  if (up.customImgs && up.customImgs.length) out.push(`They uploaded ${up.customImgs.length} reference image(s) for their own world (attached).`);
  return out.join("\n");
}

const SYSTEM = `You are the lead strategist at Vibral Studio, a creative studio that grows electronic music artists (DJs, producers) on Instagram and TikTok. You write the artist's Custom Growth Blueprint: a private strategy website.

THE STANDARD (non-negotiable):
- The artist's answers are raw material, not conclusions. Never reformat what they said.
- Mirror test: if the artist could have written a sentence themselves, rewrite it. Every section adds a diagnosis, a contradiction or an outside insight.
- Never repeat one of their adjectives without sharpening or replacing it.
- Be specific to THIS artist: use their details (shows, tracks, dates, numbers they gave, footage they have, hours they have).
- Never invent numbers, stats, followers, streams or achievements. Only use figures the artist gave you. No fake results.
- Outside insights must be real and well known (an artist's positioning, a genre dynamic). If you're not sure a fact is true, don't use it.
- Do not mention any other Vibral client by name.

VOICE: English. Direct, warm, confident. Short sentences. Second person ("you"). No corporate words, no hype words (no "elevate", "unleash", "game-changer", "journey"). Plain punctuation.

KEYWORD MARKUP: In fields marked [kw], wrap the 1–2 most important words in *asterisks*, e.g. "Stop selling *freedom*. Sell the *delusion*." Nowhere else.

OUTPUT: Call the tool once with a JSON object containing exactly the fields requested.`;

async function imageBlocks(answers, getFile) {
  const up = answers._up || {};
  const list = [...(up.photos || []), ...(up.customImgs || [])].slice(0, 8);
  const blocks = [];
  for (const u of list) {
    try {
      const f = await getFile(u.url);
      if (!f || !f.data || f.data.length > 4.5 * 1024 * 1024) continue;
      if (!/^image\/(jpeg|png|webp|gif)$/.test(f.mime)) continue;
      blocks.push({ type: "image", source: { type: "base64", media_type: f.mime, data: Buffer.from(f.data).toString("base64") } });
    } catch {}
  }
  return blocks;
}

function ex(keys) {
  const o = {};
  for (const k of keys) o[k] = EXAMPLE[k];
  return JSON.stringify(o, null, 1);
}

function mondays(from, n) {
  const d = new Date(from);
  d.setUTCHours(12, 0, 0, 0);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((8 - day) % 7 || 7)); // next Monday
  const out = [];
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
}

// ---------- validation ----------
function need(cond, msg) { if (!cond) throw new Error("Invalid output: " + msg); }
const arr = (x, n) => Array.isArray(x) && (n == null || x.length >= n);
const str = (x) => typeof x === "string" && x.trim().length > 0;

// The model sometimes returns a [kw] field as an object ({text, kw}) or renames a key
// (thesis_detail, diagnosis, scores…). Bring those back to the shape the template expects.
const TEXT_KEYS = ["text", "t", "line", "value", "v", "s", "content", "sentence"];
function txt(x) {
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.filter((y) => typeof y === "string").join(" ");
  if (x && typeof x === "object") {
    for (const k of TEXT_KEYS) if (typeof x[k] === "string" && x[k].trim()) return x[k];
    const v = Object.values(x).find((y) => typeof y === "string" && y.trim().length > 12);
    if (v) return v;
  }
  return x;
}
const canon = (o, map) => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return o;
  const out = { ...o };
  for (const [k, v] of Object.entries(o)) {
    const key = map[k.toLowerCase().replace(/[^a-z]/g, "")];
    if (key && out[key] === undefined) out[key] = v;
  }
  return out;
};
const DIAG_KEYS = { bottleneck: "bottleneck", rootproblem: "bottleneck", problem: "bottleneck", detail: "detail", details: "detail", bottleneckdetail: "detail",
  thesis: "thesis", thesisdetail: "thesisDetail", thesisdetails: "thesisDetail", gauges: "gauges", gauge: "gauges", scores: "gauges", scorecard: "gauges", meters: "gauges" };
const GAUGE_KEYS = { k: "k", key: "k", label: "k", name: "k", title: "k", v: "v", value: "v", score: "v", rating: "v", n: "n", note: "n", why: "n", reason: "n", detail: "n" };
function normalizeDiagnostic(d) {
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return d; } }
  d = canon(d, DIAG_KEYS);
  if (!d || typeof d !== "object") return d;
  ["bottleneck", "detail", "thesis", "thesisDetail"].forEach((k) => { d[k] = txt(d[k]); });
  let g = d.gauges;
  if (g && typeof g === "object" && !Array.isArray(g)) {
    g = Object.entries(g).map(([k, v]) => (v && typeof v === "object" ? { k, ...v } : { k, v, n: "" }));
  }
  if (Array.isArray(g)) d.gauges = g.map((x) => { const y = canon(x, GAUGE_KEYS) || {}; return { k: txt(y.k), v: y.v, n: txt(y.n) || "" }; }).filter((x) => typeof x.k === "string" && x.k);
  return d;
}
function normalizeCore(c) {
  if (!c || typeof c !== "object") return c;
  // Unwrap {core:{…}} / {blueprint:{…}}.
  if (!c.genreLine) { const inner = Object.values(c).find((v) => v && typeof v === "object" && !Array.isArray(v) && v.genreLine); if (inner) Object.assign(c, inner); }
  if (!c.diagnostic) c.diagnostic = c.diagnosis || c.diagnostics || c.Diagnostic;
  c.diagnostic = normalizeDiagnostic(c.diagnostic);
  ["positioning", "bio", "want", "fight", "higgsfield", "genreLine"].forEach((k) => { if (c[k] !== undefined) c[k] = txt(c[k]); });
  return c;
}
function diagnosticOk(d) {
  return !!d && str(d.bottleneck) && str(d.thesis) && str(d.detail) && str(d.thesisDetail) && arr(d.gauges, 5);
}

function checkCore(c) {
  need(str(c.genreLine) && arr(c.badges, 2), "genreLine/badges");
  need(c.fanbase && str(c.fanbase.name) && str(c.fanbase.why) && arr(c.fanbase.alts, 2), "fanbase");
  need(str(c.positioning), "positioning");
  const d = c.diagnostic || {};
  need(str(d.bottleneck) && str(d.thesis) && str(d.detail) && str(d.thesisDetail) && arr(d.gauges, 5), "diagnostic");
  d.gauges.forEach((g) => { g.v = Math.max(1, Math.min(10, Math.round(+g.v || 5))); });
  need(arr(c.disagreements, 3) && arr(c.insights, 2), "disagreements/insights");
  need(str(c.bio) && str(c.want) && str(c.fight) && arr(c.visualRefs, 3), "identity");
  need(str(c.higgsfield) && arr(c.doAI, 3) && arr(c.dontAI, 3), "ai");
  need(arr(c.rules, 6) && arr(c.trials, 4) && arr(c.splitTests, 5), "rules/trials/tests");
  need(arr(c.conceptSeeds, 6) && arr(c.captionStyles, 5), "seeds/styles");
}
const listOf = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : x);
const pick = (o, names) => { for (const n of names) if (o && o[n] !== undefined) return o[n]; return undefined; };
// Unwrap {result:{…}} / {data:{…}} when the expected key is one level down.
function unwrap(o, keys) {
  keys = [].concat(keys);
  const has = (x) => keys.some((k) => x[k] !== undefined);
  if (!o || typeof o !== "object" || has(o)) return o;
  const inner = Object.values(o).find((v) => v && typeof v === "object" && !Array.isArray(v) && has(v));
  return inner ? { ...o, ...inner } : o;
}
function normalizeConcepts(o) {
  o = unwrap(o, ["concepts", "videoConcepts", "videos"]);
  if (o) o.concepts = listOf(pick(o, ["concepts", "videoConcepts", "videos"]));
  if (o && Array.isArray(o.concepts)) o.concepts.forEach((c) => {
    if (!c || typeof c !== "object") return;
    c.n = txt(c.n ?? c.name ?? c.title); c.hook = txt(c.hook); c.caption = txt(c.caption); c.why = txt(c.why);
    c.beats = listOf(c.beats ?? c.shots ?? c.timeline); if (Array.isArray(c.beats)) c.beats = c.beats.map(txt);
  });
  return o;
}
function normalizePlan(o) {
  o = unwrap(o, ["plan", "weeks", "weeklyPlan", "ninetyDayPlan", "actionPlan"]);
  if (!o || typeof o !== "object") return o;
  o.plan = listOf(pick(o, ["plan", "weeks", "weeklyPlan", "ninetyDayPlan", "actionPlan"]));
  o.phases = listOf(pick(o, ["phases", "phase"]));
  o.dayOne = listOf(pick(o, ["dayOne", "day1", "dayone", "DayOne", "today", "firstDay", "day_one"]));
  if (Array.isArray(o.dayOne)) o.dayOne = o.dayOne.map(txt);
  o.release = pick(o, ["release", "nextRelease"]) || o.release;
  if (o.release && typeof o.release === "object") {
    o.release.steps = listOf(pick(o.release, ["steps", "timeline", "plan"]));
    if (Array.isArray(o.release.steps)) o.release.steps = o.release.steps.map(txt);
  }
  if (Array.isArray(o.plan)) o.plan = o.plan.map((w) => (w && typeof w === "object" ? { ...w, t: txt(w.t ?? w.title), do: listOf(w.do ?? w.tasks ?? w.todo), goal: txt(w.goal) } : w));
  return o;
}
function normalizeCaptions(o) {
  o = unwrap(o, "captions");
  if (o && Array.isArray(o.captions)) {
    // [{style, captions:[…]}] → {style: […]}
    const m = {};
    o.captions.forEach((x) => { if (x && typeof x === "object") { const k = txt(x.style ?? x.name ?? x.n); const v = listOf(x.captions ?? x.items ?? x.list); if (k && Array.isArray(v)) m[k] = v; } });
    if (Object.keys(m).length) o.captions = m;
  }
  if (o && o.captions && typeof o.captions === "object") for (const k of Object.keys(o.captions)) { const v = listOf(o.captions[k]); if (Array.isArray(v)) o.captions[k] = v.map(txt); }
  return o;
}
function normalizePrompt(o) {
  o = unwrap(o, ["promptBuilder", "groups"]);
  if (o && !o.promptBuilder && o.groups) o = { promptBuilder: o };
  return o;
}

// Runs one Claude call, normalizes and validates it. On a validation error it asks again and
// tells the model exactly what was wrong (3 tries), instead of failing the whole Blueprint.
async function stage({ toolName, content, maxTokens, normalize = (x) => x, check, describe }) {
  let last, extra = "";
  for (let i = 0; i < 3; i++) {
    try {
      const msg = extra ? content.map((b, j) => (j === content.length - 1 && b.type === "text" ? { ...b, text: b.text + extra } : b)) : content;
      const o = normalize(await callJSON({ toolName, system: SYSTEM, maxTokens, content: msg }));
      check(o);
      return o;
    } catch (e) {
      last = e;
      console.error(`[generate] ${toolName} attempt ${i + 1} failed: ${e.message}`);
      if (/^Invalid output/.test(e.message)) extra = `\n\nIMPORTANT: your previous answer was rejected (${e.message}). Return exactly this shape: ${describe}. Every count is a minimum. Plain strings, no nested objects for text.`;
    }
  }
  throw last;
}

function checkConcepts(o) {
  need(arr(o.concepts, 6), "concepts");
  const used = new Set();
  o.concepts = o.concepts.slice(0, 6).map((c) => {
    need(str(c.n) && str(c.hook) && arr(c.beats, 3) && str(c.caption) && str(c.why), "concept fields");
    if (!CONCEPT_TYPES.includes(c.type) || used.has(c.type)) c.type = CONCEPT_TYPES.find((t) => !used.has(t));
    used.add(c.type);
    return c;
  });
}
function checkPlan(o, weeks) {
  need(arr(o.plan, 13) && arr(o.phases, 3) && arr(o.dayOne, 5) && o.release && arr(o.release.steps, 4), "plan");
  o.plan = o.plan.slice(0, 13).map((w, i) => ({ ...w, w: i + 1, d: weeks[i], ph: Math.max(0, Math.min(2, +w.ph || 0)) }));
  o.phases = o.phases.slice(0, 3);
}
function checkCaptions(o, styles) {
  need(o.captions && typeof o.captions === "object", "captions");
  const keys = Object.keys(o.captions);
  need(keys.length >= 5, "5 caption styles");
  keys.forEach((k) => need(arr(o.captions[k], 10), "13 captions per style"));
}
function checkPrompt(o) {
  const pb = o.promptBuilder;
  need(pb && arr(pb.groups, 5) && pb.defaults && arr(pb.presets, 3), "promptBuilder");
  const fixed = EXAMPLE.promptBuilder.groups;
  const byId = {};
  pb.groups.forEach((g) => { if (g && g.id && arr(g.opts, 2)) byId[g.id] = g; });
  pb.groups = fixed.map((fg) => {
    const g = fg.id === "format" || fg.id === "dur" ? fg : byId[fg.id] || fg;
    return { id: fg.id, n: fg.id === "symbol" ? g.n || fg.n : fg.n, ...(fg.multi ? { multi: fg.multi } : {}), opts: g.opts.filter((x) => Array.isArray(x) && x.length === 2) };
  });
  const fix = (v) => {
    const out = {};
    pb.groups.forEach((g) => {
      const labels = g.opts.map((x) => x[0]);
      let val = v && v[g.id];
      if (g.multi) { val = (Array.isArray(val) ? val : [val]).filter((x) => labels.includes(x)).slice(0, g.multi); if (!val.length) val = [labels[0]]; }
      else if (!labels.includes(val)) val = labels[0];
      out[g.id] = val;
    });
    return out;
  };
  pb.defaults = fix(pb.defaults);
  pb.presets = pb.presets.slice(0, 5).map((p) => ({ n: p.n || "Preset", v: fix(p.v) }));
}

// ---------- main ----------
async function generate(answers, { getFile, onProgress = () => {}, today = new Date(), release = null, previous = null } = {}) {
  const t = transcript(answers);
  const weeks = mondays(today, 13);
  const rel = release || { title: answers.relTitle || "", date: answers.relDate || "" };
  const relLine = rel.date ? `Next release: "${rel.title || "untitled"}" on ${rel.date}.` : "No release date given: build the plan toward a single at week 7.";
  const todayStr = new Date(today).toISOString().slice(0, 10);

  const context = previous
    ? `\n\nTHIS IS A NEW-RELEASE UPDATE of an existing Blueprint. The artist's identity, fanbase name, world, palette and symbol stay locked. Rewrite the diagnostic, disagreements, rules, concepts, plan and captions for the NEW release, using what they told us about the last one.\nNEW RELEASE: "${release.title}" on ${release.date}.\nWhat they said about the last release: ${release.notes || "(nothing)"}\nLOCKED IDENTITY (keep these exactly): fanbase=${JSON.stringify(previous.fanbase)}, positioning=${JSON.stringify(previous.positioning)}, bio=${JSON.stringify(previous.bio)}, want=${JSON.stringify(previous.want)}, fight=${JSON.stringify(previous.fight)}, visualRefs=${JSON.stringify(previous.visualRefs)}.\nPrevious concepts (do not repeat more than 2 of them): ${previous.concepts.map((c) => c.n).join(", ")}.`
    : "";

  onProgress({ stage: "core", done: ["read"], active: ["core"] });

  // ---- Stage 1: core strategy
  const coreAsk = `Today is ${todayStr}. ${relLine}

THE ARTIST'S INTAKE:
${t}${context}

Write the core of their Blueprint. Return these fields (example of shape and quality from another artist below — match the depth, never copy the content):
- genreLine: their lane, e.g. "Melodic house · Progressive". Correct it if their references say otherwise.
- badges: 3 short credentials from their answers (venues, labels, release + date). Only real ones they gave.
- fanbase: {name, single, why, alts:[{n,w},{n,w}]}. If they have a name, sharpen it or keep it and say why; always give 2 alternatives.
- positioning [kw]: one sentence.
- diagnostic: {bottleneck [kw] (one root problem, one line), detail (why, using their specifics), thesis [kw] (counter-intuitive, something they did NOT say), thesisDetail, gauges: exactly 5 of {k, v (1-10), n}}.
- disagreements: 3–4 of {you: a short quote paraphrasing something they said, in double quotes, us: why you disagree and what to do instead}.
- insights: 2 of {t, d}: real outside insights about named artists or genre dynamics relevant to them.
- bio: ready-to-paste Instagram bio, 3 short lines separated by \\n, under 150 characters, ends pointing to their release.
- want, fight: what their fan wants to become / is fighting against, sharpened.
- visualRefs: 3 of {n, w}: named directors, photographers or films that fit their world (use theirs if they gave good ones).
- higgsfield: one full cinematic AI video prompt paragraph for their release visual, 9:16, using their palette hex codes and symbol, ending "Clean frame, text-free, single continuous shot, 8 seconds."
- doAI, dontAI: 3 each, calibrated to their AI slider.
- rules: 6 of {t [kw], d}: rules of the game for them specifically.
- trials: 4 of {t, d} about Instagram Trial Reels, titles: "What it is", "How you use it", "Where it fits you", "Why it changes everything".
- splitTests: 5 of {v, t, i ("High"|"Medium"|"Low")}.
- conceptSeeds: 6 of {n, type, idea}: video formats (named series) they'll repeat. type is one of: ${CONCEPT_TYPES.join(", ")} (all different, pick the image that best fits). Exactly one must be born from a contradiction in their answers (add "contra": "You X → we make it Y.").
- captionStyles: 5 caption style names tied to their concepts and voice (e.g. a series name, "Short & Loud").
${previous ? "- Keep fanbase, positioning, bio, want, fight, visualRefs identical to the locked identity." : ""}

EXAMPLE (another artist):
${ex(["genreLine", "badges", "fanbase", "positioning", "diagnostic", "disagreements", "insights", "bio", "want", "fight", "visualRefs", "higgsfield", "doAI", "dontAI", "rules", "trials", "splitTests"])}`;

  const imgs = getFile ? await imageBlocks(answers, getFile) : [];
  let coreFix = "";
  const core = await withRetry(async () => {
    const c = normalizeCore(await callJSON({ toolName: "write_core", system: SYSTEM, content: [...imgs, { type: "text", text: coreAsk + coreFix }], maxTokens: 12000 }));
    if (!diagnosticOk(c.diagnostic)) {
      // Rewrite only the diagnostic instead of failing the whole Blueprint.
      console.error("[generate] diagnostic came back malformed, repairing:", JSON.stringify(c.diagnostic || null).slice(0, 600));
      const d = await callJSON({
        toolName: "write_diagnostic", system: SYSTEM, maxTokens: 3000,
        content: [{ type: "text", text: `Today is ${todayStr}. ${relLine}\n\nTHE ARTIST'S INTAKE:\n${t}${context}\n\nWrite ONLY their diagnostic. Return exactly {"diagnostic": {"bottleneck": string, "detail": string, "thesis": string, "thesisDetail": string, "gauges": [5 of {"k": string, "v": number 1-10, "n": string}]}}. All five fields are plain strings except gauges. bottleneck [kw]: one root problem, one line. detail: why, using their specifics. thesis [kw]: counter-intuitive, something they did NOT say. Wrap the key words of bottleneck and thesis in *asterisks*.\n\nEXAMPLE (another artist, match the depth, never copy):\n${ex(["diagnostic"])}` }],
      });
      c.diagnostic = normalizeDiagnostic(d && (d.diagnostic || d));
    }
    try { checkCore(c); } catch (e) {
      console.error("[generate] write_core failed: " + e.message);
      coreFix = `\n\nIMPORTANT: a previous answer was rejected (${e.message}). Return every field listed above with at least the counts given, as plain strings.`;
      throw e;
    }
    return c;
  }, 3);
  if (previous) Object.assign(core, { fanbase: previous.fanbase, positioning: previous.positioning, bio: previous.bio, want: previous.want, fight: previous.fight, visualRefs: previous.visualRefs });

  const brief = `THE ARTIST'S INTAKE:\n${t}\n\nTHE STRATEGY ALREADY WRITTEN FOR THEM:\n${JSON.stringify({ genreLine: core.genreLine, fanbase: core.fanbase, positioning: core.positioning, diagnostic: core.diagnostic, rules: core.rules, conceptSeeds: core.conceptSeeds }, null, 1)}`;
  const done = ["read", "core"];
  const active = new Set(["world", "concepts", "plan", "captions"]);
  const mark = (k) => { active.delete(k); done.push(k); onProgress({ stage: "", done: [...done], active: [...active] }); };
  onProgress({ stage: "", done: [...done], active: [...active] });

  // ---- Stage 2: parallel
  const pConcepts = stage({ toolName: "write_concepts", maxTokens: 8000, content: [{ type: "text", text: `${brief}\n\nWrite their 6 video concepts from the conceptSeeds (same order, same names and types). Each: {n, tag (2–4 words), contra (only on the contradiction one), hook (the on-screen line, under 80 chars), beats: 3–4 timed beats like "0–2s: …", caption, why (why it works for THEM), type}. Use footage and resources they actually have.\n\nReturn {concepts:[…]}.\n\nEXAMPLE:\n${ex(["concepts"])}` }], normalize: normalizeConcepts, check: (o) => checkConcepts(o), describe: "{\"concepts\": [6 of {\"n\",\"tag\",\"hook\",\"beats\": [3-4 strings],\"caption\",\"why\",\"type\"}]}" }).then((o) => { mark("concepts"); return o; });

  const pPlan = stage({ toolName: "write_plan", maxTokens: 9000, content: [{ type: "text", text: `${brief}\n\nToday is ${todayStr}. ${relLine}\nWeek start dates (Mondays): ${weeks.map((d, i) => `W${i + 1} ${d}`).join(", ")}.\n\nWrite:\n- release: {title, date (YYYY-MM-DD), presaveOpen (YYYY-MM-DD, about 3 weeks before), steps: 5 short steps}. If no date was given, set the date in week 7 and title "Next single".\n- plan: 13 weeks of {w, d (the Monday given), ph (0, 1 or 2), t (short title), do: 2–4 concrete tasks using their concept names and real dates/shows they gave, goal}. Fit their hours per week.\n- phases: 3 of {n, g}.\n- dayOne: 5 things to do today.\n\nReturn {release, plan, phases, dayOne}.\n\nEXAMPLE:\n${ex(["release", "plan", "phases", "dayOne"])}` }], normalize: normalizePlan, check: (o) => checkPlan(o, weeks), describe: "{\"release\": {\"title\",\"date\",\"presaveOpen\",\"steps\": [5 strings]}, \"plan\": [13 of {\"w\",\"d\",\"ph\",\"t\",\"do\": [2-4 strings],\"goal\"}], \"phases\": [3 of {\"n\",\"g\"}], \"dayOne\": [5 strings]}" }).then((o) => { mark("plan"); return o; });

  const pCaptions = stage({ toolName: "write_captions", maxTokens: 6000, content: [{ type: "text", text: `${brief}\n\nWrite their caption bank: 13 captions for each of these 5 styles (65 total): ${core.captionStyles.join(", ")}. In their voice, short, no hashtags, varied. Return {captions: {"Style name": [13 strings], …}}.\n\nEXAMPLE (6 per style shown, you write 13):\n${ex(["captions"])}` }], normalize: normalizeCaptions, check: (o) => checkCaptions(o, core.captionStyles), describe: "{\"captions\": {\"Style name\": [13 strings], ... 5 styles}}" }).then((o) => { mark("captions"); return o; });

  const sym = answers.symbol || "";
  const pPrompt = stage({ toolName: "write_prompt", maxTokens: 6000, content: [{ type: "text", text: `${brief}\n\nTheir palette: ${JSON.stringify((answers.palette && answers.palette.c) || [])}. Their symbol: ${sym || answers.symbolOther || "none"}. Their worlds: ${(answers.mood || []).map((m) => (m === "custom" ? answers.customName || "their own world" : WORLDS[m])).join("; ")}.\n\nBuild their AI prompt builder: {groups, defaults, presets}. Groups (keep these ids, in this order): format, scene, subject, symbol, camera, light, texture, mood (multi: 3), dur. Each option is [label (1–3 words), prompt fragment]. Write 6–8 scenes from THEIR worlds, 4 subjects that fit how they show up (respect their on-camera slider), 4 symbol options (last one ["Off", ""]; group name "Your ${sym || "symbol"}"), 5 cameras, 5 lights, 3 textures, 7 moods. Copy format and dur from the example. defaults = their release visual. presets = 5 named presets tied to their release and concepts.\n\nEXAMPLE:\n${ex(["promptBuilder"])}` }], normalize: normalizePrompt, check: (o) => checkPrompt(o), describe: "{\"promptBuilder\": {\"groups\": [9 of {\"id\",\"n\",\"opts\": [[label, fragment], ...]}], \"defaults\": {groupId: label}, \"presets\": [5 of {\"n\",\"v\": {groupId: label}}]}}" }).then((o) => { mark("world"); return o; });

  const [cc, pl, cp, pb] = await Promise.all([pConcepts, pPlan, pCaptions, pPrompt]);

  const seeds = core.conceptSeeds;
  cc.concepts.forEach((c, i) => { if (!c.contra && seeds[i] && seeds[i].contra) c.contra = seeds[i].contra; });

  const up = answers._up || {};
  const content = {
    artist: (answers.name || "").trim() || "Artist",
    genreLine: core.genreLine,
    badges: core.badges.slice(0, 3),
    palette: (answers.palette && answers.palette.c && answers.palette.c.length === 3 ? answers.palette.c : EXAMPLE.palette),
    symbol: sym || (answers.symbolOther ? "✶" : "✶"),
    mood: (answers.mood || []).slice(0, 3),
    fanbase: core.fanbase,
    positioning: core.positioning,
    diagnostic: core.diagnostic,
    disagreements: core.disagreements,
    insights: core.insights.slice(0, 2),
    bio: core.bio,
    want: core.want,
    fight: core.fight,
    visualRefs: core.visualRefs.slice(0, 3),
    higgsfield: core.higgsfield,
    doAI: core.doAI.slice(0, 3),
    dontAI: core.dontAI.slice(0, 3),
    concepts: cc.concepts,
    rules: core.rules.slice(0, 6),
    trials: core.trials.slice(0, 4),
    splitTests: core.splitTests.slice(0, 5),
    release: pl.release,
    plan: pl.plan,
    phases: pl.phases,
    captions: cp.captions,
    dayOne: pl.dayOne.slice(0, 5),
    promptBuilder: pb.promptBuilder,
  };
  while (content.mood.length < 3) content.mood.push(["golden", "cosmic", "nightride"].find((m) => !content.mood.includes(m)));
  if (content.mood.includes("custom")) content.customWorld = { name: answers.customName || "Your world", imgs: (up.customImgs || []).map((u) => u.url) };
  if (previous) Object.assign(content, { artist: previous.artist, palette: previous.palette, symbol: previous.symbol, mood: previous.mood, customWorld: previous.customWorld, genreLine: previous.genreLine });
  return content;
}

module.exports = { generate, transcript, mondays, CONCEPT_TYPES };
