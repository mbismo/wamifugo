import { useState, useEffect, useContext } from "react";
import React from "react";
import { Ctx } from "./App.jsx";
import { db } from "./db.js";
import { C, uid, today, dateRange, fmt, fmtKES, exportToExcel, readExcelFile } from "./utils.js";
import {
  SEED_USERS, SEED_ANIMAL_REQS, SEED_INGREDIENT_PROFILES,
  CATEGORY_META, CATEGORY_ICONS, FEEDING_QTY, TIPS, SPECIES_RECS,
  getAnimalReqs, getAnimalCategories, buildSpeciesList, getStagesForCategory, getReqForStage,
  ANF_DEFAULTS, getDefaultOverridesForSpecies, resolveMaxIncl
} from "./constants.js";
import { solveLeastCost, solveLeastCostLP, solveBestEffort, suggestIngredientsToBuy, assessNutrientGaps, calcNutrients, calcCost } from "./solver.js";

const h = React.createElement;

// Server push helper
async function serverPush(col, data) {
  const key = import.meta.env?.VITE_SYNC_KEY || 'wamifugo2024';
  try {
    const res = await fetch('/api/data/' + col, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Key': key },
      body: JSON.stringify({ data: data, ts: Date.now() })
    });
    if (!res.ok) {
      const txt = await res.text().catch(function() { return ''; });
      console.warn('Server push failed:', col, res.status, txt);
      return { ok: false, status: res.status, error: txt };
    }
    return { ok: true };
  } catch (e) {
    console.warn('Server push failed:', col, e.message);
    return { ok: false, error: e.message };
  }
}

// ── LOT TRACKING HELPERS ──────────────────────────────────────────────────────
// Inventory items now hold a `lots` array. Each lot:
//   { lotId, purchaseDate, supplier, originalQty, remainingQty, costPerKg, ts }
// The row-level qty/lastPrice fields are kept as a derived snapshot for legacy
// code that still reads them. Migration helper lives in utils.js.

// Sort lots in FIFO order (oldest purchaseDate first; tie-break on ts)
function sortedLotsFIFO(lots) {
  return (lots || []).slice().sort(function(a, b) {
    if (a.purchaseDate !== b.purchaseDate) {
      return a.purchaseDate < b.purchaseDate ? -1 : 1;
    }
    return (a.ts || 0) - (b.ts || 0);
  });
}

// Consume `qty` kg from an inventory row's lots in FIFO order
// (or in the explicit order given by `lotOrderIds`, an array of lotIds).
// If the manual order doesn't cover the full qty, the rest is consumed FIFO
// from the remaining lots not already in the order.
// Returns { newLots, consumed: [{lotId, qty, costPerKg}], totalCost, shortfall }
function consumeFromLots(invRow, qty, lotOrderIds) {
  const lots = (invRow && invRow.lots) ? invRow.lots.slice() : [];
  let ordered;
  if (lotOrderIds && lotOrderIds.length) {
    const explicit = lotOrderIds.map(function(id) { return lots.find(function(l) { return l.lotId === id; }); }).filter(Boolean);
    const explicitIds = new Set(explicit.map(function(l) { return l.lotId; }));
    const fallthrough = sortedLotsFIFO(lots.filter(function(l) { return !explicitIds.has(l.lotId); }));
    ordered = explicit.concat(fallthrough);
  } else {
    ordered = sortedLotsFIFO(lots);
  }
  let remaining = qty;
  const consumed = [];
  let totalCost = 0;
  const updates = {};
  for (const lot of ordered) {
    if (remaining <= 1e-9) break;
    const take = Math.min(lot.remainingQty, remaining);
    if (take <= 0) continue;
    consumed.push({ lotId: lot.lotId, qty: take, costPerKg: lot.costPerKg, purchaseDate: lot.purchaseDate });
    totalCost += take * lot.costPerKg;
    updates[lot.lotId] = Object.assign({}, lot, { remainingQty: lot.remainingQty - take });
    remaining -= take;
  }
  const newLots = lots.map(function(l) { return updates[l.lotId] || l; })
    .filter(function(l) { return l.remainingQty > 1e-6; });
  return {
    newLots: newLots,
    consumed: consumed,
    totalCost: Math.round(totalCost * 100) / 100,
    shortfall: Math.max(0, remaining)
  };
}

// Estimated cost-per-kg if qty were consumed FIFO right now (no mutation)
function estimateLotCostFIFO(invRow, qty) {
  const r = consumeFromLots(invRow, qty);
  return r.consumed.length > 0 && qty > 0 ? r.totalCost / qty : 0;
}

// Returns the qty available across all lots (or just one specific lot)
function availableQty(invRow, lotId) {
  if (!invRow || !invRow.lots) return 0;
  if (lotId) {
    const lot = invRow.lots.find(function(l) { return l.lotId === lotId; });
    return lot ? lot.remainingQty : 0;
  }
  return invRow.lots.reduce(function(s, l) { return s + (l.remainingQty || 0); }, 0);
}

// Add a new lot to an inventory row (creates row if needed)
function addLotToInventory(inventory, ingredientId, ingredientName, ingredientCategory, lot) {
  const existingIdx = inventory.findIndex(function(i) { return i.id === ingredientId; });
  if (existingIdx >= 0) {
    return inventory.map(function(row, idx) {
      if (idx !== existingIdx) return row;
      const newLots = (row.lots || []).concat([lot]);
      const newQty = newLots.reduce(function(s, l) { return s + l.remainingQty; }, 0);
      // Update lastPrice as a snapshot of the most recent purchase (legacy compat)
      return Object.assign({}, row, {
        lots: newLots,
        qty: newQty,
        lastPrice: lot.costPerKg
      });
    });
  }
  // New row entirely
  return inventory.concat([{
    id: ingredientId,
    name: ingredientName,
    category: ingredientCategory || 'energy',
    unit: 'kg',
    qty: lot.originalQty,
    lastPrice: lot.costPerKg,
    sellPrice: Math.round(lot.costPerKg * 1.20 * 100) / 100,
    margin: 20,
    lots: [lot]
  }]);
}

// Apply a list of consumptions to inventory and return new inventory
// consumptions: [{ itemId, newLots }]
function applyLotConsumptions(inventory, consumptions) {
  const byId = {};
  consumptions.forEach(function(c) { byId[c.itemId] = c; });
  return inventory.map(function(row) {
    const c = byId[row.id];
    if (!c) return row;
    const totalQty = c.newLots.reduce(function(s, l) { return s + l.remainingQty; }, 0);
    return Object.assign({}, row, {
      lots: c.newLots,
      qty: totalQty
    });
  });
}


// Navigation config
const NAV = [
  { key: 'dashboard', icon: '\u{1F4CA}', label: 'Dashboard' },
  { key: 'formulator', icon: '\u{1F9EA}', label: 'Feed Formulator' },
  { key: 'direct_sale', icon: '\u{1F6D2}', label: 'Direct Sale' },
  { key: 'saved_formulas', icon: '\u{1F4BE}', label: 'Saved Formulas' },
  { key: 'inventory', icon: '\u{1F4E6}', label: 'Inventory' },
  { key: 'customers', icon: '\u{1F465}', label: 'Customers' },
  { key: 'sales', icon: '\u{1F4B0}', label: 'Sales' },
  { key: 'reports', icon: '\u{1F4C8}', label: 'Reports' },
  { key: 'feeding_guide', icon: '\u{1F33E}', label: 'Feeding Guide' },
  { key: 'education', icon: '\u{1F4D6}', label: 'Education' },
  { key: 'resources', icon: '\u{1F4CB}', label: 'Resources' },
  { key: 'traceability', icon: '\u{1F50D}', label: 'Traceability Log', admin: true },
  { key: 'ingredients', icon: '\u{1F33D}', label: 'Ingredients', admin: true },
  { key: 'nutrition', icon: '\u{2697}', label: 'Nutritional Reqs', admin: true },
  { key: 'users', icon: '\u{1F464}', label: 'Users', admin: true },
];

// Anti-nutritive factor metadata (just labels for warning messages).
// Numeric caps now live in ANF_DEFAULTS in constants.js, plus per-stage
// overrides on each requirement record.
const ANF_FACTOR_LABELS = {
  'ing_6':  'Gossypol',
  'ing_14': 'Hydrocyanic Acid',
  'ing_18': 'Non-Protein Nitrogen',
  'ing_13': 'Condensed Tannins',
  'ing_17': 'Amino Acid Imbalance',
  'ing_4':  'Biogenic Amines',
};

// Resolve effective max inclusion using requirement-level overrides
// (with ANF defaults as fall-back when no override is set).
function getEffectiveMaxIncl(ing, species, req) {
  return resolveMaxIncl(ing, req, species);
}

function checkANFWarnings(formula, ingredients, species, req) {
  const warnings = [];
  const exclusions = [];
  Object.entries(formula).forEach(function(entry) {
    const id = entry[0], pct = entry[1];
    const ing = ingredients.find(function(i) { return i.id === id; });
    if (!ing) return;
    const maxPct = resolveMaxIncl(ing, req, species);
    const factor = ANF_FACTOR_LABELS[id];
    // Custom note from ingredient's antiNote field, if any
    const note = (ing.antiNote || '').trim();
    if (maxPct === 0) {
      exclusions.push({ ingredient: ing.name, factor: factor || 'Excluded', note: note || 'Not allowed for this species/stage.' });
    } else if (maxPct < 100 && pct > maxPct) {
      warnings.push({
        ingredient: ing.name,
        factor: factor || 'Inclusion Limit',
        current: pct.toFixed(1),
        maxPct: maxPct,
        note: note,
        severity: 'danger'
      });
    } else if (maxPct < 100 && pct > maxPct * 0.85) {
      warnings.push({
        ingredient: ing.name,
        factor: factor || 'Inclusion Limit',
        current: pct.toFixed(1),
        maxPct: maxPct,
        note: note,
        severity: 'warning'
      });
    }
  });
  return { warnings: warnings, exclusions: exclusions };
}

// ========== UI ATOMS ==========

function Btn(props) {
  const size = props.size || 'md';
  const variant = props.variant || 'primary';
  const sizeMap = {
    sm: { padding: '7px 13px', fontSize: 12 },
    md: { padding: '10px 17px', fontSize: 13 },
    lg: { padding: '13px 22px', fontSize: 14 }
  };
  const variantMap = {
    primary: { bg: C.earth, color: 'white', b: C.earth, shadow: '0 2px 6px rgba(61,43,31,0.2)' },
    secondary: { bg: 'white', color: C.earth, b: C.border, shadow: '0 1px 3px rgba(0,0,0,0.06)' },
    success: { bg: C.grass, color: 'white', b: C.grass, shadow: '0 2px 6px rgba(74,124,89,0.25)' },
    danger: { bg: C.danger, color: 'white', b: C.danger, shadow: '0 2px 6px rgba(192,57,43,0.25)' },
    warn: { bg: C.warning, color: 'white', b: C.warning, shadow: '0 2px 6px rgba(230,126,34,0.25)' },
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
    boxShadow: props.disabled ? 'none' : v.shadow,
    transition: 'all 0.15s ease'
  }, props.style || {});
  return h('button', { onClick: props.onClick, disabled: props.disabled, style: style }, props.children);
}

function Badge(props) {
  const color = props.color || C.muted;
  const style = { background: color + '22', color: color, border: '1px solid ' + color + '44', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 600, display: 'inline-block' };
  return h('span', { style: style }, props.children);
}

function Card(props) {
  const style = Object.assign({
    background: 'white',
    border: '1px solid ' + C.border,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 14,
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
  }, props.style || {});
  return h('div', { style: style }, props.children);
}

function CardTitle(props) {
  const style = {
    background: 'linear-gradient(to right, ' + C.parchment + ', ' + C.cream + ')',
    padding: '12px 18px',
    borderBottom: '1px solid ' + C.border,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  };
  const titleStyle = {
    fontFamily: "'DM Mono',monospace",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: C.soil
  };
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
  }, props.multiline ? { minHeight: 70, fontFamily: 'inherit', resize: 'vertical' } : {}, props.style || {});
  // Local state buffers keystrokes so parent re-renders do not lose focus
  const [local, setLocal] = useState(props.value == null ? '' : String(props.value));
  const [focused, setFocused] = useState(false);
  // Sync from parent when NOT actively typing
  useEffect(function() {
    if (!focused) setLocal(props.value == null ? '' : String(props.value));
  }, [props.value, focused]);
  const labelEl = props.label ? h('div', { style: labelStyle }, props.label) : null;
  const inputProps = {
    value: local,
    onFocus: function() { setFocused(true); },
    onBlur: function() { setFocused(false); if (props.onChange) props.onChange(local); },
    onChange: function(e) {
      setLocal(e.target.value);
      if (props.onChange) props.onChange(e.target.value);
    },
    onKeyDown: props.onKeyDown,
    placeholder: props.placeholder || '',
    maxLength: props.maxLength,
    style: inputStyle
  };
  const input = props.multiline
    ? h('textarea', Object.assign({ rows: props.rows || 3 }, inputProps))
    : h('input', Object.assign({ type: props.type || 'text' }, inputProps));
  return h('div', { style: wrapStyle }, labelEl, input);
}

