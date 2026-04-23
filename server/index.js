'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
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

// GET /api/data — return all collection timestamps
app.get('/api/data', checkKey, async (req, res) => {
  try {
    const timestamps = await db.getAllTimestamps();
    res.json({ ok: true, timestamps, serverTime: Date.now() });
  } catch (err) {
    console.error('GET /api/data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/:collection — read one collection
app.get('/api/data/:collection', checkKey, async (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection)) {
    return res.status(400).json({ error: 'Invalid collection' });
  }
  try {
    const result = await db.getCollection(collection);
    res.json({ ok: true, data: result.data, ts: result.ts });
  } catch (err) {
    console.error(`GET /api/data/${collection} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/data/:collection — write one collection
app.post('/api/data/:collection', checkKey, async (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection)) {
    return res.status(400).json({ error: 'Invalid collection' });
  }
  const { data, ts } = req.body;
  if (data === undefined) {
    return res.status(400).json({ error: 'Missing data field' });
  }
  try {
    const saved_ts = await db.setCollection(collection, data, ts);
    res.json({ ok: true, collection, ts: saved_ts });
  } catch (err) {
    console.error(`POST /api/data/${collection} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────

// POST /api/auth/reset/request — send a reset code to email
app.post('/api/auth/reset/request', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  try {
    // Look up user by email in the users collection
    const { data: users } = await db.getCollection('users');
    const user = (users || []).find(
      u => (u.email || '').toLowerCase() === email.toLowerCase() && u.active
    );

    // Always return ok (prevent email enumeration)
    if (!user) {
      return res.json({ ok: true, msg: 'If that email is registered, a reset code has been sent.' });
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await db.saveResetCode(email.toLowerCase(), code, user.id);

    // Send email
    const siteUrl = process.env.SITE_URL || `https://wamifugo.onrender.com`;
    await sendResetCode({ toEmail: email, toName: user.name, code, siteUrl });

    res.json({ ok: true, msg: 'Reset code sent — check your inbox and spam folder.' });
  } catch (err) {
    console.error('Reset request error:', err.message);
    res.status(500).json({ error: 'Could not send reset code. Try again shortly.' });
  }
});

// POST /api/auth/reset/verify — verify a reset code
app.post('/api/auth/reset/verify', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code required.' });
  }
  try {
    const row = await db.verifyResetCode(email.toLowerCase(), code.trim());
    if (!row) {
      return res.json({ ok: false, error: 'Invalid or expired code. Please request a new one.' });
    }
    res.json({ ok: true, userId: row.user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset/password — set a new password
app.post('/api/auth/reset/password', async (req, res) => {
  const { email, code, password } = req.body;
  if (!email || !code || !password || password.length < 6) {
    return res.status(400).json({ error: 'Invalid request. Password must be at least 6 characters.' });
  }
  try {
    // Verify code again
    const row = await db.verifyResetCode(email.toLowerCase(), code.trim());
    if (!row) {
      return res.json({ ok: false, error: 'Invalid or expired code.' });
    }

    // Update user password in the users collection
    const { data: users, ts } = await db.getCollection('users');
    const updated = (users || []).map(u =>
      u.id === row.user_id ? { ...u, password } : u
    );
    await db.setCollection('users', updated);

    // Invalidate the code
    await db.deleteResetCode(email.toLowerCase());

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
// In production, Express serves the Vite build output
const CLIENT_BUILD = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(CLIENT_BUILD));
app.get('*', (req, res) => {
  res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
});

// ── START ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await db.initDB();
    app.listen(PORT, () => {
      console.log(`🌾 Wa-Mifugo server running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
