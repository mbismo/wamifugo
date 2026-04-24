import { useState, useEffect, useContext, createContext, useCallback } from "react";
import { db } from "./db.js";
import { pullAll, pushCollection } from "./api.js";
import {
  SEED_USERS, SEED_ANIMAL_REQS, SEED_INGREDIENT_PROFILES,
  CATEGORY_META, CATEGORY_ICONS, FEEDING_QTY, TIPS, SPECIES_RECS,
  getAnimalReqs, getAnimalCategories, getStagesForCategory,
  getReqForStage, buildSpeciesList
} from "./constants.js";
import { solveLeastCost, solveLeastCostLP, calcNutrients, calcCost } from "./solver.js";
import { C, uid, today, dateRange, fmt, fmtKES } from "./utils.js";
import Pages from "./pages.mjs";

// Context
export const Ctx = createContext(null);

// Server sync helpers (wrapped API calls)
async function serverPullAll() {
  try { return await pullAll(); } catch { return {}; }
}
async function serverPush(col, data) {
  db.set(col, data);
  try { await pushCollection(col, data); } catch(e) { console.warn("Push failed:", e.message); }
}

// Animal requirements — read from localStorage cache or seed
function getAnimalReqsCurrent() {
  const stored = db.get("animalReqs");
  return stored && stored.length > 0 ? stored : SEED_ANIMAL_REQS;
}
function setAnimalReqsPersist(v) { db.set("animalReqs", v); serverPush("animalReqs", v); }

// Seed functions
function seedIngredients() {
  const stored = db.get("ingredients");
  return stored && stored.length > 0 ? stored : SEED_INGREDIENT_PROFILES;
}
function seedInventory(ingrs) {
  const stored = db.get("inventory");
  if (stored && stored.length > 0) return stored;
  return ingrs.map(i => ({
    id: i.id, name: i.name, category: i.category || "energy",
    qty: 0, lastPrice: i.price || 0, reorderLevel: 50, unit: "kg"
  }));
}
function buildCategories(ingrs) {
  return CATEGORY_META.map(cat => ({
    ...cat, items: ingrs.filter(i => i.category === cat.key)
  }));
}

