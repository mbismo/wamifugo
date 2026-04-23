// ── CONSTANTS & SEED DATA ─────────────────────────────────────────────────────
// Wa-Mifugo Feeds Management System
// Nutritional data: NRC 2012, Evonik Amino Dat, ILRI East Africa

export const SEED_USERS = [{
  id: 'u1', name: 'Admin', username: 'admin', password: 'admin123',
  email: 'admin@wamifugo.co.ke', role: 'admin', active: true,
  created: '2024-01-01'
}];

export const NUTRIENT_DEFS = [
  {key:'cp',    label:'Crude Protein',      unit:'%',       icon:'🥩', desc:'Essential for muscle, eggs, milk'},
  {key:'me',    label:'Metab. Energy',       unit:'kcal/kg', icon:'⚡', desc:'Energy for body functions and growth'},
  {key:'fat',   label:'Crude Fat',           unit:'%',       icon:'🧈', desc:'Energy density and fat-soluble vitamins'},
  {key:'fibre', label:'Crude Fibre',         unit:'%',       icon:'🌿', desc:'Gut health, rumen function'},
  {key:'ca',    label:'Calcium',             unit:'%',       icon:'🦴', desc:'Bones, eggshell, milk production'},
  {key:'p',     label:'Phosphorus',          unit:'%',       icon:'🔬', desc:'Bone mineralisation, energy metabolism'},
  {key:'lys',   label:'Lysine',              unit:'%',       icon:'💊', desc:'First limiting amino acid'},
  {key:'met',   label:'Methionine',          unit:'%',       icon:'💊', desc:'Feathering, growth, egg production'},
];

export const CATEGORY_ICONS = {
  'Poultry (Broiler)':'🐔','Poultry (Layer)':'🥚','Poultry (Kienyeji)':'🐓',
  'Dairy Cattle':'🐄','Beef Cattle':'🐂','Swine':'🐷','Rabbit':'🐰',
  'Goat / Sheep':'🐐','Fish (Tilapia)':'🐟','Fish (Catfish)':'🐠',
};

export const CATEGORY_META = [
  {key:'energy',  label:'Energy Sources',   color:'#C9922A', icon:'⚡'},
  {key:'protein', label:'Protein Sources',  color:'#4A7C59', icon:'🥩'},
  {key:'mineral', label:'Minerals',         color:'#8B5E3C', icon:'🦴'},
  {key:'additive',label:'Additives',        color:'#5C3D2E', icon:'💊'},
];

