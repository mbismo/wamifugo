// FEED FORMULATION SOLVER
// Priority 1: Meet nutritional requirements (CP, ME, Ca, P, Lys, Met, etc)
// Priority 2: Minimize cost
// Always returns a solution. If no mix can meet nutrition, returns the closest
// possible mix plus a "what to buy" suggestion.

// LINEAR PROGRAMMING (Big-M Simplex)
function lpSolve({c, A_ub, b_ub, A_eq, b_eq, lb, ub, maxIter = 8000}) {
  const n = c.length, BigM = 1e8, EPS = 1e-9;
  const lbA = lb || Array(n).fill(0);
  const ubA = ub || Array(n).fill(100);
  const range = ubA.map((u, i) => Math.max(0, u - lbA[i]));
  const rows_ub = A_ub ? A_ub.length : 0;
  const rows_eq = A_eq ? A_eq.length : 0;
  const rows_box = n;
  const m = rows_ub + rows_eq + rows_box;
  const nSlkUb = rows_ub, nSlkBox = n, nArt = rows_eq;
  const nT = n + nSlkUb + nSlkBox + nArt;
  const T = Array.from({length: m + 1}, () => new Float64Array(nT + 1));
  for (let j = 0; j < n; j++) T[m][j] = c[j];
  for (let j = 0; j < nArt; j++) T[m][n + nSlkUb + nSlkBox + j] = BigM;
  const basis = new Int32Array(m);
  for (let i = 0; i < rows_ub; i++) {
    for (let j = 0; j < n; j++) T[i][j] = A_ub[i][j];
    let rhs = b_ub[i];
    for (let k = 0; k < n; k++) rhs -= A_ub[i][k] * lbA[k];
    if (rhs < 0) {
      for (let j = 0; j < n; j++) T[i][j] = -T[i][j];
      rhs = -rhs;
      T[i][n + i] = -1;
    } else {
      T[i][n + i] = 1;
    }
    T[i][nT] = rhs;
    basis[i] = n + i;
  }
  for (let i = 0; i < rows_eq; i++) {
    const r = rows_ub + i;
    for (let j = 0; j < n; j++) T[r][j] = A_eq[i][j];
    let rhs = b_eq[i];
    for (let k = 0; k < n; k++) rhs -= A_eq[i][k] * lbA[k];
    T[r][n + nSlkUb + nSlkBox + i] = 1;
    T[r][nT] = rhs;
    basis[r] = n + nSlkUb + nSlkBox + i;
    for (let j = 0; j <= nT; j++) T[m][j] -= BigM * T[r][j];
  }
  for (let i = 0; i < n; i++) {
    const r = rows_ub + rows_eq + i;
    T[r][i] = 1;
    T[r][n + nSlkUb + i] = 1;
    T[r][nT] = range[i];
    basis[r] = n + nSlkUb + i;
  }
  function pivot(row, col) {
    const pv = T[row][col];
    for (let j = 0; j <= nT; j++) T[row][j] /= pv;
    for (let i = 0; i <= m; i++) {
      if (i === row) continue;
      const f = T[i][col];
      if (Math.abs(f) < EPS) continue;
      for (let j = 0; j <= nT; j++) T[i][j] -= f * T[row][j];
    }
    basis[row] = col;
  }
  let iters = 0;
  while (iters++ < maxIter) {
    let col = -1, minC = -EPS;
    for (let j = 0; j < nT; j++) {
      if (T[m][j] < minC) { minC = T[m][j]; col = j; }
    }
    if (col === -1) break;
    let row = -1, minR = Infinity;
    for (let i = 0; i < m; i++) {
      if (T[i][col] > EPS) {
        const r = T[i][nT] / T[i][col];
        if (r < minR - EPS) { minR = r; row = i; }
      }
    }
    if (row === -1) return { feasible: false, x: null, cost: Infinity, iters };
    pivot(row, col);
  }
  const x = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    const b = basis[i];
    if (b < n) x[b] = T[i][nT];
  }
  let feasible = true;
  outer: for (let j = n + nSlkUb + nSlkBox; j < nT; j++) {
    for (let i = 0; i < m; i++) {
      if (basis[i] === j && T[i][nT] > 1e-4) { feasible = false; break outer; }
    }
  }
  const xF = Array.from(x).map((xi, i) => xi + lbA[i]);
  return { feasible, x: xF, cost: c.reduce((s, ci, i) => s + ci * xF[i], 0), iters };
}