function Sel(props) {
  const wrapStyle = { marginBottom: 12 };
  const labelStyle = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: C.muted, marginBottom: 4 };
  const selectStyle = Object.assign({
    width: '100%', padding: '8px 11px', border: '1px solid ' + C.border, borderRadius: 8,
    fontSize: 13, color: C.ink, background: C.cream, outline: 'none', cursor: 'pointer'
  }, props.style || {});
  const labelEl = props.label ? h('div', { style: labelStyle }, props.label) : null;
  const options = (props.options || []).map(function(o) {
    return h('option', { key: o.value, value: o.value, disabled: o.disabled || false }, o.label);
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
  const style = {
    background: 'white',
    border: '1px solid ' + C.border,
    borderLeft: '4px solid ' + color,
    borderRadius: 12,
    padding: '14px 17px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    transition: 'all 0.2s',
    position: 'relative',
    overflow: 'hidden'
  };
  const iconStyle = {
    position: 'absolute',
    right: 14,
    top: 14,
    fontSize: 26,
    opacity: 0.22
  };
  return h('div', { style: style },
    props.icon ? h('div', { style: iconStyle }, props.icon) : null,
    h('div', {
      style: {
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        color: C.muted,
        marginBottom: 6,
        fontFamily: "'DM Mono',monospace"
      }
    }, props.label),
    h('div', {
      style: {
        fontSize: 24,
        fontFamily: "'Playfair Display',serif",
        fontWeight: 900,
        color: color,
        lineHeight: 1
      }
    }, props.value),
    props.sub ? h('div', {
      style: { fontSize: 11, color: C.muted, marginTop: 4, fontWeight: 600 }
    }, props.sub) : null
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
  const style = {
    padding: '22px 26px 18px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    borderBottom: '3px solid ' + C.parchment,
    marginBottom: 18,
    background: 'linear-gradient(to bottom, ' + C.cream + ' 0%, transparent 100%)'
  };
  return h('div', { style: style },
    h('div', null,
      h('div', {
        style: {
          fontFamily: "'Playfair Display',serif",
          fontSize: 28,
          fontWeight: 900,
          color: C.earth,
          lineHeight: 1.1,
          letterSpacing: '-0.5px'
        }
      }, props.title),
      props.subtitle ? h('div', {
        style: { fontSize: 13, color: C.muted, marginTop: 5, fontStyle: 'italic' }
      }, props.subtitle) : null
    ),
    props.action || null
  );
}

function Tbl(props) {
  const cols = props.cols || [];
  const rows = props.rows || [];
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const perPage = props.perPage || 25;
  const showSearch = props.showSearch !== false;
  const maxHeight = props.maxHeight || 500;

  // Filter by search
  const filtered = search
    ? rows.filter(function(r) {
        const hay = cols.map(function(c) {
          const v = c.render ? (c.searchValue ? c.searchValue(r) : r[c.key]) : r[c.key];
          return String(v == null ? '' : v).toLowerCase();
        }).join(' ');
        return hay.indexOf(search.toLowerCase()) !== -1;
      })
    : rows;

  // Sort
  const sorted = sortKey
    ? filtered.slice().sort(function(a, b) {
        const col = cols.find(function(c) { return c.key === sortKey; });
        const av = col && col.sortValue ? col.sortValue(a) : a[sortKey];
        const bv = col && col.sortValue ? col.sortValue(b) : b[sortKey];
        if (av == null) return 1;
        if (bv == null) return -1;
        const an = typeof av === 'number' ? av : parseFloat(av);
        const bn = typeof bv === 'number' ? bv : parseFloat(bv);
        let cmp;
        if (!isNaN(an) && !isNaN(bn)) cmp = an - bn;
        else cmp = String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageClamp = Math.min(page, totalPages - 1);
  const paged = sorted.slice(pageClamp * perPage, (pageClamp + 1) * perPage);

  const headerStyle = {
    padding: '10px 13px',
    background: C.parchment,
    color: C.soil,
    textAlign: 'left',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: "'DM Mono',monospace",
    fontWeight: 700,
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    borderBottom: '2px solid ' + C.border,
    cursor: 'pointer',
    userSelect: 'none'
  };
  const cellStyle = { padding: '10px 13px', color: C.ink, verticalAlign: 'middle', fontSize: 12 };

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const ths = cols.map(function(c) {
    const isSorted = sortKey === c.key;
    const arrow = isSorted ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';
    const sortable = c.sortable !== false && c.key !== 'actions' && c.key !== 'del';
    return h('th', {
      key: c.key,
      style: Object.assign({}, headerStyle, { cursor: sortable ? 'pointer' : 'default' }),
      onClick: sortable ? function() { toggleSort(c.key); } : null
    }, c.label + arrow);
  });

  const searchBar = showSearch && rows.length > 5 ? h('div', {
    style: { padding: '10px 13px', borderBottom: '1px solid ' + C.border, background: 'white', display: 'flex', gap: 10, alignItems: 'center' }
  },
    h('span', { style: { fontSize: 14 } }, '\u{1F50D}'),
    h('input', {
      value: search,
      onChange: function(e) { setSearch(e.target.value); setPage(0); },
      placeholder: 'Search ' + rows.length + ' records...',
      style: { flex: 1, padding: '7px 10px', border: '1px solid ' + C.border, borderRadius: 8, fontSize: 13, background: C.cream, outline: 'none' }
    }),
    search ? h('button', {
      onClick: function() { setSearch(''); setPage(0); },
      style: { border: 'none', background: C.border, color: C.muted, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }
    }, 'Clear') : null,
    h('span', { style: { fontSize: 11, color: C.muted, fontFamily: "'DM Mono',monospace" } },
      filtered.length + ' / ' + rows.length)
  ) : null;

  if (rows.length === 0) {
    return h('div', { style: { padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 } }, props.emptyMsg || 'No data');
  }

  if (filtered.length === 0) {
    return h('div', null,
      searchBar,
      h('div', { style: { padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 } }, 'No records match your search.')
    );
  }

  const trs = paged.map(function(row, i) {
    const tds = cols.map(function(c) {
      const value = c.render ? c.render(row) : row[c.key];
      return h('td', { key: c.key, style: cellStyle }, value);
    });
    const rowStyle = { borderBottom: '1px solid ' + C.border, background: i % 2 === 0 ? C.cream : 'white' };
    return h('tr', { key: row.id || i, style: rowStyle }, tds);
  });

  const pagination = totalPages > 1 ? h('div', {
    style: { padding: '10px 13px', borderTop: '1px solid ' + C.border, background: C.parchment, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }
  },
    h('span', { style: { color: C.muted, fontFamily: "'DM Mono',monospace" } },
      'Page ' + (pageClamp + 1) + ' of ' + totalPages + ' \u2022 showing ' + paged.length + ' of ' + sorted.length),
    h('div', { style: { display: 'flex', gap: 6 } },
      h('button', {
        onClick: function() { setPage(Math.max(0, pageClamp - 1)); },
        disabled: pageClamp === 0,
        style: { padding: '5px 12px', border: '1px solid ' + C.border, background: pageClamp === 0 ? C.border : 'white', borderRadius: 6, cursor: pageClamp === 0 ? 'not-allowed' : 'pointer', fontSize: 12 }
      }, '\u2190 Prev'),
      h('button', {
        onClick: function() { setPage(Math.min(totalPages - 1, pageClamp + 1)); },
        disabled: pageClamp === totalPages - 1,
        style: { padding: '5px 12px', border: '1px solid ' + C.border, background: pageClamp === totalPages - 1 ? C.border : 'white', borderRadius: 6, cursor: pageClamp === totalPages - 1 ? 'not-allowed' : 'pointer', fontSize: 12 }
      }, 'Next \u2192')
    )
  ) : null;

  return h('div', null,
    searchBar,
    h('div', { style: { overflowX: 'auto', overflowY: 'auto', maxHeight: maxHeight } },
      h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
        h('thead', null, h('tr', null, ths)),
        h('tbody', null, trs)
      )
    ),
    pagination
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

  async function login() {
    setErr('');
    setLoading(true);
    let users = null;
    // Try server first so newly-created users sync across devices
    try {
      const key = (import.meta.env && import.meta.env.VITE_SYNC_KEY) || 'wamifugo2024';
      const r = await fetch('/api/data/users', { headers: { 'X-Sync-Key': key } });
      if (r.ok) {
        const d = await r.json();
        if (d && d.data && d.data.length > 0) {
          users = d.data;
          // Cache locally so subsequent loads work offline
          db.set('users', users);
        }
      }
    } catch (e) {
      // Server unreachable - fall through to local cache
    }
    // If no server response, use local cache, then seed
    if (!users) {
      const stored = db.get('users', null);
      users = (stored && stored.length > 0) ? stored : SEED_USERS;
    }
    setLoading(false);
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
    h('div', { style: { fontSize: 46, marginBottom: 8 } }, '\u{1F33E}'),
    h('div', { style: { fontFamily: "'Playfair Display',serif", fontSize: 32, fontWeight: 900, color: C.earth, lineHeight: 1.1 } }, 'Wa-Mifugo'),
    h('div', { style: { fontFamily: "'DM Mono',monospace", fontSize: 10, color: C.muted, letterSpacing: 2.5, textTransform: 'uppercase', marginTop: 6 } }, 'Feeds Management System'),
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
    h(Btn, {
      onClick: login,
      size: 'lg',
      style: { width: '100%', marginTop: 10 },
      disabled: loading
    }, loading ? 'Signing in...' : 'Sign In'),
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
    h('div', { style: { padding: '20px 15px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
        h('span', { style: { fontSize: 24 } }, '\u{1F33E}'),
        h('div', { style: { fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 900, color: 'white', lineHeight: 1 } }, 'Wa-Mifugo')
      ),
      h('div', { style: { fontFamily: "'DM Mono',monospace", fontSize: 9, color: C.harvest, letterSpacing: 2.5, textTransform: 'uppercase', marginTop: 6 } }, 'Feeds Management')
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
    h(PageHdr, { title: '\u{1F4CA} Dashboard', subtitle: 'Overview of your feed business (last 30 days)' }),
    h('div', { style: statStyle },
      h(StatCard, { label: 'Revenue (30d)', value: fmtKES(rev), color: C.grass, icon: '\u{1F4B0}' }),
      h(StatCard, { label: 'Profit (30d)', value: fmtKES(profit), sub: profitSub, color: profitColor, icon: '\u{1F4C8}' }),
      h(StatCard, { label: 'Sales Count', value: monthSales.length, color: C.earth, icon: '\u{1F6D2}' }),
      h(StatCard, { label: 'Stock Value', value: fmtKES(stockValue), color: C.clay, icon: '\u{1F4E6}' }),
      h(StatCard, { label: 'Customers', value: customers.length, color: C.soil, icon: '\u{1F465}' }),
      h(StatCard, { label: 'Low Stock Items', value: lowStock.length, color: C.danger, icon: '\u{26A0}' })
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
  const [showLots, setShowLots] = useState(null); // inventory row when open
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
    const ingDef = ingredients.find(function(i) { return i.id === ns.itemId; });
    const newLot = {
      lotId: 'lot_' + uid(),
      purchaseDate: ns.date,
      supplier: ns.supplier || '',
      originalQty: qty,
      remainingQty: qty,
      costPerKg: cost,
      ts: Date.now()
    };
    const newInv = addLotToInventory(
      inventory,
      ns.itemId,
      ingDef ? ingDef.name : '(unknown)',
      ingDef ? ingDef.category : 'energy',
      newLot
    );
    setInventory(newInv);

    const itemName = ingDef ? ingDef.name : '';
    setPurchases(purchases.concat([{
      id: uid(), itemId: ns.itemId, itemName: itemName,
      qty: qty, costPerKg: cost, total: qty * cost,
      date: ns.date, supplier: ns.supplier,
      lotId: newLot.lotId
    }]));
    const ledger = db.get('stockLedger', []);
    const entry = {
      id: uid(), type: 'PURCHASE', date: ns.date,
      itemId: ns.itemId, itemName: itemName,
      qty: qty, costPerKg: cost, total: qty * cost,
      supplier: ns.supplier, lotId: newLot.lotId, by: user ? user.name : ''
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

  // Refresh showLots row data when inventory changes (so the open modal stays in sync)
  const liveLotsRow = showLots ? inventory.find(function(i) { return i.id === showLots.id; }) : null;

  function deleteLot(itemId, lotId) {
    if (!window.confirm('Delete this lot? This cannot be undone.')) return;
    const newInv = inventory.map(function(i) {
      if (i.id !== itemId) return i;
      const newLots = (i.lots || []).filter(function(l) { return l.lotId !== lotId; });
      const newQty = newLots.reduce(function(s, l) { return s + l.remainingQty; }, 0);
      return Object.assign({}, i, { lots: newLots, qty: newQty });
    });
    setInventory(newInv);
    showT('Lot deleted');
  }

  const lotsModal = (showLots && liveLotsRow) ? h(Modal, {
    title: 'Lots — ' + (liveLotsRow.name || ''),
    onClose: function() { setShowLots(null); },
    width: 640
  },
    h('div', { style: { fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 } },
      'Each purchase creates a separate lot at its own price. Lots are consumed FIFO (oldest first) by default \u2014 sales can override this.'
    ),
    (liveLotsRow.lots || []).length === 0 ? h('div', {
      style: { padding: 24, textAlign: 'center', color: C.muted, background: C.cream, borderRadius: 10 }
    }, 'No lots yet. Add stock to create the first lot.') : h('div', null,
      h('div', {
        style: {
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 40px',
          gap: 6, padding: '6px 0',
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          color: C.muted, fontFamily: "'DM Mono',monospace",
          letterSpacing: 1.2, borderBottom: '2px solid ' + C.border
        }
      },
        h('div', null, 'Date'),
        h('div', null, 'Supplier'),
        h('div', { style: { textAlign: 'right' } }, 'Original'),
        h('div', { style: { textAlign: 'right' } }, 'Remaining'),
        h('div', { style: { textAlign: 'right' } }, 'Cost/kg'),
        h('div', null, '')
      ),
      sortedLotsFIFO(liveLotsRow.lots).map(function(lot, i) {
        const used = lot.originalQty - lot.remainingQty;
        const pctUsed = lot.originalQty > 0 ? (used / lot.originalQty) * 100 : 0;
        return h('div', {
          key: lot.lotId,
          style: {
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 40px',
            gap: 6, padding: '8px 0',
            alignItems: 'center', fontSize: 12,
            borderBottom: '1px solid ' + C.border,
            background: i === 0 ? '#f0f9f4' : 'transparent'
          }
        },
          h('div', { style: { color: C.earth, fontWeight: 600 } },
            lot.purchaseDate,
            i === 0 ? h('div', { style: { fontSize: 9, color: C.grass, fontWeight: 700 } }, 'NEXT TO USE') : null
          ),
          h('div', { style: { color: C.muted, fontSize: 11 } }, lot.supplier || '-'),
          h('div', { style: { textAlign: 'right', fontFamily: "'DM Mono',monospace", color: C.muted } },
            fmt(lot.originalQty, 1) + ' kg'),
          h('div', { style: { textAlign: 'right', fontFamily: "'DM Mono',monospace", fontWeight: 700, color: lot.remainingQty > 0 ? C.earth : C.muted } },
            fmt(lot.remainingQty, 1) + ' kg' +
              (pctUsed > 0 && pctUsed < 100 ? ' (' + Math.round(pctUsed) + '% used)' : '')),
          h('div', { style: { textAlign: 'right', fontFamily: "'DM Mono',monospace", fontWeight: 700, color: C.earth } },
            fmtKES(lot.costPerKg)),
          user && user.role === 'admin' ? h('button', {
            onClick: function() { deleteLot(liveLotsRow.id, lot.lotId); },
            style: { border: 'none', background: 'transparent', color: C.danger, cursor: 'pointer', fontSize: 14 },
            title: 'Delete this lot'
          }, '\u2715') : h('div')
        );
      }),
      (function() {
        const totalRemaining = liveLotsRow.lots.reduce(function(s, l) { return s + l.remainingQty; }, 0);
        const totalValue = liveLotsRow.lots.reduce(function(s, l) { return s + l.remainingQty * l.costPerKg; }, 0);
        const wAvg = totalRemaining > 0 ? totalValue / totalRemaining : 0;
        return h('div', {
          style: {
            marginTop: 12, padding: '10px 12px',
            background: C.parchment, borderRadius: 8,
            display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.earth
          }
        },
          h('span', null, h('strong', null, 'Total remaining: '), fmt(totalRemaining, 1) + ' kg'),
          h('span', null, h('strong', null, 'Stock value: '), fmtKES(totalValue)),
          h('span', null, h('strong', null, 'Wtd avg: '), fmtKES(wAvg) + '/kg')
        );
      })()
    ),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowLots(null); }, variant: 'secondary' }, 'Close')
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
        ingredients
          .slice()
          .sort(function(a, b) { return a.name.localeCompare(b.name); })
          .map(function(i) {
            const inv = inventory.find(function(x) { return x.id === i.id; });
            const stock = inv ? inv.qty : 0;
            return { value: i.id, label: i.name + (stock > 0 ? ' (' + stock.toFixed(0) + ' kg in stock)' : ' (no stock)') };
          })
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
    { key: 'lots', label: 'Lots', render: function(r) {
      const n = (r.lots || []).length;
      if (n === 0) return h('span', { style: { color: C.muted, fontSize: 11 } }, '-');
      const prices = (r.lots || []).map(function(l) { return l.costPerKg || 0; }).filter(function(p) { return p > 0; });
      const minP = prices.length ? Math.min.apply(null, prices) : 0;
      const maxP = prices.length ? Math.max.apply(null, prices) : 0;
      const priceLabel = minP === maxP ? fmtKES(minP) : (fmtKES(minP) + '\u2013' + fmtKES(maxP));
      return h('div', { style: { fontSize: 11, lineHeight: 1.3 } },
        h('div', { style: { fontWeight: 700, color: C.earth } }, n + ' lot' + (n > 1 ? 's' : '')),
        h('div', { style: { color: C.muted, fontFamily: "'DM Mono',monospace" } }, priceLabel + '/kg')
      );
    }},
    { key: 'sellPrice', label: 'Sell Price', render: function(r) {
      return h('span', { style: { fontWeight: 700, color: C.grass } }, fmtKES(getSellPrice(r)) + '/kg');
    }},
    { key: 'value', label: 'Stock Value', render: function(r) {
      const v = (r.lots || []).reduce(function(s, l) { return s + (l.remainingQty || 0) * (l.costPerKg || 0); }, 0);
      return fmtKES(v);
    }},
    { key: 'actions', label: '', sortable: false, render: function(r) {
      return h('div', { style: { display: 'flex', gap: 4 } },
        h(Btn, { size: 'sm', variant: 'secondary', onClick: function() { setShowLots(r); } }, 'Lots'),
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
      title: '\u{1F4E6} Inventory Management',
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
    lotsModal,
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
  const [toast, setToast] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const blank = { name: '', category: 'energy', cp: '', me: '', fat: '', fibre: '', ca: '', p: '', lys: '', met: '', maxIncl: '', nutritiveNote: '', antiNote: '' };
  const [form, setForm] = useState(blank);

  function showT(msg, type) {
    setToast({ msg: msg, type: type || 'success' });
    setTimeout(function() { setToast(null); }, 3500);
  }

  function openAdd() { setForm(blank); setEditing(null); setShowForm(true); }
  function openEdit(ing) {
    setForm(Object.assign({}, blank, ing));
    setEditing(ing);
    setShowForm(true);
  }

  async function handleExcelImport(file) {
    if (!file) return;
    setImportStatus({ type: 'loading', msg: 'Reading Excel file...' });
    try {
      const result = await readExcelFile(file);
      const rows = result.rows || [];
      if (rows.length === 0) {
        setImportStatus({ type: 'error', msg: 'The file has no data rows.' });
        return;
      }
      // Normalize column names (lowercase, strip spaces)
      const norm = function(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); };
      const newIngredients = [];
      const errors = [];
      rows.forEach(function(row, i) {
        const keys = Object.keys(row);
        const get = function(possibleNames) {
          for (const name of possibleNames) {
            const k = keys.find(function(x) { return norm(x) === norm(name); });
            if (k) return row[k];
          }
          return null;
        };
        const name = get(['name', 'ingredient', 'ingredientname']);
        if (!name) { errors.push('Row ' + (i + 2) + ': missing name'); return; }
        newIngredients.push({
          id: 'ing_' + uid(),
          name: String(name).trim(),
          category: String(get(['category', 'type']) || 'energy').toLowerCase().trim(),
          cp: parseFloat(get(['cp', 'crudeprotein', 'protein', 'cppercent'])) || 0,
          me: parseFloat(get(['me', 'metabolisableenergy', 'energy', 'mekcalkg'])) || 0,
          fat: parseFloat(get(['fat', 'crudefat', 'fatpercent'])) || 0,
          fibre: parseFloat(get(['fibre', 'fiber', 'crudefibre', 'cf'])) || 0,
          ca: parseFloat(get(['ca', 'calcium', 'capercent'])) || 0,
          p: parseFloat(get(['p', 'phosphorus', 'ppercent'])) || 0,
          lys: parseFloat(get(['lys', 'lysine'])) || 0,
          met: parseFloat(get(['met', 'methionine'])) || 0,
          maxIncl: (function() {
            const v = get(['maxincl', 'maxinclusion', 'maxincusionpercent', 'max', 'maxpercent', 'cap']);
            const n = parseFloat(v);
            return isNaN(n) ? 100 : Math.min(100, Math.max(0, n));
          })(),
          nutritiveNote: String(get(['nutritivenote', 'nutritivenotes', 'nutritive', 'benefits', 'notes']) || '').trim(),
          antiNote: String(get(['antinote', 'antinutritivenote', 'antinutritivenotes', 'antinutritive', 'cautions', 'warnings']) || '').trim()
        });
      });
      if (newIngredients.length === 0) {
        setImportStatus({ type: 'error', msg: 'No valid rows found. Errors: ' + errors.slice(0, 3).join('; ') });
        return;
      }
      // Merge by name - update existing ingredients with same name, add new
      const existingNames = new Set(ingredients.map(function(i) { return i.name.toLowerCase().trim(); }));
      const toAdd = newIngredients.filter(function(n) { return !existingNames.has(n.name.toLowerCase().trim()); });
      const toUpdate = newIngredients.filter(function(n) { return existingNames.has(n.name.toLowerCase().trim()); });
      let updated = ingredients.slice();
      toUpdate.forEach(function(n) {
        updated = updated.map(function(x) {
          if (x.name.toLowerCase().trim() === n.name.toLowerCase().trim()) {
            return Object.assign({}, x, n, { id: x.id });
          }
          return x;
        });
      });
      updated = updated.concat(toAdd);
      setIngredients(updated);
      setImportStatus({
        type: 'success',
        msg: 'Imported ' + newIngredients.length + ' ingredients (' + toAdd.length + ' new, ' + toUpdate.length + ' updated)' + (errors.length > 0 ? '. ' + errors.length + ' rows skipped.' : '')
      });
      setTimeout(function() { setShowImport(false); setImportStatus(null); }, 2500);
    } catch (e) {
      setImportStatus({ type: 'error', msg: e.message || 'Import failed' });
    }
  }

  function downloadTemplate() {
    const headers = ['Name', 'Category', 'CP %', 'ME kcal/kg', 'Fat %', 'Fibre %', 'Ca %', 'P %', 'Lys %', 'Met %', 'Max Inclusion %', 'Nutritive Note', 'Anti Note'];
    const sample = [
      ['Maize Grain', 'energy', 8.5, 3350, 3.8, 2.3, 0.02, 0.28, 0.24, 0.17, 70,
        'High-energy staple. Excellent palatability. Yellow varieties supply xanthophyll for egg yolk colour.',
        'Susceptible to aflatoxin if poorly stored. Reject mouldy or musty grain. Limit to 70% in poultry mash.'],
      ['Soybean Meal (44%)', 'protein', 44, 2230, 1.5, 6.5, 0.33, 0.65, 2.78, 0.64, 35,
        'Highest-quality plant protein. Excellent amino acid profile, especially lysine. Standard pairing with maize.',
        'Raw soy contains trypsin inhibitors and must be heat-treated (toasted). Limit to 35% to avoid excess Lys/Met imbalance.']
    ];
    exportToExcel([headers].concat(sample), 'ingredients_import_template.xlsx', 'Ingredients');
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
      maxIncl: form.maxIncl === '' || form.maxIncl == null ? 100 : Math.min(100, Math.max(0, parseFloat(form.maxIncl) || 0)),
      nutritiveNote: (form.nutritiveNote || '').trim(),
      antiNote: (form.antiNote || '').trim(),
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
    { key: 'maxIncl', label: 'Max %', render: function(r) {
      const v = r.maxIncl != null ? r.maxIncl : 100;
      return h('span', { style: { fontFamily: "'DM Mono',monospace", color: v < 100 ? C.warning : C.muted } },
        v < 100 ? v + '%' : '100%');
    }},
    { key: 'price', label: 'Sell Price/kg', render: function(r) {
      const sp = getSellPrice(r.id);
      return h('span', { style: { fontFamily: "'DM Mono',monospace", color: C.grass, fontWeight: 700 } },
        sp ? fmtKES(sp) : '-');
    }},
    { key: 'notes', label: 'Notes', sortable: false, render: function(r) {
      const hasNutritive = r.nutritiveNote && r.nutritiveNote.length > 0;
      const hasAnti = r.antiNote && r.antiNote.length > 0;
      if (!hasNutritive && !hasAnti) return h('span', { style: { color: C.muted, fontSize: 11 } }, '-');
      return h('div', { style: { display: 'flex', gap: 6 } },
        hasNutritive ? h('span', {
          title: 'Nutritive: ' + r.nutritiveNote,
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 7px', background: '#f0f9f4', color: C.grass, border: '1px solid ' + C.leaf + '66',
            borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'help'
          }
        }, '\u{1F33F}') : null,
        hasAnti ? h('span', {
          title: 'Anti-nutritive: ' + r.antiNote,
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 7px', background: '#fff4e0', color: C.warning, border: '1px solid ' + C.warning + '66',
            borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'help'
          }
        }, '\u{26A0}') : null
      );
    }},
    { key: 'actions', label: '', sortable: false, render: function(r) {
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
    h('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 6, marginTop: 16 } }, 'Inclusion Limits'),
    h(Inp, {
      label: 'Max Inclusion % (default 100)',
      value: form.maxIncl,
      onChange: function(v) { setForm(Object.assign({}, form, { maxIncl: v })); },
      type: 'number',
      placeholder: 'e.g. 25 for cottonseed cake; 100 if no cap'
    }),
    h('div', { style: { fontSize: 11, color: C.muted, marginTop: -8, marginBottom: 12, fontStyle: 'italic' } },
      'The solver will not exceed this percentage of the total mix for this ingredient.'),
    h('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 6, marginTop: 16 } }, 'Notes'),
    h(Inp, {
      label: '\u{1F33F} Nutritive Notes',
      multiline: true,
      rows: 3,
      placeholder: 'Why this ingredient is useful: amino acid profile, energy density, palatability, special benefits...',
      value: form.nutritiveNote,
      onChange: function(v) { setForm(Object.assign({}, form, { nutritiveNote: v })); }
    }),
    h(Inp, {
      label: '\u{26A0} Anti-Nutritive Notes',
      multiline: true,
      rows: 3,
      placeholder: 'Cautions: ANF (e.g. tannins, gossypol, trypsin inhibitors), inclusion limits per species, processing requirements (heat, soak)...',
      value: form.antiNote,
      onChange: function(v) { setForm(Object.assign({}, form, { antiNote: v })); }
    }),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowForm(false); setEditing(null); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, { onClick: saveIng, variant: 'success' }, editing ? 'Update Ingredient' : 'Add Ingredient')
    )
  ) : null;

  const importModal = showImport ? h(Modal, {
    title: 'Import Ingredients from Excel',
    onClose: function() { setShowImport(false); setImportStatus(null); },
    width: 540
  },
    h('div', {
      style: { background: C.parchment, borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: C.soil, lineHeight: 1.6 }
    },
      h('div', { style: { fontWeight: 700, marginBottom: 6 } }, 'Expected column headers:'),
      h('div', { style: { fontFamily: "'DM Mono',monospace", fontSize: 11 } },
        'Name, Category, CP %, ME kcal/kg, Fat %, Fibre %, Ca %, P %, Lys %, Met %, Max Inclusion %, Nutritive Note, Anti Note'),
      h('div', { style: { marginTop: 8, fontSize: 12 } },
        'Categories: energy, protein, macromineral, micromineral, roughage, additive. ',
        'Existing ingredients with matching names will be updated.')
    ),
    h(Btn, { onClick: downloadTemplate, variant: 'secondary', size: 'sm', style: { marginBottom: 12 } }, '\u{1F4E5} Download Template'),
    h('div', null,
      h('label', {
        style: {
          display: 'block',
          padding: '22px',
          border: '2px dashed ' + C.border,
          borderRadius: 10,
          textAlign: 'center',
          cursor: 'pointer',
          background: C.cream
        }
      },
        h('div', { style: { fontSize: 28, marginBottom: 7 } }, '\u{1F4C4}'),
        h('div', { style: { fontSize: 13, color: C.earth, fontWeight: 600 } }, 'Click to choose an Excel file (.xlsx)'),
        h('input', {
          type: 'file',
          accept: '.xlsx,.xls',
          onChange: function(e) { handleExcelImport(e.target.files[0]); },
          style: { display: 'none' }
        })
      )
    ),
    importStatus ? h('div', {
      style: {
        marginTop: 14, padding: '10px 14px', borderRadius: 8, fontSize: 13,
        background: importStatus.type === 'error' ? '#fde8e8' : importStatus.type === 'success' ? '#f0f9f4' : C.parchment,
        color: importStatus.type === 'error' ? C.danger : importStatus.type === 'success' ? C.grass : C.muted,
        border: '1px solid ' + (importStatus.type === 'error' ? C.danger : importStatus.type === 'success' ? C.grass : C.border) + '44'
      }
    }, importStatus.msg) : null
  ) : null;

  return h('div', { style: { padding: '0 26px 26px' } },
    toast ? h(Toast, { msg: toast.msg, type: toast.type }) : null,
    h(PageHdr, {
      title: '\u{1F33D} Ingredients',
      subtitle: 'Manage ingredient nutritional profiles',
      action: h('div', { style: { display: 'flex', gap: 8 } },
        h(Btn, { onClick: function() { setShowImport(true); }, variant: 'secondary' }, '\u{1F4E4} Import Excel'),
        h(Btn, { onClick: openAdd, variant: 'success' }, '+ Add Ingredient')
      )
    }),
    formModal,
    importModal,
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
      title: '\u{1F465} Customers',
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

function FormulatorPage(props) {
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

  const preload = props && props.preload ? props.preload : null;

  const [species, setSpecies] = useState(preload ? preload.species : '');
  const [stage, setStage] = useState(preload ? preload.stage : '');
  const [batchKg, setBatchKg] = useState(preload ? (preload.batchKg || 100) : 100);
  const [selPrice, setSelPrice] = useState('');
  const [custId, setCustId] = useState(preload ? (preload.customerId || '') : '');
  const [showSave, setShowSave] = useState(false);
  const [fName, setFName] = useState('');
  const [showSell, setShowSell] = useState(false);
  const [pendingSale, setPendingSale] = useState(null);
  const [toast, setToast] = useState(null);
  const [formula, setFormula] = useState(preload ? preload.formula : null);
  const [nutrients, setNutrients] = useState(null);
  const [costPKg, setCostPKg] = useState(0);
  const [solveQuality, setSolveQuality] = useState('');
  const [loading, setLoading] = useState(false);
  const [anfWarnings, setAnfWarnings] = useState([]);
  const [anfExclusions, setAnfExclusions] = useState([]);
  const [buySuggestions, setBuySuggestions] = useState([]);
  const [infeasibleReason, setInfeasibleReason] = useState('');
  const [diagnosticFormula, setDiagnosticFormula] = useState(null);

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
    const currentReq = (species && stage) ? getReqForStage(animalReqs, species, stage) : null;
    return ingredients.filter(function(i) { return selIngrs.has(i.id); }).map(function(i) {
      const base = Object.assign({}, i, { price: getSellPriceForIng(i) });
      if (species) {
        const effMax = getEffectiveMaxIncl(base, species, currentReq);
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

  // Effect: if preloaded formula, calculate its nutrients/cost on mount
  const [preloadHandled, setPreloadHandled] = useState(false);
  useEffect(function() {
    if (preload && preload.formula && !preloadHandled) {
      const ingrs = ingredients.filter(function(i) {
        return preload.formula[i.id] !== undefined;
      }).map(function(i) {
        const inv = inventory.find(function(x) { return x.id === i.id; });
        const sp = inv ? (inv.sellPriceDirect || Math.round((inv.lastPrice || 0) * (1 + (inv.margin || 20) / 100) * 100) / 100) : (i.price || 0);
        return Object.assign({}, i, { price: sp });
      });
      const n = calcNutrients(preload.formula, ingrs);
      const c = calcCost(preload.formula, ingrs);
      setNutrients(n);
      setCostPKg(c);
      setSolveQuality('optimal');
      if (preload.customerName) {
        showT('Loaded saved formula "' + (preload.name || preload.formulaName || '') + '" for ' + preload.customerName);
      }
      setPreloadHandled(true);
    }
  }, [preload, ingredients.length]);

  // Auto-solve on species/stage/selection change (skip if preload just loaded)
  useEffect(function() {
    if (!species || !stage) return;
    if (preload && !preloadHandled) return;
    if (preload && preloadHandled && formula === preload.formula) return; // skip first render after preload
    setFormula(null); setNutrients(null); setCostPKg(0);
    setAnfWarnings([]); setAnfExclusions([]); setBuySuggestions([]);
    setInfeasibleReason(''); setDiagnosticFormula(null);
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
      // FEASIBLE: nutrition fully met
      if (result && result.formula) {
        const n = calcNutrients(result.formula, ingrs);
        const c = calcCost(result.formula, ingrs);
        setFormula(result.formula);
        setNutrients(n);
        setCostPKg(c);
        setSolveQuality('optimal');
        const anfResult = checkANFWarnings(result.formula, ingrs, species, req);
        setAnfWarnings(anfResult.warnings);
        setAnfExclusions(anfResult.exclusions);
        setBuySuggestions([]);
        setInfeasibleReason('');
        setDiagnosticFormula(null);
      }
      // INFEASIBLE: nutrition cannot be met with current stock
      else if (result && result.infeasible) {
        setFormula(null);                              // No formula sold
        setNutrients(null);
        setCostPKg(0);
        setSolveQuality('infeasible');
        setAnfWarnings(result.warnings || []);
        setAnfExclusions([]);
        setInfeasibleReason(result.reason || 'Cannot meet nutritional targets');
        setDiagnosticFormula(result.diagnosticFormula || null);
        // Compute buy suggestions from the gaps
        if (result.gaps && Object.keys(result.gaps).length > 0) {
          const sugg = suggestIngredientsToBuy(result.gaps, ingredients, selIngrs);
          setBuySuggestions(sugg);
        } else {
          setBuySuggestions([]);
        }
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
        setSolveQuality('optimal');
        const anfResult = checkANFWarnings(result.formula, ingrs, species, req);
        setAnfWarnings(anfResult.warnings);
        setAnfExclusions(anfResult.exclusions);
        setBuySuggestions([]);
        setInfeasibleReason('');
        setDiagnosticFormula(null);
      } else if (result && result.infeasible) {
        setFormula(null);
        setNutrients(null);
        setCostPKg(0);
        setSolveQuality('infeasible');
        setAnfWarnings(result.warnings || []);
        setAnfExclusions([]);
        setInfeasibleReason(result.reason || 'Cannot meet nutritional targets');
        setDiagnosticFormula(result.diagnosticFormula || null);
        if (result.gaps && Object.keys(result.gaps).length > 0) {
          const sugg = suggestIngredientsToBuy(result.gaps, ingredients, selIngrs);
          setBuySuggestions(sugg);
        } else {
          setBuySuggestions([]);
        }
      } else {
        showT('Could not solve. Select more ingredients.', 'error');
      }
      setLoading(false);
    }, 300);
  }

  async function doSaveFormula() {
    if (!formula || !fName) return;
    const saved = (ctx.savedFormulas && ctx.savedFormulas.length) ? ctx.savedFormulas : db.get('savedFormulas', []);
    const rec = {
      id: uid(), name: fName, species: species, stage: stage,
      formula: formula, nutrients: nutrients, costPerKg: costPKg,
      customerId: custId || null,
      customerName: (customers.find(function(c) { return c.id === custId; }) || {}).name || '-',
      savedOn: today(), batchKg: batchKg
    };
    const next = saved.concat([rec]);
    if (ctx.setSavedFormulas) {
      ctx.setSavedFormulas(next);
    } else {
      db.set('savedFormulas', next);
    }
    const r = await serverPush('savedFormulas', next);
    setShowSave(false); setFName('');
    if (r && r.ok) {
      showT('Formula saved');
    } else {
      showT('Warning: saved locally only. Server is unreachable.', 'error');
    }
  }

  function doSaveFormula_SubSpec() {
    if (!diagnosticFormula) return;
    const name = window.prompt('Save this sub-spec formula as (e.g. "Budget broiler starter"):', '');
    if (!name) return;
    const saved = (ctx.savedFormulas && ctx.savedFormulas.length) ? ctx.savedFormulas : db.get('savedFormulas', []);
    const diagNutrients = calcNutrients(diagnosticFormula, ingredients);
    const diagCost = calcCost(diagnosticFormula, ingredients);
    const rec = {
      id: uid(), name: name, species: species, stage: stage,
      formula: diagnosticFormula, nutrients: diagNutrients, costPerKg: diagCost,
      customerId: custId || null,
      customerName: (customers.find(function(c) { return c.id === custId; }) || {}).name || '-',
      savedOn: today(), batchKg: batchKg,
      subSpec: true
    };
    const next = saved.concat([rec]);
    if (ctx.setSavedFormulas) {
      ctx.setSavedFormulas(next);
    } else {
      db.set('savedFormulas', next);
      serverPush('savedFormulas', next);
    }
    showT('Sub-spec formula saved');
  }

  // Shared sale initializer - used by both feasible and sub-spec paths
  function initSaleWithFormula(srcFormula, isSubSpec) {
    const ingrs = getActiveWithANF();
    const items = Object.entries(srcFormula).map(function(entry) {
      const id = entry[0], pct = entry[1];
      const ing = ingrs.find(function(x) { return x.id === id; }) || ingredients.find(function(x) { return x.id === id; });
      const inv = inventory.find(function(x) { return x.id === id; });
      const sp = getSellPriceForIng(ing || { id: id });
      const qty = (pct / 100) * batchKg;
      // Estimate buy cost via FIFO lot consumption (no mutation here)
      let buyPrice = 0;
      if (inv && (inv.lots || []).length > 0) {
        buyPrice = estimateLotCostFIFO(inv, qty);
      } else if (inv && inv.lastPrice) {
        buyPrice = inv.lastPrice;
      } else if (ing && ing.lastPrice) {
        buyPrice = ing.lastPrice;
      } else if (ing && ing.price) {
        buyPrice = ing.price;
      }
      return {
        id: id, name: ing ? ing.name : '(unknown)',
        pct: pct, qty: qty,
        sellPricePerKg: sp,
        buyPricePerKg: buyPrice,
        pricePerKg: sp, // legacy
        missingBuyPrice: buyPrice === 0
      };
    });
    const totalSellValue = items.reduce(function(s, i) { return s + i.qty * i.sellPricePerKg; }, 0);
    const totalBuyCost = items.reduce(function(s, i) { return s + i.qty * i.buyPricePerKg; }, 0);
    const missingCount = items.filter(function(i) { return i.missingBuyPrice; }).length;
    setPendingSale({
      items: items,
      totalSellValue: totalSellValue,
      totalBuyCost: totalBuyCost,
      totalCost: totalBuyCost,
      subSpec: !!isSubSpec,
      srcFormula: srcFormula,
      missingBuyPriceCount: missingCount
    });
    setShowSell(true);
  }

  function doInitSale() {
    if (!formula) return;
    initSaleWithFormula(formula, false);
  }

  function doInitSale_SubSpec() {
    if (!diagnosticFormula) return;
    initSaleWithFormula(diagnosticFormula, true);
  }

  function doConfirmSale() {
    if (!pendingSale || !selPrice) return;
    const insuff = pendingSale.items.filter(function(item) {
      const st = inventory.find(function(s) { return s.id === item.id; });
      return !st || availableQty(st) < item.qty;
    });
    if (insuff.length > 0) {
      showT('Insufficient stock: ' + insuff.map(function(i) { return i.name; }).join(', '), 'error');
      return;
    }
    // Consume lots FIFO for each line item, capturing real cost
    const consumptions = [];
    const enrichedItems = pendingSale.items.map(function(item) {
      const inv = inventory.find(function(s) { return s.id === item.id; });
      const r = consumeFromLots(inv, item.qty);
      consumptions.push({ itemId: item.id, newLots: r.newLots });
      const realCostPerKg = item.qty > 0 ? r.totalCost / item.qty : 0;
      return Object.assign({}, item, {
        buyPricePerKg: Math.round(realCostPerKg * 100) / 100,
        buyCostTotal: Math.round(r.totalCost * 100) / 100,
        lotsUsed: r.consumed
      });
    });
    const newInv = applyLotConsumptions(inventory, consumptions);
    setInventory(newInv);

    const realTotalBuyCost = enrichedItems.reduce(function(s, i) { return s + (i.buyCostTotal || 0); }, 0);
    const agreedTotal = parseFloat(selPrice) * batchKg;
    const cust = customers.find(function(c) { return c.id === custId; });
    const profit = agreedTotal - realTotalBuyCost;
    const isSubSpec = !!pendingSale.subSpec;
    const newSale = {
      id: uid(), date: today(), species: species, stage: stage, batchKg: batchKg,
      customerId: custId || null,
      customerName: cust ? cust.name : 'Walk-in',
      customer: cust ? cust.name : 'Walk-in',
      product: species + ' - ' + stage + (isSubSpec ? ' (SUB-SPEC)' : '') + ' (' + batchKg + 'kg)',
      cost: realTotalBuyCost,
      total: agreedTotal,
      totalRevenue: agreedTotal,
      totalCost: realTotalBuyCost,
      profit: profit,
      sellPricePerKg: parseFloat(selPrice),
      items: enrichedItems,
      formula: pendingSale.srcFormula || formula,
      subSpec: isSubSpec
    };
    setSales(sales.concat([newSale]));
    const ledger = db.get('stockLedger', []);
    const entry = {
      id: uid(), type: isSubSpec ? 'SALE-SUBSPEC' : 'SALE', date: today(), product: newSale.product,
      qty: batchKg, total: agreedTotal,
      buyCost: realTotalBuyCost,
      by: user ? user.name : ''
    };
    db.set('stockLedger', ledger.concat([entry]));
    serverPush('stockLedger', ledger.concat([entry]));
    setShowSell(false); setPendingSale(null); setSelPrice('');
    showT(isSubSpec ? 'Sub-spec sale recorded.' : 'Sale recorded. Stock updated.');
  }

  function getANFStatus(id) {
    if (!species) return 'neutral';
    const ing = ingredients.find(function(x) { return x.id === id; });
    if (!ing) return 'neutral';
    const req = (species && stage) ? getReqForStage(animalReqs, species, stage) : null;
    const cap = resolveMaxIncl(ing, req, species);
    if (cap === 0) return 'excluded';
    if (cap < 6) return 'caution';
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
    const statusIcon = over ? '\u{26A0}' : inRange ? '\u{2713}' : '\u{2717}';
    return h('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '1px solid ' + C.border,
        fontSize: 13
      }
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { fontSize: 14 } }, statusIcon),
        h('span', { style: { color: C.ink, fontWeight: 600 } }, p.label)
      ),
      h('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
        p.req ? h('span', {
          style: { fontSize: 11, color: C.muted, fontFamily: "'DM Mono',monospace" }
        }, 'target ' + p.req[0] + '-' + p.req[1]) : null,
        h('span', {
          style: {
            fontFamily: "'DM Mono',monospace",
            fontWeight: 700,
            color: color,
            minWidth: 75,
            textAlign: 'right'
          }
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
      padding: '9px 11px',
      borderRadius: 10,
      cursor: hasStock ? 'pointer' : 'not-allowed',
      userSelect: 'none',
      transition: 'all 0.15s',
      position: 'relative'
    }, baseStyle);
    const indicator = sel ? h('div', {
      style: { position: 'absolute', top: 5, right: 7, fontSize: 11, color: C.grass, fontWeight: 700 }
    }, '\u{2713}') : anfStat === 'excluded' ? h('div', {
      style: { position: 'absolute', top: 5, right: 7, fontSize: 11, color: C.danger, fontWeight: 700 }
    }, '\u{2717}') : anfStat === 'caution' ? h('div', {
      style: { position: 'absolute', top: 5, right: 7, fontSize: 11, color: C.warning, fontWeight: 700 }
    }, '!') : null;
    const stockText = hasStock
      ? fmt(inv.qty) + ' kg  \u{2022}  KES ' + getSellPriceForIng(ing) + '/kg'
      : 'Out of stock';
    return h('div', {
      key: ing.id,
      onClick: function() { if (hasStock) toggleI(ing.id); },
      style: cardStyle
    },
      indicator,
      h('div', {
        style: { fontSize: 12, fontWeight: 600, color: C.earth, lineHeight: 1.3, marginRight: 18 }
      }, ing.name),
      h('div', {
        style: { fontSize: 10, color: C.muted, marginTop: 3, fontFamily: "'DM Mono',monospace" }
      }, stockText)
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
    title: pendingSale.subSpec ? 'Confirm Sub-Spec Sale' : 'Confirm Sale',
    onClose: function() { setShowSell(false); },
    width: 520
  },
    // Sub-spec warning banner
    pendingSale.subSpec ? h('div', {
      style: {
        background: '#fff4e0',
        border: '2px solid ' + C.warning,
        borderRadius: 10,
        padding: '10px 14px',
        marginBottom: 14,
        fontSize: 12,
        color: C.ink,
        lineHeight: 1.5
      }
    },
      h('strong', { style: { color: C.warning, fontSize: 13 } }, '\u{26A0} Sub-Spec Mix'),
      h('div', { style: { marginTop: 4 } }, 'This mix does not meet all nutritional targets. You are selling it on your own judgement. The sale will be tagged as sub-spec in records.')
    ) : null,
    h('div', {
      style: { background: C.parchment, borderRadius: 10, padding: '12px 16px', marginBottom: 14 }
    },
      h('div', {
        style: { fontWeight: 700, color: C.earth, marginBottom: 6, fontFamily: "'Playfair Display',serif", fontSize: 16 }
      }, species + ' \u{2022} ' + stage + ' \u{2022} ' + batchKg + 'kg'),
      h('div', { style: { fontSize: 13, color: C.muted } },
        'Ingredients total (at sell prices): ',
        h('strong', { style: { color: C.earth, fontFamily: "'DM Mono',monospace" } },
          'KES ' + pendingSale.totalSellValue.toFixed(2))
      )
    ),
    // Show sell price breakdown only
    h('div', {
      style: { background: 'white', border: '1px solid ' + C.border, borderRadius: 10, padding: '10px 14px', marginBottom: 14, maxHeight: 180, overflowY: 'auto' }
    },
      h('div', {
        style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: 6, fontFamily: "'DM Mono',monospace" }
      }, 'Ingredient sell prices'),
      pendingSale.items.map(function(item, i) {
        return h('div', {
          key: i,
          style: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: i < pendingSale.items.length - 1 ? '1px solid ' + C.border : 'none' }
        },
          h('span', { style: { color: C.ink } }, item.name + ' (' + item.qty.toFixed(1) + ' kg)'),
          h('span', { style: { color: C.grass, fontFamily: "'DM Mono',monospace", fontWeight: 600 } },
            'KES ' + item.sellPricePerKg + '/kg')
        );
      })
    ),
    h(Inp, {
      label: 'Agreed Sell Price (KES/kg) - enter based on customer negotiation',
      value: selPrice,
      onChange: setSelPrice,
      type: 'number',
      placeholder: 'e.g. 65'
    }),
    selPrice ? (function() {
      const totalRevenue = parseFloat(selPrice) * batchKg;
      const totalBuyCost = pendingSale.totalBuyCost;
      const profit = totalRevenue - totalBuyCost;
      const marginPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
      const hasMissingBuyPrice = (pendingSale.missingBuyPriceCount || 0) > 0;
      return h('div', {
        style: { background: '#f0f9f4', borderRadius: 10, padding: '12px 16px', fontSize: 13, border: '1px solid ' + C.leaf + '44' }
      },
        h('div', { style: { marginBottom: 6 } },
          h('span', null, 'Total Revenue (' + batchKg + 'kg x KES ' + selPrice + '): '),
          h('strong', { style: { color: C.grass, fontFamily: "'DM Mono',monospace" } },
            'KES ' + totalRevenue.toFixed(2))
        ),
        h('div', { style: { marginBottom: 6 } },
          h('span', null, 'Total Buy Cost: '),
          h('strong', {
            style: { color: C.earth, fontFamily: "'DM Mono',monospace" }
          }, 'KES ' + totalBuyCost.toFixed(2))
        ),
        h('div', { style: { marginBottom: 6 } },
          h('span', null, 'Profit (revenue - buy cost): '),
          h('strong', {
            style: {
              color: profit > -1 ? C.grass : C.danger,
              fontFamily: "'DM Mono',monospace"
            }
          }, 'KES ' + profit.toFixed(2))
        ),
        h('div', null,
          h('span', null, 'Margin: '),
          h('strong', {
            style: {
              color: marginPct > -1 ? C.grass : C.danger,
              fontFamily: "'DM Mono',monospace"
            }
          }, marginPct.toFixed(1) + '%')
        ),
        hasMissingBuyPrice ? h('div', {
          style: {
            marginTop: 10, padding: '8px 11px', background: '#fff4e0',
            border: '1px solid ' + C.warning + '77', borderRadius: 8,
            color: C.earth, fontSize: 12, lineHeight: 1.5
          }
        },
          h('strong', { style: { color: C.warning } }, '\u{26A0} Profit may be overestimated. '),
          pendingSale.missingBuyPriceCount + ' ingredient' +
          (pendingSale.missingBuyPriceCount === 1 ? '' : 's') +
          ' in this mix ' + (pendingSale.missingBuyPriceCount === 1 ? 'has' : 'have') +
          ' no recorded buy price. Record a purchase in Inventory to fix this.'
        ) : null
      );
    })() : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
      h(Btn, { onClick: function() { setShowSell(false); }, variant: 'secondary' }, 'Cancel'),
      h(Btn, {
        onClick: doConfirmSale,
        variant: 'success',
        disabled: !selPrice || !Number(selPrice)
      }, '\u{2713} Customer Agreed - Record Sale')
    )
  ) : null;

  // Quality badge
  const qualityLabels = {
    optimal: '\u{2713} Optimal - all nutrients met',
    infeasible: '\u{2717} Cannot meet nutrition with current stock'
  };
  const qualityColors = {
    optimal: { bg: '#f0f9f4', color: C.grass, border: C.leaf },
    infeasible: { bg: '#fde8e8', color: C.danger, border: C.danger }
  };

  const qBadge = (solveQuality && qualityColors[solveQuality]) ? h('span', {
    style: Object.assign({
      fontSize: 12,
      padding: '6px 14px',
      borderRadius: 20,
      fontWeight: 600
    }, {
      background: qualityColors[solveQuality].bg,
      color: qualityColors[solveQuality].color,
      border: '1px solid ' + qualityColors[solveQuality].border
    })
  }, qualityLabels[solveQuality] || solveQuality) : null;

  // ANF warnings display
  const anfDisplay = (anfWarnings.length > 0 || anfExclusions.length > 0) ? h(Card, { style: { marginBottom: 14 } },
    h(CardTitle, null, '\u{26A0} Anti-Nutritional & Nutrient Warnings'),
    h('div', { style: { padding: '12px 16px' } },
      anfExclusions.map(function(e, i) {
        return h('div', {
          key: 'ex' + i,
          style: {
            display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8,
            background: '#fde8e8', border: '1px solid ' + C.danger + '44', marginBottom: 8
          }
        },
          h('span', { style: { fontSize: 18 } }, '\u{2717}'),
          h('div', null,
            h('div', {
              style: { fontWeight: 700, fontSize: 13, color: C.danger, marginBottom: 3 }
            }, e.ingredient + ' EXCLUDED - ' + e.factor),
            h('div', { style: { fontSize: 12, color: C.muted, lineHeight: 1.5 } }, e.note)
          )
        );
      }),
      anfWarnings.map(function(w, i) {
        const sev = w.severity === 'danger';
        return h('div', {
          key: 'w' + i,
          style: {
            display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 6,
            background: sev ? '#fde8e8' : '#fff8e6',
            border: '1px solid ' + (sev ? C.danger : C.harvest) + '44'
          }
        },
          h('span', { style: { fontSize: 18 } }, sev ? '\u{2717}' : '\u{26A0}'),
          h('div', null,
            h('div', {
              style: { fontWeight: 700, fontSize: 13, color: sev ? C.danger : C.savanna, marginBottom: 3 }
            }, w.ingredient + (w.factor ? ' - ' + w.factor : '') + (w.current ? ' at ' + w.current + '% (limit: ' + w.maxPct + '%)' : '')),
            h('div', { style: { fontSize: 12, color: C.muted, lineHeight: 1.5 } }, w.note)
          )
        );
      })
    )
  ) : null;

  // Calculate nutrients achieved by the diagnostic formula (if present)
  const diagnosticNutrients = diagnosticFormula ? calcNutrients(diagnosticFormula, ingredients) : null;
  const diagnosticCost = diagnosticFormula ? calcCost(diagnosticFormula, ingredients) : 0;

  // INFEASIBILITY CARD — shown when nutrition cannot be met
  const infeasibleCard = infeasibleReason ? h(Card, {
    style: { marginBottom: 14, border: '3px solid ' + C.danger }
  },
    h('div', {
      style: {
        background: 'linear-gradient(135deg,' + C.danger + ',#8b1f1f)',
        padding: '16px 20px',
        color: 'white'
      }
    },
      h('div', {
        style: { fontFamily: "'Playfair Display',serif", fontSize: 19, fontWeight: 700, marginBottom: 4 }
      }, '\u{26A0} Cannot Meet Nutritional Requirements'),
      h('div', { style: { fontSize: 13, opacity: 0.95 } }, infeasibleReason)
    ),
    h('div', { style: { padding: '16px 20px', background: '#fde8e8' } },
      h('div', {
        style: { fontSize: 13, color: C.ink, marginBottom: 14, lineHeight: 1.6 }
      },
        h('strong', null, 'This formula CANNOT be sold. '),
        'Selling an under-specified feed would harm the animals. Review the gaps and the best-achievable mix below to decide what to purchase.'),

      // Gaps detail
      anfWarnings.length > 0 ? h('div', {
        style: { background: 'white', borderRadius: 8, padding: '12px 14px', marginBottom: 14, border: '1px solid ' + C.danger + '66' }
      },
        h('div', {
          style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: C.danger, marginBottom: 8, fontFamily: "'DM Mono',monospace" }
        }, 'Why it won\'t work'),
        anfWarnings.map(function(w, i) {
          return h('div', {
            key: i,
            style: {
              fontSize: 12, color: C.ink, padding: '6px 0',
              borderBottom: i < anfWarnings.length - 1 ? '1px solid ' + C.border : 'none'
            }
          },
            h('strong', { style: { color: C.danger } }, w.nutrient + ': '),
            w.note
          );
        })
      ) : null
    ),

    // Best-achievable mix panel
    diagnosticFormula && diagnosticNutrients ? h('div', null,
      h('div', {
        style: {
          background: 'linear-gradient(135deg,' + C.warning + ',#c15e00)',
          padding: '12px 20px',
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }
      },
        h('div', null,
          h('div', {
            style: { fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700 }
          }, '\u{1F4CB} Best Achievable Mix'),
          h('div', {
            style: { fontSize: 11, opacity: 0.95, marginTop: 2 }
          }, 'Closest possible to your targets \u{2022} NOT SAFE TO SELL')
        ),
        h('div', {
          style: {
            padding: '6px 14px',
            background: 'rgba(0,0,0,0.25)',
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "'DM Mono',monospace",
            letterSpacing: 1.5,
            textTransform: 'uppercase'
          }
        }, 'NOT SELLABLE')
      ),
      // Ingredient table
      h('div', { style: { padding: '14px 20px', background: 'white' } },
        h('div', {
          style: { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8, fontFamily: "'DM Mono',monospace" }
        }, 'Ingredients (' + batchKg + ' kg batch)'),
        h('table', {
          style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
        },
          h('thead', null,
            h('tr', { style: { borderBottom: '2px solid ' + C.border } },
              h('th', { style: { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: C.muted, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1 } }, 'Ingredient'),
              h('th', { style: { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: C.muted, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1 } }, '%'),
              h('th', { style: { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: C.muted, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1 } }, 'kg')
            )
          ),
          h('tbody', null,
            Object.entries(diagnosticFormula)
              .sort(function(a, b) { return b[1] - a[1]; })
              .map(function(entry, i) {
                const ing = ingredients.find(function(x) { return x.id === entry[0]; });
                const kg = entry[1] * batchKg / 100;
                return h('tr', {
                  key: i,
                  style: { borderBottom: '1px solid ' + C.border, background: i % 2 === 0 ? 'white' : C.cream }
                },
                  h('td', { style: { padding: '7px 8px', color: C.earth, fontWeight: 600 } }, ing ? ing.name : entry[0]),
                  h('td', { style: { padding: '7px 8px', textAlign: 'right', fontFamily: "'DM Mono',monospace", fontWeight: 700 } }, entry[1].toFixed(2) + '%'),
                  h('td', { style: { padding: '7px 8px', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: C.muted } }, kg.toFixed(2))
                );
              })
          )
        )
      ),

      // Nutrient comparison — targets vs achieved with gap highlighting
      h('div', { style: { padding: '14px 20px', background: C.cream, borderTop: '1px solid ' + C.border } },
        h('div', {
          style: { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8, fontFamily: "'DM Mono',monospace" }
        }, 'Nutrients achieved vs targets'),
        h('table', {
          style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
        },
          h('thead', null,
            h('tr', { style: { borderBottom: '2px solid ' + C.border } },
              h('th', { style: { textAlign: 'left', padding: '5px 8px', fontSize: 10, color: C.muted, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1 } }, 'Nutrient'),
              h('th', { style: { textAlign: 'right', padding: '5px 8px', fontSize: 10, color: C.muted, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1 } }, 'Target'),
              h('th', { style: { textAlign: 'right', padding: '5px 8px', fontSize: 10, color: C.muted, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1 } }, 'Achieved'),
              h('th', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 10, color: C.muted, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1 } }, 'Status')
            )
          ),
          h('tbody', null,
            (function() {
              const NUT_INFO = [
                { key: 'cp', label: 'Crude Protein', unit: '%' },
                { key: 'me', label: 'Metabolisable Energy', unit: 'kcal/kg' },
                { key: 'fat', label: 'Fat', unit: '%' },
                { key: 'fibre', label: 'Fibre', unit: '%' },
                { key: 'ca', label: 'Calcium', unit: '%' },
                { key: 'p', label: 'Phosphorus', unit: '%' },
                { key: 'lys', label: 'Lysine', unit: '%' },
                { key: 'met', label: 'Methionine', unit: '%' }
              ];
              return NUT_INFO.filter(function(n) {
                return reqs && reqs[n.key] && Array.isArray(reqs[n.key]);
              }).map(function(nut, i) {
                const tgt = reqs[nut.key];
                const val = diagnosticNutrients[nut.key];
                const ok = val >= tgt[0] * 0.99 && val <= tgt[1] * 1.01;
                const low = val < tgt[0] * 0.99;
                const fmt = nut.unit === 'kcal/kg' ? function(v) { return Math.round(v); } : function(v) { return v.toFixed(2); };
                return h('tr', {
                  key: nut.key,
                  style: { borderBottom: '1px solid ' + C.border }
                },
                  h('td', { style: { padding: '5px 8px', color: C.ink } }, nut.label),
                  h('td', { style: { padding: '5px 8px', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: C.muted } },
                    fmt(tgt[0]) + '\u2013' + fmt(tgt[1]) + ' ' + nut.unit),
                  h('td', {
                    style: {
                      padding: '5px 8px', textAlign: 'right', fontFamily: "'DM Mono',monospace", fontWeight: 700,
                      color: ok ? C.grass : C.danger,
                      background: ok ? '' : '#ffebeb'
                    }
                  }, fmt(val) + ' ' + nut.unit),
                  h('td', {
                    style: {
                      padding: '5px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700,
                      color: ok ? C.grass : (low ? C.danger : C.warning)
                    }
                  }, ok ? '\u2713 OK' : (low ? 'LOW' : 'HIGH'))
                );
              });
            })()
          )
        ),
        h('div', {
          style: { marginTop: 12, padding: '10px 14px', background: 'white', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
        },
          h('span', { style: { fontSize: 12, color: C.muted } }, 'Reference cost of this mix'),
          h('span', { style: { fontSize: 14, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: C.earth } },
            'KES ' + diagnosticCost.toFixed(2) + ' / kg')
        ),
        // Action row — sell sub-spec mix (user's judgment)
        h('div', {
          style: {
            marginTop: 10, padding: '10px 14px', background: C.cream, borderRadius: 8,
            display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap'
          }
        },
          h(Btn, {
            onClick: function() { doSaveFormula_SubSpec(); },
            variant: 'secondary',
            size: 'sm'
          }, '\u{1F4BE} Save Sub-Spec Formula'),
          h(Btn, {
            onClick: function() { doInitSale_SubSpec(); },
            variant: 'warn',
            size: 'sm'
          }, '\u{1F4B0} Sell Sub-Spec Mix')
        )
      )
    ) : null
  ) : null;

  // "What to buy" suggestions card
  const buySuggestionsCard = buySuggestions.length > 0 ? h(Card, { style: { marginBottom: 14, border: '2px solid ' + C.savanna } },
    h('div', {
      style: {
        background: 'linear-gradient(135deg,' + C.savanna + ',' + C.harvest + ')',
        padding: '14px 18px',
        color: 'white'
      }
    },
      h('div', {
        style: { fontFamily: "'Playfair Display',serif", fontSize: 17, fontWeight: 700, marginBottom: 3 }
      }, '\u{1F4A1} Recommended Ingredients to Purchase'),
      h('div', {
        style: { fontSize: 12, opacity: 0.9 }
      }, 'Adding these will help meet the nutritional gaps in your current stock')
    ),
    h('div', { style: { padding: '14px 18px' } },
      buySuggestions.map(function(s, i) {
        return h('div', {
          key: i,
          style: { marginBottom: i < buySuggestions.length - 1 ? 16 : 0 }
        },
          h('div', {
            style: {
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              color: C.soil,
              marginBottom: 8,
              fontFamily: "'DM Mono',monospace"
            }
          }, 'To boost ' + s.nutrientLabel + (s.shortfall ? ' (short by ' + s.shortfall.toFixed(2) + ')' : '')),
          h('div', {
            style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }
          },
            s.candidates.map(function(c, ci) {
              return h('div', {
                key: ci,
                style: {
                  background: C.cream,
                  border: '1px solid ' + C.border,
                  borderRadius: 10,
                  padding: '10px 12px'
                }
              },
                h('div', {
                  style: { fontSize: 13, fontWeight: 700, color: C.earth, marginBottom: 4 }
                }, c.ingredient.name),
                h('div', {
                  style: { fontSize: 11, color: C.muted, fontFamily: "'DM Mono',monospace" }
                }, s.nutrientLabel + ': ' + c.nutrientValue.toFixed(1) +
                   (c.price > 0 ? ' \u{2022} ~KES ' + c.price + '/kg' : ''))
              );
            })
          )
        );
      })
    )
  ) : null;

  const formulaCard = (formula && nutrients) ? h(Card, { style: { marginBottom: 14 } },
    h('div', {
      style: {
        background: 'linear-gradient(135deg,' + C.earth + ',' + C.soil + ')',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    },
      h('div', null,
        h('div', {
          style: { fontFamily: "'Playfair Display',serif", fontSize: 18, color: 'white', fontWeight: 700 }
        }, species + ' \u{2022} ' + stage),
        h('div', {
          style: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 3 }
        }, batchKg + 'kg batch \u{2022} ' + formulaRows.length + ' ingredients')
      ),
      h('div', { style: { textAlign: 'right' } },
        h('div', {
          style: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 2 }
        }, 'Ingredient sell value'),
        h('div', {
          style: { fontSize: 26, fontFamily: "'Playfair Display',serif", fontWeight: 900, color: C.harvest }
        }, 'KES ' + costPKg.toFixed(2) + '/kg'),
        h('div', {
          style: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: "'DM Mono',monospace" }
        }, 'Batch total: KES ' + (costPKg * batchKg).toFixed(0))
      )
    ),
    h(Tbl, {
      cols: [
        { key: 'name', label: 'Ingredient' },
        { key: 'dpct', label: '%', render: function(r) {
          return h('span', { style: { fontFamily: "'DM Mono',monospace", fontWeight: 700 } }, r.dpct + '%');
        }},
        { key: 'qty', label: 'Qty (kg)', render: function(r) {
          return h('span', { style: { fontFamily: "'DM Mono',monospace" } }, r.qty.toFixed(1));
        }},
        { key: 'sellPricePerKg', label: 'Price/kg', render: function(r) {
          return h('span', {
            style: { color: C.grass, fontWeight: 700, fontFamily: "'DM Mono',monospace" }
          }, 'KES ' + r.sellPricePerKg);
        }},
        { key: 'sellCost', label: 'Subtotal', render: function(r) {
          return h('span', { style: { fontFamily: "'DM Mono',monospace", fontWeight: 600 } }, 'KES ' + r.sellCost.toFixed(0));
        }},
        { key: 'stock', label: 'Stock', render: function(r) {
          const inv = inventory.find(function(x) { return x.id === r.id; });
          const ok = inv && inv.qty >= r.qty;
          return h(Badge, { color: ok ? C.grass : C.danger }, ok ? '\u{2713} OK' : '\u{2717} Low');
        }}
      ],
      rows: formulaRows,
      emptyMsg: ''
    }),
    h('div', {
      style: {
        padding: '14px 18px',
        borderTop: '1px solid ' + C.border,
        display: 'flex',
        gap: 10,
        justifyContent: 'flex-end',
        background: C.parchment
      }
    },
      h(Btn, { onClick: function() { setShowSave(true); }, variant: 'secondary' }, '\u{1F4BE} Save Formula'),
      h(Btn, { onClick: doInitSale, variant: 'success' }, '\u{1F4B0} Sell This Batch')
    )
  ) : null;

  const nutrientCard = (formula && nutrients && reqs) ? h(Card, null,
    h(CardTitle, null, '\u{1F4CA} Nutritional Analysis'),
    h('div', { style: { padding: '8px 18px 14px' } },
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
      title: '\u{1F9EA} Feed Formulator',
      subtitle: 'Nutrition-first optimisation - meet animal requirements at lowest cost'
    }),
    // Animal + Settings row at top - full width
    h(Card, { style: { marginBottom: 16 } },
      h(CardTitle, null, 'Step 1 - Animal & Batch'),
      h('div', {
        style: { padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }
      },
        h(Sel, {
          label: 'Species',
          value: species,
          onChange: function(v) { setSpecies(v); setStage(''); setFormula(null); },
          options: [{ value: '', label: 'Select species...' }].concat(
            speciesList.map(function(s) { return { value: s.value, label: (s.icon || '\u{1F43E}') + ' ' + s.label }; })
          )
        }),
        h(Sel, {
          label: 'Production Stage',
          value: stage,
          onChange: function(v) { setStage(v); setFormula(null); },
          options: [{ value: '', label: 'Select stage...' }].concat(
            stages.map(function(s) { return { value: s, label: s }; })
          ),
          disabled: !species
        }),
        h(Inp, {
          label: 'Batch Size (kg)',
          value: batchKg,
          onChange: function(v) { setBatchKg(parseFloat(v) || 100); },
          type: 'number'
        }),
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
    // Ingredients selection - full width
    h(Card, { style: { marginBottom: 16 } },
      h(CardTitle, {
        action: h('div', { style: { display: 'flex', gap: 6 } },
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
        )
      }, 'Step 2 - Ingredients (' + selIngrs.size + ' of ' + availableIngredients.length + ' in stock)'),
      h('div', { style: { padding: '14px 16px' } },
        h('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))',
            gap: 8
          }
        }, ingCards)
      )
    ),
    // Formulate button + quality badge
    h('div', {
      style: {
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        marginBottom: 16,
        padding: '12px 16px',
        background: 'white',
        border: '1px solid ' + C.border,
        borderRadius: 12
      }
    },
      h(Btn, {
        onClick: doFormulate,
        variant: 'success',
        disabled: loading || !species || !stage,
        size: 'lg'
      }, loading ? '\u{1F504} Solving...' : '\u{1F9EA} Formulate'),
      qBadge,
      (!species || !stage) ? h('span', {
        style: { fontSize: 13, color: C.muted, fontStyle: 'italic' }
      }, 'Select species and stage to begin') : null
    ),
    // Main results area
    anfDisplay,
    infeasibleCard,
    buySuggestionsCard,
    formulaCard,
    nutrientCard
  );
}
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
    h(PageHdr, { title: '\u{1F4B0} Sales Records', subtitle: 'All confirmed feed sales' }),
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
  const customers = ctx.customers || [];

  const [period, setPeriod] = useState('30');

  const periodDays = parseInt(period);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);
  const filtered = sales.filter(function(s) { return new Date(s.date) >= cutoff; });
  const rev = filtered.reduce(function(s, x) { return s + (x.total || x.totalRevenue || 0); }, 0);
  const cost = filtered.reduce(function(s, x) { return s + (x.cost || x.totalCost || 0); }, 0);
  const profit = rev - cost;
  const marginPct = rev > 0 ? (profit / rev) * 100 : 0;
  const avgSale = filtered.length > 0 ? rev / filtered.length : 0;

  // Previous period comparison
  const prevCutoff = new Date();
  prevCutoff.setDate(prevCutoff.getDate() - periodDays * 2);
  const prevFiltered = sales.filter(function(s) {
    const d = new Date(s.date);
    return d >= prevCutoff && d < cutoff;
  });
  const prevRev = prevFiltered.reduce(function(s, x) { return s + (x.total || x.totalRevenue || 0); }, 0);
  const revChange = prevRev > 0 ? ((rev - prevRev) / prevRev) * 100 : (rev > 0 ? 100 : 0);

  // Top selling products
  const productCounts = {};
  filtered.forEach(function(s) {
    const key = s.product || 'Unknown';
    if (!productCounts[key]) productCounts[key] = { revenue: 0, count: 0, kg: 0, profit: 0 };
    productCounts[key].revenue += s.total || s.totalRevenue || 0;
    productCounts[key].count += 1;
    productCounts[key].kg += s.batchKg || 0;
    productCounts[key].profit += s.profit || 0;
  });
  const topProducts = Object.entries(productCounts)
    .sort(function(a, b) { return b[1].revenue - a[1].revenue; })
    .slice(0, 10);

  // Top customers
  const customerCounts = {};
  filtered.forEach(function(s) {
    const key = s.customerName || s.customer || 'Walk-in';
    if (!customerCounts[key]) customerCounts[key] = { revenue: 0, count: 0, profit: 0 };
    customerCounts[key].revenue += s.total || s.totalRevenue || 0;
    customerCounts[key].count += 1;
    customerCounts[key].profit += s.profit || 0;
  });
  const topCustomers = Object.entries(customerCounts)
    .sort(function(a, b) { return b[1].revenue - a[1].revenue; })
    .slice(0, 10);

  // Daily revenue trend (simple bar chart data)
  const dailyRev = {};
  filtered.forEach(function(s) {
    const d = s.date;
    dailyRev[d] = (dailyRev[d] || 0) + (s.total || s.totalRevenue || 0);
  });
  const dailySorted = Object.entries(dailyRev).sort(function(a, b) { return a[0].localeCompare(b[0]); });
  const maxDaily = Math.max.apply(null, dailySorted.map(function(d) { return d[1]; }).concat([1]));

  // Ingredient usage breakdown (from sales items if available)
  const ingUsage = {};
  filtered.forEach(function(s) {
    if (s.items && Array.isArray(s.items)) {
      s.items.forEach(function(item) {
        if (!ingUsage[item.name]) ingUsage[item.name] = { kg: 0, revenue: 0 };
        ingUsage[item.name].kg += item.qty || 0;
        ingUsage[item.name].revenue += (item.qty || 0) * (item.pricePerKg || 0);
      });
    }
  });
  const topIngredients = Object.entries(ingUsage)
    .sort(function(a, b) { return b[1].kg - a[1].kg; })
    .slice(0, 10);

  async function exportReport() {
    const headers = ['Metric', 'Value'];
    const rows = [
      headers,
      ['Period', 'Last ' + period + ' days'],
      ['Total Sales', filtered.length],
      ['Total Revenue', rev],
      ['Total Cost', cost],
      ['Total Profit', profit],
      ['Margin %', marginPct.toFixed(2)],
      ['Average Sale', avgSale],
      ['Change vs previous period %', revChange.toFixed(2)],
      [''],
      ['Top Products', ''],
      ['Product', 'Revenue', 'Sales', 'Kg', 'Profit'],
    ];
    topProducts.forEach(function(p) {
      rows.push([p[0], p[1].revenue, p[1].count, p[1].kg, p[1].profit]);
    });
    rows.push(['']);
    rows.push(['Top Customers', '']);
    rows.push(['Customer', 'Revenue', 'Sales', 'Profit']);
    topCustomers.forEach(function(c) {
      rows.push([c[0], c[1].revenue, c[1].count, c[1].profit]);
    });
    rows.push(['']);
    rows.push(['Daily Revenue']);
    rows.push(['Date', 'Revenue']);
    dailySorted.forEach(function(d) { rows.push([d[0], d[1]]); });
    await exportToExcel(rows, 'wamifugo_report_' + today() + '.xlsx', 'Report');
  }

  const trendBars = dailySorted.length > 0 ? h('div', {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 3,
      height: 120,
      padding: '14px 16px 8px',
      background: C.cream,
      borderRadius: 8,
      overflowX: 'auto'
    }
  },
    dailySorted.map(function(d) {
      const height = Math.max(6, (d[1] / maxDaily) * 100);
      return h('div', {
        key: d[0],
        title: d[0] + ': ' + fmtKES(d[1]),
        style: {
          flex: '1 1 14px',
          minWidth: 14,
          maxWidth: 40,
          height: height + '%',
          background: 'linear-gradient(to top, ' + C.earth + ', ' + C.clay + ')',
          borderRadius: '4px 4px 0 0',
          cursor: 'pointer',
          transition: 'opacity 0.2s',
          position: 'relative'
        }
      });
    })
  ) : h('div', {
    style: { padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }
  }, 'No sales data for this period');

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: '\u{1F4C8} Reports & Analytics',
      subtitle: 'Business performance insights',
      action: h('div', { style: { display: 'flex', gap: 8 } },
        h(Sel, {
          value: period,
          onChange: setPeriod,
          options: [
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' },
            { value: '365', label: 'Last year' }
          ]
        }),
        h(Btn, { onClick: exportReport, variant: 'success' }, '\u{1F4E5} Export Excel')
      )
    }),
    // Top stats
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 18 } },
      h(StatCard, { label: 'Sales Count', value: filtered.length, color: C.earth, icon: '\u{1F6D2}' }),
      h(StatCard, {
        label: 'Revenue',
        value: fmtKES(rev),
        sub: (revChange > -1 ? '+' : '') + revChange.toFixed(1) + '% vs prev',
        color: C.grass, icon: '\u{1F4B0}'
      }),
      h(StatCard, { label: 'Total Cost', value: fmtKES(cost), color: C.warning, icon: '\u{1F4B5}' }),
      h(StatCard, {
        label: 'Profit',
        value: fmtKES(profit),
        sub: marginPct.toFixed(1) + '% margin',
        color: profit > -1 ? C.grass : C.danger,
        icon: '\u{1F4C8}'
      }),
      h(StatCard, { label: 'Average Sale', value: fmtKES(avgSale), color: C.clay, icon: '\u{1F4CA}' })
    ),
    // Trend chart
    h(Card, { style: { marginBottom: 16 } },
      h(CardTitle, null, '\u{1F4C5} Daily Revenue Trend'),
      trendBars
    ),
    // Two column grid for top products and customers
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 14, marginBottom: 14 } },
      h(Card, null,
        h(CardTitle, null, '\u{1F3C6} Top Products by Revenue'),
        h('div', { style: { padding: '10px 4px' } },
          topProducts.length === 0
            ? h('div', { style: { textAlign: 'center', padding: 30, color: C.muted } }, 'No data for this period')
            : topProducts.map(function(p, i) {
                return h('div', {
                  key: p[0],
                  style: {
                    display: 'grid',
                    gridTemplateColumns: '28px 1fr auto auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '9px 14px',
                    borderBottom: i === topProducts.length - 1 ? 'none' : '1px solid ' + C.border
                  }
                },
                  h('div', {
                    style: { fontSize: 13, fontWeight: 700, color: C.muted, fontFamily: "'DM Mono',monospace" }
                  }, String(i + 1) + '.'),
                  h('div', null,
                    h('div', { style: { fontSize: 13, color: C.earth, fontWeight: 600 } }, p[0]),
                    h('div', { style: { fontSize: 11, color: C.muted, marginTop: 2 } },
                      p[1].count + ' sales \u2022 ' + fmt(p[1].kg) + ' kg')
                  ),
                  h('div', { style: { fontSize: 13, color: C.grass, fontWeight: 700, fontFamily: "'DM Mono',monospace" } },
                    fmtKES(p[1].revenue))
                );
              })
        )
      ),
      h(Card, null,
        h(CardTitle, null, '\u{1F465} Top Customers'),
        h('div', { style: { padding: '10px 4px' } },
          topCustomers.length === 0
            ? h('div', { style: { textAlign: 'center', padding: 30, color: C.muted } }, 'No data for this period')
            : topCustomers.map(function(c, i) {
                return h('div', {
                  key: c[0],
                  style: {
                    display: 'grid',
                    gridTemplateColumns: '28px 1fr auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '9px 14px',
                    borderBottom: i === topCustomers.length - 1 ? 'none' : '1px solid ' + C.border
                  }
                },
                  h('div', {
                    style: { fontSize: 13, fontWeight: 700, color: C.muted, fontFamily: "'DM Mono',monospace" }
                  }, String(i + 1) + '.'),
                  h('div', null,
                    h('div', { style: { fontSize: 13, color: C.earth, fontWeight: 600 } }, c[0]),
                    h('div', { style: { fontSize: 11, color: C.muted, marginTop: 2 } },
                      c[1].count + ' sales \u2022 profit ' + fmtKES(c[1].profit))
                  ),
                  h('div', { style: { fontSize: 13, color: C.grass, fontWeight: 700, fontFamily: "'DM Mono',monospace" } },
                    fmtKES(c[1].revenue))
                );
              })
        )
      )
    ),
    // Ingredient usage if we have data
    topIngredients.length > 0 ? h(Card, null,
      h(CardTitle, null, '\u{1F33D} Ingredient Usage (from sales)'),
      h(Tbl, {
        cols: [
          { key: 'name', label: 'Ingredient', render: function(r) { return r.name; } },
          { key: 'kg', label: 'Kg Sold', render: function(r) { return h('span', { style: { fontFamily: "'DM Mono',monospace" } }, fmt(r.kg, 1) + ' kg'); } },
          { key: 'revenue', label: 'Revenue', render: function(r) { return h('span', { style: { color: C.grass, fontWeight: 700, fontFamily: "'DM Mono',monospace" } }, fmtKES(r.revenue)); } }
        ],
        rows: topIngredients.map(function(e) { return { name: e[0], kg: e[1].kg, revenue: e[1].revenue }; }),
        emptyMsg: 'No ingredient data'
      })
    ) : null
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
      title: '\u{1F33E} Feeding Quantity Guide',
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
      title: '\u{1F4D6} Education Screen',
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
  const ctx = useContext(Ctx);
  const ingredients = ctx.ingredients || [];
  const [reqs, setReqs] = useState(function() { return getAnimalReqs(db.get('animalReqs')); });
  const [showForm, setShowForm] = useState(false);
  const [editReq, setEditReq] = useState(null);
  const [filterCat, setFilterCat] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importStatus, setImportStatus] = useState(null);

  const blank = {
    category: '', stage: '',
    cp: [0, 0], me: [0, 0], fat: [0, 0], fibre: [0, 0],
    ca: [0, 0], p: [0, 0], lys: [0, 0], met: [0, 0],
    inclusionOverrides: {}
  };
  const [form, setForm] = useState(blank);

  function saveAll(newReqs) {
    setReqs(newReqs);
    db.set('animalReqs', newReqs);
    serverPush('animalReqs', newReqs);
  }

  function openAdd() {
    // Start with blank but no overrides until species is chosen — populated below
    setForm(Object.assign({}, blank, { inclusionOverrides: {} }));
    setEditReq(null);
    setShowForm(true);
  }
  function openEdit(r) {
    // Preserve existing overrides; if none, populate from ANF defaults so user can see/edit them
    const existing = r.inclusionOverrides && Object.keys(r.inclusionOverrides).length > 0
      ? r.inclusionOverrides
      : getDefaultOverridesForSpecies(r.category);
    setForm(Object.assign({}, r, { inclusionOverrides: Object.assign({}, existing) }));
    setEditReq(r);
    setShowForm(true);
  }

  // When the species changes on a NEW requirement form, auto-populate overrides
  function handleSpeciesChange(newCat) {
    setForm(function(prev) {
      const next = Object.assign({}, prev, { category: newCat });
      // Only auto-populate if user is creating new (no editReq) AND overrides are empty
      if (!editReq && (!prev.inclusionOverrides || Object.keys(prev.inclusionOverrides).length === 0)) {
        next.inclusionOverrides = getDefaultOverridesForSpecies(newCat);
      }
      return next;
    });
  }

  function setOverride(ingId, val) {
    const cur = Object.assign({}, form.inclusionOverrides || {});
    if (val === '' || val == null) {
      delete cur[ingId];
    } else {
      const n = parseFloat(val);
      if (!isNaN(n)) cur[ingId] = Math.max(0, Math.min(100, n));
    }
    setForm(Object.assign({}, form, { inclusionOverrides: cur }));
  }

  function removeOverride(ingId) {
    const cur = Object.assign({}, form.inclusionOverrides || {});
    delete cur[ingId];
    setForm(Object.assign({}, form, { inclusionOverrides: cur }));
  }

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

  async function handleReqsImport(file) {
    if (!file) return;
    setImportStatus({ type: 'loading', msg: 'Reading Excel file...' });
    try {
      const result = await readExcelFile(file);
      const rows = result.rows || [];
      if (rows.length === 0) {
        setImportStatus({ type: 'error', msg: 'The file has no data rows.' });
        return;
      }
      const norm = function(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); };
      const imported = [];
      const errors = [];
      rows.forEach(function(row, i) {
        const keys = Object.keys(row);
        const get = function(possibleNames) {
          for (const name of possibleNames) {
            const k = keys.find(function(x) { return norm(x) === norm(name); });
            if (k) return row[k];
          }
          return null;
        };
        const category = get(['category', 'species']);
        const stage = get(['stage', 'productionstage']);
        if (!category || !stage) { errors.push('Row ' + (i + 2) + ': missing category or stage'); return; }
        const parseRange = function(min, max) {
          return [parseFloat(min) || 0, parseFloat(max) || 0];
        };
        imported.push({
          id: 'ar_' + uid(),
          category: String(category).trim(),
          stage: String(stage).trim(),
          cp: parseRange(get(['cpmin', 'cpminpercent']), get(['cpmax', 'cpmaxpercent'])),
          me: parseRange(get(['memin', 'memin']), get(['memax', 'memaxkcalkg'])),
          fat: parseRange(get(['fatmin']), get(['fatmax'])),
          fibre: parseRange(get(['fibremin', 'fibermin']), get(['fibremax', 'fibermax'])),
          ca: parseRange(get(['camin', 'calciummin']), get(['camax', 'calciummax'])),
          p: parseRange(get(['pmin', 'phosphorusmin']), get(['pmax', 'phosphorusmax'])),
          lys: parseRange(get(['lysmin', 'lysinemin']), get(['lysmax', 'lysinemax'])),
          met: parseRange(get(['metmin', 'methioninemin']), get(['metmax', 'methioninemax']))
        });
      });
      if (imported.length === 0) {
        setImportStatus({ type: 'error', msg: 'No valid rows. ' + errors.slice(0, 3).join('; ') });
        return;
      }
      // Merge: update existing rows with same category+stage, add new
      const byKey = function(r) { return r.category.toLowerCase() + '|' + r.stage.toLowerCase(); };
      const existingKeys = new Set(reqs.map(byKey));
      const toAdd = imported.filter(function(i) { return !existingKeys.has(byKey(i)); });
      const toUpdate = imported.filter(function(i) { return existingKeys.has(byKey(i)); });
      let updated = reqs.slice();
      toUpdate.forEach(function(n) {
        updated = updated.map(function(x) {
          if (byKey(x) === byKey(n)) return Object.assign({}, x, n, { id: x.id });
          return x;
        });
      });
      updated = updated.concat(toAdd);
      saveAll(updated);
      setImportStatus({
        type: 'success',
        msg: 'Imported ' + imported.length + ' requirements (' + toAdd.length + ' new, ' + toUpdate.length + ' updated)' + (errors.length > 0 ? '. ' + errors.length + ' rows skipped.' : '')
      });
      setTimeout(function() { setShowImport(false); setImportStatus(null); }, 2500);
    } catch (e) {
      setImportStatus({ type: 'error', msg: e.message || 'Import failed' });
    }
  }

  function downloadReqsTemplate() {
    const headers = ['Category', 'Stage',
      'CP Min', 'CP Max', 'ME Min', 'ME Max',
      'Fat Min', 'Fat Max', 'Fibre Min', 'Fibre Max',
      'Ca Min', 'Ca Max', 'P Min', 'P Max',
      'Lys Min', 'Lys Max', 'Met Min', 'Met Max'];
    const sample = [
      ['Poultry (Broiler)', 'Starter (0-21 days)', 22, 24, 2950, 3050, 3, 8, 0, 4, 0.9, 1.05, 0.45, 0.55, 1.25, 1.45, 0.5, 0.6],
      ['Dairy Cattle', 'Lactating', 14, 18, 2500, 2800, 3, 6, 15, 25, 0.6, 1, 0.3, 0.5, 0.6, 0.8, 0.2, 0.3]
    ];
    exportToExcel([headers].concat(sample), 'animal_requirements_template.xlsx', 'Requirements');
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
    width: 640
  },
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
      h(Inp, { label: 'Category', value: form.category, onChange: handleSpeciesChange, placeholder: 'e.g. Poultry (Broiler)' }),
      h(Inp, { label: 'Stage', value: form.stage, onChange: function(v) { setForm(Object.assign({}, form, { stage: v })); }, placeholder: 'e.g. Starter (0-21 days)' })
    ),
    h('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 6, marginTop: 16 } }, 'Nutrient Targets (min-max)'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 } },
      rangeField('cp', 'CP % (min-max)'),
      rangeField('me', 'ME kcal/kg'),
      rangeField('fat', 'Fat %'),
      rangeField('fibre', 'Fibre %'),
      rangeField('ca', 'Ca %'),
      rangeField('p', 'P %'),
      rangeField('lys', 'Lys %'),
      rangeField('met', 'Met %')
    ),
    // Inclusion overrides editor
    (function() {
      const overrides = form.inclusionOverrides || {};
      const overrideEntries = Object.entries(overrides);
      // Available ingredients to add: those with an antiNote (likely ANF) OR not already in overrides
      const usedIds = new Set(Object.keys(overrides));
      const candidates = ingredients.filter(function(i) { return !usedIds.has(i.id); });
      return h('div', null,
        h('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, marginBottom: 6, marginTop: 16 } }, 'Ingredient Inclusion Overrides'),
        h('div', { style: { fontSize: 11, color: C.muted, fontStyle: 'italic', marginBottom: 8 } },
          'Maximum % of mix this stage may contain of each ingredient. Use 0 to exclude entirely. Leave blank to use the ingredient\'s default cap.'),
        overrideEntries.length === 0 ? h('div', {
          style: { padding: 16, background: C.cream, borderRadius: 8, fontSize: 12, color: C.muted, textAlign: 'center' }
        }, 'No overrides set. Defaults from anti-nutritive references will apply automatically.') : null,
        overrideEntries.map(function(entry) {
          const id = entry[0];
          const cap = entry[1];
          const ing = ingredients.find(function(x) { return x.id === id; });
          const name = ing ? ing.name : id;
          return h('div', {
            key: id,
            style: { display: 'grid', gridTemplateColumns: '1fr 90px 30px', gap: 8, alignItems: 'center', marginBottom: 6, padding: '6px 10px', background: C.cream, borderRadius: 8 }
          },
            h('div', { style: { fontSize: 13, color: C.earth } }, name),
            h('input', {
              type: 'number',
              value: cap,
              min: 0,
              max: 100,
              onChange: function(e) { setOverride(id, e.target.value); },
              style: { padding: '6px 9px', border: '1px solid ' + C.border, borderRadius: 6, fontSize: 12, width: '100%', fontFamily: "'DM Mono',monospace", textAlign: 'right', background: 'white' }
            }),
            h('button', {
              onClick: function() { removeOverride(id); },
              style: { padding: '4px 7px', border: 'none', background: 'transparent', color: C.danger, cursor: 'pointer', fontSize: 14 },
              title: 'Remove override'
            }, '\u2715')
          );
        }),
        candidates.length > 0 ? h('div', {
          style: { display: 'grid', gridTemplateColumns: '1fr 90px 30px', gap: 8, alignItems: 'center', marginTop: 8 }
        },
          h(Sel, {
            value: '',
            onChange: function(v) {
              if (v) setOverride(v, 100);
            },
            options: [{ value: '', label: '+ Add ingredient override...' }].concat(
              candidates.map(function(i) { return { value: i.id, label: i.name }; })
            ),
            style: { marginBottom: 0 }
          }),
          h('div'),
          h('div')
        ) : null
      );
    })(),
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
    { key: 'overrides', label: 'Caps', sortable: false, render: function(r) {
      const n = r.inclusionOverrides ? Object.keys(r.inclusionOverrides).length : 0;
      if (n === 0) return h('span', { style: { color: C.muted, fontSize: 11 } }, '-');
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', background: '#fff4e0', color: C.warning,
          border: '1px solid ' + C.warning + '66', borderRadius: 12,
          fontSize: 11, fontWeight: 600
        },
        title: 'Custom inclusion caps for ' + n + ' ingredient(s)'
      }, n + ' \u{1F510}');
    }},
    { key: 'actions', label: '', sortable: false, render: function(r) {
      return h('div', { style: { display: 'flex', gap: 4 } },
        h(Btn, { size: 'sm', variant: 'secondary', onClick: function() { openEdit(r); } }, 'Edit'),
        h(Btn, { size: 'sm', variant: 'danger', onClick: function() { delReq(r); } }, 'Del')
      );
    }}
  ];

  const importModal = showImport ? h(Modal, {
    title: 'Import Animal Requirements from Excel',
    onClose: function() { setShowImport(false); setImportStatus(null); },
    width: 580
  },
    h('div', {
      style: { background: C.parchment, borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: C.soil, lineHeight: 1.6 }
    },
      h('div', { style: { fontWeight: 700, marginBottom: 6 } }, 'Expected columns:'),
      h('div', { style: { fontFamily: "'DM Mono',monospace", fontSize: 11 } },
        'Category, Stage, CP Min, CP Max, ME Min, ME Max, Fat Min, Fat Max, Fibre Min, Fibre Max, Ca Min, Ca Max, P Min, P Max, Lys Min, Lys Max, Met Min, Met Max'),
      h('div', { style: { marginTop: 8, fontSize: 12 } },
        'Existing rows with the same Category+Stage will be updated.')
    ),
    h(Btn, { onClick: downloadReqsTemplate, variant: 'secondary', size: 'sm', style: { marginBottom: 12 } }, '\u{1F4E5} Download Template'),
    h('div', null,
      h('label', {
        style: {
          display: 'block', padding: '22px', border: '2px dashed ' + C.border,
          borderRadius: 10, textAlign: 'center', cursor: 'pointer', background: C.cream
        }
      },
        h('div', { style: { fontSize: 28, marginBottom: 7 } }, '\u{1F4C4}'),
        h('div', { style: { fontSize: 13, color: C.earth, fontWeight: 600 } }, 'Click to choose an Excel file (.xlsx)'),
        h('input', {
          type: 'file', accept: '.xlsx,.xls',
          onChange: function(e) { handleReqsImport(e.target.files[0]); },
          style: { display: 'none' }
        })
      )
    ),
    importStatus ? h('div', {
      style: {
        marginTop: 14, padding: '10px 14px', borderRadius: 8, fontSize: 13,
        background: importStatus.type === 'error' ? '#fde8e8' : importStatus.type === 'success' ? '#f0f9f4' : C.parchment,
        color: importStatus.type === 'error' ? C.danger : importStatus.type === 'success' ? C.grass : C.muted,
        border: '1px solid ' + (importStatus.type === 'error' ? C.danger : importStatus.type === 'success' ? C.grass : C.border) + '44'
      }
    }, importStatus.msg) : null
  ) : null;

  return h('div', { style: { padding: '0 26px 26px' } },
    h(PageHdr, {
      title: '\u{2697} Nutritional Requirements',
      subtitle: 'Reference: NRC 2012, Evonik Amino Dat, ILRI East Africa',
      action: h('div', { style: { display: 'flex', gap: 6 } },
        h(Btn, { onClick: function() { setShowImport(true); }, variant: 'secondary', size: 'sm' }, '\u{1F4E4} Import Excel'),
        h(Btn, { onClick: resetDefaults, variant: 'secondary', size: 'sm' }, 'Reset to Defaults'),
        h(Btn, { onClick: openAdd, variant: 'success', size: 'sm' }, '+ Add Stage')
      )
    }),
    formModal,
    importModal,
    h('div', { style: { marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
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

  async function saveUsers(next) {
    setUsersState(next);
    db.set('users', next);
    const r = await serverPush('users', next);
    if (!r || !r.ok) {
      showT('Warning: could not save to server. Changes may be lost on refresh.', 'error');
    }
  }

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', password: '', email: '', role: 'staff' });

  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', username: '', email: '', role: 'staff' });

  const [pwdUser, setPwdUser] = useState(null);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [currentPwd, setCurrentPwd] = useState('');

  async function addUser() {
    if (!form.name || !form.username || !form.password) return;
    if (users.find(function(u) { return u.username === form.username; })) {
      showT('Username already exists', 'error');
      return;
    }
    const next = users.concat([Object.assign({}, form, { id: uid(), created: today(), active: true })]);
    await saveUsers(next);
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
      title: '\u{1F464} User Management',
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
      title: '\u{1F50D} Traceability Log',
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
    h(PageHdr, { title: '\u{1F4CB} Resources', subtitle: 'Export data to CSV, print PDF reports' }),
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

// ========== SAVED FORMULAS PAGE ==========

function SavedFormulasPage(props) {
  const ctx = useContext(Ctx);
  const customers = ctx.customers || [];
  const user = ctx.user;
  // Prefer context state (live, synced); fall back to localStorage
  const saved = (ctx.savedFormulas && ctx.savedFormulas.length >= 0) ? ctx.savedFormulas : db.get('savedFormulas', []);
  const [selCust, setSelCust] = useState('');
  const [toast, setToast] = useState(null);

  function showT(msg, type) {
    setToast({ msg: msg, type: type || 'success' });
    setTimeout(function() { setToast(null); }, 3500);
  }

  const filtered = selCust
    ? saved.filter(function(s) { return s.customerId === selCust; })
    : saved;

  // Group by customer
  const byCustomer = {};
  filtered.forEach(function(s) {
    const key = s.customerName || '- Walk-in / Untagged -';
    if (!byCustomer[key]) byCustomer[key] = [];
    byCustomer[key].push(s);
  });
  const customerGroups = Object.entries(byCustomer).sort(function(a, b) {
    return a[0].localeCompare(b[0]);
  });

  function reuseFormula(f) {
    // Navigate to formulator with preloaded formula
    props.setPreload({
      species: f.species,
      stage: f.stage,
      batchKg: f.batchKg || 100,
      customerId: f.customerId || '',
      customerName: f.customerName,
      formula: f.formula,
      nutrients: f.nutrients,
      name: f.name
    });
    props.setPage('formulator');
  }

  function deleteFormula(f) {
    if (!window.confirm('Delete saved formula "' + f.name + '"?')) return;
    const next = saved.filter(function(s) { return s.id !== f.id; });
    if (ctx.setSavedFormulas) {
      ctx.setSavedFormulas(next);
    } else {
      db.set('savedFormulas', next);
      serverPush('savedFormulas', next);
    }
    showT('Formula deleted');
  }

  return h('div', { style: { padding: '0 26px 26px' } },
    toast ? h(Toast, { msg: toast.msg, type: toast.type }) : null,
    h(PageHdr, {
      title: '\u{1F4BE} Saved Formulas',
      subtitle: 'Reuse previous formulations for returning customers',
      action: h(Sel, {
        value: selCust,
        onChange: setSelCust,
        options: [{ value: '', label: 'All customers' }].concat(
          customers.map(function(c) { return { value: c.id, label: c.name }; })
        ),
        style: { minWidth: 200 }
      })
    }),
    saved.length === 0 ? h(Card, null,
      h('div', {
        style: { padding: 40, textAlign: 'center', color: C.muted }
      },
        h('div', { style: { fontSize: 40, marginBottom: 10 } }, '\u{1F4BE}'),
        h('div', { style: { fontFamily: "'Playfair Display',serif", fontSize: 20, color: C.clay, marginBottom: 7 } }, 'No saved formulas yet'),
        h('div', { style: { fontSize: 13 } }, 'Use the Formulator and click "Save Formula" to store mixtures for reuse.')
      )
    ) : customerGroups.length === 0 ? h(Card, null,
      h('div', {
        style: { padding: 30, textAlign: 'center', color: C.muted }
      }, 'No saved formulas match this filter.')
    ) : customerGroups.map(function(group) {
      const custName = group[0];
      const formulas = group[1];
      return h(Card, { key: custName, style: { marginBottom: 14 } },
        h(CardTitle, null, '\u{1F464} ' + custName + '  (' + formulas.length + ' formula' + (formulas.length === 1 ? '' : 's') + ')'),
        h('div', { style: { padding: 0 } },
          formulas.map(function(f, i) {
            return h('div', {
              key: f.id,
              style: {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 18px', gap: 14,
                borderBottom: i < formulas.length - 1 ? '1px solid ' + C.border : 'none',
                background: i % 2 === 0 ? 'white' : C.cream
              }
            },
              h('div', { style: { flex: 1 } },
                h('div', {
                  style: { fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700, color: C.earth, marginBottom: 4 }
                }, f.name || 'Unnamed formula'),
                h('div', { style: { display: 'flex', gap: 14, fontSize: 12, color: C.muted, flexWrap: 'wrap' } },
                  h('span', null, '\u{1F43E} ' + f.species),
                  h('span', null, '\u{1F4CC} ' + f.stage),
                  h('span', null, '\u{1F4E6} ' + (f.batchKg || '-') + ' kg'),
                  h('span', null, '\u{1F4C5} Saved ' + (f.savedOn || '-')),
                  f.costPerKg ? h('span', {
                    style: { color: C.grass, fontWeight: 700, fontFamily: "'DM Mono',monospace" }
                  }, 'KES ' + f.costPerKg.toFixed(2) + '/kg') : null,
                  h('span', { style: { color: C.muted } },
                    Object.keys(f.formula || {}).length + ' ingredients')
                )
              ),
              h('div', { style: { display: 'flex', gap: 6 } },
                h(Btn, {
                  onClick: function() { reuseFormula(f); },
                  variant: 'success',
                  size: 'sm'
                }, '\u{1F504} Reuse & Sell'),
                h(Btn, {
                  onClick: function() { deleteFormula(f); },
                  variant: 'danger',
                  size: 'sm'
                }, 'Del')
              )
            );
          })
        )
      );
    })
  );
}

// ========== DIRECT SALE PAGE ==========

function DirectSalePage() {
  const ctx = useContext(Ctx);
  const ingredients = ctx.ingredients || [];
  const inventory = ctx.inventory || [];
  const setInventory = ctx.setInventory;
  const sales = ctx.sales || [];
  const setSales = ctx.setSales;
  const customers = ctx.customers || [];
  const user = ctx.user;

  const [custId, setCustId] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [items, setItems] = useState([]); // [{itemId, qty, totalPrice, lotOrder?}]
  const [pickerId, setPickerId] = useState('');
  const [lotPickerIdx, setLotPickerIdx] = useState(null); // index of line whose lots we're picking
  const [toast, setToast] = useState(null);

  function showT(msg, type) {
    setToast({ msg: msg, type: type || 'success' });
    setTimeout(function() { setToast(null); }, 3500);
  }

  function getStock(itemId) {
    const inv = inventory.find(function(i) { return i.id === itemId; });
    return inv ? inv.qty : 0;
  }

  function getDefaultPrice(itemId, qty) {
    const inv = inventory.find(function(i) { return i.id === itemId; });
    if (!inv) return 0;
    const sp = inv.sellPriceDirect || Math.round((inv.lastPrice || 0) * (1 + (inv.margin || 20) / 100) * 100) / 100;
    return Math.round(sp * qty * 100) / 100;
  }

  function getBuyCost(itemId, qty, lotOrder) {
    const inv = inventory.find(function(i) { return i.id === itemId; });
    if (!inv) return 0;
    const r = consumeFromLots(inv, qty, lotOrder);
    return r.totalCost;
  }

  function addLine() {
    if (!pickerId) return;
    if (items.find(function(it) { return it.itemId === pickerId; })) {
      showT('Already added. Edit quantity or remove the existing line.', 'error');
      return;
    }
    const inv = inventory.find(function(i) { return i.id === pickerId; });
    if (!inv || inv.qty <= 0) {
      showT('No stock for this ingredient.', 'error');
      return;
    }
    const defaultQty = 1;
    setItems(items.concat([{
      itemId: pickerId,
      qty: defaultQty,
      totalPrice: getDefaultPrice(pickerId, defaultQty)
    }]));
    setPickerId('');
  }

  function updateQty(idx, val) {
    const qty = parseFloat(val);
    setItems(items.map(function(it, i) {
      if (i !== idx) return it;
      const newQty = isNaN(qty) ? 0 : Math.max(0, qty);
      // Re-suggest a default price proportional to qty change, BUT only if user hasn't manually edited
      // For simplicity: regenerate the suggested price each time qty changes
      return Object.assign({}, it, { qty: newQty, totalPrice: getDefaultPrice(it.itemId, newQty) });
    }));
  }

  function updatePrice(idx, val) {
    const price = parseFloat(val);
    setItems(items.map(function(it, i) {
      if (i !== idx) return it;
      return Object.assign({}, it, { totalPrice: isNaN(price) ? 0 : Math.max(0, price) });
    }));
  }

  function removeLine(idx) {
    setItems(items.filter(function(_, i) { return i !== idx; }));
  }

  const totalRevenue = items.reduce(function(s, it) { return s + (it.totalPrice || 0); }, 0);
  const totalBuyCost = items.reduce(function(s, it) { return s + getBuyCost(it.itemId, it.qty, it.lotOrder); }, 0);
  const totalProfit = totalRevenue - totalBuyCost;
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  // Stock validation
  const stockIssues = items.filter(function(it) {
    return it.qty > getStock(it.itemId);
  });
  const canSell = items.length > 0 && stockIssues.length === 0
    && items.every(function(it) { return it.qty > 0 && it.totalPrice > 0; });

  function recordSale() {
    if (!canSell) return;
    const cust = customers.find(function(c) { return c.id === custId; });
    const customerName = cust ? cust.name : (walkInName.trim() || 'Walk-in');

    // Consume lots FIFO for each line; build consumption records
    const consumptions = [];
    const saleItems = items.map(function(it) {
      const inv = inventory.find(function(x) { return x.id === it.itemId; });
      const ing = ingredients.find(function(x) { return x.id === it.itemId; });
      const r = consumeFromLots(inv, it.qty, it.lotOrder || null);
      consumptions.push({ itemId: it.itemId, newLots: r.newLots });
      const realCost = r.totalCost;
      const realCostPerKg = it.qty > 0 ? realCost / it.qty : 0;
      return {
        id: it.itemId,
        name: (ing || inv || {}).name || '(unknown)',
        qty: it.qty,
        totalPrice: it.totalPrice,
        pricePerKg: it.qty > 0 ? Math.round((it.totalPrice / it.qty) * 100) / 100 : 0,
        buyPricePerKg: Math.round(realCostPerKg * 100) / 100,
        buyCostTotal: Math.round(realCost * 100) / 100,
        lotsUsed: r.consumed
      };
    });

    // Apply all consumptions in a single inventory update
    const newInv = applyLotConsumptions(inventory, consumptions);
    setInventory(newInv);

    const productLabel = items.length === 1
      ? saleItems[0].name + ' (' + saleItems[0].qty + 'kg)'
      : 'Direct sale: ' + items.length + ' items';

    const realTotalBuyCost = saleItems.reduce(function(s, si) { return s + si.buyCostTotal; }, 0);
    const realProfit = totalRevenue - realTotalBuyCost;

    const newSale = {
      id: uid(),
      date: today(),
      type: 'direct',
      customerId: custId || null,
      customerName: customerName,
      customer: customerName,
      product: productLabel,
      cost: realTotalBuyCost,
      total: totalRevenue,
      totalRevenue: totalRevenue,
      totalCost: realTotalBuyCost,
      profit: realProfit,
      batchKg: items.reduce(function(s, it) { return s + it.qty; }, 0),
      items: saleItems
    };
    setSales(sales.concat([newSale]));

    // Stock ledger entry per line item
    const ledger = db.get('stockLedger', []);
    const ledgerEntries = saleItems.map(function(si) {
      return {
        id: uid(), type: 'DIRECT_SALE', date: today(),
        itemId: si.id, itemName: si.name,
        qty: si.qty, total: si.totalPrice,
        buyCost: si.buyCostTotal,
        lotsUsed: si.lotsUsed,
        customerName: customerName,
        by: user ? user.name : ''
      };
    });
    const newLedger = ledger.concat(ledgerEntries);
    db.set('stockLedger', newLedger);
    serverPush('stockLedger', newLedger);

    // Reset form
    setItems([]);
    setCustId('');
    setWalkInName('');
    setPickerId('');
    showT('Sale recorded. KES ' + totalRevenue.toFixed(2) + ' \u{2022} ' + saleItems.length + ' line(s).');
  }

  // Build picker options (alphabetical, in-stock first)
  const pickerOptions = [{ value: '', label: 'Choose ingredient to add...' }].concat(
    ingredients
      .slice()
      .sort(function(a, b) {
        const sA = getStock(a.id), sB = getStock(b.id);
        if (sA > 0 && sB <= 0) return -1;
        if (sB > 0 && sA <= 0) return 1;
        return a.name.localeCompare(b.name);
      })
      .map(function(i) {
        const stock = getStock(i.id);
        const sellP = getDefaultPrice(i.id, 1);
        return {
          value: i.id,
          label: i.name + (stock > 0 ? ' \u{2022} ' + stock.toFixed(0) + 'kg \u{2022} KES ' + sellP + '/kg' : ' \u{2022} OUT OF STOCK'),
          disabled: stock <= 0
        };
      })
  );

  // Lot picker modal — pick which lots to consume for a given line, in priority order
  const activeItem = (lotPickerIdx != null) ? items[lotPickerIdx] : null;
  const activeInv = activeItem ? inventory.find(function(x) { return x.id === activeItem.itemId; }) : null;
  const activeIng = activeItem ? ingredients.find(function(x) { return x.id === activeItem.itemId; }) : null;

  function setLotOrderForLine(idx, lotOrder) {
    setItems(items.map(function(it, i) {
      if (i !== idx) return it;
      return Object.assign({}, it, { lotOrder: lotOrder && lotOrder.length > 0 ? lotOrder : null });
    }));
  }

  // Build a preview of FIFO consumption to show the user what AUTO would do
  const fifoPreview = (activeItem && activeInv) ? consumeFromLots(activeInv, activeItem.qty) : null;
  // Build the user's manual consumption preview if lotOrder is set
  const manualPreview = (activeItem && activeInv && activeItem.lotOrder && activeItem.lotOrder.length > 0)
    ? consumeFromLots(activeInv, activeItem.qty, activeItem.lotOrder)
    : null;

  const lotPickerModal = (activeItem && activeInv) ? h(Modal, {
    title: 'Choose lots — ' + ((activeIng || activeInv).name || ''),
    onClose: function() { setLotPickerIdx(null); },
    width: 640
  },
    h('div', { style: { fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 } },
      'Pick lots in the order you want them consumed. Click a lot to add it to the order; click again to remove. Leave empty to use the FIFO default (oldest first).'
    ),
    // Auto FIFO preview
    h('div', {
      style: {
        background: '#f0f9f4', border: '1px solid ' + C.leaf + '66',
        borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: C.earth
      }
    },
      h('strong', null, 'FIFO default would consume: '),
      fifoPreview && fifoPreview.consumed.length > 0
        ? fifoPreview.consumed.map(function(c) {
            return c.qty.toFixed(1) + 'kg @ ' + fmtKES(c.costPerKg) + '/kg (' + c.purchaseDate + ')';
          }).join(' \u2192 ')
        : '(no lots available)',
      fifoPreview && fifoPreview.shortfall > 0 ? h('div', {
        style: { color: C.danger, fontWeight: 700, marginTop: 4 }
      }, 'Shortfall: ' + fifoPreview.shortfall.toFixed(1) + ' kg') : null
    ),
    // List of all lots
    h('div', { style: { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 } }, 'Available lots'),
    h('div', null,
      (activeInv.lots || []).length === 0
        ? h('div', {
          style: { padding: 16, color: C.muted, fontSize: 12, fontStyle: 'italic', background: C.cream, borderRadius: 8, textAlign: 'center' }
        }, 'No lots available')
        : sortedLotsFIFO(activeInv.lots).map(function(lot) {
            const order = activeItem.lotOrder || [];
            const orderIdx = order.indexOf(lot.lotId);
            const inOrder = orderIdx >= 0;
            return h('div', {
              key: lot.lotId,
              onClick: function() {
                let newOrder;
                if (inOrder) {
                  newOrder = order.filter(function(id) { return id !== lot.lotId; });
                } else {
                  newOrder = order.concat([lot.lotId]);
                }
                setLotOrderForLine(lotPickerIdx, newOrder);
              },
              style: {
                display: 'grid', gridTemplateColumns: '32px 1fr 1fr 1fr 1fr',
                gap: 10, padding: '10px 12px', marginBottom: 6,
                alignItems: 'center', cursor: 'pointer',
                background: inOrder ? '#f0f9f4' : C.cream,
                border: '2px solid ' + (inOrder ? C.grass : C.border),
                borderRadius: 8, fontSize: 12,
                transition: 'all 0.15s'
              }
            },
              h('div', {
                style: {
                  fontFamily: "'DM Mono',monospace", fontWeight: 700,
                  color: inOrder ? C.grass : C.muted, fontSize: 14, textAlign: 'center'
                }
              }, inOrder ? '#' + (orderIdx + 1) : ''),
              h('div', { style: { color: C.earth, fontWeight: 600 } }, lot.purchaseDate),
              h('div', { style: { color: C.muted, fontSize: 11 } }, lot.supplier || '-'),
              h('div', {
                style: { textAlign: 'right', fontFamily: "'DM Mono',monospace", color: C.earth, fontWeight: 600 }
              }, fmt(lot.remainingQty, 1) + ' kg avail.'),
              h('div', {
                style: { textAlign: 'right', fontFamily: "'DM Mono',monospace", color: C.earth, fontWeight: 700 }
              }, fmtKES(lot.costPerKg))
            );
          })
    ),
    // Manual order preview if any
    manualPreview ? h('div', {
      style: {
        background: '#fff4e0', border: '1px solid ' + C.warning + '66',
        borderRadius: 8, padding: '10px 12px', marginTop: 12, fontSize: 12, color: C.earth
      }
    },
      h('strong', null, 'Your manual order will consume: '),
      manualPreview.consumed.length > 0
        ? manualPreview.consumed.map(function(c) {
            return c.qty.toFixed(1) + 'kg @ ' + fmtKES(c.costPerKg) + '/kg';
          }).join(' \u2192 ')
        : '(none)',
      h('div', {
        style: { marginTop: 4, fontFamily: "'DM Mono',monospace" }
      },
        'Total cost: ' + fmtKES(manualPreview.totalCost),
        manualPreview.shortfall > 0 ? h('span', { style: { color: C.danger, fontWeight: 700, marginLeft: 12 } },
          '\u26A0 Shortfall ' + manualPreview.shortfall.toFixed(1) + ' kg \u2014 will fall back to FIFO for the rest') : null
      )
    ) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 } },
      h(Btn, {
        onClick: function() { setLotOrderForLine(lotPickerIdx, null); setLotPickerIdx(null); },
        variant: 'secondary'
      }, 'Reset to FIFO'),
      h(Btn, {
        onClick: function() { setLotPickerIdx(null); },
        variant: 'success'
      }, 'Done')
    )
  ) : null;

  return h('div', { style: { padding: '0 26px 26px' } },
    lotPickerModal,
    toast ? h(Toast, { msg: toast.msg, type: toast.type }) : null,
    h(PageHdr, {
      title: '\u{1F6D2} Direct Sale',
      subtitle: 'Sell raw ingredients without formulation'
    }),
    // Customer block
    h(Card, { style: { marginBottom: 14 } },
      h(CardTitle, null, '\u{1F464} Customer'),
      h('div', { style: { padding: '0 18px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
        h(Sel, {
          label: 'Existing Customer',
          value: custId,
          onChange: function(v) { setCustId(v); if (v) setWalkInName(''); },
          options: [{ value: '', label: '— Walk-in / Not a regular —' }].concat(
            customers.map(function(c) { return { value: c.id, label: c.name }; })
          )
        }),
        h(Inp, {
          label: 'Walk-in Name (optional)',
          value: walkInName,
          onChange: function(v) { setWalkInName(v); if (v) setCustId(''); },
          placeholder: 'For receipts only'
        })
      )
    ),
    // Line items block
    h(Card, { style: { marginBottom: 14 } },
      h(CardTitle, null, '\u{1F4E6} Items'),
      h('div', { style: { padding: '14px 18px' } },
        // Picker row
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14 } },
          h('div', { style: { flex: 1 } },
            h(Sel, {
              label: 'Add ingredient',
              value: pickerId,
              onChange: setPickerId,
              options: pickerOptions
            })
          ),
          h(Btn, {
            onClick: addLine,
            variant: 'success',
            disabled: !pickerId,
            style: { marginBottom: 12 }
          }, '+ Add')
        ),
        // Items table
        items.length === 0 ? h('div', {
          style: { padding: 30, textAlign: 'center', color: C.muted, fontSize: 13, background: C.cream, borderRadius: 10 }
        }, 'No items yet. Pick an ingredient above and click Add.') : h('div', null,
          h('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: '2fr 0.8fr 1fr 1.2fr 1fr 40px',
              gap: 8, padding: '6px 4px',
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2,
              color: C.muted, fontFamily: "'DM Mono',monospace",
              borderBottom: '2px solid ' + C.border
            }
          },
            h('div', null, 'Ingredient'),
            h('div', { style: { textAlign: 'right' } }, 'Stock'),
            h('div', { style: { textAlign: 'right' } }, 'Qty (kg)'),
            h('div', { style: { textAlign: 'right' } }, 'Total KES'),
            h('div', { style: { textAlign: 'center' } }, 'Lots'),
            h('div', null, '')
          ),
          items.map(function(it, idx) {
            const inv = inventory.find(function(x) { return x.id === it.itemId; });
            const ing = ingredients.find(function(x) { return x.id === it.itemId; });
            const stock = getStock(it.itemId);
            const overStock = it.qty > stock;
            const perKg = it.qty > 0 ? (it.totalPrice / it.qty) : 0;
            const isManual = !!(it.lotOrder && it.lotOrder.length > 0);
            return h('div', {
              key: it.itemId,
              style: {
                display: 'grid',
                gridTemplateColumns: '2fr 0.8fr 1fr 1.2fr 1fr 40px',
                gap: 8, padding: '8px 4px',
                alignItems: 'center',
                borderBottom: '1px solid ' + C.border,
                background: overStock ? '#fde8e8' : 'white'
              }
            },
              h('div', { style: { fontSize: 13, color: C.earth, fontWeight: 600 } },
                (ing || inv || {}).name || '(unknown)'),
              h('div', {
                style: {
                  textAlign: 'right', fontSize: 12,
                  color: overStock ? C.danger : C.muted,
                  fontFamily: "'DM Mono',monospace",
                  fontWeight: overStock ? 700 : 400
                }
              }, stock.toFixed(1)),
              h('input', {
                type: 'number',
                step: '0.1',
                min: 0,
                value: it.qty,
                onChange: function(e) { updateQty(idx, e.target.value); },
                style: {
                  padding: '6px 8px',
                  border: '1px solid ' + (overStock ? C.danger : C.border),
                  borderRadius: 6,
                  fontSize: 12,
                  textAlign: 'right',
                  fontFamily: "'DM Mono',monospace",
                  width: '100%',
                  background: 'white'
                }
              }),
              h('div', null,
                h('input', {
                  type: 'number',
                  step: '0.01',
                  min: 0,
                  value: it.totalPrice,
                  onChange: function(e) { updatePrice(idx, e.target.value); },
                  style: {
                    padding: '6px 8px',
                    border: '1px solid ' + C.border,
                    borderRadius: 6,
                    fontSize: 12,
                    textAlign: 'right',
                    fontFamily: "'DM Mono',monospace",
                    width: '100%',
                    background: 'white',
                    fontWeight: 700,
                    color: C.grass
                  }
                }),
                perKg > 0 ? h('div', {
                  style: { fontSize: 10, color: C.muted, textAlign: 'right', marginTop: 2, fontFamily: "'DM Mono',monospace" }
                }, '@ ' + perKg.toFixed(2) + '/kg') : null
              ),
              h('button', {
                onClick: function() { setLotPickerIdx(idx); },
                style: {
                  padding: '5px 8px',
                  border: '1px solid ' + (isManual ? C.warning : C.border),
                  background: isManual ? '#fff4e0' : 'white',
                  color: isManual ? C.warning : C.muted,
                  borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  fontFamily: "'DM Mono',monospace"
                },
                title: isManual ? 'Manual lot order set' : 'FIFO (oldest lot first). Click to override.'
              }, isManual ? '\u{1F510} MANUAL' : 'FIFO'),
              h('button', {
                onClick: function() { removeLine(idx); },
                style: {
                  border: 'none', background: 'transparent',
                  color: C.danger, cursor: 'pointer', fontSize: 16
                },
                title: 'Remove'
              }, '\u2715')
            );
          })
        ),
        // Stock issues warning
        stockIssues.length > 0 ? h('div', {
          style: {
            marginTop: 12, padding: '10px 14px',
            background: '#fde8e8', borderRadius: 8,
            border: '1px solid ' + C.danger + '66',
            fontSize: 12, color: C.danger
          }
        },
          h('strong', null, '\u{26A0} Insufficient stock: '),
          stockIssues.map(function(it) {
            const ing = ingredients.find(function(x) { return x.id === it.itemId; });
            return (ing || {}).name || '?';
          }).join(', '),
          '. Reduce quantity or restock first.'
        ) : null
      )
    ),
    // Totals + record button
    items.length > 0 ? h(Card, { style: { marginBottom: 14 } },
      h('div', {
        style: {
          padding: '14px 18px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 14, flexWrap: 'wrap',
          background: 'linear-gradient(135deg,' + C.parchment + ',' + C.cream + ')'
        }
      },
        h('div', null,
          h('div', { style: { fontSize: 11, color: C.muted, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 } }, 'Total'),
          h('div', { style: { fontSize: 28, fontFamily: "'Playfair Display',serif", fontWeight: 900, color: C.earth } },
            'KES ' + totalRevenue.toFixed(2)),
          h('div', { style: { fontSize: 11, color: C.muted, marginTop: 2 } },
            'Buy cost ' + fmtKES(totalBuyCost) + ' \u{2022} Profit ',
            h('strong', { style: { color: totalProfit >= 0 ? C.grass : C.danger } },
              fmtKES(totalProfit) + ' (' + margin.toFixed(1) + '%)')
          )
        ),
        h(Btn, {
          onClick: recordSale,
          variant: 'success',
          size: 'lg',
          disabled: !canSell
        }, '\u{2713} Record Sale')
      )
    ) : null
  );
}

// ========== PAGES COMPONENT ==========

export default function Pages(props) {
  const ctx = useContext(Ctx);
  const user = props.user;
  const [preload, setPreload] = useState(null);

  // Clear preload when navigating away from formulator
  useEffect(function() {
    if (props.page !== 'formulator' && preload) {
      setPreload(null);
    }
  }, [props.page]);

  if (!user) return h(LoginPage, { onLogin: props.onLogin });

  const pageMap = {
    dashboard: function() { return h(DashboardPage, null); },
    formulator: function() { return h(FormulatorPage, { preload: preload }); },
    direct_sale: function() { return h(DirectSalePage, null); },
    saved_formulas: function() {
      return h(SavedFormulasPage, {
        setPreload: setPreload,
        setPage: props.setPage
      });
    },
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

