import { useState, useEffect, useContext } from "react";
import React from "react";
import { Ctx } from "./App.jsx";
import { db } from "./db.js";
import { C, uid, today, dateRange, fmt, fmtKES } from "./utils.js";
import {
  SEED_USERS, SEED_ANIMAL_REQS, SEED_INGREDIENT_PROFILES,
  CATEGORY_META, CATEGORY_ICONS, FEEDING_QTY, TIPS, SPECIES_RECS,
  getAnimalReqs, getAnimalCategories, buildSpeciesList, getStagesForCategory, getReqForStage
} from "./constants.js";
import { solveLeastCost, solveLeastCostLP, solveBestEffort, assessNutrientGaps, calcNutrients, calcCost } from "./solver.js";

const h = React.createElement;

// Server push helper
async function serverPush(col, data) {
  const key = import.meta.env?.VITE_SYNC_KEY || 'wamifugo2024';
  try {
    await fetch('/api/data/' + col, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Key': key },
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.warn('Server push failed:', e.message);
  }
}

// Navigation config
const NAV = [
  { key: 'dashboard', icon: 'D', label: 'Dashboard' },
  { key: 'formulator', icon: 'F', label: 'Feed Formulator' },
  { key: 'inventory', icon: 'I', label: 'Inventory' },
  { key: 'customers', icon: 'C', label: 'Customers' },
  { key: 'sales', icon: 'S', label: 'Sales' },
  { key: 'reports', icon: 'R', label: 'Reports' },
  { key: 'feeding_guide', icon: 'G', label: 'Feeding Guide' },
  { key: 'education', icon: 'E', label: 'Education' },
  { key: 'resources', icon: 'X', label: 'Resources' },
  { key: 'traceability', icon: 'T', label: 'Traceability Log', admin: true },
  { key: 'ingredients', icon: 'N', label: 'Ingredients', admin: true },
  { key: 'nutrition', icon: 'U', label: 'Nutritional Reqs', admin: true },
  { key: 'users', icon: 'Y', label: 'Users', admin: true },
];

// Anti-nutritive factor limits - abbreviated for brevity in this rewrite
// Full reference: NRC 2012, ILRI Feed Composition Tables
const ANTI_NUTRITIVE_FACTORS = {
  'ing_6': { // Cottonseed cake - Gossypol
    factor: 'Gossypol',
    limits: {
      'Poultry (Broiler)': { maxPct: 8, warning: 6, note: 'Free gossypol limit. Causes yolk discolouration in layers.' },
      'Poultry (Layer)': { maxPct: 5, warning: 3, note: 'Causes olive egg yolk discolouration.' },
      'Poultry (Kienyeji)': { maxPct: 8, warning: 6, note: 'Monitor yolk colour.' },
      'Swine': { maxPct: 10, warning: 8, note: 'Reproductive failure in boars above 100mg/kg.' },
      'Dairy Cattle': { maxPct: 20, warning: 15, note: 'Ruminants detoxify gossypol.' },
      'Beef Cattle': { maxPct: 20, warning: 15, note: 'Young calves more sensitive.' },
      'Rabbit': { maxPct: 10, warning: 7, note: 'Monitor reproduction.' },
      'Fish (Tilapia)': { maxPct: 5, warning: 3, note: 'Reduces growth and damages liver.' },
      'Goat / Sheep': { maxPct: 15, warning: 12, note: 'Similar to cattle.' },
    }
  },
  'ing_14': { // Cassava - HCN
    factor: 'Hydrocyanic Acid',
    limits: {
      'Poultry (Broiler)': { maxPct: 15, warning: 10, note: 'Properly dried cassava is safer.' },
      'Poultry (Layer)': { maxPct: 10, warning: 7, note: 'Can reduce egg production.' },
      'Poultry (Kienyeji)': { maxPct: 15, warning: 10, note: '' },
      'Swine': { maxPct: 20, warning: 15, note: 'Limit in young piglets.' },
      'Dairy Cattle': { maxPct: 30, warning: 25, note: 'Rumen detox handles HCN well.' },
      'Beef Cattle': { maxPct: 30, warning: 25, note: '' },
      'Rabbit': { maxPct: 15, warning: 10, note: 'Use only well-dried cassava.' },
      'Fish (Tilapia)': { maxPct: 10, warning: 7, note: 'HCN toxic to fish.' },
      'Goat / Sheep': { maxPct: 30, warning: 25, note: '' },
    }
  },
  'ing_18': { // Urea
    factor: 'Non-Protein Nitrogen',
    limits: {
      'Poultry (Broiler)': { maxPct: 0, warning: 0, note: 'EXCLUDED: Poultry cannot utilise NPN.' },
      'Poultry (Layer)': { maxPct: 0, warning: 0, note: 'EXCLUDED: Toxic to poultry.' },
      'Poultry (Kienyeji)': { maxPct: 0, warning: 0, note: 'EXCLUDED.' },
      'Swine': { maxPct: 0, warning: 0, note: 'EXCLUDED: Pigs cannot utilise NPN.' },
      'Dairy Cattle': { maxPct: 1, warning: 0.8, note: 'Max 1% of DM. Introduce gradually.' },
      'Beef Cattle': { maxPct: 1, warning: 0.8, note: 'Gradual introduction essential.' },
      'Rabbit': { maxPct: 0, warning: 0, note: 'EXCLUDED.' },
      'Fish (Tilapia)': { maxPct: 0, warning: 0, note: 'EXCLUDED: Toxic to fish.' },
      'Goat / Sheep': { maxPct: 1, warning: 0.8, note: 'Same as cattle.' },
    }
  },
  'ing_13': { // Sorghum - tannins
    factor: 'Condensed Tannins',
    limits: {
      'Poultry (Broiler)': { maxPct: 20, warning: 15, note: 'Use low-tannin varieties.' },
      'Poultry (Layer)': { maxPct: 15, warning: 10, note: 'Reduces egg production.' },
      'Poultry (Kienyeji)': { maxPct: 20, warning: 15, note: '' },
      'Swine': { maxPct: 30, warning: 25, note: 'Better tolerance than poultry.' },
      'Dairy Cattle': { maxPct: 40, warning: 35, note: 'Ruminants tolerate well.' },
      'Beef Cattle': { maxPct: 40, warning: 35, note: '' },
      'Rabbit': { maxPct: 20, warning: 15, note: '' },
      'Fish (Tilapia)': { maxPct: 15, warning: 10, note: '' },
      'Goat / Sheep': { maxPct: 40, warning: 30, note: '' },
    }
  },
  'ing_17': { // Blood meal
    factor: 'Amino Acid Imbalance',
    limits: {
      'Poultry (Broiler)': { maxPct: 4, warning: 3, note: 'Isoleucine deficiency above 3%.' },
      'Poultry (Layer)': { maxPct: 3, warning: 2, note: 'Poor palatability.' },
      'Poultry (Kienyeji)': { maxPct: 4, warning: 3, note: '' },
      'Swine': { maxPct: 5, warning: 4, note: 'Palatability issues.' },
      'Dairy Cattle': { maxPct: 5, warning: 4, note: 'Good bypass protein.' },
      'Beef Cattle': { maxPct: 5, warning: 4, note: '' },
      'Rabbit': { maxPct: 3, warning: 2, note: 'Poor palatability limit.' },
      'Fish (Tilapia)': { maxPct: 10, warning: 7, note: 'Fish accept it better.' },
      'Goat / Sheep': { maxPct: 5, warning: 4, note: '' },
    }
  },
  'ing_4': { // Fish meal
    factor: 'Biogenic Amines',
    limits: {
      'Poultry (Broiler)': { maxPct: 8, warning: 6, note: 'Can cause fishy taint in meat.' },
      'Poultry (Layer)': { maxPct: 4, warning: 3, note: 'CRITICAL: Above 4% causes egg taint.' },
      'Poultry (Kienyeji)': { maxPct: 6, warning: 4, note: 'Taint risk in eggs.' },
      'Swine': { maxPct: 8, warning: 6, note: 'Withdraw 2 weeks before slaughter.' },
      'Dairy Cattle': { maxPct: 5, warning: 3, note: 'Can cause fishy milk taint.' },
      'Beef Cattle': { maxPct: 8, warning: 6, note: '' },
      'Rabbit': { maxPct: 5, warning: 3, note: '' },
      'Fish (Tilapia)': { maxPct: 15, warning: 10, note: '' },
      'Goat / Sheep': { maxPct: 5, warning: 3, note: '' },
    }
  },
};

function getANFLimit(ingId, species) {
  const anf = ANTI_NUTRITIVE_FACTORS[ingId];
  if (!anf) return null;
  const limit = anf.limits[species];
  if (!limit) return null;
  return Object.assign({}, anf, limit);
}

function getEffectiveMaxIncl(ing, species) {
  const base = ing.maxIncl !== undefined ? ing.maxIncl : 100;
  const anf = getANFLimit(ing.id, species);
  if (!anf) return base;
  if (anf.maxPct === 0) return 0;
  return Math.min(base, anf.maxPct);
}

function checkANFWarnings(formula, ingredients, species) {
  const warnings = [];
  const exclusions = [];
  Object.entries(formula).forEach(function(entry) {
    const id = entry[0], pct = entry[1];
    const anf = getANFLimit(id, species);
    if (!anf) return;
    const ing = ingredients.find(function(i) { return i.id === id; });
    if (!ing) return;
    if (anf.maxPct === 0) {
      exclusions.push({ ingredient: ing.name, factor: anf.factor, note: anf.note });
    } else if (pct > anf.maxPct) {
      warnings.push({ ingredient: ing.name, factor: anf.factor, current: pct.toFixed(1), maxPct: anf.maxPct, note: anf.note, severity: 'danger' });
    } else if (pct > anf.warning) {
      warnings.push({ ingredient: ing.name, factor: anf.factor, current: pct.toFixed(1), maxPct: anf.maxPct, note: anf.note, severity: 'warning' });
    }
  });
  return { warnings: warnings, exclusions: exclusions };
}

// ========== UI ATOMS ==========

function Btn(props) {
  const size = props.size || 'md';
  const variant = props.variant || 'primary';
  const sizeMap = { sm: { padding: '6px 11px', fontSize: 12 }, md: { padding: '9px 15px', fontSize: 13 }, lg: { padding: '12px 20px', fontSize: 14 } };
  const variantMap = {
    primary: { bg: C.earth, color: 'white', b: C.earth },
    secondary: { bg: 'white', color: C.earth, b: C.border },
    success: { bg: C.grass, color: 'white', b: C.grass },
    danger: { bg: C.danger, color: 'white', b: C.danger },
    warn: { bg: C.warning, color: 'white', b: C.warning },
  };
  const s = sizeMap[size];
  const v = variantMap[variant];
  const style = Object.assign({
    padding: s.padding,
    fontSize: s.fontSize,
    background: v.bg,
    color: v.color,
    border: '1px solid ' + v.b,
    borderRadius: 8,
    fontWeight: 600,
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.5 : 1,
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
  }, props.style || {});
  return h('button', { onClick: props.onClick, disabled: props.disabled, style: style }, props.children);
}

function Badge(props) {
  const color = props.color || C.muted;
  const style = { background: color + '22', color: color, border: '1px solid ' + color + '44', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 600, display: 'inline-block' };
  return h('span', { style: style }, props.children);
}

function Card(props) {
  const style = Object.assign({ background: 'white', border: '1px solid ' + C.border, borderRadius: 14, overflow: 'hidden', marginBottom: 14 }, props.style || {});
  return h('div', { style: style }, props.children);
}

function CardTitle(props) {
  const style = { background: C.parchment, padding: '11px 17px', borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const titleStyle = { fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: C.soil };
  return h('div', { style: style },
    h('span', { style: titleStyle }, props.children),
    props.action || null
  );
}

function Inp(props) {
  const wrapStyle = { marginBottom: 12 };
  const labelStyle = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: C.muted, marginBottom: 4 };
  const inputStyle = Object.assign({
    width: '100%', padding: '8px 11px', border: '1px solid ' + C.border, borderRadius: 8,
    fontSize: 13, color: C.ink, background: C.cream, outline: 'none'
  }, props.style || {});
  const labelEl = props.label ? h('div', { style: labelStyle }, props.label) : null;
  const input = h('input', {
    type: props.type || 'text',
    value: props.value,
    onChange: function(e) { props.onChange(e.target.value); },
    placeholder: props.placeholder || '',
    style: inputStyle
  });
  return h('div', { style: wrapStyle }, labelEl, input);
}

function Sel(props) {
  const wrapStyle = { marginBottom: 12 };
  const labelStyle = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: C.muted, marginBottom: 4 };
  const selectStyle = Object.assign({
    width: '100%', padding: '8px 11px', border: '1px solid ' + C.border, borderRadius: 8,
    fontSize: 13, color: C.ink, background: C.cream, outline: 'none'
  }, props.style || {});
  const labelEl = props.label ? h('div', { style: labelStyle }, props.label) : null;
  const options = (props.options || []).map(function(o) {
    return h('option', { key: o.value, value: o.value }, o.label);
  });
  const select = h('select', {
    value: props.value || '',
    onChange: function(e) { props.onChange(e.target.value); },
    disabled: props.disabled || false,
    style: selectStyle
  }, options);
  return h('div', { style: wrapStyle }, labelEl, select);
}

function StatCard(props) {
  const color = props.color || C.earth;
  const style = { background: 'white', border: '1px solid ' + C.border, borderLeft: '4px solid ' + color, borderRadius: 12, padding: '12px 15px' };
  return h('div', { style: style },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 } },
      props.icon ? h('span', { style: { fontSize: 16 } }, props.icon) : null,
      h('span', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.muted } }, props.label)
    ),
    h('div', { style: { fontSize: 22, fontFamily: "'Playfair Display',serif", fontWeight: 900, color: color } }, props.value),
    props.sub ? h('div', { style: { fontSize: 11, color: C.muted, marginTop: 2 } }, props.sub) : null
  );
}

function Modal(props) {
  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
  const modal = { background: 'white', borderRadius: 16, width: '100%', maxWidth: props.width || 500, maxHeight: '90vh', overflowY: 'auto' };
  const header = { padding: '14px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
  const body = { padding: 18 };
  return h('div', { style: overlay, onClick: props.onClose },
    h('div', { style: modal, onClick: function(e) { e.stopPropagation(); } },
      h('div', { style: header },
        h('div', { style: { fontFamily: "'Playfair Display',serif", fontSize: 17, fontWeight: 700, color: C.earth } }, props.title),
        h('button', { onClick: props.onClose, style: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.muted } }, 'x')
      ),
      h('div', { style: body }, props.children)
    )
  );
}

function Toast(props) {
  const type = props.type || 'success';
  const colors = { success: C.grass, error: C.danger, warn: C.warning, info: C.earth };
  const color = colors[type] || C.grass;
  const style = { position: 'fixed', top: 20, right: 20, background: color, color: 'white', padding: '11px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' };
  return h('div', { style: style }, props.msg);
}