const NUTRIENTS = ['cp', 'me', 'fat', 'fibre', 'ca', 'p', 'lys', 'met'];

// GOAL PROGRAMMING SOLVER
// Introduces slack variables for each nutrient constraint.
// Objective: minimize weighted sum of slacks (constraint violations) + cost.
// This ALWAYS returns a solution (even if nutrition cannot be perfectly met).
function solveGoalProgram(ingrs, reqs) {
  if (!ingrs || ingrs.length === 0) return null;
  if (!reqs) return null;

  const n = ingrs.length;
  const NUTRITION_WEIGHT = 1000;
  const COST_WEIGHT = 0.01;

  const activeNuts = NUTRIENTS.filter(function(nut) {
    return reqs[nut] && Array.isArray(reqs[nut]);
  });
  const nNuts = activeNuts.length;
  const totalVars = n + 2 * nNuts;

  const c = new Array(totalVars).fill(0);
  for (let i = 0; i < n; i++) {
    c[i] = (ingrs[i].price || 0) * COST_WEIGHT / 100;
  }
  for (let k = 0; k < nNuts; k++) {
    const nut = activeNuts[k];
    const weight = (nut === 'cp' || nut === 'me') ? NUTRITION_WEIGHT * 2 : NUTRITION_WEIGHT;
    c[n + 2 * k] = weight;
    c[n + 2 * k + 1] = weight;
  }

  // Sum of ingredients = 100
  const A_eq = [new Array(totalVars).fill(0)];
  for (let i = 0; i < n; i++) A_eq[0][i] = 1;
  const b_eq = [100];

  // Nutrient constraints with slacks
  const A_ub = [];
  const b_ub = [];
  activeNuts.forEach(function(nut, k) {
    const reqMin = reqs[nut][0];
    const reqMax = reqs[nut][1];
    const nutVals = ingrs.map(function(i) { return (parseFloat(i[nut]) || 0) / 100; });

    if (reqMin > 0) {
      const row = new Array(totalVars).fill(0);
      for (let i = 0; i < n; i++) row[i] = -nutVals[i];
      row[n + 2 * k] = -1;
      A_ub.push(row);
      b_ub.push(-reqMin);
    }
    if (reqMax < 9999) {
      const row = new Array(totalVars).fill(0);
      for (let i = 0; i < n; i++) row[i] = nutVals[i];
      row[n + 2 * k + 1] = -1;
      A_ub.push(row);
      b_ub.push(reqMax);
    }
  });

  const lb = new Array(totalVars).fill(0);
  const ub = new Array(totalVars).fill(0);
  for (let i = 0; i < n; i++) {
    ub[i] = Math.min(parseFloat(ingrs[i].maxIncl) || 100, 100);
  }
  for (let k = 0; k < 2 * nNuts; k++) {
    ub[n + k] = 1000;
  }

  try {
    const res = lpSolve({ c: c, A_ub: A_ub, b_ub: b_ub, A_eq: A_eq, b_eq: b_eq, lb: lb, ub: ub });
    if (!res || !res.x) return null;

    const formula = {};
    for (let i = 0; i < n; i++) {
      const pct = res.x[i];
      if (pct > 0.05) formula[ingrs[i].id] = pct;
    }

    const gaps = {};
    activeNuts.forEach(function(nut, k) {
      const shortfall = res.x[n + 2 * k] || 0;
      const excess = res.x[n + 2 * k + 1] || 0;
      if (shortfall > 0.01 || excess > 0.01) {
        gaps[nut] = { shortfall: shortfall, excess: excess };
      }
    });

    const tot = Object.values(formula).reduce(function(s, v) { return s + v; }, 0);
    if (tot < 1) return null;
    if (Math.abs(tot - 100) > 0.01) {
      const sc = 100 / tot;
      Object.keys(formula).forEach(function(k) { formula[k] *= sc; });
    }
    const raw = Object.entries(formula);
    const diff = 100 - raw.reduce(function(s, e) { return s + e[1]; }, 0);
    if (raw.length && Math.abs(diff) > 0.001) {
      const lg = raw.reduce(function(a, b) { return b[1] > a[1] ? b : a; })[0];
      formula[lg] += diff;
    }

    return { formula: formula, gaps: gaps };
  } catch (e) {
    console.warn('Solver error:', e);
    return null;
  }
}

