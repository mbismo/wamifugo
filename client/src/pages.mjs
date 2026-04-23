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

//  ANTI-NUTRITIVE FACTORS DATABASE 
// Sources: ILRI Feed Composition Tables, NRC (2012), FAO Animal Feed Resources
// Each factor defines: which ingredient, which factor, safe limit per species,
// and what harm it causes above that limit.

const ANTI_NUTRITIVE_FACTORS = {
  // Cottonseed cake  -  gossypol toxicity
  'ing_6': {
    factor: 'Gossypol',
    description: 'Binds iron, causes reproductive failure and cardiac damage at high doses',
    limits: {
      'Poultry (Broiler)':  { maxPct: 8,  warning: 6,  note: 'Free gossypol limit: 100mg/kg feed. Causes discolouration of egg yolks in layers.' },
      'Poultry (Layer)':    { maxPct: 5,  warning: 3,  note: 'Causes olive/khaki discolouration of egg yolks. Keep below 5% to avoid.' },
      'Poultry (Kienyeji)': { maxPct: 8,  warning: 6,  note: 'Same as broiler. Monitor yolk colour.' },
      'Swine':              { maxPct: 10, warning: 8,  note: 'Gossypol accumulates in boars. Causes reproductive failure above 100mg/kg.' },
      'Dairy Cattle':       { maxPct: 20, warning: 15, note: 'Ruminants detoxify gossypol in rumen. Safe up to 20% but monitor.' },
      'Beef Cattle':        { maxPct: 20, warning: 15, note: 'Ruminants tolerate well. Young calves more sensitive  -  limit to 10%.' },
      'Rabbit':             { maxPct: 10, warning: 7,  note: 'Moderate sensitivity. Monitor for reproductive issues.' },
      'Fish (Tilapia)':     { maxPct: 5,  warning: 3,  note: 'Gossypol reduces growth and causes liver damage in fish.' },
      'Goat / Sheep':       { maxPct: 15, warning: 12, note: 'Similar to cattle. Young animals more sensitive.' },
    }
  },
  // Cassava meal  -  hydrocyanic acid (HCN) / cyanogenic glucosides
  'ing_14': {
    factor: 'Hydrocyanic Acid (HCN)',
    description: 'Cyanogenic glucosides release HCN  -  blocks cellular respiration',
    limits: {
      'Poultry (Broiler)':  { maxPct: 15, warning: 10, note: 'HCN content varies. Properly dried cassava is safer. Limit to 15%.' },
      'Poultry (Layer)':    { maxPct: 10, warning: 7,  note: 'Can reduce egg production. Properly processed cassava preferred.' },
      'Poultry (Kienyeji)': { maxPct: 15, warning: 10, note: 'Same as broiler.' },
      'Swine':              { maxPct: 20, warning: 15, note: 'Pigs tolerate well if properly dried. Limit in young piglets.' },
      'Dairy Cattle':       { maxPct: 30, warning: 25, note: 'Ruminants handle HCN via rumen detox. Ensure proper drying.' },
      'Beef Cattle':        { maxPct: 30, warning: 25, note: 'Well-dried cassava is safe at high levels in ruminants.' },
      'Rabbit':             { maxPct: 15, warning: 10, note: 'Moderate sensitivity. Use properly dried/fermented cassava only.' },
      'Fish (Tilapia)':     { maxPct: 10, warning: 7,  note: 'HCN toxic to fish. Use only sun-dried or detoxified cassava.' },
      'Goat / Sheep':       { maxPct: 30, warning: 25, note: 'Similar to cattle tolerance.' },
    }
  },
  // Urea  -  non-protein nitrogen, toxic to monogastrics
  'ing_18': {
    factor: 'Non-Protein Nitrogen (Urea)',
    description: 'Converted to ammonia  -  useful in ruminants only, toxic to monogastrics',
    limits: {
      'Poultry (Broiler)':  { maxPct: 0,  warning: 0,  note: 'EXCLUDED: Poultry cannot utilise NPN. Causes ammonia toxicity.' },
      'Poultry (Layer)':    { maxPct: 0,  warning: 0,  note: 'EXCLUDED: Toxic to all poultry.' },
      'Poultry (Kienyeji)': { maxPct: 0,  warning: 0,  note: 'EXCLUDED: Toxic to all poultry.' },
      'Swine':              { maxPct: 0,  warning: 0,  note: 'EXCLUDED: Pigs cannot utilise NPN. Causes urea toxicity.' },
      'Dairy Cattle':       { maxPct: 1,  warning: 0.8,note: 'Max 1% of DM. Introduced gradually. Never feed hungry animals.' },
      'Beef Cattle':        { maxPct: 1,  warning: 0.8,note: 'Max 1% of DM. Gradual introduction essential. Toxic if overdosed.' },
      'Rabbit':             { maxPct: 0,  warning: 0,  note: 'EXCLUDED: Hindgut fermenters cannot utilise urea safely.' },
      'Fish (Tilapia)':     { maxPct: 0,  warning: 0,  note: 'EXCLUDED: Toxic to fish.' },
      'Goat / Sheep':       { maxPct: 1,  warning: 0.8,note: 'Max 1% of DM. Same precautions as cattle.' },
    }
  },
  // Sorghum  -  condensed tannins
  'ing_13': {
    factor: 'Condensed Tannins',
    description: 'Bind protein and reduce digestibility. High-tannin varieties cause growth depression.',
    limits: {
      'Poultry (Broiler)':  { maxPct: 20, warning: 15, note: 'High-tannin sorghum reduces AME and growth rate. Use low-tannin varieties.' },
      'Poultry (Layer)':    { maxPct: 15, warning: 10, note: 'Reduces egg production and feed efficiency.' },
      'Poultry (Kienyeji)': { maxPct: 20, warning: 15, note: 'More tolerant than commercial broilers. Still limit high-tannin varieties.' },
      'Swine':              { maxPct: 30, warning: 25, note: 'Pigs tolerate tannins better than poultry.' },
      'Dairy Cattle':       { maxPct: 40, warning: 35, note: 'Ruminants tolerate tannins well. Can reduce bloat.' },
      'Beef Cattle':        { maxPct: 40, warning: 35, note: 'Well tolerated. Some tannins reduce methane production.' },
      'Rabbit':             { maxPct: 20, warning: 15, note: 'Moderate sensitivity. Avoid high-tannin varieties.' },
      'Fish (Tilapia)':     { maxPct: 15, warning: 10, note: 'Tannins reduce palatability and nutrient absorption.' },
      'Goat / Sheep':       { maxPct: 40, warning: 30, note: 'Ruminants tolerate well. Browsing animals evolutionarily adapted.' },
    }
  },
  // Blood meal  -  palatability and amino acid imbalance
  'ing_17': {
    factor: 'Palatability / Amino Acid Imbalance',
    description: 'High in lysine but deficient in isoleucine. Poor palatability limits inclusion.',
    limits: {
      'Poultry (Broiler)':  { maxPct: 4,  warning: 3,  note: 'Isoleucine deficiency above 3%. Max 4%. Mix with other protein sources.' },
      'Poultry (Layer)':    { maxPct: 3,  warning: 2,  note: 'Reduces feed intake due to poor palatability.' },
      'Poultry (Kienyeji)': { maxPct: 4,  warning: 3,  note: 'Same as broiler.' },
      'Swine':              { maxPct: 5,  warning: 4,  note: 'Palatability issues. Mix with molasses to improve acceptance.' },
      'Dairy Cattle':       { maxPct: 5,  warning: 4,  note: 'Good rumen bypass protein. Effective at 2-5% of concentrate.' },
      'Beef Cattle':        { maxPct: 5,  warning: 4,  note: 'Effective bypass protein supplement.' },
      'Rabbit':             { maxPct: 3,  warning: 2,  note: 'Poor palatability is the main limit. Keep low.' },
      'Fish (Tilapia)':     { maxPct: 10, warning: 7,  note: 'Fish accept blood meal better than mammals. Good lysine source.' },
      'Goat / Sheep':       { maxPct: 5,  warning: 4,  note: 'Same as cattle considerations.' },
    }
  },
  // Fish meal  -  biogenic amines + scombrotoxin risk at high inclusions
  'ing_4': {
    factor: 'Biogenic Amines / Trimethylamine',
    description: 'Poor quality fish meal contains histamine and TMA  -  causes fish taint in products',
    limits: {
      'Poultry (Broiler)':  { maxPct: 8,  warning: 6,  note: 'Max 8% for meat birds. Above 5% can cause fishy taint in meat.' },
      'Poultry (Layer)':    { maxPct: 4,  warning: 3,  note: 'CRITICAL: Above 4% causes fishy taint in eggs  -  unmarketable.' },
      'Poultry (Kienyeji)': { maxPct: 6,  warning: 4,  note: 'Same taint risk as layers above 4%.' },
      'Swine':              { maxPct: 8,  warning: 6,  note: 'Can cause pork taint. Withdraw 2 weeks before slaughter.' },
      'Dairy Cattle':       { maxPct: 5,  warning: 3,  note: 'Can cause fishy milk taint. Many farmers avoid entirely.' },
      'Beef Cattle':        { maxPct: 8,  warning: 6,  note: 'Less taint risk in beef. Good protein source for young stock.' },
      'Rabbit':             { maxPct: 5,  warning: 3,  note: 'Palatability issues at high levels. Keep below 5%.' },
      'Fish (Tilapia)':     { maxPct: 15, warning: 10, note: 'Fish generally accept fish meal well.' },
      'Goat / Sheep':       { maxPct: 5,  warning: 3,  note: 'Can cause off-flavour in milk. Use carefully in dairy goats.' },
    }
  },
  // Wheat bran  -  phytate reduces mineral absorption
  'ing_3': {
    factor: 'Phytate (Phytic Acid)',
    description: 'Binds calcium, zinc, iron  -  reduces mineral bioavailability',
    limits: {
      'Poultry (Broiler)':  { maxPct: 15, warning: 12, note: 'Phytase enzyme recommended above 10%. Reduces Ca/P availability.' },
      'Poultry (Layer)':    { maxPct: 12, warning: 10, note: 'Can affect eggshell quality. Add phytase enzyme if using heavily.' },
      'Poultry (Kienyeji)': { maxPct: 18, warning: 15, note: 'More tolerant than commercial birds.' },
      'Swine':              { maxPct: 20, warning: 15, note: 'Add phytase above 15% to maintain mineral availability.' },
      'Dairy Cattle':       { maxPct: 30, warning: 25, note: 'Rumen microbes partially break down phytate.' },
      'Beef Cattle':        { maxPct: 30, warning: 25, note: 'Well tolerated. Good fibre source.' },
      'Rabbit':             { maxPct: 20, warning: 15, note: 'Good fibre source. Hindgut fermentation helps break down phytate.' },
      'Fish (Tilapia)':     { maxPct: 15, warning: 10, note: 'Phytate significantly reduces zinc absorption in fish.' },
      'Goat / Sheep':       { maxPct: 30, warning: 25, note: 'Similar to cattle tolerance.' },
    }
  },
  // Sunflower cake  -  chlorogenic acid reduces protein digestibility
  'ing_5': {
    factor: 'Chlorogenic Acid',
    description: 'Reduces protein digestibility and causes discolouration',
    limits: {
      'Poultry (Broiler)':  { maxPct: 15, warning: 12, note: 'Chlorogenic acid reduces protein digestibility. High fibre limit use.' },
      'Poultry (Layer)':    { maxPct: 12, warning: 10, note: 'Can cause egg discolouration.' },
      'Poultry (Kienyeji)': { maxPct: 18, warning: 15, note: 'More tolerant.' },
      'Swine':              { maxPct: 15, warning: 12, note: 'High fibre content limits use.' },
      'Dairy Cattle':       { maxPct: 25, warning: 20, note: 'Good protein for ruminants. High in fibre.' },
      'Beef Cattle':        { maxPct: 25, warning: 20, note: 'Good protein supplement.' },
      'Rabbit':             { maxPct: 20, warning: 15, note: 'High fibre suitable for rabbits.' },
      'Fish (Tilapia)':     { maxPct: 12, warning: 8,  note: 'Reduces feed palatability and growth.' },
      'Goat / Sheep':       { maxPct: 25, warning: 20, note: 'Good protein for small ruminants.' },
    }
  },
};

// Get anti-nutritive limit for a specific ingredient + species
function getANFLimit(ingId, species) {
  const anf = ANTI_NUTRITIVE_FACTORS[ingId];
  if (!anf) return null;
  const limit = anf.limits[species];
  if (!limit) return null;
  return { ...anf, ...limit };
}

// Get effective max inclusion considering anti-nutritive factors
function getEffectiveMaxIncl(ing, species) {
  const base = ing.maxIncl !== undefined ? ing.maxIncl : 100;
  const anf = getANFLimit(ing.id, species);
  if (!anf) return base;
  if (anf.maxPct === 0) return 0; // completely excluded
  return Math.min(base, anf.maxPct);
}

// Check formula for anti-nutritive warnings
function checkANFWarnings(formula, ingredients, species) {
  const warnings = [];
  const exclusions = [];
  Object.entries(formula).forEach(([id, pct]) => {
    const anf = getANFLimit(id, species);
    if (!anf) return;
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;
    if (anf.maxPct === 0) {
      exclusions.push({ ingredient: ing.name, factor: anf.factor, note: anf.note });
    } else if (pct > anf.maxPct) {
      warnings.push({ ingredient: ing.name, factor: anf.factor, current: pct.toFixed(1), limit: anf.maxPct, note: anf.note, severity: 'danger' });
    } else if (pct > anf.warning) {
      warnings.push({ ingredient: ing.name, factor: anf.factor, current: pct.toFixed(1), limit: anf.maxPct, note: anf.note, severity: 'warning' });
    }
  });
  return { warnings, exclusions };
}


// Build ingredient categories from CATEGORY_META
function buildCategories(ingredients) {
  return CATEGORY_META.map(cat => ({
    ...cat,
    items: ingredients.filter(i => (i.category || 'energy') === cat.key)
  }));
}

// Animal requirements persistence
function setAnimalReqs(v) {
  db.set('animalReqs', v);
  serverPush('animalReqs', v);
}

// Server push  -  fire and forget, never blocks the UI
async function serverPush(col, data) {
  const key = import.meta.env?.VITE_SYNC_KEY || 'wamifugo2024';
  try {
    await fetch('/api/data/' + col, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Key': key },
      body: JSON.stringify({ data, ts: Date.now() }),
    });
  } catch (e) { console.warn('Push failed:', e.message); }
}

//  UI ATOMS 
function Btn({children,onClick,variant='primary',size='md',disabled=false,style={}}){
  const v={primary:{bg:C.earth,c:C.cream,b:C.earth},secondary:{bg:'white',c:C.soil,b:C.border},
    success:{bg:C.grass,c:'white',b:C.grass},danger:{bg:C.danger,c:'white',b:C.danger},
    warning:{bg:C.warning,c:'white',b:C.warning},ghost:{bg:'transparent',c:C.muted,b:'transparent'}}[variant]||{bg:C.earth,c:C.cream,b:C.earth};
  const sz={sm:{padding:'5px 11px',fontSize:11},md:{padding:'8px 15px',fontSize:13},lg:{padding:'12px 22px',fontSize:15}}[size]||{padding:'8px 15px',fontSize:13};
  return h('button',{onClick,disabled,style:{...sz,background:v.bg,color:v.c,border:`1px solid ${v.b}`,borderRadius:8,fontWeight:600,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.5:1,fontFamily:"'DM Sans',sans-serif",transition:'all 0.15s',...style}},children);
}

function Badge({children,color=C.savanna}){
  return h('span',{style:{background:color+'22',color,border:`1px solid ${color}44`,borderRadius:20,padding:'2px 9px',fontSize:10,fontWeight:700,fontFamily:"'DM Mono',monospace",letterSpacing:1,textTransform:'uppercase'}},children);
}

function Card({children,style={}}){
  return h('div',{style:{background:'white',border:`1px solid ${C.border}`,borderRadius:14,overflow:'hidden',...style}},children);
}

function CardTitle({children,action}){
  return h('div',{style:{background:C.parchment,padding:'11px 17px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}},
    h('span',{style:{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:600,letterSpacing:2,textTransform:'uppercase',color:C.muted}},children),
    action||null);
}

function Inp({label,value,onChange,type='text',placeholder='',required=false,style={}}){
  return h('div',{style:{marginBottom:12}},
    label&&h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:C.muted,marginBottom:4}},label,required&&h('span',{style:{color:C.danger}},('*'))),
    h('input',{type,value,onChange:e=>onChange(e.target.value),placeholder,
      style:{width:'100%',padding:'8px 11px',border:'1px solid '+C.border,borderRadius:8,fontSize:13,color:C.ink,background:C.cream,outline:'none',...style}})
  );
}

function Sel({label,value,onChange,options,style={}}){
  return h('div',{style:{marginBottom:12}},
    label&&h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:C.muted,marginBottom:4}},label),
    h('select',{value,onChange:e=>onChange(e.target.value),
      style:{width:'100%',padding:'8px 11px',border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.ink,background:C.cream,...style}},
      options.map(o=>h('option',{key:o.value,value:o.value},o.label)))
  );
}

