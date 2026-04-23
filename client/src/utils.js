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