function PageHdr(props) {
  const style = { padding: '22px 26px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 };
  return h('div', { style: style },
    h('div', null,
      h('div', { style: { fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 900, color: C.earth, lineHeight: 1.1 } }, props.title),
      props.subtitle ? h('div', { style: { fontSize: 13, color: C.muted, marginTop: 4 } }, props.subtitle) : null
    ),
    props.action || null
  );
}

function Tbl(props) {
  const cols = props.cols || [];
  const rows = props.rows || [];
  const headerStyle = { padding: '9px 13px', background: C.parchment, color: C.soil, textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap' };
  const cellStyle = { padding: '9px 13px', color: C.ink, verticalAlign: 'middle', fontSize: 12 };
  const ths = cols.map(function(c) { return h('th', { key: c.key, style: headerStyle }, c.label); });
  if (rows.length === 0) {
    return h('div', { style: { padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 } }, props.emptyMsg || 'No data');
  }
  const trs = rows.map(function(row, i) {
    const tds = cols.map(function(c) {
      const value = c.render ? c.render(row) : row[c.key];
      return h('td', { key: c.key, style: cellStyle }, value);
    });
    const rowStyle = { borderBottom: '1px solid ' + C.border, background: i % 2 === 0 ? C.cream : 'white' };
    return h('tr', { key: row.id || i, style: rowStyle }, tds);
  });
  return h('div', { style: { overflowX: 'auto' } },
    h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
      h('thead', null, h('tr', null, ths)),
      h('tbody', null, trs)
    )
  );
}


// ========== LOGIN PAGE ==========

function LoginPage(props) {
  const [view, setView] = useState('login');
  const [uname, setUname] = useState('');
  const [pass, setPass] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  function setE(e) { setErr(e); setMsg(''); }
  function setM(m) { setMsg(m); setErr(''); }

  function login() {
    setErr('');
    const stored = db.get('users', null);
    const users = (stored && stored.length > 0) ? stored : SEED_USERS;
    const user = users.find(function(u) {
      return u.username === uname && u.password === pass && u.active;
    });
    if (user) props.onLogin(user);
    else setE('Invalid username or password.');
  }

  async function requestCode() {
    if (!email.trim()) { setE('Enter your email.'); return; }
    setLoading(true); setE('');
    try {
      const r = await fetch('/api/auth/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      const d = await r.json();
      setLoading(false);
      if (d.ok) { setM(d.msg || 'Code sent - check inbox and spam.'); setView('verify'); }
      else setE(d.error || 'Something went wrong.');
    } catch (e) {
      setLoading(false); setE('Could not reach server.');
    }
  }

  async function verifyCode() {
    if (code.length !== 6) { setE('Enter the 6-digit code.'); return; }
    setLoading(true); setE('');
    try {
      const r = await fetch('/api/auth/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_code', email: email.trim(), code: code.trim() })
      });
      const d = await r.json();
      setLoading(false);
      if (d.ok) { setView('newpass'); setM(''); }
      else setE(d.error || 'Invalid code.');
    } catch (e) {
      setLoading(false); setE('Could not reach server.');
    }
  }

  async function resetPassword() {
    if (!newPass || newPass.length < 6) { setE('Min 6 characters.'); return; }
    if (newPass !== newPass2) { setE('Passwords do not match.'); return; }
    setLoading(true); setE('');
    try {
      const r = await fetch('/api/auth/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password', email: email.trim(), code: code.trim(), password: newPass })
      });
      const d = await r.json();
      setLoading(false);
      if (d.ok) {
        const us = db.get('users', SEED_USERS);
        db.set('users', us.map(function(u) {
          if (u.email && u.email.toLowerCase() === email.trim().toLowerCase()) {
            return Object.assign({}, u, { password: newPass });
          }
          return u;
        }));
        setM('Password updated! You can now sign in.');
        setView('login');
        setCode(''); setNewPass(''); setNewPass2('');
      } else setE(d.error || 'Could not update password.');
    } catch (e) {
      setLoading(false); setE('Could not reach server.');
    }
  }

  const headerTitle = (view === 'forgot') ? 'Reset Password'
    : (view === 'verify') ? 'Enter Code'
    : (view === 'newpass') ? 'New Password' : '';

  const header = h('div', { style: { textAlign: 'center', marginBottom: 28 } },
    h('div', { style: { fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 900, color: C.earth, lineHeight: 1.1 } }, 'Wa-Mifugo'),
    h('div', { style: { fontFamily: "'DM Mono',monospace", fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 } }, 'Feeds Management System'),
    (view !== 'login') ? h('div', { style: { marginTop: 10, fontSize: 13, color: C.soil, fontWeight: 600 } }, headerTitle) : null
  );

  const errBox = err ? h('div', {
    style: { background: '#fde8e8', color: C.danger, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12, border: '1px solid ' + C.danger + '44' }
  }, err) : null;

  const msgBox = msg ? h('div', {
    style: { background: '#f0f9f4', color: C.grass, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12, border: '1px solid ' + C.grass + '44' }
  }, msg) : null;

  const loginView = h('div', null,
    h(Inp, { label: 'Username', value: uname, onChange: setUname, placeholder: 'Enter username' }),
    h(Inp, { label: 'Password', value: pass, onChange: function(v) { setPass(v); setErr(''); }, type: 'password', placeholder: 'Enter password' }),
    h(Btn, { onClick: login, size: 'lg', style: { width: '100%', marginTop: 10 } }, 'Sign In'),
    h('div', { style: { textAlign: 'center', marginTop: 14 } },
      h('span', {
        style: { fontSize: 13, color: C.muted, cursor: 'pointer', textDecoration: 'underline' },
        onClick: function() { setView('forgot'); setErr(''); setMsg(''); }
      }, 'Forgot password?')
    )
  );

  const forgotView = h('div', null,
    h(Inp, { label: 'Registered Email', value: email, onChange: setEmail, type: 'email', placeholder: 'e.g. jane@example.com' }),
    h(Btn, { onClick: requestCode, size: 'lg', style: { width: '100%', marginTop: 10 }, disabled: loading },
      loading ? 'Sending...' : 'Send Reset Code'),
    h('div', { style: { textAlign: 'center', marginTop: 12 } },
      h('span', {
        style: { fontSize: 13, color: C.muted, cursor: 'pointer', textDecoration: 'underline' },
        onClick: function() { setView('login'); setErr(''); setMsg(''); }
      }, 'Back to sign in')
    )
  );

  const verifyView = h('div', null,
    h('p', { style: { fontSize: 13, color: C.muted, marginBottom: 12 } },
      'Code sent to ', h('strong', null, email), '. Expires in 15 min.'),
    h('div', { style: { marginBottom: 12 } },
      h('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 5 } }, '6-Digit Code'),
      h('input', {
        value: code,
        onChange: function(e) { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); },
        placeholder: '000000',
        maxLength: 6,
        style: { width: '100%', padding: 12, border: '2px solid ' + C.border, borderRadius: 10, fontSize: 28, fontFamily: "'DM Mono',monospace", fontWeight: 700, letterSpacing: 12, textAlign: 'center', background: C.cream }
      })
    ),
    h(Btn, { onClick: verifyCode, size: 'lg', style: { width: '100%' }, disabled: loading || code.length !== 6 },
      loading ? 'Verifying...' : 'Verify Code'),
    h('div', { style: { textAlign: 'center', marginTop: 12 } },
      h('span', {
        style: { fontSize: 13, color: C.muted, cursor: 'pointer', textDecoration: 'underline' },
        onClick: function() { setView('forgot'); setCode(''); setErr(''); setMsg(''); }
      }, 'Resend code')
    )
  );

  const confirmBorderColor = (newPass2 && newPass2 !== newPass) ? C.danger : C.border;
  const newPassView = h('div', null,
    h('div', { style: { marginBottom: 10 } },
      h('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 4 } }, 'New Password'),
      h('input', {
        type: 'password',
        value: newPass,
        onChange: function(e) { setNewPass(e.target.value); },
        placeholder: 'Min 6 characters',
        style: { width: '100%', padding: '9px 12px', border: '1px solid ' + C.border, borderRadius: 8, fontSize: 14, background: C.cream }
      })
    ),
    h('div', { style: { marginBottom: 12 } },
      h('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 4 } }, 'Confirm Password'),
      h('input', {
        type: 'password',
        value: newPass2,
        onChange: function(e) { setNewPass2(e.target.value); },
        placeholder: 'Repeat new password',
        style: { width: '100%', padding: '9px 12px', border: '1px solid ' + confirmBorderColor, borderRadius: 8, fontSize: 14, background: C.cream }
      })
    ),
    h(Btn, {
      onClick: resetPassword,
      size: 'lg',
      style: { width: '100%' },
      disabled: loading || !newPass || !newPass2 || newPass !== newPass2
    }, loading ? 'Saving...' : 'Set New Password')
  );

  const card = h('div', {
    style: { background: 'white', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 400, boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }
  },
    header,
    errBox,
    msgBox,
    (view === 'login') ? loginView : null,
    (view === 'forgot') ? forgotView : null,
    (view === 'verify') ? verifyView : null,
    (view === 'newpass') ? newPassView : null
  );

  return h('div', {
    style: { minHeight: '100vh', background: C.earth, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
  }, card);
}

// ========== SIDEBAR ==========

function Sidebar(props) {
  const items = NAV.filter(function(n) { return !n.admin || props.user.role === 'admin'; });
  const buttons = items.map(function(item) {
    const active = props.page === item.key;
    const btnStyle = {
      display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 11px',
      borderRadius: 8, border: 'none',
      background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
      color: active ? 'white' : 'rgba(255,255,255,0.62)',
      fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: "'DM Sans',sans-serif",
      cursor: 'pointer', textAlign: 'left', marginBottom: 2, transition: 'all 0.15s'
    };
    return h('button', {
      key: item.key,
      onClick: function() { props.setPage(item.key); if (props.onClose) props.onClose(); },
      style: btnStyle
    }, h('span', { style: { fontSize: 16 } }, item.icon), item.label);
  });

  const sidebarStyle = {
    width: 215, background: C.earth, minHeight: '100vh',
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    position: 'relative', zIndex: 1000, transition: 'left 0.25s ease'
  };

  return h('div', { className: 'wm-sidebar' + (props.isOpen ? ' open' : ''), style: sidebarStyle },
    h('div', { style: { padding: '18px 15px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)' } },
      h('div', { style: { fontFamily: "'Playfair Display',serif", fontSize: 21, fontWeight: 900, color: 'white', lineHeight: 1 } }, 'Wa-Mifugo'),
      h('div', { style: { fontFamily: "'DM Mono',monospace", fontSize: 9, color: C.harvest, letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 } }, 'Feeds Management')
    ),
    h('nav', { style: { flex: 1, padding: '8px 7px' } }, buttons),
    h('div', { style: { padding: '13px 15px', borderTop: '1px solid rgba(255,255,255,0.1)' } },
      h('div', { style: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 3 } }, 'Signed in as'),
      h('div', { style: { fontSize: 13, color: 'white', fontWeight: 600 } }, props.user.name),
      h('div', { style: { fontSize: 10, color: C.harvest, textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'DM Mono',monospace" } }, props.user.role),
      h('button', {
        onClick: props.onLogout,
        style: { marginTop: 9, fontSize: 12, color: 'rgba(255,255,255,0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }
      }, 'Sign out')
    )
  );
}


// ========== DASHBOARD PAGE ==========

function DashboardPage() {
  const ctx = useContext(Ctx);
  const sales = ctx.sales || [];
  const inventory = ctx.inventory || [];
  const customers = ctx.customers || [];
  const purchases = ctx.purchases || [];

  const today30 = new Date(); today30.setDate(today30.getDate() - 30);
  const monthSales = sales.filter(function(s) { return new Date(s.date) >= today30; });
  const rev = monthSales.reduce(function(s, x) { return s + (x.total || x.totalRevenue || 0); }, 0);
  const cost = monthSales.reduce(function(s, x) { return s + (x.cost || x.totalCost || 0); }, 0);
  const profit = rev - cost;

  const lowStock = inventory.filter(function(i) { return i.qty <= (i.reorderLevel || 0); });
  const stockValue = inventory.reduce(function(s, i) { return s + (i.qty || 0) * (i.lastPrice || 0); }, 0);

  const statStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12, marginBottom: 18 };
  const profitColor = profit > -1 ? C.grass : C.danger;
  const profitSub = rev ? ((profit / rev) * 100).toFixed(1) + '% margin' : '';

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, { title: 'Dashboard', subtitle: 'Overview of your feed business (last 30 days)' }),
    h('div', { style: statStyle },
      h(StatCard, { label: 'Revenue (30d)', value: fmtKES(rev), color: C.grass, icon: '$' }),
      h(StatCard, { label: 'Profit (30d)', value: fmtKES(profit), sub: profitSub, color: profitColor, icon: '%' }),
      h(StatCard, { label: 'Sales Count', value: monthSales.length, color: C.earth, icon: '#' }),
      h(StatCard, { label: 'Stock Value', value: fmtKES(stockValue), color: C.clay, icon: 'S' }),
      h(StatCard, { label: 'Customers', value: customers.length, color: C.soil, icon: 'C' }),
      h(StatCard, { label: 'Low Stock Items', value: lowStock.length, color: C.danger, icon: '!' })
    ),
    lowStock.length > 0 ? h(Card, null,
      h(CardTitle, null, 'Low Stock Alert'),
      h('div', { style: { padding: 14 } },
        lowStock.map(function(i) {
          return h('div', { key: i.id, style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + C.border } },
            h('span', { style: { color: C.earth, fontWeight: 600 } }, i.name),
            h(Badge, { color: C.danger }, fmt(i.qty || 0) + ' kg (reorder at ' + (i.reorderLevel || 0) + ')')
          );
        })
      )
    ) : null,
    h(Card, null,
      h(CardTitle, null, 'Recent Sales'),
      h(Tbl, {
        cols: [
          { key: 'date', label: 'Date' },
          { key: 'customer', label: 'Customer', render: function(r) { return r.customerName || r.customer || 'Walk-in'; } },
          { key: 'product', label: 'Product' },
          { key: 'batchKg', label: 'Batch', render: function(r) { return r.batchKg + ' kg'; } },
          { key: 'total', label: 'Revenue', render: function(r) { return fmtKES(r.total || r.totalRevenue || 0); } },
          { key: 'profit', label: 'Profit', render: function(r) {
            const p = r.profit || 0;
            return h('span', { style: { color: p > -1 ? C.grass : C.danger, fontWeight: 700 } }, fmtKES(p));
          }},
        ],
        rows: sales.slice().reverse().slice(0, 10),
        emptyMsg: 'No sales recorded yet.'
      })
    )
  );
}

// ========== INVENTORY PAGE ==========

function InventoryPage() {
  const ctx = useContext(Ctx);
  const ingredients = ctx.ingredients || [];
  const inventory = ctx.inventory || [];
  const setInventory = ctx.setInventory;
  const purchases = ctx.purchases || [];
  const setPurchases = ctx.setPurchases;
  const user = ctx.user;

  const [showAdd, setShowAdd] = useState(false);
  const [ns, setNs] = useState({ itemId: '', qty: '', costPerKg: '', date: today(), supplier: '' });
  const [showPriceEdit, setShowPriceEdit] = useState(null);
  const [priceMode, setPriceMode] = useState('margin');
  const [marginVal, setMarginVal] = useState('20');
  const [directPrice, setDirectPrice] = useState('');
  const [toast, setToast] = useState(null);

  function showT(msg, type) {
    setToast({ msg: msg, type: type || 'success' });
    setTimeout(function() { setToast(null); }, 3500);
  }

  function getSellPrice(item) {
    if (item.sellPriceDirect) return item.sellPriceDirect;
    const margin = item.margin || 20;
    return Math.round((item.lastPrice || 0) * (1 + margin / 100) * 100) / 100;
  }

  function catColor(cat) {
    const m = CATEGORY_META.find(function(c) { return c.key === cat; });
    return m ? m.color : C.muted;
  }
  function catLabel(cat) {
    const m = CATEGORY_META.find(function(c) { return c.key === cat; });
    return m ? m.label : cat;
  }

  function addStock() {
    if (!ns.itemId || !ns.qty || !ns.costPerKg) return;
    const qty = parseFloat(ns.qty);
    const cost = parseFloat(ns.costPerKg);
    const item = inventory.find(function(i) { return i.id === ns.itemId; });
    const newInv = inventory.map(function(i) {
      if (i.id !== ns.itemId) return i;
      const sp = i.sellPriceDirect || Math.round(cost * (1 + (i.margin || 20) / 100) * 100) / 100;
      return Object.assign({}, i, { qty: i.qty + qty, lastPrice: cost, sellPrice: sp });
    });
    setInventory(newInv);
    setPurchases(purchases.concat([{
      id: uid(), itemId: ns.itemId, itemName: item ? item.name : '',
      qty: qty, costPerKg: cost, total: qty * cost, date: ns.date, supplier: ns.supplier
    }]));
    const ledger = db.get('stockLedger', []);
    const entry = {
      id: uid(), type: 'PURCHASE', date: ns.date,
      itemId: ns.itemId, itemName: item ? item.name : '',
      qty: qty, costPerKg: cost, total: qty * cost,
      supplier: ns.supplier, by: user ? user.name : ''
    };
    db.set('stockLedger', ledger.concat([entry]));
    serverPush('stockLedger', ledger.concat([entry]));
    setNs({ itemId: '', qty: '', costPerKg: '', date: today(), supplier: '' });
    setShowAdd(false);
    showT('Stock added');
  }

  function openPriceEdit(item) {
    setShowPriceEdit(item);
    setPriceMode(item.sellPriceDirect ? 'direct' : 'margin');
    setMarginVal(String(item.margin || 20));
    setDirectPrice(String(item.sellPriceDirect || getSellPrice(item)));
  }

  function savePriceEdit() {
    if (!showPriceEdit) return;
    const sp = priceMode === 'direct' ? parseFloat(directPrice) : null;
    const mg = priceMode === 'margin' ? parseFloat(marginVal) : (showPriceEdit.margin || 20);
    setInventory(inventory.map(function(i) {
      if (i.id !== showPriceEdit.id) return i;
      return Object.assign({}, i, {
        margin: mg,
        sellPriceDirect: sp || null,
        sellPrice: sp || Math.round((i.lastPrice || 0) * (1 + mg / 100) * 100) / 100
      });
    }));
    setShowPriceEdit(null);
    showT('Sell price updated');
  }

  function deleteInventoryItem(item) {
    if (user.role !== 'admin') { showT('Only admin can delete.', 'error'); return; }
    if (!window.confirm('Remove ' + item.name + ' from inventory?')) return;
    setInventory(inventory.filter(function(i) { return i.id !== item.id; }));
    const ledger = db.get('stockLedger', []);
    const entry = {
      id: uid(), type: 'DELETE_INGREDIENT', date: today(),
      itemId: item.id, itemName: item.name, qty: item.qty,
      deletedRecord: JSON.stringify(item), by: user.name, at: new Date().toISOString()
    };
    db.set('stockLedger', ledger.concat([entry]));
    serverPush('stockLedger', ledger.concat([entry]));
    showT('Item archived to traceability log');
  }

  function deletePurchase(p) {
    if (user.role !== 'admin') { showT('Only admin can delete.', 'error'); return; }
    if (!window.confirm('Delete this purchase? Stock will be adjusted.')) return;
    setInventory(inventory.map(function(i) {
      if (i.id !== p.itemId) return i;
      return Object.assign({}, i, { qty: Math.max(0, i.qty - p.qty) });
    }));
    setPurchases(purchases.filter(function(x) { return x.id !== p.id; }));
    const ledger = db.get('stockLedger', []);
    const entry = {
      id: uid(), type: 'DELETE_PURCHASE', date: today(),
      itemId: p.itemId, itemName: p.itemName, qty: -p.qty,
      total: p.total, deletedRecord: JSON.stringify(p),
      by: user.name, at: new Date().toISOString()
    };
    db.set('stockLedger', ledger.concat([entry]));
    serverPush('stockLedger', ledger.concat([entry]));
  }

  const statStyle = { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 };
  const stockValue = inventory.reduce(function(s, i) { return s + i.qty * (i.lastPrice || 0); }, 0);

  const priceModal = showPriceEdit ? h(Modal, {
    title: 'Set Sell Price - ' + showPriceEdit.name,
    onClose: function() { setShowPriceEdit(null); },
    width: 440
  },
    h('div', {
      style: { background: C.parchment, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.soil }
    }, 'Current Buy Price: ', h('strong', null, fmtKES(showPriceEdit.lastPrice || 0) + '/kg')),
    h('div', {
      style: { display: 'flex', gap: 0, marginBottom: 14, borderRadius: 8, overflow: 'hidden', border: '1px solid ' + C.border }
    },
      ['margin', 'direct'].map(function(m) {
        const btnStyle = {
          flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer',
          fontWeight: priceMode === m ? 700 : 400,
          background: priceMode === m ? C.earth : 'white',
          color: priceMode === m ? 'white' : C.muted,
          fontSize: 13
        };
        const label = m === 'margin' ? 'Margin %' : 'Fixed Price';
        return h('button', { key: m, onClick: function() { setPriceMode(m); }, style: btnStyle }, label);
      })
    ),
    priceMode === 'margin' ? h('div', null,
      h(Inp, { label: 'Margin %', value: marginVal, onChange: setMarginVal, type: 'number', placeholder: 'e.g. 20' }),
      h('div', {
        style: { background: '#f0f9f4', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.grass, fontWeight: 700 }
      }, 'Sell Price = ' + fmtKES(Math.round((showPriceEdit.lastPrice || 0) * (1 + (parseFloat(marginVal) || 0) / 100) * 100) / 100) + '/kg')
    ) : h('div', null,
      h(Inp, { label: 'Direct Sell Price (KES/kg)', value: directPrice, onChange: setDirectPrice, type: 'number' }),
      (directPrice && showPriceEdit.lastPrice > 0) ? h('div', {
        style: { background: '#f0f9f4', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.grass, fontWeight: 700 }
      }, 'Implied Margin = ' + Math.round(((parseFloat(directPrice || 0) - (showPriceEdit.lastPrice || 0)) / (showPriceEdit.lastPrice || 1)) * 100) + '%') : null
    ),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowPriceEdit(null); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, { onClick: savePriceEdit, variant: 'success' }, 'Save Sell Price')
    )
  ) : null;

  const addModal = showAdd ? h(Modal, {
    title: 'Add Stock',
    onClose: function() { setShowAdd(false); },
    width: 460
  },
    h(Sel, {
      label: 'Ingredient',
      value: ns.itemId,
      onChange: function(v) { setNs(Object.assign({}, ns, { itemId: v })); },
      options: [{ value: '', label: 'Select ingredient...' }].concat(
        inventory.map(function(i) { return { value: i.id, label: i.name }; })
      )
    }),
    h(Inp, { label: 'Quantity (kg)', value: ns.qty, onChange: function(v) { setNs(Object.assign({}, ns, { qty: v })); }, type: 'number' }),
    h(Inp, { label: 'Cost per kg (KES)', value: ns.costPerKg, onChange: function(v) { setNs(Object.assign({}, ns, { costPerKg: v })); }, type: 'number' }),
    h(Inp, { label: 'Date', value: ns.date, onChange: function(v) { setNs(Object.assign({}, ns, { date: v })); }, type: 'date' }),
    h(Inp, { label: 'Supplier (optional)', value: ns.supplier, onChange: function(v) { setNs(Object.assign({}, ns, { supplier: v })); } }),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowAdd(false); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, { onClick: addStock, variant: 'success' }, 'Record Purchase')
    )
  ) : null;

  const invCols = [
    { key: 'name', label: 'Ingredient', render: function(r) {
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { background: catColor(r.category) + '22', color: catColor(r.category), borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 700 } }, r.category ? r.category[0].toUpperCase() : '-'),
        r.name
      );
    }},
    { key: 'category', label: 'Type', render: function(r) { return h(Badge, { color: catColor(r.category) }, catLabel(r.category)); } },
    { key: 'qty', label: 'In Stock', render: function(r) {
      return h('span', {
        style: { fontFamily: "'DM Mono',monospace", fontWeight: 700, color: r.qty <= (r.reorderLevel || 0) ? C.danger : C.grass }
      }, fmt(r.qty) + ' kg');
    }},
    { key: 'lastPrice', label: 'Buy Price', render: function(r) { return fmtKES(r.lastPrice || 0) + '/kg'; } },
    { key: 'sellPrice', label: 'Sell Price', render: function(r) {
      return h('span', { style: { fontWeight: 700, color: C.grass } }, fmtKES(getSellPrice(r)) + '/kg');
    }},
    { key: 'margin', label: 'Margin', render: function(r) {
      return h('span', { style: { fontSize: 11, color: C.muted } }, r.sellPriceDirect ? 'Fixed' : ((r.margin || 20) + '%'));
    }},
    { key: 'value', label: 'Stock Value', render: function(r) { return fmtKES(r.qty * (r.lastPrice || 0)); } },
    { key: 'actions', label: '', render: function(r) {
      return h('div', { style: { display: 'flex', gap: 4 } },
        h(Btn, { size: 'sm', variant: 'secondary', onClick: function() { openPriceEdit(r); } }, 'Price'),
        user && user.role === 'admin' ? h(Btn, { size: 'sm', variant: 'danger', onClick: function() { deleteInventoryItem(r); } }, 'Del') : null
      );
    }}
  ];

  const purchCols = [
    { key: 'date', label: 'Date' },
    { key: 'itemName', label: 'Ingredient' },
    { key: 'qty', label: 'Qty', render: function(r) { return r.qty + ' kg'; } },
    { key: 'costPerKg', label: 'Cost/kg', render: function(r) { return fmtKES(r.costPerKg); } },
    { key: 'total', label: 'Total', render: function(r) { return fmtKES(r.total); } },
    { key: 'supplier', label: 'Supplier', render: function(r) { return r.supplier || '-'; } },
    user && user.role === 'admin' ? { key: 'del', label: '', render: function(r) {
      return h(Btn, { size: 'sm', variant: 'danger', onClick: function() { deletePurchase(r); } }, 'Del');
    }} : null
  ].filter(Boolean);

  return h('div', { style: { padding: '0 26px 26px' } },
    toast ? h(Toast, { msg: toast.msg, type: toast.type }) : null,
    h(PageHdr, {
      title: 'Inventory Management',
      subtitle: 'Track stock levels, prices, and purchase records',
      action: h(Btn, { onClick: function() { setShowAdd(true); }, variant: 'success' }, '+ Add Stock')
    }),
    h('div', { style: statStyle },
      h(StatCard, { label: 'Total Items', value: inventory.length, color: C.earth, icon: 'N' }),
      h(StatCard, { label: 'Stock Value', value: fmtKES(stockValue), color: C.grass, icon: '$' }),
      h(StatCard, { label: 'Low Stock', value: inventory.filter(function(i) { return i.qty <= (i.reorderLevel || 0); }).length, sub: 'items', color: C.danger, icon: '!' }),
      h(StatCard, { label: 'Out of Stock', value: inventory.filter(function(i) { return i.qty === 0; }).length, sub: 'items', color: C.danger, icon: 'X' })
    ),
    addModal,
    priceModal,
    h(Card, null,
      h(CardTitle, null, 'Current Inventory'),
      h(Tbl, { cols: invCols, rows: inventory, emptyMsg: 'No inventory items.' })
    ),
    h(Card, { style: { marginTop: 15 } },
      h(CardTitle, null, 'Purchase History'),
      h(Tbl, { cols: purchCols, rows: purchases.slice().reverse(), emptyMsg: 'No purchases yet.' })
    )
  );
}

