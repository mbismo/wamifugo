'use strict';
const path = require('path');
const fs   = require('fs');

// ── DATA DIRECTORY ────────────────────────────────────────────────────────────
// On Render: persistent disk mounted at /data (set DATA_DIR=/data)
// Locally:   ./data/ folder next to project root
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── PURE JSON FILE STORAGE ────────────────────────────────────────────────────
// No native modules, no compilation — just JSON files on disk.
// One file per collection + one for reset codes.
// This is robust, portable, and works on any Node version.

const COLLECTIONS = [
  'inventory','purchases','sales','customers',
  'stockLedger','ingredients','users','animalReqs','savedFormulas'
];

function colPath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function codesPath() {
  return path.join(DATA_DIR, 'reset_codes.json');
}

// ── INITIALISE ────────────────────────────────────────────────────────────────
function initDB() {
  // Create empty collection files if they don't exist
  for (const name of COLLECTIONS) {
    const file = colPath(name);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify({ data: [], ts: 0 }));
    }
  }
  if (!fs.existsSync(codesPath())) {
    fs.writeFileSync(codesPath(), '[]');
  }
  console.log('✅ Storage ready at', DATA_DIR);
}

// ── COLLECTIONS ───────────────────────────────────────────────────────────────
function getCollection(name) {
  try {
    const raw = fs.readFileSync(colPath(name), 'utf8');
    const parsed = JSON.parse(raw);
    return { data: parsed.data ?? null, ts: parsed.ts ?? 0 };
  } catch {
    return { data: null, ts: 0 };
  }
}

function setCollection(name, data, ts) {
  const timestamp = ts || Date.now();
  fs.writeFileSync(colPath(name), JSON.stringify({ data, ts: timestamp }));
  return timestamp;
}

function getAllTimestamps() {
  const out = {};
  for (const name of COLLECTIONS) {
    try {
      const raw = fs.readFileSync(colPath(name), 'utf8');
      out[name] = JSON.parse(raw).ts ?? 0;
    } catch {
      out[name] = 0;
    }
  }
  return out;
}

// ── RESET CODES ───────────────────────────────────────────────────────────────
function loadCodes() {
  try {
    return JSON.parse(fs.readFileSync(codesPath(), 'utf8'));
  } catch {
    return [];
  }
}

function saveCodes(codes) {
  fs.writeFileSync(codesPath(), JSON.stringify(codes));
}

function saveResetCode(email, code, userId) {
  // Remove any existing code for this email first
  const codes = loadCodes().filter(c => c.email !== email);
  codes.push({ email, code, user_id: userId, created_at: Date.now() });
  saveCodes(codes);
}

function verifyResetCode(email, code) {
  const FIFTEEN_MIN = 15 * 60 * 1000;
  const codes = loadCodes();
  const row = codes.find(c => c.email === email && c.code === code);
  if (!row) return null;
  if (Date.now() - row.created_at > FIFTEEN_MIN) {
    saveCodes(codes.filter(c => c.email !== email));
    return null; // expired
  }
  return row;
}

function deleteResetCode(email) {
  saveCodes(loadCodes().filter(c => c.email !== email));
}

module.exports = {
  initDB,
  getCollection,
  setCollection,
  getAllTimestamps,
  saveResetCode,
  verifyResetCode,
  deleteResetCode,
};