function StatCard({label,value,sub,color=C.earth,icon}){
  return h('div',{style:{background:'white',border:`1px solid ${C.border}`,borderRadius:14,padding:'17px 19px',borderLeft:`4px solid ${color}`}},
    h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:7}},
      h('div',{style:{fontSize:11,fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:1.5,color:C.muted}},label),
      icon&&h('span',{style:{fontSize:22}},icon)),
    h('div',{style:{fontSize:26,fontFamily:"'Playfair Display',serif",fontWeight:900,color}},value),
    sub&&h('div',{style:{fontSize:12,color:C.muted,marginTop:3}},sub));
}

function Modal({title,children,onClose,width=560}){
  return h('div',{style:{position:'fixed',inset:0,background:'rgba(26,18,8,0.6)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}},
    h('div',{style:{background:'white',borderRadius:16,width:'100%',maxWidth:width,maxHeight:'90vh',overflow:'auto',boxShadow:'0 24px 80px rgba(0,0,0,0.3)'}},
      h('div',{style:{background:C.earth,padding:'15px 19px',display:'flex',alignItems:'center',justifyContent:'space-between'}},
        h('span',{style:{fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:700,color:'white'}},title),
        h('button',{onClick:onClose,style:{background:'none',border:'none',color:'rgba(255,255,255,0.7)',fontSize:20,cursor:'pointer'}},'')),
      h('div',{style:{padding:19}},children)));
}

function Tbl({cols,rows,emptyMsg='No data'}){
  return h('div',{style:{overflowX:'auto'}},
    h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:13}},
      h('thead',null,h('tr',null,...cols.map(c=>h('th',{key:c.key,style:{padding:'9px 13px',textAlign:'left',background:C.parchment,fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:1.5,textTransform:'uppercase',color:C.muted,borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap'}},c.label)))),
      h('tbody',null,rows.length===0
        ?h('tr',null,h('td',{colSpan:cols.length,style:{padding:'28px',textAlign:'center',color:C.muted}},emptyMsg))
        :rows.map((row,i)=>h('tr',{key:i,style:{borderBottom:`1px solid ${C.border}`}},...cols.map(c=>h('td',{key:c.key,style:{padding:'9px 13px',color:C.ink,verticalAlign:'middle'}},c.render?c.render(row):row[c.key])))))));
}

function PageHdr({title,subtitle,action}){
  return h('div',{style:{padding:'22px 26px 0',display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:18}},
    h('div',null,
      h('h1',{style:{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:900,color:C.earth,lineHeight:1.1}},title),
      subtitle&&h('div',{style:{fontSize:13,color:C.muted,marginTop:4}},subtitle)),
    action||null);
}

function Toast({msg,type}){
  const bg=type==='error'?C.danger:type==='warn'?C.warning:C.grass;
  return h('div',{style:{position:'fixed',top:20,right:20,background:bg,color:'white',padding:'12px 20px',borderRadius:10,fontSize:13,fontWeight:600,zIndex:999,boxShadow:'0 4px 20px rgba(0,0,0,0.2)',maxWidth:320}},msg);
}



const NAV=[
  {key:'dashboard',icon:'',label:'Dashboard'},
  {key:'formulator',icon:'',label:'Feed Formulator'},
  {key:'inventory',icon:'',label:'Inventory'},
  {key:'customers',icon:'',label:'Customers'},
  {key:'sales',icon:'',label:'Sales'},
  {key:'reports',icon:'',label:'Reports'},
  {key:'feeding_guide',icon:'',label:'Feeding Guide'},
  {key:'education',icon:'',label:'Education Screen'},
  {key:'resources',icon:'',label:'Resources'},
  {key:'traceability',icon:'',label:'Traceability Log',admin:true},
  {key:'ingredients',icon:'',label:'Ingredients',admin:true},
  {key:'nutrition',icon:'',label:'Nutritional Reqs',admin:true},
  {key:'users',icon:'',label:'Users',admin:true},
];




function LoginPage({onLogin}){
  const [view,setView]=useState('login');
  const [uname,setUname]=useState('');
  const [pass,setPass]=useState('');
  const [email,setEmail]=useState('');
  const [code,setCode]=useState('');
  const [newPass,setNewPass]=useState('');
  const [newPass2,setNewPass2]=useState('');
  const [msg,setMsg]=useState('');
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(false);
  const [anfWarnings,setAnfWarnings]=useState([]);
  const [anfExclusions,setAnfExclusions]=useState([]);
  const setE=e=>{setErr(e);setMsg('');};
  const setM=m=>{setMsg(m);setErr('');};
  const login=()=>{
    setErr('');
    // Always fall back to seed admin so default credentials always work
    const stored=db.get('users',null);
    const users=(stored&&stored.length>0)?stored:SEED_USERS;
    const user=users.find(u=>u.username===uname&&u.password===pass&&u.active);
    if(user)onLogin(user);else setE('Invalid username or password.');
  };
  const requestCode=async()=>{if(!email.trim()){setE('Enter your email.');return;}setLoading(true);setE('');try{const r=await fetch('/api/auth/reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim()})});const d=await r.json();setLoading(false);if(d.ok){setM(d.msg||'Code sent  -  check inbox and spam.');setView('verify');}else setE(d.error||'Something went wrong.');}catch{setLoading(false);setE('Could not reach server.');}};
  const verifyCode=async()=>{if(code.length!==6){setE('Enter the 6-digit code.');return;}setLoading(true);setE('');try{const r=await fetch('/api/auth/reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify_code',email:email.trim(),code:code.trim()})});const d=await r.json();setLoading(false);if(d.ok){setView('newpass');setM('');}else setE(d.error||'Invalid code.');}catch{setLoading(false);setE('Could not reach server.');}};
  const resetPassword=async()=>{if(!newPass){setE('Min 6 characters.');return;}if(newPass!==newPass2){setE('Passwords do not match.');return;}setLoading(true);setE('');try{const r=await fetch('/api/auth/reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset_password',email:email.trim(),code:code.trim(),password:newPass})});const d=await r.json();setLoading(false);if(d.ok){const us=db.get('users',SEED_USERS);db.set('users',us.map(u=>u.email&&u.email.toLowerCase()===email.trim().toLowerCase()?{...u,password:newPass}:u));setM('Password updated! You can now sign in.');setView('login');setCode('');setNewPass('');setNewPass2('');}else setE(d.error||'Could not update password.');}catch{setLoading(false);setE('Could not reach server.');}};
  const saveBtnLabel=loading?'Saving...':'Set New Password';
  const card=h('div',{style:{background:'white',borderRadius:20,padding:'40px 36px',width:'100%',maxWidth:400,boxShadow:'0 32px 80px rgba(0,0,0,0.4)'}},
    h('div',{style:{textAlign:'center',marginBottom:28}},
      h('div',{style:{fontSize:46,marginBottom:8}},''),
      h('div',{style:{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:C.earth,lineHeight:1.1}},('Wa-Mifugo'),
      h('div',{style:{fontFamily:"'DM Mono',monospace",fontSize:10,color:C.muted,letterSpacing:2,textTransform:'uppercase',marginTop:4}},('Feeds Management System'),
      view!=='login'&&h('div',{style:{marginTop:10,fontSize:13,color:C.soil,fontWeight:600}},view==='forgot'?'Reset Password':view==='verify'?'Enter Code':'New Password')),
    err&&h('div',{style:{background:'#fde8e8',color:C.danger,padding:'9px 13px',borderRadius:8,fontSize:13,marginBottom:12,border:'1px solid '+C.danger+'44'}},err),
    msg&&h('div',{style:{background:'#f0f9f4',color:C.grass,padding:'9px 13px',borderRadius:8,fontSize:13,marginBottom:12,border:'1px solid '+C.grass+'44'}},msg),
    view==='login'&&h('div',null,
      Inp({label:'Username',value:uname,onChange:setUname,placeholder:'Enter username'}),
      Inp({label:'Password',value:pass,onChange:v=>{setPass(v);setErr('');},type:'password',placeholder:'Enter password'}),
      h(Btn,{onClick:login,size:'lg',style:{width:'100%',marginTop:10}},('Sign In '),
      h('div',{style:{textAlign:'center',marginTop:14}},h('span',{style:{fontSize:13,color:C.muted,cursor:'pointer',textDecoration:'underline'},onClick:()=>{setView('forgot');setErr('');setMsg('');}},(' Forgot password?'))),
    view==='forgot'&&h('div',null,
      Inp({label:'Registered Email',value:email,onChange:setEmail,type:'email',placeholder:'e.g. jane@example.com'}),
      h(Btn,{onClick:requestCode,size:'lg',style:{width:'100%',marginTop:10},disabled:loading},(loading?'Sending...':'Send Reset Code')),
      h('div',{style:{textAlign:'center',marginTop:12}},h('span',{style:{fontSize:13,color:C.muted,cursor:'pointer',textDecoration:'underline'},onClick:()=>{setView('login');setErr('');setMsg('');}},(' Back to sign in'))),
    view==='verify'&&h('div',null,
      h('p',{style:{fontSize:13,color:C.muted,marginBottom:12}},'Code sent to ',h('strong',null,email),'. Expires in 15 min.'),
      h('div',{style:{marginBottom:12}},
        h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',color:C.muted,marginBottom:5}},('6-Digit Code'),
        h('input',{value:code,onChange:e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6)),placeholder:'000000',maxLength:6,style:{width:'100%',padding:'12px',border:'2px solid '+C.border,borderRadius:10,fontSize:28,fontFamily:"'DM Mono',monospace",fontWeight:700,letterSpacing:12,textAlign:'center',background:C.cream}})),
      h(Btn,{onClick:verifyCode,size:'lg',style:{width:'100%'},disabled:loading||code.length!==6},(loading?'Verifying...':'Verify Code')),
      h('div',{style:{textAlign:'center',marginTop:12}},h('span',{style:{fontSize:13,color:C.muted,cursor:'pointer',textDecoration:'underline'},onClick:()=>{setView('forgot');setCode('');setErr('');setMsg('');}},(' Resend code'))),
    view==='newpass'&&h('div',null,
      h('div',{style:{marginBottom:10}},h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',color:C.muted,marginBottom:4}},('New Password'),h('input',{type:'password',value:newPass,onChange:e=>setNewPass(e.target.value),placeholder:'Min 6 characters',style:{width:'100%',padding:'9px 12px',border:'1px solid '+C.border,borderRadius:8,fontSize:14,background:C.cream}})),
      h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',color:C.muted,marginBottom:4}},('Confirm Password'),h('input',{type:'password',value:newPass2,onChange:e=>setNewPass2(e.target.value),placeholder:'Repeat new password',style:{width:'100%',padding:'9px 12px',border:'1px solid '+(newPass2&&newPass2!==newPass?C.danger:C.border),borderRadius:8,fontSize:14,background:C.cream}})),
      h(Btn,{onClick:resetPassword,size:'lg',style:{width:'100%'},disabled:loading||!newPass||!newPass2||newPass!==newPass2},saveBtnLabel)));
  return h('div',{style:{minHeight:'100vh',background:C.earth,display:'flex',alignItems:'center',justifyContent:'center',padding:16}},card);
}

//  SIDEBAR 
function Sidebar({page,setPage,user,onLogout,isOpen=false,onClose=()=>{}}){
  return h('div',{className:'wm-sidebar'+(isOpen?' open':''),style:{width:215,background:C.earth,minHeight:'100vh',display:'flex',flexDirection:'column',flexShrink:0,position:'relative',zIndex:1000,transition:'left 0.25s ease'}},
    h('div',{style:{padding:'18px 15px 14px',borderBottom:'1px solid rgba(255,255,255,0.1)'}},
      h('div',{style:{fontFamily:"'Playfair Display',serif",fontSize:21,fontWeight:900,color:'white',lineHeight:1}},('Wa-Mifugo'),
      h('div',{style:{fontFamily:"'DM Mono',monospace",fontSize:9,color:C.harvest,letterSpacing:2,textTransform:'uppercase',marginTop:4}},('Feeds Management')),
    h('nav',{style:{flex:1,padding:'8px 7px'}},
      NAV.filter(n=>!n.admin||user.role==='admin').map(item=>
        h('button',{key:item.key,onClick:()=>{setPage(item.key);onClose();},
          style:{display:'flex',alignItems:'center',gap:9,width:'100%',padding:'9px 11px',borderRadius:8,border:'none',
            background:page===item.key?'rgba(255,255,255,0.15)':'transparent',
            color:page===item.key?'white':'rgba(255,255,255,0.62)',
            fontSize:13,fontWeight:page===item.key?600:400,fontFamily:"'DM Sans',sans-serif",
            cursor:'pointer',textAlign:'left',marginBottom:2,transition:'all 0.15s'}},
          h('span',{style:{fontSize:16}},item.icon),item.label))),
    h('div',{style:{padding:'13px 15px',borderTop:'1px solid rgba(255,255,255,0.1)'}},
      h('div',{style:{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:3}},('Signed in as'),
      h('div',{style:{fontSize:13,color:'white',fontWeight:600}},user.name),
      h('div',{style:{fontSize:10,color:C.harvest,textTransform:'uppercase',letterSpacing:1,fontFamily:"'DM Mono',monospace"}},user.role),
      h('button',{onClick:onLogout,style:{marginTop:9,fontSize:12,color:'rgba(255,255,255,0.45)',background:'none',border:'none',cursor:'pointer',padding:0}},('Sign out ')));
}

//  DASHBOARD 

function DashboardPage(){
  const {sales,inventory}=useContext(Ctx);
  const todaySales=sales.filter(s=>s.date===today());
  const monthSales=sales.filter(s=>s.date>=dateRange(30));
  const weekSales=sales.filter(s=>s.date>=dateRange(7));
  const rev=monthSales.reduce((s,x)=>s+x.total,0);
  const cost=monthSales.reduce((s,x)=>s+x.cost,0);
  const profit=rev-cost;
  const lowStock=inventory.filter(i=>i.qty <= i.reorderLevel);
  const last7=Array.from({length:7},(_,i)=>{
    const d=new Date();d.setDate(d.getDate()-(6-i));
    const ds=d.toISOString().slice(0,10);
    const day=sales.filter(s=>s.date===ds);
    return{day:d.toLocaleDateString('en-KE',{weekday:'short'}),rev:day.reduce((s,x)=>s+x.total,0)};
  });
  const maxR=Math.max(...last7.map(d=>d.rev),1);
  return h('div',{style:{padding:'0 26px 26px'}},
    h(PageHdr,{title:'Dashboard',subtitle:`Overview for ${new Date().toLocaleDateString('en-KE',{weekday:'long',day:'numeric',month:'long'})}`}),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:13,marginBottom:18}},
      h(StatCard,{label:"Today's Sales",value:fmtKES(todaySales.reduce((s,x)=>s+x.total,0)),sub:`${todaySales.length} orders`,color:C.grass,icon:''}),
      h(StatCard,{label:'Monthly Revenue',value:fmtKES(rev),sub:'Last 30 days',color:C.savanna,icon:''}),
      h(StatCard,{label:'Monthly Profit',value:fmtKES(profit),sub:`${rev?((profit/rev)*100).toFixed(1):0}% margin`,color:profit > -1?C.grass:C.danger,icon:''}),
      h(StatCard,{label:'Low Stock Alerts',value:lowStock.length,sub:'items need reorder',color:lowStock.length>0?C.danger:C.grass,icon:'!'})),
    h('div',{style:{display:'grid',gridTemplateColumns:'2fr 1fr',gap:15,marginBottom:15}},
      h(Card,null,
        h(CardTitle,null,'Revenue  -  Last 7 Days'),
        h('div',{style:{padding:'18px 14px'}},
          h('div',{style:{display:'flex',alignItems:'flex-end',gap:9,height:130}},
            last7.map((d,i)=>h('div',{key:i,style:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}},
              h('div',{style:{fontSize:10,color:C.muted,fontFamily:"'DM Mono',monospace"}},d.rev>0?fmtKES(d.rev).replace('KES ',''):''),
              h('div',{style:{width:'100%',background:C.border,borderRadius:4,overflow:'hidden',height:90,display:'flex',flexDirection:'column',justifyContent:'flex-end'}},
                h('div',{style:{height:`${(d.rev/maxR)*100}%`,background:`linear-gradient(to top,${C.earth},${C.savanna})`,borderRadius:4,minHeight:d.rev>0?4:0}})),
              h('div',{style:{fontSize:10,color:C.muted}},d.day)))))),
      h(Card,null,
        h(CardTitle,null,'Quick Stats'),
        h('div',{style:{padding:15}},
          [{label:'Week Revenue',val:fmtKES(weekSales.reduce((s,x)=>s+x.total,0))},
           {label:'Week Orders',val:weekSales.length},
           {label:'Total Customers',val:db.get('customers',[]).length},
           {label:'Inventory Items',val:inventory.length},
           {label:'Saved Formulas',val:db.get('savedFormulas',[]).length}]
          .map((s,i)=>h('div',{key:i,style:{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:i<4?`1px solid ${C.border}`:'none'}},
            h('span',{style:{fontSize:12,color:C.muted}},s.label),
            h('span',{style:{fontSize:13,fontWeight:700,color:C.earth,fontFamily:"'DM Mono',monospace"}},s.val)))))),
    h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:15}},
      h(Card,null,h(CardTitle,null,'Recent Sales'),
        h(Tbl,{cols:[{key:'date',label:'Date'},{key:'customer',label:'Customer'},{key:'product',label:'Product'},{key:'total',label:'Amount',render:r=>fmtKES(r.total)}],rows:sales.slice(-5).reverse(),emptyMsg:'No sales yet'})),
      h(Card,null,h(CardTitle,null,'Low Stock Alerts'),
        h(Tbl,{cols:[{key:'name',label:'Ingredient'},{key:'qty',label:'In Stock',render:r=>`${fmt(r.qty)} kg`},{key:'reorderLevel',label:'Reorder At',render:r=>`${fmt(r.reorderLevel)} kg`}],rows:lowStock,emptyMsg:'OK All stock levels OK'}))));
}

//  INVENTORY 

function InventoryPage(){
  const {ingredients,inventory,setInventory,purchases,setPurchases,user}=useContext(Ctx);
  const [showAdd,setShowAdd]=useState(false);
  const [ns,setNs]=useState({itemId:'',qty:'',costPerKg:'',date:today(),supplier:''});
  const catColor=cat=>CATEGORY_META.find(c=>c.key===cat)?.color||C.muted;
  const catIcon=cat=>CATEGORY_META.find(c=>c.key===cat)?.icon||'';
  const getSellPrice=(item)=>{
    if(item.sellPriceDirect)return item.sellPriceDirect;
    return Math.round((item.lastPrice||0)*(1+(item.margin||20)/100)*100)/100;
  };
  const [showPriceEdit,setShowPriceEdit]=useState(null);
  const [priceMode,setPriceMode]=useState('margin');
  const [marginVal,setMarginVal]=useState('20');
  const [directPrice,setDirectPrice]=useState('');
  const deleteInventoryItem=(item)=>{
    if(!window.confirm('Remove '+item.name+' from inventory? All stock records will be archived in the traceability log.'))return;
    setInventory(inventory.filter(i=>i.id!==item.id));
    const ledger=db.get('stockLedger',[]);
    const entry={id:uid(),type:'DELETE_INGREDIENT',date:today(),itemId:item.id,itemName:item.name,
      qty:item.qty,deletedRecord:JSON.stringify(item),by:user?.name,at:new Date().toISOString()};
    db.set('stockLedger',[...ledger,entry]);
    serverPush('stockLedger',[...ledger,entry]);
  };
  const openPriceEdit=(item)=>{setShowPriceEdit(item);setPriceMode(item.sellPriceDirect?'direct':'margin');setMarginVal(String(item.margin||20));setDirectPrice(String(item.sellPriceDirect||getSellPrice(item)));};
  const savePriceEdit=()=>{
    if(!showPriceEdit)return;
    const sp=priceMode==='direct'?parseFloat(directPrice):null;
    const mg=priceMode==='margin'?parseFloat(marginVal):showPriceEdit.margin||20;
    setInventory(inventory.map(i=>i.id===showPriceEdit.id?{...i,margin:mg,sellPriceDirect:sp||null,sellPrice:sp||Math.round((i.lastPrice||0)*(1+mg/100)*100)/100}:i));
    setShowPriceEdit(null);
  };
  const addStock=()=>{
    if(!ns.itemId||!ns.qty||!ns.costPerKg)return;
    const qty=parseFloat(ns.qty),cost=parseFloat(ns.costPerKg);
    const item=inventory.find(i=>i.id===ns.itemId);
    const sp=item?.sellPriceDirect||Math.round(cost*(1+(item?.margin||20)/100)*100)/100;
    setInventory(inventory.map(i=>i.id===ns.itemId?{...i,qty:i.qty+qty,lastPrice:cost,sellPrice:sp}:i));
    setPurchases([...purchases,{id:uid(),itemId:ns.itemId,itemName:item?.name,qty,costPerKg:cost,total:qty*cost,date:ns.date,supplier:ns.supplier}]);
    const ledger=db.get('stockLedger',[]);
    const entry={id:uid(),type:'PURCHASE',date:ns.date,itemId:ns.itemId,itemName:item?.name,qty,costPerKg:cost,total:qty*cost,supplier:ns.supplier,by:user?.name};
    db.set('stockLedger',[...ledger,entry]);
    serverPush('stockLedger',[...ledger,entry]);
    setNs({itemId:'',qty:'',costPerKg:'',date:today(),supplier:''});setShowAdd(false);
  };
  return h('div',{style:{padding:'0 26px 26px'}},
    h(PageHdr,{title:'Inventory Management',subtitle:'Track all feed ingredient stock levels and purchases',
      action:h(Btn,{onClick:()=>setShowAdd(true),variant:'success'},('+ Add Stock')}),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}},
      h(StatCard,{label:'Total Items',value:inventory.length,color:C.earth,icon:''}),
      h(StatCard,{label:'Stock Value',value:fmtKES(inventory.reduce((s,i)=>s+i.qty*(i.lastPrice||0),0)),color:C.grass,icon:''}),
      h(StatCard,{label:'Low Stock',value:inventory.filter(i=>i.qty <= i.reorderLevel).length,sub:'items',color:C.danger,icon:'!'}),
      h(StatCard,{label:'Out of Stock',value:inventory.filter(i=>i.qty === 0 || i.qty < 0).length,sub:'items',color:C.danger,icon:'X'})),
    h(Card,null,h(CardTitle,null,'Current Inventory'),
      h(Tbl,{cols:[
        {key:'name',label:'Ingredient',render:r=>h('div',{style:{display:'flex',alignItems:'center',gap:8}},h('span',{style:{background:catColor(r.category)+'22',color:catColor(r.category),borderRadius:4,padding:'2px 6px',fontSize:11,fontWeight:700}},catIcon(r.category)),r.name)},
        {key:'category',label:'Type',render:r=>h(Badge,{color:catColor(r.category)},CATEGORY_META.find(c=>c.key===r.category)?.label||r.category)},
        {key:'qty',label:'In Stock',render:r=>h('span',{style:{fontFamily:"'DM Mono',monospace",fontWeight:700,color:r.qty<=r.reorderLevel?C.danger:C.grass}},`${fmt(r.qty)} kg`)},
        {key:'lastPrice',label:'Buy Price',render:r=>fmtKES(r.lastPrice||0)+'/kg'},
        {key:'sellPrice',label:'Sell Price',render:r=>h('span',{style:{fontWeight:700,color:C.grass}},fmtKES(getSellPrice(r))+'/kg')},
        {key:'margin',label:'Margin',render:r=>h('span',{style:{fontSize:11,color:C.muted}},r.sellPriceDirect?'Fixed':((r.margin||20)+'%'))},
        {key:'value',label:'Stock Value',render:r=>fmtKES(r.qty*(r.lastPrice||0))},
        {key:'reorderLevel',label:'Reorder At',render:r=>`${fmt(r.reorderLevel)} kg`},
        {key:'status',label:'Status',render:r=>h(Badge,{color:!(r.qty>0)?C.danger:r.qty<=r.reorderLevel?C.warning:C.grass},!(r.qty>0)?'Out of Stock':r.qty<=r.reorderLevel?'Low Stock':'OK')},
        {key:'price_action',label:'',render:r=>h('div',{style:{display:'flex',gap:4}},
          h(Btn,{size:'sm',variant:'secondary',onClick:()=>openPriceEdit(r)},('$ Price'),
          user?.role==='admin'&&h(Btn,{size:'sm',variant:'danger',onClick:()=>deleteInventoryItem(r)},('[Delete]'))},
      ],rows:inventory,emptyMsg:'No inventory items.'})),
    showPriceEdit&&h(Modal,{title:'Set Sell Price  -  '+showPriceEdit.name,onClose:()=>setShowPriceEdit(null),width:440},
      h('div',{style:{background:C.parchment,borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13,color:C.soil}},
        'Current Buy Price: ',h('strong',null,fmtKES(showPriceEdit.lastPrice||0)+'/kg')),
      h('div',{style:{display:'flex',gap:0,marginBottom:14,borderRadius:8,overflow:'hidden',border:'1px solid '+C.border}},
        ['margin','direct'].map(m=>h('button',{key:m,onClick:()=>setPriceMode(m),
          style:{flex:1,padding:'9px 0',border:'none',cursor:'pointer',fontWeight:priceMode===m?700:400,
            background:priceMode===m?C.earth:'white',color:priceMode===m?'white':C.muted,fontSize:13}},
          m==='margin'?' Margin %':'$ Fixed Price'))),
      priceMode==='margin'&&h('div',null,
        Inp({label:'Margin %',value:marginVal,onChange:setMarginVal,type:'number',placeholder:'e.g. 20'}),
        h('div',{style:{background:'#f0f9f4',borderRadius:8,padding:'10px 14px',fontSize:13,color:C.grass,fontWeight:700}},
          'Sell Price = ',fmtKES(Math.round((showPriceEdit.lastPrice||0)*(1+(parseFloat(marginVal)||0)/100)*100)/100)+'/kg')),
      priceMode==='direct'&&h('div',null,
        Inp({label:'Direct Sell Price (KES/kg)',value:directPrice,onChange:setDirectPrice,type:'number'}),
        directPrice&&(showPriceEdit.lastPrice>0)&&h('div',{style:{background:'#f0f9f4',borderRadius:8,padding:'10px 14px',fontSize:13,color:C.grass,fontWeight:700}},
          'Implied Margin = ',Math.round(((parseFloat(directPrice||0)-(showPriceEdit.lastPrice||0))/(showPriceEdit.lastPrice||1))*100),'%')),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}},
        h(Btn,{onClick:()=>setShowPriceEdit(null),variant:'secondary'},('Cancel'),
        h(Btn,{onClick:savePriceEdit,variant:'success'},('Save Sell Price'))),
    h(Card,{style:{marginTop:15}},h(CardTitle,null,'Purchase History'),
      h(Tbl,{cols:[{key:'date',label:'Date'},{key:'itemName',label:'Ingredient'},{key:'qty',label:'Qty',render:r=>`${fmt(r.qty)} kg`},{key:'costPerKg',label:'Price/kg',render:r=>fmtKES(r.costPerKg)},{key:'total',label:'Total',render:r=>fmtKES(r.total)},{key:'supplier',label:'Supplier'}],rows:purchases.slice().reverse(),emptyMsg:'No purchases yet'})),
    showAdd&&h(Modal,{title:'Add Stock / Record Purchase',onClose:()=>setShowAdd(false)},
      h(Sel,{label:'Ingredient',value:ns.itemId,onChange:v=>setNs({...ns,itemId:v}),options:[{value:'',label:'Select ingredient...'}, ...inventory.map(i=>({value:i.id,label:i.name}))]}),
      h(Inp,{label:'Quantity (kg)',value:ns.qty,onChange:v=>setNs({...ns,qty:v}),type:'number',placeholder:'e.g. 500'}),
      h(Inp,{label:'Cost per kg (KES)',value:ns.costPerKg,onChange:v=>setNs({...ns,costPerKg:v}),type:'number',placeholder:'e.g. 45'}),
      h(Inp,{label:'Supplier',value:ns.supplier,onChange:v=>setNs({...ns,supplier:v}),placeholder:'e.g. Kitale Millers'}),
      h(Inp,{label:'Purchase Date',value:ns.date,onChange:v=>setNs({...ns,date:v}),type:'date'}),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end'}},
        h(Btn,{onClick:()=>setShowAdd(false),variant:'secondary'},('Cancel'),
        h(Btn,{onClick:addStock,variant:'success'},('Record Purchase'))));
}

//  INGREDIENTS 

function IngredientsPage(){
  const {ingredients,setIngredients,inventory,setInventory}=useContext(Ctx);
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const [filterCat,setFilterCat]=useState('all');
  const [search,setSearch]=useState('');
  const [toast,setToast]=useState(null);
  const blank={name:'',category:'energy',cp:'',me:'',fat:'',fibre:'',ca:'',p:'',antiNote:''};
  const [form,setForm]=useState(blank);
  const showT=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3000);};
  const filtered=ingredients.filter(i=>(filterCat==='all'||i.category===filterCat)&&(search===''||i.name.toLowerCase().includes(search.toLowerCase())));
  const catMeta=key=>CATEGORY_META.find(c=>c.key===key)||{label:key,icon:'',color:C.muted};
  const openEdit=ing=>{setEditing(ing);setForm({...ing,price:String(ing.price),cp:String(ing.cp||''),me:String(ing.me||''),fat:String(ing.fat||''),fibre:String(ing.fibre||''),ca:String(ing.ca||''),p:String(ing.p||''),antiNote:ing.antiNote||''});setShowForm(true);};
  const openAdd=()=>{setEditing(null);setForm(blank);setShowForm(true);};
  const saveIng=()=>{
    if(!form.name||!form.category)return;
    const entry={id:editing?editing.id:form.name.toLowerCase().replace(/[^a-z0-9]/g,'_')+'_'+Date.now().toString(36),name:form.name.trim(),category:form.category,price:parseFloat(form.price)||0,unit:'kg',cp:parseFloat(form.cp)||0,me:parseFloat(form.me)||0,fat:parseFloat(form.fat)||0,fibre:parseFloat(form.fibre)||0,ca:parseFloat(form.ca)||0,p:parseFloat(form.p)||0,antiNote:form.antiNote||''};
    let upd;
    if(editing){
      upd=ingredients.map(i=>i.id===editing.id?entry:i);
      if(editing.name!==entry.name)setInventory(inventory.map(i=>i.id===entry.id?{...i,name:entry.name,lastPrice:entry.price}:i));
    } else {
      upd=[...ingredients,entry];
      if(!inventory.find(i=>i.id===entry.id))setInventory([...inventory,{id:entry.id,name:entry.name,category:entry.category,qty:0,lastPrice:entry.price,reorderLevel:50,unit:'kg'}]);
    }
    setIngredients(upd);setShowForm(false);setEditing(null);setForm(blank);
    showT(editing?'Ingredient updated!':'Ingredient added and created in inventory!');
  };
  const delIng=ing=>{
    if(!window.confirm(`Delete "${ing.name}"? It will also be removed from inventory.`))return;
    setIngredients(ingredients.filter(i=>i.id!==ing.id));
    setInventory(inventory.filter(i=>i.id!==ing.id));
    showT(`"${ing.name}" deleted.`,'warn');
  };
  const NF=({lbl,field,ph})=>h('div',null,
    h('div',{style:{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:C.muted,marginBottom:3}},lbl),
    h('input',{type:'number',value:form[field],onChange:e=>setForm({...form,[field]:e.target.value}),placeholder:ph,
      style:{width:'100%',padding:'7px 10px',border:`1px solid ${C.border}`,borderRadius:6,fontSize:12,fontFamily:"'DM Mono',monospace",background:C.cream,color:C.ink}}));
  return h('div',{style:{padding:'0 26px 26px'}},
    toast&&h(Toast,{msg:toast.msg,type:toast.type}),
    h(PageHdr,{title:'Ingredient Management',subtitle:'Add, edit or remove feed ingredients',action:h(Btn,{onClick:openAdd,variant:'success'},('+ Add Ingredient')}),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:18}},
      CATEGORY_META.map(cat=>h(StatCard,{key:cat.key,label:cat.label,value:ingredients.filter(i=>i.category===cat.key).length,sub:'ingredients',color:cat.color,icon:cat.icon}))),
    h('div',{style:{display:'flex',gap:8,marginBottom:13,flexWrap:'wrap',alignItems:'center'}},
      h('input',{value:search,onChange:e=>setSearch(e.target.value),placeholder:' Search ingredients',style:{padding:'7px 12px',border:`1px solid ${C.border}`,borderRadius:20,fontSize:13,background:'white',width:210}}),
      [{key:'all',label:'All',icon:''},...CATEGORY_META].map(c=>h(Btn,{key:c.key,size:'sm',variant:filterCat===c.key?'primary':'secondary',onClick:()=>setFilterCat(c.key)},`${c.icon||''} ${c.label}`.trim()))),
    h(Card,null,h(CardTitle,null,`${filtered.length} ingredients`),
      h(Tbl,{cols:[
        {key:'name',label:'Name',render:r=>h('span',{style:{fontWeight:600,color:C.earth}},r.name)},
        {key:'category',label:'Category',render:r=>{const m=catMeta(r.category);return h(Badge,{color:m.color},m.icon+' '+m.label);}},
        {key:'price',label:'Sell Price/kg',render:r=>{const inv=inventory?.find(x=>x.id===r.id);const sp=inv?.sellPriceDirect||(inv?.lastPrice?(inv.lastPrice*(1+(inv.margin||20)/100)):0);return h('span',{style:{fontFamily:"'DM Mono',monospace",color:C.grass}},sp?'KES '+sp.toFixed(0):' - ')}},
        {key:'cp',label:'CP%',render:r=>h('span',{style:{fontFamily:"'DM Mono',monospace",color:(r.cp||0) > 29?C.grass:C.soil}},r.cp||' - ')},
        {key:'me',label:'ME',render:r=>h('span',{style:{fontFamily:"'DM Mono',monospace"}},r.me||' - ')},
        {key:'ca',label:'Ca%',render:r=>h('span',{style:{fontFamily:"'DM Mono',monospace"}},r.ca||' - ')},
        {key:'p',label:'P%',render:r=>h('span',{style:{fontFamily:"'DM Mono',monospace"}},r.p||' - ')},
        {key:'antiNote',label:'Anti-Nutritive Note',render:r=>r.antiNote?h('span',{style:{fontSize:11,color:C.warning}},' '+r.antiNote.slice(0,45)+(r.antiNote.length>45?'':'')):h('span',{style:{color:C.muted}},(' - ')},
        {key:'actions',label:'',render:r=>h('div',{style:{display:'flex',gap:5}},h(Btn,{size:'sm',variant:'secondary',onClick:()=>openEdit(r)},(' Edit'),h(Btn,{size:'sm',variant:'danger',onClick:()=>delIng(r)},('[Delete] Del'))},
      ],rows:filtered,emptyMsg:'No ingredients found.'})),
    showForm&&h(Modal,{title:editing?`Edit  -  ${editing.name}`:'Add New Ingredient',onClose:()=>{setShowForm(false);setEditing(null);},width:620},
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}},
        h('div',{style:{gridColumn:'1/-1'}},h(Inp,{label:'Ingredient Name *',value:form.name,onChange:v=>setForm({...form,name:v}),placeholder:'e.g. Wheat Pollard',required:true})),
        h('div',null,
          h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:C.muted,marginBottom:4}},('Category *'),
          h('select',{value:form.category,onChange:e=>setForm({...form,category:e.target.value}),style:{width:'100%',padding:'8px 11px',border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,background:C.cream,marginBottom:0}},
            CATEGORY_META.map(c=>h('option',{key:c.key,value:c.key},c.icon+' '+c.label)))),
        h('div',{style:{background:'#f0f9f4',border:'1px solid '+C.leaf,borderRadius:8,padding:'8px 12px',fontSize:12,color:C.soil}},
              ' Prices are managed in Inventory  $ Price button')),
      h('div',{style:{borderTop:`1px solid ${C.border}`,paddingTop:13,marginBottom:13}},
        h('div',{style:{fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:2,textTransform:'uppercase',color:C.muted,marginBottom:11}},('Nutritional Composition (per 100g as-fed)'),
        h('div',{style:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}},
          h(NF,{lbl:'Crude Protein (%)',field:'cp',ph:'e.g. 15.5'}),
          h(NF,{lbl:'ME (kcal/kg)',field:'me',ph:'e.g. 1850'}),
          h(NF,{lbl:'Crude Fat (%)',field:'fat',ph:'e.g. 4.2'}),
          h(NF,{lbl:'Crude Fibre (%)',field:'fibre',ph:'e.g. 9.5'}),
          h(NF,{lbl:'Calcium Ca (%)',field:'ca',ph:'e.g. 0.10'}),
          h(NF,{lbl:'Phosphorus P (%)',field:'p',ph:'e.g. 0.90'}))),
      h('div',{style:{marginBottom:14}},
        h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:C.muted,marginBottom:4}},('Anti-Nutritive Factor Note (optional)'),
        h('textarea',{value:form.antiNote,onChange:e=>setForm({...form,antiNote:e.target.value}),placeholder:'e.g. Phytate phosphorus  -  limit to 15% in poultry without phytase enzyme',rows:2,style:{width:'100%',padding:'8px 11px',border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.ink,background:C.cream,resize:'vertical'}})),
      !editing&&h('div',{style:{background:'#f0f9f4',border:`1px solid ${C.leaf}`,borderRadius:8,padding:'9px 13px',fontSize:12,color:C.soil,marginBottom:13}},('OK This ingredient will automatically be added to Inventory with 0 stock. Go to Inventory  Add Stock to record a purchase.'),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end'}},
        h(Btn,{onClick:()=>{setShowForm(false);setEditing(null);},variant:'secondary'},('Cancel'),
        h(Btn,{onClick:saveIng,variant:'success'},(editing?'Update Ingredient':'Add Ingredient')))));
}

