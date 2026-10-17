// Renders the VGB member app (views/vgb/app.html) from the published weekly content.
// The app's evergreen tabs (rules, hooks, concepts, release, brand, prompts, tracker) live in the template.
// Only the "This Week" tab comes from the weekly draft → approve → publish flow.
const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'views', 'vgb', 'app.html'), 'utf8');

const CTA = {
  url: process.env.VGB_CUSTOM_URL || 'https://whop.com/vibral-studio/custom-growth-blueprint-copy/',
  label: process.env.VGB_CUSTOM_LABEL || 'Get it for $451',
  sub: 'Custom Growth Blueprint · built around you · ready in minutes',
};

function findWeek(sections) {
  if (!Array.isArray(sections)) return null;
  return sections.find((s) => /this week/i.test(s.num || '')) ||
         sections.find((s) => /working right now/i.test(s.title || '')) || null;
}

function buildData(published) {
  const sections = (published && published.sections) || [];
  const src = findWeek(sections);
  if (!src) {
    return { week: { title: 'Your first weekly update lands Monday.', dashboard: { weekLabel: '' } }, cta: CTA };
  }
  const week = { num: src.num, title: src.title, cards: src.cards || [] };
  const dash = Object.assign({}, src.dashboard || {});
  if (!dash.weekLabel) {
    const posts = /(\d[\d,]*)\s+posts/i.exec(src.lead || '');
    dash.weekLabel = [published.weekLabel, posts ? `${posts[1]} posts analyzed` : ''].filter(Boolean).join(' · ');
  }
  week.dashboard = dash;
  return { week, cta: CTA };
}

function renderVGBApp(published) {
  const json = JSON.stringify(buildData(published))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return TEMPLATE.replace('__VGB_DATA__', () => json);
}

module.exports = { renderVGBApp, buildData };