// ========== INGREDIENTS PAGE ==========

function IngredientsPage() {
  const ctx = useContext(Ctx);
  const ingredients = ctx.ingredients || [];
  const setIngredients = ctx.setIngredients;
  const inventory = ctx.inventory || [];

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = { name: '', category: 'energy', cp: '', me: '', fat: '', fibre: '', ca: '', p: '', lys: '', met: '', antiNote: '' };
  const [form, setForm] = useState(blank);

  function openAdd() { setForm(blank); setEditing(null); setShowForm(true); }
  function openEdit(ing) {
    setForm(Object.assign({}, blank, ing));
    setEditing(ing);
    setShowForm(true);
  }

  function saveIng() {
    if (!form.name) return;
    const newIng = Object.assign({}, form, {
      id: editing ? editing.id : ('ing_' + uid()),
      cp: parseFloat(form.cp) || 0,
      me: parseFloat(form.me) || 0,
      fat: parseFloat(form.fat) || 0,
      fibre: parseFloat(form.fibre) || 0,
      ca: parseFloat(form.ca) || 0,
      p: parseFloat(form.p) || 0,
      lys: parseFloat(form.lys) || 0,
      met: parseFloat(form.met) || 0,
    });
    if (editing) {
      setIngredients(ingredients.map(function(i) { return i.id === editing.id ? newIng : i; }));
    } else {
      setIngredients(ingredients.concat([newIng]));
    }
    setShowForm(false);
    setEditing(null);
    setForm(blank);
  }

  function delIng(ing) {
    if (!window.confirm('Delete ingredient ' + ing.name + '?')) return;
    setIngredients(ingredients.filter(function(i) { return i.id !== ing.id; }));
  }

  function getSellPrice(ingId) {
    const inv = inventory.find(function(x) { return x.id === ingId; });
    if (!inv) return 0;
    if (inv.sellPriceDirect) return inv.sellPriceDirect;
    return Math.round((inv.lastPrice || 0) * (1 + (inv.margin || 20) / 100) * 100) / 100;
  }

  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category', render: function(r) {
      const m = CATEGORY_META.find(function(c) { return c.key === r.category; });
      return h(Badge, { color: m ? m.color : C.muted }, m ? m.label : r.category);
    }},
    { key: 'cp', label: 'CP %' },
    { key: 'me', label: 'ME kcal/kg' },
    { key: 'ca', label: 'Ca %' },
    { key: 'p', label: 'P %' },
    { key: 'price', label: 'Sell Price/kg', render: function(r) {
      const sp = getSellPrice(r.id);
      return h('span', { style: { fontFamily: "'DM Mono',monospace", color: C.grass, fontWeight: 700 } },
        sp ? fmtKES(sp) : '-');
    }},
    { key: 'actions', label: '', render: function(r) {
      return h('div', { style: { display: 'flex', gap: 4 } },
        h(Btn, { size: 'sm', variant: 'secondary', onClick: function() { openEdit(r); } }, 'Edit'),
        h(Btn, { size: 'sm', variant: 'danger', onClick: function() { delIng(r); } }, 'Del')
      );
    }}
  ];

  const formModal = showForm ? h(Modal, {
    title: editing ? 'Edit Ingredient' : 'Add Ingredient',
    onClose: function() { setShowForm(false); setEditing(null); },
    width: 560
  },
    h(Inp, { label: 'Ingredient Name', value: form.name, onChange: function(v) { setForm(Object.assign({}, form, { name: v })); } }),
    h(Sel, {
      label: 'Category',
      value: form.category,
      onChange: function(v) { setForm(Object.assign({}, form, { category: v })); },
      options: CATEGORY_META.map(function(c) { return { value: c.key, label: c.label }; })
    }),
    h('div', {
      style: { background: '#f0f9f4', border: '1px solid ' + C.leaf, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.soil, marginBottom: 12 }
    }, 'Prices are managed in Inventory > Price button'),
    h('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 6, marginTop: 8 } }, 'Nutritional Composition'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 } },
      h(Inp, { label: 'CP %', value: form.cp, onChange: function(v) { setForm(Object.assign({}, form, { cp: v })); }, type: 'number' }),
      h(Inp, { label: 'ME kcal/kg', value: form.me, onChange: function(v) { setForm(Object.assign({}, form, { me: v })); }, type: 'number' }),
      h(Inp, { label: 'Fat %', value: form.fat, onChange: function(v) { setForm(Object.assign({}, form, { fat: v })); }, type: 'number' }),
      h(Inp, { label: 'Fibre %', value: form.fibre, onChange: function(v) { setForm(Object.assign({}, form, { fibre: v })); }, type: 'number' }),
      h(Inp, { label: 'Ca %', value: form.ca, onChange: function(v) { setForm(Object.assign({}, form, { ca: v })); }, type: 'number' }),
      h(Inp, { label: 'P %', value: form.p, onChange: function(v) { setForm(Object.assign({}, form, { p: v })); }, type: 'number' }),
      h(Inp, { label: 'Lys %', value: form.lys, onChange: function(v) { setForm(Object.assign({}, form, { lys: v })); }, type: 'number' }),
      h(Inp, { label: 'Met %', value: form.met, onChange: function(v) { setForm(Object.assign({}, form, { met: v })); }, type: 'number' })
    ),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowForm(false); setEditing(null); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, { onClick: saveIng, variant: 'success' }, editing ? 'Update Ingredient' : 'Add Ingredient')
    )
  ) : null;

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: 'Ingredients',
      subtitle: 'Manage ingredient nutritional profiles',
      action: h(Btn, { onClick: openAdd, variant: 'success' }, '+ Add Ingredient')
    }),
    formModal,
    h(Card, null,
      h(CardTitle, null, 'All Ingredients'),
      h(Tbl, { cols: cols, rows: ingredients, emptyMsg: 'No ingredients defined.' })
    )
  );
}