//  CUSTOMERS 

function CustomersPage(){
  const {customers,setCustomers}=useContext(Ctx);
  const savedFormulas=db.get('savedFormulas',[]);
  const [showAdd,setShowAdd]=useState(false);
  const [sel,setSel]=useState(null);
  const [form,setForm]=useState({name:'',phone:'',location:'',species:'',notes:''});
  const save=()=>{
    if(!form.name)return;
    if(sel)setCustomers(customers.map(c=>c.id===sel.id?{...c,...form}:c));
    else setCustomers([...customers,{...form,id:uid(),created:today()}]);
    setShowAdd(false);setSel(null);setForm({name:'',phone:'',location:'',species:'',notes:''});
  };
  return h('div',{style:{padding:'0 26px 26px'}},
    h(PageHdr,{title:'Customer Profiles',subtitle:'Manage regular customers and saved formulations',action:h(Btn,{onClick:()=>{setSel(null);setForm({name:'',phone:'',location:'',species:'',notes:''});setShowAdd(true);}},('+ New Customer')}),
    h(Card,null,h(CardTitle,null,`${customers.length} Registered Customers`),
      h(Tbl,{cols:[
        {key:'name',label:'Name',render:r=>h('span',{style:{fontWeight:600}},r.name)},
        {key:'phone',label:'Phone'},{key:'location',label:'Location'},
        {key:'species',label:'Animals',render:r=>r.species?h(Badge,null,r.species):h('span',{style:{color:C.muted}},(' - ')},
        {key:'formulas',label:'Saved Formulas',render:r=>h('span',{style:{fontFamily:"'DM Mono',monospace"}},savedFormulas.filter(f=>f.customerId===r.id).length)},
        {key:'actions',label:'',render:r=>h('div',{style:{display:'flex',gap:6}},h(Btn,{size:'sm',variant:'secondary',onClick:()=>{setSel(r);setForm({name:r.name,phone:r.phone,location:r.location,species:r.species,notes:r.notes});setShowAdd(true);}},('Edit'),h(Btn,{size:'sm',variant:'danger',onClick:()=>{if(window.confirm('Delete customer?'))setCustomers(customers.filter(c=>c.id!==r.id));}},('Del'))},
      ],rows:customers,emptyMsg:'No customers yet.'})),
    savedFormulas.length>0&&h(Card,{style:{marginTop:15}},h(CardTitle,null,'Saved Customer Formulations'),
      h(Tbl,{cols:[{key:'name',label:'Formula Name',render:r=>h('span',{style:{fontWeight:600}},r.name)},{key:'customerName',label:'Customer'},{key:'species',label:'Species'},{key:'stage',label:'Stage'},{key:'costPerKg',label:'Cost/kg',render:r=>fmtKES(r.costPerKg)},{key:'savedOn',label:'Saved'}],rows:savedFormulas})),
    showAdd&&h(Modal,{title:sel?'Edit Customer':'New Customer',onClose:()=>{setShowAdd(false);setSel(null);}},
      h(Inp,{label:'Customer Name *',value:form.name,onChange:v=>setForm({...form,name:v}),placeholder:'e.g. John Kamau',required:true}),
      h(Inp,{label:'Phone',value:form.phone,onChange:v=>setForm({...form,phone:v}),placeholder:'e.g. 0712 345 678'}),
      h(Inp,{label:'Location / Farm',value:form.location,onChange:v=>setForm({...form,location:v}),placeholder:'e.g. Nakuru'}),
      h(Sel,{label:'Main Livestock',value:form.species,onChange:v=>setForm({...form,species:v}),options:[{value:'',label:'Select species...'},...SPECIES_LIST.map(s=>({value:s.label,label:s.icon+' '+s.label}))]}),
      h('div',{style:{marginBottom:12}},
        h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:C.muted,marginBottom:4}},('Notes'),
        h('textarea',{value:form.notes,onChange:e=>setForm({...form,notes:e.target.value}),rows:3,style:{width:'100%',padding:'8px 11px',border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.ink,background:C.cream,resize:'vertical'}})),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end'}},
        h(Btn,{onClick:()=>{setShowAdd(false);setSel(null);},variant:'secondary'},('Cancel'),
        h(Btn,{onClick:save},(sel?'Update':'Save Customer')))));
}


//  FORMULATOR 

function FormulatorPage(){
  const {ingredients,setIngredients,inventory,setInventory,sales,setSales,customers,user}=useContext(Ctx);

  //  Animal requirements 
  const animalReqs=getAnimalReqs(db.get('animalReqs'));
  const speciesList=buildSpeciesList(animalReqs);
  const [species,setSpecies]=useState('');
  const [stage,setStage]=useState('');
  const stages=species?getStagesForCategory(animalReqs,species):[];
  const reqs=species&&stage?getReqForStage(animalReqs,species,stage):null;

  //  Batch & sale state 
  const [batchKg,setBatchKg]=useState(100);
  const [selPrice,setSelPrice]=useState('');
  const [custId,setCustId]=useState('');
  const [showSave,setShowSave]=useState(false);
  const [fName,setFName]=useState('');
  const [showSell,setShowSell]=useState(false);
  const [pendingSale,setPendingSale]=useState(null);
  const [toast,setToast]=useState(null);
  const showT=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};
  const agreeLabel='OK Customer Agreed - Record Sale';

  //  Ingredient selection  -  auto-select all available inventory items 
  const availableIngredients=ingredients.filter(i=>{
    const inv=inventory.find(x=>x.id===i.id);
    return inv&&inv.qty>0;
  });
  const [selIngrs,setSelIngrs]=useState(()=>new Set(availableIngredients.map(i=>i.id)));

  // Auto-update selection when inventory changes
  useEffect(()=>{
    const available=ingredients.filter(i=>{
      const inv=inventory.find(x=>x.id===i.id);
      return inv&&inv.qty>0;
    });
    setSelIngrs(new Set(available.map(i=>i.id)));
  },[inventory.length]);

  //  Sell prices from inventory (not buy prices) 
  // getSellPriceForIng: reads inventory sell price, falls back to lastPrice * 1.2
  const getSellPriceForIng=(ing)=>{
    const inv=inventory.find(x=>x.id===ing.id);
    if(inv){
      if(inv.sellPriceDirect) return inv.sellPriceDirect;
      const margin=inv.margin||20;
      return Math.round((inv.lastPrice||0)*(1+margin/100)*100)/100;
    }
    return ing.sellPrice||ing.lastPrice||ing.price||0;
  };

  //  Ingredient helper 
  const toggleI=id=>{const n=new Set(selIngrs);n.has(id)?n.delete(id):n.add(id);setSelIngrs(n);};
  const getActive=()=>ingredients
    .filter(i=>selIngrs.has(i.id))
    .map(i=>({...i,price:getSellPriceForIng(i)})); // USE SELL PRICE
  const getActiveWithANF=()=>ingredients
    .filter(i=>selIngrs.has(i.id))
    .map(i=>{
      const base={...i,price:getSellPriceForIng(i)}; // USE SELL PRICE
      if(species){
        const effMax=getEffectiveMaxIncl(base,species);
        if(effMax===0)return null;
        return{...base,maxIncl:Math.min(base.maxIncl??100,effMax)};
      }
      return base;
    }).filter(Boolean);

  //  ANF state 
  const [anfWarnings,setAnfWarnings]=useState([]);
  const [anfExclusions,setAnfExclusions]=useState([]);

  //  Formula state 
  const [formula,setFormula]=useState(null);
  const [nutrients,setNutrients]=useState(null);
  const [costPKg,setCostPKg]=useState(0);
  const [solveQuality,setSolveQuality]=useState('');
  const [loading,setLoading]=useState(false);

  //  Auto-solve when species+stage changes 
  useEffect(()=>{
    if(!species||!stage)return;
    setFormula(null);setNutrients(null);setCostPKg(0);setAnfWarnings([]);setAnfExclusions([]);
    setLoading(true);
    const timer=setTimeout(()=>{
      const ingrs=getActiveWithANF();
      const req=getReqForStage(animalReqs,species,stage);
      if(!req){setLoading(false);showT('No nutritional requirements found for this stage.','error');return;}
      if(ingrs.length===0){setLoading(false);showT('No ingredients in stock. Add stock in Inventory first.','error');return;}
      const result=solveBestEffort(ingrs,req);
      if(result&&result.formula){
        const n=calcNutrients(result.formula,ingrs);
        const c=calcCost(result.formula,ingrs);
        setFormula(result.formula);setNutrients(n);setCostPKg(c);
        setSolveQuality(result.quality||'optimal');
        const {warnings,exclusions}=checkANFWarnings(result.formula,ingrs,species);
        const solverWarnings=(result.warnings||[]).map(w=>({ingredient:w.nutrient,factor:'Nutrient Gap',note:w.note,severity:w.severity}));
        setAnfWarnings([...warnings,...solverWarnings]);
        setAnfExclusions(exclusions);
      } else {
        showT('Could not find a solution. Try enabling more ingredients or check inventory stock.','error');
      }
      setLoading(false);
    },500);
    return()=>clearTimeout(timer);
  },[species,stage,selIngrs.size]);

  const doFormulate=()=>{
    if(!species||!stage){showT('Select species and stage first.','error');return;}
    setLoading(true);
    const ingrs=getActiveWithANF();
    const req=getReqForStage(animalReqs,species,stage);
    if(!req){setLoading(false);showT('No nutritional requirements for this stage.','error');return;}
    if(ingrs.length===0){setLoading(false);showT('No ingredients in stock.','error');return;}
    setTimeout(()=>{
      const result=solveBestEffort(ingrs,req);
      if(result&&result.formula){
        const n=calcNutrients(result.formula,ingrs);
        const c=calcCost(result.formula,ingrs);
        setFormula(result.formula);setNutrients(n);setCostPKg(c);
        setSolveQuality(result.quality||'optimal');
        const {warnings,exclusions}=checkANFWarnings(result.formula,ingrs,species);
        const solverWarnings=(result.warnings||[]).map(w=>({ingredient:w.nutrient,factor:'Nutrient Gap',note:w.note,severity:w.severity}));
        setAnfWarnings([...warnings,...solverWarnings]);
        setAnfExclusions(exclusions);
      } else {
        showT('Could not solve. Select more ingredients or check that they have stock.','error');
      }
      setLoading(false);
    },300);
  };

  const doSaveFormula=()=>{
    if(!formula||!fName)return;
    const saved=db.get('savedFormulas',[]);
    db.set('savedFormulas',[...saved,{id:uid(),name:fName,species,stage,formula,nutrients,
      costPerKg:costPKg,customerId:custId||null,
      customerName:customers.find(c=>c.id===custId)?.name||' - ',savedOn:today(),batchKg}]);
    serverPush('savedFormulas',db.get('savedFormulas',[]));
    setShowSave(false);setFName('');showT('Formula saved!');
  };

  const doInitSale=()=>{
    const ingrs=getActiveWithANF();
    const items=Object.entries(formula).map(([id,pct])=>{
      const i=ingrs.find(x=>x.id===id);
      const sp=getSellPriceForIng(i||{id});
      return{id,name:i?.name,pct,qty:(pct/100)*batchKg,pricePerKg:sp};
    });
    setPendingSale({items,totalCost:items.reduce((s,i)=>s+i.qty*i.pricePerKg,0)});
    setShowSell(true);
  };

  const doConfirmSale=()=>{
    if(!pendingSale||!selPrice)return;
    const insuff=pendingSale.items.filter(item=>{
      const st=inventory.find(s=>s.id===item.id);
      return !st||!(st.qty>=item.qty);
    });
    if(insuff.length>0){showT('Insufficient stock: '+insuff.map(i=>i.name).join(', '),'error');return;}
    setInventory(inventory.map(inv=>{
      const used=pendingSale.items.find(i=>i.id===inv.id);
      return used?{...inv,qty:Math.max(0,inv.qty-used.qty)}:inv;
    }));
    const agreedTotal=parseFloat(selPrice)*batchKg;
    const disc=0;
    const cust=customers.find(c=>c.id===custId);
    const newSale={id:uid(),date:today(),species,stage,batchKg,
      customerId:custId||null,customerName:cust?.name||'Walk-in',customer:cust?.name||'Walk-in',
      product:`${species}  -  ${stage} (${batchKg}kg)`,
      cost:pendingSale.totalCost,total:agreedTotal,
      totalRevenue:agreedTotal,totalCost:pendingSale.totalCost,
      profit:agreedTotal-pendingSale.totalCost,discount:disc,
      sellPricePerKg:parseFloat(selPrice),items:pendingSale.items};
    setSales([...sales,newSale]);
    // Log to ledger
    const ledger=db.get('stockLedger',[]);
    const entry={id:uid(),type:'SALE',date:today(),product:newSale.product,
      qty:batchKg,total:agreedTotal,costPerKg:costPKg,by:user?.name};
    db.set('stockLedger',[...ledger,entry]);
    serverPush('stockLedger',[...ledger,entry]);
    setShowSell(false);setPendingSale(null);setSelPrice('');
    showT('Sale recorded! Stock updated.');
  };

  //  ANF status for ingredient cards 
  const getANFStatus=id=>{
    if(!species)return'neutral';
    const lim=getANFLimit(id,species);
    if(!lim)return'neutral';
    if(lim.maxPct===0)return'excluded';
    if(lim.maxPct < 6)return'caution';
    return'neutral';
  };
  const anfStatusStyle=s=>({
    excluded:{border:`2px solid ${C.danger}`,background:'#fff0f0',opacity:0.7},
    caution: {border:`2px solid ${C.harvest}`,background:'#fffbf0'},
    neutral: {border:`1px solid ${C.border}`,background:'white'},
  }[s]||{border:`1px solid ${C.border}`,background:'white'});

  //  Ingredient in-stock check 
  const getInvItem=id=>inventory.find(x=>x.id===id);
  const inStock=id=>{const inv=getInvItem(id);return inv&&inv.qty>0;};

  //  Formula table display 
  const formulaRows=formula?Object.entries(formula)
    .sort((a,b)=>b[1]-a[1])
    .map(([id,pct],i,arr)=>{
      const ing=ingredients.find(x=>x.id===id);
      const sp=getSellPriceForIng(ing||{id});
      const dpct=i===arr.length-1
        ? Math.round((100-arr.slice(0,-1).reduce((s,[,p])=>s+Math.round(p*10)/10,0))*10)/10
        : Math.round(pct*10)/10;
      const qty=(dpct/100)*batchKg;
      return{id,name:ing?.name||id,pct,dpct,qty,sellPricePerKg:sp,sellCost:qty*sp};
    }):[];

  //  Nutrient display helper 
  const NutRow=({label,val,req,unit})=>{
    if(!val&&val!==0)return null;
    const v=Number(val).toFixed(unit==='kcal/kg'?0:2);
    const inRange=!req||val>=req[0]*0.97;
    const over=req&&val>req[1]*1.05;
    return h('div',{style:{display:'flex',justifyContent:'space-between',padding:'5px 0',
      borderBottom:`1px solid ${C.border}`,fontSize:12}},
      h('span',{style:{color:C.muted}},label),
      h('div',{style:{display:'flex',gap:8,alignItems:'center'}},
        req&&h('span',{style:{fontSize:10,color:C.muted}},req[0]+'-'+req[1]+unit),
        h('span',{style:{fontFamily:"'DM Mono',monospace",fontWeight:700,
          color:over?C.warning:inRange?C.grass:C.danger}},v+' '+unit)));
  };

  //  RENDER 
  return h('div',{style:{padding:'0 26px 26px'}},
    toast&&h(Toast,{msg:toast.msg,type:toast.type}),
    h(PageHdr,{title:'Feed Formulator',
      subtitle:'Least-cost optimal feed formulation with auto-selection and ANF awareness'}),

    h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}},
      // Left column: setup
      h('div',null,
        // Section 1: Animal
        h(Card,{style:{marginBottom:12}},
          h(CardTitle,null,'1  -  Animal'),
          h('div',{style:{padding:'0 14px 14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}},
            h(Sel,{label:'Species',value:species,onChange:v=>{setSpecies(v);setStage('');setFormula(null);},
              options:[{value:'',label:'Select species'},...speciesList.map(s=>({value:s.value,label:s.icon+' '+s.label}))]}),
            h(Sel,{label:'Stage',value:stage,onChange:v=>{setStage(v);setFormula(null);},
              options:[{value:'',label:'Select stage'},...stages.map(s=>({value:s,label:s}))],
              disabled:!species}),
            h('div',null,Inp({label:'Batch Size (kg)',value:batchKg,onChange:v=>setBatchKg(parseFloat(v)||100),type:'number'})),
            h('div',null,h(Sel,{label:'Customer (optional)',value:custId,onChange:setCustId,
              options:[{value:'',label:'Walk-in customer'},...customers.map(c=>({value:c.id,label:c.name}))]})))),

        // Section 2: Ingredients
        h(Card,{style:{marginBottom:12}},
          h(CardTitle,null,`2  -  Ingredients (${selIngrs.size} selected, ${availableIngredients.length} in stock)`),
          h('div',{style:{padding:'0 12px 12px'}},
            h('div',{style:{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}},
              h(Btn,{size:'sm',variant:'secondary',
                onClick:()=>setSelIngrs(new Set(availableIngredients.map(i=>i.id)))},('Select All In-Stock'),
              h(Btn,{size:'sm',variant:'secondary',onClick:()=>setSelIngrs(new Set())},('Clear All')),
            h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:6}},
              ingredients.map(ing=>{
                const inv=getInvItem(ing.id);
                const hasStock=inv&&inv.qty>0;
                const sel=selIngrs.has(ing.id);
                const anfStat=getANFStatus(ing.id);
                return h('div',{key:ing.id,onClick:()=>toggleI(ing.id),
                  style:{padding:'7px 9px',borderRadius:8,cursor:'pointer',userSelect:'none',
                    transition:'all 0.15s',position:'relative',
                    ...(sel?{border:`2px solid ${C.grass}`,background:'#f0f9f4'}:{...anfStatusStyle(anfStat),opacity:hasStock?1:0.45})}},
                  sel&&h('div',{style:{position:'absolute',top:3,right:5,fontSize:10,color:C.grass,fontWeight:700}},''),
                  anfStat==='excluded'&&h('div',{style:{position:'absolute',top:3,right:5,fontSize:10,color:C.danger}},('X'),
                  anfStat==='caution'&&h('div',{style:{position:'absolute',top:3,right:5,fontSize:10}},('!'),
                  h('div',{style:{fontSize:11,fontWeight:600,color:C.earth,lineHeight:1.3}},ing.name),
                  h('div',{style:{fontSize:10,color:C.muted,marginTop:2}},
                    hasStock?`${fmt(inv.qty)} kg  KES ${getSellPriceForIng(ing)}/kg`:'No stock'));
              })))),

        // Section 3: Sell Prices (read-only from inventory)
        formula&&h(Card,null,
          h(CardTitle,null,'3  -  Sell Prices (from Inventory)'),
          h('div',{style:{padding:'0 12px 12px'}},
            h('div',{style:{background:'#f0f9f4',border:'1px solid '+C.leaf,borderRadius:8,
              padding:'8px 12px',fontSize:12,color:C.soil,marginBottom:10}},
              ' Sell prices are set in Inventory  $ Price button. To change a price, update it there.'),
            formulaRows.map(row=>h('div',{key:row.id,
              style:{display:'flex',justifyContent:'space-between',alignItems:'center',
                padding:'6px 0',borderBottom:`1px solid ${C.border}`}},
              h('span',{style:{fontSize:12,color:C.earth,fontWeight:600}},row.name),
              h('span',{style:{fontSize:12,fontFamily:"'DM Mono',monospace",color:C.grass,fontWeight:700}},
                'KES '+row.sellPricePerKg+'/kg')))))),

      // Right column: results
      h('div',null,
        // Auto-solve status + formulate button
        h(Card,{style:{marginBottom:12}},
          h('div',{style:{padding:'12px 14px'}},
            h('div',{style:{display:'flex',gap:8,alignItems:'center',marginBottom:8}},
              h(Btn,{onClick:doFormulate,variant:'success',disabled:loading||!species||!stage},                loading?' Solving':' Formulate'),
              formula&&solveQuality&&h('span',{style:{fontSize:11,padding:'3px 10px',borderRadius:12,
                background:solveQuality==='optimal'?'#f0f9f4':solveQuality==='good'?'#f0f9f4':'#fff8e6',
                color:solveQuality==='optimal'?C.grass:solveQuality==='good'?C.grass:C.savanna,
                border:'1px solid '+(solveQuality==='optimal'?C.leaf:C.harvest)}},
                solveQuality==='optimal'?' Optimal solution':
                solveQuality==='good'?' Good solution':
                solveQuality==='relaxed'?' Approximated':
                ' Fallback mix')),
            !species&&h('div',{style:{fontSize:12,color:C.muted}},('Select species and stage above  -  formula auto-generates.'),
            species&&stage&&!formula&&!loading&&h('div',{style:{fontSize:12,color:C.muted}},('Auto-solving'),
            loading&&h('div',{style:{display:'flex',gap:8,alignItems:'center',fontSize:13,color:C.muted}},
              h('div',{className:'spin',style:{width:16,height:16,border:'2px solid '+C.border,
                borderTopColor:C.grass,borderRadius:'50%'}}),
              'Finding optimal least-cost formula'))),

        // ANF warnings
        (anfWarnings.length>0||anfExclusions.length>0)&&h(Card,{style:{marginBottom:12}},
          h('div',{style:{padding:'10px 14px'}},
            anfExclusions.map((e,i)=>h('div',{key:'ex'+i,style:{display:'flex',gap:8,padding:'7px 10px',
              borderRadius:7,background:'#fde8e8',border:'1px solid '+C.danger+'44',marginBottom:5}},
              h('span',null,'X'),
              h('div',null,
                h('div',{style:{fontWeight:700,fontSize:12,color:C.danger}},e.ingredient+' EXCLUDED  -  '+e.factor),
                h('div',{style:{fontSize:11,color:C.muted}},e.note)))),
            anfWarnings.map((w,i)=>h('div',{key:'w'+i,style:{display:'flex',gap:8,padding:'7px 10px',
              borderRadius:7,marginBottom:4,
              background:w.severity==='danger'?'#fde8e8':'#fff8e6',
              border:'1px solid '+(w.severity==='danger'?C.danger:C.harvest)+'44'}},
              h('span',null,w.severity==='danger'?'X':'!'),
              h('div',null,
                h('div',{style:{fontWeight:700,fontSize:12,color:w.severity==='danger'?C.danger:C.savanna}},
                  w.ingredient+(w.factor?'  -  '+w.factor:'')+
                  (w.current?' at '+w.current+'%'+' (limit: '+w.maxPct+'%)':'')),
                h('div',{style:{fontSize:11,color:C.muted}},w.note)))))),

        // Formula table
        formula&&nutrients&&h(Card,{style:{marginBottom:12}},
          h('div',{style:{background:`linear-gradient(135deg,${C.earth},${C.soil})`,
            padding:'13px 17px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
            h('div',null,
              h('div',{style:{fontFamily:"'Playfair Display',serif",fontSize:15,color:'white',fontWeight:700}},species+'  -  '+stage),
              h('div',{style:{fontSize:11,color:'rgba(255,255,255,0.6)',marginTop:2}},batchKg+'kg batch')),
            h('div',{style:{textAlign:'right'}},
              h('div',{style:{fontSize:22,fontFamily:"'Playfair Display',serif",fontWeight:900,color:C.harvest}},
                'KES '+costPKg.toFixed(2)+'/kg'),
              h('div',{style:{fontSize:11,color:'rgba(255,255,255,0.6)'}},'Total: KES '+(costPKg*batchKg).toFixed(0)))),
          h('div',{style:{overflowX:'auto'}},
            h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:12}},
              h('thead',null,h('tr',null,
                ['Ingredient','%','Qty (kg)','Sell KES/kg','Sell Cost','In Stock'].map((col,i)=>
                  h('th',{key:i,style:{padding:'7px 10px',background:C.parchment,color:C.earth,
                    textAlign:i>0?'right':'left',fontSize:10,textTransform:'uppercase',letterSpacing:1}},col)))),
              h('tbody',null,formulaRows.map((row,i)=>{
                const inv=getInvItem(row.id);
                const ok=inv&&inv.qty>=row.qty;
                return h('tr',{key:row.id,style:{borderBottom:'1px solid '+C.border,background:i%2===0?C.cream:'white'}},
                  h('td',{style:{padding:'7px 10px',fontWeight:600,color:C.earth}},row.name),
                  h('td',{style:{padding:'7px 10px',textAlign:'right',fontFamily:"'DM Mono',monospace"}},row.dpct+'%'),
                  h('td',{style:{padding:'7px 10px',textAlign:'right',fontFamily:"'DM Mono',monospace"}},row.qty.toFixed(1)),
                  h('td',{style:{padding:'7px 10px',textAlign:'right',fontFamily:"'DM Mono',monospace",color:C.grass,fontWeight:700}},'KES '+row.sellPricePerKg),
                  h('td',{style:{padding:'7px 10px',textAlign:'right',fontFamily:"'DM Mono',monospace"}},'KES '+(row.sellCost).toFixed(0)),
                  h('td',{style:{padding:'7px 10px',textAlign:'right'}},
                    h(Badge,{color:ok?C.grass:C.danger},(ok?' OK':'Low'))));
              })))),
          h('div',{style:{padding:'10px 14px',borderTop:'1px solid '+C.border,
            display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}},
            h(Btn,{onClick:()=>setShowSave(true),variant:'secondary',size:'sm'},(' Save Formula'),
            formula&&h(Btn,{onClick:doInitSale,variant:'success',size:'sm'},(' Sell This Batch'))),

        // Nutrients
        formula&&nutrients&&reqs&&h(Card,null,
          h(CardTitle,null,'Nutritional Analysis'),
          h('div',{style:{padding:'0 14px 14px'}},
            h(NutRow,{label:'Crude Protein',val:nutrients.cp,req:reqs.cp,unit:'%'}),
            h(NutRow,{label:'Metabolisable Energy',val:nutrients.me,req:reqs.me,unit:'kcal/kg'}),
            h(NutRow,{label:'Crude Fat',val:nutrients.fat,req:reqs.fat,unit:'%'}),
            h(NutRow,{label:'Crude Fibre',val:nutrients.fibre,req:reqs.fibre,unit:'%'}),
            h(NutRow,{label:'Calcium',val:nutrients.ca,req:reqs.ca,unit:'%'}),
            h(NutRow,{label:'Phosphorus',val:nutrients.p,req:reqs.p,unit:'%'}),
            h(NutRow,{label:'Lysine',val:nutrients.lys,req:reqs.lys,unit:'%'}),
            h(NutRow,{label:'Methionine',val:nutrients.met,req:reqs.met,unit:'%'}))))),

    //  Save formula modal 
    showSave&&h(Modal,{title:'Save Formula',onClose:()=>setShowSave(false),width:400},
      Inp({label:'Formula Name',value:fName,onChange:setFName,placeholder:'e.g. Broiler Starter March 2024'}),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}},
        h(Btn,{onClick:()=>setShowSave(false),variant:'secondary'},('Cancel'),
        h(Btn,{onClick:doSaveFormula,variant:'success',disabled:!fName},('Save'))),

    //  Sell modal 
    showSell&&pendingSale&&h(Modal,{title:'Confirm Sale',onClose:()=>setShowSell(false),width:480},
      h('div',{style:{background:C.parchment,borderRadius:8,padding:'11px 14px',marginBottom:14}},
        h('div',{style:{fontWeight:700,color:C.earth,marginBottom:6}},species+'  -  '+stage+' ('+batchKg+'kg)'),
        h('div',{style:{fontSize:13,color:C.muted}},'Cost of ingredients: ',
          h('strong',{style:{color:C.danger}},'KES '+pendingSale.totalCost.toFixed(2)))),
      Inp({label:'Agreed Sell Price (KES/kg)',value:selPrice,onChange:setSelPrice,
        type:'number',placeholder:'e.g. 65'}),
      selPrice&&h('div',{style:{background:'#f0f9f4',borderRadius:8,padding:'10px 14px',fontSize:13}},
        h('div',null,'Total Revenue: ',h('strong',{style:{color:C.grass}},
          'KES '+(parseFloat(selPrice)*batchKg).toFixed(2))),
        h('div',null,'Profit: ',h('strong',{style:{color:(parseFloat(selPrice)*batchKg-pendingSale.totalCost) > -1?C.grass:C.danger}},
          'KES '+(parseFloat(selPrice)*batchKg-pendingSale.totalCost).toFixed(2)))),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}},
        h(Btn,{onClick:()=>setShowSell(false),variant:'secondary'},('Cancel'),
        h(Btn,{onClick:doConfirmSale,variant:'success',disabled:!selPrice||!Number(selPrice)},agreeLabel)));
}


function SalesPage(){
  const {sales,setSales,inventory,setInventory,user}=useContext(Ctx);
  const rev=sales.reduce((s,x)=>s+(x.total||x.totalRevenue||0),0);
  const cost=sales.reduce((s,x)=>s+(x.cost||x.totalCost||0),0);
  const profit=rev-cost;
  const [toast,setToast]=useState(null);
  const showT=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};

  const deleteSale=(sale)=>{
    if(user?.role!=='admin'){showT('Only admin can delete sales records.','error');return;}
    if(!window.confirm('Delete this sale record? This cannot be undone.'))return;
    const next=sales.filter(s=>s.id!==sale.id);
    setSales(next);
    // Log to traceability ledger
    const ledger=db.get('stockLedger',[]);
    const entry={id:uid(),type:'DELETE_SALE',date:today(),product:sale.product||'',
      qty:sale.batchKg,total:sale.total||sale.totalRevenue||0,
      deletedRecord:JSON.stringify(sale),by:user?.name,at:new Date().toISOString()};
    db.set('stockLedger',[...ledger,entry]);
    serverPush('stockLedger',[...ledger,entry]);
    showT('Sale deleted and logged to traceability.');
  };

  return h('div',{style:{padding:'0 26px 26px'}},
    toast&&h(Toast,{msg:toast.msg,type:toast.type}),
    h(PageHdr,{title:'Sales Records',subtitle:'All confirmed feed sales'}),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}},
      h(StatCard,{label:'Total Sales',value:sales.length,icon:'',color:C.earth}),
      h(StatCard,{label:'Total Revenue',value:fmtKES(rev),icon:'',color:C.grass}),
      h(StatCard,{label:'Total Cost',value:fmtKES(cost),icon:'',color:C.warning}),
      h(StatCard,{label:'Total Profit',value:fmtKES(profit),sub:rev?((profit/rev)*100).toFixed(1)+'% margin':'',icon:'',color:profit > -1?C.grass:C.danger})),
    h(Card,null,h(CardTitle,null,'All Sales'),
      h(Tbl,{cols:[
        {key:'date',label:'Date'},
        {key:'customer',label:'Customer',render:r=>r.customerName||r.customer||'Walk-in'},
        {key:'product',label:'Product'},
        {key:'batchKg',label:'Batch',render:r=>r.batchKg+' kg'},
        {key:'cost',label:'Cost',render:r=>fmtKES(r.cost||r.totalCost||0)},
        {key:'total',label:'Revenue',render:r=>h('span',{style:{fontWeight:700,color:C.grass}},fmtKES(r.total||r.totalRevenue||0))},
        {key:'profit',label:'Profit',render:r=>h('span',{style:{color:(r.profit||0) > -1?C.grass:C.danger,fontWeight:700}},fmtKES(r.profit||0))},
        user?.role==='admin'&&{key:'del',label:'',render:r=>h(Btn,{size:'sm',variant:'danger',onClick:()=>deleteSale(r)},('[Delete]')},
      ].filter(Boolean),rows:sales.slice().reverse(),emptyMsg:'No sales yet.'})));
}

