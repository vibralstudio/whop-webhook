const fs   = require('fs');
const path = require('path');

const DATA_DIR      = path.join(__dirname, '..', 'data');
const CONTENT_FILE  = path.join(DATA_DIR, 'vgb-content.json');

const DEFAULT_CONTENT = {
  published: {
    lastUpdated: new Date().toISOString(),
    weekLabel: 'Week 1',
    sections: [],
  },
  draft: null,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONTENT_FILE)) fs.writeFileSync(CONTENT_FILE, JSON.stringify(DEFAULT_CONTENT, null, 2));
}

function readContent() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
}

function writeContent(data) {
  ensureDataDir();
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2));
}

function getPublished() {
  return readContent().published;
}

function getDraft() {
  return readContent().draft;
}

function saveDraft(sections, weekLabel) {
  const content = readContent();
  content.draft = {
    createdAt: new Date().toISOString(),
    weekLabel: weekLabel ?? `Week of ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    sections,
  };
  writeContent(content);
}

function publishDraft() {
  const content = readContent();
  if (!content.draft) throw new Error('No draft to publish');
  content.published = {
    ...content.draft,
    lastUpdated: new Date().toISOString(),
  };
  content.draft = null;
  writeContent(content);
  return content.published;
}

function publishDirect(sections, weekLabel) {
  const content = readContent();
  content.published = {
    lastUpdated: new Date().toISOString(),
    weekLabel: weekLabel ?? content.published.weekLabel,
    sections,
  };
  content.draft = null;
  writeContent(content);
  return content.published;
}

module.exports = { getPublished, getDraft, saveDraft, publishDraft, publishDirect };