export const SEED_INGREDIENT_PROFILES = [
  {
    "id": "ing_1",
    "name": "Maize Grain",
    "price": 45.0,
    "cp": 8.5,
    "me": 3300.0,
    "fat": 3.8,
    "fibre": 2.5,
    "ca": 0.03,
    "p": 0.28,
    "lys": 0.24,
    "met": 0.18,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 70.0,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_2",
    "name": "Soybean Meal (44% CP)",
    "price": 90.0,
    "cp": 44.0,
    "me": 2230.0,
    "fat": 1.5,
    "fibre": 7.0,
    "ca": 0.3,
    "p": 0.65,
    "lys": 2.9,
    "met": 0.62,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 35.0,
    "category": "protein",
    "unit": "kg"
  },
  {
    "id": "ing_3",
    "name": "Wheat Bran",
    "price": 25.0,
    "cp": 16.0,
    "me": 1590.0,
    "fat": 4.0,
    "fibre": 11.0,
    "ca": 0.14,
    "p": 1.0,
    "lys": 0.64,
    "met": 0.24,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 20.0,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_4",
    "name": "Fish Meal (65% CP)",
    "price": 200.0,
    "cp": 65.0,
    "me": 2820.0,
    "fat": 8.0,
    "fibre": 1.0,
    "ca": 5.2,
    "p": 3.2,
    "lys": 4.8,
    "met": 1.8,
    "moisture": 10.0,
    "minIncl": 0.0,
    "maxIncl": 10.0,
    "category": "protein",
    "unit": "kg"
  },
  {
    "id": "ing_5",
    "name": "Sunflower Cake",
    "price": 55.0,
    "cp": 28.0,
    "me": 1680.0,
    "fat": 2.5,
    "fibre": 22.0,
    "ca": 0.35,
    "p": 0.9,
    "lys": 0.95,
    "met": 0.61,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 20.0,
    "category": "protein",
    "unit": "kg"
  },
  {
    "id": "ing_6",
    "name": "Cottonseed Cake",
    "price": 40.0,
    "cp": 36.0,
    "me": 1980.0,
    "fat": 3.0,
    "fibre": 14.0,
    "ca": 0.22,
    "p": 1.0,
    "lys": 1.5,
    "met": 0.56,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 15.0,
    "category": "protein",
    "unit": "kg"
  },
  {
    "id": "ing_7",
    "name": "Limestone / Lime",
    "price": 8.0,
    "cp": 0.0,
    "me": 0.0,
    "fat": 0.0,
    "fibre": 0.0,
    "ca": 38.0,
    "p": 0.02,
    "lys": 0.0,
    "met": 0.0,
    "moisture": 0.0,
    "minIncl": 0.0,
    "maxIncl": 5.0,
    "category": "mineral",
    "unit": "kg"
  },
  {
    "id": "ing_8",
    "name": "Dicalcium Phosphate",
    "price": 120.0,
    "cp": 0.0,
    "me": 0.0,
    "fat": 0.0,
    "fibre": 0.0,
    "ca": 22.0,
    "p": 18.0,
    "lys": 0.0,
    "met": 0.0,
    "moisture": 0.0,
    "minIncl": 0.0,
    "maxIncl": 3.0,
    "category": "mineral",
    "unit": "kg"
  },
  {
    "id": "ing_9",
    "name": "Salt (NaCl)",
    "price": 15.0,
    "cp": 0.0,
    "me": 0.0,
    "fat": 0.0,
    "fibre": 0.0,
    "ca": 0.0,
    "p": 0.0,
    "lys": 0.0,
    "met": 0.0,
    "moisture": 0.0,
    "minIncl": 0.0,
    "maxIncl": 0.5,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_10",
    "name": "Vit/Min Premix (Poultry)",
    "price": 350.0,
    "cp": 0.0,
    "me": 0.0,
    "fat": 0.0,
    "fibre": 0.0,
    "ca": 0.0,
    "p": 0.0,
    "lys": 0.0,
    "met": 0.0,
    "moisture": 0.0,
    "minIncl": 0.25,
    "maxIncl": 0.5,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_11",
    "name": "DL-Methionine",
    "price": 1800.0,
    "cp": 0.0,
    "me": 0.0,
    "fat": 0.0,
    "fibre": 0.0,
    "ca": 0.0,
    "p": 0.0,
    "lys": 0.0,
    "met": 99.0,
    "moisture": 0.0,
    "minIncl": 0.0,
    "maxIncl": 0.5,
    "category": "additive",
    "unit": "kg"
  },
  {
    "id": "ing_12",
    "name": "L-Lysine HCl (98.5%)",
    "price": 600.0,
    "cp": 0.0,
    "me": 0.0,
    "fat": 0.0,
    "fibre": 0.0,
    "ca": 0.0,
    "p": 0.0,
    "lys": 78.0,
    "met": 0.0,
    "moisture": 0.0,
    "minIncl": 0.0,
    "maxIncl": 0.5,
    "category": "additive",
    "unit": "kg"
  },
  {
    "id": "ing_13",
    "name": "Sorghum Grain",
    "price": 38.0,
    "cp": 10.0,
    "me": 3280.0,
    "fat": 3.2,
    "fibre": 2.6,
    "ca": 0.03,
    "p": 0.35,
    "lys": 0.22,
    "met": 0.17,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 40.0,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_14",
    "name": "Cassava Meal",
    "price": 30.0,
    "cp": 2.5,
    "me": 3200.0,
    "fat": 0.5,
    "fibre": 3.0,
    "ca": 0.1,
    "p": 0.08,
    "lys": 0.07,
    "met": 0.04,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 20.0,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_15",
    "name": "Sunflower Oil",
    "price": 180.0,
    "cp": 0.0,
    "me": 8800.0,
    "fat": 99.0,
    "fibre": 0.0,
    "ca": 0.0,
    "p": 0.0,
    "lys": 0.0,
    "met": 0.0,
    "moisture": 0.0,
    "minIncl": 0.0,
    "maxIncl": 5.0,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_16",
    "name": "Rice Bran",
    "price": 20.0,
    "cp": 12.0,
    "me": 2685.0,
    "fat": 13.0,
    "fibre": 13.0,
    "ca": 0.08,
    "p": 1.8,
    "lys": 0.56,
    "met": 0.24,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 15.0,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_17",
    "name": "Blood Meal (Ring-dried)",
    "price": 250.0,
    "cp": 80.0,
    "me": 2790.0,
    "fat": 1.5,
    "fibre": 1.5,
    "ca": 0.3,
    "p": 0.26,
    "lys": 6.6,
    "met": 1.0,
    "moisture": 10.0,
    "minIncl": 0.0,
    "maxIncl": 5.0,
    "category": "protein",
    "unit": "kg"
  },
  {
    "id": "ing_18",
    "name": "Urea (Feed Grade)",
    "price": 100.0,
    "cp": 287.0,
    "me": 0.0,
    "fat": 0.0,
    "fibre": 0.0,
    "ca": 0.0,
    "p": 0.0,
    "lys": 0.0,
    "met": 0.0,
    "moisture": 0.0,
    "minIncl": 0.0,
    "maxIncl": 1.0,
    "category": "protein",
    "unit": "kg"
  },
  {
    "id": "ing_19",
    "name": "Molasses",
    "price": 25.0,
    "cp": 4.0,
    "me": 2460.0,
    "fat": 0.2,
    "fibre": 0.5,
    "ca": 0.7,
    "p": 0.1,
    "lys": 0.17,
    "met": 0.08,
    "moisture": 25.0,
    "minIncl": 0.0,
    "maxIncl": 5.0,
    "category": "energy",
    "unit": "kg"
  },
  {
    "id": "ing_20",
    "name": "Wheat Grain",
    "price": 55.0,
    "cp": 12.0,
    "me": 3080.0,
    "fat": 1.8,
    "fibre": 3.0,
    "ca": 0.05,
    "p": 0.35,
    "lys": 0.38,
    "met": 0.2,
    "moisture": 12.0,
    "minIncl": 0.0,
    "maxIncl": 40.0,
    "category": "energy",
    "unit": "kg"
  }
];