//  REPORTS 

function ReportsPage(){
  const {sales,inventory,purchases}=useContext(Ctx);
  const [period,setPeriod]=useState('month');
  const rangeMap={today:0,week:7,month:30,year:365};
  const filt=arr=>period==='today'?arr.filter(x=>x.date===today()):arr.filter(x=>x.date>=dateRange(rangeMap[period]));
  const fS=filt(sales),fP=filt(purchases);
  const rev=fS.reduce((s,x)=>s+x.total,0);
  const cost=fS.reduce((s,x)=>s+x.cost,0);
  const purchCost=fP.reduce((s,x)=>s+x.total,0);
  const profit=rev-cost;
  const pLabel={today:'Today',week:'This Week',month:'This Month',year:'This Year'}[period];
  const topIngr=Object.entries(
    fS.flatMap(s=>s.items||[]).reduce((acc,item)=>{acc[item.name]=(acc[item.name]||0)+(item.qty||0);return acc;},{})
  ).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const invVal=inventory.reduce((s,i)=>s+i.qty*(i.lastPrice||0),0);

  const summaryRows=[
    {label:'Gross Revenue',val:fmtKES(rev),color:C.grass},
    {label:'Feed Cost of Goods',val:fmtKES(cost),color:C.danger},
    {label:'Gross Profit',val:fmtKES(profit),color:profit > -1?C.grass:C.danger},
    {label:'Profit Margin',val:rev?((profit/rev)*100).toFixed(1)+'%':' - ',color:C.earth},
    {label:'Total Orders',val:fS.length,color:C.earth},
    {label:'Avg Order Value',val:fS.length?fmtKES(rev/fS.length):' - ',color:C.earth},
  ];

  return h('div',{style:{padding:'0 26px 26px'}},
    h(PageHdr,{title:'Reports & Analytics',subtitle:'Financial overview across all periods',
      action:h(Btn,{onClick:()=>window.print(),variant:'secondary',size:'sm'},(' Print')}),
    h('div',{style:{display:'flex',gap:8,marginBottom:18}},
      ['today','week','month','year'].map(p=>
        h(Btn,{key:p,onClick:()=>setPeriod(p),variant:period===p?'primary':'secondary',size:'sm'},
          {today:'Today',week:'This Week',month:'This Month',year:'This Year'}[p])
      )
    ),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}},
      h(StatCard,{label:pLabel+' Revenue',value:fmtKES(rev),color:C.grass,icon:''}),
      h(StatCard,{label:pLabel+' Profit',value:fmtKES(profit),sub:rev?((profit/rev)*100).toFixed(1)+'% margin':'',color:profit > -1?C.grass:C.danger,icon:''}),
      h(StatCard,{label:pLabel+' Purchases',value:fmtKES(purchCost),color:C.warning,icon:''}),
      h(StatCard,{label:pLabel+' Orders',value:fS.length,color:C.earth,icon:''})
    ),
    h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:15,marginBottom:15}},
      h(Card,null,
        h(CardTitle,null,'Sales Summary  -  '+pLabel),
        h('div',{style:{padding:15}},
          summaryRows.map((r,i)=>
            h('div',{key:i,style:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:i<5?'1px solid '+C.border:'none'}},
              h('span',{style:{fontSize:13,color:C.muted}},r.label),
              h('span',{style:{fontSize:14,fontWeight:700,color:r.color,fontFamily:"'DM Mono',monospace"}},r.val)
            )
          )
        )
      ),
      h(Card,null,
        h(CardTitle,null,'Top Ingredients Used'),
        h('div',{style:{padding:15}},
          topIngr.length===0
            ? h('div',{style:{color:C.muted,fontSize:13,textAlign:'center',padding:20}},('No data for this period')
            : topIngr.map(([name,qty],i)=>
                h('div',{key:i,style:{marginBottom:11}},
                  h('div',{style:{display:'flex',justifyContent:'space-between',marginBottom:4}},
                    h('span',{style:{fontSize:12,color:C.soil}},name),
                    h('span',{style:{fontSize:12,fontFamily:"'DM Mono',monospace",color:C.earth}},fmt(qty,1)+' kg')
                  ),
                  h('div',{style:{height:6,background:C.border,borderRadius:4,overflow:'hidden'}},
                    h('div',{style:{height:'100%',background:'linear-gradient(to right,'+C.earth+','+C.savanna+')',width:((qty/(topIngr[0][1]||1))*100)+'%',borderRadius:4}})
                  )
                )
              )
        )
      )
    ),
    h(Card,null,
      h(CardTitle,null,'Inventory Valuation'),
      h(Tbl,{cols:[
        {key:'name',label:'Ingredient'},
        {key:'qty',label:'Qty',render:r=>fmt(r.qty)+' kg'},
        {key:'lastPrice',label:'Price/kg',render:r=>fmtKES(r.lastPrice||0)},
        {key:'value',label:'Stock Value',render:r=>h('span',{style:{fontWeight:700,fontFamily:"'DM Mono',monospace"}},fmtKES(r.qty*(r.lastPrice||0)))},
        {key:'status',label:'Status',render:r=>h(Badge,{color:!(r.qty>0)?C.danger:r.qty<=r.reorderLevel?C.warning:C.grass},!(r.qty>0)?'Out':r.qty<=r.reorderLevel?'Low':'OK')},
      ],rows:inventory}),
      h('div',{style:{padding:'11px 15px',borderTop:'1px solid '+C.border,display:'flex',justifyContent:'flex-end'}},
        h('span',{style:{fontSize:14,fontWeight:700,color:C.earth,fontFamily:"'Playfair Display',serif"}},
          'Total Inventory Value: '+fmtKES(invVal)
        )
      )
    )
  );
}

