// ── CONSTANTS & SEED DATA ────────────────────────────────────────────────────
// Wa-Mifugo Feeds Management System
// Nutritional data: NRC 2012, Evonik Amino Dat, ILRI East Africa

const SEED_USERS=[{id:'u1',name:'Admin',username:'admin',password:'admin123',
  email:'admin@wamifugo.co.ke',role:'admin',active:true,created:'2024-01-01'}];

const NUTRIENT_DEFS=[
  {key:'cp',   label:'Crude Protein',    unit:'%',      icon:'🥩', desc:'Essential for muscle, eggs, milk production'},
  {key:'me',   label:'Metab. Energy',    unit:'kcal/kg',icon:'⚡', desc:'Energy available for body functions and growth'},
  {key:'fat',  label:'Crude Fat',        unit:'%',      icon:'🧈', desc:'Energy density and fat-soluble vitamins'},
  {key:'fibre',label:'Crude Fibre',      unit:'%',      icon:'🌿', desc:'Gut health, rumen function in ruminants'},
  {key:'ca',   label:'Calcium',          unit:'%',      icon:'🦴', desc:'Bones, eggshell quality, milk production'},
  {key:'p',    label:'Phosphorus',       unit:'%',      icon:'🔬', desc:'Bone mineralisation, energy metabolism'},
  {key:'lys',  label:'Lysine',           unit:'%',      icon:'💊', desc:'First limiting amino acid in most feeds'},
  {key:'met',  label:'Methionine',       unit:'%',      icon:'💊', desc:'Feathering, growth, egg production'},
];

