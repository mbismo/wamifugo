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

  // POST-SOLVE VERIFICATION: check that all original constraints are satisfied
  // This catches cases where Big-M numerical issues mask infeasibility
  const VERIFY_TOL = 1e-4;
  if (feasible && A_ub) {
    for (let i = 0; i < rows_ub; i++) {
      let lhs = 0;
      for (let j = 0; j < n; j++) lhs += A_ub[i][j] * xF[j];
      if (lhs > b_ub[i] + VERIFY_TOL) { feasible = false; break; }
    }
  }
  if (feasible && A_eq) {
    for (let i = 0; i < rows_eq; i++) {
      let lhs = 0;
      for (let j = 0; j < n; j++) lhs += A_eq[i][j] * xF[j];
      if (Math.abs(lhs - b_eq[i]) > VERIFY_TOL * Math.max(1, Math.abs(b_eq[i]))) { feasible = false; break; }
    }
  }

  return { feasible, x: xF, cost: c.reduce((s, ci, i) => s + ci * xF[i], 0), iters };
}

const NUTRIENTS = ['cp', 'me', 'fat', 'fibre', 'ca', 'p', 'lys', 'met'];

// HARD-CONSTRAINED SOLVER — NEVER returns a formula that violates nutrition.
// Strategy:
//   1. Try LP (fast, exact when it works)
//   2. If LP fails or is numerically unstable, use coordinate descent refinement
//   3. Verify final solution before returning
function solveStrictLP(ingrs, reqs) {
  if (!ingrs || ingrs.length === 0) return null;
  if (!reqs) return null;

  const activeNuts = NUTRIENTS.filter(function(nut) {
    return reqs[nut] && Array.isArray(reqs[nut]);
  });

  // Fast feasibility pre-check — if impossible, we still want best-effort formula
  let impossiblePrecheck = false;
  for (const nut of activeNuts) {
    const reqMin = reqs[nut][0];
    const reqMax = reqs[nut][1];
    if (reqMin > 0) {
      const upperAch = upperBoundNutrient(ingrs, nut);
      if (upperAch < reqMin * 0.99) { impossiblePrecheck = true; break; }
    }
    if (reqMax < 9999) {
      const lowerAch = lowerBoundNutrient(ingrs, nut);
      if (lowerAch > reqMax * 1.01) { impossiblePrecheck = true; break; }
    }
  }

  // Run BOTH LP and coordinate descent when feasibility looks possible,
  // then take the cheaper feasible result. LP is provably cost-optimal in the
  // typical case, but the LP can occasionally settle on a numerically
  // suboptimal vertex; CD acts as a cross-check.
  let lpResult = null;
  if (!impossiblePrecheck) {
    lpResult = tryLPSolve(ingrs, reqs);
    if (lpResult && !verifyFeasible(lpResult.formula, ingrs, reqs)) lpResult = null;
  }

  // ALWAYS run coordinate descent to populate best-effort formula,
  // even when pre-check says impossible. This ensures the UI always
  // has a diagnosticFormula to show the user.
  const cdResult = coordinateDescentSearch(ingrs, reqs);
  const cdFeasible = cdResult && cdResult.formula && verifyFeasible(cdResult.formula, ingrs, reqs);

  // If both feasible, pick cheaper. If only one, return that.
  if (lpResult && cdFeasible) {
    return (cdResult.cost < lpResult.cost - 1e-4)
      ? { formula: cdResult.formula, cost: cdResult.cost }
      : { formula: lpResult.formula, cost: lpResult.cost };
  }
  if (lpResult) return { formula: lpResult.formula, cost: lpResult.cost };
  if (cdFeasible) return { formula: cdResult.formula, cost: cdResult.cost };

  // Infeasible — return best-effort diagnostic from coordinate descent
  return {
    formula: null,
    bestEffortFormula: cdResult ? cdResult.bestEffortFormula : null,
    bestEffortCost: cdResult ? cdResult.bestEffortCost : 0
  };
}