//  FEEDING GUIDE 

function FeedingGuidePage(){
  const [species,setSpecies]=useState('');
  const speciesOptions=Object.keys(FEEDING_QTY);
  const stages=species&&FEEDING_QTY[species]?Object.entries(FEEDING_QTY[species]):[];
  return h('div',{style:{padding:'0 26px 26px'}},
    h(PageHdr,{title:'Feeding Quantity Guide',subtitle:'Recommended daily feed amounts per species and production stage'}),
    h(Card,{style:{marginBottom:15}},h('div',{style:{padding:15}},
      h(Sel,{label:'Select Species',value:species,onChange:setSpecies,
        options:[{value:'',label:'Choose a species'},...speciesOptions.map(s=>({value:s,label:(CATEGORY_ICONS[s]||'')+' '+s}))]}))),
    species&&stages.length>0&&h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:13}},
      stages.map(([sName,info])=>h(Card,{key:sName},
        h('div',{style:{background:`linear-gradient(135deg,${C.earth},${C.clay})`,padding:'11px 15px'}},
          h('div',{style:{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,color:'white'}},sName)),
        h('div',{style:{padding:13}},
          [{icon:'',label:'Daily Ration',val:info.qty},{icon:'',label:'Water',val:info.water},{icon:'',label:'Meals/Day',val:info.meals}]
          .map((x,i)=>h('div',{key:i,style:{display:'flex',gap:9,marginBottom:9,alignItems:'flex-start'}},
            h('span',{style:{fontSize:17}},x.icon),
            h('div',null,
              h('div',{style:{fontSize:10,fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:1,color:C.muted}},x.label),
              h('div',{style:{fontSize:13,fontWeight:600,color:C.earth}},x.val)))),
          info.notes&&h('div',{style:{background:C.parchment,borderRadius:6,padding:'7px 9px',fontSize:11,color:C.soil,borderLeft:`3px solid ${C.savanna}`,lineHeight:1.5,marginTop:8}},info.notes))))),
    !species&&h('div',{style:{textAlign:'center',padding:'60px 20px',color:C.muted}},
      h('div',{style:{fontSize:52,marginBottom:12}},''),
      h('div',{style:{fontFamily:"'Playfair Display',serif",fontSize:19,color:C.clay,marginBottom:7}},('Select a Species'),
      h('div',{style:{fontSize:14}},('Choose a species above to see daily feeding recommendations')));
}

