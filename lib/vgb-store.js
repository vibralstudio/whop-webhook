const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vgb_subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      product TEXT,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      active BOOLEAN DEFAULT TRUE
    )
  `);
}

async function addSubscriber(email, product) {
  await ensureTable();
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const res = await pool.query(
    `INSERT INTO vgb_subscribers (email, product, token)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING token`,
    [email, product, token]
  );
  return res.rows[0].token;
}

async function getSubscriberByToken(token) {
  await ensureTable();
  const res = await pool.query(
    'SELECT * FROM vgb_subscribers WHERE token = $1 AND active = TRUE',
    [token]
  );
  return res.rows[0] ?? null;
}

async function getAllSubscribers() {
  await ensureTable();
  const res = await pool.query('SELECT * FROM vgb_subscribers ORDER BY created_at DESC');
  return res.rows;
}

async function getActiveCount() {
  await ensureTable();
  const res = await pool.query('SELECT COUNT(*) FROM vgb_subscribers WHERE active = TRUE');
  return parseInt(res.rows[0].count);
}

module.exports = { addSubscriber, getSubscriberByToken, getAllSubscribers, getActiveCount };
