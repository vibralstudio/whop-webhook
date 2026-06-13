const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'vgb-subscribers.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ subscribers: [] }, null, 2));
}

function readStore() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeStore(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function addSubscriber(email, product) {
  const store = readStore();
  const existing = store.subscribers.find(s => s.email === email);
  if (existing) return existing.token;

  const token = crypto.randomBytes(32).toString('hex');
  store.subscribers.push({
    email,
    product,
    token,
    createdAt: new Date().toISOString(),
    active: true,
  });
  writeStore(store);
  return token;
}

function getSubscriberByToken(token) {
  const store = readStore();
  return store.subscribers.find(s => s.token === token && s.active) ?? null;
}

function getAllSubscribers() {
  return readStore().subscribers;
}

function getActiveCount() {
  return readStore().subscribers.filter(s => s.active).length;
}

module.exports = { addSubscriber, getSubscriberByToken, getAllSubscribers, getActiveCount };