const SEED_ANIMAL_REQS=[
  {id:'ar1', category:'Poultry (Broiler)', stage:'Starter (0-21 days)',    cp:[22,24],me:[3000,3200],fat:[4,8],fibre:[0,5], ca:[0.9,1.1], p:[0.45,0.60],lys:[1.20,1.50],met:[0.50,0.65]},
  {id:'ar2', category:'Poultry (Broiler)', stage:'Grower (22-35 days)',    cp:[20,22],me:[3100,3300],fat:[4,8],fibre:[0,5], ca:[0.85,1.05],p:[0.42,0.55],lys:[1.05,1.30],met:[0.45,0.60]},
  {id:'ar3', category:'Poultry (Broiler)', stage:'Finisher (36+ days)',    cp:[18,20],me:[3150,3350],fat:[4,8],fibre:[0,5], ca:[0.80,1.00],p:[0.38,0.50],lys:[0.95,1.20],met:[0.40,0.55]},
  {id:'ar4', category:'Poultry (Layer)',   stage:'Chick Starter (0-8 wks)',cp:[20,22],me:[2850,3050],fat:[3,7],fibre:[0,6], ca:[0.9,1.1], p:[0.42,0.55],lys:[0.90,1.10],met:[0.40,0.55]},
  {id:'ar5', category:'Poultry (Layer)',   stage:'Grower (8-16 wks)',      cp:[16,18],me:[2700,2900],fat:[3,7],fibre:[0,7], ca:[0.9,1.1], p:[0.38,0.50],lys:[0.75,0.95],met:[0.35,0.48]},
  {id:'ar6', category:'Poultry (Layer)',   stage:'Pre-lay (16-20 wks)',    cp:[18,20],me:[2750,2950],fat:[3,7],fibre:[0,7], ca:[2.0,2.5], p:[0.40,0.55],lys:[0.85,1.05],met:[0.38,0.50]},
  {id:'ar7', category:'Poultry (Layer)',   stage:'In Production (20+ wks)',cp:[15,18],me:[2700,2900],fat:[3,7],fibre:[0,7], ca:[3.5,4.5], p:[0.35,0.45],lys:[0.75,0.90],met:[0.35,0.45]},
  {id:'ar8', category:'Dairy Cattle',      stage:'Calf (0-3 months)',      cp:[22,25],me:[2800,3100],fat:[5,10],fibre:[5,15], ca:[0.8,1.2], p:[0.55,0.75],lys:[1.20,1.60],met:[0.42,0.58]},
  {id:'ar9', category:'Dairy Cattle',      stage:'Heifer (3-12 months)',   cp:[16,18],me:[2400,2700],fat:[3,7], fibre:[12,20],ca:[0.5,0.75],p:[0.38,0.52],lys:[0.70,0.95],met:[0.25,0.38]},
  {id:'ar10',category:'Dairy Cattle',      stage:'Dry Cow',                cp:[12,14],me:[1800,2400],fat:[2,6], fibre:[20,35],ca:[0.4,0.6], p:[0.30,0.45],lys:[0.50,0.70],met:[0.18,0.28]},
  {id:'ar11',category:'Dairy Cattle',      stage:'Lactating (High Prod.)', cp:[16,18],me:[2600,2900],fat:[3,7], fibre:[15,25],ca:[0.7,1.0], p:[0.45,0.65],lys:[0.75,1.00],met:[0.28,0.42]},
  {id:'ar12',category:'Beef Cattle',       stage:'Weaner (3-6 months)',    cp:[16,18],me:[2400,2700],fat:[3,7], fibre:[10,18],ca:[0.5,0.75],p:[0.38,0.52],lys:[0.65,0.85],met:[0.22,0.35]},
  {id:'ar13',category:'Beef Cattle',       stage:'Grower (6-12 months)',   cp:[12,14],me:[2400,2700],fat:[3,7], fibre:[15,25],ca:[0.35,0.55],p:[0.25,0.40],lys:[0.55,0.72],met:[0.18,0.28]},
  {id:'ar14',category:'Beef Cattle',       stage:'Finisher (12+ months)',  cp:[11,13],me:[2700,3000],fat:[3,7], fibre:[10,20],ca:[0.3,0.5], p:[0.22,0.35],lys:[0.45,0.62],met:[0.15,0.25]},
  {id:'ar15',category:'Swine',             stage:'Starter (<25 kg)',       cp:[20,22],me:[3200,3400],fat:[3,7], fibre:[0,5], ca:[0.8,1.0], p:[0.65,0.80],lys:[1.30,1.55],met:[0.40,0.55]},
  {id:'ar16',category:'Swine',             stage:'Grower (25-60 kg)',      cp:[16,18],me:[3100,3300],fat:[3,7], fibre:[0,6], ca:[0.65,0.85],p:[0.55,0.70],lys:[0.95,1.20],met:[0.30,0.45]},
  {id:'ar17',category:'Swine',             stage:'Finisher (>60 kg)',      cp:[14,16],me:[3100,3300],fat:[3,7], fibre:[0,7], ca:[0.55,0.75],p:[0.48,0.60],lys:[0.75,0.95],met:[0.25,0.38]},
  {id:'ar18',category:'Swine',             stage:'Lactating Sow',          cp:[18,20],me:[3050,3250],fat:[4,8], fibre:[0,8], ca:[0.8,1.0], p:[0.65,0.80],lys:[0.95,1.20],met:[0.30,0.45]},
  {id:'ar19',category:'Rabbit',            stage:'Grower (4-12 weeks)',    cp:[16,18],me:[2500,2700],fat:[2,5], fibre:[10,16],ca:[0.5,0.8], p:[0.35,0.50],lys:[0.65,0.85],met:[0.25,0.38]},
  {id:'ar20',category:'Rabbit',            stage:'Lactating Doe',          cp:[17,19],me:[2600,2800],fat:[3,6], fibre:[10,14],ca:[0.8,1.1], p:[0.50,0.65],lys:[0.75,0.95],met:[0.30,0.42]},
  {id:'ar21',category:'Rabbit',            stage:'Maintenance Adult',      cp:[14,16],me:[2200,2500],fat:[2,4], fibre:[14,20],ca:[0.5,0.7], p:[0.30,0.45],lys:[0.55,0.72],met:[0.22,0.32]},
  {id:'ar22',category:'Fish (Tilapia)',     stage:'Fry (<5 g)',             cp:[45,50],me:[3200,3500],fat:[6,10],fibre:[0,3], ca:[1.5,2.5], p:[1.2,1.8], lys:[2.5,3.2], met:[0.9,1.3]},
  {id:'ar23',category:'Fish (Tilapia)',     stage:'Fingerling (5-50 g)',    cp:[38,42],me:[3000,3300],fat:[6,10],fibre:[0,5], ca:[1.2,2.0], p:[1.0,1.5], lys:[2.0,2.6], met:[0.72,1.1]},
  {id:'ar24',category:'Fish (Tilapia)',     stage:'Grow-out (>50 g)',       cp:[28,32],me:[2800,3100],fat:[5,9], fibre:[0,7], ca:[1.0,1.5], p:[0.8,1.2], lys:[1.5,2.0], met:[0.55,0.85]},
  // Kienyeji and Goat retained from existing system
  {id:'ar25',category:'Poultry (Kienyeji)',stage:'Chick (0-6 wks)',        cp:[20,22],me:[2800,3000],fat:[3,7], fibre:[0,6], ca:[0.9,1.0], p:[0.40,0.50],lys:[0.85,1.05],met:[0.38,0.50]},
  {id:'ar26',category:'Poultry (Kienyeji)',stage:'Grower (6-14 wks)',      cp:[16,18],me:[2600,2800],fat:[3,7], fibre:[0,8], ca:[0.8,1.0], p:[0.35,0.45],lys:[0.70,0.90],met:[0.30,0.42]},
  {id:'ar27',category:'Poultry (Kienyeji)',stage:'Finisher (14+ wks)',     cp:[14,17],me:[2600,2800],fat:[3,7], fibre:[0,8], ca:[0.8,0.9], p:[0.32,0.42],lys:[0.60,0.80],met:[0.28,0.40]},
  {id:'ar28',category:'Goat / Sheep',      stage:'Kid (0-3 months)',       cp:[16,18],me:[2600,2900],fat:[3,7], fibre:[5,18], ca:[0.7,1.0], p:[0.40,0.55],lys:[0.60,0.80],met:[0.20,0.32]},
  {id:'ar29',category:'Goat / Sheep',      stage:'Grower (3-12 months)',   cp:[14,16],me:[2300,2600],fat:[2,6], fibre:[10,25],ca:[0.5,0.8], p:[0.30,0.45],lys:[0.50,0.68],met:[0.16,0.26]},
  {id:'ar30',category:'Goat / Sheep',      stage:'Lactating Doe',          cp:[16,18],me:[2500,2800],fat:[2,6], fibre:[8,20], ca:[0.6,0.9], p:[0.35,0.50],lys:[0.60,0.80],met:[0.20,0.32]},
];

