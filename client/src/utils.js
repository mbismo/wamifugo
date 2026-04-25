// ── DESIGN TOKENS ────────────────────────────────────────────────────────────
export const C = {
  earth:    '#3D2B1F',
  soil:     '#5C3D2E',
  clay:     '#8B5E3C',
  savanna:  '#C9922A',
  harvest:  '#E8B84B',
  grass:    '#4A7C59',
  leaf:     '#6AAB7E',
  cream:    '#FAF6EE',
  parchment:'#F2EAD8',
  border:   '#E8E0D4',
  muted:    '#7A6A55',
  ink:      '#1A1208',
  danger:   '#C0392B',
  warning:  '#E67E22',
};

// ── UTILITIES ─────────────────────────────────────────────────────────────────
export const uid = () => Math.random().toString(36).slice(2, 10);
export const today = () => new Date().toISOString().slice(0, 10);
export const dateRange = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};
export const fmt = (n, d = 0) =>
  Number(n || 0).toLocaleString('en-KE', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
export const fmtKES = (n) =>
  'KES ' + Number(n || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// ── INVENTORY LOT MIGRATION ──────────────────────────────────────────────────
// Converts legacy inventory rows (single qty + lastPrice) into lot-tracked
// rows where each row has a `lots` array. Idempotent — already-migrated rows
// pass through, with their derived qty recomputed.
export function migrateInventoryLots(inv) {
  if (!Array.isArray(inv)) return [];
  return inv.map(row => {
    if (Array.isArray(row.lots)) {
      const totalQty = row.lots.reduce((s, l) => s + (l.remainingQty || 0), 0);
      return { ...row, qty: totalQty };
    }
    if (!row.qty || row.qty <= 0) {
      return { ...row, lots: [], qty: 0 };
    }
    const legacyLot = {
      lotId: 'lot_legacy_' + (row.id || Math.random().toString(36).slice(2, 10)),
      purchaseDate: row.lastPurchaseDate || new Date().toISOString().slice(0, 10),
      supplier: '',
      originalQty: row.qty,
      remainingQty: row.qty,
      costPerKg: row.lastPrice || 0,
      ts: Date.now()
    };
    return { ...row, lots: [legacyLot] };
  });
}

// ── EXCEL EXPORT HELPER ──────────────────────────────────────────────────────
export async function exportToExcel(rows, filename, sheetName) {
  try {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
    XLSX.writeFile(wb, filename);
    return true;
  } catch (e) {
    console.error('Excel export failed:', e);
    return false;
  }
}

// ── EXCEL IMPORT HELPER ──────────────────────────────────────────────────────
export async function readExcelFile(file) {
  try {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const firstSheet = wb.SheetNames[0];
    const ws = wb.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return { rows, sheetNames: wb.SheetNames };
  } catch (e) {
    console.error('Excel read failed:', e);
    throw new Error('Could not read Excel file: ' + e.message);
  }
}
