# 🌾 Wa-Mifugo Feeds Management System

Livestock feed formulation and business management for Kenyan feed operations.

**Stack:** Node.js + Express · React + Vite · SQLite · Render Starter

---

## How Deployment Works

```
You edit code in VS Code
        ↓
git push to GitHub
        ↓
Render detects the push and auto-deploys (~2 minutes)
        ↓
Live at https://wamifugo.onrender.com
```

Data is stored in a SQLite file on Render's persistent disk — it survives every deploy, restart, and update.

---

## One-Time Setup

### What you need to install (all free)
- **VS Code** — code.visualstudio.com
- **Node.js 18+** — nodejs.org
- **Git** — git-scm.com

### Step 1 — Create a GitHub repository
1. Go to github.com → New repository
2. Name it `wamifugo`, set it to **Private**
3. Don't initialise with README (we'll push our own)

### Step 2 — Open the project in VS Code
1. Unzip `wamifugo-render.zip`
2. Open VS Code → File → Open Folder → select the `wamifugo` folder
3. Open the integrated terminal (Ctrl+` or View → Terminal)

### Step 3 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit — Wa-Mifugo Feeds v1.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/wamifugo.git
git push -u origin main
```

### Step 4 — Deploy on Render
1. Go to render.com → New → Web Service
2. Connect GitHub → select the `wamifugo` repository
3. Render reads `render.yaml` automatically — it already has the right build/start commands
4. Add these environment variables in the Render dashboard:

| Variable | Value |
|----------|-------|
| `EMAIL_USER` | your.gmail@gmail.com |
| `EMAIL_PASS` | 16-char Gmail App Password (see below) |
| `SITE_URL` | https://wamifugo.onrender.com |

`SYNC_KEY`, `NODE_ENV`, `DATA_DIR`, and `PORT` are already set in `render.yaml`.

5. Click **Create Web Service** — Render builds and deploys automatically

### Step 5 — Gmail App Password (for password reset emails)
1. Go to myaccount.google.com → Security
2. Enable 2-Step Verification if not already on
3. Security → App passwords → create one named "Wamifugo"
4. Copy the 16-character code → paste into `EMAIL_PASS` on Render

---

## Local Development

```bash
# Install all dependencies
cd server && npm install
cd ../client && npm install

# Copy and fill in environment variables
cp server/.env.example server/.env

# Start both servers (open two VS Code terminals)
# Terminal 1:
cd server && npm run dev

# Terminal 2:
cd client && npm run dev
```

Open http://localhost:5173

Default login: **admin** / **admin123**

---

## Deploying Updates

Every change you push automatically goes live:

```bash
git add .
git commit -m "describe what you changed"
git push
```

Render detects the push and redeploys in about 2 minutes. The SQLite database on the persistent disk is untouched — all your data stays exactly as it was.

---

## Project Structure

```
wamifugo/
├── server/
│   ├── index.js        — Express API (all routes)
│   ├── db.js           — SQLite database layer
│   ├── email.js        — Gmail password reset emails
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.jsx     — Root component, state, server sync
│   │   ├── pages.jsx   — All page components
│   │   ├── api.js      — All API calls to backend
│   │   ├── solver.js   — LP least-cost feed formulation
│   │   ├── constants.js — Seed data (animals, ingredients)
│   │   └── utils.js    — Helpers
│   ├── index.html
│   └── vite.config.js
├── render.yaml         — Render auto-reads this on deploy
└── README.md
```

---

## API Reference

All data endpoints require the `X-Sync-Key` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/data` | All collection timestamps |
| GET | `/api/data/:collection` | Read one collection |
| POST | `/api/data/:collection` | Write one collection |
| POST | `/api/auth/reset/request` | Send reset code email |
| POST | `/api/auth/reset/verify` | Verify 6-digit code |
| POST | `/api/auth/reset/password` | Set new password |
| GET | `/health` | Health check |

**Collections:** `inventory` · `purchases` · `sales` · `customers` · `stockLedger` · `ingredients` · `users` · `animalReqs` · `savedFormulas`

---

## Cost

| Service | Cost |
|---------|------|
| Render Starter web service | $7/month |
| Render persistent disk (1GB) | $0.25/month |
| GitHub private repo | Free |
| Supabase | Not needed |
| **Total** | **~$7.25/month** |

---

## Default Credentials

**Username:** `admin`  
**Password:** `admin123`

Change immediately after first login via User Management.
