function renderAdminDashboard(subscribers, published, draft) {
  const activeCount = subscribers.filter(s => s.active).length;

  const subscriberRows = subscribers
    // Postgres returns created_at (snake_case); createdAt never existed, which showed "Invalid Date"
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(s => `
      <tr>
        <td>${escHtml(s.email)}</td>
        <td>${fmtDate(s.created_at)}</td>
        <td><span class="badge ${s.active ? 'badge-active' : 'badge-inactive'}">${s.active ? 'Active' : 'Cancelled'}</span></td>
        <td class="row-actions">
          <a href="/vgb/${s.token}" target="_blank" class="link">View →</a>
          <button type="button" class="btn-link" onclick="navigator.clipboard.writeText(location.origin+'/vgb/${s.token}').then(()=>{this.textContent='Copied ✓';setTimeout(()=>{this.textContent='Copy link'},1500)})">Copy link</button>
          <form method="POST" action="/admin/vgb/${s.id}/resend" style="display:inline;" onsubmit="return confirm('Resend the access email to ${escHtml(s.email)}?')">
            <button type="submit" class="btn-link">Resend email</button>
          </form>
          <form method="POST" action="/admin/vgb/${s.id}/active" style="display:inline;" onsubmit="return confirm('${s.active ? 'Remove access for ' + escHtml(s.email) + '?' : 'Give access back to ' + escHtml(s.email) + '?'}')">
            <input type="hidden" name="active" value="${s.active ? '0' : '1'}">
            <button type="submit" class="btn-link ${s.active ? 'danger' : ''}">${s.active ? 'Remove' : 'Reactivate'}</button>
          </form>
        </td>
      </tr>
    `).join('');

  const draftBanner = draft ? `
    <div class="draft-banner">
      <div>
        <strong>Draft ready:</strong> ${escHtml(draft.weekLabel)}
        <span style="color:var(--text-muted);font-size:12px;margin-left:12px;">Created ${fmtDate(draft.createdAt)}</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <a class="btn" href="/admin/preview/draft" target="_blank">Preview in app ↗</a>
        <form method="POST" action="/admin/dashboard/draft" style="display:inline;">
          <button type="submit" class="btn">${hasDash(draft) ? 'Rebuild dashboard' : 'Build dashboard'}</button>
        </form>
        <form method="POST" action="/admin/publish" style="display:inline;">
          <button type="submit" class="btn btn-gold">Publish to All Subscribers →</button>
        </form>
      </div>
    </div>
  ` : '';
  const liveBar = `
    <div class="draft-banner" style="border-color:var(--grey);">
      <div>
        <strong>Live app:</strong> ${escHtml(published.weekLabel || '')}
        <span style="color:var(--text-muted);font-size:12px;margin-left:12px;">This Week dashboard: ${hasDash(published) ? 'ready' : 'not built yet'}</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a class="btn" href="/admin/preview" target="_blank">Open live app ↗</a>
        <form method="POST" action="/admin/dashboard/published" style="display:inline;">
          <button type="submit" class="btn">${hasDash(published) ? 'Rebuild dashboard' : 'Build dashboard'}</button>
        </form>
      </div>
    </div>`;

  const sectionsJson = JSON.stringify(published.sections ?? [], null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VGB Admin — Vibral Studio</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
  :root{--black:#0A0A08;--black2:#111110;--gold:#C8A96E;--gold-dim:#9A7D4A;--white:#F0EDE6;--grey:#2A2A28;--text-muted:#888880;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:var(--black);color:var(--white);font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.7;-webkit-font-smoothing:antialiased;}
  .header{padding:24px 48px;border-bottom:1px solid var(--grey);display:flex;align-items:center;justify-content:space-between;}
  .header-brand{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.2em;color:var(--gold);text-transform:uppercase;}
  .main{padding:48px;}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;margin-bottom:40px;}
  .stat{background:var(--black2);border:1px solid var(--grey);padding:28px 24px;}
  .stat-num{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;color:var(--gold);line-height:1;}
  .stat-label{font-size:12px;color:var(--text-muted);margin-top:6px;text-transform:uppercase;letter-spacing:0.1em;}
  .section-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:var(--white);margin-bottom:20px;}
  .draft-banner{background:var(--black2);border:1px solid var(--gold);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;gap:16px;}
  table{width:100%;border-collapse:collapse;margin-bottom:48px;}
  th{font-family:'Syne',sans-serif;font-size:10px;font-weight:700;letter-spacing:0.15em;color:var(--gold);text-transform:uppercase;text-align:left;padding:0 16px 16px 0;border-bottom:1px solid var(--gold-dim);}
  td{padding:16px 16px 16px 0;border-bottom:1px solid var(--grey);font-size:13px;color:var(--text-muted);vertical-align:middle;}
  .badge{padding:4px 10px;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;font-family:'Syne',sans-serif;}
  .badge-active{background:#1a2e1a;color:#4ade80;border:1px solid #4ade80;}
  .badge-inactive{background:#2e1a1a;color:#f87171;border:1px solid #f87171;}
  .link{color:var(--gold);text-decoration:none;font-size:12px;}
  .editor-area{background:var(--black2);border:1px solid var(--grey);padding:24px;margin-bottom:16px;}
  .editor-area label{font-family:'Syne',sans-serif;font-size:10px;font-weight:700;letter-spacing:0.15em;color:var(--gold);text-transform:uppercase;display:block;margin-bottom:12px;}
  textarea{width:100%;background:#0a0a08;border:1px solid var(--grey);color:var(--white);padding:16px;font-family:'DM Sans',sans-serif;font-size:13px;line-height:1.6;resize:vertical;min-height:320px;}
  input[type=text]{width:100%;background:#0a0a08;border:1px solid var(--grey);color:var(--white);padding:12px 16px;font-family:'DM Sans',sans-serif;font-size:13px;margin-bottom:16px;}
  .btn{display:inline-block;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:14px 24px;cursor:pointer;border:none;}
  .btn-gold{background:var(--gold);color:var(--black);}
  .btn:not(.btn-gold){background:transparent;color:var(--white);border:1px solid var(--grey);text-decoration:none;}
  .btn:not(.btn-gold):hover{border-color:var(--gold);color:var(--gold);}
  .row-actions{display:flex;gap:16px;align-items:center;}
  .btn-link{background:none;border:none;padding:0;font:inherit;font-size:12px;color:var(--text-muted);cursor:pointer;text-decoration:underline;}
  .btn-link.danger{color:#f87171;}
  .tabs{display:flex;gap:6px;}
  .tabs a{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:var(--text-muted);text-decoration:none;padding:8px 14px;border:1px solid transparent;}
  .tabs a.on{color:var(--gold);border-color:var(--gold-dim);}
  .help{font-size:12px;color:var(--text-muted);margin-bottom:16px;line-height:1.6;}
</style>
</head>
<body>

<div class="header">
  <span class="header-brand">Vibral Studio — Admin</span>
  <nav class="tabs"><a href="/admin" class="on">VGB</a><a href="/admin/custom">Custom</a></nav>
  <span style="font-size:12px;color:var(--text-muted);">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</span>
</div>

<div class="main">
  <div class="stats">
    <div class="stat">
      <div class="stat-num">${activeCount}</div>
      <div class="stat-label">Active subscribers</div>
    </div>
    <div class="stat">
      <div class="stat-num">${subscribers.length}</div>
      <div class="stat-label">Total all time</div>
    </div>
    <div class="stat">
      <div class="stat-num">$${(activeCount * VGB_PRICE).toLocaleString('en-US')}</div>
      <div class="stat-label">Monthly recurring</div>
    </div>
  </div>

  ${draftBanner}
  ${liveBar}

  <div class="section-title">Subscribers</div>
  <table>
    <thead><tr><th>Email</th><th>Joined</th><th>Status</th><th>Link</th></tr></thead>
    <tbody>${subscriberRows || '<tr><td colspan="4" style="color:var(--text-muted);">No subscribers yet.</td></tr>'}</tbody>
  </table>

  <div class="section-title" style="margin-bottom:8px;">Edit VGB Content</div>
  <p class="help">
    Modifie les sections en JSON. Chaque section a: <code>num</code>, <code>title</code>, <code>lead</code>, <code>cards</code> (array de {label, title, body}), <code>insight</code>, et optionnellement <code>weeklyUpdate</code> (box "This week" en or).<br>
    Clique <strong>Save & Publish</strong> pour pusher les changements live à tous les abonnés instantanément.
  </p>

  <form method="POST" action="/admin/save">
    <div class="editor-area">
      <label>Week Label</label>
      <input type="text" name="weekLabel" value="${escHtml(published.weekLabel ?? '')}" placeholder="e.g. Week of June 16, 2026">
    </div>
    <div class="editor-area">
      <label>Sections (JSON)</label>
      <textarea name="sectionsJson">${escHtml(sectionsJson)}</textarea>
    </div>
    <button type="submit" class="btn btn-gold">Save & Publish to All Subscribers →</button>
  </form>
</div>
</body>
</html>`;
}

function hasDash(doc) {
  return !!(doc && Array.isArray(doc.sections) && doc.sections.some((x) => /this week/i.test(x.num || '') && x.dashboard));
}

// Monthly VGB price used for the MRR card (set VGB_PRICE on Railway if it changes)
const VGB_PRICE = Number(process.env.VGB_PRICE) || 97;

function fmtDate(d) {
  const t = d ? new Date(d) : null;
  return t && !isNaN(t) ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

module.exports = { renderAdminDashboard };