function solveBestEffort(ingrs, reqs) {
  if (!ingrs || ingrs.length === 0) return null;
  if (!reqs) return null;

  const result = solveGoalProgram(ingrs, reqs);
  if (!result) {
    const formula = {};
    const top = ingrs.slice(0, Math.min(4, ingrs.length));
    const pct = 100 / top.length;
    top.forEach(function(i) { formula[i.id] = pct; });
    return {
      formula: formula,
      quality: 'fallback',
      warnings: [{ nutrient: 'ALL', severity: 'danger', note: 'Could not optimise. Showing equal mix.' }],
      gaps: {}
    };
  }

  const gapCount = Object.keys(result.gaps).length;
  let quality;
  if (gapCount === 0) quality = 'optimal';
  else if (gapCount <= 2) quality = 'good';
  else quality = 'partial';

  const warnings = buildGapWarnings(result.gaps, reqs, result.formula, ingrs);

  return {
    formula: result.formula,
    quality: quality,
    warnings: warnings,
    gaps: result.gaps
  };
}

function buildGapWarnings(gaps, reqs, formula, ingrs) {
  if (!gaps || Object.keys(gaps).length === 0) return [];
  const nutrients = calcNutrients(formula, ingrs);
  const nutLabels = {
    cp: 'Crude Protein', me: 'Metabolisable Energy', fat: 'Fat', fibre: 'Fibre',
    ca: 'Calcium', p: 'Phosphorus', lys: 'Lysine', met: 'Methionine'
  };
  const unitMap = { cp: '%', me: ' kcal/kg', fat: '%', fibre: '%', ca: '%', p: '%', lys: '%', met: '%' };
  const warnings = [];
  Object.entries(gaps).forEach(function(entry) {
    const nut = entry[0];
    const gap = entry[1];
    const label = nutLabels[nut] || nut;
    const unit = unitMap[nut] || '';
    const req = reqs[nut];
    const val = nutrients[nut];
    if (gap.shortfall > 0.01) {
      const severity = gap.shortfall > req[0] * 0.15 ? 'danger' : 'warning';
      warnings.push({
        nutrient: label, severity: severity,
        note: label + ' is at ' + val.toFixed(2) + unit + ', below target ' + req[0] + unit + ' (short by ' + gap.shortfall.toFixed(2) + unit + ')'
      });
    }
    if (gap.excess > 0.01) {
      const severity = gap.excess > req[1] * 0.15 ? 'danger' : 'warning';
      warnings.push({
        nutrient: label, severity: severity,
        note: label + ' is at ' + val.toFixed(2) + unit + ', above target ' + req[1] + unit + ' (excess of ' + gap.excess.toFixed(2) + unit + ')'
      });
    }
  });
  return warnings;
}