const SEED_INGREDIENT_PROFILES=[
  {id:'maize_grain',        name:'Maize Grain',              category:'energy',  cp:8.5, me:3300,fat:3.8, fibre:2.5, ca:0.03,p:0.28,lys:0.24,met:0.18,moisture:12, minIncl:0, maxIncl:70},
  {id:'soybean_meal',       name:'Soybean Meal (44% CP)',    category:'protein', cp:44,  me:2230,fat:1.5, fibre:7,   ca:0.3, p:0.65,lys:2.9, met:0.62,moisture:12, minIncl:0, maxIncl:35},
  {id:'wheat_bran',         name:'Wheat Bran',               category:'energy',  cp:16,  me:1590,fat:4,   fibre:11,  ca:0.14,p:1.0, lys:0.64,met:0.24,moisture:12, minIncl:0, maxIncl:20},
  {id:'fish_meal',          name:'Fish Meal (65% CP)',        category:'protein', cp:65,  me:2820,fat:8,   fibre:1,   ca:5.2, p:3.2, lys:4.8, met:1.8, moisture:10, minIncl:0, maxIncl:10},
  {id:'sunflower_cake',     name:'Sunflower Cake',           category:'protein', cp:28,  me:1680,fat:2.5, fibre:22,  ca:0.35,p:0.9, lys:0.95,met:0.61,moisture:12, minIncl:0, maxIncl:20},
  {id:'cottonseed_cake',    name:'Cottonseed Cake',          category:'protein', cp:36,  me:1980,fat:3,   fibre:14,  ca:0.22,p:1.0, lys:1.5, met:0.56,moisture:12, minIncl:0, maxIncl:15},
  {id:'limestone',          name:'Limestone / Lime',         category:'mineral', cp:0,   me:0,   fat:0,   fibre:0,   ca:38,  p:0.02,lys:0,   met:0,   moisture:0,  minIncl:0, maxIncl:5},
  {id:'dcp',                name:'Dicalcium Phosphate',      category:'mineral', cp:0,   me:0,   fat:0,   fibre:0,   ca:22,  p:18,  lys:0,   met:0,   moisture:0,  minIncl:0, maxIncl:3},
  {id:'salt',               name:'Salt (NaCl)',               category:'mineral', cp:0,   me:0,   fat:0,   fibre:0,   ca:0,   p:0,   lys:0,   met:0,   moisture:0,  minIncl:0, maxIncl:0.5},
  {id:'premix',             name:'Vit/Min Premix',           category:'additive',cp:0,   me:0,   fat:0,   fibre:0,   ca:0,   p:0,   lys:0,   met:0,   moisture:0,  minIncl:0.25,maxIncl:0.5},
  {id:'dl_methionine',      name:'DL-Methionine',            category:'additive',cp:0,   me:0,   fat:0,   fibre:0,   ca:0,   p:0,   lys:0,   met:99,  moisture:0,  minIncl:0, maxIncl:0.5},
  {id:'l_lysine',           name:'L-Lysine HCl (98.5%)',     category:'additive',cp:0,   me:0,   fat:0,   fibre:0,   ca:0,   p:0,   lys:78,  met:0,   moisture:0,  minIncl:0, maxIncl:0.5},
  {id:'sorghum_grain',      name:'Sorghum Grain',            category:'energy',  cp:10,  me:3280,fat:3.2, fibre:2.6, ca:0.03,p:0.35,lys:0.22,met:0.17,moisture:12, minIncl:0, maxIncl:40},
  {id:'cassava_meal',       name:'Cassava Meal',             category:'energy',  cp:2.5, me:3200,fat:0.5, fibre:3,   ca:0.1, p:0.08,lys:0.07,met:0.04,moisture:12, minIncl:0, maxIncl:20},
  {id:'sunflower_oil',      name:'Sunflower Oil',            category:'energy',  cp:0,   me:8800,fat:99,  fibre:0,   ca:0,   p:0,   lys:0,   met:0,   moisture:0,  minIncl:0, maxIncl:5},
  {id:'rice_bran',          name:'Rice Bran',                category:'energy',  cp:12,  me:2685,fat:13,  fibre:13,  ca:0.08,p:1.8, lys:0.56,met:0.24,moisture:12, minIncl:0, maxIncl:15},
  {id:'blood_meal',         name:'Blood Meal (Ring-dried)',  category:'protein', cp:80,  me:2790,fat:1.5, fibre:1.5, ca:0.3, p:0.26,lys:6.6, met:1.0, moisture:10, minIncl:0, maxIncl:5},
  {id:'urea',               name:'Urea (Feed Grade)',        category:'additive',cp:287, me:0,   fat:0,   fibre:0,   ca:0,   p:0,   lys:0,   met:0,   moisture:0,  minIncl:0, maxIncl:1},
  {id:'molasses',           name:'Molasses',                 category:'energy',  cp:4,   me:2460,fat:0.2, fibre:0.5, ca:0.7, p:0.1, lys:0.17,met:0.08,moisture:25, minIncl:0, maxIncl:5},
  {id:'wheat_grain',        name:'Wheat Grain',              category:'energy',  cp:12,  me:3080,fat:1.8, fibre:3,   ca:0.05,p:0.35,lys:0.38,met:0.2, moisture:12, minIncl:0, maxIncl:40},
  // Retained from existing system
  {id:'maize',              name:'Maize (generic)',          category:'energy',  cp:8.5, me:3300,fat:3.8, fibre:2.5, ca:0.03,p:0.28,lys:0.24,met:0.18,moisture:12, minIncl:0, maxIncl:70},
  {id:'soya_cake',          name:'Soya Cake',                category:'protein', cp:44,  me:2230,fat:1.5, fibre:7,   ca:0.3, p:0.65,lys:2.9, met:0.62,moisture:12, minIncl:0, maxIncl:35},
  {id:'omena',              name:'Omena (Dagaa)',            category:'protein', cp:55,  me:2880,fat:8,   fibre:1,   ca:5.1, p:2.8, lys:4.2, met:1.5, moisture:10, minIncl:0, maxIncl:15},
];

