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
  'stockLedger','ingredients','users','animalReqs','savedFormulas',
  'products','productInventory','productPurchases'
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
    const len = Array.isArray(data) ? data.length : 'n/a';
    console.log(`[write] ${collection}: ${len} items saved at ${new Date(saved_ts).toISOString()}`);
    res.json({ ok: true, collection, ts: saved_ts });
  } catch (err) {
    console.error(`[write FAIL] ${collection}:`, err.message);
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


// ── SEED DEMO DATA ────────────────────────────────────────────────────────────
const SEED_DATA = {
  "ingredients": [
    {
      "id": "ing_1",
      "name": "Maize Grain",
      "price": 45.0,
      "cp": 8.5,
      "me": 3300.0,
      "fat": 3.8,
      "fibre": 2.5,
      "ca": 0.03,
      "p": 0.28,
      "lys": 0.24,
      "met": 0.18,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 70.0,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_2",
      "name": "Soybean Meal (44% CP)",
      "price": 90.0,
      "cp": 44.0,
      "me": 2230.0,
      "fat": 1.5,
      "fibre": 7.0,
      "ca": 0.3,
      "p": 0.65,
      "lys": 2.9,
      "met": 0.62,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 35.0,
      "category": "protein",
      "unit": "kg"
    },
    {
      "id": "ing_3",
      "name": "Wheat Bran",
      "price": 25.0,
      "cp": 16.0,
      "me": 1590.0,
      "fat": 4.0,
      "fibre": 11.0,
      "ca": 0.14,
      "p": 1.0,
      "lys": 0.64,
      "met": 0.24,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 20.0,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_4",
      "name": "Fish Meal (65% CP)",
      "price": 200.0,
      "cp": 65.0,
      "me": 2820.0,
      "fat": 8.0,
      "fibre": 1.0,
      "ca": 5.2,
      "p": 3.2,
      "lys": 4.8,
      "met": 1.8,
      "moisture": 10.0,
      "minIncl": 0.0,
      "maxIncl": 10.0,
      "category": "protein",
      "unit": "kg"
    },
    {
      "id": "ing_5",
      "name": "Sunflower Cake",
      "price": 55.0,
      "cp": 28.0,
      "me": 1680.0,
      "fat": 2.5,
      "fibre": 22.0,
      "ca": 0.35,
      "p": 0.9,
      "lys": 0.95,
      "met": 0.61,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 20.0,
      "category": "protein",
      "unit": "kg"
    },
    {
      "id": "ing_6",
      "name": "Cottonseed Cake",
      "price": 40.0,
      "cp": 36.0,
      "me": 1980.0,
      "fat": 3.0,
      "fibre": 14.0,
      "ca": 0.22,
      "p": 1.0,
      "lys": 1.5,
      "met": 0.56,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 15.0,
      "category": "protein",
      "unit": "kg"
    },
    {
      "id": "ing_7",
      "name": "Limestone / Lime",
      "price": 8.0,
      "cp": 0.0,
      "me": 0.0,
      "fat": 0.0,
      "fibre": 0.0,
      "ca": 38.0,
      "p": 0.02,
      "lys": 0.0,
      "met": 0.0,
      "moisture": 0.0,
      "minIncl": 0.0,
      "maxIncl": 5.0,
      "category": "mineral",
      "unit": "kg"
    },
    {
      "id": "ing_8",
      "name": "Dicalcium Phosphate",
      "price": 120.0,
      "cp": 0.0,
      "me": 0.0,
      "fat": 0.0,
      "fibre": 0.0,
      "ca": 22.0,
      "p": 18.0,
      "lys": 0.0,
      "met": 0.0,
      "moisture": 0.0,
      "minIncl": 0.0,
      "maxIncl": 3.0,
      "category": "mineral",
      "unit": "kg"
    },
    {
      "id": "ing_9",
      "name": "Salt (NaCl)",
      "price": 15.0,
      "cp": 0.0,
      "me": 0.0,
      "fat": 0.0,
      "fibre": 0.0,
      "ca": 0.0,
      "p": 0.0,
      "lys": 0.0,
      "met": 0.0,
      "moisture": 0.0,
      "minIncl": 0.0,
      "maxIncl": 0.5,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_10",
      "name": "Vit/Min Premix (Poultry)",
      "price": 350.0,
      "cp": 0.0,
      "me": 0.0,
      "fat": 0.0,
      "fibre": 0.0,
      "ca": 0.0,
      "p": 0.0,
      "lys": 0.0,
      "met": 0.0,
      "moisture": 0.0,
      "minIncl": 0.25,
      "maxIncl": 0.5,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_11",
      "name": "DL-Methionine",
      "price": 1800.0,
      "cp": 0.0,
      "me": 0.0,
      "fat": 0.0,
      "fibre": 0.0,
      "ca": 0.0,
      "p": 0.0,
      "lys": 0.0,
      "met": 99.0,
      "moisture": 0.0,
      "minIncl": 0.0,
      "maxIncl": 0.5,
      "category": "additive",
      "unit": "kg"
    },
    {
      "id": "ing_12",
      "name": "L-Lysine HCl (98.5%)",
      "price": 600.0,
      "cp": 0.0,
      "me": 0.0,
      "fat": 0.0,
      "fibre": 0.0,
      "ca": 0.0,
      "p": 0.0,
      "lys": 78.0,
      "met": 0.0,
      "moisture": 0.0,
      "minIncl": 0.0,
      "maxIncl": 0.5,
      "category": "additive",
      "unit": "kg"
    },
    {
      "id": "ing_13",
      "name": "Sorghum Grain",
      "price": 38.0,
      "cp": 10.0,
      "me": 3280.0,
      "fat": 3.2,
      "fibre": 2.6,
      "ca": 0.03,
      "p": 0.35,
      "lys": 0.22,
      "met": 0.17,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 40.0,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_14",
      "name": "Cassava Meal",
      "price": 30.0,
      "cp": 2.5,
      "me": 3200.0,
      "fat": 0.5,
      "fibre": 3.0,
      "ca": 0.1,
      "p": 0.08,
      "lys": 0.07,
      "met": 0.04,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 20.0,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_15",
      "name": "Sunflower Oil",
      "price": 180.0,
      "cp": 0.0,
      "me": 8800.0,
      "fat": 99.0,
      "fibre": 0.0,
      "ca": 0.0,
      "p": 0.0,
      "lys": 0.0,
      "met": 0.0,
      "moisture": 0.0,
      "minIncl": 0.0,
      "maxIncl": 5.0,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_16",
      "name": "Rice Bran",
      "price": 20.0,
      "cp": 12.0,
      "me": 2685.0,
      "fat": 13.0,
      "fibre": 13.0,
      "ca": 0.08,
      "p": 1.8,
      "lys": 0.56,
      "met": 0.24,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 15.0,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_17",
      "name": "Blood Meal (Ring-dried)",
      "price": 250.0,
      "cp": 80.0,
      "me": 2790.0,
      "fat": 1.5,
      "fibre": 1.5,
      "ca": 0.3,
      "p": 0.26,
      "lys": 6.6,
      "met": 1.0,
      "moisture": 10.0,
      "minIncl": 0.0,
      "maxIncl": 5.0,
      "category": "protein",
      "unit": "kg"
    },
    {
      "id": "ing_18",
      "name": "Urea (Feed Grade)",
      "price": 100.0,
      "cp": 287.0,
      "me": 0.0,
      "fat": 0.0,
      "fibre": 0.0,
      "ca": 0.0,
      "p": 0.0,
      "lys": 0.0,
      "met": 0.0,
      "moisture": 0.0,
      "minIncl": 0.0,
      "maxIncl": 1.0,
      "category": "protein",
      "unit": "kg"
    },
    {
      "id": "ing_19",
      "name": "Molasses",
      "price": 25.0,
      "cp": 4.0,
      "me": 2460.0,
      "fat": 0.2,
      "fibre": 0.5,
      "ca": 0.7,
      "p": 0.1,
      "lys": 0.17,
      "met": 0.08,
      "moisture": 25.0,
      "minIncl": 0.0,
      "maxIncl": 5.0,
      "category": "energy",
      "unit": "kg"
    },
    {
      "id": "ing_20",
      "name": "Wheat Grain",
      "price": 55.0,
      "cp": 12.0,
      "me": 3080.0,
      "fat": 1.8,
      "fibre": 3.0,
      "ca": 0.05,
      "p": 0.35,
      "lys": 0.38,
      "met": 0.2,
      "moisture": 12.0,
      "minIncl": 0.0,
      "maxIncl": 40.0,
      "category": "energy",
      "unit": "kg"
    }
  ],
  "inventory": [
    {
      "id": "ing_1",
      "name": "Maize Grain",
      "category": "energy",
      "qty": 500,
      "lastPrice": 45.0,
      "sellPrice": 54.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_2",
      "name": "Soybean Meal (44% CP)",
      "category": "protein",
      "qty": 500,
      "lastPrice": 90.0,
      "sellPrice": 108.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_3",
      "name": "Wheat Bran",
      "category": "energy",
      "qty": 500,
      "lastPrice": 25.0,
      "sellPrice": 30.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_4",
      "name": "Fish Meal (65% CP)",
      "category": "protein",
      "qty": 500,
      "lastPrice": 200.0,
      "sellPrice": 240.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_5",
      "name": "Sunflower Cake",
      "category": "protein",
      "qty": 500,
      "lastPrice": 55.0,
      "sellPrice": 66.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_6",
      "name": "Cottonseed Cake",
      "category": "protein",
      "qty": 500,
      "lastPrice": 40.0,
      "sellPrice": 48.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_7",
      "name": "Limestone / Lime",
      "category": "mineral",
      "qty": 500,
      "lastPrice": 8.0,
      "sellPrice": 9.6,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_8",
      "name": "Dicalcium Phosphate",
      "category": "mineral",
      "qty": 500,
      "lastPrice": 120.0,
      "sellPrice": 144.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_9",
      "name": "Salt (NaCl)",
      "category": "energy",
      "qty": 500,
      "lastPrice": 15.0,
      "sellPrice": 18.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_10",
      "name": "Vit/Min Premix (Poultry)",
      "category": "energy",
      "qty": 500,
      "lastPrice": 350.0,
      "sellPrice": 420.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_11",
      "name": "DL-Methionine",
      "category": "additive",
      "qty": 500,
      "lastPrice": 1800.0,
      "sellPrice": 2160.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_12",
      "name": "L-Lysine HCl (98.5%)",
      "category": "additive",
      "qty": 500,
      "lastPrice": 600.0,
      "sellPrice": 720.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_13",
      "name": "Sorghum Grain",
      "category": "energy",
      "qty": 500,
      "lastPrice": 38.0,
      "sellPrice": 45.6,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_14",
      "name": "Cassava Meal",
      "category": "energy",
      "qty": 500,
      "lastPrice": 30.0,
      "sellPrice": 36.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_15",
      "name": "Sunflower Oil",
      "category": "energy",
      "qty": 500,
      "lastPrice": 180.0,
      "sellPrice": 216.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_16",
      "name": "Rice Bran",
      "category": "energy",
      "qty": 500,
      "lastPrice": 20.0,
      "sellPrice": 24.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_17",
      "name": "Blood Meal (Ring-dried)",
      "category": "protein",
      "qty": 500,
      "lastPrice": 250.0,
      "sellPrice": 300.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_18",
      "name": "Urea (Feed Grade)",
      "category": "protein",
      "qty": 500,
      "lastPrice": 100.0,
      "sellPrice": 120.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_19",
      "name": "Molasses",
      "category": "energy",
      "qty": 500,
      "lastPrice": 25.0,
      "sellPrice": 30.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    },
    {
      "id": "ing_20",
      "name": "Wheat Grain",
      "category": "energy",
      "qty": 500,
      "lastPrice": 55.0,
      "sellPrice": 66.0,
      "margin": 20,
      "reorderLevel": 50,
      "unit": "kg"
    }
  ],
  "animalReqs": [
    {
      "id": "ar_1",
      "category": "Poultry (Broiler)",
      "stage": "Starter (0-21 days)",
      "cp": [
        22.0,
        24.0
      ],
      "me": [
        3000.0,
        3200.0
      ],
      "fat": [
        4.0,
        8.0
      ],
      "fibre": [
        0.0,
        5.0
      ],
      "ca": [
        0.9,
        1.1
      ],
      "p": [
        0.45,
        0.6
      ],
      "lys": [
        1.2,
        1.5
      ],
      "met": [
        0.5,
        0.65
      ]
    },
    {
      "id": "ar_2",
      "category": "Poultry (Broiler)",
      "stage": "Grower (22-35 days)",
      "cp": [
        20.0,
        22.0
      ],
      "me": [
        3100.0,
        3300.0
      ],
      "fat": [
        4.0,
        8.0
      ],
      "fibre": [
        0.0,
        5.0
      ],
      "ca": [
        0.85,
        1.05
      ],
      "p": [
        0.42,
        0.55
      ],
      "lys": [
        1.05,
        1.3
      ],
      "met": [
        0.45,
        0.6
      ]
    },
    {
      "id": "ar_3",
      "category": "Poultry (Broiler)",
      "stage": "Finisher (36+ days)",
      "cp": [
        18.0,
        20.0
      ],
      "me": [
        3150.0,
        3350.0
      ],
      "fat": [
        4.0,
        8.0
      ],
      "fibre": [
        0.0,
        5.0
      ],
      "ca": [
        0.8,
        1.0
      ],
      "p": [
        0.38,
        0.5
      ],
      "lys": [
        0.95,
        1.2
      ],
      "met": [
        0.4,
        0.55
      ]
    },
    {
      "id": "ar_4",
      "category": "Poultry (Layer)",
      "stage": "Chick Starter (0-8 wks)",
      "cp": [
        20.0,
        22.0
      ],
      "me": [
        2850.0,
        3050.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        0.0,
        6.0
      ],
      "ca": [
        0.9,
        1.1
      ],
      "p": [
        0.42,
        0.55
      ],
      "lys": [
        0.9,
        1.1
      ],
      "met": [
        0.4,
        0.55
      ]
    },
    {
      "id": "ar_5",
      "category": "Poultry (Layer)",
      "stage": "Grower (8-16 wks)",
      "cp": [
        16.0,
        18.0
      ],
      "me": [
        2700.0,
        2900.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        0.0,
        7.0
      ],
      "ca": [
        0.9,
        1.1
      ],
      "p": [
        0.38,
        0.5
      ],
      "lys": [
        0.75,
        0.95
      ],
      "met": [
        0.35,
        0.48
      ]
    },
    {
      "id": "ar_6",
      "category": "Poultry (Layer)",
      "stage": "Pre-lay (16-20 wks)",
      "cp": [
        18.0,
        20.0
      ],
      "me": [
        2750.0,
        2950.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        0.0,
        7.0
      ],
      "ca": [
        2.0,
        2.5
      ],
      "p": [
        0.4,
        0.55
      ],
      "lys": [
        0.85,
        1.05
      ],
      "met": [
        0.38,
        0.5
      ]
    },
    {
      "id": "ar_7",
      "category": "Poultry (Layer)",
      "stage": "In Production (20+ wks)",
      "cp": [
        15.0,
        18.0
      ],
      "me": [
        2700.0,
        2900.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        0.0,
        7.0
      ],
      "ca": [
        3.5,
        4.5
      ],
      "p": [
        0.35,
        0.45
      ],
      "lys": [
        0.75,
        0.9
      ],
      "met": [
        0.35,
        0.45
      ]
    },
    {
      "id": "ar_8",
      "category": "Dairy Cattle",
      "stage": "Calf (0-3 months)",
      "cp": [
        22.0,
        25.0
      ],
      "me": [
        2800.0,
        3100.0
      ],
      "fat": [
        5.0,
        10.0
      ],
      "fibre": [
        5.0,
        15.0
      ],
      "ca": [
        0.8,
        1.2
      ],
      "p": [
        0.55,
        0.75
      ],
      "lys": [
        1.2,
        1.6
      ],
      "met": [
        0.42,
        0.58
      ]
    },
    {
      "id": "ar_9",
      "category": "Dairy Cattle",
      "stage": "Heifer (3-12 months)",
      "cp": [
        16.0,
        18.0
      ],
      "me": [
        2400.0,
        2700.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        12.0,
        20.0
      ],
      "ca": [
        0.5,
        0.75
      ],
      "p": [
        0.38,
        0.52
      ],
      "lys": [
        0.7,
        0.95
      ],
      "met": [
        0.25,
        0.38
      ]
    },
    {
      "id": "ar_10",
      "category": "Dairy Cattle",
      "stage": "Dry Cow",
      "cp": [
        12.0,
        14.0
      ],
      "me": [
        1800.0,
        2400.0
      ],
      "fat": [
        2.0,
        6.0
      ],
      "fibre": [
        20.0,
        35.0
      ],
      "ca": [
        0.4,
        0.6
      ],
      "p": [
        0.3,
        0.45
      ],
      "lys": [
        0.5,
        0.7
      ],
      "met": [
        0.18,
        0.28
      ]
    },
    {
      "id": "ar_11",
      "category": "Dairy Cattle",
      "stage": "Lactating (High Prod.)",
      "cp": [
        16.0,
        18.0
      ],
      "me": [
        2600.0,
        2900.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        15.0,
        25.0
      ],
      "ca": [
        0.7,
        1.0
      ],
      "p": [
        0.45,
        0.65
      ],
      "lys": [
        0.75,
        1.0
      ],
      "met": [
        0.28,
        0.42
      ]
    },
    {
      "id": "ar_12",
      "category": "Beef Cattle",
      "stage": "Weaner (3-6 months)",
      "cp": [
        16.0,
        18.0
      ],
      "me": [
        2400.0,
        2700.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        10.0,
        18.0
      ],
      "ca": [
        0.5,
        0.75
      ],
      "p": [
        0.38,
        0.52
      ],
      "lys": [
        0.65,
        0.85
      ],
      "met": [
        0.22,
        0.35
      ]
    },
    {
      "id": "ar_13",
      "category": "Beef Cattle",
      "stage": "Grower (6-12 months)",
      "cp": [
        12.0,
        14.0
      ],
      "me": [
        2400.0,
        2700.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        15.0,
        25.0
      ],
      "ca": [
        0.35,
        0.55
      ],
      "p": [
        0.25,
        0.4
      ],
      "lys": [
        0.55,
        0.72
      ],
      "met": [
        0.18,
        0.28
      ]
    },
    {
      "id": "ar_14",
      "category": "Beef Cattle",
      "stage": "Finisher (12+ months)",
      "cp": [
        11.0,
        13.0
      ],
      "me": [
        2700.0,
        3000.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        10.0,
        20.0
      ],
      "ca": [
        0.3,
        0.5
      ],
      "p": [
        0.22,
        0.35
      ],
      "lys": [
        0.45,
        0.62
      ],
      "met": [
        0.15,
        0.25
      ]
    },
    {
      "id": "ar_15",
      "category": "Swine",
      "stage": "Starter (<25 kg)",
      "cp": [
        20.0,
        22.0
      ],
      "me": [
        3200.0,
        3400.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        0.0,
        5.0
      ],
      "ca": [
        0.8,
        1.0
      ],
      "p": [
        0.65,
        0.8
      ],
      "lys": [
        1.3,
        1.55
      ],
      "met": [
        0.4,
        0.55
      ]
    },
    {
      "id": "ar_16",
      "category": "Swine",
      "stage": "Grower (25-60 kg)",
      "cp": [
        16.0,
        18.0
      ],
      "me": [
        3100.0,
        3300.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        0.0,
        6.0
      ],
      "ca": [
        0.65,
        0.85
      ],
      "p": [
        0.55,
        0.7
      ],
      "lys": [
        0.95,
        1.2
      ],
      "met": [
        0.3,
        0.45
      ]
    },
    {
      "id": "ar_17",
      "category": "Swine",
      "stage": "Finisher (>60 kg)",
      "cp": [
        14.0,
        16.0
      ],
      "me": [
        3100.0,
        3300.0
      ],
      "fat": [
        3.0,
        7.0
      ],
      "fibre": [
        0.0,
        7.0
      ],
      "ca": [
        0.55,
        0.75
      ],
      "p": [
        0.48,
        0.6
      ],
      "lys": [
        0.75,
        0.95
      ],
      "met": [
        0.25,
        0.38
      ]
    },
    {
      "id": "ar_18",
      "category": "Swine",
      "stage": "Lactating Sow",
      "cp": [
        18.0,
        20.0
      ],
      "me": [
        3050.0,
        3250.0
      ],
      "fat": [
        4.0,
        8.0
      ],
      "fibre": [
        0.0,
        8.0
      ],
      "ca": [
        0.8,
        1.0
      ],
      "p": [
        0.65,
        0.8
      ],
      "lys": [
        0.95,
        1.2
      ],
      "met": [
        0.3,
        0.45
      ]
    },
    {
      "id": "ar_19",
      "category": "Rabbit",
      "stage": "Grower (4-12 weeks)",
      "cp": [
        16.0,
        18.0
      ],
      "me": [
        2500.0,
        2700.0
      ],
      "fat": [
        2.0,
        5.0
      ],
      "fibre": [
        10.0,
        16.0
      ],
      "ca": [
        0.5,
        0.8
      ],
      "p": [
        0.35,
        0.5
      ],
      "lys": [
        0.65,
        0.85
      ],
      "met": [
        0.25,
        0.38
      ]
    },
    {
      "id": "ar_20",
      "category": "Rabbit",
      "stage": "Lactating Doe",
      "cp": [
        17.0,
        19.0
      ],
      "me": [
        2600.0,
        2800.0
      ],
      "fat": [
        3.0,
        6.0
      ],
      "fibre": [
        10.0,
        14.0
      ],
      "ca": [
        0.8,
        1.1
      ],
      "p": [
        0.5,
        0.65
      ],
      "lys": [
        0.75,
        0.95
      ],
      "met": [
        0.3,
        0.42
      ]
    },
    {
      "id": "ar_21",
      "category": "Rabbit",
      "stage": "Maintenance Adult",
      "cp": [
        14.0,
        16.0
      ],
      "me": [
        2200.0,
        2500.0
      ],
      "fat": [
        2.0,
        4.0
      ],
      "fibre": [
        14.0,
        20.0
      ],
      "ca": [
        0.5,
        0.7
      ],
      "p": [
        0.3,
        0.45
      ],
      "lys": [
        0.55,
        0.72
      ],
      "met": [
        0.22,
        0.32
      ]
    },
    {
      "id": "ar_22",
      "category": "Fish (Tilapia)",
      "stage": "Fry (<5 g)",
      "cp": [
        45.0,
        50.0
      ],
      "me": [
        3200.0,
        3500.0
      ],
      "fat": [
        6.0,
        10.0
      ],
      "fibre": [
        0.0,
        3.0
      ],
      "ca": [
        1.5,
        2.5
      ],
      "p": [
        1.2,
        1.8
      ],
      "lys": [
        2.5,
        3.2
      ],
      "met": [
        0.9,
        1.3
      ]
    },
    {
      "id": "ar_23",
      "category": "Fish (Tilapia)",
      "stage": "Fingerling (5-50 g)",
      "cp": [
        38.0,
        42.0
      ],
      "me": [
        3000.0,
        3300.0
      ],
      "fat": [
        6.0,
        10.0
      ],
      "fibre": [
        0.0,
        5.0
      ],
      "ca": [
        1.2,
        2.0
      ],
      "p": [
        1.0,
        1.5
      ],
      "lys": [
        2.0,
        2.6
      ],
      "met": [
        0.72,
        1.1
      ]
    },
    {
      "id": "ar_24",
      "category": "Fish (Tilapia)",
      "stage": "Grow-out (>50 g)",
      "cp": [
        28.0,
        32.0
      ],
      "me": [
        2800.0,
        3100.0
      ],
      "fat": [
        5.0,
        9.0
      ],
      "fibre": [
        0.0,
        7.0
      ],
      "ca": [
        1.0,
        1.5
      ],
      "p": [
        0.8,
        1.2
      ],
      "lys": [
        1.5,
        2.0
      ],
      "met": [
        0.55,
        0.85
      ]
    }
  ],
  "customers": [
    {
      "id": "c1",
      "name": "Kamau Feeds Ltd",
      "phone": "0712345678",
      "email": "kamau@feeds.co.ke",
      "location": "Kiambu",
      "createdAt": "2024-01-15",
      "savedFormulas": []
    },
    {
      "id": "c2",
      "name": "Wanjiku Poultry Farm",
      "phone": "0723456789",
      "email": "wanjiku@poultry.co.ke",
      "location": "Thika",
      "createdAt": "2024-02-01",
      "savedFormulas": []
    },
    {
      "id": "c3",
      "name": "Mwangi Dairy",
      "phone": "0734567890",
      "email": "mwangi@dairy.co.ke",
      "location": "Nakuru",
      "createdAt": "2024-02-20",
      "savedFormulas": []
    }
  ],
  "purchases": [
    {
      "id": "p1",
      "itemId": "ing_1",
      "itemName": "Maize Grain",
      "qty": 1000,
      "costPerKg": 45,
      "total": 45000,
      "date": "2024-03-01",
      "supplier": "Unga Group",
      "notes": ""
    },
    {
      "id": "p2",
      "itemId": "ing_2",
      "itemName": "Soybean Meal (44% CP)",
      "qty": 500,
      "costPerKg": 90,
      "total": 45000,
      "date": "2024-03-05",
      "supplier": "ProFeed Kenya",
      "notes": ""
    },
    {
      "id": "p3",
      "itemId": "ing_4",
      "itemName": "Fish Meal (65% CP)",
      "qty": 200,
      "costPerKg": 200,
      "total": 40000,
      "date": "2024-03-10",
      "supplier": "Coastal Feeds",
      "notes": ""
    },
    {
      "id": "p4",
      "itemId": "ing_3",
      "itemName": "Wheat Bran",
      "qty": 800,
      "costPerKg": 25,
      "total": 20000,
      "date": "2024-03-15",
      "supplier": "NCPB",
      "notes": ""
    }
  ],
  "sales": [
    {
      "id": "s1",
      "customerId": "c1",
      "customerName": "Kamau Feeds Ltd",
      "product": "Poultry (Broiler) \u2014 Starter (0-21 days) (100kg)",
      "batchKg": 100,
      "sellPricePerKg": 58,
      "totalRevenue": 5800,
      "totalCost": 4200,
      "profit": 1600,
      "date": "2024-03-20",
      "discount": 0
    },
    {
      "id": "s2",
      "customerId": "c2",
      "customerName": "Wanjiku Poultry Farm",
      "product": "Poultry (Layer) \u2014 In Production (20+ wks) (200kg)",
      "batchKg": 200,
      "sellPricePerKg": 52,
      "totalRevenue": 10400,
      "totalCost": 7800,
      "profit": 2600,
      "date": "2024-03-25",
      "discount": 200
    },
    {
      "id": "s3",
      "customerId": "c3",
      "customerName": "Mwangi Dairy",
      "product": "Dairy Cattle \u2014 Lactating (High Prod.) (500kg)",
      "batchKg": 500,
      "sellPricePerKg": 48,
      "totalRevenue": 24000,
      "totalCost": 18500,
      "profit": 5500,
      "date": "2024-04-01",
      "discount": 0
    }
  ],
  "stockLedger": [],
  "savedFormulas": [],
  "users": [
    {
      "id": "u1",
      "name": "Admin",
      "username": "admin",
      "password": "admin123",
      "email": "admin@wamifugo.co.ke",
      "role": "admin",
      "active": true,
      "created": "2024-01-01"
    }
  ]
};

// Auto-seed: if users collection is empty on startup, load demo data
function autoSeed() {
  const { data: users } = db.getCollection('users');
  if (!users || users.length === 0) {
    console.log('📦 Auto-seeding demo data...');
    for (const [collection, data] of Object.entries(SEED_DATA)) {
      db.setCollection(collection, data);
    }
    console.log('✅ Demo data loaded — login: admin / admin123');
  }
}

// POST /api/seed — manual seed (admin use)
app.post('/api/seed', checkKey, (req, res) => {
  try {
    for (const [collection, data] of Object.entries(SEED_DATA)) {
      db.setCollection(collection, data);
    }
    res.json({ ok: true, message: 'Seeded ' + Object.keys(SEED_DATA).length + ' collections with demo data' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const DATA_DIR = process.env.DATA_DIR || 'default';
  let dataDirExists = false, writable = false, counts = {};
  try {
    dataDirExists = fs.existsSync(DATA_DIR);
    // Test writability
    try {
      const testFile = path.join(DATA_DIR, '.healthcheck');
      fs.writeFileSync(testFile, String(Date.now()));
      fs.unlinkSync(testFile);
      writable = true;
    } catch (e) {
      writable = false;
    }
    // Per-collection record counts
    const COLS = ['inventory','purchases','sales','customers','stockLedger','ingredients','users','animalReqs','savedFormulas','products','productInventory','productPurchases'];
    for (const c of COLS) {
      try {
        const r = db.getCollection(c);
        counts[c] = Array.isArray(r.data) ? r.data.length : 0;
      } catch { counts[c] = -1; }
    }
  } catch (e) {}
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dataDir: DATA_DIR,
    dataDirExists: dataDirExists,
    writable: writable,
    counts: counts,
    uptime: process.uptime()
  });
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
  autoSeed();
  app.listen(PORT, () => {
    console.log(`🌾 Wa-Mifugo server running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Data dir: ${process.env.DATA_DIR || 'default'}`);
  });
}

start();
