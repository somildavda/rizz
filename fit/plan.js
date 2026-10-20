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
  { day: "Mon", title: "Push · chest, shoulders, triceps", ex: [
    ["Treadmill incline walk warm-up", 1, "8 min", "Incline 6–8, speed 5"],
    ["Machine chest press", 3, "10–12", ""],
    ["Incline dumbbell press", 3, "10–12", "Upper chest — key for chest shape"],
    ["Low-to-high cable fly", 3, "12–15", "Squeeze at the top"],
    ["Seated dumbbell shoulder press", 3, "10–12", ""],
    ["Cable lateral raise", 3, "12–15", "Side delts = width of the V"],
    ["Cable triceps pushdown", 3, "12–15", ""],
    ["Incline walk finisher", 1, "10 min", ""],
  ]},
  { day: "Tue", title: "Legs · knee-friendly + core", ex: [
    ["Stationary bike warm-up", 1, "8 min", "Easy on the knee"],
    ["Hip thrust", 3, "10–12", "No knee stress"],
    ["Dumbbell Romanian deadlift", 3, "10–12", "Hinge at hips, soft knees"],
    ["Leg press (shallow range)", 3, "12–15", "Stop above 90°; skip if the knee hurts"],
    ["Lying leg curl", 3, "12–15", ""],
    ["Hip abduction machine", 3, "15", "Strong hips protect the knee"],
    ["Standing calf raise", 3, "15", ""],
    ["Dead bug", 3, "10/side", ""],
  ]},
  { day: "Wed", title: "Pull · back, biceps", ex: [
    ["Rowing machine warm-up", 1, "6 min", ""],
    ["Lat pulldown", 3, "10–12", "Builds the V-taper"],
    ["Seated cable row", 3, "10–12", ""],
    ["Chest-supported dumbbell row", 3, "10–12", ""],
    ["Face pull", 3, "15", "Posture + rear delts"],
    ["Dumbbell curl", 3, "10–12", ""],
    ["Hanging knee raise", 3, "10–12", "Abs"],
  ]},
  { day: "Thu", title: "Athlete conditioning", ex: [
    ["Bike or elliptical warm-up", 1, "8 min", ""],
    ["Bike intervals", 8, "30 s hard / 90 s easy", "Low impact on the knee"],
    ["Kettlebell swing", 3, "15", ""],
    ["Farmer's carry", 3, "40 m", ""],
    ["Pallof press", 3, "10/side", ""],
    ["Side plank", 3, "30 s/side", ""],
    ["Stretch: hip flexors, hamstrings, chest", 1, "8 min", ""],
  ]},
  { day: "Fri", title: "Upper · V-taper + arms", ex: [
    ["Treadmill incline walk warm-up", 1, "6 min", ""],
    ["Assisted pull-up", 3, "8–10", "Goal: first unassisted pull-up"],
    ["Dumbbell bench press", 3, "10–12", ""],
    ["Arnold press", 3, "10–12", ""],
    ["Rear delt fly machine", 3, "15", ""],
    ["Hammer curl + overhead triceps", 3, "12 each", "Superset"],
    ["Cable crunch", 3, "15", "Abs"],
  ]},
  { day: "Sat", title: "Walk / run day", ex: [
    ["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "15 min", ""] ]},
  { day: "Sun", title: "Rest", ex: [["Rest, meal prep, grocery order", 1, "—", ""]] },
];
const UPPER_LOWER = [
  { day: "Mon", title: "Upper A · strength", ex: [
    ["Bike warm-up", 1, "5 min", ""], ["Dumbbell bench press", 3, "6–10", "Last set close to failure"],
    ["Chest-supported dumbbell row", 3, "8–12", ""], ["Seated dumbbell shoulder press", 3, "8–12", ""],
    ["Lat pulldown", 3, "10–12", ""], ["Cable lateral raise", 3, "12–15", ""], ["EZ-bar curl + pushdown", 2, "12 each", "Superset"] ]},
  { day: "Tue", title: "Lower A · knee-friendly", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Dumbbell Romanian deadlift", 3, "8–10", ""], ["Hip thrust", 3, "8–12", ""],
    ["Leg press (shallow range)", 3, "12–15", "Stop above 90°"], ["Seated leg curl", 3, "10–15", ""],
    ["Standing calf raise", 3, "12–15", ""], ["Cable crunch", 3, "12–15", ""] ]},
  { day: "Wed", title: "Walk / run day", ex: [["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "10 min", ""]] },
  { day: "Thu", title: "Upper B · hypertrophy", ex: [
    ["Rowing machine warm-up", 1, "5 min", ""], ["Incline machine press", 3, "10–12", ""], ["Seated cable row", 3, "10–12", ""],
    ["Assisted pull-up", 3, "8–10", ""], ["Low-to-high cable fly", 2, "12–15", ""], ["Cable lateral raise", 3, "15–20", ""],
    ["Face pull", 2, "15", ""] ]},
  { day: "Fri", title: "Lower B + conditioning", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Dumbbell Romanian deadlift", 3, "10–12", ""], ["Single-leg glute bridge", 3, "10/side", ""],
    ["Hip abduction machine", 3, "15", ""], ["Lying leg curl", 3, "12", ""], ["Bike intervals", 6, "30 s hard / 90 s easy", ""] ]},
  { day: "Sat", title: "Walk / run day", ex: [["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "15 min", ""]] },
  { day: "Sun", title: "Rest", ex: [["Rest, meal prep, grocery order", 1, "—", ""]] },
];
const FULL_BODY = [
  { day: "Mon", title: "Full body A", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Machine chest press", 3, "8–12", ""], ["Lat pulldown", 3, "8–12", ""],
    ["Hip thrust", 3, "10–12", ""], ["Seated dumbbell shoulder press", 2, "10–12", ""], ["Plank", 3, "30–45 s", ""],
    ["Incline walk finisher", 1, "12 min", ""] ]},
  { day: "Tue", title: "Steps day", ex: [["Walk", 1, "10k steps", ""], ["Mobility routine", 1, "10 min", ""]] },
  { day: "Wed", title: "Full body B", ex: [
    ["Rowing machine warm-up", 1, "6 min", ""], ["Dumbbell Romanian deadlift", 3, "8–10", ""], ["Incline dumbbell press", 3, "8–12", ""],
    ["Seated cable row", 3, "10–12", ""], ["Cable lateral raise", 3, "12–15", ""], ["Dead bug", 3, "10/side", ""],
    ["Bike intervals", 6, "30 s hard / 90 s easy", ""] ]},
  { day: "Thu", title: "Steps day", ex: [["Walk", 1, "10k steps", ""], ["Mobility routine", 1, "10 min", ""]] },
  { day: "Fri", title: "Full body C", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Leg press (shallow range)", 3, "12–15", ""], ["Assisted pull-up", 3, "8–10", ""],
    ["Dumbbell bench press", 3, "8–12", ""], ["Face pull", 3, "15", ""], ["Dumbbell curl", 2, "12", ""],
    ["Farmer's carry", 3, "40 m", ""] ]},
  { day: "Sat", title: "Walk / run day", ex: [["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "15 min", ""]] },
  { day: "Sun", title: "Rest", ex: [["Rest, meal prep, grocery order", 1, "—", ""]] },
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

// Meals: exact grams and suggested brands (any equivalent brand is fine).
// "HP paneer" = iD Fresh High Protein Paneer, 200 g pack with 56 g protein (check the label).
// Vegetarian, home-cooked, low-bloat: no tofu, rajma, chole or kabuli chana.
// Each slot has 4 options; the app rotates them by date so every day is different.
const MEALS = [
  { time: "7:45", label: "Pre-gym", gymOnly: true, options: [
    { name: "Banana + black coffee", kcal: 105, p: 1, items: [
      "1 medium banana (~120 g)", "1 tsp instant coffee (Nescafé / Bru) in hot water, no sugar"] },
    { name: "Dates + milk", kcal: 135, p: 5, items: [
      "2 dates (~16 g)", "150 ml Amul Taaza toned milk"] },
    { name: "Toast + peanut butter", kcal: 170, p: 7, items: [
      "1 slice brown bread (~30 g, Harvest Gold or English Oven)",
      "1 level tbsp (16 g) unsweetened peanut butter (Pintola All Natural or MyFitness Natural)"] },
    { name: "Apple + black coffee", kcal: 85, p: 0, items: [
      "1 apple (~150 g)", "Black coffee, no sugar"] },
  ]},
  { time: "10:00", label: "Post-gym breakfast", options: [
    { name: "Protein oats", kcal: 560, p: 40, items: [
      "50 g rolled oats (Quaker or Saffola) cooked in 250 ml toned milk",
      "1 scoop (~30 g) whey stirred in after cooking", "1 banana (~120 g), sliced on top"] },
    { name: "Paneer besan chilla", kcal: 495, p: 37, items: [
      "50 g besan (Tata Sampann) + chopped onion and tomato → 2 chilla, 1 tsp oil",
      "75 g HP paneer, grated, as stuffing", "2 tbsp green chutney", "150 ml toned milk"] },
    { name: "Moong dal chilla + whey", kcal: 435, p: 41, items: [
      "60 g yellow moong dal, soaked overnight and ground → 2 chilla, 1 tsp oil",
      "100 g dahi", "1 scoop whey in 250 ml water"] },
    { name: "Paneer poha + whey", kcal: 550, p: 51, items: [
      "50 g thick poha with 50 g peas, onion, curry leaves, 1 tsp oil",
      "75 g HP paneer, cubed and tossed in", "1 scoop whey in 250 ml water"] },
  ]},
  { time: "1:30", label: "Lunch", options: [
    { name: "Dal-soya thali", kcal: 595, p: 42, items: [
      "2 phulka (60 g atta, Aashirvaad)", "1 katori dal (40 g dry yellow moong dal)",
      "Soya sabzi (40 g dry Nutrela chunks) with 1 tsp oil", "Salad", "100 g dahi"] },
    { name: "Paneer bhurji thali", kcal: 590, p: 43, items: [
      "2 phulka (60 g atta)", "100 g HP paneer bhurji with onion, tomato, capsicum, 1 tsp oil",
      "1 small katori dal (30 g dry moong dal)", "Salad"] },
    { name: "Moong khichdi + paneer", kcal: 595, p: 39, items: [
      "Khichdi: 40 g rice + 40 g yellow moong dal + veg, 1 tsp ghee",
      "75 g HP paneer tikka (tawa)", "150 g dahi"] },
    { name: "Palak paneer + rice", kcal: 600, p: 42, items: [
      "100 g HP paneer in palak gravy (200 g spinach, 1 tsp oil)",
      "60 g dry rice (≈1 cup cooked)", "100 g cucumber raita"] },
  ]},
  { time: "5:00", label: "Snack", options: [
    { name: "Makhana + protein buttermilk", kcal: 190, p: 17, items: [
      "25 g roasted makhana (Farmley or Happilo, plain or pudina)",
      "1 pack Amul High Protein Buttermilk (check label: ~15 g protein)"] },
    { name: "Whey shake + peanuts", kcal: 350, p: 36, items: [
      "1 scoop whey in 250 ml toned milk", "15 g roasted peanuts (a small handful)"] },
    { name: "Paneer tikka bites", kcal: 265, p: 22, items: [
      "75 g HP paneer tikka, tawa or air-fried with ½ tsp oil", "2 tbsp mint chutney", "1 guava or apple"] },
    { name: "Soya chaat + dahi", kcal: 195, p: 21, items: [
      "30 g dry Nutrela soya chunks, boiled and squeezed",
      "Onion, tomato, cucumber, lemon, chaat masala", "100 g dahi on the side"] },
  ]},
  { time: "8:30", label: "Dinner", options: [
    { name: "Soya pulao + raita", kcal: 490, p: 30, items: [
      "50 g dry rice + 40 g Nutrela soya chunks + mixed veg, 1 tsp oil", "150 g raita"] },
    { name: "Paneer-veg stir-fry", kcal: 545, p: 39, items: [
      "100 g HP paneer + 200 g capsicum, beans, broccoli, 1 tsp oil", "2 phulka (60 g atta)"] },
    { name: "Dal + soya-matar", kcal: 540, p: 36, items: [
      "1 katori dal (40 g dry moong or masoor)", "Soya-matar sabzi (30 g soya + 50 g peas), 1 tsp oil",
      "2 phulka (60 g atta)", "Salad"] },
    { name: "Paneer tikka bowl", kcal: 480, p: 35, items: [
      "100 g HP paneer tikka", "50 g dry rice (≈¾ cup cooked)", "150 g sautéed veg, ½ tsp oil"] },
  ]},
  { time: "10:00", label: "Night", options: [
    { name: "Dahi", kcal: 120, p: 7, items: ["200 g plain dahi (Amul Masti)"] },
    { name: "Haldi milk", kcal: 145, p: 8, items: ["250 ml toned milk + ¼ tsp haldi, no sugar"] },
    { name: "Hung curd + cinnamon", kcal: 120, p: 10, items: ["200 g dahi hung for 2 h (~120 g) + a pinch of cinnamon"] },
    { name: "Slow protein shake", kcal: 175, p: 19, items: ["½ scoop (15 g) whey in 200 ml toned milk"] },
  ]},
];
const AVOID_FOODS = ["tofu", "rajma", "chole / kabuli chana", "roasted chana"]; // dislikes / cause bloating

// Shopping: weekly items (qty per week) and monthly buys. q = search term for Zepto/Blinkit.
const PANEER_LINK = "https://www.zepto.com/pn/id-fresh-high-protein-paneer-56-g-protein-2000-gram/pvid/32916525-36e3-4858-9c97-9ad25508a131";
const GROCERY = [
  { item: "iD Fresh High Protein Paneer 200 g", qty: 4, price: 150, q: "id fresh high protein paneer", link: PANEER_LINK, group: "Protein" },
  { item: "Nutrela soya chunks 200 g", qty: 1, price: 55, q: "nutrela soya chunks", group: "Protein" },
  { item: "Amul Masti dahi 400 g", qty: 3, price: 40, q: "amul masti dahi 400g", group: "Dairy" },
  { item: "Amul Taaza toned milk 500 ml", qty: 7, price: 28, q: "amul taaza toned milk", group: "Dairy" },
  { item: "Amul High Protein Buttermilk", qty: 2, price: 25, q: "amul high protein buttermilk", group: "Dairy" },
  { item: "Tata Sampann yellow moong dal 1 kg", qty: 0.5, price: 160, q: "tata sampann moong dal", group: "Pantry" },
  { item: "Tata Sampann besan 500 g", qty: 0.5, price: 60, q: "tata sampann besan", group: "Pantry" },
  { item: "Quaker rolled oats 1 kg", qty: 0.5, price: 199, q: "quaker oats 1kg", group: "Pantry" },
  { item: "Thick poha 500 g", qty: 0.33, price: 55, q: "thick poha", group: "Pantry" },
  { item: "Aashirvaad atta 5 kg", qty: 0.25, price: 280, q: "aashirvaad atta 5kg", group: "Pantry" },
  { item: "Daawat or India Gate rice 1 kg", qty: 0.5, price: 120, q: "basmati rice 1kg", group: "Pantry" },
  { item: "Farmley roasted makhana", qty: 0.5, price: 120, q: "farmley makhana", group: "Pantry" },
  { item: "Roasted peanuts 200 g", qty: 0.5, price: 50, q: "roasted peanuts", group: "Pantry" },
  { item: "Harvest Gold brown bread", qty: 0.5, price: 50, q: "harvest gold brown bread", group: "Pantry" },
  { item: "Fortune rice bran oil 1 L", qty: 0.25, price: 160, q: "fortune rice bran oil", group: "Pantry" },
  { item: "Vegetables: onion, tomato, palak, capsicum, beans, cucumber", qty: 1, price: 270, q: "fresh vegetables", group: "Fresh" },
  { item: "Fruits: 7 bananas, 4 apples, guava", qty: 1, price: 150, q: "banana", group: "Fresh" },
  { item: "Dates 250 g", qty: 0.25, price: 120, q: "dates 250g", group: "Fresh" },
];
const MONTHLY_EXTRAS = [
  { item: "Whey protein 1 kg (Avvatar, MuscleBlaze Raw or AS-IT-IS)", price: 2400, q: "whey protein 1kg" },
  { item: "Creatine monohydrate 250 g (AS-IT-IS or MuscleBlaze) — lasts 2 months", price: 300, q: "creatine monohydrate" },
  { item: "Pintola All Natural peanut butter 350 g — lasts 2 months", price: 100, q: "pintola all natural peanut butter" },
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