const CATEGORY_META=[
  {key:'energy',  label:'Energy Sources',     icon:'⚡',color:'#b87820',bg:'#fffbf0',border:'#f5d87e'},
  {key:'protein', label:'Protein Sources',     icon:'💪',color:'#a03010',bg:'#fff5f0',border:'#f0a070'},
  {key:'roughage',label:'Roughage / Fibre',    icon:'🌿',color:'#2e6645',bg:'#f0f9f4',border:'#80c898'},
  {key:'mineral', label:'Minerals',            icon:'🪨',color:'#3a5888',bg:'#f0f4ff',border:'#9ab0d8'},
  {key:'vitamin', label:'Vitamins & Additives',icon:'🧬',color:'#7040a0',bg:'#faf0ff',border:'#c890e0'},
];

const CATEGORY_ICONS={
  'Poultry (Broiler)':'🐔','Poultry (Layer)':'🥚','Poultry (Kienyeji)':'🐓',
  'Dairy Cattle':'🐄','Beef Cattle':'🐂','Swine':'🐷','Rabbit':'🐰',
  'Goat / Sheep':'🐐','Fish (Tilapia)':'🐟','Fish (Catfish)':'🐠',
};

const FEEDING_QTY={
  poultry_broiler:{'Starter (0–2 wks)':{qty:'10–25 g/bird/day',water:'2× feed weight',meals:'Ad libitum',notes:'Chick crumbs. 2.5cm feeder space per bird.'},'Grower (2–4 wks)':{qty:'40–80 g/bird/day',water:'2× feed weight',meals:'Ad libitum',notes:'Pellets or mash. Reduce brooding heat.'},'Finisher (4–6 wks)':{qty:'100–150 g/bird/day',water:'2× feed weight',meals:'Ad libitum',notes:'Target 2kg liveweight at 6 weeks.'}},
  poultry_layer:{'Chick (0–8 wks)':{qty:'10–40 g/bird/day',water:'150ml/bird/day',meals:'Ad libitum',notes:'Chick crumbs. 32°C brooding week 1.'},'Grower (8–18 wks)':{qty:'50–80 g/bird/day',water:'200ml/bird/day',meals:'2×/day',notes:'Restrict feed to control body weight.'},'Layer (18+ wks)':{qty:'110–120 g/bird/day',water:'250ml/bird/day',meals:'2×/day',notes:'16hrs light for peak production.'}},
  dairy_cow:{'Early Lactation':{qty:'1kg concentrate per 2–2.5L milk above 4L baseline',water:'50–80L/day',meals:'2×/day',notes:'Peak demand at weeks 6–8 post-calving.'},'Mid Lactation':{qty:'1kg per 3L milk',water:'40–60L/day',meals:'2×/day',notes:'BCS target 2.5–3.0.'},'Dry Cow':{qty:'2–3 kg conc/day',water:'30–40L/day',meals:'1×/day',notes:'Limit energy to prevent fat cow syndrome.'},'Calf (0–3 mo)':{qty:'1–2 kg conc/day + milk',water:'5–10L/day',meals:'3×/day',notes:'Starter from day 7. Wean at 8 weeks.'}},
  pig:{'Grower (8–18 wks)':{qty:'1.5–2.2 kg/day',water:'4–6L/day',meals:'2×/day',notes:'Target FCR 2.5–3.0. Weigh weekly.'},'Finisher (18–24 wks)':{qty:'2.5–3.0 kg/day',water:'6–8L/day',meals:'2×/day',notes:'Target 90–110 kg at slaughter.'},'Lactating Sow':{qty:'5–7 kg/day',water:'15–20L/day',meals:'3×/day',notes:'Feed to appetite.'}},
  rabbit:{'Weaner (4–8 wks)':{qty:'80–120g pellets + fresh greens',water:'200ml/day',meals:'2×/day',notes:'Introduce greens gradually.'},'Grower (8–16 wks)':{qty:'120–150g pellets + 200g greens',water:'300ml/day',meals:'2×/day',notes:'Lucerne + pellets. Fibre >12%.'},'Lactating Doe':{qty:'200–300g pellets + 500g greens',water:'500ml/day',meals:'Ad libitum',notes:'6–8 kittens per litter typical.'}},
  goat:{'Kid (0–3 mo)':{qty:'100–200g conc/day + milk',water:'0.5L/day',meals:'3×/day',notes:'Creep feed from week 2. Wean at 8–10 wks.'},'Grower (3–9 mo)':{qty:'0.2–0.5 kg conc + browse',water:'2–3L/day',meals:'2×/day',notes:'Allow 2–3hrs browsing per day.'},'Lactating':{qty:'0.5–1 kg conc + browse/hay',water:'4–5L/day',meals:'2×/day',notes:'1kg conc per 2L milk.'}},
  fish_tilapia:{'Fry (0–4 wks)':{qty:'5% body weight/day',water:'DO >5mg/L',meals:'4–6×/day',notes:'0.5mm crumble.'},'Fingerling (4–12 wks)':{qty:'3–5% body weight/day',water:'Temp 26–30°C',meals:'3×/day',notes:'1–2mm pellet.'},'Growout (20+ wks)':{qty:'1.5–2% body weight/day',water:'pH 6.5–8.5',meals:'2×/day',notes:'3–5mm floating pellets. Harvest at 250–500g.'}},
  fish_catfish:{'Fry (0–4 wks)':{qty:'5–8% body weight/day',water:'DO >5mg/L',meals:'5×/day evening',notes:'Nocturnal — feed heavier in evening.'},'Growout (12+ wks)':{qty:'2–3% body weight/day',water:'Temp 24–30°C',meals:'1–2×/day evening',notes:'Monitor — do not overfeed.'}},
  beef_cattle:{'Calf (0–6 mo)':{qty:'Creep feed free choice',water:'5L/day',meals:'Ad libitum',notes:'Start creep at 2 weeks.'},'Weaner (6–12 mo)':{qty:'1–2 kg conc + roughage',water:'15L/day',meals:'2×/day',notes:'Transition to roughage-based diet.'},'Finishing (18–24 mo)':{qty:'3–4 kg conc/day + roughage',water:'30L/day',meals:'2×/day',notes:'Increase energy for finishing.'}},
};