// ========== CUSTOMERS PAGE ==========

function CustomersPage() {
  const ctx = useContext(Ctx);
  const customers = ctx.customers || [];
  const setCustomers = ctx.setCustomers;

  const [showAdd, setShowAdd] = useState(false);
  const [sel, setSel] = useState(null);
  const blank = { name: '', phone: '', email: '', location: '', notes: '' };
  const [form, setForm] = useState(blank);

  function openAdd() { setForm(blank); setSel(null); setShowAdd(true); }
  function openEdit(c) { setForm(Object.assign({}, blank, c)); setSel(c); setShowAdd(true); }

  function save() {
    if (!form.name) return;
    if (sel) {
      setCustomers(customers.map(function(c) { return c.id === sel.id ? Object.assign({}, c, form) : c; }));
    } else {
      setCustomers(customers.concat([Object.assign({}, form, { id: uid(), createdAt: today(), savedFormulas: [] })]));
    }
    setShowAdd(false); setSel(null);
  }

  function del(c) {
    if (!window.confirm('Delete customer ' + c.name + '?')) return;
    setCustomers(customers.filter(function(x) { return x.id !== c.id; }));
  }

  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email', render: function(r) { return r.email || '-'; } },
    { key: 'location', label: 'Location', render: function(r) { return r.location || '-'; } },
    { key: 'createdAt', label: 'Since' },
    { key: 'actions', label: '', render: function(r) {
      return h('div', { style: { display: 'flex', gap: 4 } },
        h(Btn, { size: 'sm', variant: 'secondary', onClick: function() { openEdit(r); } }, 'Edit'),
        h(Btn, { size: 'sm', variant: 'danger', onClick: function() { del(r); } }, 'Del')
      );
    }}
  ];

  const modal = showAdd ? h(Modal, {
    title: sel ? 'Edit Customer' : 'Add Customer',
    onClose: function() { setShowAdd(false); setSel(null); },
    width: 460
  },
    h(Inp, { label: 'Name *', value: form.name, onChange: function(v) { setForm(Object.assign({}, form, { name: v })); } }),
    h(Inp, { label: 'Phone', value: form.phone, onChange: function(v) { setForm(Object.assign({}, form, { phone: v })); } }),
    h(Inp, { label: 'Email', value: form.email, onChange: function(v) { setForm(Object.assign({}, form, { email: v })); }, type: 'email' }),
    h(Inp, { label: 'Location', value: form.location, onChange: function(v) { setForm(Object.assign({}, form, { location: v })); } }),
    h(Inp, { label: 'Notes', value: form.notes, onChange: function(v) { setForm(Object.assign({}, form, { notes: v })); } }),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowAdd(false); setSel(null); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, { onClick: save, variant: 'success', disabled: !form.name }, sel ? 'Update' : 'Save Customer')
    )
  ) : null;

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: 'Customers',
      subtitle: 'Customer directory and contact records',
      action: h(Btn, { onClick: openAdd, variant: 'success' }, '+ New Customer')
    }),
    modal,
    h(Card, null,
      h(CardTitle, null, 'All Customers'),
      h(Tbl, { cols: cols, rows: customers, emptyMsg: 'No customers yet.' })
    )
  );
}

// ========== FORMULATOR PAGE ==========