// Max nutrient achievable using at most maxIncl of each ingredient, sum = 100
function upperBoundNutrient(ingrs, nut) {
  // Greedy: sort ingredients by nutrient content descending, fill as much as possible
  const sorted = ingrs.slice().sort(function(a, b) {
    return (parseFloat(b[nut]) || 0) - (parseFloat(a[nut]) || 0);
  });
  let remaining = 100, total = 0;
  for (const ing of sorted) {
    const take = Math.min(remaining, parseFloat(ing.maxIncl) || 100);
    total += take * (parseFloat(ing[nut]) || 0) / 100;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return total;
}

// Min nutrient achievable using at most maxIncl of each ingredient, sum = 100
function lowerBoundNutrient(ingrs, nut) {
  const sorted = ingrs.slice().sort(function(a, b) {
    return (parseFloat(a[nut]) || 0) - (parseFloat(b[nut]) || 0);
  });
  let remaining = 100, total = 0;
  for (const ing of sorted) {
    const take = Math.min(remaining, parseFloat(ing.maxIncl) || 100);
    total += take * (parseFloat(ing[nut]) || 0) / 100;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return total;
}

function verifyFeasible(formula, ingrs, reqs) {
  const nuts = calcNutrients(formula, ingrs);
  const tol = 0.005; // 0.5% rounding tolerance
  for (const nut of NUTRIENTS) {
    if (!reqs[nut]) continue;
    const req = reqs[nut];
    const val = nuts[nut];
    if (val < req[0] * (1 - tol)) return false;
    if (val > req[1] * (1 + tol)) return false;
  }
  // Verify min/max inclusion bounds
  for (const ing of ingrs) {
    const p = formula[ing.id] || 0;
    if (p > (parseFloat(ing.maxIncl) || 100) + 0.5) return false;
    const lo = parseFloat(ing.minIncl) || 0;
    if (lo > 0 && p < lo - 0.5) return false;
  }
  // Verify sum
  const sum = Object.values(formula).reduce(function(s, v) { return s + v; }, 0);
  if (Math.abs(sum - 100) > 0.5) return false;
  return true;
}

function tryLPSolve(ingrs, reqs) {
  // Attempt with pure LP (minimize cost given hard constraints)
  const n = ingrs.length;
  const activeNuts = NUTRIENTS.filter(function(nut) {
    return reqs[nut] && Array.isArray(reqs[nut]);
  });
  const c = ingrs.map(function(i) { return (i.price || 0) / 100; });
  const A_eq = [new Array(n).fill(1)];
  const b_eq = [100];
  const A_ub = [];
  const b_ub = [];
  activeNuts.forEach(function(nut) {
    const reqMin = reqs[nut][0];
    const reqMax = reqs[nut][1];
    const scale = Math.max(reqMin, reqMax, 1);
    const nutVals = ingrs.map(function(i) { return (parseFloat(i[nut]) || 0) / 100 / scale; });
    if (reqMin > 0) {
      A_ub.push(nutVals.map(function(v) { return -v; }));
      b_ub.push(-reqMin / scale);
    }
    if (reqMax < 9999) {
      A_ub.push(nutVals.slice());
      b_ub.push(reqMax / scale);
    }
  });
  const lb = ingrs.map(function(i) { return Math.max(0, parseFloat(i.minIncl) || 0); });
  const ub = ingrs.map(function(i) { return Math.min(parseFloat(i.maxIncl) || 100, 100); });

  try {
    const res = lpSolve({ c: c, A_ub: A_ub, b_ub: b_ub, A_eq: A_eq, b_eq: b_eq, lb: lb, ub: ub });
    if (!res || !res.x || !res.feasible) return null;
    const formula = {};
    for (let i = 0; i < n; i++) {
      // Tight threshold (0.005%) preserves trace ingredients that are part
      // of the cost-optimal mix. Forced-inclusion ingredients (minIncl > 0)
      // are always kept regardless of how small they are.
      const lo = parseFloat(ingrs[i].minIncl) || 0;
      if (res.x[i] > 0.005 || lo > 0) {
        formula[ingrs[i].id] = res.x[i];
      }
    }
    normalizeTo100(formula);
    return { formula: formula, cost: calcCost(formula, ingrs) };
  } catch (e) {
    return null;
  }
}

function normalizeTo100(formula) {
  const tot = Object.values(formula).reduce(function(s, v) { return s + v; }, 0);
  if (tot < 0.001) return;
  if (Math.abs(tot - 100) > 0.001) {
    const sc = 100 / tot;
    Object.keys(formula).forEach(function(k) { formula[k] *= sc; });
  }
  const raw = Object.entries(formula);
  const diff = 100 - raw.reduce(function(s, e) { return s + e[1]; }, 0);
  if (raw.length && Math.abs(diff) > 0.001) {
    const lg = raw.reduce(function(a, b) { return b[1] > a[1] ? b : a; })[0];
    formula[lg] += diff;
  }
}

// Coordinate-descent search: iteratively improve from a feasible-ish starting point
// Uses deterministic restarts with multiple starting strategies for reliability.
function coordinateDescentSearch(ingrs, reqs) {
  const n = ingrs.length;
  if (n < 2) return null;

  const activeNuts = NUTRIENTS.filter(function(nut) {
    return reqs[nut] && Array.isArray(reqs[nut]);
  });

  let bestFeasible = null;
  let bestCost = Infinity;
  // Best-effort: minimum violation (used when no feasible found)
  let bestEffortX = null;
  let bestEffortViolation = Infinity;
  let bestEffortCost = Infinity;

  const MAX_ITERS = 600;

  // Generate diverse starting points
  const startingPoints = generateStartingPoints(ingrs, reqs, activeNuts);

  for (const startX of startingPoints) {
    const x = startX.slice();

    // Local search: pairwise swap adjustment
    for (let iter = 0; iter < MAX_ITERS; iter++) {
      const penalty = computePenalty(x, ingrs, reqs, activeNuts);

      // Track best-effort (lowest-violation) solution, and among equally-low, the cheapest
      if (penalty.violation < bestEffortViolation - 1e-9
        || (Math.abs(penalty.violation - bestEffortViolation) < 1e-9 && penalty.cost < bestEffortCost)) {
        bestEffortViolation = penalty.violation;
        bestEffortCost = penalty.cost;
        bestEffortX = x.slice();
      }

      // If feasible, record and try to improve cost
      if (penalty.violation < 1e-6) {
        const formula = {};
        for (let i = 0; i < n; i++) if (x[i] > 0.005 || (parseFloat(ingrs[i].minIncl) || 0) > 0) formula[ingrs[i].id] = x[i];
        normalizeTo100(formula);
        if (verifyFeasible(formula, ingrs, reqs)) {
          const c = calcCost(formula, ingrs);
          if (c < bestCost) {
            bestFeasible = formula;
            bestCost = c;
          }
        }
      }

      // Try a swap: move mass from i to j
      let improved = false;
      const steps = penalty.violation > 0.01 ? [10, 5, 2, 0.5, 0.1, 0.02] : [2, 0.5, 0.1, 0.02];
      for (const delta of steps) {
        for (let i = 0; i < n; i++) {
          if (x[i] < 0.01) continue;
          const iMin = parseFloat(ingrs[i].minIncl) || 0;
          for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const jCap = parseFloat(ingrs[j].maxIncl) || 100;
            const jBound = Math.min(jCap, 100);
            // Clamp delta so we don't drop i below its minIncl
            const maxFromI = Math.max(0, x[i] - iMin);
            const d = Math.min(delta, maxFromI, jBound - x[j]);
            if (d < 0.01) continue;
            x[i] -= d; x[j] += d;
            const newPen = computePenalty(x, ingrs, reqs, activeNuts);
            const pv = penalty.violation;
            const better = (pv > 1e-6 && newPen.violation < pv - 1e-8)
                        || (pv <= 1e-6 && newPen.violation <= 1e-6 && newPen.cost < penalty.cost - 1e-5);
            if (better) {
              improved = true;
              break;
            }
            x[i] += d; x[j] -= d; // revert
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (!improved) break;
    }
  }

  // Build best-effort formula from tracked x
  let bestEffortFormula = null;
  if (bestEffortX) {
    bestEffortFormula = {};
    for (let i = 0; i < n; i++) if (bestEffortX[i] > 0.005 || (parseFloat(ingrs[i].minIncl) || 0) > 0) bestEffortFormula[ingrs[i].id] = bestEffortX[i];
    normalizeTo100(bestEffortFormula);
  }

  return {
    formula: bestFeasible,
    cost: bestCost,
    bestEffortFormula: bestEffortFormula,
    bestEffortCost: bestEffortCost
  };
}

// Generate a diverse set of deterministic starting points
function generateStartingPoints(ingrs, reqs, activeNuts) {
  const n = ingrs.length;
  const points = [];

  // Pre-allocate the minIncl floor for each ingredient (mandatory premixes etc.)
  const mins = ingrs.map(function(i) { return Math.max(0, parseFloat(i.minIncl) || 0); });
  const minSum = mins.reduce(function(a, b) { return a + b; }, 0);
  // If forced minimums already exceed 100%, the problem is infeasible — return one point for solver to surface error
  if (minSum > 100) {
    return [mins.slice()];
  }
  const freeShare = 100 - minSum;

  // 1. Uniform allocation across the free share, layered on top of minIncl floor
  const uniform = mins.slice();
  let rem = freeShare;
  for (let i = 0; i < n; i++) {
    const cap = Math.min(parseFloat(ingrs[i].maxIncl) || 100, 100);
    const headroom = Math.max(0, cap - uniform[i]);
    const share = Math.min(headroom, freeShare / n);
    uniform[i] += share;
    rem -= share;
  }
  if (rem > 0.01) distributeRemainder(uniform, rem, ingrs);
  points.push(uniform);

  // 2. Skewed toward high-priority nutrients (one start per shortfall-prone nutrient)
  for (const nut of activeNuts) {
    const priority = ingrs
      .map(function(ing, idx) { return { idx: idx, val: parseFloat(ing[nut]) || 0 }; })
      .sort(function(a, b) { return b.val - a.val; });
    const x = mins.slice();
    let remaining = freeShare;
    for (const p of priority) {
      const cap = Math.min(parseFloat(ingrs[p.idx].maxIncl) || 100, 100);
      const headroom = Math.max(0, cap - x[p.idx]);
      const take = Math.min(headroom * 0.7, remaining);
      x[p.idx] += take;
      remaining -= take;
      if (remaining < 0.1) break;
    }
    if (remaining > 0.01) distributeRemainder(x, remaining, ingrs);
    points.push(x);
  }

  // 3. Cheapest-first (approximate LP solution)
  const byCost = ingrs
    .map(function(ing, idx) { return { idx: idx, price: parseFloat(ing.price) || 0 }; })
    .sort(function(a, b) { return a.price - b.price; });
  const x3 = new Array(n).fill(0);
  let rem3 = 100;
  for (const p of byCost) {
    const cap = Math.min(parseFloat(ingrs[p.idx].maxIncl) || 100, 100, rem3);
    x3[p.idx] = cap * 0.8;
    rem3 -= x3[p.idx];
  }
  if (rem3 > 0.01) distributeRemainder(x3, rem3, ingrs);
  points.push(x3);

  return points;
}

function distributeRemainder(x, rem, ingrs) {
  for (let i = 0; i < ingrs.length && rem > 0.01; i++) {
    const cap = Math.min(parseFloat(ingrs[i].maxIncl) || 100, 100);
    const canAdd = cap - x[i];
    const add = Math.min(canAdd, rem);
    x[i] += add;
    rem -= add;
  }
}

function computePenalty(x, ingrs, reqs, activeNuts) {
  let cost = 0, violation = 0, sum = 0;
  for (let i = 0; i < ingrs.length; i++) {
    cost += x[i] * (parseFloat(ingrs[i].price) || 0) / 100;
    sum += x[i];
    // Penalise violations of per-ingredient minIncl/maxIncl
    const lo = parseFloat(ingrs[i].minIncl) || 0;
    const hi = Math.min(parseFloat(ingrs[i].maxIncl) || 100, 100);
    if (x[i] < lo) violation += (lo - x[i]) / Math.max(lo, 0.5);
    if (x[i] > hi) violation += (x[i] - hi) / Math.max(hi, 0.5);
  }
  // Sum = 100
  violation += Math.abs(sum - 100);
  // Nutrient bounds
  for (const nut of activeNuts) {
    const req = reqs[nut];
    let val = 0;
    for (let i = 0; i < ingrs.length; i++) {
      val += x[i] * (parseFloat(ingrs[i][nut]) || 0) / 100;
    }
    if (val < req[0]) violation += (req[0] - val) / Math.max(req[0], 0.01);
    if (val > req[1]) violation += (val - req[1]) / Math.max(req[1], 0.01);
  }
  return { cost: cost, violation: violation };
}

// GOAL PROGRAMMING SOLVER (only used for DIAGNOSTIC purposes)
// Returns the closest-possible formula with its gaps, so we can report to the user
// what is missing. NEVER used as the production formula when strict LP fails.
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
    lb[i] = Math.max(0, parseFloat(ingrs[i].minIncl) || 0);
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
      const lo = parseFloat(ingrs[i].minIncl) || 0;
      if (pct > 0.005 || lo > 0) formula[ingrs[i].id] = pct;
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
    console.warn('Goal program error:', e);
    return null;
  }
}

// Compute gaps by trying to solve for ONE nutrient at a time
// For each nutrient, find the max achievable (for mins) or min achievable (for maxes)
// and compare to target. This gives truly-achievable gaps, not slack-LP gaps.
function computeTrueGaps(ingrs, reqs) {
  const n = ingrs.length;
  const activeNuts = NUTRIENTS.filter(function(nut) {
    return reqs[nut] && Array.isArray(reqs[nut]);
  });
  const gaps = {};
  const diagnosticFormula = {};

  // First, find the formula that maximizes weighted nutrient achievement
  // The easiest: use an unconstrained LP to find the nutrient-richest feasible mix
  // But we need something reasonable - let's just compute "how close can we get to each target?"

  // Simpler: for each shortfall nutrient, maximize its content
  //         for each excess nutrient, minimize its content
  activeNuts.forEach(function(nut) {
    const nutVals = ingrs.map(function(i) { return (parseFloat(i[nut]) || 0) / 100; });
    const reqMin = reqs[nut][0];
    const reqMax = reqs[nut][1];

    // Maximize nutrient content (for checking shortfalls)
    const cMax = nutVals.map(function(v) { return -v; }); // negate to maximize
    const A_eq = [new Array(n).fill(1)];
    const b_eq = [100];
    const lb = ingrs.map(function(i) { return Math.max(0, parseFloat(i.minIncl) || 0); });
    const ub = ingrs.map(function(i) { return Math.min(parseFloat(i.maxIncl) || 100, 100); });
    const maxRes = lpSolve({ c: cMax, A_eq: A_eq, b_eq: b_eq, lb: lb, ub: ub });
    const maxAchievable = maxRes && maxRes.x ? -maxRes.cost : 0;

    // Minimize nutrient content (for checking excesses)
    const cMin = nutVals.slice();
    const minRes = lpSolve({ c: cMin, A_eq: A_eq, b_eq: b_eq, lb: lb, ub: ub });
    const minAchievable = minRes && minRes.x ? minRes.cost : 0;

    const gap = {};
    if (reqMin > 0 && maxAchievable < reqMin) {
      gap.shortfall = reqMin - maxAchievable;
      gap.maxAchievable = maxAchievable;
      gap.target = reqMin;
    }
    if (reqMax < 9999 && minAchievable > reqMax) {
      gap.excess = minAchievable - reqMax;
      gap.minAchievable = minAchievable;
      gap.target = reqMax;
    }
    if (Object.keys(gap).length > 0) {
      gaps[nut] = gap;
    }
  });

  return gaps;
}

// MAIN ENTRY POINT — STRICT ON NUTRITION
// Returns { formula, quality, warnings, gaps, infeasible } 
// - formula: non-null ONLY if all nutrition met
// - infeasible: true when nutrition cannot be met
// - gaps: per-nutrient shortfall/excess info for the UI
function solveBestEffort(ingrs, reqs) {
  if (!ingrs || ingrs.length === 0) {
    return { formula: null, infeasible: true, reason: 'No ingredients provided', gaps: {}, warnings: [] };
  }
  if (!reqs) {
    return { formula: null, infeasible: true, reason: 'No nutritional requirements for this species+stage', gaps: {}, warnings: [] };
  }

  // Priority 1: strict LP — nutrition is mandatory
  const strict = solveStrictLP(ingrs, reqs);
  if (strict && strict.formula) {
    return {
      formula: strict.formula,
      quality: 'optimal',
      warnings: [],
      gaps: {},
      infeasible: false
    };
  }

  // Infeasible: compute true gaps per nutrient
  const gaps = computeTrueGaps(ingrs, reqs);
  const warnings = buildGapWarningsFromTrue(gaps, reqs);

  // Best-effort formula (closest-possible mix) from coordinate descent
  const diagnosticFormula = strict ? (strict.bestEffortFormula || null) : null;

  return {
    formula: null,
    infeasible: true,
    reason: 'Cannot meet nutritional targets with the selected ingredients',
    diagnosticFormula: diagnosticFormula,
    gaps: gaps,
    warnings: warnings,
    quality: 'infeasible'
  };
}

function buildGapWarningsFromTrue(gaps, reqs) {
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
    if (gap.shortfall) {
      warnings.push({
        nutrient: label, severity: 'danger',
        note: 'Best achievable ' + label + ' is ' + gap.maxAchievable.toFixed(2) + unit +
              ', but target requires at least ' + gap.target + unit +
              ' (short by ' + gap.shortfall.toFixed(2) + unit + ').'
      });
    }
    if (gap.excess) {
      warnings.push({
        nutrient: label, severity: 'danger',
        note: 'Minimum achievable ' + label + ' is ' + gap.minAchievable.toFixed(2) + unit +
              ', but target requires at most ' + gap.target + unit +
              ' (exceeds by ' + gap.excess.toFixed(2) + unit + ').'
      });
    }
  });
  return warnings;
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
    // Only suggest buys for SHORTFALLS (not excesses — you can't fix an excess by buying more of something)
    if (!gap.shortfall || gap.shortfall < 0.01) return;

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
  solveStrictLP,
  solveLeastCostLP,
  solveLeastCost,
  solveBestEffort,
  solveGoalProgram,
  suggestIngredientsToBuy,
  assessNutrientGaps,
  calcNutrients,
  calcCost
};