const TIPS=[
  {id:'t1',cat:'nutrition',icon:'🥗',tag:'Nutrition',title:'Feed the Rumen First',body:'For cattle and goats, always provide roughage (Napier, hay) BEFORE concentrate. This stimulates rumen contractions and prevents acidosis. A healthy rumen feels like a full sponge on the left flank.'},
  {id:'t2',cat:'cost',icon:'💰',tag:'Cost Saving',title:'Buy Ingredients in Season',body:'Purchase maize during Oct–Dec harvest peak when prices drop 20–30%. Store in hermetic PICS bags. Omena from Kisumu lakeside markets is 30% cheaper than urban agrovets when bought in 90kg bags.'},
  {id:'t3',cat:'storage',icon:'🏚️',tag:'Storage',title:'Prevent Aflatoxin Losses',body:'Store maize below 13% moisture. Use hermetic bags on pallets. Mixed feeds last only 4 weeks — label with mixing date. Signs: yellow-green mould, musty smell, birds going off feed.'},
  {id:'t4',cat:'water',icon:'💧',tag:'Water',title:'Water Is the #1 Nutrient',body:'Broilers need 2× water vs feed weight. Dairy cows need 4–5L per litre of milk + 30L baseline. Clean drinkers daily — biofilm reduces intake by 20%.'},
  {id:'t5',cat:'health',icon:'🩺',tag:'Health',title:'Deworm Every 3 Months',body:'Internal parasites steal nutrition directly from the gut. Use Albendazole or Levamisole, rotating drugs to prevent resistance. Vaccinate poultry against Newcastle Disease every 3 months (Lasota strain).'},
  {id:'t6',cat:'nutrition',icon:'⚖️',tag:'Nutrition',title:'Pearson Square Quick Check',body:'Write target CP% in centre of a square. Energy CP% top-left, Protein CP% bottom-left. Subtract diagonally for inclusion ratios. E.g. Target 20%: Maize 8.5%, Soya 44% → 67.6% maize, 32.4% soya.'},
  {id:'t7',cat:'seasons',icon:'🌦️',tag:'Seasons',title:'Make Silage During Long Rains',body:'Cut Napier at 6–8 weeks, wilt 2–4 hours, compact in layers with polythene seal. Add 2–3% molasses. Good silage smells like vinegar/yoghurt. Ready in 3–4 weeks, lasts 12+ months.'},
  {id:'t8',cat:'cost',icon:'🌾',tag:'Cost Saving',title:'Grow On-Farm Protein',body:'Plant Desmodium between Napier (push-pull, fixes nitrogen, 20–24% CP). Sunflower: quarter-acre yields enough cake for 50 layers for 3 months. Black Soldier Fly larvae have 40–44% CP.'},
  {id:'t9',cat:'records',icon:'📒',tag:'Records',title:'Track Feed Conversion Ratio',body:'FCR = kg feed ÷ kg liveweight gain. Targets: Broilers 1.8–2.2, Dairy 3–4 kg DM per litre milk. Calculate cost per unit output weekly. Rising costs signal disease or poor feed quality.'},
  {id:'t10',cat:'health',icon:'🥚',tag:'Health',title:'Layer Calcium Timing Matters',body:'Hens form eggshells overnight. Provide oyster shell as free-choice grit in the afternoon. 4g calcium per hen per day. Ensure 16 hours light for peak production (90%+).'},
  {id:'t11',cat:'nutrition',icon:'🐟',tag:'Nutrition',title:'Never Overfeed Fish',body:'Feed only what fish consume in 5–10 minutes. Uneaten feed causes ammonia spikes that kill fish. Tilapia: feed 2–3× daily. Catfish: nocturnal — feed evenings. Reduce feeding 50% when water <20°C.'},
  {id:'t12',cat:'seasons',icon:'🌿',tag:'Seasons',title:'Wet Season Bloat Risk',body:'Lush young grass is high in water — cattle may look full but be underfed. Supplement with dry hay. Always provide hay before turning animals onto legume pasture (Desmodium, Lucerne) to prevent bloat.'},
];

