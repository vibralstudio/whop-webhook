// Postgres storage for Custom Blueprint clients, versions and uploads.
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
});

let ready;
function ensure() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS custom_clients (
        id SERIAL PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        name TEXT DEFAULT '',
        email TEXT DEFAULT '',
        source TEXT DEFAULT 'admin',
        status TEXT NOT NULL DEFAULT 'new',
        answers JSONB NOT NULL DEFAULT '{}'::jsonb,
        cur INTEGER DEFAULT 0,
        progress JSONB NOT NULL DEFAULT '{}'::jsonb,
        error TEXT,
        credits INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        submitted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS custom_versions (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES custom_clients(id) ON DELETE CASCADE,
        n INTEGER NOT NULL,
        label TEXT,
        kind TEXT,
        input JSONB,
        content JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (client_id, n)
      );
      CREATE TABLE IF NOT EXISTS custom_files (
        id TEXT PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES custom_clients(id) ON DELETE CASCADE,
        field TEXT,
        name TEXT,
        mime TEXT,
        size INTEGER,
        data BYTEA NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS custom_clients_email ON custom_clients (lower(email));
      ALTER TABLE custom_clients ADD COLUMN IF NOT EXISTS last_credit_at TIMESTAMPTZ;
    `).catch((e) => { ready = null; throw e; });
  }
  return ready;
}
const q = async (sql, params) => { await ensure(); return (await pool.query(sql, params)).rows; };
const one = async (sql, params) => (await q(sql, params))[0] || null;

module.exports = {
  ensure,
  async createClient({ name = '', email = '', source = 'admin' }) {
    const token = crypto.randomBytes(16).toString('base64url');
    return one('INSERT INTO custom_clients (token, name, email, source) VALUES ($1,$2,$3,$4) RETURNING *', [token, name, email, source]);
  },
  byToken: (t) => one('SELECT * FROM custom_clients WHERE token=$1', [t]),
  byId: (id) => one('SELECT * FROM custom_clients WHERE id=$1', [id]),
  byEmail: (e) => one('SELECT * FROM custom_clients WHERE lower(email)=lower($1) ORDER BY id DESC LIMIT 1', [e]),
  all: () => q(`SELECT c.id, c.token, c.name, c.email, c.source, c.status, c.credits, c.created_at, c.answers->>'name' AS artist,
                (SELECT COUNT(*)::int FROM custom_versions v WHERE v.client_id=c.id) AS nv
                FROM custom_clients c ORDER BY c.id DESC`),
  generating: () => q("SELECT * FROM custom_clients WHERE status='generating'"),
  saveState: (id, answers, cur) => q("UPDATE custom_clients SET answers=$2, cur=$3, status=CASE WHEN status='new' THEN 'intake' ELSE status END, updated_at=NOW() WHERE id=$1", [id, JSON.stringify(answers || {}), cur | 0]),
  setStatus: (id, status, progress = {}, error = null) => q('UPDATE custom_clients SET status=$2, progress=$3, error=$4, updated_at=NOW() WHERE id=$1', [id, status, JSON.stringify(progress), error]),
  setProgress: (id, progress) => q('UPDATE custom_clients SET progress=$2 WHERE id=$1', [id, JSON.stringify(progress)]),
  submitted: (id) => q('UPDATE custom_clients SET submitted_at=NOW() WHERE id=$1', [id]),
  addCredits: (id, d) => q('UPDATE custom_clients SET credits=GREATEST(0, credits+$2) WHERE id=$1', [id, d]),
  // Whop can send several events for one purchase: only credit once per 10 minutes per client.
  creditOnce: (id) => one("UPDATE custom_clients SET credits=credits+1, last_credit_at=NOW() WHERE id=$1 AND (last_credit_at IS NULL OR last_credit_at < NOW() - INTERVAL '10 minutes') RETURNING id", [id]),
  recentWhop: (e) => one("SELECT * FROM custom_clients WHERE lower(email)=lower($1) AND source='whop' AND created_at > NOW() - INTERVAL '10 minutes' ORDER BY id DESC LIMIT 1", [e]),
  remove: (id) => q('DELETE FROM custom_clients WHERE id=$1', [id]),
  versions: (id) => q('SELECT id, n, label, kind, created_at FROM custom_versions WHERE client_id=$1 ORDER BY n', [id]),
  version: (id, n) => one('SELECT * FROM custom_versions WHERE client_id=$1 AND n=$2', [id, n]),
  latest: (id) => one('SELECT * FROM custom_versions WHERE client_id=$1 ORDER BY n DESC LIMIT 1', [id]),
  addVersion: (id, n, label, kind, input, content) => q('INSERT INTO custom_versions (client_id, n, label, kind, input, content) VALUES ($1,$2,$3,$4,$5,$6)', [id, n, label, kind, input ? JSON.stringify(input) : null, JSON.stringify(content)]),
  editVersion: (vid, content) => q('UPDATE custom_versions SET content=$2 WHERE id=$1', [vid, JSON.stringify(content)]),
  async addFile(clientId, field, name, mime, buf) {
    const id = crypto.randomBytes(9).toString('hex');
    await q('INSERT INTO custom_files (id, client_id, field, name, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, clientId, field, name, mime, buf.length, buf]);
    return id;
  },
  file: (clientId, id) => one('SELECT * FROM custom_files WHERE client_id=$1 AND id=$2', [clientId, id]),
};