function EducationPage(){
  const [filter,setFilter]=useState('all');
  const [idx,setIdx]=useState(0);
  const [auto,setAuto]=useState(false);
  const cats=[{key:'all',label:'All'},{key:'nutrition',label:' Nutrition'},{key:'cost',label:' Cost'},{key:'storage',label:' Storage'},{key:'health',label:' Health'},{key:'water',label:' Water'},{key:'seasons',label:' Seasons'},{key:'records',label:' Records'}];
  const tips=TIPS.filter(t=>filter==='all'||t.cat===filter);
  useEffect(()=>{if(!auto)return;const t=setInterval(()=>setIdx(c=>(c+1)%tips.length),8000);return()=>clearInterval(t);},[auto,tips.length]);
  const tip=tips[idx%tips.length];
  return h('div',{style:{padding:'0 26px 26px'}},
    h(PageHdr,{title:'Education Screen',subtitle:'Display tips on shop screens for waiting farmers',action:h(Btn,{onClick:()=>setAuto(!auto),variant:auto?'success':'secondary'},(auto?' Pause':' Auto-Play'))}),
    tip&&h(Card,{style:{marginBottom:18,border:`2px solid ${C.savanna}`}},
      h('div',{style:{background:`linear-gradient(135deg,${C.earth},${C.clay})`,padding:'38px 46px',textAlign:'center',minHeight:260,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}},
        h('div',{style:{fontSize:60,marginBottom:14}},tip.icon),
        h(Badge,{color:C.harvest},tip.tag),
        h('div',{style:{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:900,color:'white',margin:'13px 0 14px',lineHeight:1.2,maxWidth:560}},tip.title),
        h('div',{style:{fontSize:15,color:'rgba(255,255,255,0.75)',maxWidth:520,lineHeight:1.7}},tip.body)),
      h('div',{style:{padding:'11px 19px',display:'flex',alignItems:'center',justifyContent:'space-between',background:C.parchment}},
        h(Btn,{onClick:()=>setIdx(c=>(c-1+tips.length)%tips.length),variant:'secondary',size:'sm'},(' Previous'),
        h('span',{style:{fontFamily:"'DM Mono',monospace",fontSize:11,color:C.muted}},`${(idx%tips.length)+1} / ${tips.length}`),
        h(Btn,{onClick:()=>setIdx(c=>(c+1)%tips.length),variant:'secondary',size:'sm'},('Next '))),
    h('div',{style:{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}},cats.map(f=>h(Btn,{key:f.key,onClick:()=>{setFilter(f.key);setIdx(0);},variant:filter===f.key?'primary':'secondary',size:'sm'},f.label))),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:11}},
      tips.map((t,i)=>h('div',{key:t.id,onClick:()=>setIdx(i),style:{background:idx%tips.length===i?C.earth:'white',border:`1px solid ${idx%tips.length===i?C.earth:C.border}`,borderRadius:12,padding:'13px 15px',cursor:'pointer',transition:'all 0.15s'}},
        h('div',{style:{display:'flex',gap:9,alignItems:'flex-start'}},
          h('span',{style:{fontSize:22}},t.icon),
          h('div',null,
            h(Badge,{color:C.savanna},t.tag),
            h('div',{style:{fontFamily:"'Playfair Display',serif",fontSize:13,fontWeight:700,color:idx%tips.length===i?'white':C.earth,marginTop:4}},t.title),
            h('div',{style:{fontSize:11,color:idx%tips.length===i?'rgba(255,255,255,0.55)':C.muted,marginTop:3,lineHeight:1.5}},t.body.slice(0,75)+'')))))));
}


//  NUTRITIONAL REQUIREMENTS ADMIN PAGE 

