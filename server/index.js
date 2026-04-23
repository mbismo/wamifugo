'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const db       = require('./db');
const { sendResetCode } = require('./email');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── ALLOWED COLLECTIONS ───────────────────────────────────────────────────────
const ALLOWED = new Set([
  'inventory','purchases','sales','customers',
  'stockLedger','ingredients','users','animalReqs','savedFormulas'
]);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── AUTH ──────────────────────────────────────────────────────────────────────
function checkKey(req, res, next) {
  const key = req.headers['x-sync-key'] || req.query.key;
  const expected = process.env.SYNC_KEY || 'wamifugo2024';
  if (key !== expected) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

// ── DATA API ──────────────────────────────────────────────────────────────────
app.get('/api/data', checkKey, async (req, res) => {
  try {
    const timestamps = db.getAllTimestamps();
    res.json({ ok: true, timestamps, serverTime: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/data/:collection', checkKey, async (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection)) return res.status(400).json({ error: 'Invalid collection' });
  try {
    const result = db.getCollection(collection);
    res.json({ ok: true, data: result.data, ts: result.ts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/data/:collection', checkKey, async (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection)) return res.status(400).json({ error: 'Invalid collection' });
  const { data, ts } = req.body;
  if (data === undefined) return res.status(400).json({ error: 'Missing data field' });
  try {
    const saved_ts = db.setCollection(collection, data, ts);
    res.json({ ok: true, collection, ts: saved_ts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────
app.post('/api/auth/reset/request', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  try {
    const { data: users } = db.getCollection('users');
    const user = (users || []).find(
      u => (u.email || '').toLowerCase() === email.toLowerCase() && u.active !== false
    );
    if (!user) {
      return res.json({ ok: true, msg: 'If that email is registered, a reset code has been sent.' });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.saveResetCode(email.toLowerCase(), code, user.id);
    const siteUrl = process.env.SITE_URL || `https://wamifugo.onrender.com`;
    await sendResetCode({ toEmail: email, toName: user.name, code, siteUrl });
    res.json({ ok: true, msg: 'Reset code sent — check your inbox and spam folder.' });
  } catch (err) {
    console.error('Reset request error:', err.message);
    res.status(500).json({ error: 'Could not send reset code. Try again shortly.' });
  }
});

app.post('/api/auth/reset/verify', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required.' });
  try {
    const row = db.verifyResetCode(email.toLowerCase(), code.trim());
    if (!row) return res.json({ ok: false, error: 'Invalid or expired code. Please request a new one.' });
    res.json({ ok: true, userId: row.user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset/password', async (req, res) => {
  const { email, code, password } = req.body;
  if (!email || !code || !password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  try {
    const row = db.verifyResetCode(email.toLowerCase(), code.trim());
    if (!row) return res.json({ ok: false, error: 'Invalid or expired code.' });
    const { data: users } = db.getCollection('users');
    const updated = (users || []).map(u => u.id === row.user_id ? { ...u, password } : u);
    db.setCollection('users', updated);
    db.deleteResetCode(email.toLowerCase());
    res.json({ ok: true, msg: 'Password updated. You can now sign in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── SERVE REACT BUILD ─────────────────────────────────────────────────────────
const CLIENT_BUILD = path.join(__dirname, '..', 'client', 'dist');
console.log('Serving React build from:', CLIENT_BUILD);
console.log('Build exists:', fs.existsSync(CLIENT_BUILD));
console.log('index.html exists:', fs.existsSync(path.join(CLIENT_BUILD, 'index.html')));

app.use(express.static(CLIENT_BUILD));
app.get('*', (req, res) => {
  const indexPath = path.join(CLIENT_BUILD, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('React build not found. Run: cd client && npm run build');
  }
});

// ── START ─────────────────────────────────────────────────────────────────────
function start() {
  db.initDB();
  app.listen(PORT, () => {
    console.log(`🌾 Wa-Mifugo server running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Data dir: ${process.env.DATA_DIR || 'default'}`);
  });
}

start();
