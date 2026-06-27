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
  const existing = await pool.query(
    'SELECT token FROM vgb_subscribers WHERE email = $1',
    [email]
  );
  if (existing.rows.length > 0) {
    return { token: existing.rows[0].token, isNew: false };
  }
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO vgb_subscribers (email, product, token) VALUES ($1, $2, $3)',
    [email, product, token]
  );
  return { token, isNew: true };
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
async function deactivateSubscriber(email) {
  await ensureTable();
  await pool.query(
    'UPDATE vgb_subscribers SET active = FALSE WHERE email = $1',
    [email]
  );
}
module.exports = { addSubscriber, getSubscriberByToken, getAllSubscribers, getActiveCount, deactivateSubscriber };
