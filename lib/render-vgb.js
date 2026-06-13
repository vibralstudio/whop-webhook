function renderVGBPage(published, subscriberEmail) {
  const { weekLabel, lastUpdated, sections } = published;

  const sectionsHtml = sections.length === 0
    ? `<div class="empty-state" style="padding:64px;text-align:center;color:#888880;">The first update is coming this Monday. Check back soon.</div>`
    : sections.map(s => renderSection(s)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Viral Growth Blueprint — Vibral Studio</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
  :root{--black:#0A0A08;--black2:#111110;--gold:#C8A96E;--gold-dim:#9A7D4A;--white:#F0EDE6;--grey:#2A2A28;--text-muted:#888880;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:var(--black);color:var(--white);font-family:'DM Sans',sans-serif;font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased;}
  .header{padding:32px 64px;border-bottom:1px solid var(--grey);display:flex;align-items:center;justify-content:space-between;}
  .header-brand{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.2em;color:var(--gold);text-transform:uppercase;}
  .hero{padding:64px 64px 48px;border-bottom:1px solid var(--grey);}
  .hero-eyebrow{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.2em;color:var(--gold-dim);text-transform:uppercase;margin-bottom:24px;}
  .hero-title{font-family:'Syne',sans-serif;font-size:clamp(40px,6vw,72px);font-weight:800;line-height:0.95;letter-spacing:-0.02em;margin-bottom:16px;}
  .hero-title span{color:var(--gold);}
  .hero-sub{font-size:15px;color:var(--text-muted);max-width:520px;line-height:1.8;font-weight:300;}
  .week-badge{display:inline-block;background:var(--black2);border:1px solid var(--gold);padding:6px 16px;font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.15em;color:var(--gold);text-transform:uppercase;margin-top:24px;}
  .content{padding:0 64px 80px;}
  .section{padding:64px 0;border-bottom:1px solid var(--grey);}
  .section:last-child{border-bottom:none;}
  .section-num{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.2em;color:var(--gold-dim);text-transform:uppercase;margin-bottom:32px;}
  .section-title{font-family:'Syne',sans-serif;font-size:clamp(28px,4vw,48px);font-weight:800;line-height:0.95;letter-spacing:-0.02em;margin-bottom:16px;}
  .section-lead{font-size:15px;color:var(--text-muted);max-width:580px;line-height:1.8;font-weight:300;margin-bottom:40px;}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-bottom:32px;}
  .card{background:var(--black2);border:1px solid var(--grey);padding:28px 24px;}
  .card-label{font-family:'Syne',sans-serif;font-size:10px;font-weight:700;letter-spacing:0.2em;color:var(--gold);text-transform:uppercase;margin-bottom:12px;}
  .card-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:var(--white);margin-bottom:8px;line-height:1.2;}
  .card-body{font-size:13px;color:var(--text-muted);font-weight:300;line-height:1.7;}
  .insight{background:var(--black2);border:1px solid var(--grey);border-left:3px solid var(--gold);padding:24px 28px;}
  .insight p{font-size:14px;color:var(--white);line-height:1.8;font-weight:300;}
  .insight strong{color:var(--gold);font-weight:500;}
  .update-banner{background:var(--black2);border:1px solid var(--gold);border-top:2px solid var(--gold);padding:24px 28px;margin-bottom:32px;}
  .update-banner p{font-size:13px;color:var(--text-muted);line-height:1.7;}
  .update-banner strong{color:var(--gold);}
  .footer{padding:32px 64px;border-top:1px solid var(--grey);display:flex;align-items:center;justify-content:space-between;}
  .footer p{font-size:12px;color:var(--text-muted);}
  .footer a{color:var(--gold);text-decoration:none;}
  @media(max-width:768px){.header,.hero,.content,.footer{padding-left:24px;padding-right:24px;}.cards{grid-template-columns:1fr;}}
</style>
</head>
<body>

<div class="header">
  <span class="header-brand">Vibral Studio — Viral Growth Blueprint</span>
  <span style="font-size:12px;color:var(--text-muted);">Updated every Monday</span>
</div>

<div class="hero">
  <div class="hero-eyebrow">Your personal growth system</div>
  <h1 class="hero-title">VIRAL<br><span>GROWTH</span><br>BLUEPRINT</h1>
  <p class="hero-sub">The complete system — updated every week with what's actually working right now. Not last quarter. This week.</p>
  <div class="week-badge">📅 ${weekLabel} · Last updated ${new Date(lastUpdated).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
</div>

<div class="content">
  ${sectionsHtml}
</div>

<div class="footer">
  <p>© Vibral Studio 2026 · <a href="mailto:contact@vibralstudio.com">contact@vibralstudio.com</a></p>
  <p>${subscriberEmail}</p>
</div>

</body>
</html>`;
}

function renderSection(section) {
  const cardsHtml = (section.cards ?? []).map(card => `
    <div class="card">
      <div class="card-label">${escHtml(card.label ?? '')}</div>
      <div class="card-title">${escHtml(card.title ?? '')}</div>
      <p class="card-body">${escHtml(card.body ?? '')}</p>
    </div>
  `).join('');

  const insightHtml = section.insight
    ? `<div class="insight"><p>${escHtml(section.insight)}</p></div>`
    : '';

  const updateHtml = section.weeklyUpdate
    ? `<div class="update-banner"><p><strong>🔥 This week:</strong> ${escHtml(section.weeklyUpdate)}</p></div>`
    : '';

  return `
    <div class="section">
      <div class="section-num">${escHtml(section.num ?? '')}</div>
      <h2 class="section-title">${escHtml(section.title ?? '')}</h2>
      <p class="section-lead">${escHtml(section.lead ?? '')}</p>
      ${updateHtml}
      ${section.cards?.length ? `<div class="cards">${cardsHtml}</div>` : ''}
      ${insightHtml}
    </div>
  `;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

module.exports = { renderVGBPage };