function NutritionPage(){
  const {ingredients}=useContext(Ctx);
  const [reqs,setReqsState]=useState(()=>getAnimalReqs());
  const [tab,setTab]=useState('requirements'); // requirements | profiles | upload
  const [selCat,setSelCat]=useState('');
  const [showReqForm,setShowReqForm]=useState(false);
  const [editReq,setEditReq]=useState(null);
  const [toast,setToast]=useState(null);
  const showT=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};

  const saveReqs=v=>{setReqsState(v);setAnimalReqs(v);};

  const blankReq={category:'',stage:'',cp:[0,100],me:[0,9999],fat:[0,30],fibre:[0,50],ca:[0,10],p:[0,5],lys:[0,5],met:[0,5]};
  const [reqForm,setReqForm]=useState(blankReq);

  const cats=getAnimalCategories(reqs);
  const filtReqs=selCat?reqs.filter(r=>r.category===selCat):reqs;

  const openAddReq=()=>{setEditReq(null);setReqForm(blankReq);setShowReqForm(true);};
  const openEditReq=r=>{setEditReq(r);setReqForm({...r,
    cp:[...r.cp],me:[...r.me],fat:[...r.fat],fibre:[...r.fibre],
    ca:[...r.ca],p:[...r.p],lys:[...r.lys],met:[...r.met]});setShowReqForm(true);};
  const saveReq=()=>{
    if(!reqForm.category||!reqForm.stage)return;
    const entry={...reqForm,id:editReq?editReq.id:'ar_'+uid()};
    const upd=editReq?reqs.map(r=>r.id===editReq.id?entry:r):[...reqs,entry];
    saveReqs(upd);setShowReqForm(false);setEditReq(null);
    showT(editReq?'Requirements updated!':'New animal stage added!');
  };
  const delReq=r=>{if(!window.confirm('Delete this animal stage?'))return;saveReqs(reqs.filter(x=>x.id!==r.id));showT('Deleted.','warn');};
  const resetToDefaults=()=>{if(!window.confirm('Reset ALL nutritional requirements to Excel defaults? This cannot be undone.'))return;saveReqs(SEED_ANIMAL_REQS);showT('Reset to defaults!');};

  // Excel upload handler
  const handleExcelUpload=e=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        // Basic CSV/TSV parse for simple upload
        // For Excel, user should export ANIMAL_REQUIREMENTS sheet as CSV
        const text=ev.target.result;
        const lines=text.split('\n').map(l=>l.split(',').map(x=>x.trim().replace(/^"|"$/g,'')));
        // Skip header rows, parse data
        const parsed=lines.slice(1).filter(l=>l[0]&&l[1]).map((l,i)=>({
          id:'ar_upload_'+i+'_'+Date.now().toString(36),
          category:l[0],stage:l[1],
          cp:[parseFloat(l[2])||0,parseFloat(l[3])||100],
          me:[parseFloat(l[4])||0,parseFloat(l[5])||9999],
          fat:[parseFloat(l[6])||0,parseFloat(l[7])||30],
          fibre:[parseFloat(l[8])||0,parseFloat(l[9])||50],
          ca:[parseFloat(l[10])||0,parseFloat(l[11])||10],
          p:[parseFloat(l[12])||0,parseFloat(l[13])||5],
          lys:[parseFloat(l[14])||0,parseFloat(l[15])||5],
          met:[parseFloat(l[16])||0,parseFloat(l[17])||5],
        }));
        if(parsed.length===0){showT('No valid data found in file.','error');return;}
        if(window.confirm('Import '+parsed.length+' animal stages? This will REPLACE the existing requirements.')){
          saveReqs(parsed);showT('Imported '+parsed.length+' animal stages from CSV!');
        }
      }catch(err){showT('Error reading file: '+err.message,'error');}
    };
    reader.readAsText(file);
  };

  // Mini range input helper
  const RangeInp=({nut,label,unit})=>h('div',{style:{marginBottom:10}},
    h('div',{style:{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:C.muted,marginBottom:4}},label,' (',unit,')'),
    h('div',{style:{display:'flex',gap:6,alignItems:'center'}},
      h('input',{type:'number',step:'any',value:reqForm[nut][0],
        onChange:e=>{const v=[...reqForm[nut]];v[0]=parseFloat(e.target.value)||0;setReqForm({...reqForm,[nut]:v});},
        style:{width:80,padding:'6px 8px',border:'1px solid '+C.border,borderRadius:6,fontSize:12,fontFamily:"'DM Mono',monospace",background:C.cream},placeholder:'Min'}),
      h('span',{style:{color:C.muted,fontSize:12}},(' - '),
      h('input',{type:'number',step:'any',value:reqForm[nut][1],
        onChange:e=>{const v=[...reqForm[nut]];v[1]=parseFloat(e.target.value)||0;setReqForm({...reqForm,[nut]:v});},
        style:{width:80,padding:'6px 8px',border:'1px solid '+C.border,borderRadius:6,fontSize:12,fontFamily:"'DM Mono',monospace",background:C.cream},placeholder:'Max'})));

  return h('div',{style:{padding:'0 26px 26px'}},
    toast&&h(Toast,{msg:toast.msg,type:toast.type}),
    h(PageHdr,{title:'Nutritional Requirements',subtitle:'Manage animal requirements and ingredient nutrient profiles',
      action:h('div',{style:{display:'flex',gap:8}},
        h(Btn,{onClick:resetToDefaults,variant:'secondary',size:'sm'},(' Reset to Defaults'),
        tab==='requirements'&&h(Btn,{onClick:openAddReq,variant:'success',size:'sm'},('+ Add Animal Stage'))}),

    // Tabs
    h('div',{style:{display:'flex',gap:8,marginBottom:18,borderBottom:'2px solid '+C.border,paddingBottom:0}},
      ['requirements','profiles','upload'].map(t=>
        h('button',{key:t,onClick:()=>setTab(t),style:{padding:'9px 18px',border:'none',borderBottom:tab===t?'3px solid '+C.earth:'3px solid transparent',
          background:'none',cursor:'pointer',fontSize:13,fontWeight:tab===t?700:400,color:tab===t?C.earth:C.muted,fontFamily:"'DM Sans',sans-serif",
          textTransform:'capitalize',marginBottom:-2}},
          t==='requirements'?' Animal Requirements':t==='profiles'?' Ingredient Profiles':' Upload CSV'))),

    //  TAB: Animal Requirements 
    tab==='requirements'&&h('div',null,
      h('div',{style:{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}},
        h('span',{style:{fontSize:12,color:C.muted}},('Filter by species:'),
        h(Btn,{size:'sm',variant:!selCat?'primary':'secondary',onClick:()=>setSelCat('')},'All ('+reqs.length+')'),
        cats.map(cat=>h(Btn,{key:cat,size:'sm',variant:selCat===cat?'primary':'secondary',onClick:()=>setSelCat(cat)},
          (CATEGORY_ICONS[cat]||'')+' '+cat+' ('+reqs.filter(r=>r.category===cat).length+')'))),
      h(Card,null,h(CardTitle,null,filtReqs.length+' animal stages'),
        h('div',{style:{overflowX:'auto'}},
          h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:12}},
            h('thead',null,h('tr',null,
              ['Category','Stage','CP %','ME kcal/kg','Fat %','Fibre %','Ca %','P %','Lys %','Met %',''].map((col,i)=>
                h('th',{key:i,style:{padding:'8px 10px',background:C.earth,color:'white',textAlign:'left',fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:1,textTransform:'uppercase',whiteSpace:'nowrap'}},col)))),
            h('tbody',null,filtReqs.map((r,i)=>
              h('tr',{key:r.id,style:{borderBottom:'1px solid '+C.border,background:i%2===0?C.cream:'white'}},
                h('td',{style:{padding:'8px 10px',fontWeight:600,color:C.earth}},h('span',{style:{marginRight:4}},CATEGORY_ICONS[r.category]||''),r.category),
                h('td',{style:{padding:'8px 10px',color:C.soil}},r.stage),
                ...['cp','me','fat','fibre','ca','p','lys','met'].map(nut=>
                  h('td',{key:nut,style:{padding:'8px 10px',fontFamily:"'DM Mono',monospace",color:C.muted,whiteSpace:'nowrap'}},
                    r[nut][0]+' - '+r[nut][1])),
                h('td',{style:{padding:'8px 10px'}},
                  h('div',{style:{display:'flex',gap:5}},
                    h(Btn,{size:'sm',variant:'secondary',onClick:()=>openEditReq(r)},''),
                    h(Btn,{size:'sm',variant:'danger',onClick:()=>delReq(r)},('[Delete]')))))))),
      ),
      h('div',{style:{marginTop:12,padding:'10px 14px',background:C.parchment,borderRadius:8,fontSize:12,color:C.muted,border:'1px solid '+C.border}},
        ' Requirements are used by the LP solver to formulate optimal least-cost feeds. Min and Max define the acceptable range for each nutrient in the finished feed.')),

    //  TAB: Ingredient Profiles 
    tab==='profiles'&&h('div',null,
      h('div',{style:{background:'#fff8e6',border:'1px solid '+C.harvest,borderRadius:8,padding:'11px 15px',marginBottom:14,fontSize:13,color:C.soil}},
        ' Ingredient nutritional profiles are managed in the ',h('strong',null,'Ingredients'),' page. Go to Admin  Ingredients  Edit any ingredient to update CP, ME, Ca, P, Lysine, Methionine, Fat and Fibre values.'),
      h(Card,null,h(CardTitle,null,'Current Ingredient Nutrient Profiles'),
        h('div',{style:{overflowX:'auto'}},
          h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:12}},
            h('thead',null,h('tr',null,
              ['Ingredient','Category','Price/kg','CP%','ME','Fat%','Fibre%','Ca%','P%','Lys%','Met%'].map((col,i)=>
                h('th',{key:i,style:{padding:'8px 10px',background:C.earth,color:'white',textAlign:'left',fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:1,textTransform:'uppercase',whiteSpace:'nowrap'}},col)))),
            h('tbody',null,
              [...ingredients,...SEED_INGREDIENT_PROFILES.filter(p=>!ingredients.find(i=>i.id===p.id))]
              .slice(0,30).map((ing,i)=>
                h('tr',{key:ing.id,style:{borderBottom:'1px solid '+C.border,background:i%2===0?C.cream:'white'}},
                  h('td',{style:{padding:'8px 10px',fontWeight:600,color:C.earth}},ing.name),
                  h('td',{style:{padding:'8px 10px'}},h(Badge,{color:C.savanna},ing.category||' - ')),
                  h('td',{style:{padding:'8px 10px',fontFamily:"'DM Mono',monospace"}},ing.price?'KES '+ing.price:' - '),
                  ...['cp','me','fat','fibre','ca','p','lys','met'].map(n=>
                    h('td',{key:n,style:{padding:'8px 10px',fontFamily:"'DM Mono',monospace",color:C.muted}},ing[n]??' - ')))))))),

    //  TAB: Upload 
    tab==='upload'&&h('div',null,
      h(Card,{style:{marginBottom:15}},
        h(CardTitle,null,'Upload Animal Requirements (CSV)'),
        h('div',{style:{padding:18}},
          h('p',{style:{fontSize:13,color:C.muted,marginBottom:14,lineHeight:1.7}},('Upload a CSV file to bulk-import or replace animal nutritional requirements. The CSV must have columns in this exact order:'),
          h('div',{style:{background:C.parchment,borderRadius:8,padding:'10px 14px',fontFamily:"'DM Mono',monospace",fontSize:11,color:C.earth,marginBottom:14,overflowX:'auto',whiteSpace:'nowrap'}},
            'Category, Stage, CP_Min, CP_Max, ME_Min, ME_Max, Fat_Min, Fat_Max, Fibre_Min, Fibre_Max, Ca_Min, Ca_Max, P_Min, P_Max, Lys_Min, Lys_Max, Met_Min, Met_Max'),
          h('div',{style:{background:'#f0f9f4',border:'1px solid '+C.leaf,borderRadius:8,padding:'10px 14px',fontSize:12,color:C.soil,marginBottom:16}},
            h('strong',null,'Example row:'),h('br',null),'Poultry (Broiler), Starter (0-21 days), 22, 24, 3000, 3200, 4, 8, 0, 5, 0.9, 1.1, 0.45, 0.60, 1.20, 1.50, 0.50, 0.65'),
          h('div',{style:{marginBottom:14}},
            h('label',{style:{display:'block',padding:'14px 20px',background:C.earth,color:'white',borderRadius:8,cursor:'pointer',textAlign:'center',fontSize:14,fontWeight:600}},
              ' Choose CSV File to Upload',
              h('input',{type:'file',accept:'.csv',onChange:handleExcelUpload,style:{display:'none'}}))),
          h('div',{style:{fontSize:12,color:C.muted,lineHeight:1.7}},
            ' Uploading will REPLACE all existing requirements. To add individual stages, use the "Animal Requirements" tab  "+ Add Animal Stage" button. ',
            h('strong',null,'Export the Excel ANIMAL_REQUIREMENTS sheet as CSV'),' to use the provided reference data directly.'))),

      h(Card,null,
        h(CardTitle,null,'Download Current Requirements as CSV'),
        h('div',{style:{padding:18}},
          h(Btn,{onClick:()=>{
            const rows=[['Category','Stage','CP_Min','CP_Max','ME_Min','ME_Max','Fat_Min','Fat_Max','Fibre_Min','Fibre_Max','Ca_Min','Ca_Max','P_Min','P_Max','Lys_Min','Lys_Max','Met_Min','Met_Max']];
            reqs.forEach(r=>rows.push([r.category,r.stage,...r.cp,...r.me,...r.fat,...r.fibre,...r.ca,...r.p,...r.lys,...r.met]));
            const csv=rows.map(r=>r.join(',')).join('\n');
            const a=document.createElement('a');a.href='data:text/csv,'+encodeURIComponent(csv);a.download='animal_requirements.csv';a.click();
          },variant:'secondary'},(' Export Requirements CSV')))),

    //  Edit/Add Modal 
    showReqForm&&h(Modal,{title:editReq?'Edit: '+editReq.category+'  -  '+editReq.stage:'Add Animal Stage',onClose:()=>{setShowReqForm(false);setEditReq(null);},width:680},
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}},
        h('div',null,Inp({label:'Animal Category *',value:reqForm.category,onChange:v=>setReqForm({...reqForm,category:v}),placeholder:'e.g. Poultry (Broiler)'})),
        h('div',null,Inp({label:'Life Stage *',value:reqForm.stage,onChange:v=>setReqForm({...reqForm,stage:v}),placeholder:'e.g. Starter (0-21 days)'}))),
      h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:14,marginBottom:10}},
        h('div',{style:{fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:2,textTransform:'uppercase',color:C.muted,marginBottom:12}},('Nutritional Requirements  -  Min / Max per nutrient in finished feed')),
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}},
        h(RangeInp,{nut:'cp',  label:'Crude Protein',     unit:'%'}),
        h(RangeInp,{nut:'me',  label:'Metabolisable Energy',unit:'kcal/kg'}),
        h(RangeInp,{nut:'fat', label:'Crude Fat',          unit:'%'}),
        h(RangeInp,{nut:'fibre',label:'Crude Fibre',       unit:'%'}),
        h(RangeInp,{nut:'ca',  label:'Calcium (Ca)',        unit:'%'}),
        h(RangeInp,{nut:'p',   label:'Phosphorus (P)',      unit:'%'}),
        h(RangeInp,{nut:'lys', label:'Lysine',              unit:'%'}),
        h(RangeInp,{nut:'met', label:'Methionine',          unit:'%'})),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}},
        h(Btn,{onClick:()=>{setShowReqForm(false);setEditReq(null);},variant:'secondary'},('Cancel'),
        h(Btn,{onClick:saveReq,variant:'success'},(editReq?'Update Requirements':'Add Animal Stage'))))));
}

//  USERS 

function UsersPage({currentUser}){
  const [users,setUsersState]=useState(()=>db.get('users',SEED_USERS));
  const [toast,setToast]=useState(null);
  const showT=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};

  // Pull latest users from server on mount
  useEffect(()=>{
    fetch('/api/data/users',{headers:{'X-Sync-Key':import.meta.env?.VITE_SYNC_KEY||'wamifugo2024'}})
      .then(r=>r.json()).then(d=>{if(d.data&&d.data.length){db.set('users',d.data);setUsersState(d.data);}}).catch(()=>{});
  },[]);

  const saveUsers=next=>{setUsersState(next);db.set('users',next);serverPush('users',next);};

  //  Add user state 
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({name:'',username:'',password:'',email:'',role:'staff',active:true});

  //  Edit user state 
  const [editUser,setEditUser]=useState(null);
  const [editForm,setEditForm]=useState({name:'',username:'',email:'',role:'staff',active:true});

  //  Password change state 
  const [pwdUser,setPwdUser]=useState(null);
  const [newPwd,setNewPwd]=useState('');
  const [confirmPwd,setConfirmPwd]=useState('');
  const [currentPwd,setCurrentPwd]=useState(''); // for own password change

  const addUser=()=>{
    if(!form.name||!form.username||!form.password)return;
    if(users.find(u=>u.username===form.username)){showT('Username already exists','error');return;}
    const next=[...users,{...form,id:uid(),created:today(),active:true}];
    saveUsers(next);setForm({name:'',username:'',password:'',email:'',role:'staff',active:true});
    setShowAdd(false);showT('User created!');
  };

  const openEdit=(u)=>{
    setEditUser(u);
    setEditForm({name:u.name,username:u.username,email:u.email||'',role:u.role,active:u.active!==false});
  };

  const saveEdit=()=>{
    if(!editForm.name||!editForm.username)return;
    // Check username unique (excluding self)
    if(users.find(u=>u.username===editForm.username&&u.id!==editUser.id)){
      showT('Username already taken','error');return;
    }
    const next=users.map(u=>u.id===editUser.id?{...u,...editForm}:u);
    saveUsers(next);setEditUser(null);showT('Profile updated!');
  };

  const openPwd=(u)=>{setPwdUser(u);setNewPwd('');setConfirmPwd('');setCurrentPwd('');};

  const savePwd=()=>{
    if(!newPwd){showT('Password must be at least 6 characters','error');return;}
    if(newPwd!==confirmPwd){showT('Passwords do not match','error');return;}
    // If changing own password and not admin, verify current password
    const isOwnAccount=pwdUser.id===currentUser?.id;
    const isAdmin=currentUser?.role==='admin';
    if(isOwnAccount&&!isAdmin){
      if(!currentPwd){showT('Enter your current password','error');return;}
      const self=users.find(u=>u.id===currentUser.id);
      if(self?.password!==currentPwd){showT('Current password is incorrect','error');return;}
    }
    const next=users.map(u=>u.id===pwdUser.id?{...u,password:newPwd}:u);
    saveUsers(next);setPwdUser(null);showT('Password changed successfully!');
  };

  const toggleActive=(u)=>{
    if(u.id===currentUser?.id){showT("You can't deactivate your own account",'error');return;}
    const next=users.map(x=>x.id===u.id?{...x,active:!x.active}:x);
    saveUsers(next);showT(u.active?'User deactivated':'User activated');
  };

  const deleteUser=(u)=>{
    if(u.id===currentUser?.id){showT("You can't delete your own account",'error');return;}
    if(users.filter(x=>x.role==='admin'&&x.active).length < 2&&u.role==='admin'){
      showT('Cannot delete the last admin account','error');return;
    }
    if(!window.confirm('Delete user '+u.name+'? This cannot be undone.'))return;
    const next=users.filter(x=>x.id!==u.id);
    saveUsers(next);showT('User deleted');
  };

  const roleColor={admin:C.earth,staff:C.grass};

  return h('div',{style:{padding:'0 26px 26px'}},
    toast&&h(Toast,{msg:toast.msg,type:toast.type}),
    h(PageHdr,{title:'User Management',subtitle:'Manage staff accounts and access levels',
      action:h(Btn,{onClick:()=>setShowAdd(true),variant:'success'},('+ New User')}),

    //  Stats 
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:18}},
      h(StatCard,{label:'Total Users',value:users.length,color:C.earth,icon:''}),
      h(StatCard,{label:'Active',value:users.filter(u=>u.active!==false).length,color:C.grass,icon:'OK'}),
      h(StatCard,{label:'Admins',value:users.filter(u=>u.role==='admin').length,color:C.savanna,icon:''})),

    //  Users table 
    h(Card,null,h(CardTitle,null,'All Users'),
      h('div',{style:{overflowX:'auto'}},
        h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:13}},
          h('thead',null,h('tr',null,
            ['Name','Username','Email','Role','Status','Actions'].map((col,i)=>
              h('th',{key:i,style:{padding:'9px 12px',background:C.earth,color:'white',textAlign:'left',fontSize:11,textTransform:'uppercase',letterSpacing:1}},col)))),
          h('tbody',null,users.map((u,i)=>
            h('tr',{key:u.id,style:{borderBottom:'1px solid '+C.border,background:i%2===0?C.cream:'white'}},
              h('td',{style:{padding:'10px 12px'}},
                h('div',{style:{fontWeight:700,color:C.earth}},u.name),
                u.created&&h('div',{style:{fontSize:10,color:C.muted}},u.created)),
              h('td',{style:{padding:'10px 12px',fontFamily:"'DM Mono',monospace",fontSize:12}},u.username),
              h('td',{style:{padding:'10px 12px',fontSize:12,color:C.muted}},u.email||' - '),
              h('td',{style:{padding:'10px 12px'}},
                h(Badge,{color:roleColor[u.role]||C.muted},u.role)),
              h('td',{style:{padding:'10px 12px'}},
                h(Badge,{color:u.active!==false?C.grass:C.danger},u.active!==false?'Active':'Inactive')),
              h('td',{style:{padding:'8px 12px'}},
                h('div',{style:{display:'flex',gap:5,flexWrap:'wrap'}},
                  h(Btn,{size:'sm',variant:'secondary',onClick:()=>openEdit(u)},(' Edit'),
                  h(Btn,{size:'sm',variant:'secondary',onClick:()=>openPwd(u)},(' Password'),
                  currentUser?.role==='admin'&&u.id!==currentUser?.id&&
                    h(Btn,{size:'sm',variant:u.active!==false?'secondary':'success',onClick:()=>toggleActive(u)},
                      u.active!==false?'Deactivate':'Activate'),
                  currentUser?.role==='admin'&&u.id!==currentUser?.id&&
                    h(Btn,{size:'sm',variant:'danger',onClick:()=>deleteUser(u)},('[Delete]')))))))),

    //  Add User Modal 
    showAdd&&h(Modal,{title:'Add New User',onClose:()=>setShowAdd(false),width:480},
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}},
        h('div',null,Inp({label:'Full Name *',value:form.name,onChange:v=>setForm({...form,name:v}),placeholder:'e.g. Jane Wanjiku'})),
        h('div',null,Inp({label:'Username *',value:form.username,onChange:v=>setForm({...form,username:v.toLowerCase().replace(/[\s]/g,'')}),placeholder:'e.g. jane.w'})),
        h('div',null,Inp({label:'Email',value:form.email,onChange:v=>setForm({...form,email:v}),type:'email',placeholder:'jane@farm.co.ke'})),
        h('div',null,Inp({label:'Password *',value:form.password,onChange:v=>setForm({...form,password:v}),type:'password',placeholder:'Min 6 characters'})),
        h('div',{style:{gridColumn:'1/-1'}},
          h(Sel,{label:'Role',value:form.role,onChange:v=>setForm({...form,role:v}),
            options:[{value:'staff',label:'Staff  -  limited access'},{value:'admin',label:'Admin  -  full access'}]}))),
      h('div',{style:{background:C.parchment,borderRadius:8,padding:'10px 14px',marginTop:12,fontSize:12,color:C.muted}},
        h('strong',null,'Staff'),' can record sales, view inventory and customers.',h('br',null),
        h('strong',null,'Admin'),' can additionally manage users, delete records, edit prices and access all settings.'),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}},
        h(Btn,{onClick:()=>setShowAdd(false),variant:'secondary'},('Cancel'),
        h(Btn,{onClick:addUser,variant:'success',disabled:!form.name||!form.username||!form.password},('Create User'))),

    //  Edit Profile Modal 
    editUser&&h(Modal,{title:'Edit Profile  -  '+editUser.name,onClose:()=>setEditUser(null),width:480},
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}},
        h('div',null,Inp({label:'Full Name *',value:editForm.name,onChange:v=>setEditForm({...editForm,name:v})})),
        h('div',null,Inp({label:'Username *',value:editForm.username,onChange:v=>setEditForm({...editForm,username:v.toLowerCase().replace(/[\s]/g,'')})})),
        h('div',{style:{gridColumn:'1/-1'}},Inp({label:'Email',value:editForm.email,onChange:v=>setEditForm({...editForm,email:v}),type:'email'})),
        currentUser?.role==='admin'&&h('div',{style:{gridColumn:'1/-1'}},
          h(Sel,{label:'Role',value:editForm.role,onChange:v=>setEditForm({...editForm,role:v}),
            options:[{value:'staff',label:'Staff'},{value:'admin',label:'Admin'}]}))),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}},
        h(Btn,{onClick:()=>setEditUser(null),variant:'secondary'},('Cancel'),
        h(Btn,{onClick:saveEdit,variant:'success',disabled:!editForm.name||!editForm.username},('Save Changes'))),

    //  Change Password Modal 
    pwdUser&&h(Modal,{title:'Change Password  -  '+pwdUser.name,onClose:()=>setPwdUser(null),width:420},
      h('div',{style:{background:C.parchment,borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13,color:C.soil}},
        pwdUser.id===currentUser?.id&&currentUser?.role!=='admin'
          ?'Enter your current password to set a new one.'
          :'As admin, you can set a new password without the current one.'),
      pwdUser.id===currentUser?.id&&currentUser?.role!=='admin'&&
        Inp({label:'Current Password',value:currentPwd,onChange:setCurrentPwd,type:'password',placeholder:'Your current password'}),
      Inp({label:'New Password',value:newPwd,onChange:setNewPwd,type:'password',placeholder:'Minimum 6 characters'}),
      h('div',{style:{marginBottom:14}},
        h('div',{style:{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:C.muted,marginBottom:5}},('Confirm New Password'),
        h('input',{type:'password',value:confirmPwd,onChange:e=>setConfirmPwd(e.target.value),placeholder:'Repeat new password',
          style:{width:'100%',padding:'9px 12px',border:'1px solid '+(confirmPwd&&confirmPwd!==newPwd?C.danger:C.border),
            borderRadius:8,fontSize:14,background:C.cream}}),
        confirmPwd&&confirmPwd!==newPwd&&h('div',{style:{fontSize:11,color:C.danger,marginTop:4}},('Passwords do not match')),
      h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}},
        h(Btn,{onClick:()=>setPwdUser(null),variant:'secondary'},('Cancel'),
        h(Btn,{onClick:savePwd,variant:'success',disabled:!newPwd||!confirmPwd||newPwd!==confirmPwd},('Change Password')))));
}

