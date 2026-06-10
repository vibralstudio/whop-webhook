const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '../assets/Custom_Blueprint_Template.html'),
  'utf8',
);

function e(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inject(html, section, content) {
  const re = new RegExp(
    `<!-- ARTIST:${section} -->[\\s\\S]*?<!-- /ARTIST:${section} -->`,
    'g',
  );
  return html.replace(
    re,
    `<!-- ARTIST:${section} -->\n${content}\n  <!-- /ARTIST:${section} -->`,
  );
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildCoverMain(d) {
  const nameLine = d.name_line2
    ? `${e(d.name_line1)}<br>${e(d.name_line2)}`
    : e(d.name_line1);
  return `  <div class="cover-for">Built for</div>
  <div class="cover-name">${nameLine}</div>
  <div class="cover-title">Growth Blueprint</div>
  <div class="cover-bar"></div>
  <div class="cover-pills">
    <div class="cover-pill">${e(d.genre)}</div>
    <div class="cover-pill">${e(d.fanbase_name)}</div>
    <div class="cover-pill">${e(d.cover_pill3)}</div>
  </div>
  <div class="cover-quote">"${e(d.cover_quote)}"</div>`;
}

function buildWhoYouAre(d) {
  const idItems = d.identity
    .map(
      (item) =>
        `    <div class="id-item"><div class="id-label">${e(item.label)}</div><div class="id-val">${e(item.value)}</div></div>`,
    )
    .join('\n');

  return `  <div class="id-grid">
${idItems}
  </div>

  <h3>${e(d.fanbase_name)} — Your Fanbase</h3>
  <p>${e(d.fanbase_description)}</p>

  <div class="two-col" style="margin-top:16px;">
    <div class="card"><div class="card-label">They want to become</div><div class="card-body">${e(d.fanbase_want)}</div></div>
    <div class="card"><div class="card-label">They fight against</div><div class="card-body">${e(d.fanbase_against)}</div></div>
  </div>

  <div class="insight">
    <div class="insight-l">If Someone Criticized Your Music</div>
    <p>${e(d.fanbase_pushback)}</p>
  </div>`;
}

function buildWhereYouStand(d) {
  const stats = d.current_stats
    .map(
      (s) =>
        `    <div class="stat"><div class="stat-n">${e(s.n)}</div><div class="stat-l">${e(s.l)}</div></div>`,
    )
    .join('\n');

  return `  <p class="lead">${e(d.current_lead)}</p>

  <div class="stats">
${stats}
  </div>

  <h3>What's Working</h3>
  <p>${e(d.whats_working)}</p>

  <h3>What's Holding You Back</h3>
  <p>${e(d.holding_back)}</p>

  <div class="insight">
    <div class="insight-l">The Real Gap</div>
    <p>${e(d.current_insight)}</p>
  </div>`;
}

function buildVideoConcepts(d) {
  return d.video_concepts
    .map(
      (c) => `  <div class="concept">
    <div class="concept-num">${e(c.num)}</div>
    <div>
      <div class="concept-title">${e(c.title)}</div>
      <div class="concept-body">${e(c.body)}</div>
      <div class="concept-caption">→ "${e(c.caption)}"</div>
    </div>
  </div>`,
    )
    .join('\n');
}

function buildSplitTest(d) {
  const rows = d.split_tests
    .map(
      (r) =>
        `      <tr><td>${e(r.variable)}</td><td>${e(r.test)}</td><td><span class="impact">${e(r.impact)}</span></td></tr>`,
    )
    .join('\n');

  return `  <table class="split-table">
    <thead>
      <tr><th>Variable</th><th>What you test</th><th>Impact</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h3>Hashtag Strategy</h3>
  <p>${e(d.hashtag_strategy)}</p>

  <h3>End CTA — Always</h3>
  <p>Add a CTA in the last 5 seconds. Always push for the share — <strong>"Send this to a friend that loves ${e(d.genre_lower)}."</strong> Shares compound. Likes don't.</p>

  <div class="insight">
    <div class="insight-l">The Higgsfield Prompt for ${e(d.artist_name)}</div>
    <p>${e(d.higgsfield_prompt)}</p>
  </div>`;
}

function buildCaptions(d) {
  return d.captions
    .map((style) => {
      const items = style.captions
        .map((cap) => `    <li>${e(cap)}</li>`)
        .join('\n');
      return `  <div class="cap-style">${e(style.style_name)}</div>
  <ul class="cap-list">
${items}
  </ul>`;
    })
    .join('\n');
}

function buildBrandingContent(d) {
  const cards = d.branding_bible
    .map(
      (b) =>
        `    <div class="card"><div class="card-label">${e(b.label)}</div><div class="card-body">${e(b.body)}</div></div>`,
    )
    .join('\n');

  const checklist = d.day1_checklist
    .map(
      (item) =>
        `    <li><div class="it"><strong>${e(item.bold)}</strong> ${e(item.rest)}</div></li>`,
    )
    .join('\n');

  return `  <h3>Your Branding Bible — One Page</h3>
  <div class="two-col">
${cards}
  </div>

  <h3>Day 1 Checklist</h3>
  <ul class="num-list">
${checklist}
  </ul>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

function renderTemplate(data) {
  const date = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const d = { ...data, date };

  let html = TEMPLATE;

  html = inject(html, 'cover-main', buildCoverMain(d));
  html = inject(html, 'who-you-are', buildWhoYouAre(d));
  html = inject(html, 'where-you-stand', buildWhereYouStand(d));
  html = inject(html, 'video-concepts', buildVideoConcepts(d));
  html = inject(html, 'split-test', buildSplitTest(d));
  html = inject(html, 'captions', buildCaptions(d));
  html = inject(html, 'branding-content', buildBrandingContent(d));

  // Global token substitution for static sections (footer, cover-bottom, Rules page)
  html = html
    .replaceAll('{{ARTIST_NAME}}', e(d.artist_name))
    .replaceAll('{{DATE}}', e(d.date))
    .replaceAll('{{GENRE_LOWER}}', e(d.genre_lower));

  return html;
}

module.exports = { renderTemplate };