function FormulatorPage() {
  const ctx = useContext(Ctx);
  const ingredients = ctx.ingredients || [];
  const inventory = ctx.inventory || [];
  const setInventory = ctx.setInventory;
  const sales = ctx.sales || [];
  const setSales = ctx.setSales;
  const customers = ctx.customers || [];
  const user = ctx.user;

  const animalReqs = getAnimalReqs(db.get('animalReqs'));
  const speciesList = buildSpeciesList(animalReqs);

  const [species, setSpecies] = useState('');
  const [stage, setStage] = useState('');
  const [batchKg, setBatchKg] = useState(100);
  const [selPrice, setSelPrice] = useState('');
  const [custId, setCustId] = useState('');
  const [showSave, setShowSave] = useState(false);
  const [fName, setFName] = useState('');
  const [showSell, setShowSell] = useState(false);
  const [pendingSale, setPendingSale] = useState(null);
  const [toast, setToast] = useState(null);
  const [formula, setFormula] = useState(null);
  const [nutrients, setNutrients] = useState(null);
  const [costPKg, setCostPKg] = useState(0);
  const [solveQuality, setSolveQuality] = useState('');
  const [loading, setLoading] = useState(false);
  const [anfWarnings, setAnfWarnings] = useState([]);
  const [anfExclusions, setAnfExclusions] = useState([]);

  function showT(msg, type) {
    setToast({ msg: msg, type: type || 'success' });
    setTimeout(function() { setToast(null); }, 3500);
  }

  const stages = species ? getStagesForCategory(animalReqs, species) : [];
  const reqs = (species && stage) ? getReqForStage(animalReqs, species, stage) : null;

  const availableIngredients = ingredients.filter(function(i) {
    const inv = inventory.find(function(x) { return x.id === i.id; });
    return inv && inv.qty > 0;
  });

  const [selIngrs, setSelIngrs] = useState(function() {
    return new Set(availableIngredients.map(function(i) { return i.id; }));
  });

  useEffect(function() {
    const available = ingredients.filter(function(i) {
      const inv = inventory.find(function(x) { return x.id === i.id; });
      return inv && inv.qty > 0;
    });
    setSelIngrs(new Set(available.map(function(i) { return i.id; })));
  }, [inventory.length]);

  function getSellPriceForIng(ing) {
    const inv = inventory.find(function(x) { return x.id === ing.id; });
    if (inv) {
      if (inv.sellPriceDirect) return inv.sellPriceDirect;
      return Math.round((inv.lastPrice || 0) * (1 + (inv.margin || 20) / 100) * 100) / 100;
    }
    return ing.sellPrice || ing.lastPrice || ing.price || 0;
  }

  function getActiveWithANF() {
    return ingredients.filter(function(i) { return selIngrs.has(i.id); }).map(function(i) {
      const base = Object.assign({}, i, { price: getSellPriceForIng(i) });
      if (species) {
        const effMax = getEffectiveMaxIncl(base, species);
        if (effMax === 0) return null;
        return Object.assign({}, base, { maxIncl: Math.min(base.maxIncl || 100, effMax) });
      }
      return base;
    }).filter(Boolean);
  }

  function toggleI(id) {
    const n = new Set(selIngrs);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelIngrs(n);
  }

  // Auto-solve effect
  useEffect(function() {
    if (!species || !stage) return;
    setFormula(null); setNutrients(null); setCostPKg(0);
    setAnfWarnings([]); setAnfExclusions([]);
    setLoading(true);
    const timer = setTimeout(function() {
      const ingrs = getActiveWithANF();
      const req = getReqForStage(animalReqs, species, stage);
      if (!req) { setLoading(false); return; }
      if (ingrs.length === 0) {
        setLoading(false);
        showT('No ingredients in stock. Add stock in Inventory first.', 'error');
        return;
      }
      const result = solveBestEffort(ingrs, req);
      if (result && result.formula) {
        const n = calcNutrients(result.formula, ingrs);
        const c = calcCost(result.formula, ingrs);
        setFormula(result.formula);
        setNutrients(n);
        setCostPKg(c);
        setSolveQuality(result.quality || 'optimal');
        const anfResult = checkANFWarnings(result.formula, ingrs, species);
        const solverWarnings = (result.warnings || []).map(function(w) {
          return { ingredient: w.nutrient, factor: 'Nutrient Gap', note: w.note, severity: w.severity };
        });
        setAnfWarnings(anfResult.warnings.concat(solverWarnings));
        setAnfExclusions(anfResult.exclusions);
      } else {
        showT('Could not solve. Check inventory stock.', 'error');
      }
      setLoading(false);
    }, 500);
    return function() { clearTimeout(timer); };
  }, [species, stage, selIngrs.size]);

  function doFormulate() {
    if (!species || !stage) { showT('Select species and stage.', 'error'); return; }
    setLoading(true);
    const ingrs = getActiveWithANF();
    const req = getReqForStage(animalReqs, species, stage);
    setTimeout(function() {
      const result = solveBestEffort(ingrs, req);
      if (result && result.formula) {
        const n = calcNutrients(result.formula, ingrs);
        const c = calcCost(result.formula, ingrs);
        setFormula(result.formula);
        setNutrients(n);
        setCostPKg(c);
        setSolveQuality(result.quality || 'optimal');
        const anfResult = checkANFWarnings(result.formula, ingrs, species);
        const solverWarnings = (result.warnings || []).map(function(w) {
          return { ingredient: w.nutrient, factor: 'Nutrient Gap', note: w.note, severity: w.severity };
        });
        setAnfWarnings(anfResult.warnings.concat(solverWarnings));
        setAnfExclusions(anfResult.exclusions);
      } else {
        showT('Could not solve. Select more ingredients.', 'error');
      }
      setLoading(false);
    }, 300);
  }

  function doSaveFormula() {
    if (!formula || !fName) return;
    const saved = db.get('savedFormulas', []);
    const rec = {
      id: uid(), name: fName, species: species, stage: stage,
      formula: formula, nutrients: nutrients, costPerKg: costPKg,
      customerId: custId || null,
      customerName: (customers.find(function(c) { return c.id === custId; }) || {}).name || '-',
      savedOn: today(), batchKg: batchKg
    };
    db.set('savedFormulas', saved.concat([rec]));
    serverPush('savedFormulas', db.get('savedFormulas', []));
    setShowSave(false); setFName('');
    showT('Formula saved');
  }

  function doInitSale() {
    const ingrs = getActiveWithANF();
    const items = Object.entries(formula).map(function(entry) {
      const id = entry[0], pct = entry[1];
      const ing = ingrs.find(function(x) { return x.id === id; });
      const sp = getSellPriceForIng(ing || { id: id });
      return {
        id: id, name: ing ? ing.name : '',
        pct: pct, qty: (pct / 100) * batchKg,
        pricePerKg: sp
      };
    });
    setPendingSale({
      items: items,
      totalCost: items.reduce(function(s, i) { return s + i.qty * i.pricePerKg; }, 0)
    });
    setShowSell(true);
  }

  function doConfirmSale() {
    if (!pendingSale || !selPrice) return;
    const insuff = pendingSale.items.filter(function(item) {
      const st = inventory.find(function(s) { return s.id === item.id; });
      return !st || st.qty < item.qty;
    });
    if (insuff.length > 0) {
      showT('Insufficient stock: ' + insuff.map(function(i) { return i.name; }).join(', '), 'error');
      return;
    }
    setInventory(inventory.map(function(inv) {
      const used = pendingSale.items.find(function(i) { return i.id === inv.id; });
      if (!used) return inv;
      return Object.assign({}, inv, { qty: Math.max(0, inv.qty - used.qty) });
    }));
    const agreedTotal = parseFloat(selPrice) * batchKg;
    const cust = customers.find(function(c) { return c.id === custId; });
    const newSale = {
      id: uid(), date: today(), species: species, stage: stage, batchKg: batchKg,
      customerId: custId || null,
      customerName: cust ? cust.name : 'Walk-in',
      customer: cust ? cust.name : 'Walk-in',
      product: species + ' - ' + stage + ' (' + batchKg + 'kg)',
      cost: pendingSale.totalCost, total: agreedTotal,
      totalRevenue: agreedTotal, totalCost: pendingSale.totalCost,
      profit: agreedTotal - pendingSale.totalCost,
      sellPricePerKg: parseFloat(selPrice),
      items: pendingSale.items
    };
    setSales(sales.concat([newSale]));
    const ledger = db.get('stockLedger', []);
    const entry = {
      id: uid(), type: 'SALE', date: today(), product: newSale.product,
      qty: batchKg, total: agreedTotal, costPerKg: costPKg,
      by: user ? user.name : ''
    };
    db.set('stockLedger', ledger.concat([entry]));
    serverPush('stockLedger', ledger.concat([entry]));
    setShowSell(false); setPendingSale(null); setSelPrice('');
    showT('Sale recorded. Stock updated.');
  }

  function getANFStatus(id) {
    if (!species) return 'neutral';
    const lim = getANFLimit(id, species);
    if (!lim) return 'neutral';
    if (lim.maxPct === 0) return 'excluded';
    if (lim.maxPct <= 5) return 'caution';
    return 'neutral';
  }

  function anfStatusStyle(s) {
    if (s === 'excluded') return { border: '2px solid ' + C.danger, background: '#fff0f0', opacity: 0.7 };
    if (s === 'caution') return { border: '2px solid ' + C.harvest, background: '#fffbf0' };
    return { border: '1px solid ' + C.border, background: 'white' };
  }

  const formulaRows = formula ? Object.entries(formula)
    .sort(function(a, b) { return b[1] - a[1]; })
    .map(function(entry, i, arr) {
      const id = entry[0], pct = entry[1];
      const ing = ingredients.find(function(x) { return x.id === id; });
      const sp = getSellPriceForIng(ing || { id: id });
      const lastIdx = arr.length - 1;
      const dpct = (i === lastIdx)
        ? Math.round((100 - arr.slice(0, -1).reduce(function(s, e) { return s + Math.round(e[1] * 10) / 10; }, 0)) * 10) / 10
        : Math.round(pct * 10) / 10;
      const qty = (dpct / 100) * batchKg;
      return {
        id: id, name: ing ? ing.name : id,
        pct: pct, dpct: dpct, qty: qty,
        sellPricePerKg: sp, sellCost: qty * sp
      };
    }) : [];

  function NutRow(p) {
    if (p.val === undefined || p.val === null) return null;
    const v = Number(p.val).toFixed(p.unit === 'kcal/kg' ? 0 : 2);
    const inRange = !p.req || p.val >= p.req[0] * 0.97;
    const over = p.req && p.val > p.req[1] * 1.05;
    const color = over ? C.warning : inRange ? C.grass : C.danger;
    return h('div', {
      style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid ' + C.border, fontSize: 12 }
    },
      h('span', { style: { color: C.muted } }, p.label),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        p.req ? h('span', { style: { fontSize: 10, color: C.muted } }, p.req[0] + '-' + p.req[1] + p.unit) : null,
        h('span', {
          style: { fontFamily: "'DM Mono',monospace", fontWeight: 700, color: color }
        }, v + ' ' + p.unit)
      )
    );
  }

  // Ingredient selection cards
  const ingCards = ingredients.map(function(ing) {
    const inv = inventory.find(function(x) { return x.id === ing.id; });
    const hasStock = inv && inv.qty > 0;
    const sel = selIngrs.has(ing.id);
    const anfStat = getANFStatus(ing.id);
    const baseStyle = sel
      ? { border: '2px solid ' + C.grass, background: '#f0f9f4' }
      : Object.assign({}, anfStatusStyle(anfStat), { opacity: hasStock ? 1 : 0.45 });
    const cardStyle = Object.assign({
      padding: '7px 9px', borderRadius: 8, cursor: 'pointer', userSelect: 'none',
      transition: 'all 0.15s', position: 'relative'
    }, baseStyle);
    const indicator = sel ? h('div', {
      style: { position: 'absolute', top: 3, right: 5, fontSize: 10, color: C.grass, fontWeight: 700 }
    }, 'OK') : anfStat === 'excluded' ? h('div', {
      style: { position: 'absolute', top: 3, right: 5, fontSize: 10, color: C.danger }
    }, 'X') : anfStat === 'caution' ? h('div', {
      style: { position: 'absolute', top: 3, right: 5, fontSize: 10 }
    }, '!') : null;
    const stockText = hasStock
      ? fmt(inv.qty) + ' kg * KES ' + getSellPriceForIng(ing) + '/kg'
      : 'No stock';
    return h('div', {
      key: ing.id,
      onClick: function() { toggleI(ing.id); },
      style: cardStyle
    },
      indicator,
      h('div', { style: { fontSize: 11, fontWeight: 600, color: C.earth, lineHeight: 1.3 } }, ing.name),
      h('div', { style: { fontSize: 10, color: C.muted, marginTop: 2 } }, stockText)
    );
  });

  const saveModal = showSave ? h(Modal, {
    title: 'Save Formula',
    onClose: function() { setShowSave(false); },
    width: 400
  },
    h(Inp, { label: 'Formula Name', value: fName, onChange: setFName, placeholder: 'e.g. Broiler Starter March' }),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 } },
      h(Btn, { onClick: function() { setShowSave(false); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, { onClick: doSaveFormula, variant: 'success', disabled: !fName }, 'Save')
    )
  ) : null;

  const sellModal = (showSell && pendingSale) ? h(Modal, {
    title: 'Confirm Sale',
    onClose: function() { setShowSell(false); },
    width: 480
  },
    h('div', {
      style: { background: C.parchment, borderRadius: 8, padding: '11px 14px', marginBottom: 14 }
    },
      h('div', {
        style: { fontWeight: 700, color: C.earth, marginBottom: 6 }
      }, species + ' - ' + stage + ' (' + batchKg + 'kg)'),
      h('div', { style: { fontSize: 13, color: C.muted } },
        'Cost of ingredients: ',
        h('strong', { style: { color: C.danger } }, 'KES ' + pendingSale.totalCost.toFixed(2))
      )
    ),
    h(Inp, {
      label: 'Agreed Sell Price (KES/kg)',
      value: selPrice,
      onChange: setSelPrice,
      type: 'number',
      placeholder: 'e.g. 65'
    }),
    selPrice ? h('div', {
      style: { background: '#f0f9f4', borderRadius: 8, padding: '10px 14px', fontSize: 13 }
    },
      h('div', null,
        'Total Revenue: ',
        h('strong', { style: { color: C.grass } }, 'KES ' + (parseFloat(selPrice) * batchKg).toFixed(2))
      ),
      h('div', null,
        'Profit: ',
        h('strong', {
          style: { color: (parseFloat(selPrice) * batchKg - pendingSale.totalCost) > -1 ? C.grass : C.danger }
        }, 'KES ' + (parseFloat(selPrice) * batchKg - pendingSale.totalCost).toFixed(2))
      )
    ) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowSell(false); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, {
        onClick: doConfirmSale,
        variant: 'success',
        disabled: !selPrice || !Number(selPrice)
      }, 'Customer Agreed - Record Sale')
    )
  ) : null;

  // Quality badge
  const qualityLabels = {
    optimal: 'Optimal solution',
    good: 'Good solution',
    relaxed: 'Approximated',
    partial: 'Partial',
    fallback: 'Fallback mix'
  };
  const qualityColors = {
    optimal: { bg: '#f0f9f4', color: C.grass, border: C.leaf },
    good: { bg: '#f0f9f4', color: C.grass, border: C.leaf },
    relaxed: { bg: '#fff8e6', color: C.savanna, border: C.harvest },
    partial: { bg: '#fff8e6', color: C.savanna, border: C.harvest },
    fallback: { bg: '#fff8e6', color: C.savanna, border: C.harvest }
  };

  const qBadge = (formula && solveQuality) ? h('span', {
    style: Object.assign({
      fontSize: 11, padding: '3px 10px', borderRadius: 12
    }, {
      background: qualityColors[solveQuality].bg,
      color: qualityColors[solveQuality].color,
      border: '1px solid ' + qualityColors[solveQuality].border
    })
  }, qualityLabels[solveQuality] || solveQuality) : null;

  // ANF warnings display
  const anfDisplay = (anfWarnings.length > 0 || anfExclusions.length > 0) ? h(Card, { style: { marginBottom: 12 } },
    h('div', { style: { padding: '10px 14px' } },
      anfExclusions.map(function(e, i) {
        return h('div', {
          key: 'ex' + i,
          style: { display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 7, background: '#fde8e8', border: '1px solid ' + C.danger + '44', marginBottom: 5 }
        },
          h('span', null, 'X'),
          h('div', null,
            h('div', { style: { fontWeight: 700, fontSize: 12, color: C.danger } }, e.ingredient + ' EXCLUDED - ' + e.factor),
            h('div', { style: { fontSize: 11, color: C.muted } }, e.note)
          )
        );
      }),
      anfWarnings.map(function(w, i) {
        const sev = w.severity === 'danger';
        return h('div', {
          key: 'w' + i,
          style: {
            display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 7, marginBottom: 4,
            background: sev ? '#fde8e8' : '#fff8e6',
            border: '1px solid ' + (sev ? C.danger : C.harvest) + '44'
          }
        },
          h('span', null, sev ? 'X' : '!'),
          h('div', null,
            h('div', {
              style: { fontWeight: 700, fontSize: 12, color: sev ? C.danger : C.savanna }
            }, w.ingredient + (w.factor ? ' - ' + w.factor : '') + (w.current ? ' at ' + w.current + '% (limit: ' + w.maxPct + '%)' : '')),
            h('div', { style: { fontSize: 11, color: C.muted } }, w.note)
          )
        );
      })
    )
  ) : null;

  const formulaCard = (formula && nutrients) ? h(Card, { style: { marginBottom: 12 } },
    h('div', {
      style: { background: 'linear-gradient(135deg,' + C.earth + ',' + C.soil + ')', padding: '13px 17px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
    },
      h('div', null,
        h('div', { style: { fontFamily: "'Playfair Display',serif", fontSize: 15, color: 'white', fontWeight: 700 } }, species + ' - ' + stage),
        h('div', { style: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 } }, batchKg + 'kg batch')
      ),
      h('div', { style: { textAlign: 'right' } },
        h('div', { style: { fontSize: 22, fontFamily: "'Playfair Display',serif", fontWeight: 900, color: C.harvest } }, 'KES ' + costPKg.toFixed(2) + '/kg'),
        h('div', { style: { fontSize: 11, color: 'rgba(255,255,255,0.6)' } }, 'Total: KES ' + (costPKg * batchKg).toFixed(0))
      )
    ),
    h(Tbl, {
      cols: [
        { key: 'name', label: 'Ingredient' },
        { key: 'dpct', label: '%', render: function(r) { return r.dpct + '%'; } },
        { key: 'qty', label: 'Qty (kg)', render: function(r) { return r.qty.toFixed(1); } },
        { key: 'sellPricePerKg', label: 'Sell KES/kg', render: function(r) {
          return h('span', { style: { color: C.grass, fontWeight: 700 } }, 'KES ' + r.sellPricePerKg);
        }},
        { key: 'sellCost', label: 'Sell Cost', render: function(r) { return 'KES ' + r.sellCost.toFixed(0); } },
        { key: 'stock', label: 'In Stock', render: function(r) {
          const inv = inventory.find(function(x) { return x.id === r.id; });
          const ok = inv && inv.qty >= r.qty;
          return h(Badge, { color: ok ? C.grass : C.danger }, ok ? 'OK' : 'Low');
        }}
      ],
      rows: formulaRows,
      emptyMsg: ''
    }),
    h('div', {
      style: { padding: '10px 14px', borderTop: '1px solid ' + C.border, display: 'flex', gap: 8, justifyContent: 'flex-end' }
    },
      h(Btn, { onClick: function() { setShowSave(true); }, variant: 'secondary', size: 'sm' }, 'Save Formula'),
      h(Btn, { onClick: doInitSale, variant: 'success', size: 'sm' }, 'Sell This Batch')
    )
  ) : null;

  const nutrientCard = (formula && nutrients && reqs) ? h(Card, null,
    h(CardTitle, null, 'Nutritional Analysis'),
    h('div', { style: { padding: '0 14px 14px' } },
      h(NutRow, { label: 'Crude Protein', val: nutrients.cp, req: reqs.cp, unit: '%' }),
      h(NutRow, { label: 'Metabolisable Energy', val: nutrients.me, req: reqs.me, unit: 'kcal/kg' }),
      h(NutRow, { label: 'Crude Fat', val: nutrients.fat, req: reqs.fat, unit: '%' }),
      h(NutRow, { label: 'Crude Fibre', val: nutrients.fibre, req: reqs.fibre, unit: '%' }),
      h(NutRow, { label: 'Calcium', val: nutrients.ca, req: reqs.ca, unit: '%' }),
      h(NutRow, { label: 'Phosphorus', val: nutrients.p, req: reqs.p, unit: '%' }),
      h(NutRow, { label: 'Lysine', val: nutrients.lys, req: reqs.lys, unit: '%' }),
      h(NutRow, { label: 'Methionine', val: nutrients.met, req: reqs.met, unit: '%' })
    )
  ) : null;

  return h('div', { style: { padding: '0 26px 26px' } },
    toast ? h(Toast, { msg: toast.msg, type: toast.type }) : null,
    saveModal,
    sellModal,
    h(PageHdr, {
      title: 'Feed Formulator',
      subtitle: 'Auto-optimising least-cost formulation with ANF awareness'
    }),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 } },
      // Left column
      h('div', null,
        h(Card, { style: { marginBottom: 12 } },
          h(CardTitle, null, '1 - Animal'),
          h('div', {
            style: { padding: '0 14px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }
          },
            h(Sel, {
              label: 'Species',
              value: species,
              onChange: function(v) { setSpecies(v); setStage(''); setFormula(null); },
              options: [{ value: '', label: 'Select species...' }].concat(
                speciesList.map(function(s) { return { value: s.value, label: s.icon + ' ' + s.label }; })
              )
            }),
            h(Sel, {
              label: 'Stage',
              value: stage,
              onChange: function(v) { setStage(v); setFormula(null); },
              options: [{ value: '', label: 'Select stage...' }].concat(
                stages.map(function(s) { return { value: s, label: s }; })
              ),
              disabled: !species
            }),
            h(Inp, { label: 'Batch Size (kg)', value: batchKg, onChange: function(v) { setBatchKg(parseFloat(v) || 100); }, type: 'number' }),
            h(Sel, {
              label: 'Customer (optional)',
              value: custId,
              onChange: setCustId,
              options: [{ value: '', label: 'Walk-in customer' }].concat(
                customers.map(function(c) { return { value: c.id, label: c.name }; })
              )
            })
          )
        ),
        h(Card, { style: { marginBottom: 12 } },
          h(CardTitle, null, '2 - Ingredients (' + selIngrs.size + ' of ' + availableIngredients.length + ' in stock)'),
          h('div', { style: { padding: '0 12px 12px' } },
            h('div', { style: { display: 'flex', gap: 6, marginBottom: 8 } },
              h(Btn, {
                size: 'sm', variant: 'secondary',
                onClick: function() {
                  setSelIngrs(new Set(availableIngredients.map(function(i) { return i.id; })));
                }
              }, 'Select All In-Stock'),
              h(Btn, {
                size: 'sm', variant: 'secondary',
                onClick: function() { setSelIngrs(new Set()); }
              }, 'Clear All')
            ),
            h('div', {
              style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 6 }
            }, ingCards)
          )
        ),
        formula ? h(Card, null,
          h(CardTitle, null, '3 - Sell Prices (from Inventory)'),
          h('div', { style: { padding: '0 12px 12px' } },
            h('div', {
              style: { background: '#f0f9f4', border: '1px solid ' + C.leaf, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.soil, marginBottom: 10 }
            }, 'Sell prices are set in Inventory > Price button. To change a price, update it there.'),
            formulaRows.map(function(row) {
              return h('div', {
                key: row.id,
                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid ' + C.border }
              },
                h('span', { style: { fontSize: 12, color: C.earth, fontWeight: 600 } }, row.name),
                h('span', {
                  style: { fontSize: 12, fontFamily: "'DM Mono',monospace", color: C.grass, fontWeight: 700 }
                }, 'KES ' + row.sellPricePerKg + '/kg')
              );
            })
          )
        ) : null
      ),
      // Right column
      h('div', null,
        h(Card, { style: { marginBottom: 12 } },
          h('div', { style: { padding: '12px 14px' } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
              h(Btn, {
                onClick: doFormulate,
                variant: 'success',
                disabled: loading || !species || !stage
              }, loading ? 'Solving...' : 'Formulate'),
              qBadge
            ),
            !species ? h('div', { style: { fontSize: 12, color: C.muted } }, 'Select species and stage - formula auto-generates.') : null,
            (species && stage && !formula && !loading) ? h('div', { style: { fontSize: 12, color: C.muted } }, 'Auto-solving...') : null,
            loading ? h('div', {
              style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.muted }
            }, 'Finding optimal least-cost formula...') : null
          )
        ),
        anfDisplay,
        formulaCard,
        nutrientCard
      )
    )
  );
}