function TraceabilityPage(){
  const {user}=useContext(Ctx);
  const [ledger,setLedger]=useState(()=>db.get('stockLedger',[]));
  const [filter,setFilter]=useState('ALL');
  const [search,setSearch]=useState('');

  useEffect(()=>{
    const sv=db.get('stockLedger',[]);
    setLedger(sv||[]);
  },[]);

  const typeColor={
    PURCHASE:C.grass, SALE:C.savanna, DELETE_PURCHASE:C.danger,
    DELETE_SALE:C.danger, DELETE_INGREDIENT:C.danger, PRICE_CHANGE:C.clay,
    ADJ:C.soil, VOID:C.danger,
  };
  const typeLabel={
    PURCHASE:'Stock In', SALE:'Sale', DELETE_PURCHASE:'Purchase Deleted',
    DELETE_SALE:'Sale Deleted', DELETE_INGREDIENT:'Ingredient Deleted',
    PRICE_CHANGE:'Price Changed', ADJ:'Adjustment', VOID:'Voided',
  };

  const types=['ALL','PURCHASE','SALE','DELETE_PURCHASE','DELETE_SALE','DELETE_INGREDIENT','PRICE_CHANGE','ADJ'];
  const filtered=ledger.filter(e=>{
    if(filter!=='ALL'&&e.type!==filter)return false;
    if(search&&!JSON.stringify(e).toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  }).sort((a,b)=>b.date>a.date?1:-1);

  return h('div',{style:{padding:'0 26px 26px'}},
    h(PageHdr,{title:'Traceability Log',subtitle:'Full audit trail of all stock movements, sales and deleted records'}),
    h('div',{style:{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}},
      h('input',{value:search,onChange:e=>setSearch(e.target.value),placeholder:'Search logs...',
        style:{flex:1,minWidth:200,padding:'8px 12px',border:'1px solid '+C.border,borderRadius:8,fontSize:13,background:C.cream}}),
      types.map(t=>h(Btn,{key:t,size:'sm',variant:filter===t?'primary':'secondary',onClick:()=>setFilter(t)},
        t==='ALL'?'All ('+ledger.length+')':(typeLabel[t]||t)))),
    h(Card,null,
      filtered.length===0?h('div',{style:{textAlign:'center',padding:40,color:C.muted}},('No records found'):
      h('div',{style:{overflowX:'auto'}},
        h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:12}},
          h('thead',null,h('tr',null,
            ['Date','Type','Item','Qty','Value','By','Details'].map((col,i)=>
              h('th',{key:i,style:{padding:'8px 10px',background:C.earth,color:'white',textAlign:'left',fontSize:10,textTransform:'uppercase',letterSpacing:1,whiteSpace:'nowrap'}},col)))),
          h('tbody',null,filtered.map((e,i)=>
            h('tr',{key:e.id||i,style:{borderBottom:'1px solid '+C.border,background:i%2===0?C.cream:'white'}},
              h('td',{style:{padding:'8px 10px',whiteSpace:'nowrap',color:C.muted,fontSize:11}},e.date||e.at?.slice(0,10)||' - '),
              h('td',{style:{padding:'8px 10px'}},h('span',{style:{background:(typeColor[e.type]||C.muted)+'22',color:typeColor[e.type]||C.muted,padding:'2px 8px',borderRadius:12,fontSize:10,fontWeight:700,whiteSpace:'nowrap'}},typeLabel[e.type]||e.type)),
              h('td',{style:{padding:'8px 10px',fontWeight:600,color:C.earth}},e.itemName||e.product||' - '),
              h('td',{style:{padding:'8px 10px',fontFamily:"'DM Mono',monospace"}},e.qty!=null?(e.qty>0?'+':'')+fmt(e.qty)+' kg':' - '),
              h('td',{style:{padding:'8px 10px',fontFamily:"'DM Mono',monospace"}},e.total?fmtKES(e.total):' - '),
              h('td',{style:{padding:'8px 10px',fontSize:11,color:C.muted}},e.by||' - '),
              h('td',{style:{padding:'8px 10px',fontSize:11,color:C.muted,maxWidth:300}},
                e.deletedRecord?h('details',null,h('summary',{style:{cursor:'pointer',color:C.danger}},('View deleted record'),h('pre',{style:{fontSize:10,marginTop:4,whiteSpace:'pre-wrap',wordBreak:'break-all'}},e.deletedRecord)):
                e.notes||e.supplier||' - '))))))));
}


function ResourcesPage(){
  const {ingredients,inventory,sales,purchases,customers}=useContext(Ctx)||{};
  const [toast,setToast]=useState(null);
  const showT=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};

  function dlCSV(rows,filename){
    const csv=rows.map(r=>r.map(c=>{
      const s=String(c??'').replace(/"/g,'\"');
      return s.includes(',')||s.includes('\n')?`"${s}"`:s;
    }).join(',')).join('\n');
    const a=document.createElement('a');
    a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
    a.download=filename;a.click();
  }

  function printReport(title,rows,headers){
    const w=window.open('','_blank');
    const th=headers.map(h=>'<th style="background:#3d2b1f;color:white;padding:8px 10px;text-align:left;font-size:11px">'+(h)+'</th>').join('');
    const tbody=rows.map((row,i)=>
      '<tr style="background:'+(i%2?'#faf6ee':'white')+'">${row.map(c=>'<td style="padding:6px 10px;font-size:11px;border-bottom:1px solid #e8e0d4">${c??''}</td>').join('')}</tr>'
    ).join('');
    w.document.write('<!DOCTYPE html><html><head><title>'+(title)+'</title>
    <style>body{font-family:Arial,sans-serif;margin:20px}h1{color:#3d2b1f}table{border-collapse:collapse;width:100%}@media print{button{display:none}}</style>
    </head><body>
    <h1>'+(title)+'</h1>
    <p style="color:#7a6a55;font-size:12px">Generated: '+(new Date().toLocaleString('en-KE'))+' | Wa-Mifugo Feeds</p>
    <table><thead><tr>'+(th)+'</tr></thead><tbody>'+(tbody)+'</tbody></table>
    <br><button onclick="window.print()" style="background:#3d2b1f;color:white;padding:10px 20px;border:none;border-radius:6px;cursor:pointer;font-size:14px"> Print / Save PDF</button>
    </body></html>');
    w.document.close();
  }

  const exports=[
    {icon:'',title:'Ingredients',desc:'Nutrient profiles, prices, inclusion limits',
      onCSV:()=>dlCSV([['ID','Name','Category','Price (KES/kg)','CP%','ME kcal/kg','Ca%','P%','Lys%','Met%','Min Incl%','Max Incl%'],...(ingredients||[]).map(i=>[i.id,i.name,i.category||'',i.price||0,i.cp||0,i.me||0,i.ca||0,i.p||0,i.lys||0,i.met||0,i.minIncl||0,i.maxIncl||100])],'ingredients.csv'),
      onPrint:()=>printReport('Ingredient Register',(ingredients||[]).map(i=>[i.name,i.category||'','KES '+i.price,i.cp,i.me,i.ca,i.p]),['Ingredient','Category','Price/kg','CP%','ME','Ca%','P%'])},
    {icon:'',title:'Inventory',desc:'Current stock levels and valuations',
      onCSV:()=>dlCSV([['Name','Category','Stock (kg)','Buy Price','Sell Price','Stock Value'],...(inventory||[]).map(i=>[i.name,i.category||'',i.qty||0,i.lastPrice||0,i.sellPrice||'','KES '+(((i.qty||0)*(i.lastPrice||0)).toLocaleString())])],'inventory.csv'),
      onPrint:()=>printReport('Inventory Report',(inventory||[]).map(i=>[i.name,i.qty+' kg','KES '+i.lastPrice,'KES '+((i.qty||0)*(i.lastPrice||0)).toLocaleString()]),['Ingredient','Stock','Buy Price','Stock Value'])},
    {icon:'',title:'Sales',desc:'All sales records with profit analysis',
      onCSV:()=>dlCSV([['Date','Customer','Product','Batch kg','Revenue','Cost','Profit'],...(sales||[]).map(s=>[s.date,s.customerName||s.customer||'',s.product,s.batchKg,s.total||s.totalRevenue||0,s.cost||s.totalCost||0,s.profit||0])],'sales.csv'),
      onPrint:()=>printReport('Sales Report',(sales||[]).map(s=>[s.date,s.customerName||s.customer||'',s.product,s.batchKg+'kg','KES '+(s.total||s.totalRevenue||0).toLocaleString()]),['Date','Customer','Product','Batch','Revenue'])},
    {icon:'',title:'Purchases',desc:'All stock purchase records',
      onCSV:()=>dlCSV([['Date','Ingredient','Qty (kg)','Cost/kg','Total','Supplier'],...(purchases||[]).map(p=>[p.date,p.itemName,p.qty,p.costPerKg,p.total,p.supplier||''])],'purchases.csv'),
      onPrint:()=>printReport('Purchase Records',(purchases||[]).map(p=>[p.date,p.itemName,p.qty+'kg','KES '+p.costPerKg,'KES '+(p.total||0).toLocaleString(),p.supplier||'']),['Date','Ingredient','Qty','Cost/kg','Total','Supplier'])},
    {icon:'',title:'Customers',desc:'Customer directory',
      onCSV:()=>dlCSV([['Name','Phone','Email','Location'],...(customers||[]).map(c=>[c.name,c.phone||'',c.email||'',c.location||''])],'customers.csv'),
      onPrint:()=>printReport('Customer Directory',(customers||[]).map(c=>[c.name,c.phone||'',c.email||'',c.location||'']),['Name','Phone','Email','Location'])},
    {icon:'',title:'Animal Requirements',desc:'Nutritional targets by species and stage',
      onCSV:()=>dlCSV([['Category','Stage','CP Min','CP Max','ME Min','ME Max','Ca Min','Ca Max','P Min','P Max'],...SEED_ANIMAL_REQS.map(a=>[a.category,a.stage,...a.cp,...a.me,...a.ca,...a.p])],'animal_requirements.csv'),
      onPrint:()=>printReport('Animal Nutritional Requirements',SEED_ANIMAL_REQS.map(a=>[a.category,a.stage,a.cp.join('-'),a.me.join('-'),a.ca.join('-'),a.p.join('-')]),['Category','Stage','CP%','ME kcal/kg','Ca%','P%'])},
  ];

  return h('div',{style:{padding:'0 26px 26px'}},
    toast&&h(Toast,{msg:toast.msg,type:toast.type}),
    h(PageHdr,{title:'Resources',subtitle:'Export data to CSV, print PDF reports'}),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:14}},
      exports.map((ex,i)=>h(Card,{key:i,style:{marginBottom:0}},
        h('div',{style:{padding:'14px 16px'}},
          h('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:10}},
            h('span',{style:{fontSize:24}},ex.icon),
            h('div',null,
              h('div',{style:{fontWeight:700,color:C.earth,fontSize:14}},ex.title),
              h('div',{style:{fontSize:12,color:C.muted}},ex.desc))),
          h('div',{style:{display:'flex',gap:8}},
            h(Btn,{onClick:ex.onCSV,size:'sm',variant:'secondary'},(' Export CSV'),
            h(Btn,{onClick:ex.onPrint,size:'sm',variant:'secondary'},(' Print PDF')))))));
}


export default function Pages({ page, setPage, user, onLogin, onLogout, sidebarOpen, setSidebarOpen }) {
  const ctx = useContext(Ctx);
  const animalReqs = ctx?.animalReqs;

  if (!user) return h(LoginPage, { onLogin });

  const pageMap = {
    dashboard:     ()=>h(DashboardPage, null),
    formulator:    ()=>h(FormulatorPage, null),
    inventory:     ()=>h(InventoryPage, null),
    customers:     ()=>h(CustomersPage, null),
    sales:         ()=>h(SalesPage, null),
    reports:       ()=>h(ReportsPage, null),
    feeding_guide: ()=>h(FeedingGuidePage, null),
    education:     ()=>h(EducationPage, null),
    resources:     ()=>h(ResourcesPage, null),
    traceability:  ()=>user.role==='admin'?h(TraceabilityPage,null):h(DashboardPage,null),
    ingredients:   ()=>user.role === "admin" ? h(IngredientsPage, null) : h(DashboardPage, null),
    nutrition:     ()=>user.role === "admin" ? h(NutritionPage, null)   : h(DashboardPage, null),
    users:         ()=>user.role === "admin" ? h(UsersPage, { currentUser: user }) : h(DashboardPage, null),
  };

  return h("div", { style: { display:"flex", minHeight:"100vh", background:"#f8f5ee" } },
    h("div", { className:"wm-mobile-bar" },
      h("button", {
        onClick: () => setSidebarOpen(true),
        style: { background:"none", border:"none", cursor:"pointer", color:"white", fontSize:22, lineHeight:1, padding:"4px 8px" }
      }, ""),
      h("div", { style: { fontFamily:"Playfair Display, serif", color:"white", fontWeight:700, fontSize:16 } }, "Wa-Mifugo"),
      h("div", { style: { marginLeft:"auto", fontSize:11, color:"rgba(255,255,255,0.6)" } }, user.name)),
    h("div", { className:"wm-overlay", onClick: () => setSidebarOpen(false) }),
    h(Sidebar, { page, setPage, user, onLogout, isOpen: sidebarOpen, onClose: () => setSidebarOpen(false) }),
    h("div", { className:"wm-main", style: { flex:1, overflow:"auto", paddingTop:20 } },
      (pageMap[page] || pageMap.dashboard)()));
}
