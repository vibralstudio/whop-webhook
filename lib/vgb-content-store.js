const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vgb_content (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Insert default if empty
  await pool.query(`
    INSERT INTO vgb_content (id, data)
    VALUES ('published', '{"weekLabel":"Week 1","lastUpdated":"${new Date().toISOString()}","sections":[]}')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO vgb_content (id, data)
    VALUES ('draft', 'null')
    ON CONFLICT (id) DO NOTHING
  `);
}

async function getPublished() {
  await ensureTable();
  const res = await pool.query('SELECT data FROM vgb_content WHERE id = $1', ['published']);
  return res.rows[0]?.data ?? { weekLabel: 'Week 1', lastUpdated: new Date().toISOString(), sections: [] };
}

async function getDraft() {
  await ensureTable();
  const res = await pool.query('SELECT data FROM vgb_content WHERE id = $1', ['draft']);
  const data = res.rows[0]?.data;
  return data === null ? null : data;
}

async function saveDraft(sections, weekLabel) {
  await ensureTable();
  const draft = {
    createdAt: new Date().toISOString(),
    weekLabel: weekLabel ?? `Week of ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    sections,
  };
  await pool.query(
    'UPDATE vgb_content SET data = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(draft), 'draft']
  );
}

async function publishDraft() {
  await ensureTable();
  const draft = await getDraft();
  if (!draft) throw new Error('No draft to publish');
  const published = { ...draft, lastUpdated: new Date().toISOString() };
  await pool.query(
    'UPDATE vgb_content SET data = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(published), 'published']
  );
  await pool.query(
    'UPDATE vgb_content SET data = $1, updated_at = NOW() WHERE id = $2',
    ['null', 'draft']
  );
  return published;
}

async function publishDirect(sections, weekLabel) {
  await ensureTable();
  const published = {
    lastUpdated: new Date().toISOString(),
    weekLabel: weekLabel ?? 'Week 1',
    sections,
  };
  await pool.query(
    'UPDATE vgb_content SET data = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(published), 'published']
  );
  await pool.query(
    'UPDATE vgb_content SET data = $1, updated_at = NOW() WHERE id = $2',
    ['null', 'draft']
  );
  return published;
}

// Replace the sections of the draft or the published content, only if it has not changed since
// `stamp` was read (createdAt for the draft, lastUpdated for published). Returns true if saved.
async function replaceSections(id, stampKey, stamp, sections) {
  await ensureTable();
  const res = await pool.query(
    `UPDATE vgb_content SET data = jsonb_set(data, '{sections}', $1::jsonb), updated_at = NOW()
     WHERE id = $2 AND data IS NOT NULL AND jsonb_typeof(data) = 'object' AND data->>$3 = $4`,
    [JSON.stringify(sections), id, stampKey, stamp]
  );
  return res.rowCount > 0;
}
const replaceDraftSections = (createdAt, sections) => replaceSections('draft', 'createdAt', createdAt, sections);
const replacePublishedSections = (lastUpdated, sections) => replaceSections('published', 'lastUpdated', lastUpdated, sections);

module.exports = { getPublished, getDraft, saveDraft, publishDraft, publishDirect, replaceDraftSections, replacePublishedSections };