export default function App() {
  const [user, setUser] = useState(() => db.get("session"));
  const [appReady, setAppReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [page, setPage] = useState("dashboard");
  // Initialize from localStorage first, fall back to seeds if empty
  const [ingredients, setIngrState] = useState(() => {
    const cached = db.get("ingredients", null);
    return (cached && cached.length > 0) ? cached : seedIngredients();
  });
  const [inventory, setInvState] = useState(() => {
    const cached = db.get("inventory", null);
    if (cached && cached.length > 0) return cached;
    const ingrs = seedIngredients();
    return seedInventory(ingrs);
  });
  const [sales, setSalesState] = useState(() => db.get("sales", []));
  const [purchases, setPurchState] = useState(() => db.get("purchases", []));
  const [customers, setCustState] = useState(() => db.get("customers", []));
  const [savedFormulas, setSavedFormulasState] = useState(() => db.get("savedFormulas", []));

  // Setters: update state, cache to localStorage, and push to server
  const setIngredients = v => { setIngrState(v); db.set("ingredients", v); serverPush("ingredients", v); };
  const setInventory   = v => { setInvState(v);  db.set("inventory", v);   serverPush("inventory", v); };
  const setSales       = v => { setSalesState(v); db.set("sales", v);      serverPush("sales", v); };
  const setPurchases   = v => { setPurchState(v); db.set("purchases", v);  serverPush("purchases", v); };
  const setCustomers   = v => { setCustState(v);  db.set("customers", v);  serverPush("customers", v); };
  const setSavedFormulas = v => { setSavedFormulasState(v); db.set("savedFormulas", v); serverPush("savedFormulas", v); };

  // Startup: pull ALL data from server before showing login
  useEffect(() => {
    const timeout = new Promise(res => setTimeout(() => res({}), 5000));
    Promise.race([serverPullAll(), timeout]).then(data => {
      if (data.inventory?.data)     { setInvState(data.inventory.data); db.set("inventory", data.inventory.data); }
      if (data.purchases?.data)     { setPurchState(data.purchases.data); db.set("purchases", data.purchases.data); }
      if (data.sales?.data)         { setSalesState(data.sales.data); db.set("sales", data.sales.data); }
      if (data.customers?.data)     { setCustState(data.customers.data); db.set("customers", data.customers.data); }
      if (data.ingredients?.data)   { setIngrState(data.ingredients.data); db.set("ingredients", data.ingredients.data); }
      if (data.animalReqs?.data)    db.set("animalReqs", data.animalReqs.data);
      if (data.savedFormulas?.data) { setSavedFormulasState(data.savedFormulas.data); db.set("savedFormulas", data.savedFormulas.data); }
      // Users go to localStorage for login check
      const serverUsers = data.users?.data;
      if (serverUsers && serverUsers.length > 0) {
        db.set("users", serverUsers);
      } else {
        const existing = db.get("users");
        if (!existing || existing.length === 0) {
          db.set("users", SEED_USERS);
          serverPush("users", SEED_USERS).catch(() => {});
        }
      }
    }).catch(() => {}).finally(() => setAppReady(true));
  }, []);

  // Poll every 60s while logged in, but NOT while user is actively typing
  useEffect(() => {
    if (!user) return;
    let lastInputTime = Date.now();
    const trackInput = () => { lastInputTime = Date.now(); };
    window.addEventListener('keydown', trackInput, { passive: true });
    window.addEventListener('input', trackInput, { passive: true, capture: true });
    const id = setInterval(() => {
      // Skip poll if user typed in the last 3 seconds
      if (Date.now() - lastInputTime < 3000) return;
      serverPullAll().then(data => {
        if (data.inventory?.data)     { setInvState(data.inventory.data); db.set("inventory", data.inventory.data); }
        if (data.purchases?.data)     { setPurchState(data.purchases.data); db.set("purchases", data.purchases.data); }
        if (data.sales?.data)         { setSalesState(data.sales.data); db.set("sales", data.sales.data); }
        if (data.customers?.data)     { setCustState(data.customers.data); db.set("customers", data.customers.data); }
        if (data.ingredients?.data)   { setIngrState(data.ingredients.data); db.set("ingredients", data.ingredients.data); }
        if (data.animalReqs?.data)    db.set("animalReqs", data.animalReqs.data);
        if (data.savedFormulas?.data) { setSavedFormulasState(data.savedFormulas.data); db.set("savedFormulas", data.savedFormulas.data); }
        if (data.users?.data)         db.set("users", data.users.data);
      });
    }, 60000);
    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', trackInput);
      window.removeEventListener('input', trackInput, true);
    };
  }, [user]);

  // Inactivity logout: 30 minutes
  useEffect(() => {
    if (!user) return;
    const TIMEOUT = 30 * 60 * 1000;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setUser(null); db.set("session", null);
        alert("Logged out due to 30 minutes of inactivity.");
      }, TIMEOUT);
    };
    const evts = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    evts.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); evts.forEach(e => window.removeEventListener(e, reset)); };
  }, [user]);

  const login = u => { setUser(u); db.set("session", u); };
  const logout = () => { setUser(null); db.set("session", null); };

  // Loading splash
  if (!appReady) return (
    <div style={{ minHeight:"100vh", background:C.earth, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ fontSize:52 }}>🌾</div>
      <div style={{ fontFamily:"Playfair Display, serif", fontSize:22, fontWeight:900,
        color:"rgba(255,255,255,0.9)" }}>Wa-Mifugo Feeds</div>
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <div className="spin" style={{ width:18, height:18,
          border:"2px solid rgba(255,255,255,0.2)",
          borderTopColor:"rgba(255,255,255,0.85)", borderRadius:"50%" }} />
        <span style={{ color:"rgba(255,255,255,0.6)", fontSize:13 }}>Loading...</span>
      </div>
    </div>
  );

  const ctx = {
    user, ingredients, setIngredients, inventory, setInventory,
    sales, setSales, purchases, setPurchases, customers, setCustomers,
    savedFormulas, setSavedFormulas,
    // Helpers passed through context so pages can use them
    C, uid, today, dateRange, fmt, fmtKES,
    buildCategories,
    getAnimalReqsCurrent, setAnimalReqsPersist,
    getAnimalReqs, getAnimalCategories, getStagesForCategory,
    getReqForStage, buildSpeciesList,
    solveLeastCost, solveLeastCostLP, calcNutrients, calcCost,
    SEED_USERS, SEED_ANIMAL_REQS, SEED_INGREDIENT_PROFILES,
    CATEGORY_META, CATEGORY_ICONS, FEEDING_QTY, TIPS, SPECIES_RECS,
    serverPush,
    db,
  };

  return (
    <Ctx.Provider value={ctx}>
      <Pages
        page={page} setPage={setPage}
        user={user} onLogin={login} onLogout={logout}
        sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
      />
    </Ctx.Provider>
  );
}