const SPECIES_RECS={
  poultry_broiler:{required:['maize','soya_cake','dcp','limestone','salt','premix'],recommended:['omena','wheat_bran','blood_meal'],avoid:['urea','napier','lucerne'],note:'Avoid gossypol >5%. Urea is TOXIC to poultry.'},
  poultry_layer:{required:['maize','soya_cake','limestone','dcp','salt','premix'],recommended:['sunflower_cake','wheat_bran','omena'],avoid:['urea','cotton_cake'],note:'Ca must be 3.5–4% for shell quality. Avoid urea entirely.'},
  poultry_kienyeji:{required:['maize','soya_cake','limestone','salt','premix'],recommended:['omena','wheat_bran','sorghum'],avoid:['urea'],note:'Indigenous breeds tolerate higher fibre than commercial breeds.'},
  dairy_cow:{required:['maize','wheat_bran','dcp','limestone','salt','premix'],recommended:['cotton_cake','sunflower_cake','molasses','urea','napier'],avoid:[],note:'Urea safe ≤1% DM. Mix urea with molasses. Gossypol safe for adult cattle.'},
  beef_cattle:{required:['maize','wheat_bran','salt','dcp'],recommended:['molasses','urea','napier','lucerne','cotton_cake'],avoid:[],note:'Urea safe for ruminants. Introduce slowly over 14 days.'},
  pig:{required:['maize','soya_cake','dcp','limestone','salt','premix'],recommended:['wheat_bran','blood_meal','maize_germ'],avoid:['urea','cotton_cake','napier','lucerne'],note:'Pigs cannot use NPN (urea). Gossypol toxic. High fibre reduces digestibility.'},
  rabbit:{required:['wheat_bran','lucerne','salt','dcp','premix'],recommended:['soya_cake','sunflower_cake','napier','maize'],avoid:['urea','blood_meal'],note:'Rabbits need high fibre 12–18% for gut health. Avoid urea and high-fat ingredients.'},
  goat:{required:['maize','salt','dcp','premix'],recommended:['lucerne','napier','molasses','cotton_cake','wheat_bran'],avoid:[],note:'Goats tolerate tannins well. Urea safe for adults only.'},
  fish_tilapia:{required:['soya_cake','omena','dcp','salt','premix'],recommended:['maize','rice_bran','blood_meal','meat_bone'],avoid:['urea','napier','lucerne','cotton_cake'],note:'Gossypol toxic to fish. Urea unusable. Plant diets need phytase enzyme.'},
  fish_catfish:{required:['omena','blood_meal','soya_cake','dcp','salt','premix'],recommended:['maize','meat_bone','rice_bran'],avoid:['urea','napier','lucerne','cotton_cake'],note:'High-protein carnivores. Min 35% CP. Gossypol and urea harmful.'},
};


// Helper functions
export function getAnimalReqs(stored) {
  return stored && stored.length > 0 ? stored : SEED_ANIMAL_REQS;
}

export function getAnimalCategories(reqs) {
  return [...new Set(reqs.map(r => r.category))];
}

export function getStagesForCategory(reqs, category) {
  return reqs.filter(r => r.category === category).map(r => r.stage);
}

export function getReqForStage(reqs, category, stage) {
  return reqs.find(r => r.category === category && r.stage === stage) || null;
}

export function buildSpeciesList(reqs) {
  const cats = getAnimalCategories(reqs);
  return cats.map(cat => ({ value: cat, label: cat, icon: CATEGORY_ICONS[cat] || '🐾' }));
}

export {
  SEED_USERS, NUTRIENT_DEFS, SEED_ANIMAL_REQS, SEED_INGREDIENT_PROFILES,
  CATEGORY_META, CATEGORY_ICONS, FEEDING_QTY, TIPS, SPECIES_RECS
};