// ========== SALES PAGE ==========

function SalesPage() {
  const ctx = useContext(Ctx);
  const sales = ctx.sales || [];
  const setSales = ctx.setSales;
  const user = ctx.user;

  const [toast, setToast] = useState(null);
  function showT(msg, type) {
    setToast({ msg: msg, type: type || 'success' });
    setTimeout(function() { setToast(null); }, 3500);
  }

  const rev = sales.reduce(function(s, x) { return s + (x.total || x.totalRevenue || 0); }, 0);
  const cost = sales.reduce(function(s, x) { return s + (x.cost || x.totalCost || 0); }, 0);
  const profit = rev - cost;

  function deleteSale(sale) {
    if (!user || user.role !== 'admin') {
      showT('Only admin can delete sales.', 'error');
      return;
    }
    if (!window.confirm('Delete this sale?')) return;
    setSales(sales.filter(function(s) { return s.id !== sale.id; }));
    const ledger = db.get('stockLedger', []);
    const entry = {
      id: uid(), type: 'DELETE_SALE', date: today(),
      product: sale.product || '',
      qty: sale.batchKg, total: sale.total || sale.totalRevenue || 0,
      deletedRecord: JSON.stringify(sale),
      by: user.name, at: new Date().toISOString()
    };
    db.set('stockLedger', ledger.concat([entry]));
    serverPush('stockLedger', ledger.concat([entry]));
    showT('Sale deleted and logged.');
  }

  const cols = [
    { key: 'date', label: 'Date' },
    { key: 'customer', label: 'Customer', render: function(r) { return r.customerName || r.customer || 'Walk-in'; } },
    { key: 'product', label: 'Product' },
    { key: 'batchKg', label: 'Batch', render: function(r) { return r.batchKg + ' kg'; } },
    { key: 'cost', label: 'Cost', render: function(r) { return fmtKES(r.cost || r.totalCost || 0); } },
    { key: 'total', label: 'Revenue', render: function(r) {
      return h('span', { style: { fontWeight: 700, color: C.grass } }, fmtKES(r.total || r.totalRevenue || 0));
    }},
    { key: 'profit', label: 'Profit', render: function(r) {
      const p = r.profit || 0;
      return h('span', { style: { color: p > -1 ? C.grass : C.danger, fontWeight: 700 } }, fmtKES(p));
    }},
    user && user.role === 'admin' ? { key: 'del', label: '', render: function(r) {
      return h(Btn, { size: 'sm', variant: 'danger', onClick: function() { deleteSale(r); } }, 'Del');
    }} : null
  ].filter(Boolean);

  const profitSub = rev ? ((profit / rev) * 100).toFixed(1) + '% margin' : '';

  return h('div', { style: { padding: '0 26px 26px' } },
    toast ? h(Toast, { msg: toast.msg, type: toast.type }) : null,
    h(PageHdr, { title: 'Sales Records', subtitle: 'All confirmed feed sales' }),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 } },
      h(StatCard, { label: 'Total Sales', value: sales.length, icon: 'S', color: C.earth }),
      h(StatCard, { label: 'Total Revenue', value: fmtKES(rev), icon: '$', color: C.grass }),
      h(StatCard, { label: 'Total Cost', value: fmtKES(cost), icon: 'C', color: C.warning }),
      h(StatCard, { label: 'Total Profit', value: fmtKES(profit), sub: profitSub, icon: 'P', color: profit > -1 ? C.grass : C.danger })
    ),
    h(Card, null,
      h(CardTitle, null, 'All Sales'),
      h(Tbl, { cols: cols, rows: sales.slice().reverse(), emptyMsg: 'No sales yet.' })
    )
  );
}

// ========== REPORTS PAGE ==========

function ReportsPage() {
  const ctx = useContext(Ctx);
  const sales = ctx.sales || [];
  const inventory = ctx.inventory || [];
  const purchases = ctx.purchases || [];

  const [period, setPeriod] = useState('30');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(period));
  const filtered = sales.filter(function(s) { return new Date(s.date) >= cutoff; });
  const rev = filtered.reduce(function(s, x) { return s + (x.total || x.totalRevenue || 0); }, 0);
  const cost = filtered.reduce(function(s, x) { return s + (x.cost || x.totalCost || 0); }, 0);
  const profit = rev - cost;

  // Top selling products
  const productCounts = {};
  filtered.forEach(function(s) {
    const key = s.product || 'Unknown';
    productCounts[key] = (productCounts[key] || 0) + (s.total || s.totalRevenue || 0);
  });
  const topProducts = Object.entries(productCounts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5);

  // Top customers
  const customerCounts = {};
  filtered.forEach(function(s) {
    const key = s.customerName || s.customer || 'Walk-in';
    customerCounts[key] = (customerCounts[key] || 0) + (s.total || s.totalRevenue || 0);
  });
  const topCustomers = Object.entries(customerCounts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5);

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: 'Reports & Analytics',
      subtitle: 'Business performance insights',
      action: h(Sel, {
        value: period,
        onChange: setPeriod,
        options: [
          { value: '7', label: 'Last 7 days' },
          { value: '30', label: 'Last 30 days' },
          { value: '90', label: 'Last 90 days' },
          { value: '365', label: 'Last year' }
        ]
      })
    }),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 } },
      h(StatCard, { label: 'Sales', value: filtered.length, color: C.earth, icon: 'S' }),
      h(StatCard, { label: 'Revenue', value: fmtKES(rev), color: C.grass, icon: '$' }),
      h(StatCard, { label: 'Cost', value: fmtKES(cost), color: C.warning, icon: 'C' }),
      h(StatCard, { label: 'Profit', value: fmtKES(profit), color: profit > -1 ? C.grass : C.danger, icon: 'P' })
    ),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 } },
      h(Card, null,
        h(CardTitle, null, 'Top Products by Revenue'),
        h('div', { style: { padding: 14 } },
          topProducts.length === 0
            ? h('div', { style: { textAlign: 'center', padding: 20, color: C.muted } }, 'No data for this period')
            : topProducts.map(function(p) {
                return h('div', {
                  key: p[0],
                  style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + C.border }
                },
                  h('span', { style: { fontSize: 12, color: C.earth, fontWeight: 600 } }, p[0]),
                  h('span', { style: { fontSize: 12, color: C.grass, fontWeight: 700 } }, fmtKES(p[1]))
                );
              })
        )
      ),
      h(Card, null,
        h(CardTitle, null, 'Top Customers'),
        h('div', { style: { padding: 14 } },
          topCustomers.length === 0
            ? h('div', { style: { textAlign: 'center', padding: 20, color: C.muted } }, 'No data for this period')
            : topCustomers.map(function(c) {
                return h('div', {
                  key: c[0],
                  style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + C.border }
                },
                  h('span', { style: { fontSize: 12, color: C.earth, fontWeight: 600 } }, c[0]),
                  h('span', { style: { fontSize: 12, color: C.grass, fontWeight: 700 } }, fmtKES(c[1]))
                );
              })
        )
      )
    )
  );
}

// ========== FEEDING GUIDE PAGE ==========

function FeedingGuidePage() {
  const [species, setSpecies] = useState('');
  const speciesOptions = Object.keys(FEEDING_QTY);
  const stages = (species && FEEDING_QTY[species]) ? Object.entries(FEEDING_QTY[species]) : [];

  const selOptions = [{ value: '', label: 'Choose a species...' }].concat(
    speciesOptions.map(function(s) {
      return { value: s, label: (CATEGORY_ICONS[s] || '*') + ' ' + s };
    })
  );

  const stageCards = stages.map(function(entry) {
    const sName = entry[0];
    const info = entry[1];
    const items = [
      { label: 'Daily Ration', val: info.qty },
      { label: 'Water', val: info.water },
      { label: 'Meals/Day', val: info.meals }
    ];
    return h(Card, { key: sName },
      h('div', {
        style: { background: 'linear-gradient(135deg,' + C.earth + ',' + C.clay + ')', padding: '11px 15px' }
      },
        h('div', {
          style: { fontFamily: "'Playfair Display',serif", fontSize: 14, fontWeight: 700, color: 'white' }
        }, sName)
      ),
      h('div', { style: { padding: 13 } },
        items.map(function(x, i) {
          return h('div', {
            key: i,
            style: { display: 'flex', gap: 9, marginBottom: 9, alignItems: 'flex-start' }
          },
            h('div', null,
              h('div', {
                style: { fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1, color: C.muted }
              }, x.label),
              h('div', {
                style: { fontSize: 13, fontWeight: 600, color: C.earth }
              }, x.val)
            )
          );
        }),
        info.notes ? h('div', {
          style: { background: C.parchment, borderRadius: 6, padding: '7px 9px', fontSize: 11, color: C.soil, borderLeft: '3px solid ' + C.savanna, lineHeight: 1.5, marginTop: 8 }
        }, info.notes) : null
      )
    );
  });

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: 'Feeding Quantity Guide',
      subtitle: 'Recommended daily feed amounts per species and production stage'
    }),
    h(Card, { style: { marginBottom: 15 } },
      h('div', { style: { padding: 15 } },
        h(Sel, {
          label: 'Select Species',
          value: species,
          onChange: setSpecies,
          options: selOptions
        })
      )
    ),
    (species && stages.length > 0) ? h('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 13 }
    }, stageCards) : null,
    !species ? h('div', {
      style: { textAlign: 'center', padding: '60px 20px', color: C.muted }
    },
      h('div', {
        style: { fontFamily: "'Playfair Display',serif", fontSize: 19, color: C.clay, marginBottom: 7 }
      }, 'Select a Species'),
      h('div', {
        style: { fontSize: 14 }
      }, 'Choose a species above to see daily feeding recommendations')
    ) : null
  );
}

// ========== EDUCATION PAGE ==========

function EducationPage() {
  const [filter, setFilter] = useState('all');
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(false);

  const cats = [
    { key: 'all', label: 'All' },
    { key: 'nutrition', label: 'Nutrition' },
    { key: 'cost', label: 'Cost' },
    { key: 'storage', label: 'Storage' },
    { key: 'health', label: 'Health' },
    { key: 'water', label: 'Water' },
    { key: 'seasons', label: 'Seasons' },
    { key: 'records', label: 'Records' }
  ];

  const tips = TIPS.filter(function(t) { return filter === 'all' || t.cat === filter; });

  useEffect(function() {
    if (!auto) return;
    const t = setInterval(function() {
      setIdx(function(c) { return (c + 1) % Math.max(tips.length, 1); });
    }, 8000);
    return function() { clearInterval(t); };
  }, [auto, tips.length]);

  const tip = tips.length > 0 ? tips[idx % tips.length] : null;

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: 'Education Screen',
      subtitle: 'Display tips on shop screens for waiting farmers',
      action: h(Btn, {
        onClick: function() { setAuto(!auto); },
        variant: auto ? 'success' : 'secondary'
      }, auto ? 'Pause' : 'Auto-Play')
    }),
    h('div', { style: { marginBottom: 14, display: 'flex', gap: 6, flexWrap: 'wrap' } },
      cats.map(function(c) {
        return h(Btn, {
          key: c.key,
          size: 'sm',
          variant: filter === c.key ? 'primary' : 'secondary',
          onClick: function() { setFilter(c.key); setIdx(0); }
        }, c.label);
      })
    ),
    tip ? h(Card, { style: { marginBottom: 18, border: '2px solid ' + C.savanna } },
      h('div', {
        style: {
          background: 'linear-gradient(135deg,' + C.earth + ',' + C.clay + ')',
          padding: '38px 46px', textAlign: 'center', minHeight: 260,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }
      },
        h(Badge, { color: C.harvest }, tip.tag),
        h('div', {
          style: {
            fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 900,
            color: 'white', margin: '13px 0 14px', lineHeight: 1.2, maxWidth: 560
          }
        }, tip.title),
        h('div', {
          style: { fontSize: 15, color: 'rgba(255,255,255,0.75)', maxWidth: 520, lineHeight: 1.7 }
        }, tip.body)
      ),
      h('div', {
        style: { padding: '11px 19px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.parchment }
      },
        h(Btn, {
          onClick: function() { setIdx(function(c) { return (c - 1 + tips.length) % tips.length; }); },
          variant: 'secondary',
          size: 'sm'
        }, 'Previous'),
        h('span', {
          style: { fontFamily: "'DM Mono',monospace", fontSize: 11, color: C.muted }
        }, (idx % tips.length + 1) + ' / ' + tips.length),
        h(Btn, {
          onClick: function() { setIdx(function(c) { return (c + 1) % tips.length; }); },
          variant: 'secondary',
          size: 'sm'
        }, 'Next')
      )
    ) : h('div', {
      style: { textAlign: 'center', padding: 40, color: C.muted }
    }, 'No tips in this category')
  );
}


// ========== NUTRITION PAGE (Admin) ==========

