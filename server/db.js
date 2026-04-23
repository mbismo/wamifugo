'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ── DATABASE PATH ─────────────────────────────────────────────────────────────
// On Render: persistent disk is mounted at /data (set DATA_DIR=/data env var)
// Locally:   uses ./data/ folder next to server/
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'wamifugo.db');
const db = new Database(DB_PATH);

// WAL mode = better concurrent performance
db.pragma('journal_mode = WAL');

// ── INITIALISE TABLES ─────────────────────────────────────────────────────────
function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      name        TEXT PRIMARY KEY,
      data        TEXT NOT NULL DEFAULT '[]',
      updated_at  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS reset_codes (
      email       TEXT NOT NULL,
      code        TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
  `);

  const insert = db.prepare(
    "INSERT OR IGNORE INTO collections (name, data, updated_at) VALUES (?, '[]', 0)"
  );
  for (const name of [
    'inventory','purchases','sales','customers',
    'stockLedger','ingredients','users','animalReqs','savedFormulas'
  ]) insert.run(name);

  console.log('✅ SQLite ready at', DB_PATH);
}

// ── COLLECTIONS ───────────────────────────────────────────────────────────────
function getCollection(name) {
  const row = db.prepare('SELECT data, updated_at FROM collections WHERE name = ?').get(name);
  if (!row) return { data: null, ts: 0 };
  return { data: JSON.parse(row.data), ts: row.updated_at };
}

function setCollection(name, data, ts) {
  const timestamp = ts || Date.now();
  db.prepare(`
    INSERT INTO collections (name, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(name, JSON.stringify(data), timestamp);
  return timestamp;
}

function getAllTimestamps() {
  const out = {};
  db.prepare('SELECT name, updated_at FROM collections').all()
    .forEach(r => { out[r.name] = r.updated_at; });
  return out;
}

// ── RESET CODES ───────────────────────────────────────────────────────────────
function saveResetCode(email, code, userId) {
  db.prepare('DELETE FROM reset_codes WHERE email = ?').run(email);
  db.prepare('INSERT INTO reset_codes (email, code, user_id, created_at) VALUES (?, ?, ?, ?)')
    .run(email, code, userId, Date.now());
}

function verifyResetCode(email, code) {
  const row = db.prepare('SELECT * FROM reset_codes WHERE email = ? AND code = ?').get(email, code);
  if (!row) return null;
  if (Date.now() - row.created_at > 15 * 60 * 1000) {
    db.prepare('DELETE FROM reset_codes WHERE email = ?').run(email);
    return null;
  }
  return row;
}

function deleteResetCode(email) {
  db.prepare('DELETE FROM reset_codes WHERE email = ?').run(email);
}

module.exports = { initDB, getCollection, setCollection, getAllTimestamps, saveResetCode, verifyResetCode, deleteResetCode };
