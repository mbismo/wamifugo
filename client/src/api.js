// All communication with the Express backend
// In dev: proxied via Vite to http://localhost:3001
// In prod: same origin as the served React app

const SYNC_KEY = import.meta.env.VITE_SYNC_KEY || 'wamifugo2024';

const headers = () => ({
  'Content-Type': 'application/json',
  'X-Sync-Key': SYNC_KEY,
});

// ── DATA SYNC ─────────────────────────────────────────────────────────────────

export async function fetchTimestamps() {
  const res = await fetch('/api/data', { headers: headers() });
  if (!res.ok) throw new Error('Failed to fetch timestamps');
  return res.json(); // { timestamps: {collection: ts}, serverTime }
}

export async function fetchCollection(name) {
  const res = await fetch(`/api/data/${name}`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch ${name}`);
  return res.json(); // { ok, data, ts }
}

export async function pushCollection(name, data) {
  const res = await fetch(`/api/data/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ data, ts: Date.now() }),
  });
  if (!res.ok) throw new Error(`Failed to push ${name}`);
  return res.json();
}

// Pull all collections in parallel
export async function pullAll() {
  const COLS = [
    'inventory','purchases','sales','customers',
    'stockLedger','ingredients','users','animalReqs','savedFormulas'
  ];
  const results = await Promise.allSettled(
    COLS.map(col => fetchCollection(col).then(r => ({ col, data: r.data, ts: r.ts })))
  );
  const out = {};
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.data !== null) {
      out[r.value.col] = { data: r.value.data, ts: r.value.ts };
    }
  });
  return out;
}

// ── PASSWORD RESET ────────────────────────────────────────────────────────────

export async function requestResetCode(email) {
  const res = await fetch('/api/auth/reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return res.json();
}

export async function verifyResetCode(email, code) {
  const res = await fetch('/api/auth/reset/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  return res.json();
}

export async function resetPassword(email, code, password) {
  const res = await fetch('/api/auth/reset/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, password }),
  });
  return res.json();
}