function NutritionPage() {
  const [reqs, setReqs] = useState(function() { return getAnimalReqs(db.get('animalReqs')); });
  const [showForm, setShowForm] = useState(false);
  const [editReq, setEditReq] = useState(null);
  const [filterCat, setFilterCat] = useState('');

  const blank = {
    category: '', stage: '',
    cp: [0, 0], me: [0, 0], fat: [0, 0], fibre: [0, 0],
    ca: [0, 0], p: [0, 0], lys: [0, 0], met: [0, 0]
  };
  const [form, setForm] = useState(blank);

  function saveAll(newReqs) {
    setReqs(newReqs);
    db.set('animalReqs', newReqs);
    serverPush('animalReqs', newReqs);
  }

  function openAdd() { setForm(blank); setEditReq(null); setShowForm(true); }
  function openEdit(r) { setForm(Object.assign({}, r)); setEditReq(r); setShowForm(true); }

  function saveReq() {
    if (!form.category || !form.stage) return;
    const newReq = Object.assign({}, form, { id: editReq ? editReq.id : 'ar_' + uid() });
    if (editReq) {
      saveAll(reqs.map(function(r) { return r.id === editReq.id ? newReq : r; }));
    } else {
      saveAll(reqs.concat([newReq]));
    }
    setShowForm(false); setEditReq(null);
  }

  function delReq(r) {
    if (!window.confirm('Delete requirement for ' + r.category + ' / ' + r.stage + '?')) return;
    saveAll(reqs.filter(function(x) { return x.id !== r.id; }));
  }

  function resetDefaults() {
    if (!window.confirm('Reset all animal requirements to defaults?')) return;
    saveAll(SEED_ANIMAL_REQS);
  }

  const categories = Array.from(new Set(reqs.map(function(r) { return r.category; })));
  const filteredReqs = filterCat ? reqs.filter(function(r) { return r.category === filterCat; }) : reqs;

  const rangeField = function(key, label) {
    return h('div', { style: { marginBottom: 8 } },
      h('div', {
        style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 3 }
      }, label),
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h('input', {
          type: 'number',
          value: form[key][0],
          onChange: function(e) {
            const v = parseFloat(e.target.value) || 0;
            setForm(Object.assign({}, form, { [key]: [v, form[key][1]] }));
          },
          style: { width: '100%', padding: '6px 9px', border: '1px solid ' + C.border, borderRadius: 6, fontSize: 12 }
        }),
        h('span', { style: { color: C.muted, fontSize: 12 } }, '-'),
        h('input', {
          type: 'number',
          value: form[key][1],
          onChange: function(e) {
            const v = parseFloat(e.target.value) || 0;
            setForm(Object.assign({}, form, { [key]: [form[key][0], v] }));
          },
          style: { width: '100%', padding: '6px 9px', border: '1px solid ' + C.border, borderRadius: 6, fontSize: 12 }
        })
      )
    );
  };

  const formModal = showForm ? h(Modal, {
    title: editReq ? 'Edit Requirement' : 'Add Animal Requirement',
    onClose: function() { setShowForm(false); setEditReq(null); },
    width: 560
  },
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
      h(Inp, { label: 'Category', value: form.category, onChange: function(v) { setForm(Object.assign({}, form, { category: v })); }, placeholder: 'e.g. Poultry (Broiler)' }),
      h(Inp, { label: 'Stage', value: form.stage, onChange: function(v) { setForm(Object.assign({}, form, { stage: v })); }, placeholder: 'e.g. Starter (0-21 days)' })
    ),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginTop: 10 } },
      rangeField('cp', 'CP % (min-max)'),
      rangeField('me', 'ME kcal/kg'),
      rangeField('fat', 'Fat %'),
      rangeField('fibre', 'Fibre %'),
      rangeField('ca', 'Ca %'),
      rangeField('p', 'P %'),
      rangeField('lys', 'Lys %'),
      rangeField('met', 'Met %')
    ),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowForm(false); setEditReq(null); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, { onClick: saveReq, variant: 'success', disabled: !form.category || !form.stage },
        editReq ? 'Update Requirements' : 'Add Animal Stage')
    )
  ) : null;

  const cols = [
    { key: 'category', label: 'Category' },
    { key: 'stage', label: 'Stage' },
    { key: 'cp', label: 'CP %', render: function(r) { return r.cp[0] + '-' + r.cp[1]; } },
    { key: 'me', label: 'ME', render: function(r) { return r.me[0] + '-' + r.me[1]; } },
    { key: 'ca', label: 'Ca %', render: function(r) { return r.ca[0] + '-' + r.ca[1]; } },
    { key: 'p', label: 'P %', render: function(r) { return r.p[0] + '-' + r.p[1]; } },
    { key: 'actions', label: '', render: function(r) {
      return h('div', { style: { display: 'flex', gap: 4 } },
        h(Btn, { size: 'sm', variant: 'secondary', onClick: function() { openEdit(r); } }, 'Edit'),
        h(Btn, { size: 'sm', variant: 'danger', onClick: function() { delReq(r); } }, 'Del')
      );
    }}
  ];

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: 'Nutritional Requirements',
      subtitle: 'Reference: NRC 2012, Evonik Amino Dat, ILRI East Africa',
      action: h('div', { style: { display: 'flex', gap: 6 } },
        h(Btn, { onClick: resetDefaults, variant: 'secondary', size: 'sm' }, 'Reset to Defaults'),
        h(Btn, { onClick: openAdd, variant: 'success', size: 'sm' }, '+ Add Stage')
      )
    }),
    formModal,
    h('div', { style: { marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' } },
      h('span', { style: { fontSize: 12, color: C.muted } }, 'Filter by species:'),
      h(Btn, { size: 'sm', variant: filterCat === '' ? 'primary' : 'secondary', onClick: function() { setFilterCat(''); } }, 'All'),
      categories.map(function(c) {
        return h(Btn, {
          key: c, size: 'sm',
          variant: filterCat === c ? 'primary' : 'secondary',
          onClick: function() { setFilterCat(c); }
        }, c);
      })
    ),
    h(Card, null,
      h(CardTitle, null, 'Nutritional Targets'),
      h(Tbl, { cols: cols, rows: filteredReqs, emptyMsg: 'No requirements defined.' })
    )
  );
}

// ========== USERS PAGE (Admin) ==========

function UsersPage(props) {
  const currentUser = props.currentUser;
  const [users, setUsersState] = useState(function() { return db.get('users', SEED_USERS); });
  const [toast, setToast] = useState(null);

  function showT(msg, type) {
    setToast({ msg: msg, type: type || 'success' });
    setTimeout(function() { setToast(null); }, 3500);
  }

  useEffect(function() {
    const key = import.meta.env && import.meta.env.VITE_SYNC_KEY || 'wamifugo2024';
    fetch('/api/data/users', { headers: { 'X-Sync-Key': key } })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.data && d.data.length) {
          db.set('users', d.data);
          setUsersState(d.data);
        }
      })
      .catch(function() {});
  }, []);

  function saveUsers(next) {
    setUsersState(next);
    db.set('users', next);
    serverPush('users', next);
  }

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', password: '', email: '', role: 'staff' });

  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', username: '', email: '', role: 'staff' });

  const [pwdUser, setPwdUser] = useState(null);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [currentPwd, setCurrentPwd] = useState('');

  function addUser() {
    if (!form.name || !form.username || !form.password) return;
    if (users.find(function(u) { return u.username === form.username; })) {
      showT('Username already exists', 'error');
      return;
    }
    const next = users.concat([Object.assign({}, form, { id: uid(), created: today(), active: true })]);
    saveUsers(next);
    setForm({ name: '', username: '', password: '', email: '', role: 'staff' });
    setShowAdd(false);
    showT('User created');
  }

  function openEdit(u) {
    setEditUser(u);
    setEditForm({ name: u.name, username: u.username, email: u.email || '', role: u.role });
  }

  function saveEdit() {
    if (!editForm.name || !editForm.username) return;
    if (users.find(function(u) { return u.username === editForm.username && u.id !== editUser.id; })) {
      showT('Username already taken', 'error');
      return;
    }
    saveUsers(users.map(function(u) { return u.id === editUser.id ? Object.assign({}, u, editForm) : u; }));
    setEditUser(null);
    showT('Profile updated');
  }

  function openPwd(u) {
    setPwdUser(u);
    setNewPwd('');
    setConfirmPwd('');
    setCurrentPwd('');
  }

  function savePwd() {
    if (newPwd.length < 6) { showT('Password must be at least 6 characters', 'error'); return; }
    if (newPwd !== confirmPwd) { showT('Passwords do not match', 'error'); return; }
    const isOwnAccount = pwdUser.id === (currentUser && currentUser.id);
    const isAdmin = currentUser && currentUser.role === 'admin';
    if (isOwnAccount && !isAdmin) {
      if (!currentPwd) { showT('Enter your current password', 'error'); return; }
      const self = users.find(function(u) { return u.id === currentUser.id; });
      if (self && self.password !== currentPwd) {
        showT('Current password is incorrect', 'error');
        return;
      }
    }
    saveUsers(users.map(function(u) { return u.id === pwdUser.id ? Object.assign({}, u, { password: newPwd }) : u; }));
    setPwdUser(null);
    showT('Password changed');
  }

  function toggleActive(u) {
    if (u.id === (currentUser && currentUser.id)) {
      showT('Cannot deactivate your own account', 'error');
      return;
    }
    saveUsers(users.map(function(x) { return x.id === u.id ? Object.assign({}, x, { active: !x.active }) : x; }));
    showT(u.active ? 'Deactivated' : 'Activated');
  }

  function deleteUser(u) {
    if (u.id === (currentUser && currentUser.id)) {
      showT('Cannot delete your own account', 'error');
      return;
    }
    const activeAdmins = users.filter(function(x) { return x.role === 'admin' && x.active; });
    if (activeAdmins.length < 2 && u.role === 'admin') {
      showT('Cannot delete the last admin', 'error');
      return;
    }
    if (!window.confirm('Delete user ' + u.name + '?')) return;
    saveUsers(users.filter(function(x) { return x.id !== u.id; }));
    showT('User deleted');
  }

  const roleColor = { admin: C.earth, staff: C.grass };

  const addModal = showAdd ? h(Modal, {
    title: 'Add New User',
    onClose: function() { setShowAdd(false); },
    width: 480
  },
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
      h(Inp, { label: 'Full Name *', value: form.name, onChange: function(v) { setForm(Object.assign({}, form, { name: v })); } }),
      h(Inp, { label: 'Username *', value: form.username, onChange: function(v) { setForm(Object.assign({}, form, { username: v.toLowerCase().replace(/[ ]/g, '') })); } }),
      h(Inp, { label: 'Email', value: form.email, onChange: function(v) { setForm(Object.assign({}, form, { email: v })); }, type: 'email' }),
      h(Inp, { label: 'Password *', value: form.password, onChange: function(v) { setForm(Object.assign({}, form, { password: v })); }, type: 'password' })
    ),
    h(Sel, {
      label: 'Role',
      value: form.role,
      onChange: function(v) { setForm(Object.assign({}, form, { role: v })); },
      options: [
        { value: 'staff', label: 'Staff - limited access' },
        { value: 'admin', label: 'Admin - full access' }
      ]
    }),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowAdd(false); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, {
        onClick: addUser,
        variant: 'success',
        disabled: !form.name || !form.username || !form.password
      }, 'Create User')
    )
  ) : null;

  const editModal = editUser ? h(Modal, {
    title: 'Edit Profile - ' + editUser.name,
    onClose: function() { setEditUser(null); },
    width: 480
  },
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
      h(Inp, { label: 'Full Name', value: editForm.name, onChange: function(v) { setEditForm(Object.assign({}, editForm, { name: v })); } }),
      h(Inp, { label: 'Username', value: editForm.username, onChange: function(v) { setEditForm(Object.assign({}, editForm, { username: v.toLowerCase().replace(/[ ]/g, '') })); } })
    ),
    h(Inp, { label: 'Email', value: editForm.email, onChange: function(v) { setEditForm(Object.assign({}, editForm, { email: v })); }, type: 'email' }),
    (currentUser && currentUser.role === 'admin') ? h(Sel, {
      label: 'Role',
      value: editForm.role,
      onChange: function(v) { setEditForm(Object.assign({}, editForm, { role: v })); },
      options: [
        { value: 'staff', label: 'Staff' },
        { value: 'admin', label: 'Admin' }
      ]
    }) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setEditUser(null); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, {
        onClick: saveEdit,
        variant: 'success',
        disabled: !editForm.name || !editForm.username
      }, 'Save Changes')
    )
  ) : null;

  const pwdModal = pwdUser ? h(Modal, {
    title: 'Change Password - ' + pwdUser.name,
    onClose: function() { setPwdUser(null); },
    width: 420
  },
    h('div', {
      style: { background: C.parchment, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.soil }
    },
      (pwdUser.id === (currentUser && currentUser.id) && currentUser.role !== 'admin')
        ? 'Enter your current password to set a new one.'
        : 'As admin, you can set a new password without the current one.'
    ),
    (pwdUser.id === (currentUser && currentUser.id) && currentUser.role !== 'admin')
      ? h(Inp, { label: 'Current Password', value: currentPwd, onChange: setCurrentPwd, type: 'password' })
      : null,
    h(Inp, { label: 'New Password', value: newPwd, onChange: setNewPwd, type: 'password', placeholder: 'Min 6 characters' }),
    h(Inp, { label: 'Confirm New Password', value: confirmPwd, onChange: setConfirmPwd, type: 'password' }),
    (confirmPwd && confirmPwd !== newPwd)
      ? h('div', { style: { fontSize: 11, color: C.danger, marginTop: -8, marginBottom: 8 } }, 'Passwords do not match')
      : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setPwdUser(null); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, {
        onClick: savePwd,
        variant: 'success',
        disabled: newPwd.length < 6 || newPwd !== confirmPwd
      }, 'Change Password')
    )
  ) : null;

  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'username', label: 'Username' },
    { key: 'email', label: 'Email', render: function(r) { return r.email || '-'; } },
    { key: 'role', label: 'Role', render: function(r) {
      return h(Badge, { color: roleColor[r.role] || C.muted }, r.role);
    }},
    { key: 'status', label: 'Status', render: function(r) {
      return h(Badge, { color: r.active !== false ? C.grass : C.danger }, r.active !== false ? 'Active' : 'Inactive');
    }},
    { key: 'actions', label: '', render: function(u) {
      return h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
        h(Btn, { size: 'sm', variant: 'secondary', onClick: function() { openEdit(u); } }, 'Edit'),
        h(Btn, { size: 'sm', variant: 'secondary', onClick: function() { openPwd(u); } }, 'Password'),
        (currentUser && currentUser.role === 'admin' && u.id !== currentUser.id) ? h(Btn, {
          size: 'sm',
          variant: u.active !== false ? 'secondary' : 'success',
          onClick: function() { toggleActive(u); }
        }, u.active !== false ? 'Deactivate' : 'Activate') : null,
        (currentUser && currentUser.role === 'admin' && u.id !== currentUser.id) ? h(Btn, {
          size: 'sm',
          variant: 'danger',
          onClick: function() { deleteUser(u); }
        }, 'Del') : null
      );
    }}
  ];

  return h('div', { style: { padding: '0 26px 26px' } },
    toast ? h(Toast, { msg: toast.msg, type: toast.type }) : null,
    h(PageHdr, {
      title: 'User Management',
      subtitle: 'Manage staff accounts and access levels',
      action: h(Btn, { onClick: function() { setShowAdd(true); }, variant: 'success' }, '+ New User')
    }),
    addModal,
    editModal,
    pwdModal,
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 } },
      h(StatCard, { label: 'Total Users', value: users.length, color: C.earth, icon: 'U' }),
      h(StatCard, { label: 'Active', value: users.filter(function(u) { return u.active !== false; }).length, color: C.grass, icon: 'A' }),
      h(StatCard, { label: 'Admins', value: users.filter(function(u) { return u.role === 'admin'; }).length, color: C.savanna, icon: 'M' })
    ),
    h(Card, null,
      h(CardTitle, null, 'All Users'),
      h(Tbl, { cols: cols, rows: users, emptyMsg: 'No users.' })
    )
  );
}

