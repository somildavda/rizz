// Journey — plan data.
// User: 28y, 5'11" (180 cm), 94.5 kg, ~27% body fat, vegetarian, beginner, left-knee pain
// (no deep/loaded squats), Gold's Gym Kandivali W at 8:30 am, 60-min sessions, ₹12K/month.
// Goal: V-taper with 2–4 visible abs, a better-shaped chest and a sharp jawline
// (Farhan Akhtar in Bhaag Milkha Bhaag; Hrithik-style grooming). Day 1 = 21 Oct 2026.

const PROFILE_DEFAULT = {
  name: "", age: 28, heightCm: 180, startWeight: 94.5, bodyFat: 27.2,
  targetDate: "2027-05-04", budget: 12000, diet: "veg",
  gym: "Gold's Gym, Kandivali West", knee: "Left knee pain — avoid deep squats and lunges",
};
const START_DATE = "2026-10-21";
const GYM_TIME = "8:30 am";

// Maintenance is ~2,850 kcal. 2–4 abs usually show at ~12–14% body fat, which for this
// starting point is ~79 kg — about 28 weeks at a sustainable 0.5–0.8 kg/week.
const PHASES = [
  { name: "Foundation", start: "2026-10-21", end: "2026-11-17", fromKg: 94.5, toKg: 91.5,
    kcal: 2200, protein: 145, carbs: 230, fat: 60, steps: 8000,
    focus: "Learn every exercise with light weights and build the daily habits. The first 1–2 kg is partly water.",
    food: "Follow the meal plan as written." },
  { name: "Fat loss I", start: "2026-11-18", end: "2027-01-12", fromKg: 91.5, toKg: 86.5,
    kcal: 2100, protein: 150, carbs: 210, fat: 60, steps: 10000,
    focus: "Add weight whenever you hit the top of the rep range. Harder Thursday intervals. Start walk-run.",
    food: "Night slot: dahi or hung curd only. One planned treat meal a week, Christmas and New Year included." },
  { name: "Fat loss II", start: "2027-01-13", end: "2027-03-09", fromKg: 86.5, toKg: 82.5,
    kcal: 2000, protein: 155, carbs: 190, fat: 55, steps: 11000,
    focus: "Chest and V-taper look starts to show. Keep strength up. First week is a diet break at ~2,600 kcal to reset.",
    food: "Dinner: swap rice for extra sabzi. Treat meal every 2 weeks." },
  { name: "Abs reveal", start: "2027-03-10", end: "2027-05-04", fromKg: 82.5, toKg: 79,
    kcal: 1950, protein: 160, carbs: 175, fat: 55, steps: 12000,
    focus: "Target ~12–14% body fat: upper 2 abs first, then 4. Ab training 3× a week, low salt before photos.",
    food: "No treat meals. Pre-gym snack only on leg and conditioning days." },
  { name: "V-taper build", start: "2027-05-05", end: "2027-08-31", fromKg: 79, toKg: 80,
    kcal: 2500, protein: 150, carbs: 300, fat: 65, steps: 9000,
    focus: "Slow lean gain: more shoulder, lat and upper-chest volume to widen the V while staying lean.",
    food: "Add 1 roti at lunch and dinner and a second whey shake." },
];
const DELOAD_WEEKS = [6, 12, 18, 24]; // weeks since start: same exercises, ~60% of the weight
const DAILY = { waterL: 3.5, sleepH: 7.5 };
// Daily calorie changes (kcal) on top of the phase target. Gym days eat a bit more, rest
// days less, and a skipped session or walk lowers that day's target automatically.
const ADJUST = { gymDay: 100, restDay: -150, skippedGym: -250, skippedWalk: -150 };