export const SEED_ANIMAL_REQS = [
  {
    "id": "ar_1",
    "category": "Poultry (Broiler)",
    "stage": "Starter (0-21 days)",
    "cp": [
      22.0,
      24.0
    ],
    "me": [
      3000.0,
      3200.0
    ],
    "fat": [
      4.0,
      8.0
    ],
    "fibre": [
      0.0,
      5.0
    ],
    "ca": [
      0.9,
      1.1
    ],
    "p": [
      0.45,
      0.6
    ],
    "lys": [
      1.2,
      1.5
    ],
    "met": [
      0.5,
      0.65
    ]
  },
  {
    "id": "ar_2",
    "category": "Poultry (Broiler)",
    "stage": "Grower (22-35 days)",
    "cp": [
      20.0,
      22.0
    ],
    "me": [
      3100.0,
      3300.0
    ],
    "fat": [
      4.0,
      8.0
    ],
    "fibre": [
      0.0,
      5.0
    ],
    "ca": [
      0.85,
      1.05
    ],
    "p": [
      0.42,
      0.55
    ],
    "lys": [
      1.05,
      1.3
    ],
    "met": [
      0.45,
      0.6
    ]
  },
  {
    "id": "ar_3",
    "category": "Poultry (Broiler)",
    "stage": "Finisher (36+ days)",
    "cp": [
      18.0,
      20.0
    ],
    "me": [
      3150.0,
      3350.0
    ],
    "fat": [
      4.0,
      8.0
    ],
    "fibre": [
      0.0,
      5.0
    ],
    "ca": [
      0.8,
      1.0
    ],
    "p": [
      0.38,
      0.5
    ],
    "lys": [
      0.95,
      1.2
    ],
    "met": [
      0.4,
      0.55
    ]
  },
  {
    "id": "ar_4",
    "category": "Poultry (Layer)",
    "stage": "Chick Starter (0-8 wks)",
    "cp": [
      20.0,
      22.0
    ],
    "me": [
      2850.0,
      3050.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      0.0,
      6.0
    ],
    "ca": [
      0.9,
      1.1
    ],
    "p": [
      0.42,
      0.55
    ],
    "lys": [
      0.9,
      1.1
    ],
    "met": [
      0.4,
      0.55
    ]
  },
  {
    "id": "ar_5",
    "category": "Poultry (Layer)",
    "stage": "Grower (8-16 wks)",
    "cp": [
      16.0,
      18.0
    ],
    "me": [
      2700.0,
      2900.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      0.0,
      7.0
    ],
    "ca": [
      0.9,
      1.1
    ],
    "p": [
      0.38,
      0.5
    ],
    "lys": [
      0.75,
      0.95
    ],
    "met": [
      0.35,
      0.48
    ]
  },
  {
    "id": "ar_6",
    "category": "Poultry (Layer)",
    "stage": "Pre-lay (16-20 wks)",
    "cp": [
      18.0,
      20.0
    ],
    "me": [
      2750.0,
      2950.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      0.0,
      7.0
    ],
    "ca": [
      2.0,
      2.5
    ],
    "p": [
      0.4,
      0.55
    ],
    "lys": [
      0.85,
      1.05
    ],
    "met": [
      0.38,
      0.5
    ]
  },
  {
    "id": "ar_7",
    "category": "Poultry (Layer)",
    "stage": "In Production (20+ wks)",
    "cp": [
      15.0,
      18.0
    ],
    "me": [
      2700.0,
      2900.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      0.0,
      7.0
    ],
    "ca": [
      3.5,
      4.5
    ],
    "p": [
      0.35,
      0.45
    ],
    "lys": [
      0.75,
      0.9
    ],
    "met": [
      0.35,
      0.45
    ]
  },
  {
    "id": "ar_8",
    "category": "Dairy Cattle",
    "stage": "Calf (0-3 months)",
    "cp": [
      22.0,
      25.0
    ],
    "me": [
      2800.0,
      3100.0
    ],
    "fat": [
      5.0,
      10.0
    ],
    "fibre": [
      5.0,
      15.0
    ],
    "ca": [
      0.8,
      1.2
    ],
    "p": [
      0.55,
      0.75
    ],
    "lys": [
      1.2,
      1.6
    ],
    "met": [
      0.42,
      0.58
    ]
  },
  {
    "id": "ar_9",
    "category": "Dairy Cattle",
    "stage": "Heifer (3-12 months)",
    "cp": [
      16.0,
      18.0
    ],
    "me": [
      2400.0,
      2700.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      12.0,
      20.0
    ],
    "ca": [
      0.5,
      0.75
    ],
    "p": [
      0.38,
      0.52
    ],
    "lys": [
      0.7,
      0.95
    ],
    "met": [
      0.25,
      0.38
    ]
  },
  {
    "id": "ar_10",
    "category": "Dairy Cattle",
    "stage": "Dry Cow",
    "cp": [
      12.0,
      14.0
    ],
    "me": [
      1800.0,
      2400.0
    ],
    "fat": [
      2.0,
      6.0
    ],
    "fibre": [
      20.0,
      35.0
    ],
    "ca": [
      0.4,
      0.6
    ],
    "p": [
      0.3,
      0.45
    ],
    "lys": [
      0.5,
      0.7
    ],
    "met": [
      0.18,
      0.28
    ]
  },
  {
    "id": "ar_11",
    "category": "Dairy Cattle",
    "stage": "Lactating (High Prod.)",
    "cp": [
      16.0,
      18.0
    ],
    "me": [
      2600.0,
      2900.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      15.0,
      25.0
    ],
    "ca": [
      0.7,
      1.0
    ],
    "p": [
      0.45,
      0.65
    ],
    "lys": [
      0.75,
      1.0
    ],
    "met": [
      0.28,
      0.42
    ]
  },
  {
    "id": "ar_12",
    "category": "Beef Cattle",
    "stage": "Weaner (3-6 months)",
    "cp": [
      16.0,
      18.0
    ],
    "me": [
      2400.0,
      2700.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      10.0,
      18.0
    ],
    "ca": [
      0.5,
      0.75
    ],
    "p": [
      0.38,
      0.52
    ],
    "lys": [
      0.65,
      0.85
    ],
    "met": [
      0.22,
      0.35
    ]
  },
  {
    "id": "ar_13",
    "category": "Beef Cattle",
    "stage": "Grower (6-12 months)",
    "cp": [
      12.0,
      14.0
    ],
    "me": [
      2400.0,
      2700.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      15.0,
      25.0
    ],
    "ca": [
      0.35,
      0.55
    ],
    "p": [
      0.25,
      0.4
    ],
    "lys": [
      0.55,
      0.72
    ],
    "met": [
      0.18,
      0.28
    ]
  },
  {
    "id": "ar_14",
    "category": "Beef Cattle",
    "stage": "Finisher (12+ months)",
    "cp": [
      11.0,
      13.0
    ],
    "me": [
      2700.0,
      3000.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      10.0,
      20.0
    ],
    "ca": [
      0.3,
      0.5
    ],
    "p": [
      0.22,
      0.35
    ],
    "lys": [
      0.45,
      0.62
    ],
    "met": [
      0.15,
      0.25
    ]
  },
  {
    "id": "ar_15",
    "category": "Swine",
    "stage": "Starter (<25 kg)",
    "cp": [
      20.0,
      22.0
    ],
    "me": [
      3200.0,
      3400.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      0.0,
      5.0
    ],
    "ca": [
      0.8,
      1.0
    ],
    "p": [
      0.65,
      0.8
    ],
    "lys": [
      1.3,
      1.55
    ],
    "met": [
      0.4,
      0.55
    ]
  },
  {
    "id": "ar_16",
    "category": "Swine",
    "stage": "Grower (25-60 kg)",
    "cp": [
      16.0,
      18.0
    ],
    "me": [
      3100.0,
      3300.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      0.0,
      6.0
    ],
    "ca": [
      0.65,
      0.85
    ],
    "p": [
      0.55,
      0.7
    ],
    "lys": [
      0.95,
      1.2
    ],
    "met": [
      0.3,
      0.45
    ]
  },
  {
    "id": "ar_17",
    "category": "Swine",
    "stage": "Finisher (>60 kg)",
    "cp": [
      14.0,
      16.0
    ],
    "me": [
      3100.0,
      3300.0
    ],
    "fat": [
      3.0,
      7.0
    ],
    "fibre": [
      0.0,
      7.0
    ],
    "ca": [
      0.55,
      0.75
    ],
    "p": [
      0.48,
      0.6
    ],
    "lys": [
      0.75,
      0.95
    ],
    "met": [
      0.25,
      0.38
    ]
  },
  {
    "id": "ar_18",
    "category": "Swine",
    "stage": "Lactating Sow",
    "cp": [
      18.0,
      20.0
    ],
    "me": [
      3050.0,
      3250.0
    ],
    "fat": [
      4.0,
      8.0
    ],
    "fibre": [
      0.0,
      8.0
    ],
    "ca": [
      0.8,
      1.0
    ],
    "p": [
      0.65,
      0.8
    ],
    "lys": [
      0.95,
      1.2
    ],
    "met": [
      0.3,
      0.45
    ]
  },
  {
    "id": "ar_19",
    "category": "Rabbit",
    "stage": "Grower (4-12 weeks)",
    "cp": [
      16.0,
      18.0
    ],
    "me": [
      2500.0,
      2700.0
    ],
    "fat": [
      2.0,
      5.0
    ],
    "fibre": [
      10.0,
      16.0
    ],
    "ca": [
      0.5,
      0.8
    ],
    "p": [
      0.35,
      0.5
    ],
    "lys": [
      0.65,
      0.85
    ],
    "met": [
      0.25,
      0.38
    ]
  },
  {
    "id": "ar_20",
    "category": "Rabbit",
    "stage": "Lactating Doe",
    "cp": [
      17.0,
      19.0
    ],
    "me": [
      2600.0,
      2800.0
    ],
    "fat": [
      3.0,
      6.0
    ],
    "fibre": [
      10.0,
      14.0
    ],
    "ca": [
      0.8,
      1.1
    ],
    "p": [
      0.5,
      0.65
    ],
    "lys": [
      0.75,
      0.95
    ],
    "met": [
      0.3,
      0.42
    ]
  },
  {
    "id": "ar_21",
    "category": "Rabbit",
    "stage": "Maintenance Adult",
    "cp": [
      14.0,
      16.0
    ],
    "me": [
      2200.0,
      2500.0
    ],
    "fat": [
      2.0,
      4.0
    ],
    "fibre": [
      14.0,
      20.0
    ],
    "ca": [
      0.5,
      0.7
    ],
    "p": [
      0.3,
      0.45
    ],
    "lys": [
      0.55,
      0.72
    ],
    "met": [
      0.22,
      0.32
    ]
  },
  {
    "id": "ar_22",
    "category": "Fish (Tilapia)",
    "stage": "Fry (<5 g)",
    "cp": [
      45.0,
      50.0
    ],
    "me": [
      3200.0,
      3500.0
    ],
    "fat": [
      6.0,
      10.0
    ],
    "fibre": [
      0.0,
      3.0
    ],
    "ca": [
      1.5,
      2.5
    ],
    "p": [
      1.2,
      1.8
    ],
    "lys": [
      2.5,
      3.2
    ],
    "met": [
      0.9,
      1.3
    ]
  },
  {
    "id": "ar_23",
    "category": "Fish (Tilapia)",
    "stage": "Fingerling (5-50 g)",
    "cp": [
      38.0,
      42.0
    ],
    "me": [
      3000.0,
      3300.0
    ],
    "fat": [
      6.0,
      10.0
    ],
    "fibre": [
      0.0,
      5.0
    ],
    "ca": [
      1.2,
      2.0
    ],
    "p": [
      1.0,
      1.5
    ],
    "lys": [
      2.0,
      2.6
    ],
    "met": [
      0.72,
      1.1
    ]
  },
  {
    "id": "ar_24",
    "category": "Fish (Tilapia)",
    "stage": "Grow-out (>50 g)",
    "cp": [
      28.0,
      32.0
    ],
    "me": [
      2800.0,
      3100.0
    ],
    "fat": [
      5.0,
      9.0
    ],
    "fibre": [
      0.0,
      7.0
    ],
    "ca": [
      1.0,
      1.5
    ],
    "p": [
      0.8,
      1.2
    ],
    "lys": [
      1.5,
      2.0
    ],
    "met": [
      0.55,
      0.85
    ]
  }
];