// ========== TRACEABILITY PAGE (Admin) ==========

function TraceabilityPage() {
  const [ledger, setLedger] = useState(function() { return db.get('stockLedger', []); });
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  useEffect(function() {
    setLedger(db.get('stockLedger', []) || []);
  }, []);

  const typeColor = {
    PURCHASE: C.grass, SALE: C.savanna,
    DELETE_PURCHASE: C.danger, DELETE_SALE: C.danger, DELETE_INGREDIENT: C.danger,
    PRICE_CHANGE: C.clay, ADJ: C.soil, VOID: C.danger
  };
  const typeLabel = {
    PURCHASE: 'Stock In', SALE: 'Sale',
    DELETE_PURCHASE: 'Purchase Deleted', DELETE_SALE: 'Sale Deleted', DELETE_INGREDIENT: 'Ingredient Deleted',
    PRICE_CHANGE: 'Price Changed', ADJ: 'Adjustment', VOID: 'Voided'
  };

  const types = ['ALL', 'PURCHASE', 'SALE', 'DELETE_PURCHASE', 'DELETE_SALE', 'DELETE_INGREDIENT', 'PRICE_CHANGE', 'ADJ'];

  const filtered = ledger.filter(function(e) {
    if (filter !== 'ALL' && e.type !== filter) return false;
    if (search && JSON.stringify(e).toLowerCase().indexOf(search.toLowerCase()) === -1) return false;
    return true;
  }).sort(function(a, b) {
    const ad = a.date || '';
    const bd = b.date || '';
    return bd > ad ? 1 : -1;
  });

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: 'Traceability Log',
      subtitle: 'Full audit trail of all stock movements, sales, and deleted records'
    }),
    h('div', {
      style: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }
    },
      h('input', {
        value: search,
        onChange: function(e) { setSearch(e.target.value); },
        placeholder: 'Search logs...',
        style: { flex: 1, minWidth: 200, padding: '8px 12px', border: '1px solid ' + C.border, borderRadius: 8, fontSize: 13, background: C.cream }
      }),
      types.map(function(t) {
        return h(Btn, {
          key: t, size: 'sm',
          variant: filter === t ? 'primary' : 'secondary',
          onClick: function() { setFilter(t); }
        }, t === 'ALL' ? 'All (' + ledger.length + ')' : (typeLabel[t] || t));
      })
    ),
    h(Card, null,
      filtered.length === 0 ? h('div', {
        style: { textAlign: 'center', padding: 40, color: C.muted }
      }, 'No records found') : h('div', { style: { overflowX: 'auto' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          h('thead', null, h('tr', null,
            ['Date', 'Type', 'Item', 'Qty', 'Value', 'By', 'Details'].map(function(col, i) {
              return h('th', {
                key: i,
                style: { padding: '8px 10px', background: C.earth, color: 'white', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap' }
              }, col);
            })
          )),
          h('tbody', null, filtered.map(function(e, i) {
            const dateStr = e.date || (e.at ? e.at.slice(0, 10) : '-');
            return h('tr', {
              key: e.id || i,
              style: { borderBottom: '1px solid ' + C.border, background: i % 2 === 0 ? C.cream : 'white' }
            },
              h('td', { style: { padding: '8px 10px', whiteSpace: 'nowrap', color: C.muted, fontSize: 11 } }, dateStr),
              h('td', { style: { padding: '8px 10px' } },
                h('span', {
                  style: { background: (typeColor[e.type] || C.muted) + '22', color: typeColor[e.type] || C.muted, padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }
                }, typeLabel[e.type] || e.type)
              ),
              h('td', { style: { padding: '8px 10px', fontWeight: 600, color: C.earth } }, e.itemName || e.product || '-'),
              h('td', { style: { padding: '8px 10px', fontFamily: "'DM Mono',monospace" } }, e.qty != null ? ((e.qty > 0 ? '+' : '') + fmt(e.qty) + ' kg') : '-'),
              h('td', { style: { padding: '8px 10px', fontFamily: "'DM Mono',monospace" } }, e.total ? fmtKES(e.total) : '-'),
              h('td', { style: { padding: '8px 10px', fontSize: 11, color: C.muted } }, e.by || '-'),
              h('td', { style: { padding: '8px 10px', fontSize: 11, color: C.muted, maxWidth: 300 } },
                e.deletedRecord ? h('details', null,
                  h('summary', { style: { cursor: 'pointer', color: C.danger } }, 'View deleted record'),
                  h('pre', {
                    style: { fontSize: 10, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
                  }, e.deletedRecord)
                ) : (e.notes || e.supplier || '-')
              )
            );
          }))
        )
      )
    )
  );
}

// ========== RESOURCES PAGE ==========

function ResourcesPage() {
  const ctx = useContext(Ctx) || {};
  const ingredients = ctx.ingredients || [];
  const inventory = ctx.inventory || [];
  const sales = ctx.sales || [];
  const purchases = ctx.purchases || [];
  const customers = ctx.customers || [];

  const [toast, setToast] = useState(null);
  function showT(msg) {
    setToast({ msg: msg, type: 'success' });
    setTimeout(function() { setToast(null); }, 3500);
  }

  function dlCSV(rows, filename) {
    const csv = rows.map(function(r) {
      return r.map(function(c) {
        const s = String(c == null ? '' : c).replace(/"/g, '""');
        return (s.indexOf(',') >= 0 || s.indexOf('\n') >= 0) ? ('"' + s + '"') : s;
      }).join(',');
    }).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = filename;
    a.click();
  }

  function printReport(title, rows, headers) {
    const w = window.open('', '_blank');
    const th = headers.map(function(hd) {
      return '<th style="background:#3d2b1f;color:white;padding:8px 10px;text-align:left;font-size:11px">' + hd + '</th>';
    }).join('');
    const tbody = rows.map(function(row, i) {
      const cells = row.map(function(c) {
        return '<td style="padding:6px 10px;font-size:11px;border-bottom:1px solid #e8e0d4">' + (c == null ? '' : c) + '</td>';
      }).join('');
      return '<tr style="background:' + (i % 2 ? '#faf6ee' : 'white') + '">' + cells + '</tr>';
    }).join('');
    const html = '<!DOCTYPE html><html><head><title>' + title + '</title>' +
      '<style>body{font-family:Arial,sans-serif;margin:20px}h1{color:#3d2b1f}table{border-collapse:collapse;width:100%}@media print{button{display:none}}</style>' +
      '</head><body><h1>Wa-Mifugo - ' + title + '</h1>' +
      '<p style="color:#7a6a55;font-size:12px">Generated: ' + new Date().toLocaleString('en-KE') + '</p>' +
      '<table><thead><tr>' + th + '</tr></thead><tbody>' + tbody + '</tbody></table>' +
      '<br><button onclick="window.print()" style="background:#3d2b1f;color:white;padding:10px 20px;border:none;border-radius:6px;cursor:pointer;font-size:14px">Print / Save PDF</button>' +
      '</body></html>';
    w.document.write(html);
    w.document.close();
  }

  const exports = [
    { title: 'Ingredients', desc: 'Nutrient profiles, prices, inclusion limits',
      onCSV: function() {
        const headers = ['ID', 'Name', 'Category', 'CP%', 'ME kcal/kg', 'Ca%', 'P%', 'Lys%', 'Met%'];
        const rows = [headers].concat(ingredients.map(function(i) {
          return [i.id, i.name, i.category || '', i.cp || 0, i.me || 0, i.ca || 0, i.p || 0, i.lys || 0, i.met || 0];
        }));
        dlCSV(rows, 'ingredients.csv');
        showT('Ingredients exported');
      },
      onPrint: function() {
        printReport('Ingredient Register',
          ingredients.map(function(i) { return [i.name, i.category || '', i.cp, i.me, i.ca, i.p]; }),
          ['Ingredient', 'Category', 'CP%', 'ME', 'Ca%', 'P%']);
      }
    },
    { title: 'Inventory', desc: 'Current stock levels and valuations',
      onCSV: function() {
        const headers = ['Name', 'Category', 'Stock (kg)', 'Buy Price', 'Sell Price', 'Stock Value'];
        const rows = [headers].concat(inventory.map(function(i) {
          return [i.name, i.category || '', i.qty || 0, i.lastPrice || 0, i.sellPrice || '', (i.qty || 0) * (i.lastPrice || 0)];
        }));
        dlCSV(rows, 'inventory.csv');
        showT('Inventory exported');
      },
      onPrint: function() {
        printReport('Inventory Report',
          inventory.map(function(i) {
            return [i.name, i.qty + ' kg', 'KES ' + i.lastPrice, 'KES ' + ((i.qty || 0) * (i.lastPrice || 0)).toLocaleString()];
          }),
          ['Ingredient', 'Stock', 'Buy Price', 'Stock Value']);
      }
    },
    { title: 'Sales', desc: 'All sales records with profit analysis',
      onCSV: function() {
        const headers = ['Date', 'Customer', 'Product', 'Batch kg', 'Revenue', 'Cost', 'Profit'];
        const rows = [headers].concat(sales.map(function(s) {
          return [s.date, s.customerName || s.customer || '', s.product, s.batchKg,
            s.total || s.totalRevenue || 0, s.cost || s.totalCost || 0, s.profit || 0];
        }));
        dlCSV(rows, 'sales.csv');
        showT('Sales exported');
      },
      onPrint: function() {
        printReport('Sales Report',
          sales.map(function(s) {
            return [s.date, s.customerName || s.customer || '', s.product, s.batchKg + 'kg',
              'KES ' + (s.total || s.totalRevenue || 0).toLocaleString()];
          }),
          ['Date', 'Customer', 'Product', 'Batch', 'Revenue']);
      }
    },
    { title: 'Purchases', desc: 'All stock purchase records',
      onCSV: function() {
        const headers = ['Date', 'Ingredient', 'Qty (kg)', 'Cost/kg', 'Total', 'Supplier'];
        const rows = [headers].concat(purchases.map(function(p) {
          return [p.date, p.itemName, p.qty, p.costPerKg, p.total, p.supplier || ''];
        }));
        dlCSV(rows, 'purchases.csv');
        showT('Purchases exported');
      },
      onPrint: function() {
        printReport('Purchase Records',
          purchases.map(function(p) {
            return [p.date, p.itemName, p.qty + 'kg', 'KES ' + p.costPerKg,
              'KES ' + (p.total || 0).toLocaleString(), p.supplier || ''];
          }),
          ['Date', 'Ingredient', 'Qty', 'Cost/kg', 'Total', 'Supplier']);
      }
    },
    { title: 'Customers', desc: 'Customer directory',
      onCSV: function() {
        const headers = ['Name', 'Phone', 'Email', 'Location'];
        const rows = [headers].concat(customers.map(function(c) {
          return [c.name, c.phone || '', c.email || '', c.location || ''];
        }));
        dlCSV(rows, 'customers.csv');
        showT('Customers exported');
      },
      onPrint: function() {
        printReport('Customer Directory',
          customers.map(function(c) { return [c.name, c.phone || '', c.email || '', c.location || '']; }),
          ['Name', 'Phone', 'Email', 'Location']);
      }
    },
    { title: 'Animal Requirements', desc: 'Nutritional targets by species and stage',
      onCSV: function() {
        const headers = ['Category', 'Stage', 'CP Min', 'CP Max', 'ME Min', 'ME Max', 'Ca Min', 'Ca Max', 'P Min', 'P Max'];
        const rows = [headers].concat(SEED_ANIMAL_REQS.map(function(a) {
          return [a.category, a.stage, a.cp[0], a.cp[1], a.me[0], a.me[1], a.ca[0], a.ca[1], a.p[0], a.p[1]];
        }));
        dlCSV(rows, 'animal_requirements.csv');
        showT('Requirements exported');
      },
      onPrint: function() {
        printReport('Animal Nutritional Requirements',
          SEED_ANIMAL_REQS.map(function(a) {
            return [a.category, a.stage, a.cp.join('-'), a.me.join('-'), a.ca.join('-'), a.p.join('-')];
          }),
          ['Category', 'Stage', 'CP%', 'ME kcal/kg', 'Ca%', 'P%']);
      }
    }
  ];

  return h('div', { style: { padding: '0 26px 26px' } },
    toast ? h(Toast, { msg: toast.msg, type: toast.type }) : null,
    h(PageHdr, { title: 'Resources', subtitle: 'Export data to CSV, print PDF reports' }),
    h('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }
    }, exports.map(function(ex, i) {
      return h(Card, { key: i, style: { marginBottom: 0 } },
        h('div', { style: { padding: '14px 16px' } },
          h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }
          },
            h('div', null,
              h('div', {
                style: { fontWeight: 700, color: C.earth, fontSize: 14 }
              }, ex.title),
              h('div', { style: { fontSize: 12, color: C.muted } }, ex.desc)
            )
          ),
          h('div', { style: { display: 'flex', gap: 8 } },
            h(Btn, { onClick: ex.onCSV, size: 'sm', variant: 'secondary' }, 'Export CSV'),
            h(Btn, { onClick: ex.onPrint, size: 'sm', variant: 'secondary' }, 'Print PDF')
          )
        )
      );
    }))
  );
}

// ========== PAGES COMPONENT ==========

export default function Pages(props) {
  const ctx = useContext(Ctx);
  const user = props.user;

  if (!user) return h(LoginPage, { onLogin: props.onLogin });

  const pageMap = {
    dashboard: function() { return h(DashboardPage, null); },
    formulator: function() { return h(FormulatorPage, null); },
    inventory: function() { return h(InventoryPage, null); },
    customers: function() { return h(CustomersPage, null); },
    sales: function() { return h(SalesPage, null); },
    reports: function() { return h(ReportsPage, null); },
    feeding_guide: function() { return h(FeedingGuidePage, null); },
    education: function() { return h(EducationPage, null); },
    resources: function() { return h(ResourcesPage, null); },
    traceability: function() {
      return user.role === 'admin' ? h(TraceabilityPage, null) : h(DashboardPage, null);
    },
    ingredients: function() {
      return user.role === 'admin' ? h(IngredientsPage, null) : h(DashboardPage, null);
    },
    nutrition: function() {
      return user.role === 'admin' ? h(NutritionPage, null) : h(DashboardPage, null);
    },
    users: function() {
      return user.role === 'admin' ? h(UsersPage, { currentUser: user }) : h(DashboardPage, null);
    }
  };

  const pageFn = pageMap[props.page] || pageMap.dashboard;

  return h('div', {
    className: 'wm-layout',
    style: { display: 'flex', minHeight: '100vh', background: C.cream }
  },
    h(Sidebar, {
      page: props.page,
      setPage: props.setPage,
      user: user,
      onLogout: props.onLogout,
      isOpen: props.sidebarOpen,
      onClose: function() { props.setSidebarOpen(false); }
    }),
    h('div', {
      className: 'wm-main',
      style: { flex: 1, overflow: 'auto', paddingTop: 20 }
    }, pageFn())
  );
}

