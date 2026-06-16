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

module.exports = { getPublished, getDraft, saveDraft, publishDraft, publishDirect };