export const FEEDING_QTY = {
  'Poultry (Broiler)': {
    'Starter (0-21 days)':  {qty:'55-60 g/bird/day',  water:'100-120 ml',meals:'Ad libitum',notes:'Feed ad lib. Chick mash. 24hr lighting first week.'},
    'Grower (22-35 days)':  {qty:'80-100 g/bird/day', water:'150-200 ml',meals:'Ad libitum',notes:'Switch to grower pellets at day 22.'},
    'Finisher (36+ days)':  {qty:'120-150 g/bird/day',water:'200-250 ml',meals:'Ad libitum',notes:'Finisher pellets. Withdraw 7 days before slaughter.'},
  },
  'Poultry (Layer)': {
    'Chick Starter (0-8 wks)':   {qty:'20-45 g/bird/day', water:'50-100 ml', meals:'Ad libitum',notes:'Chick mash with coccidiostat.'},
    'Grower (8-16 wks)':         {qty:'60-80 g/bird/day', water:'100-150 ml',meals:'Ad libitum',notes:'Restrict feed slightly to control body weight.'},
    'Pre-lay (16-20 wks)':       {qty:'90-100 g/bird/day',water:'150-200 ml',meals:'Ad libitum',notes:'Increase calcium 2 weeks before lay.'},
    'In Production (20+ wks)':   {qty:'110-120 g/bird/day',water:'200-250 ml',meals:'Ad libitum',notes:'Feed layer mash. Monitor egg production weekly.'},
  },
  'Dairy Cattle': {
    'Calf (0-3 months)':        {qty:'1-3 kg/day',  water:'5-8 L',  meals:'3x daily',notes:'Milk + calf starter. Creep feed from week 2.'},
    'Heifer (3-12 months)':     {qty:'2-4 kg/day',  water:'20-30 L',meals:'2x daily',notes:'Good quality roughage + concentrate supplement.'},
    'Dry Cow':                  {qty:'4-6 kg/day',  water:'30-40 L',meals:'2x daily',notes:'Reduce concentrate 3 weeks before calving.'},
    'Lactating (High Prod.)':   {qty:'8-12 kg/day', water:'50-80 L',meals:'3x daily',notes:'1 kg concentrate per 2.5 L milk above maintenance.'},
  },
  'Beef Cattle': {
    'Weaner (3-6 months)':      {qty:'1.5-2.5 kg/day',water:'15-20 L',meals:'2x daily',notes:'Creep feed + good pasture access.'},
    'Grower (6-12 months)':     {qty:'3-4 kg/day',   water:'25-35 L',meals:'2x daily',notes:'Balance roughage and concentrate for ADG 0.8 kg.'},
    'Finisher (12+ months)':    {qty:'4-6 kg/day',   water:'35-50 L',meals:'2x daily',notes:'High energy diet. Target 1.2 kg ADG. Limit fibre.'},
  },
  'Swine': {
    'Starter (<25 kg)':         {qty:'500g-1.2 kg/day',water:'1-2 L', meals:'3x daily',notes:'High quality protein essential. Feed creep pellets.'},
    'Grower (25-60 kg)':        {qty:'1.5-2.2 kg/day',water:'3-5 L', meals:'2x daily',notes:'Control feed intake to prevent fat deposition.'},
    'Finisher (>60 kg)':        {qty:'2.2-3 kg/day',  water:'5-8 L', meals:'2x daily',notes:'Reduce protein, increase energy for finishing.'},
    'Lactating Sow':            {qty:'5-7 kg/day',    water:'15-20 L',meals:'Ad libitum',notes:'Increase by 0.5 kg/piglet above 8. Prevent weight loss.'},
  },
  'Rabbit': {
    'Grower (4-12 weeks)':      {qty:'120-150 g/day', water:'200-300 ml',meals:'Ad libitum',notes:'Pellets + hay. Introduce pellets slowly.'},
    'Lactating Doe':            {qty:'250-350 g/day', water:'500-700 ml',meals:'Ad libitum',notes:'Increase gradually after kindling. High energy needed.'},
    'Maintenance Adult':        {qty:'100-120 g/day', water:'150-250 ml',meals:'2x daily',notes:'Restrict to prevent obesity. Hay should be 30% of diet.'},
  },
  'Fish (Tilapia)': {
    'Fry (<5 g)':               {qty:'10-15% body wt/day',water:'N/A',meals:'6-8x daily',notes:'Fine powder. Wean off live food at 2 weeks.'},
    'Fingerling (5-50 g)':      {qty:'5-8% body wt/day',  water:'N/A',meals:'4-6x daily',notes:'Small crumble. Maintain DO > 5 mg/L.'},
    'Grow-out (>50 g)':         {qty:'3-4% body wt/day',  water:'N/A',meals:'2-3x daily',notes:'Floating pellets. Adjust by water temperature.'},
  },
};