// Exercise: [name, sets, reps, note]. Beginner starting weights live in START_WEIGHTS.
const ATHLETE_WEEK = [
  { day: "Day 1", title: "Push · chest, shoulders, triceps", ex: [
    ["Treadmill incline walk warm-up", 1, "8 min", "Incline 6–8, speed 5"],
    ["Machine chest press", 3, "10–12", ""],
    ["Incline dumbbell press", 3, "10–12", "Upper chest — key for chest shape"],
    ["Low-to-high cable fly", 3, "12–15", "Squeeze at the top"],
    ["Seated dumbbell shoulder press", 3, "10–12", ""],
    ["Cable lateral raise", 3, "12–15", "Side delts = width of the V"],
    ["Cable triceps pushdown", 3, "12–15", ""],
    ["Incline walk finisher", 1, "10 min", ""],
  ]},
  { day: "Day 2", title: "Legs · knee-friendly + core", ex: [
    ["Stationary bike warm-up", 1, "8 min", "Easy on the knee"],
    ["Hip thrust", 3, "10–12", "No knee stress"],
    ["Dumbbell Romanian deadlift", 3, "10–12", "Hinge at hips, soft knees"],
    ["Leg press (shallow range)", 3, "12–15", "Stop above 90°; skip if the knee hurts"],
    ["Lying leg curl", 3, "12–15", ""],
    ["Hip abduction machine", 3, "15", "Strong hips protect the knee"],
    ["Standing calf raise", 3, "15", ""],
    ["Dead bug", 3, "10/side", ""],
  ]},
  { day: "Day 3", title: "Pull · back, biceps", ex: [
    ["Rowing machine warm-up", 1, "6 min", ""],
    ["Lat pulldown", 3, "10–12", "Builds the V-taper"],
    ["Seated cable row", 3, "10–12", ""],
    ["Chest-supported dumbbell row", 3, "10–12", ""],
    ["Face pull", 3, "15", "Posture + rear delts"],
    ["Dumbbell curl", 3, "10–12", ""],
    ["Hanging knee raise", 3, "10–12", "Abs"],
  ]},
  { day: "Day 4", title: "Athlete conditioning", ex: [
    ["Bike or elliptical warm-up", 1, "8 min", ""],
    ["Bike intervals", 8, "30 s hard / 90 s easy", "Low impact on the knee"],
    ["Kettlebell swing", 3, "15", ""],
    ["Farmer's carry", 3, "40 m", ""],
    ["Pallof press", 3, "10/side", ""],
    ["Side plank", 3, "30 s/side", ""],
    ["Stretch: hip flexors, hamstrings, chest", 1, "8 min", ""],
  ]},
  { day: "Day 5", title: "Upper · V-taper + arms", ex: [
    ["Treadmill incline walk warm-up", 1, "6 min", ""],
    ["Assisted pull-up", 3, "8–10", "Goal: first unassisted pull-up"],
    ["Dumbbell bench press", 3, "10–12", ""],
    ["Arnold press", 3, "10–12", ""],
    ["Rear delt fly machine", 3, "15", ""],
    ["Hammer curl + overhead triceps", 3, "12 each", "Superset"],
    ["Cable crunch", 3, "15", "Abs"],
  ]},
  { day: "Day 6", title: "Walk / run day", ex: [
    ["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "15 min", ""] ]},
  { day: "Day 7", title: "Rest", ex: [["Rest, meal prep, grocery order", 1, "—", ""]] },
];
const UPPER_LOWER = [
  { day: "Day 1", title: "Upper A · strength", ex: [
    ["Bike warm-up", 1, "5 min", ""], ["Dumbbell bench press", 3, "6–10", "Last set close to failure"],
    ["Chest-supported dumbbell row", 3, "8–12", ""], ["Seated dumbbell shoulder press", 3, "8–12", ""],
    ["Lat pulldown", 3, "10–12", ""], ["Cable lateral raise", 3, "12–15", ""], ["EZ-bar curl + pushdown", 2, "12 each", "Superset"] ]},
  { day: "Day 2", title: "Lower A · knee-friendly", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Dumbbell Romanian deadlift", 3, "8–10", ""], ["Hip thrust", 3, "8–12", ""],
    ["Leg press (shallow range)", 3, "12–15", "Stop above 90°"], ["Seated leg curl", 3, "10–15", ""],
    ["Standing calf raise", 3, "12–15", ""], ["Cable crunch", 3, "12–15", ""] ]},
  { day: "Day 3", title: "Walk / run day", ex: [["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "10 min", ""]] },
  { day: "Day 4", title: "Upper B · hypertrophy", ex: [
    ["Rowing machine warm-up", 1, "5 min", ""], ["Incline machine press", 3, "10–12", ""], ["Seated cable row", 3, "10–12", ""],
    ["Assisted pull-up", 3, "8–10", ""], ["Low-to-high cable fly", 2, "12–15", ""], ["Cable lateral raise", 3, "15–20", ""],
    ["Face pull", 2, "15", ""] ]},
  { day: "Day 5", title: "Lower B + conditioning", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Dumbbell Romanian deadlift", 3, "10–12", ""], ["Single-leg glute bridge", 3, "10/side", ""],
    ["Hip abduction machine", 3, "15", ""], ["Lying leg curl", 3, "12", ""], ["Bike intervals", 6, "30 s hard / 90 s easy", ""] ]},
  { day: "Day 6", title: "Walk / run day", ex: [["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "15 min", ""]] },
  { day: "Day 7", title: "Rest", ex: [["Rest, meal prep, grocery order", 1, "—", ""]] },
];
const FULL_BODY = [
  { day: "Day 1", title: "Full body A", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Machine chest press", 3, "8–12", ""], ["Lat pulldown", 3, "8–12", ""],
    ["Hip thrust", 3, "10–12", ""], ["Seated dumbbell shoulder press", 2, "10–12", ""], ["Plank", 3, "30–45 s", ""],
    ["Incline walk finisher", 1, "12 min", ""] ]},
  { day: "Day 2", title: "Steps day", ex: [["Walk", 1, "10k steps", ""], ["Mobility routine", 1, "10 min", ""]] },
  { day: "Day 3", title: "Full body B", ex: [
    ["Rowing machine warm-up", 1, "6 min", ""], ["Dumbbell Romanian deadlift", 3, "8–10", ""], ["Incline dumbbell press", 3, "8–12", ""],
    ["Seated cable row", 3, "10–12", ""], ["Cable lateral raise", 3, "12–15", ""], ["Dead bug", 3, "10/side", ""],
    ["Bike intervals", 6, "30 s hard / 90 s easy", ""] ]},
  { day: "Day 4", title: "Steps day", ex: [["Walk", 1, "10k steps", ""], ["Mobility routine", 1, "10 min", ""]] },
  { day: "Day 5", title: "Full body C", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Leg press (shallow range)", 3, "12–15", ""], ["Assisted pull-up", 3, "8–10", ""],
    ["Dumbbell bench press", 3, "8–12", ""], ["Face pull", 3, "15", ""], ["Dumbbell curl", 2, "12", ""],
    ["Farmer's carry", 3, "40 m", ""] ]},
  { day: "Day 6", title: "Walk / run day", ex: [["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "15 min", ""]] },
  { day: "Day 7", title: "Rest", ex: [["Rest, meal prep, grocery order", 1, "—", ""]] },
];

const PROGRAMS = [
  { id: "athlete", name: "Milkha Athlete", days: 5, week: ATHLETE_WEEK,
    by: "Inspired by Samir Jaura, Farhan Akhtar's trainer for Bhaag Milkha Bhaag",
    why: "Lifting plus a hard conditioning day. Closest to the lean, athletic look in the film." },
  { id: "upperlower", name: "Science Upper/Lower", days: 4, week: UPPER_LOWER,
    by: "Inspired by Jeff Nippard and Dr Mike Israetel's evidence-based principles",
    why: "Each muscle twice a week with sets close to failure. Best for shoulders, lats and arms while cutting." },
  { id: "fullbody", name: "Beginner Full Body", days: 3, week: FULL_BODY,
    by: "Classic beginner full-body programming",
    why: "3 gym days plus walking days. Use it for busy or travel weeks so you never fall off the plan." },
];
let WEEK = ATHLETE_WEEK; // replaced by the chosen program at startup

// Conservative first-session weights for a 94 kg beginner. Machines differ between gyms:
// pick the weight where the last 2 reps are hard but form stays clean, then progress.
const START_WEIGHTS = {
  "Machine chest press": "20–25 kg stack",
  "Incline dumbbell press": "10–12.5 kg each hand",
  "Low-to-high cable fly": "5–7.5 kg each side",
  "Seated dumbbell shoulder press": "8–10 kg each hand",
  "Cable lateral raise": "2.5–5 kg",
  "Cable triceps pushdown": "15–20 kg",
  "Hip thrust": "20 kg bar (empty) → add 10 kg/week",
  "Dumbbell Romanian deadlift": "12.5–15 kg each hand",
  "Leg press (shallow range)": "40–60 kg added",
  "Lying leg curl": "15–20 kg",
  "Seated leg curl": "20–25 kg",
  "Hip abduction machine": "30–40 kg",
  "Standing calf raise": "Bodyweight, then 30–40 kg machine",
  "Lat pulldown": "30–35 kg",
  "Seated cable row": "30–35 kg",
  "Chest-supported dumbbell row": "12.5–15 kg each hand",
  "Face pull": "10–15 kg (rope)",
  "Dumbbell curl": "7.5–10 kg each hand",
  "EZ-bar curl + pushdown": "15 kg bar / 15 kg stack",
  "Hammer curl + overhead triceps": "7.5–10 kg dumbbells",
  "Kettlebell swing": "12–16 kg kettlebell",
  "Farmer's carry": "15–20 kg each hand",
  "Pallof press": "7.5–10 kg",
  "Assisted pull-up": "40–50 kg assistance (more = easier)",
  "Dumbbell bench press": "15–17.5 kg each hand",
  "Incline machine press": "20 kg stack",
  "Arnold press": "7.5–10 kg each hand",
  "Rear delt fly machine": "15–20 kg",
  "Cable crunch": "20–25 kg",
  "Single-leg glute bridge": "Bodyweight",
  "Hanging knee raise": "Bodyweight",
};

// Meals: every ingredient as a RAW / DRY weight with the exact product, plus short steps
// for the cook. Vegetarian, home-cooked, low-bloat: no tofu, rajma, chole or kabuli chana.
// Each slot has 4 options; the app rotates them by date so every day is different.
const PANEER = "iD Fresh High Protein Paneer";
const COOK_RULES = [
  "Weigh dal, rice, oats, poha, soya and atta DRY, before soaking or cooking.",
  `Paneer = ${PANEER} (from the fridge pack). Dahi = Amul Masti dahi, plain. Milk = Amul Taaza toned milk.`,
  "Oil = Tata Simply Better olive oil spray. 1 spray ≈ 1 second. No ghee, butter or extra oil.",
  "Atta = Milld High Protein Atta. 30 g dry atta = 1 phulka, no ghee on top.",
  "1 katori = 150 ml. No sugar in anything. Normal salt.",
  "Paneer cooks fast: add it at the end and cook 2 minutes only, or it turns rubbery.",
];
const TIKKA_STEPS = [
  "Cut the paneer into 2 cm cubes.",
  "Mix 30 g Amul Masti dahi + ½ tsp chilli powder + ¼ tsp haldi + ½ tsp garam masala + ½ tsp kasuri methi + ½ tsp ginger-garlic paste + lemon + salt.",
  "Coat the paneer and rest 15 minutes.",
  "Hot tawa or air fryer (180 °C), 3 sprays, cook 3 minutes per side until golden.",
];
const MEALS = [
  { time: "10:00", label: "Post-gym breakfast", options: [
    { name: "Protein oats", kcal: 560, p: 40,
      items: ["50 g Quaker rolled oats (dry)", "250 ml Amul Taaza toned milk", "30 g whey (1 scoop)", "1 banana (~100 g peeled)"],
      steps: ["Boil the milk, add the oats, cook 3–4 min stirring.", "Take off the heat, wait 1 min, then stir in the whey so it doesn't lump.", "Top with sliced banana. No sugar."] },
    { name: "Paneer besan chilla", kcal: 525, p: 49,
      items: ["50 g Tata Sampann besan", `75 g ${PANEER}, grated`, "30 g onion + 30 g tomato, finely chopped", "1 green chilli, coriander, pinch of ajwain, haldi, salt",
        "4–5 sprays olive oil", "2 tbsp green chutney (coriander + mint + lemon, no coconut)", "15 g whey (½ scoop) in 150 ml toned milk"],
      steps: ["Mix besan with ~90 ml water into a pouring batter; add onion, tomato, chilli, coriander, ajwain, haldi, salt.",
        "Spray a hot tawa, make 2 thin chillas, 2 min each side.", "Fill with grated paneer and chutney, fold.", "Serve with the whey-milk shake."] },
    { name: "Moong dal chilla + whey", kcal: 435, p: 41,
      items: ["60 g Tata Sampann yellow moong dal (dry), soaked 4 h or overnight", "10 g ginger, 1 green chilli, ½ tsp jeera, salt", "4–5 sprays olive oil",
        "100 g Amul Masti dahi", "30 g whey (1 scoop) in 250 ml water"],
      steps: ["Grind the soaked dal with ginger, chilli and ~60 ml water into a thick batter; add jeera and salt.",
        "Spray a hot tawa, make 2 chillas, 2 min each side.", "Serve with dahi. Drink the whey shake with it."] },
    { name: "Paneer poha + whey", kcal: 550, p: 51,
      items: ["50 g thick poha (dry)", `75 g ${PANEER}, cubed`, "50 g green peas (frozen is fine)", "40 g onion, chopped", "½ tsp mustard seeds, 5 curry leaves, ¼ tsp haldi, salt, ½ lemon",
        "4–5 sprays olive oil", "30 g whey (1 scoop) in 250 ml water"],
      steps: ["Rinse poha in a strainer, leave 5 min to soften.", "Spray a kadhai; mustard seeds + curry leaves, then onion 2 min, peas 2 min, haldi + salt.",
        "Add poha and paneer, mix on low for 2 min.", "Squeeze lemon on top. Drink the whey shake with it."] },
  ]},
  { time: "1:30", label: "Lunch", options: [
    { name: "Dal-soya thali", kcal: 595, p: 42,
      items: ["60 g Milld High Protein Atta → 2 phulka", "40 g Tata Sampann yellow moong dal (dry)", "40 g Fortune mini soya chunks (dry)",
        "50 g onion + 50 g tomato, 1 tsp ginger-garlic paste, ½ tsp each chilli / dhania / garam masala", "4–5 sprays olive oil",
        "Salad: 100 g cucumber + 50 g carrot", "100 g Amul Masti dahi"],
      steps: ["Dal: pressure-cook with 250 ml water, haldi, salt, 3 whistles. Jeera tadka with 2 sprays.",
        "Soya: boil 5 min in salted water, squeeze out all water.", "Spray kadhai, cook onion → ginger-garlic → tomato + spices into masala, add soya, cook 5 min.",
        "Make 2 phulkas, no ghee."] },
    { name: "Paneer bhurji thali", kcal: 590, p: 43,
      items: ["60 g Milld High Protein Atta → 2 phulka", `100 g ${PANEER}, crumbled`, "50 g onion + 50 g tomato + 50 g capsicum, chopped",
        "¼ tsp haldi, ½ tsp chilli, ½ tsp garam masala, salt", "30 g Tata Sampann yellow moong dal (dry)", "4–5 sprays olive oil", "Salad: 100 g cucumber"],
      steps: ["Spray kadhai, onion 2 min, tomato + capsicum 3 min, add spices.", "Add crumbled paneer, cook 2 min only.",
        "Dal: pressure-cook with 200 ml water, haldi, salt, 3 whistles.", "Make 2 phulkas, no ghee."] },
    { name: "Moong khichdi + paneer tikka", kcal: 595, p: 39,
      items: ["40 g rice (dry) + 40 g Tata Sampann yellow moong dal (dry)", "100 g mixed veg (carrot, beans, peas)", "½ tsp jeera, ¼ tsp haldi, salt",
        "4–5 sprays olive oil", `75 g ${PANEER} for tikka (see tikka steps)`, "150 g Amul Masti dahi"],
      steps: ["Wash rice and dal; pressure-cook with veg, haldi, salt and 500 ml water, 3 whistles.", "Jeera tadka with the sprays, pour over.",
        ...TIKKA_STEPS, "Serve with dahi."] },
    { name: "Palak paneer + rice", kcal: 600, p: 42,
      items: [`100 g ${PANEER}, cubed`, "200 g palak (1 small bunch)", "40 g onion + 40 g tomato + 2 garlic cloves + 1 green chilli", "½ tsp garam masala, salt",
        "60 g rice (dry)", "4–5 sprays olive oil", "Raita: 100 g Amul Masti dahi + 50 g cucumber + roasted jeera powder + salt"],
      steps: ["Blanch palak 2 min, dip in cold water, blend smooth.", "Spray kadhai, onion + garlic + chilli 2 min, tomato 2 min, add palak purée, salt, garam masala, cook 3 min.",
        "Add paneer, 2 min only.", "Rice: 60 g rice in 150 ml water, cook covered.",
        "Raita: grate cucumber and squeeze out water, whisk into dahi with a pinch of roasted jeera powder and salt."] },
  ]},
  { time: "5:00", label: "Snack", options: [
    { name: "Makhana + protein buttermilk", kcal: 190, p: 17,
      items: ["25 g Farmley roasted makhana (plain or pudina)", "1 pack Amul High Protein Buttermilk"],
      steps: ["If plain makhana: dry-roast 3 min on a tawa with 1 spray, add a pinch of salt and pepper."] },
    { name: "Whey shake + peanuts", kcal: 350, p: 36,
      items: ["30 g whey (1 scoop)", "250 ml Amul Taaza toned milk, cold", "15 g roasted peanuts (a small handful)"],
      steps: ["Shake whey in cold milk for 20 seconds. Peanuts on the side."] },
    { name: "Paneer tikka bites", kcal: 265, p: 22,
      items: [`75 g ${PANEER}`, "Tikka marinade (30 g dahi + spices)", "2 tbsp mint chutney", "1 guava or apple"],
      steps: [...TIKKA_STEPS, "Serve with mint chutney and the fruit."] },
    { name: "Soya chaat + dahi", kcal: 195, p: 21,
      items: ["30 g Fortune mini soya chunks (dry)", "30 g onion + 30 g tomato + 30 g cucumber, chopped", "½ lemon, chaat masala, coriander", "100 g Amul Masti dahi"],
      steps: ["Boil soya 5 min in salted water, squeeze dry, cool.", "Mix with the chopped veg, lemon, chaat masala and coriander.", "Dahi on the side."] },
  ]},
  { time: "8:30", label: "Dinner", options: [
    { name: "Soya pulao + raita", kcal: 490, p: 30,
      items: ["50 g basmati rice (dry), soaked 20 min", "40 g Fortune mini soya chunks (dry)", "80 g mixed veg (carrot, beans, peas) + 30 g onion",
        "1 bay leaf, 2 cloves, ½ tsp jeera, salt", "4–5 sprays olive oil",
        "Raita: 150 g Amul Masti dahi + 50 g cucumber + 5 mint leaves + roasted jeera powder + salt"],
      steps: ["Boil soya 5 min in salted water, squeeze dry.", "Spray the cooker; whole spices + onion 2 min, veg + soya 2 min.",
        "Add rice, 110 ml water and salt; 2 whistles.", "Raita: grate cucumber and squeeze out water, whisk into dahi with chopped mint, jeera powder and salt."] },
    { name: "Paneer-veg stir-fry", kcal: 545, p: 39,
      items: [`100 g ${PANEER}, cubed`, "200 g veg: capsicum, beans, broccoli or cabbage", "2 garlic cloves, 1 tsp soy sauce, black pepper",
        "4–5 sprays olive oil", "60 g Milld High Protein Atta → 2 phulka"],
      steps: ["Spray kadhai on high heat, garlic 30 seconds.", "Add veg, toss 4 min (keep crunchy).", "Add paneer, soy sauce and pepper, 2 min.", "Make 2 phulkas, no ghee."] },
    { name: "Dal + soya-matar", kcal: 540, p: 36,
      items: ["40 g yellow moong or masoor dal (dry)", "30 g Fortune mini soya chunks (dry) + 50 g green peas", "50 g onion + 50 g tomato, ginger-garlic, spices",
        "4–5 sprays olive oil", "60 g Milld High Protein Atta → 2 phulka", "Salad: 100 g cucumber"],
      steps: ["Dal: pressure-cook with 250 ml water, haldi, salt, 3 whistles; jeera tadka with 2 sprays.", "Soya: boil 5 min, squeeze dry.",
        "Spray kadhai, make onion-tomato masala, add soya + peas, cook 5 min.", "Make 2 phulkas, no ghee."] },
    { name: "Paneer tikka bowl", kcal: 480, p: 35,
      items: [`100 g ${PANEER}`, "Tikka marinade (30 g dahi + spices)", "50 g rice (dry)", "150 g veg: capsicum, onion, beans", "2–3 sprays olive oil"],
      steps: [...TIKKA_STEPS, "Rice: 50 g rice in 125 ml water, cook covered.", "Sauté the veg with the sprays 4 min, salt and pepper.", "Serve paneer and veg on the rice."] },
  ]},
  { time: "10:00", label: "Night", options: [
    { name: "Dahi", kcal: 120, p: 7, items: ["200 g Amul Masti dahi, plain"], steps: ["Serve as it is. No sugar."] },
    { name: "Haldi milk", kcal: 145, p: 8, items: ["250 ml Amul Taaza toned milk", "¼ tsp haldi + pinch of black pepper"], steps: ["Boil the milk with haldi and pepper for 2 min. No sugar."] },
    { name: "Hung curd + cinnamon", kcal: 120, p: 10, items: ["200 g Amul Masti dahi", "Pinch of cinnamon"],
      steps: ["Tie the dahi in a muslin cloth, hang it in the fridge for 2 hours (leaves ~120 g thick curd).", "Top with cinnamon."] },
    { name: "Slow protein shake", kcal: 175, p: 19, items: ["15 g whey (½ scoop)", "200 ml Amul Taaza toned milk"], steps: ["Shake together. Drink 30 min before bed."] },
  ]},
];
const AVOID_FOODS = ["tofu", "rajma", "chole / kabuli chana", "roasted chana"]; // dislikes / cause bloating

// Shopping: weekly items (qty per week) and monthly buys. q = search term for Zepto/Blinkit.
// Products the user already buys (Zepto links). Prices are estimates; edit them in the app.
const LINKS = {
  paneer: "https://www.zepto.com/pn/id-fresh-high-protein-paneer-56-g-protein-2000-gram/pvid/32916525-36e3-4858-9c97-9ad25508a131",
  atta: "https://www.zepto.com/pn/milld-high-protein-atta/pvid/42ed8e85-9f88-477b-878a-7ffba63e6019",
  spray: "https://www.zepto.com/pn/tata-simply-better-extra-virgin-olive-oil-cooking-spray/pvid/56f7e236-709d-4e49-9983-26930cbc05b7",
  soya: "https://www.zepto.com/pn/fortune-mini-soya-chunks/pvid/04023f5b-b9e5-42dd-8b28-5789e83046b5",
};
// qty = packs per week. Fractions mean "every few weeks" (0.5 = every 2nd week).
const GROCERY = [
  { item: "iD Fresh High Protein Paneer 200 g", qty: 4, price: 150, q: "id fresh high protein paneer", link: LINKS.paneer, group: "Protein" },
  { item: "Fortune mini soya chunks", qty: 1, price: 55, q: "fortune mini soya chunks", link: LINKS.soya, group: "Protein" },
  { item: "Pumpkin seeds 200 g (zinc for testosterone)", qty: 0.5, price: 160, q: "pumpkin seeds", group: "Protein" },
  { item: "Amul Masti dahi 400 g", qty: 3, price: 40, q: "amul masti dahi 400g", group: "Dairy" },
  { item: "Amul Taaza toned milk 500 ml", qty: 6, price: 28, q: "amul taaza toned milk", group: "Dairy" },
  { item: "Amul High Protein Buttermilk", qty: 2, price: 25, q: "amul high protein buttermilk", group: "Dairy" },
  { item: "Milld High Protein Atta", qty: 1, price: 130, q: "milld high protein atta", link: LINKS.atta, group: "Pantry" },
  { item: "Tata Simply Better olive oil cooking spray", qty: 0.25, price: 400, q: "olive oil cooking spray", link: LINKS.spray, group: "Pantry" },
  { item: "Tata Sampann yellow moong dal 1 kg", qty: 0.5, price: 160, q: "tata sampann moong dal", group: "Pantry" },
  { item: "Tata Sampann besan 500 g", qty: 0.5, price: 60, q: "tata sampann besan", group: "Pantry" },
  { item: "Quaker rolled oats 1 kg", qty: 0.5, price: 199, q: "quaker oats 1kg", group: "Pantry" },
  { item: "Thick poha 500 g", qty: 0.33, price: 55, q: "thick poha", group: "Pantry" },
  { item: "Daawat or India Gate rice 1 kg", qty: 0.5, price: 120, q: "basmati rice 1kg", group: "Pantry" },
  { item: "Farmley roasted makhana", qty: 0.5, price: 120, q: "farmley makhana", group: "Pantry" },
  { item: "Roasted peanuts 200 g", qty: 0.5, price: 50, q: "roasted peanuts", group: "Pantry" },
  { item: "Vegetables: onion, tomato, palak, capsicum, beans, cucumber", qty: 1, price: 260, q: "fresh vegetables", group: "Fresh" },
  { item: "Fruits: 7 bananas, 4 apples, guava", qty: 1, price: 150, q: "banana", group: "Fresh" },
];
const MONTHLY_EXTRAS = [
  { item: "Whey protein 1 kg (Avvatar, MuscleBlaze Raw or AS-IT-IS)", price: 2400, q: "whey protein 1kg" },
  { item: "Creatine monohydrate 250 g (AS-IT-IS or MuscleBlaze), lasts 2 months", price: 300, q: "creatine monohydrate" },
  { item: "Skin basics refill (sunscreen, face wash)", price: 400, q: "sunscreen spf 50" },
];
// One-time looks kit. Buy after the dermat visit; they may prescribe something else.
const LOOKS_KIT = [
  { item: "Sunscreen SPF 50 (Re'equil Ultra Matte or Minimalist SPF 50)", price: 550, q: "spf 50 sunscreen" },
  { item: "Gentle face wash (Cetaphil or Minimalist)", price: 350, q: "gentle face wash" },
  { item: "Light gel moisturiser (Minimalist or Neutrogena Hydro Boost)", price: 350, q: "gel moisturiser" },
  { item: "Beard trimmer with 0.5 mm steps (Philips or Mi), if you don't have one", price: 1500, q: "beard trimmer philips" },
  { item: "Running shoes with cushioning (Decathlon Kiprun or ASICS) — protects the knee", price: 3500, q: "running shoes" },
];

// Walk-to-run plan, knee-safe. Move to the next stage only if the left knee is pain-free
// the day after. Pain above 3/10 during or after = go back a stage.
const RUN_PLAN = [
  { weeks: [1, 4], name: "Brisk walk", session: "40 min brisk walk on Saturday + 10 min incline walk after each gym session" },
  { weeks: [5, 8], name: "Walk-run", session: "8 × (1 min easy jog + 2 min walk) on treadmill or track" },
  { weeks: [9, 12], name: "Longer runs", session: "6 × (3 min jog + 1 min walk)" },
  { weeks: [13, 16], name: "Continuous", session: "20 min continuous easy run (you can still talk)" },
  { weeks: [17, 22], name: "5K build", session: "Easy 25–30 min run + one 5 × 1 min faster strides" },
  { weeks: [23, 99], name: "5K runner", session: "5 km easy on Saturday; a 5K time trial on the first Saturday of each month" },
];

// One calisthenics skill per month from day 1. Practise the drills at the end of 2 gym sessions a week.
const SKILLS = [
  { name: "10 clean push-ups", test: "10 push-ups, chest to fist height, body straight", drills: ["Incline push-ups on a bench 3×10", "Knee push-ups 3×8", "Plank 3×30 s"] },
  { name: "45 s dead hang + 5 negatives", test: "Hang 45 s, then 5 slow 5-second pull-up negatives", drills: ["Dead hang 3× max", "Scapular pull-ups 3×8", "Jump-up + 5 s lowering 3×3"] },
  { name: "First strict pull-up", test: "1 pull-up from dead hang, chin over bar", drills: ["Band or machine-assisted pull-ups 3×6", "Negatives 3×3", "Lat pulldown heavy 3×6"] },
  { name: "20 push-ups + 5 dips", test: "20 push-ups unbroken, then 5 parallel-bar dips", drills: ["Push-ups 4×max", "Bench dips 3×10", "Assisted dip machine 3×8"] },
  { name: "3 pull-ups + 10 hanging knee raises", test: "3 pull-ups, then 10 knee raises without swinging", drills: ["Pull-up singles 5×1", "Hanging knee raises 3×10", "Hollow hold 3×20 s"] },
  { name: "10 dips + 10 s tuck L-sit", test: "10 dips, then a 10 s tuck L-sit on parallettes or dip bars", drills: ["Dips 3×max", "Tuck L-sit 5×5 s", "Hanging leg raises 3×8"] },
  { name: "5 pull-ups + 10 hanging leg raises", test: "5 pull-ups, then 10 straight-leg raises (abs month)", drills: ["Pull-ups 4×3", "Hanging leg raises 3×8", "Ab wheel from knees 3×8"] },
  { name: "8 pull-ups + 15 dips", test: "8 pull-ups and 15 dips — upper body at its best for the V-taper", drills: ["Pull-ups 5×4", "Weighted-free dips 4×max", "Archer push-ups 3×5/side"] },
];

const GROOMING = {
  am: ["Gentle face wash", "Moisturiser", "Sunscreen SPF 50 (2 finger lengths, every day)"],
  pm: ["Face wash", "Niacinamide serum (if the dermat agrees)", "Moisturiser"],
  posture: [
    ["Wall angels", "2 × 10", "wall angels exercise"],
    ["Chin tucks", "2 × 10", "chin tucks exercise posture"],
    ["Doorway chest stretch", "2 × 30 s", "doorway pec stretch"],
    ["Band pull-aparts", "2 × 15", "band pull apart exercise"],
  ],
  weekly: [
    ["Beard line-up (Sunday)", "Trim to 3–5 mm, crisp cheek line, neckline 1 finger above the Adam's apple"],
    ["Progress photos (Sunday)", "Same spot and light, front / side / back, relaxed"],
    ["Exfoliate once", "Gentle scrub or as the dermat says"],
    ["Nails and eyebrows tidy", "Only stray hairs; don't thin the brows"],
  ],
};
const BARBER_NOTE = "Short tapered sides (no. 2 fading to 3), 2–3 inches of texture on top swept back, " +
  "squared-off neckline. Beard: short dense stubble, crisp cheek line, neckline one finger above the Adam's apple.";

const CHEST_PLAN = [
  "Overall fat loss removes chest fat. Hitting the daily calorie target matters most.",
  "Upper-chest work twice a week (incline press, low-to-high cable fly) lifts and squares the chest.",
  "Rows and face pulls pull the shoulders back so the chest looks flatter and wider.",
  "A firm, rubbery disc right under the nipple may be gynecomastia (gland, not fat). Ask a doctor; diet alone won't shrink it.",
];
const CAMERA_TIPS = [
  "Stand tall and push the chin slightly forward and down for a sharper jaw.",
  "Camera at eye level or slightly above, never from below.",
  "Dark, fitted (not tight) plain tees and overshirts; avoid shiny or clingy fabric.",
  "Shoulders back, one foot forward, body angled to the camera instead of square-on.",
  "Low salt and no heavy late dinner the night before a shoot means less face puffiness.",
];
const SHARP_LOOK = [
  "The jawline shows below ~15% body fat. It comes with the plan; there's no shortcut.",
  "Beard: dense short stubble with a crisp cheek line. Show your barber the note below.",
  "Even skin tone looks sharper on camera: follow the dermat plan and wear sunscreen daily.",
  "Sleep 7–8 h and drink 3.5 L water to cut morning puffiness.",
];

const COACHES = [
  { name: "Samir Jaura", area: "Training", note: "Farhan Akhtar's trainer for Bhaag Milkha Bhaag; athlete-style training." },
  { name: "Jeff Nippard", area: "Training", note: "Evidence-based muscle building: progressive overload, sets near failure." },
  { name: "Dr Mike Israetel", area: "Training", note: "Training volume and deloads — why there's an easy week every 6 weeks." },
  { name: "Rujuta Diwekar", area: "Indian food", note: "Home-cooked Indian food, dahi, dal-chawal; no crash diets." },
  { name: "Ryan Fernando", area: "Nutrition", note: "Indian sports nutrition; high protein from everyday vegetarian food." },
  { name: "Andrew Huberman", area: "Recovery", note: "Morning daylight and consistent sleep — behind the sleep and steps habits." },
];

// Every gym session: cardio warm-up (first exercise) → dynamic warm-up → workout → cool-down.
const WARMUP = ["Dynamic warm-up", 1, "5 min",
  "10 each: arm circles, band pull-aparts, cat-cow, hip circles, glute bridges, bodyweight good mornings"];
const COOLDOWN = ["Cool-down stretch", 1, "6 min",
  "30 s each: doorway chest, lat stretch, hip flexor (kneel on a pad), hamstring, gentle quad. Slow breathing."];

// Built-in knee-safe swaps, so the app works without any AI key.
const SWAPS = {
  "Leg press (shallow range)": ["Hip thrust 3 × 12", "Cable pull-through 3 × 15", "Step-up onto a low box (15 cm) 3 × 10/side, only if pain-free"],
  "Hip thrust": ["Glute bridge machine 3 × 12", "Cable pull-through 3 × 15"],
  "Dumbbell Romanian deadlift": ["Cable pull-through 3 × 15", "45° back extension 3 × 12"],
  "Lying leg curl": ["Seated leg curl 3 × 12", "Swiss-ball leg curl 3 × 10"],
  "Seated leg curl": ["Lying leg curl 3 × 12", "Swiss-ball leg curl 3 × 10"],
  "Standing calf raise": ["Seated calf raise 3 × 15", "Leg-press calf raise 3 × 15"],
  "Machine chest press": ["Dumbbell bench press 3 × 10", "Push-ups 3 × max"],
  "Dumbbell bench press": ["Machine chest press 3 × 10", "Push-ups 3 × max"],
  "Incline dumbbell press": ["Incline machine press 3 × 10", "Low-to-high cable fly 3 × 12"],
  "Lat pulldown": ["Assisted pull-up 3 × 8", "Single-arm cable pulldown 3 × 12/side"],
  "Assisted pull-up": ["Lat pulldown 3 × 10", "Negative pull-ups 3 × 3"],
  "Seated cable row": ["Chest-supported dumbbell row 3 × 10", "Machine row 3 × 12"],
  "Seated dumbbell shoulder press": ["Machine shoulder press 3 × 10", "Arnold press 3 × 10"],
  "Cable lateral raise": ["Dumbbell lateral raise 3 × 15", "Machine lateral raise 3 × 15"],
  "Face pull": ["Rear delt fly machine 3 × 15", "Band pull-aparts 3 × 20"],
  "Kettlebell swing": ["Cable pull-through 3 × 15", "Bike sprint 6 × 20 s"],
  "Bike intervals": ["Rowing intervals 6 × 30 s", "Elliptical intervals 8 × 30 s"],
  "Farmer's carry": ["Dumbbell shrug hold 3 × 30 s", "Suitcase carry 3 × 30 m/side"],
  "Plank": ["Dead bug 3 × 10/side", "Bird dog 3 × 10/side"],
  "Dead bug": ["Plank 3 × 30 s", "Bird dog 3 × 10/side"],
};

// Natural testosterone: what actually moves it (no "booster" pills, no steroids).
const TESTOSTERONE = [
  ["Sleep 7.5–8 h", "A week of 5-hour nights can drop testosterone noticeably. The biggest lever."],
  ["Lose the fat", "Body fat converts testosterone to estrogen. Every kg lost helps, and helps the chest too."],
  ["Lift heavy compounds", "Presses, rows, pulldowns, hip thrusts and RDLs, mostly in the 6–10 rep range once form is solid."],
  ["Don't cut fat too low", "Keep 55–65 g fat a day from peanuts, pumpkin seeds, dahi and paneer."],
  ["Zinc and vitamin D", "15 g pumpkin seeds a day and 15 min of morning sun. Supplement only if a blood test says you're low."],
  ["Limit alcohol", "Max 2 drinks a week; none in the 8 weeks before the abs reveal."],
  ["Keep stress down", "Walks, sunlight and sleep keep cortisol in check."],
];
const BLOOD_TEST = "Ask a doctor for: total testosterone (morning, 8–10 am), vitamin D, vitamin B12 (a common gap for vegetarians), " +
  "TSH (thyroid), HbA1c and a lipid profile. Lab packages usually cost ₹1,500–2,500.";

// Built-in Indian food table for logging without AI. Per unit: [kcal, protein g, carbs g, fat g].
// unit = what one "1" means when no grams are given; per100 is used when grams/ml are given.
const FOODS = [
  { k: ["roti", "phulka", "chapati", "chapatti"], unit: "piece", per: [75, 3, 15, 0.5] },
  { k: ["paratha"], unit: "piece", per: [200, 4, 28, 8] },
  { k: ["rice", "chawal"], unit: "cup cooked", per: [200, 4, 44, 0.5], per100: [130, 2.7, 28, 0.3] },
  { k: ["dal", "daal"], unit: "katori", per: [150, 9, 20, 4] },
  { k: ["hp paneer", "high protein paneer"], unit: "100 g", per100: [230, 28, 6, 10] },
  { k: ["paneer bhurji"], unit: "katori", per: [280, 18, 6, 20] },
  { k: ["paneer"], unit: "100 g", per100: [265, 18, 4, 20] },
  { k: ["soya", "soya chunks"], unit: "katori sabzi", per: [180, 20, 14, 5], per100: [345, 52, 33, 0.5] },
  { k: ["dahi", "curd", "yogurt"], unit: "katori", per: [90, 5, 7, 4], per100: [60, 3.5, 4.7, 3] },
  { k: ["raita"], unit: "katori", per: [90, 4, 7, 4] },
  { k: ["milk"], unit: "glass", per: [145, 8, 12, 7], per100: [58, 3.2, 4.8, 3] },
  { k: ["whey", "protein shake"], unit: "scoop", per: [120, 24, 3, 1.5] },
  { k: ["egg"], unit: "piece", per: [75, 6, 0.5, 5] },
  { k: ["oats"], unit: "50 g", per100: [380, 13, 66, 7] },
  { k: ["poha"], unit: "plate", per: [250, 5, 45, 6] },
  { k: ["upma"], unit: "plate", per: [250, 6, 38, 8] },
  { k: ["idli"], unit: "piece", per: [60, 2, 12, 0.3] },
  { k: ["dosa"], unit: "piece", per: [170, 4, 28, 5] },
  { k: ["masala dosa"], unit: "piece", per: [350, 7, 50, 13] },
  { k: ["sambar"], unit: "katori", per: [120, 5, 17, 3] },
  { k: ["chilla"], unit: "piece", per: [120, 6, 15, 4] },
  { k: ["khichdi"], unit: "cup", per: [200, 7, 34, 4] },
  { k: ["sabzi", "bhaji", "veg"], unit: "katori", per: [120, 3, 12, 7] },
  { k: ["salad"], unit: "plate", per: [40, 2, 8, 0] },
  { k: ["banana"], unit: "piece", per: [105, 1, 27, 0] },
  { k: ["apple"], unit: "piece", per: [80, 0, 21, 0] },
  { k: ["guava"], unit: "piece", per: [70, 3, 15, 1] },
  { k: ["makhana"], unit: "25 g", per100: [350, 10, 77, 0.5] },
  { k: ["peanut butter"], unit: "tbsp", per: [95, 4, 3, 8] },
  { k: ["peanuts", "peanut"], unit: "handful", per: [90, 4, 3, 7.5], per100: [570, 26, 16, 49] },
  { k: ["pumpkin seeds"], unit: "15 g", per100: [560, 30, 11, 49] },
  { k: ["buttermilk", "chaas"], unit: "glass", per: [60, 3, 5, 2] },
  { k: ["chai", "tea"], unit: "cup", per: [90, 3, 12, 3] },
  { k: ["coffee"], unit: "cup", per: [90, 3, 10, 3] },
  { k: ["vada pav"], unit: "piece", per: [300, 6, 40, 13] },
  { k: ["samosa"], unit: "piece", per: [260, 4, 30, 14] },
  { k: ["pav bhaji"], unit: "plate", per: [450, 10, 60, 18] },
  { k: ["pani puri", "golgappa"], unit: "plate", per: [250, 4, 40, 8] },
  { k: ["sandwich"], unit: "piece", per: [250, 7, 35, 9] },
  { k: ["biryani", "pulao"], unit: "plate", per: [450, 10, 65, 15] },
  { k: ["pizza"], unit: "slice", per: [280, 11, 33, 11] },
  { k: ["burger"], unit: "piece", per: [400, 12, 45, 18] },
  { k: ["maggi", "noodles"], unit: "packet", per: [350, 7, 50, 13] },
  { k: ["chole", "rajma"], unit: "katori", per: [200, 9, 28, 6] },
  { k: ["bread"], unit: "slice", per: [75, 3, 14, 1] },
  { k: ["biscuit", "cookie"], unit: "piece", per: [45, 0.5, 6, 2] },
  { k: ["sweet", "mithai", "gulab jamun", "laddoo"], unit: "piece", per: [180, 3, 25, 8] },
  { k: ["beer"], unit: "pint", per: [210, 2, 17, 0] },
];