// WHAT TO BUY SUGGESTION
function suggestIngredientsToBuy(gaps, allIngredients, inStockIds) {
  if (!gaps || Object.keys(gaps).length === 0) return [];

  const suggestions = [];
  const stockSet = inStockIds instanceof Set ? inStockIds : new Set(inStockIds);
  const outOfStock = allIngredients.filter(function(i) { return !stockSet.has(i.id); });

  Object.entries(gaps).forEach(function(entry) {
    const nut = entry[0];
    const gap = entry[1];
    if (gap.shortfall < 0.01) return;

    const candidates = outOfStock
      .filter(function(i) { return (parseFloat(i[nut]) || 0) > 0; })
      .map(function(i) {
        return {
          ingredient: i,
          nutrientValue: parseFloat(i[nut]) || 0,
          price: i.price || 0
        };
      })
      .sort(function(a, b) {
        if (a.price > 0 && b.price > 0) {
          return (b.nutrientValue / b.price) - (a.nutrientValue / a.price);
        }
        return b.nutrientValue - a.nutrientValue;
      })
      .slice(0, 3);

    if (candidates.length > 0) {
      const nutLabels = {
        cp: 'Crude Protein', me: 'Energy', fat: 'Fat', fibre: 'Fibre',
        ca: 'Calcium', p: 'Phosphorus', lys: 'Lysine', met: 'Methionine'
      };
      suggestions.push({
        nutrient: nut,
        nutrientLabel: nutLabels[nut] || nut,
        shortfall: gap.shortfall,
        candidates: candidates
      });
    }
  });

  return suggestions;
}

// Legacy compatibility
function solveLeastCostLP(ingrs, reqs) {
  const r = solveGoalProgram(ingrs, reqs);
  if (!r || Object.keys(r.gaps || {}).length > 0) return null;
  return r.formula;
}

function solveLeastCost(ingrs, reqs) {
  const r = solveGoalProgram(ingrs, reqs);
  return r ? r.formula : null;
}

function calcNutrients(formula, ingrs) {
  let cp = 0, me = 0, fat = 0, fibre = 0, ca = 0, p = 0, lys = 0, met = 0;
  Object.entries(formula).forEach(function(entry) {
    const id = entry[0];
    const pct = entry[1];
    const i = ingrs.find(function(x) { return x.id === id; });
    if (!i) return;
    const f = pct / 100;
    cp += f * (parseFloat(i.cp) || 0);
    me += f * (parseFloat(i.me) || 0);
    fat += f * (parseFloat(i.fat) || 0);
    fibre += f * (parseFloat(i.fibre) || 0);
    ca += f * (parseFloat(i.ca) || 0);
    p += f * (parseFloat(i.p) || 0);
    lys += f * (parseFloat(i.lys) || 0);
    met += f * (parseFloat(i.met) || 0);
  });
  return { cp: cp, me: me, fat: fat, fibre: fibre, ca: ca, p: p, lys: lys, met: met };
}

function calcCost(formula, ingrs) {
  return Object.entries(formula).reduce(function(s, entry) {
    const i = ingrs.find(function(x) { return x.id === entry[0]; });
    return i ? s + (entry[1] / 100) * (i.price || 0) : s;
  }, 0);
}

function assessNutrientGaps(nutrients, reqs) {
  if (!nutrients || !reqs) return [];
  const warnings = [];
  const checks = [
    ['cp', 'Crude Protein', '%'],
    ['me', 'Metabolisable Energy', 'kcal/kg'],
    ['ca', 'Calcium', '%'],
    ['p', 'Phosphorus', '%'],
    ['lys', 'Lysine', '%'],
    ['met', 'Methionine', '%']
  ];
  for (const check of checks) {
    const key = check[0], label = check[1], unit = check[2];
    const req = reqs[key];
    const val = nutrients[key];
    if (!req || val === undefined) continue;
    const min = req[0], max = req[1];
    if (val < min * 0.9) {
      warnings.push({ nutrient: label, severity: 'danger', note: label + ': ' + val.toFixed(2) + unit + ' below minimum ' + min + unit });
    } else if (val < min) {
      warnings.push({ nutrient: label, severity: 'warning', note: label + ': ' + val.toFixed(2) + unit + ' slightly below target ' + min + unit });
    } else if (val > max * 1.1) {
      warnings.push({ nutrient: label, severity: 'warning', note: label + ': ' + val.toFixed(2) + unit + ' above maximum ' + max + unit });
    }
  }
  return warnings;
}

export {
  lpSolve,
  solveLeastCostLP,
  solveLeastCost,
  solveBestEffort,
  solveGoalProgram,
  suggestIngredientsToBuy,
  assessNutrientGaps,
  calcNutrients,
  calcCost
};