export const SPECIES_RECS = {
  'Poultry (Broiler)': {tips:['Good ventilation prevents respiratory diseases','Day 1-7: 35°C brooder temp, reduce 3°C/week','Clean water at all times — critical for FCR']},
  'Poultry (Layer)':   {tips:['16 hrs light/day maintains production','Oyster shell supplement boosts eggshell quality','Biosecurity: all-in all-out system preferred']},
  'Dairy Cattle':      {tips:['Body condition score 3-3.5 at calving is ideal','Transition cow programme prevents metabolic disorders','Total Mixed Ration (TMR) improves milk consistency']},
  'Beef Cattle':       {tips:['Implants can improve ADG by 10-15%','Bunk space: 30-45 cm/head minimum','Monitor BCS monthly — target 5-6 (1-9 scale)']},
  'Swine':             {tips:['All-in all-out reduces disease pressure significantly','Phase feeding reduces nitrogen excretion by 20%','Keep temperature 18-22°C for growers']},
  'Rabbit':            {tips:['Hay must be available at all times for gut motility','GI stasis is the #1 killer — watch for inappetence','House at 15-21°C for best production']},
  'Fish (Tilapia)':    {tips:['Dissolved oxygen below 3mg/L causes stress','Optimal temperature 25-30°C for tilapia','Sample weight monthly to adjust feeding rates']},
};

export const TIPS = [
  {icon:'💡',text:'Always weigh ingredients accurately — small errors compound over large batches.'},
  {icon:'🌡️',text:'Store feed ingredients in cool, dry conditions to prevent mycotoxin growth.'},
  {icon:'🔬',text:'Run proximate analysis on local ingredients annually — nutrient values vary by season.'},
  {icon:'💰',text:'Least-cost formulation assumes ingredient prices change weekly — update prices regularly.'},
  {icon:'⚖️',text:'The LP solver finds the mathematically optimal mix, but always check physical palatability.'},
];

// ── HELPER FUNCTIONS ──────────────────────────────────────────────────────────
export function getAnimalReqs(stored) {
  return (stored && stored.length > 0) ? stored : SEED_ANIMAL_REQS;
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
