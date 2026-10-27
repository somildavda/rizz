// Journey — plan data.
// User: 28y, 5'11" (180 cm), 94.5 kg, ~27% body fat, vegetarian, beginner. RIGHT knee ACL sprain
// (ortho, 24 Oct 2026; follow-up 9 Nov 2026): no stairs, squats, lunges, kneeling, jumping, running or
// cross-legged sitting. Gold's Gym Kandivali W at 8:30 am, 60-min sessions, ₹12K/month.
// Goal: V-taper with 2–4 visible abs, a better-shaped chest and a sharp jawline
// (Farhan Akhtar in Bhaag Milkha Bhaag; Hrithik-style grooming). Day 1 = 21 Oct 2026.

const PROFILE_DEFAULT = {
  name: "", age: 28, heightCm: 180, startWeight: 94.5, bodyFat: 27.2,
  targetDate: "2027-05-04", budget: 12000, diet: "veg",
  gym: "Gold's Gym, Kandivali West", knee: "Right knee ACL sprain (ortho 24 Oct 2026, follow-up 9 Nov 2026): no stairs, squats, lunges, kneeling, jumping, running or cross-legged sitting",
};
const START_DATE = "2026-10-21";
const GYM_TIME = "8:30 am"; // back by 9:30, so ~45 min in the gym

// Maintenance is ~2,850 kcal. 2–4 abs usually show at ~12–14% body fat, which for this
// starting point is ~79 kg — about 28 weeks at a sustainable 0.5–0.8 kg/week.
const PHASES = [
  { name: "Foundation", start: "2026-10-21", end: "2026-11-17", fromKg: 94.5, toKg: 91.5,
    kcal: 2050, protein: 145, carbs: 195, fat: 60, steps: 8000,
    focus: "Learn every exercise with light weights and build the daily habits. The first 1–2 kg is partly water.",
    food: "Follow the meal plan as written." },
  { name: "Fat loss I", start: "2026-11-18", end: "2027-01-12", fromKg: 91.5, toKg: 86.5,
    kcal: 2000, protein: 150, carbs: 175, fat: 60, steps: 10000,
    focus: "Add weight whenever you hit the top of the rep range. Harder Thursday intervals. Start walk-run.",
    food: "Night slot: dahi or hung curd only. One planned treat meal a week, Christmas and New Year included." },
  { name: "Fat loss II", start: "2027-01-13", end: "2027-03-09", fromKg: 86.5, toKg: 82.5,
    kcal: 1950, protein: 155, carbs: 180, fat: 55, steps: 11000,
    focus: "Chest and V-taper look starts to show. Keep strength up. First week is a diet break at ~2,600 kcal to reset.",
    food: "Dinner: swap rice for extra sabzi. Treat meal every 2 weeks." },
  { name: "Abs reveal", start: "2027-03-10", end: "2027-05-04", fromKg: 82.5, toKg: 79,
    kcal: 1900, protein: 160, carbs: 160, fat: 55, steps: 12000,
    focus: "Target ~12–14% body fat: upper 2 abs first, then 4. Ab training 3× a week, low salt before photos.",
    food: "No treat meals. Pre-gym snack only on leg and conditioning days." },
  { name: "Stay lean", start: "2027-05-05", end: "2027-08-31", fromKg: 79, toKg: 79,
    kcal: 2400, protein: 150, carbs: 260, fat: 65, steps: 10000,
    focus: "Hold ~12% body fat at the same weight: lean and athletic like Milkha, not bulky. Moderate weights for 10–15 reps, conditioning twice a week.",
    food: "Add 1 phulka at lunch and dinner. Keep salt and late dinners low so you don't look puffy." },
];
// Gym closures: every day in the range is a walk-only day with a stricter calorie target.
// Protein stays the same so you keep muscle while you can't lift.
const GYM_BREAKS = [{ from: "2026-10-27", to: "2026-11-05", kcal: -300, steps: 8000 }];
const gymBreak = (k) => GYM_BREAKS.find((b) => k >= b.from && k <= b.to);
const BREAK_RULES = [
  "Dinner: 1 phulka only and no rice at dinner. Fill the plate with extra sabzi or salad instead.",
  "Night: plain dahi only (or nothing). No milk drinks, no shake.",
  "No treat meal, no outside food, no extra nuts, makhana or fruit beyond the plan.",
  "Cook with the sprays in the recipe only. Weigh dal, rice, oats and atta dry.",
  "Dinner done by 8:30 pm; normal salt, no papad or pickle.",
  "Walk 8,000 flat steps in 2–3 parts: 10–15 min after lunch and after dinner helps fat loss and triglycerides.",
  "Keep 4 L water and the physio knee exercises every day.",
];
const DELOAD_WEEKS = [6, 12, 18, 24]; // weeks since start: same exercises, ~60% of the weight
const DAILY = { waterL: 4, sleepH: 7.5 }; // 4 L: BUN/creatinine ratio was high (Oct 2026)
// Daily calorie changes (kcal) on top of the phase target. Gym days eat a bit more, rest
// days less, and a skipped session or walk lowers that day's target automatically.
const ADJUST = { gymDay: 100, restDay: -150, skippedGym: -250, skippedWalk: -150 };

// Exercise: [name, sets, reps, note]. Beginner starting weights live in START_WEIGHTS.
// Milkha Athlete: 5 gym days (Mon–Fri, ~40–45 min in the gym for an 8:30–9:30 slot incl. travel),
// Sat flat walk, Sun rest. Built knee-safe for the right-knee ACL sprain: no squats, lunges,
// kneeling, jumping, running, single-leg standing, or getting down onto the floor.
// Two 4-week blocks (A → B → A …). Warm-up and cool-down are added by the app.
const ATHLETE_WEEK = [
  { day: "Day 1", title: "Push · chest, shoulders, triceps", ex: [
    ["Treadmill incline walk warm-up", 1, "5 min", ""],
    ["Machine chest press", 3, "10–12", ""],
    ["Incline dumbbell press", 3, "10–12", "Upper chest: key for chest shape"],
    ["Seated dumbbell shoulder press", 3, "10–12", "Back supported"],
    ["Cable lateral raise", 3, "12–15", "Side delts = width of the V"],
    ["Cable triceps pushdown", 3, "12–15", ""],
  ]},
  { day: "Day 2", title: "Legs (knee-safe) + core", ex: [
    ["Stationary bike warm-up", 1, "5 min", ""],
    ["Hip thrust", 3, "10–12", "Feet flat, no knee strain"],
    ["Dumbbell Romanian deadlift", 3, "10–12", "Hinge at the hips, soft knees"],
    ["Lying leg curl", 3, "12–15", "Light, slow, pain-free range only"],
    ["Hip abduction machine", 3, "15", "Strong hips protect the knee"],
    ["Dead bug (on a flat bench)", 3, "10/side", "No getting down to the floor"],
  ]},
  { day: "Day 3", title: "Pull · back, biceps", ex: [
    ["Rowing machine warm-up", 1, "5 min", ""],
    ["Lat pulldown", 3, "10–12", "Builds the V-taper"],
    ["Seated cable row", 3, "10–12", "Feet on the platform, knees soft"],
    ["Chest-supported dumbbell row", 3, "10–12", "Lie on an incline bench, feet on the floor, no kneeling"],
    ["Face pull", 3, "15", "Posture + rear delts"],
    ["Dumbbell curl", 3, "10–12", "Seated"],
  ]},
  { day: "Day 4", title: "Athlete conditioning (knee-safe)", ex: [
    ["Bike or elliptical warm-up", 1, "5 min", ""],
    ["Bike intervals", 6, "1 min hard / 1 min easy", ""],
    ["Kettlebell swing", 3, "15", ""],
    ["Farmer's carry", 3, "30 m", "Light weight, flat floor; stop if the knee hurts"],
    ["Pallof press", 3, "10/side", "Feet hip-width, no twisting at the knee"],
    ["Incline side plank (forearm on a bench)", 3, "20–30 s/side", ""],
  ]},
  { day: "Day 5", title: "Upper · V-taper + arms", ex: [
    ["Treadmill incline walk warm-up", 1, "5 min", ""],
    ["Lat pulldown (close grip)", 3, "8–10", "Replaces assisted pull-ups (their knee pad means kneeling)"],
    ["Dumbbell bench press", 3, "10–12", ""],
    ["Arnold press", 3, "10–12", "Seated"],
    ["Rear delt fly machine", 3, "15", ""],
    ["Hammer curl + overhead triceps", 3, "12 each", "Seated superset"],
  ]},
  { day: "Day 6", title: "Walk day", ex: [["This week's walk or run", 1, "see Run tab", ""], ["Mobility routine", 1, "15 min", ""]] },
  { day: "Day 7", title: "Sunday rest · gym closed", ex: [["Rest, meal prep, grocery order", 1, "—", ""]] },
];
const ATHLETE_WEEK_B = [
  { day: "Day 1", title: "Push B · chest, shoulders, triceps", ex: [
    ["Treadmill incline walk warm-up", 1, "5 min", ""],
    ["Dumbbell bench press", 3, "8–10", ""],
    ["Incline machine press", 3, "10–12", "Upper chest"],
    ["Machine shoulder press", 3, "10–12", ""],
    ["Dumbbell lateral raise", 3, "12–15", "Seated"],
    ["Overhead cable triceps extension", 3, "12–15", "Seated or standing on both feet"],
  ]},
  { day: "Day 2", title: "Legs B (knee-safe) + core", ex: [
    ["Stationary bike warm-up", 1, "5 min", ""],
    ["Cable pull-through", 3, "12–15", "Hips back, knees soft"],
    ["45° back extension", 3, "12", "Legs locked under the pad, knees straight"],
    ["Seated leg curl", 3, "12", "Light, slow, pain-free range only"],
    ["Hip adduction machine", 3, "15", "Inner thighs, protects the knee"],
    ["Pallof press", 3, "10/side", "Core"],
  ]},
  { day: "Day 3", title: "Pull B · back, biceps", ex: [
    ["Rowing machine warm-up", 1, "5 min", ""],
    ["Lat pulldown", 3, "8–10", "Wide grip"],
    ["Single-arm cable row", 3, "10/side", "Seated; replaces the one-knee-on-bench dumbbell row"],
    ["Wide-grip seated cable row", 3, "12", "Upper back"],
    ["Straight-arm cable pulldown", 3, "12–15", "Lats"],
    ["EZ-bar curl", 3, "10–12", ""],
  ]},
  { day: "Day 4", title: "Athlete conditioning B (knee-safe)", ex: [
    ["Rowing machine warm-up", 1, "5 min", ""],
    ["Rowing intervals", 6, "1 min hard / 1 min easy", ""],
    ["Battle ropes, seated on a bench", 6, "20 s on / 40 s off", "Seated keeps the knees out of it"],
    ["Farmer's carry", 3, "30 m", "Light weight, flat floor; stop if the knee hurts"],
    ["Incline plank (hands on a bench)", 3, "30–40 s", ""],
  ]},
  { day: "Day 5", title: "Upper B · V-taper + arms", ex: [
    ["Treadmill incline walk warm-up", 1, "5 min", ""],
    ["Lat pulldown (close grip)", 3, "10–12", ""],
    ["Machine chest press", 3, "10–12", ""],
    ["Seated dumbbell shoulder press", 3, "10–12", ""],
    ["Cable lateral raise", 3, "15", ""],
    ["Incline dumbbell curl + rope pushdown", 3, "12 each", "Superset"],
  ]},
  ATHLETE_WEEK[5], ATHLETE_WEEK[6],
];

const PROGRAMS = [
  { id: "athlete", name: "Milkha Athlete", days: 5, week: ATHLETE_WEEK, blocks: [ATHLETE_WEEK, ATHLETE_WEEK_B],
    by: "Inspired by Samir Jaura's athlete-style training, made knee-safe for the right-knee ACL sprain",
    why: "5 gym days (Mon–Fri, ~45 min), Saturday walk, Sunday rest." },
];
let WEEK = ATHLETE_WEEK;

// Right-knee ACL sprain: while rehab is on, every exercise list goes through kneeSafe().
const KNEE = {
  side: "Right", rehab: true, followUp: "2026-11-09", // the app turns rehab off when Settings says the ortho cleared you
  warn: "Right knee ACL sprain: no stairs, squats, lunges, kneeling, jumping, running or standing on the right leg alone. Pain or swelling means stop and use “Swap”. Ortho follow-up 9 Nov.",
  redFlags: ["The knee swells up or feels hot", "It gives way, buckles or locks", "Pain above 3/10 the next morning", "Pain or swelling in the calf"],
};
const FLAT_WARMUP = ["Flat treadmill walk warm-up", 1, "5 min", "Incline 0–1, easy pace"];
const KNEE_REHAB = {
  "Bike warm-up": FLAT_WARMUP, "Stationary bike warm-up": FLAT_WARMUP, "Rowing machine warm-up": FLAT_WARMUP,
  "Bike or elliptical warm-up": FLAT_WARMUP, "Treadmill incline walk warm-up": FLAT_WARMUP,
  "Incline walk finisher": ["Flat walk finisher", 1, "10 min", "Flat treadmill (incline 0–1), brisk"],
  "Bike intervals": ["Brisk flat walk intervals", 6, "1 min brisk / 1 min easy", "Flat treadmill, no running"],
  "Rowing intervals": ["Brisk flat walk intervals", 6, "1 min brisk / 1 min easy", "Flat treadmill, no running"],
  "Lying leg curl": ["Lying leg curl", 3, "12–15", "Very light (half your normal weight), slow, pain-free range only"],
  "Seated leg curl": ["Seated leg curl", 3, "12", "Very light (half your normal weight), slow, pain-free range only"],
  "Leg press (shallow range)": ["Weighted glute bridge", 3, "12–15", "Dumbbell on the hips, feet flat, squeeze glutes"],
  "Kettlebell swing": ["Cable pull-through", 3, "12–15", "Hips back, knees soft"],
  "Ab wheel from knees": ["Dead bug", 3, "10/side", "Lying on your back, no kneeling"],
  "This week's walk or run": ["Flat walk", 1, "30–40 min, as comfortable", "Flat ground only: no stairs, slopes or running"],
  "Mobility routine": ["Lying mobility routine", 1, "10 min", "On a bed or mat already at floor level: no kneeling to get down"],
};
function kneeSafe(list) {
  return KNEE.rehab ? list.map((e) => (KNEE_REHAB[e[0]] ? [...KNEE_REHAB[e[0]]] : e)) : list;
}
// Physio's daily knee exercises (every day, rest days included): [name, sets × reps, YouTube search].
const KNEE_EXERCISES = [
  ["Straight leg raise, lying down", "2 × 10", "straight leg raise exercise knee"],
  ["Pillow under the right knee, press it down", "2 × 10", "quadriceps setting exercise towel under knee"],
  ["Seated leg raise", "2 × 10", "seated knee extension leg raise exercise"],
  ["Pillow squeeze between the knees", "2 × 10", "pillow squeeze between knees adductor exercise"],
];

// Conservative first-session weights for a 94 kg beginner. Machines differ between gyms:
// pick the weight where the last 2 reps are hard but form stays clean, then progress.
const START_WEIGHTS = {
  "Machine chest press": "20–25 kg stack",
  "Incline dumbbell press": "10–12.5 kg each hand",
  "Seated dumbbell shoulder press": "8–10 kg each hand",
  "Cable lateral raise": "2.5–5 kg",
  "Cable triceps pushdown": "15–20 kg",
  "Hip thrust": "20 kg bar (empty) → add 10 kg/week",
  "Weighted glute bridge": "10–15 kg dumbbell on the hips",
  "Dumbbell Romanian deadlift": "12.5–15 kg each hand",
  "Lying leg curl": "10 kg (light during rehab)",
  "Seated leg curl": "10–15 kg (light during rehab)",
  "Hip abduction machine": "30–40 kg",
  "Hip adduction machine": "30–40 kg",
  "Lat pulldown": "30–35 kg",
  "Lat pulldown (close grip)": "30 kg",
  "Seated cable row": "30–35 kg",
  "Chest-supported dumbbell row": "12.5–15 kg each hand",
  "Single-arm cable row": "15–20 kg",
  "Wide-grip seated cable row": "30 kg",
  "Straight-arm cable pulldown": "15–20 kg",
  "Face pull": "10–15 kg (rope)",
  "Dumbbell curl": "7.5–10 kg each hand",
  "EZ-bar curl": "15 kg (bar + plates)",
  "Hammer curl + overhead triceps": "7.5–10 kg dumbbells",
  "Incline dumbbell curl + rope pushdown": "7.5 kg dumbbells / 15 kg stack",
  "Kettlebell swing": "12–16 kg kettlebell",
  "Cable pull-through": "15–20 kg",
  "Farmer's carry": "10–12.5 kg each hand (light during rehab)",
  "Pallof press": "7.5–10 kg",
  "Dumbbell bench press": "15–17.5 kg each hand",
  "Incline machine press": "20 kg stack",
  "Machine shoulder press": "15–20 kg",
  "Dumbbell lateral raise": "4–5 kg each hand",
  "Overhead cable triceps extension": "10–15 kg",
  "Arnold press": "7.5–10 kg each hand",
  "Rear delt fly machine": "15–20 kg",
};

// Meals: every ingredient as a RAW / DRY weight with the exact product, plus short steps
// for the cook. Vegetarian, home-cooked, low-bloat: no tofu, rajma, chole or kabuli chana.
// Each slot has 4 options; the app rotates them by date so every day is different.
const PANEER = "iD Fresh High Protein Paneer";
// Whey: Big Muscles Premium Gold Whey 1.5 kg (₹2,127 on Zepto, Informed Choice tested).
// The plan uses ~1–1.5 scoops a day, so 1.5 kg lasts ~5 weeks. If whey bloats, switch to an isolate.
const WHEY = "Big Muscles Gold whey";
const COOK_RULES = [
  "Weigh dal, brown rice, oats, poha, soya and atta DRY, before soaking or cooking.",
  `Paneer = ${PANEER} (from the fridge pack). Dahi = low-fat dahi set at home from Slim n Trim skimmed milk (warm 1 L milk, mix in 1 tbsp old dahi, cover 8 h). Milk = Amul Slim n Trim skimmed milk.`,
  "Oil = Tata Simply Better olive oil spray. 1 spray ≈ 1 second. No ghee, butter or extra oil.",
  "Atta = Milld High Protein Atta. 30 g dry atta = 1 phulka, no ghee on top.",
  "1 katori = 150 ml. No sugar in anything. Normal salt.",
  "Squeeze lemon on dal, palak and sprouts just before eating: vitamin C helps the body absorb their iron.",
  "No chai or coffee within 1 hour of a meal (it blocks iron absorption).",
  "For cholesterol: nothing fried, no sweets, maida, cream, cheese, butter, ghee or coconut. Brown rice, not white.",
  "Paneer cooks fast: add it at the end and cook 2 minutes only, or it turns rubbery.",
  "Home-made paneer (optional, instead of the pack): boil 1 L Slim n Trim milk, turn off the heat, wait 1 min, stir in 2 tbsp lemon juice. Strain in muslin, rinse, press under a weight 30 min. Gives ~120 g soft, low-fat paneer with ~25 g protein: best for bhurji, stuffing and chilla, not tikka cubes.",
  "Whey shake: liquid in the shaker first, then 1 LEVEL scoop (not heaped), shake 20 seconds. Never boil whey; stir it into oats after cooking.",
];
const TIKKA_STEPS = [
  "Cut the paneer into 2 cm cubes.",
  "Mix 30 g low-fat dahi + ½ tsp chilli powder + ¼ tsp haldi + ½ tsp garam masala + ½ tsp kasuri methi + ½ tsp ginger-garlic paste + lemon + salt.",
  "Coat the paneer and rest 15 minutes.",
  "Hot tawa or air fryer (180 °C), 3 sprays, cook 3 minutes per side until golden.",
];
const MEALS = [
  { time: "10:00", label: "Post-gym breakfast", options: [
    { name: "Protein oats", kcal: 500, p: 40,
      items: ["50 g Quaker rolled oats (dry)", "250 ml Amul Slim n Trim skimmed milk", `30 g ${WHEY} (1 level scoop)`, "1 banana (~100 g peeled)"],
      steps: ["Boil the milk, add the oats, cook 3–4 min stirring.", "Take off the heat, wait 1 min, then stir in the whey so it doesn't lump.", "Top with sliced banana. No sugar."] },
    { name: "Paneer besan chilla", kcal: 425, p: 49,
      items: ["50 g Tata Sampann besan", `100 g home-made paneer (from Slim n Trim milk), grated`, "30 g onion + 30 g tomato, finely chopped", "1 green chilli, coriander, pinch of ajwain, haldi, salt",
        "4–5 sprays olive oil", "2 tbsp green chutney (coriander + mint + lemon, no coconut)", `15 g ${WHEY} (½ level scoop) in 150 ml Amul Slim n Trim skimmed milk`],
      steps: ["Mix besan with ~90 ml water into a pouring batter; add onion, tomato, chilli, coriander, ajwain, haldi, salt.",
        "Spray a hot tawa, make 2 thin chillas, 2 min each side.", "Fill with grated paneer and chutney, fold.", "Serve with the whey-milk shake."] },
    { name: "Moong dal chilla + whey", kcal: 410, p: 41,
      items: ["½ lemon (squeeze on top)", "60 g Tata Sampann yellow moong dal (dry), soaked 4 h or overnight", "10 g ginger, 1 green chilli, ½ tsp jeera, salt", "4–5 sprays olive oil",
        "100 g low-fat dahi (home-set from Slim n Trim milk)", `30 g ${WHEY} (1 level scoop) in 250 ml cold water`],
      steps: ["Grind the soaked dal with ginger, chilli and ~60 ml water into a thick batter; add jeera and salt.",
        "Spray a hot tawa, make 2 chillas, 2 min each side.", "Serve with dahi. Drink the whey shake with it.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
    { name: "Paneer poha + whey", kcal: 550, p: 51,
      items: ["50 g thick poha (dry)", `75 g ${PANEER}, cubed`, "50 g green peas (frozen is fine)", "40 g onion, chopped", "½ tsp mustard seeds, 5 curry leaves, ¼ tsp haldi, salt, ½ lemon",
        "4–5 sprays olive oil", `30 g ${WHEY} (1 level scoop) in 250 ml cold water`],
      steps: ["Rinse poha in a strainer, leave 5 min to soften.", "Spray a kadhai; mustard seeds + curry leaves, then onion 2 min, peas 2 min, haldi + salt.",
        "Add poha and paneer, mix on low for 2 min.", "Squeeze lemon on top. Drink the whey shake with it."] },
  ]},
  { time: "1:30", label: "Lunch", options: [
    { name: "Dal-soya thali", kcal: 570, p: 42,
      items: ["½ lemon (squeeze on top)", "60 g Milld High Protein Atta → 2 phulka", "40 g Tata Sampann yellow moong dal (dry)", "40 g Fortune mini soya chunks (dry)",
        "50 g onion + 50 g tomato, 1 tsp ginger-garlic paste, ½ tsp each chilli / dhania / garam masala", "4–5 sprays olive oil",
        "Salad: 100 g cucumber + 50 g carrot", "100 g low-fat dahi (home-set from Slim n Trim milk)"],
      steps: ["Dal: pressure-cook with 250 ml water, haldi, salt, 3 whistles. Jeera tadka with 2 sprays.",
        "Soya: boil 5 min in salted water, squeeze out all water.", "Spray kadhai, cook onion → ginger-garlic → tomato + spices into masala, add soya, cook 5 min.",
        "Make 2 phulkas, no ghee.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
    { name: "Paneer bhurji thali", kcal: 505, p: 43,
      items: ["60 g Milld High Protein Atta → 2 phulka", `130 g home-made paneer (from Slim n Trim milk), crumbled`, "50 g onion + 50 g tomato + 50 g capsicum, chopped",
        "¼ tsp haldi, ½ tsp chilli, ½ tsp garam masala, salt", "30 g Tata Sampann yellow moong dal (dry)", "4–5 sprays olive oil", "Salad: 100 g cucumber"],
      steps: ["Spray kadhai, onion 2 min, tomato + capsicum 3 min, add spices.", "Add crumbled paneer, cook 2 min only.",
        "Dal: pressure-cook with 200 ml water, haldi, salt, 3 whistles.", "Make 2 phulkas, no ghee."] },
    { name: "Moong khichdi + paneer tikka", kcal: 555, p: 39,
      items: ["½ lemon (squeeze on top)", "40 g brown rice (dry, soaked 30 min) + 40 g Tata Sampann yellow moong dal (dry)", "100 g mixed veg (carrot, beans, peas)", "½ tsp jeera, ¼ tsp haldi, salt",
        "4–5 sprays olive oil", `75 g ${PANEER} for tikka (see tikka steps)`, "150 g low-fat dahi (home-set from Slim n Trim milk)"],
      steps: ["Wash brown rice and dal; pressure-cook with veg, haldi, salt and 500 ml water, 3 whistles.", "Jeera tadka with the sprays, pour over.",
        ...TIKKA_STEPS, "Serve with dahi.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
    { name: "Palak paneer + rice", kcal: 490, p: 42,
      items: ["½ lemon (squeeze on top)", `130 g home-made paneer (from Slim n Trim milk), cubed`, "200 g palak (1 small bunch)", "40 g onion + 40 g tomato + 2 garlic cloves + 1 green chilli", "½ tsp garam masala, salt",
        "60 g brown rice (dry, soaked 30 min)", "4–5 sprays olive oil", "Raita: 100 g low-fat dahi (home-set from Slim n Trim milk) + 50 g cucumber + roasted jeera powder + salt"],
      steps: ["Blanch palak 2 min, dip in cold water, blend smooth.", "Spray kadhai, onion + garlic + chilli 2 min, tomato 2 min, add palak purée, salt, garam masala, cook 3 min.",
        "Add paneer, 2 min only.", "Brown rice: 60 g (soaked) in 180 ml water, 20 min, cook covered.",
        "Raita: grate cucumber and squeeze out water, whisk into dahi with a pinch of roasted jeera powder and salt.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
  ]},
  { time: "5:00", label: "Snack", options: [
    { name: "Makhana + protein buttermilk", kcal: 190, p: 17,
      items: ["25 g Farmley roasted makhana (plain or pudina)", "1 pack Amul High Protein Buttermilk"],
      steps: ["If plain makhana: dry-roast 3 min on a tawa with 1 spray, add a pinch of salt and pepper."] },
    { name: "Whey shake + walnuts", kcal: 290, p: 36,
      items: [`30 g ${WHEY} (1 level scoop)`, "250 ml Amul Slim n Trim skimmed milk, cold", "15 g walnuts (about 4 halves)"],
      steps: ["Milk in the shaker first, then the whey; shake 20 seconds. Walnuts on the side."] },
    { name: "Paneer tikka bites", kcal: 265, p: 22,
      items: [`75 g ${PANEER}`, "Tikka marinade (30 g dahi + spices)", "2 tbsp mint chutney", "1 guava or apple"],
      steps: [...TIKKA_STEPS, "Serve with mint chutney and the fruit."] },
    { name: "Soya chaat + dahi", kcal: 170, p: 21,
      items: ["30 g Fortune mini soya chunks (dry)", "30 g onion + 30 g tomato + 30 g cucumber, chopped", "½ lemon, chaat masala, coriander", "100 g low-fat dahi (home-set from Slim n Trim milk)"],
      steps: ["Boil soya 5 min in salted water, squeeze dry, cool.", "Mix with the chopped veg, lemon, chaat masala and coriander.", "Dahi on the side."] },
  ]},
  { time: "8:30", label: "Dinner", options: [
    { name: "Soya pulao + raita", kcal: 450, p: 30,
      items: ["50 g brown rice (dry, soaked 30 min)", "40 g Fortune mini soya chunks (dry)", "80 g mixed veg (carrot, beans, peas) + 30 g onion",
        "1 bay leaf, 2 cloves, ½ tsp jeera, salt", "4–5 sprays olive oil",
        "Raita: 150 g low-fat dahi (home-set from Slim n Trim milk) + 50 g cucumber + 5 mint leaves + roasted jeera powder + salt"],
      steps: ["Boil soya 5 min in salted water, squeeze dry.", "Spray the cooker; whole spices + onion 2 min, veg + soya 2 min.",
        "Add brown rice, 150 ml water and salt; 4 whistles, then rest 10 min.", "Raita: grate cucumber and squeeze out water, whisk into dahi with chopped mint, jeera powder and salt."] },
    { name: "Paneer-veg stir-fry", kcal: 545, p: 39,
      items: [`100 g ${PANEER}, cubed`, "200 g veg: capsicum, beans, broccoli or cabbage", "2 garlic cloves, 1 tsp soy sauce, black pepper",
        "4–5 sprays olive oil", "60 g Milld High Protein Atta → 2 phulka"],
      steps: ["Spray kadhai on high heat, garlic 30 seconds.", "Add veg, toss 4 min (keep crunchy).", "Add paneer, soy sauce and pepper, 2 min.", "Make 2 phulkas, no ghee."] },
    { name: "Dal + soya-matar", kcal: 540, p: 36,
      items: ["½ lemon (squeeze on top)", "40 g yellow moong or masoor dal (dry)", "30 g Fortune mini soya chunks (dry) + 50 g green peas", "50 g onion + 50 g tomato, ginger-garlic, spices",
        "4–5 sprays olive oil", "60 g Milld High Protein Atta → 2 phulka", "Salad: 100 g cucumber"],
      steps: ["Dal: pressure-cook with 250 ml water, haldi, salt, 3 whistles; jeera tadka with 2 sprays.", "Soya: boil 5 min, squeeze dry.",
        "Spray kadhai, make onion-tomato masala, add soya + peas, cook 5 min.", "Make 2 phulkas, no ghee.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
    { name: "Paneer tikka bowl", kcal: 480, p: 35,
      items: [`100 g ${PANEER}`, "Tikka marinade (30 g dahi + spices)", "50 g brown rice (dry, soaked 30 min)", "150 g veg: capsicum, onion, beans", "2–3 sprays olive oil"],
      steps: [...TIKKA_STEPS, "Brown rice: 50 g (soaked) in 150 ml water, 20 min, cook covered.", "Sauté the veg with the sprays 4 min, salt and pepper.", "Serve paneer and veg on the rice."] },
  ]},
  { time: "10:00", label: "Night", options: [
    { name: "Dahi", kcal: 70, p: 7, items: ["200 g low-fat dahi (home-set from Slim n Trim milk), plain"], steps: ["Serve as it is. No sugar."] },
    { name: "Haldi milk", kcal: 85, p: 8, items: ["250 ml Amul Slim n Trim skimmed milk", "¼ tsp haldi + pinch of black pepper"], steps: ["Boil the milk with haldi and pepper for 2 min. No sugar."] },
    { name: "Hung curd + cinnamon", kcal: 70, p: 10, items: ["200 g low-fat dahi (home-set from Slim n Trim milk)", "Pinch of cinnamon"],
      steps: ["Tie the dahi in a muslin cloth, hang it in the fridge for 2 hours (leaves ~120 g thick curd).", "Top with cinnamon."] },
    { name: "Slow protein shake", kcal: 130, p: 19, items: [`15 g ${WHEY} (½ level scoop)`, "200 ml Amul Slim n Trim skimmed milk"], steps: ["Shake together. Drink 30 min before bed."] },
  ]},
];
// ---- More variety: extra dishes per slot (same calories/protein band as the originals). ----
// Slot sizes differ (breakfast 9, lunch 10, snack 7, dinner 11, night 5), so a dish returns
// only after 1–1.5 weeks and no full day repeats within 30 days.
MEALS[0].options.push(
  { name: "Daliya upma + whey", kcal: 465, p: 43, fib: 7,
    items: ["½ lemon (squeeze on top)", "40 g daliya (broken wheat, dry)", "80 g veg: carrot, beans, peas, onion", `50 g ${PANEER}, cubed`, "½ tsp mustard seeds, curry leaves, salt",
      "4–5 sprays olive oil", "100 g low-fat dahi (home-set from Slim n Trim milk)", `30 g ${WHEY} (1 level scoop) in 250 ml cold water`],
    steps: ["Dry-roast daliya 2 min.", "Spray a cooker; mustard seeds + curry leaves, then veg 2 min.", "Add daliya, salt and 160 ml water; 2 whistles.",
      "Stir in paneer for the last minute. Dahi on the side; drink the whey shake.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
  { name: "Ragi-oats porridge", kcal: 435, p: 39, fib: 9,
    items: ["25 g ragi flour", "25 g Quaker rolled oats (dry)", "250 ml Amul Slim n Trim skimmed milk", `30 g ${WHEY} (1 level scoop)`, "10 g chia seeds (1 tbsp)", "Pinch of cardamom"],
    steps: ["Whisk ragi into the cold milk so it doesn't lump.", "Add oats, cook on low 5 min, stirring.", "Off the heat, wait 1 min, stir in whey and chia.", "Cardamom on top. No sugar."] },
  { name: "Sprouts + paneer bowl", kcal: 475, p: 50, fib: 8,
    items: ["40 g whole green moong, sprouted at home (~120 g sprouts)", `75 g ${PANEER}, tikka-style`, "50 g onion + tomato + cucumber, chopped",
      "½ lemon, chaat masala", `15 g ${WHEY} (½ level scoop) in 200 ml Amul Slim n Trim skimmed milk`],
    steps: ["Sprouts: soak 8 h, drain, keep covered 24 h until they sprout.", "Steam sprouts 5 min (easier to digest).", "Mix with chopped veg, lemon and chaat masala.",
      "Tawa the paneer cubes with 2 sprays, add on top. Drink the shake."] },
  { name: "Oats-besan uttapam + guava", kcal: 460, p: 47, fib: 10,
    items: ["25 g Quaker rolled oats, ground + 20 g Tata Sampann besan + 40 g low-fat dahi (home-set from Slim n Trim milk) → batter", "60 g onion + tomato + capsicum, finely chopped",
      `65 g home-made paneer (from Slim n Trim milk), grated`, "3–4 sprays olive oil", "1 guava", `30 g ${WHEY} (1 level scoop) in 250 ml cold water`],
    steps: ["Mix ground oats, besan, dahi, salt and ~50 ml water; rest 10 min.", "Spray a tawa, spread 2 small uttapams, top with veg and paneer.",
      "Cover and cook 3 min, flip for 1 min.", "Guava on the side; drink the whey shake."] },
  { name: "Overnight oats", kcal: 480, p: 37, fib: 12,
    items: ["50 g Quaker rolled oats (dry)", "150 g low-fat dahi (home-set from Slim n Trim milk)", "50 ml Amul Slim n Trim skimmed milk", `30 g ${WHEY} (1 level scoop)`, "10 g chia seeds (1 tbsp)", "1 apple, chopped"],
    steps: ["At night: mix oats, dahi, milk, whey and chia in a jar.", "Refrigerate overnight.", "Morning: top with apple. Eat cold. No cooking needed."] },
);
MEALS[1].options.push(
  { name: "Masoor dal + bhindi thali", kcal: 590, p: 38, fib: 15,
    items: ["½ lemon (squeeze on top)", "40 g masoor dal (dry)", "150 g bhindi, sliced", `50 g ${PANEER}, cubed into the dal`, "60 g Milld High Protein Atta → 2 phulka", "4–5 sprays olive oil", "100 g low-fat dahi (home-set from Slim n Trim milk)"],
    steps: ["Dal: pressure-cook with 250 ml water, haldi, salt, 2 whistles; add paneer, simmer 2 min.",
      "Bhindi: wipe dry before cutting; spray kadhai, cook uncovered 8 min with salt, haldi, amchur.", "2 phulkas, no ghee. Dahi on the side.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
  { name: "Soya keema + roti", kcal: 505, p: 36, fib: 15,
    items: ["40 g Fortune mini soya chunks (dry), pulsed into keema", "50 g green peas", "50 g onion + 50 g tomato, ginger-garlic, garam masala",
      "60 g Milld High Protein Atta → 2 phulka", "4–5 sprays olive oil", "100 g low-fat dahi (home-set from Slim n Trim milk)"],
    steps: ["Boil soya 5 min, squeeze dry, pulse in a mixer (2–3 seconds) into mince.", "Spray kadhai, cook onion → ginger-garlic → tomato + spices.",
      "Add soya keema and peas, cook 6 min.", "2 phulkas, no ghee. Dahi on the side."] },
  { name: "Paneer kathi roll", kcal: 570, p: 41, fib: 9,
    items: ["60 g Milld High Protein Atta → 2 thin rotis", `100 g ${PANEER} for tikka (see tikka steps)`, "100 g onion + capsicum + cabbage, sliced",
      "2 tbsp mint chutney", "100 g low-fat dahi (home-set from Slim n Trim milk)"],
    steps: ["Make paneer tikka (marinate 15 min, tawa with 3 sprays).", "Toss the sliced veg on the tawa 2 min.",
      "Spread chutney on each roti, fill with paneer and veg, roll tightly.", "Dahi on the side."] },
  { name: "Veg daliya khichdi + raita", kcal: 560, p: 41, fib: 12,
    items: ["½ lemon (squeeze on top)", "40 g daliya + 30 g yellow moong dal (dry)", "150 g veg: carrot, beans, peas, lauki", `75 g ${PANEER}, cubed`, "½ tsp jeera, haldi, salt, 4–5 sprays olive oil",
      "Raita: 150 g low-fat dahi (home-set from Slim n Trim milk) + 50 g grated cucumber + roasted jeera + salt"],
    steps: ["Wash daliya and dal; pressure-cook with veg, haldi, salt and 450 ml water, 3 whistles.", "Jeera tadka with the sprays; stir in paneer, 2 min.",
      "Raita: squeeze the cucumber dry, whisk into dahi with jeera and salt.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
  { name: "Toor dal + lauki + rice", kcal: 595, p: 36, fib: 11,
    items: ["½ lemon (squeeze on top)", "40 g toor dal (dry)", "200 g lauki, cubed", "50 g brown rice (dry, soaked 30 min)", `75 g ${PANEER} tikka`, "Salad: 100 g cucumber + carrot", "4–5 sprays olive oil"],
    steps: ["Dal: pressure-cook with 250 ml water, haldi, salt, 3 whistles; jeera tadka.", "Lauki: spray kadhai, jeera, lauki + salt + haldi, cover 8 min.",
      "Brown rice: 50 g (soaked) in 150 ml water, 20 min.", "Paneer tikka: see tikka steps.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
  { name: "Methi paneer + jowar roti", kcal: 520, p: 44, fib: 11,
    items: ["50 g jowar flour → 2 rotis", `130 g home-made paneer (from Slim n Trim milk), crumbled`, "50 g fresh methi leaves, chopped", "50 g onion + 50 g tomato",
      "30 g yellow moong dal (dry)", "4–5 sprays olive oil", "Salad: 100 g cucumber"],
    steps: ["Jowar roti: knead flour with hot water, pat thin between sheets, cook on tawa both sides.", "Spray kadhai, onion 2 min, methi 3 min, tomato 2 min, spices.",
      "Add paneer, 2 min only.", "Dal: pressure-cook with 200 ml water, haldi, salt, 3 whistles."] },
);
MEALS[2].options.push(
  { name: "Hung curd + apple + chia", kcal: 195, p: 14, fib: 6,
    items: ["250 g low-fat dahi (home-set from Slim n Trim milk) hung for 2 h (~150 g)", "1 apple, chopped", "5 g chia seeds (1 tsp)", "Pinch of cinnamon"],
    steps: ["Hang the dahi in muslin in the fridge for 2 hours.", "Top with apple, chia and cinnamon."] },
  { name: "Sprouts chaat + whey", kcal: 265, p: 26, fib: 9,
    items: ["40 g whole green moong, sprouted (~120 g)", "Onion, tomato, cucumber, lemon, chaat masala", "100 g low-fat dahi (home-set from Slim n Trim milk)", `15 g ${WHEY} (½ level scoop) in 200 ml water`],
    steps: ["Steam sprouts 5 min, cool.", "Mix with chopped veg, lemon and chaat masala.", "Dahi on the side; drink the shake."] },
  { name: "Makhana + whey + guava", kcal: 260, p: 29, fib: 7,
    items: ["20 g Farmley roasted makhana", `30 g ${WHEY} (1 level scoop) in 250 ml water`, "1 guava"],
    steps: ["Makhana as is (or dry-roast 3 min with 1 spray and pepper).", "Shake the whey; guava on the side."] },
);
MEALS[3].options.push(
  { name: "Grilled paneer + veg + roti", kcal: 500, p: 41, fib: 10,
    items: [`100 g ${PANEER}`, "200 g veg: broccoli, beans, carrot", "30 g Milld High Protein Atta → 1 phulka", "Raita: 150 g low-fat dahi (home-set from Slim n Trim milk) + mint", "3–4 sprays olive oil, pepper, garlic"],
    steps: ["Slice paneer thick, sprinkle salt, pepper, chilli; tawa with 2 sprays, 2 min each side.", "Toss veg with garlic and 2 sprays, 5 min (keep crunchy).", "1 phulka; mint raita on the side."] },
  { name: "Moong cheela + palak raita", kcal: 415, p: 36, fib: 8,
    items: ["½ lemon (squeeze on top)", "60 g yellow moong dal (dry), soaked 4 h", `65 g home-made paneer (from Slim n Trim milk), grated, as stuffing`, "Raita: 150 g low-fat dahi (home-set from Slim n Trim milk) + 50 g blanched palak, chopped", "Salad: 100 g cucumber", "4 sprays olive oil"],
    steps: ["Grind dal with ginger, chilli, salt into a thick batter.", "Spray tawa, make 2 cheelas, stuff with paneer.", "Raita: blanch palak 1 min, chop, mix into dahi with salt and jeera.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
  { name: "Paneer-capsicum curry + rice", kcal: 550, p: 35, fib: 8,
    items: [`100 g ${PANEER}, cubed`, "100 g capsicum", "50 g onion + 50 g tomato gravy, ginger-garlic, spices", "50 g brown rice (dry, soaked 30 min)", "Salad: 100 g cucumber", "4–5 sprays olive oil"],
    steps: ["Spray kadhai, onion → ginger-garlic → tomato + spices into a gravy, add 100 ml water.", "Add capsicum 3 min, paneer 2 min.", "Brown rice: 50 g (soaked) in 150 ml water, 20 min."] },
  { name: "Masoor soup + paneer tikka", kcal: 535, p: 43, fib: 10,
    items: ["40 g masoor dal (dry)", "100 g veg: carrot, tomato, onion, garlic", `100 g ${PANEER} tikka`, "30 g Milld High Protein Atta → 1 phulka", "3 sprays olive oil"],
    steps: ["Pressure-cook dal and veg with 400 ml water, salt, haldi, 3 whistles; blend smooth, add pepper and lemon.", "Paneer tikka: see tikka steps.", "1 phulka."] },
  { name: "Soya-palak curry + roti", kcal: 465, p: 32, fib: 15,
    items: ["½ lemon (squeeze on top)", "30 g Fortune mini soya chunks (dry)", "150 g palak", "50 g onion + 50 g tomato, garlic, garam masala", "60 g Milld High Protein Atta → 2 phulka", "100 g low-fat dahi (home-set from Slim n Trim milk)", "4 sprays olive oil"],
    steps: ["Boil soya 5 min, squeeze dry.", "Blanch palak 2 min, blend.", "Spray kadhai, onion-garlic-tomato masala, add palak purée and soya, 5 min.", "2 phulkas; dahi on the side.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
  { name: "Lauki moong dal + paneer", kcal: 530, p: 31, fib: 12,
    items: ["½ lemon (squeeze on top)", "30 g yellow moong dal (dry)", "200 g lauki", `50 g ${PANEER}, cubed`, "60 g Milld High Protein Atta → 2 phulka", "Salad: 100 g cucumber + carrot", "3 sprays olive oil"],
    steps: ["Pressure-cook dal + lauki with 300 ml water, haldi, salt, 3 whistles.", "Jeera tadka with sprays; add paneer, 2 min.", "2 phulkas.", "Squeeze the lemon on top just before eating (helps absorb iron)."] },
  { name: "Stuffed capsicum + raita", kcal: 385, p: 39, fib: 7,
    items: ["2 capsicums (~200 g)", `130 g home-made paneer (from Slim n Trim milk), crumbled, with onion + spices`, "30 g Milld High Protein Atta → 1 phulka", "Raita: 150 g low-fat dahi (home-set from Slim n Trim milk) + cucumber", "3 sprays olive oil"],
    steps: ["Cut capsicum tops, remove seeds.", "Fill with paneer mixed with onion, salt, chilli, garam masala.",
      "Cook covered on a tawa or kadhai with 3 sprays, 10 min, turning.", "1 phulka; raita on the side."] },
);
MEALS[4].options.push(
  { name: "Flax-cinnamon milk", kcal: 110, p: 8, fib: 3,
    items: ["200 ml Amul Slim n Trim skimmed milk", "1 tsp ground flaxseed", "Pinch of cinnamon"],
    steps: ["Warm the milk, stir in flax and cinnamon. No sugar."] },
);
// Fiber (g) for the original dishes.
const FIBER = {
  "Protein oats": 8, "Paneer besan chilla": 6, "Moong dal chilla + whey": 5, "Paneer poha + whey": 4,
  "Dal-soya thali": 14, "Paneer bhurji thali": 11, "Moong khichdi + paneer tikka": 7, "Palak paneer + rice": 7,
  "Makhana + protein buttermilk": 2, "Whey shake + walnuts": 2, "Paneer tikka bites": 5, "Soya chaat + dahi": 6,
  "Soya pulao + raita": 7, "Paneer-veg stir-fry": 12, "Dal + soya-matar": 15, "Paneer tikka bowl": 5,
  "Dahi": 0, "Haldi milk": 0, "Hung curd + cinnamon": 0, "Slow protein shake": 0,
};
MEALS.forEach((slot) => slot.options.forEach((o) => { o.fib ??= FIBER[o.name] ?? 0; }));
// Blood report (Oct 2026): every breakfast gets 1 tbsp ground flaxseed (soluble fiber + omega-3).
MEALS[0].options.forEach((o) => {
  if (!o.items.some((x) => /flax/i.test(x))) {
    o.items.push("1 tbsp (7 g) ground flaxseed"); o.steps.push("Stir in 1 tbsp ground flaxseed just before serving.");
    o.kcal += 35; o.fib += 2;
  }
});
const FIBER_TARGET = 30; // g a day

// ---- Weekly menus: week 1 = the dishes above; weeks 2–4 bring a new set of dishes each week,
// then the 4-week cycle repeats. Each week has 7 dishes per meal (one per day) in the same
// calorie / protein band as week 1. Same rules: low oil, no tofu, rajma, chole, roasted chana or peanuts.
const HM = "home-made paneer (from Slim n Trim milk)", DH = "low-fat dahi (home-set from Slim n Trim milk)",
  MK = "Amul Slim n Trim skimmed milk", AT = "Milld High Protein Atta", SY = "Fortune mini soya chunks (dry)";
const LEMON_ITEM = "½ lemon (squeeze on top)", LEMON_STEP = "Squeeze the lemon on top just before eating (helps absorb iron).";
const dish = (name, kcal, p, fib, items, steps, lemon) =>
  ({ name, kcal, p, fib, items: lemon ? [LEMON_ITEM, ...items] : items, steps: lemon ? [...steps, LEMON_STEP] : steps });
const SOYA_BOIL = "Boil soya 5 min in salted water, squeeze out all the water.";
const PHULKA = (n) => `${n * 30} g ${AT} → ${n} phulka${n > 1 ? "s" : ""}`;
const TAWA_PANEER = "Tawa with 2 sprays, paneer 2 min per side (no longer, or it turns rubbery).";
const WHEY_W = (g) => `${g} g ${WHEY} (${g === 30 ? "1 level scoop" : "½ level scoop"}) in ${g === 30 ? 250 : 200} ml cold water`;

const MENU_THEMES = { 1: "Classic home menu", 2: "South Indian + Gujarati", 3: "Maharashtrian + Punjabi", 4: "Indo-Chinese, wraps, bowls + millets" };
const MENU_WEEKS = {
  2: [
    [ // Breakfast
      dish("Pesarattu + paneer", 410, 49, 8, ["50 g whole green moong (dry), soaked overnight", "10 g ginger, 1 green chilli, ½ tsp jeera, salt", `65 g ${HM}, crumbled`, "30 g onion, chopped", "2 tbsp tomato chutney (tomato + garlic + chilli, no coconut)", "3–4 sprays olive oil", WHEY_W(30)],
        ["Grind the soaked moong with ginger, chilli and ~60 ml water into a smooth batter; add jeera and salt.", "Spray a hot tawa, spread 2 thin dosas, sprinkle onion, cook 2 min, flip 1 min.", "Fill with paneer, fold. Tomato chutney on the side; drink the whey shake."], true),
      dish("Ragi dosa + paneer bhurji", 475, 50, 7, ["40 g ragi flour + 20 g urad dal flour (or ground soaked urad)", "100 g " + DH + " (half in the batter, half on the side)", `50 g ${PANEER}, crumbled`, "30 g onion + 30 g tomato, curry leaves", "3–4 sprays olive oil", WHEY_W(30)],
        ["Mix ragi, urad, 50 g dahi, salt and ~100 ml water into a thin batter; rest 10 min.", "Bhurji: spray kadhai, onion + curry leaves 2 min, tomato 2 min, paneer 2 min.", "Spray a hot tawa, pour 2 thin dosas, 2 min, flip 30 s.", "Fill with bhurji. Rest of the dahi on the side; drink the whey shake."]),
      dish("Oats-moong idli + chutney", 475, 48, 7, ["30 g Quaker oats, ground + 40 g yellow moong dal (dry), soaked 3 h", "50 g " + DH, "30 g grated carrot, ½ tsp mustard seeds, curry leaves, salt", "2 tbsp coriander-mint chutney (no coconut)", `30 g ${WHEY} (1 level scoop) in 250 ml ${MK}`],
        ["Grind the dal with very little water; mix in ground oats, dahi, carrot, salt. Rest 15 min.", "Spray idli plates, fill, steam 12 min (makes ~6 small idlis).", "Mustard + curry leaf tadka with 1 spray on top.", "Chutney on the side; drink the whey-milk."], true),
      dish("Adai (mixed dal dosa)", 435, 41, 8, ["20 g brown rice + 20 g toor dal + 20 g yellow moong dal + 10 g urad dal (dry), soaked 4 h", "1 dry red chilli, ginger, curry leaves, pinch hing, salt", "30 g onion, chopped", "4 sprays olive oil", "100 g " + DH, WHEY_W(30)],
        ["Grind everything coarse with ~70 ml water; add onion and salt.", "Spray a hot tawa, spread 2 thick adais, 3 min, flip 2 min.", "Dahi on the side; drink the whey shake."], true),
      dish("Lauki-oats handvo", 470, 41, 8, ["40 g Quaker oats, ground + 30 g Tata Sampann besan", "100 g " + DH, "100 g lauki, grated and squeezed", "½ tsp sesame seeds, ½ tsp mustard seeds, ginger-chilli paste, haldi, salt, pinch of eno", "4 sprays olive oil", WHEY_W(30)],
        ["Mix oats, besan, dahi, lauki, ginger-chilli, haldi, salt; rest 10 min, then stir in eno.", "Spray a small non-stick pan, mustard + sesame, pour the batter 1.5 cm thick.", "Cover, low heat 10 min, flip, 6 min more. Cut in wedges.", "Drink the whey shake with it."]),
      dish("Methi thepla + hung curd", 415, 43, 8, [`50 g ${AT} + 20 g fresh methi leaves, chopped`, "Haldi, ajwain, chilli, salt", "250 g " + DH + ", hung 2 h (~150 g)", "3 sprays olive oil", WHEY_W(30)],
        ["Knead atta with methi, spices, salt and water (no oil).", "Roll 2 thin theplas, cook on tawa with sprays, 1 min per side.", "Hung curd on the side; drink the whey shake."]),
      dish("Masala oats + paneer", 435, 42, 7, ["50 g Quaker rolled oats (dry)", `75 g ${HM}, cubed`, "80 g veg: onion, carrot, peas, capsicum", "½ tsp mustard seeds, curry leaves, haldi, salt", "3 sprays olive oil", `15 g ${WHEY} (½ level scoop) in 150 ml ${MK}`],
        ["Spray a pan, mustard + curry leaves, veg 3 min.", "Add oats, haldi, salt and 200 ml water; cook 3 min.", "Stir in paneer for 1 min.", "Drink the whey-milk with it."]),
    ],
    [ // Lunch
      dish("Sambar + brown rice + paneer tikka", 560, 37, 11, ["40 g toor dal (dry)", "150 g veg: drumstick, lauki, tomato, onion", "1 tsp sambar powder, tamarind (pea size), curry leaves, mustard seeds", "50 g brown rice (dry, soaked 30 min)", `75 g ${PANEER} for tikka (see tikka steps)`, "4 sprays olive oil"],
        ["Pressure-cook dal with haldi and 300 ml water, 3 whistles; mash.", "Cook veg in 200 ml water with tamarind and sambar powder 8 min; add dal, simmer 3 min.", "Tadka: mustard + curry leaves with 2 sprays.", "Brown rice: 50 g (soaked) in 150 ml water, 20 min.", ...TIKKA_STEPS], true),
      dish("Gujarati thali", 545, 47, 12, ["30 g toor dal (dry), for Gujarati dal (no sugar or jaggery)", PHULKA(2), "150 g cabbage + 50 g peas shaak", `100 g ${HM}, cubed into the shaak`, "100 g " + DH, "4 sprays olive oil"],
        ["Dal: pressure-cook with haldi, 3 whistles; add tomato, ginger, kokum or lemon, simmer 5 min.", "Shaak: spray kadhai, mustard + hing, cabbage + peas + haldi + salt, cover 6 min, add paneer 2 min.", "2 phulkas, no ghee. Dahi on the side."], true),
      dish("Curd rice + soya + paneer", 520, 42, 7, ["50 g brown rice (dry, soaked 30 min)", "200 g " + DH, `30 g ${SY}`, `50 g ${PANEER}, cubed`, "50 g cucumber + carrot, grated", "Mustard seeds, curry leaves, ginger, 1 green chilli", "3 sprays olive oil"],
        ["Cook brown rice soft (50 g in 180 ml water, 25 min), cool.", "Mix rice with dahi, cucumber, carrot, salt.", "Tadka with 2 sprays: mustard, curry leaves, ginger, chilli; pour over.", SOYA_BOIL + " Toss soya and paneer on the tawa with 1 spray, salt and chilli, 3 min. Serve on the side."]),
      dish("Millet bisi bele bath + tikka", 545, 40, 12, ["40 g foxtail millet (dry, soaked 30 min) + 40 g toor dal (dry)", "150 g veg: carrot, beans, peas, capsicum", "1 tsp bisi bele bath (or sambar) powder, tamarind (pea size)", `75 g ${PANEER} for tikka (see tikka steps)`, "Raita: 100 g " + DH + " + cucumber", "4 sprays olive oil"],
        ["Pressure-cook millet, dal and veg with tamarind, powder, haldi, salt and 600 ml water, 3 whistles.", "Tadka with 2 sprays: mustard + curry leaves; pour over.", ...TIKKA_STEPS, "Raita on the side."], true),
      dish("Methi muthiya + kadhi + tikka", 550, 43, 11, [`30 g ${AT} + 20 g jowar flour + 20 g besan`, "50 g fresh methi, chopped; ginger-chilli, haldi, salt", "Kadhi: 150 g " + DH + " + 10 g besan, curry leaves, ginger", `75 g ${PANEER} for tikka (see tikka steps)`, "3 sprays olive oil"],
        ["Mix flours, methi, spices, salt and a little water into a soft dough; shape 2 logs.", "Steam 15 min, cool, slice; tawa with 2 sprays and sesame 2 min.", "Kadhi: whisk dahi, besan and 200 ml water; simmer 8 min, stirring, with ginger and curry leaves (no sugar).", ...TIKKA_STEPS]),
      dish("Palak dal + jowar roti + paneer", 535, 40, 13, ["40 g yellow moong dal (dry)", "150 g palak, chopped", "50 g jowar flour → 2 rotis", `75 g ${PANEER}, cubed`, "Garlic, jeera, haldi, salt", "4 sprays olive oil"],
        ["Pressure-cook dal with palak, haldi, salt, 300 ml water, 3 whistles.", "Garlic-jeera tadka with 2 sprays; add paneer, 2 min.", "Jowar roti: knead with hot water, pat thin between sheets, cook both sides on the tawa."], true),
      dish("Light undhiyu + phulka", 560, 41, 12, ["200 g veg: surti papdi (or beans), brinjal, 50 g sweet potato", "Green masala: coriander, ginger, chilli, garlic, ajwain (no coconut)", `75 g ${PANEER}, cubed`, PHULKA(2), "100 g " + DH, "4 sprays olive oil"],
        ["Toss veg with green masala, haldi, salt.", "Spray a cooker, add veg + 80 ml water, 2 whistles.", "Stir in paneer, 2 min.", "2 phulkas. Dahi on the side."]),
    ],
    [ // Snack
      dish("Khaman dhokla + protein chaas", 250, 24, 4, ["40 g besan, 30 g " + DH + ", ginger-chilli paste, pinch eno (no sugar)", "Tadka: mustard seeds, curry leaves, 1 spray", "1 pack Amul High Protein Buttermilk"],
        ["Mix besan, dahi, ginger-chilli, salt and ~50 ml water; rest 10 min, add eno.", "Steam in a greased plate 12 min. Cut in squares.", "Tadka with lemon on top. Drink the buttermilk."]),
      dish("Moong sundal + whey", 205, 22, 7, ["40 g whole green moong (dry), soaked overnight", "Mustard seeds, curry leaves, 1 green chilli, grated carrot", "1 spray olive oil", WHEY_W(15)],
        ["Pressure-cook moong 1 whistle (soft but whole), drain.", "Spray pan, mustard + curry leaves + chilli, add moong and carrot, salt.", "Drink the shake."], true),
      dish("Grilled paneer + guava + chaas", 230, 29, 6, [`70 g ${HM}, cubed`, "Chaat masala, chilli, 1 spray", "1 guava", "1 pack Amul High Protein Buttermilk"],
        [TAWA_PANEER, "Sprinkle chaat masala. Guava on the side; drink the buttermilk."]),
      dish("Ragi malt (no sugar)", 210, 22, 3, ["20 g ragi flour", `250 ml ${MK}`, `15 g ${WHEY} (½ level scoop)`, "Pinch of cardamom"],
        ["Whisk ragi into 50 ml water, then into the milk; cook on low 5 min, stirring.", "Off the heat, wait 1 min, stir in the whey. Cardamom on top."]),
      dish("Hung curd dip + veg sticks", 265, 25, 5, ["250 g " + DH + ", hung 2 h (~150 g)", "Garlic, mint, pepper, salt", "200 g carrot + cucumber sticks", "15 g Farmley makhana", WHEY_W(15)],
        ["Mix hung curd with grated garlic, chopped mint, pepper and salt.", "Dip the veg sticks; makhana on the side. Drink the shake."]),
      dish("Soya-makhana bhel", 240, 22, 5, [`25 g ${SY}`, "15 g Farmley makhana", "10 g pumpkin seeds", "Onion, tomato, cucumber, coriander, lemon, chaat masala, mint chutney"],
        [SOYA_BOIL + " Chop small.", "Mix everything just before eating so the makhana stays crunchy."], true),
      dish("Apple + walnuts + whey", 265, 26, 4, ["1 apple", "10 g walnuts (about 3 halves)", WHEY_W(30)],
        ["Slice the apple, walnuts on the side. Drink the shake."]),
    ],
    [ // Dinner
      dish("Rasam + paneer-veg + phulka", 465, 40, 8, ["20 g toor dal (dry) for rasam", "Tomato, tamarind (pea size), rasam powder, garlic, curry leaves", `100 g ${PANEER}, cubed`, "150 g veg: beans, carrot, capsicum", PHULKA(1), "4 sprays olive oil"],
        ["Rasam: pressure-cook dal; boil with tomato, tamarind, rasam powder and 300 ml water 8 min; tadka with 1 spray.", "Spray kadhai, veg 4 min, paneer 2 min, salt and pepper.", "1 phulka. Drink the rasam hot."], true),
      dish("Soya-veg kurma + phulka", 452, 37, 13, [`35 g ${SY}`, "150 g veg: carrot, beans, cauliflower + 50 g peas", "Gravy: onion, tomato, 50 g " + DH + ", poppy seeds (1 tsp), whole spices (no coconut)", PHULKA(2), "4 sprays olive oil"],
        [SOYA_BOIL, "Blend onion, tomato and poppy seeds; spray kadhai, whole spices, cook the paste 5 min.", "Add veg, soya and 150 ml water, cover 8 min. Off the heat, stir in whisked dahi.", "2 phulkas, no ghee."]),
      dish("Lauki handvo + raita", 447, 33, 8, ["30 g yellow moong dal + 20 g brown rice (dry), soaked 4 h + 20 g besan", "150 g lauki, grated and squeezed", `65 g ${HM}, crumbled into the batter`, "½ tsp sesame + mustard seeds, ginger-chilli, haldi, pinch of eno", "Raita: 150 g " + DH + " + cucumber", "4 sprays olive oil"],
        ["Grind dal and rice coarse; mix besan, lauki, paneer, spices, salt; add eno.", "Spray a small non-stick pan, mustard + sesame, pour batter, cover, low heat 12 min, flip 8 min.", "Raita on the side."], true),
      dish("Methi thepla + paneer bhurji", 470, 38, 10, [`60 g ${AT} + 20 g fresh methi → 2 theplas`, `75 g ${PANEER}, crumbled`, "50 g onion + 50 g tomato, haldi, chilli", "100 g " + DH, "4 sprays olive oil"],
        ["Theplas: knead atta + methi + spices, roll thin, tawa with sprays.", "Bhurji: spray kadhai, onion 2 min, tomato 2 min, paneer 2 min.", "Dahi on the side."]),
      dish("Foxtail millet khichdi + tikka", 505, 39, 10, ["40 g foxtail millet + 30 g yellow moong dal (dry), soaked 30 min", "100 g veg: carrot, beans, peas", `75 g ${PANEER} for tikka (see tikka steps)`, "100 g " + DH, "4 sprays olive oil, jeera, haldi"],
        ["Pressure-cook millet, dal, veg, haldi, salt and 450 ml water, 3 whistles.", "Jeera tadka with 2 sprays.", ...TIKKA_STEPS, "Dahi on the side."], true),
      dish("Kadhi + soya khichdi", 489, 35, 8, ["40 g brown rice + 20 g yellow moong dal (dry), soaked 30 min", `35 g ${SY}`, "Kadhi: 150 g " + DH + " + 10 g besan, ginger, curry leaves", "3 sprays olive oil, jeera, haldi"],
        [SOYA_BOIL, "Pressure-cook rice, dal and soya with haldi, salt and 400 ml water, 4 whistles; jeera tadka.", "Kadhi: whisk dahi, besan and 200 ml water; simmer 8 min, stirring (no sugar)."], true),
      dish("Gujarati tomato dal + paneer + phulka", 500, 40, 10, ["30 g toor dal (dry)", "1 tomato, ginger, kokum or lemon, mustard, hing", `75 g ${PANEER} for tikka (see tikka steps)`, PHULKA(2), "Salad: 100 g cucumber", "3 sprays olive oil"],
        ["Pressure-cook dal; simmer with tomato, ginger, kokum, 5 min (no sugar). Mustard-hing tadka.", ...TIKKA_STEPS, "2 phulkas, no ghee."], true),
    ],
    [ // Night
      dish("Jeera chaas", 80, 8, 0, ["200 g " + DH, "Roasted jeera powder, salt, mint"], ["Whisk dahi with 150 ml water, jeera, salt, mint."]),
      dish("Kesar-elaichi milk", 85, 9, 0, [`250 ml ${MK}`, "2 strands saffron, pinch cardamom"], ["Warm the milk with saffron and cardamom 3 min. No sugar."]),
      dish("Mint-cucumber raita", 85, 8, 1, ["200 g " + DH, "50 g cucumber, grated", "Mint, roasted jeera, salt"], ["Squeeze the cucumber, whisk into the dahi with mint, jeera and salt."]),
      dish("Haldi milk + ½ scoop", 128, 19, 0, [`200 ml ${MK}`, "¼ tsp haldi + pinch of black pepper", `15 g ${WHEY} (½ level scoop)`], ["Boil milk with haldi and pepper 2 min; cool 2 min, stir in whey."]),
      dish("Ajwain chaas", 80, 8, 0, ["200 g " + DH, "¼ tsp ajwain, pinch black salt"], ["Whisk dahi with 150 ml water, crushed ajwain and black salt."]),
      dish("Nutmeg warm milk", 85, 9, 0, [`250 ml ${MK}`, "Pinch of nutmeg"], ["Warm the milk with nutmeg. No sugar."]),
      dish("Dahi + flax", 85, 7, 2, ["150 g " + DH, "1 tsp ground flaxseed"], ["Stir the flax into the dahi."]),
    ],
  ],
  3: [
    [ // Breakfast
      dish("Thalipeeth + dahi", 435, 48, 8, ["20 g jowar + 15 g bajra flour + 15 g besan", `65 g ${HM}, grated into the dough`, "30 g onion, coriander, ajwain, chilli, haldi, salt", "3 sprays olive oil", "100 g " + DH, WHEY_W(30)],
        ["Mix flours, paneer, onion and spices with water into a soft dough.", "Pat 2 thalipeeths on a wet cloth or foil, make 3 holes in each.", "Tawa with sprays, cover, 3 min per side.", "Dahi on the side; drink the whey shake."]),
      dish("Kanda poha + matki sprouts", 445, 40, 7, ["40 g thick poha (dry)", "40 g matki (moth beans), sprouted at home", "40 g onion, mustard, curry leaves, haldi, chilli", "3 sprays olive oil", "100 g " + DH, WHEY_W(30)],
        ["Steam the sprouts 5 min.", "Rinse poha, leave 5 min.", "Spray kadhai, mustard + curry leaves, onion 2 min, sprouts + haldi + salt, then poha, 2 min.", "Dahi on the side; drink the whey shake."], true),
      dish("Paneer paratha + dahi", 445, 49, 7, [`60 g ${AT} → 2 parathas`, `100 g ${HM}, crumbled, with chilli, coriander, ajwain, salt`, "3 sprays olive oil (no ghee)", "100 g " + DH, WHEY_W(15)],
        ["Knead atta. Roll 2 small rounds, fill with paneer, seal, roll gently.", "Tawa with sprays, 1–2 min per side.", "Dahi on the side; drink the shake."]),
      dish("Besan-palak chilla + hung curd", 442, 46, 7, ["50 g Tata Sampann besan", "50 g palak, finely chopped", "Ajwain, chilli, haldi, salt", "250 g " + DH + ", hung 2 h (~150 g)", "4 sprays olive oil", WHEY_W(30)],
        ["Mix besan, palak, spices and ~90 ml water.", "Spray a hot tawa, make 2 chillas, 2 min per side.", "Hung curd on the side; drink the whey shake."], true),
      dish("Moong misal (no farsan)", 475, 46, 11, ["50 g whole green moong, sprouted", "Rassa: onion, tomato, garlic, 1 tsp misal / kanda-lasun masala (no coconut)", "Onion, coriander, lemon on top", PHULKA(1), "100 g " + DH, "3 sprays olive oil", WHEY_W(30)],
        ["Spray a cooker, onion-garlic 2 min, tomato + masala 2 min, sprouts + 300 ml water, 1 whistle.", "Top with raw onion and coriander. Eat with 1 phulka instead of pav, dahi on the side.", "Drink the whey shake."], true),
      dish("Daliya kheer-style (no sugar)", 435, 39, 6, ["40 g daliya (dry)", `250 ml ${MK}`, `30 g ${WHEY} (1 level scoop)`, "1 small banana, mashed", "Cardamom"],
        ["Dry-roast daliya 2 min; pressure-cook with 150 ml water, 2 whistles.", "Add milk and simmer 5 min.", "Off the heat, wait 1 min, stir in whey and mashed banana (the sweetness). Cardamom on top."]),
      dish("Amritsari paneer bhurji + phulka", 445, 46, 5, [`75 g ${PANEER}, crumbled`, "40 g onion + 40 g tomato + 30 g capsicum", "Ginger, chilli, haldi, kasuri methi, garam masala", PHULKA(1), "3 sprays olive oil", `15 g ${WHEY} (½ level scoop) in 150 ml ${MK}`],
        ["Spray kadhai, onion + ginger 2 min, tomato + capsicum 3 min, spices.", "Add paneer and kasuri methi, 2 min.", "1 phulka; drink the whey-milk."]),
    ],
    [ // Lunch
      dish("Matki usal + jowar bhakri", 567, 40, 13, ["40 g matki (moth beans), sprouted", "Onion, tomato, garlic, goda masala (no coconut)", `75 g ${PANEER}, cubed`, "50 g jowar flour → 2 bhakris", "100 g " + DH, "4 sprays olive oil"],
        ["Spray cooker, onion-garlic 2 min, tomato + goda masala 2 min, sprouts + 250 ml water, 1 whistle.", "Add paneer, 2 min.", "Bhakri: knead jowar with hot water, pat thin, cook both sides.", "Dahi on the side."], true),
      dish("Varan bhaat + tikka + koshimbir", 540, 36, 8, ["40 g toor dal (dry), plain varan (haldi, hing, salt)", "50 g brown rice (dry, soaked 30 min)", `75 g ${PANEER} for tikka (see tikka steps)`, "Koshimbir: 100 g cucumber + 50 g " + DH + ", lemon, jeera", "3 sprays olive oil"],
        ["Varan: pressure-cook dal with haldi, hing, salt, 3 whistles; mash smooth.", "Brown rice: 50 g (soaked) in 150 ml water, 20 min.", ...TIKKA_STEPS, "Koshimbir: chopped cucumber, dahi, jeera, salt."], true),
      dish("Dal tadka + achari paneer + phulka", 500, 43, 12, ["20 g yellow moong + 20 g masoor dal (dry)", `100 g ${HM}, cubed, with ½ tsp achari masala (no pickle oil)`, PHULKA(2), "Salad: 100 g onion + cucumber", "Garlic, jeera, red chilli, 4 sprays olive oil"],
        ["Pressure-cook dals with haldi, salt, 300 ml water, 3 whistles.", "Tadka with 2 sprays: jeera, garlic, red chilli.", "Toss paneer with achari masala on the tawa with 1 spray, 2 min.", "2 phulkas, no ghee."], true),
      dish("Sarson-palak saag + bajra roti", 510, 43, 14, ["150 g palak + 100 g sarson (mustard greens)", "30 g yellow moong dal (dry), cooked into the saag", `100 g ${HM}, cubed`, "50 g bajra flour → 2 rotis", "100 g " + DH, "Garlic, ginger, chilli, 4 sprays olive oil"],
        ["Pressure-cook greens + dal with ginger, chilli, salt, 2 whistles; mash coarse.", "Garlic tadka with 2 sprays; add paneer, 2 min.", "Bajra roti: knead with hot water, pat thin, cook both sides.", "Dahi on the side."], true),
      dish("Bharli vangi (soya stuffing) + dal + phulka", 562, 43, 15, ["200 g small brinjals, slit", `30 g ${SY}, pulsed + 10 g besan + goda masala (no coconut)`, "30 g toor dal (dry)", PHULKA(2), "100 g " + DH, "4 sprays olive oil"],
        [SOYA_BOIL + " Pulse to mince; mix with roasted besan, masala and salt.", "Stuff the brinjals; spray kadhai, cook covered on low 12 min, turning.", "Dal: pressure-cook with haldi, salt, 3 whistles.", "2 phulkas. Dahi on the side."], true),
      dish("Punjabi kadhi + rice + tikka", 563, 41, 6, ["Kadhi (no pakoda): 150 g " + DH + " + 15 g besan, methi seeds, ginger", "50 g brown rice (dry, soaked 30 min)", `100 g ${PANEER} for tikka (see tikka steps)`, "Salad: 100 g cucumber + onion", "3 sprays olive oil"],
        ["Kadhi: whisk dahi, besan and 250 ml water; simmer 10 min, stirring; methi-seed tadka with 1 spray.", "Brown rice: 50 g (soaked) in 150 ml water, 20 min.", ...TIKKA_STEPS]),
      dish("Pithla bhakri + sprouts koshimbir", 575, 38, 13, ["40 g besan for pithla, onion, garlic, chilli", `65 g ${HM}, crumbled into the pithla`, "50 g jowar flour → 2 bhakris", "Koshimbir: 30 g whole moong, sprouted + cucumber + lemon", "100 g " + DH, "3 sprays olive oil"],
        ["Pithla: spray kadhai, onion-garlic-chilli 2 min; whisk besan in 250 ml water, pour in, stir 6 min till thick; add paneer.", "Bhakri: knead jowar with hot water, pat thin, cook both sides.", "Koshimbir: steamed sprouts with cucumber and salt. Dahi on the side."], true),
    ],
    [ // Snack
      dish("Matki usal cup + whey", 205, 21, 6, ["40 g matki (moth beans), sprouted", "Onion, tomato, chilli, coriander", WHEY_W(15)],
        ["Steam sprouts 5 min; mix with onion, tomato, coriander, salt.", "Drink the shake."], true),
      dish("Salted lassi + pumpkin seeds", 260, 23, 2, ["200 g " + DH, `15 g ${WHEY} (½ level scoop)`, "Roasted jeera, salt", "10 g pumpkin seeds"],
        ["Blend dahi, whey, 100 ml cold water, jeera and salt.", "Pumpkin seeds on the side."]),
      dish("Achari paneer + guava", 245, 22, 6, [`75 g ${PANEER}, cubed`, "½ tsp achari masala, 1 spray", "1 guava"],
        [TAWA_PANEER, "Sprinkle achari masala. Guava on the side."]),
      dish("Makhana chivda + protein chaas", 260, 22, 3, ["25 g Farmley makhana", "10 g pumpkin seeds, curry leaves, haldi, pinch salt", "2 sprays olive oil", "1 pack Amul High Protein Buttermilk"],
        ["Spray a kadhai, curry leaves + haldi, makhana + seeds, roast on low 4 min till crisp. No peanuts.", "Drink the buttermilk."]),
      dish("Moong-palak dhokla + whey", 225, 25, 4, ["40 g yellow moong dal (dry), soaked 3 h", "30 g palak, 50 g " + DH + ", ginger-chilli, pinch eno", "Green chutney", WHEY_W(15)],
        ["Grind dal with palak and ginger-chilli; mix in dahi and salt; add eno.", "Steam 12 min. Cut in squares; chutney on the side.", "Drink the shake."], true),
      dish("Banana-whey milkshake", 210, 25, 1, [`250 ml ${MK}, cold`, `20 g ${WHEY} (⅔ level scoop)`, "½ banana", "Cinnamon"],
        ["Blend everything 20 seconds. No sugar."]),
      dish("Soya tikki + dahi", 220, 18, 4, [`25 g ${SY}`, "20 g Quaker oats, ground", "Onion, coriander, ginger, chaat masala", "3 sprays olive oil", "50 g " + DH + " + mint chutney"],
        [SOYA_BOIL + " Pulse with oats, onion and spices.", "Shape 3 tikkis; tawa with sprays, 3 min per side (not fried).", "Mint-dahi dip on the side."]),
    ],
    [ // Dinner
      dish("Kolhapuri soya + phulka", 470, 39, 13, [`40 g ${SY}`, "Onion, tomato, garlic, 1 tsp Kolhapuri masala (no coconut)", "150 g capsicum + onion", PHULKA(2), "100 g " + DH, "4 sprays olive oil"],
        [SOYA_BOIL, "Spray kadhai, onion-garlic 2 min, tomato + masala 3 min, soya + capsicum 5 min (dry).", "2 phulkas. Dahi on the side (cools the spice)."]),
      dish("Dal palak + rice + raita", 475, 36, 10, ["40 g yellow moong dal (dry)", "150 g palak", `65 g ${HM}, cubed into the dal`, "40 g brown rice (dry, soaked 30 min)", "Raita: 150 g " + DH + " + cucumber", "3 sprays olive oil, garlic, jeera"],
        ["Pressure-cook dal with palak, haldi, salt, 3 whistles.", "Garlic-jeera tadka with 2 sprays; add paneer, 2 min.", "Brown rice: 40 g (soaked) in 120 ml water, 20 min. Raita on the side."], true),
      dish("Paneer tikka masala (light) + phulka", 475, 40, 8, [`100 g ${PANEER} for tikka (see tikka steps)`, "Gravy: onion, tomato, 50 g " + DH + ", kasuri methi, garam masala", "50 g green peas", PHULKA(1), "Salad: 100 g cucumber", "4 sprays olive oil"],
        [...TIKKA_STEPS, "Gravy: spray kadhai, onion 3 min, tomato + spices 3 min, blend; add peas and 100 ml water, 4 min.", "Off the heat stir in whisked dahi; add the paneer.", "1 phulka."]),
      dish("Zunka-paneer + jowar bhakri", 535, 41, 10, ["35 g besan", "100 g onion, garlic, chilli, mustard, haldi", `100 g ${HM}, crumbled`, "50 g jowar flour → 2 bhakris", "150 g " + DH, "3 sprays olive oil"],
        ["Spray kadhai, mustard + garlic + onion 4 min, haldi + chilli.", "Sprinkle besan, stir on low 5 min (dry and crumbly); add paneer, 2 min.", "Bhakris; dahi on the side."]),
      dish("Punjabi mix veg + soya + phulka", 435, 35, 13, ["200 g veg: cauliflower, carrot, beans, peas, capsicum", `30 g ${SY}`, "Onion, tomato, ginger-garlic, kasuri methi", PHULKA(2), "100 g " + DH, "4 sprays olive oil"],
        [SOYA_BOIL, "Spray kadhai, onion → ginger-garlic → tomato + spices; add veg + soya + 100 ml water, cover 8 min.", "2 phulkas. Dahi on the side."]),
      dish("Masoor dal + methi-paneer thepla", 480, 36, 13, ["40 g masoor dal (dry)", `30 g ${AT} + 30 g jowar flour + 20 g methi → 2 theplas`, `65 g ${HM}, grated into the dough`, "100 g " + DH, "4 sprays olive oil"],
        ["Pressure-cook dal with haldi, salt, tomato, 3 whistles; jeera tadka.", "Knead flours, methi, paneer and spices; roll 2 theplas; tawa with sprays.", "Dahi on the side."], true),
      dish("Tandoori paneer-veg + raita", 455, 42, 7, [`100 g ${PANEER} + 150 g capsicum, onion, tomato chunks`, "Tandoori marinade: 30 g dahi, chilli, garam masala, ginger-garlic, lemon", "Raita: 150 g " + DH + " + mint", PHULKA(1), "3 sprays olive oil"],
        ["Marinate paneer and veg 15 min.", "Air fryer 180 °C 8 min (or tawa with sprays), turn once.", "1 phulka; mint raita on the side."]),
    ],
    [ // Night
      dish("Elaichi milk", 85, 9, 0, [`250 ml ${MK}`, "Pinch cardamom"], ["Warm the milk with cardamom. No sugar."]),
      dish("Pudina chaas", 60, 6, 0, ["150 g " + DH, "Mint, roasted jeera, black salt"], ["Blend dahi with 150 ml water, mint, jeera and salt."]),
      dish("Haldi milk + ½ scoop", 128, 19, 0, [`200 ml ${MK}`, "¼ tsp haldi + pinch of black pepper", `15 g ${WHEY} (½ level scoop)`], ["Boil milk with haldi and pepper 2 min; cool 2 min, stir in whey."]),
      dish("Cinnamon dahi + flax", 80, 7, 2, ["150 g " + DH, "1 tsp ground flaxseed, pinch cinnamon"], ["Stir flax and cinnamon into the dahi."]),
      dish("Ginger-tulsi milk", 85, 9, 0, [`250 ml ${MK}`, "Small piece ginger, 3 tulsi leaves"], ["Simmer the milk with ginger and tulsi 3 min, strain. No sugar."]),
      dish("Hung curd + chia", 105, 8, 3, ["200 g " + DH + ", hung 2 h", "5 g chia seeds (1 tsp)"], ["Hang the dahi 2 h in the fridge; stir in chia."]),
      dish("Cocoa slow shake", 135, 19, 1, [`15 g ${WHEY} (½ level scoop)`, `200 ml ${MK}`, "1 tsp unsweetened cocoa"], ["Shake together. Drink 30 min before bed."]),
    ],
  ],
  4: [
    [ // Breakfast
      dish("Besan-soya chilla + apple", 500, 47, 8, ["40 g Tata Sampann besan", `20 g ${SY}, boiled and minced`, "Onion, capsicum, coriander, ajwain, chilli", "4 sprays olive oil", "100 g " + DH, "1 apple", WHEY_W(30)],
        ["Mix besan, minced soya, veg, spices and ~80 ml water.", "Spray a hot tawa, make 2 chillas, 2 min per side.", "Dahi and apple on the side; drink the whey shake."]),
      dish("Paneer breakfast wrap", 410, 42, 6, [`40 g ${AT} → 1 large thin roti`, `75 g ${PANEER}, scrambled with 50 g capsicum + onion`, "Mint chutney, chaat masala", "2 sprays olive oil", WHEY_W(15)],
        ["Spray pan, onion + capsicum 2 min, crumbled paneer + haldi + salt 2 min.", "Spread chutney on the roti, fill, roll tight (wrap in foil to carry).", "Drink the shake."]),
      dish("Foxtail millet upma + paneer", 420, 47, 8, ["40 g foxtail millet (dry), rinsed", "80 g veg: carrot, beans, peas, onion", `65 g ${HM}, cubed`, "Mustard, curry leaves, ginger, 3 sprays olive oil", "100 g " + DH, WHEY_W(30)],
        ["Dry-roast millet 2 min.", "Spray a cooker, mustard + curry leaves + ginger, veg 2 min, millet + salt + 120 ml water, 2 whistles.", "Stir in paneer. Dahi on the side; drink the shake."], true),
      dish("Protein smoothie bowl", 445, 40, 8, ["150 g " + DH, `30 g ${WHEY} (1 level scoop)`, `100 ml ${MK}`, "1 banana (half blended, half sliced)", "30 g Quaker oats", "5 g chia seeds"],
        ["Blend dahi, whey, milk and half the banana thick.", "Pour in a bowl; top with oats, chia and sliced banana."]),
      dish("Bajra-methi dhebra + dahi", 415, 39, 9, ["40 g bajra flour + 20 g " + AT, "20 g fresh methi, ginger-chilli, haldi, sesame", "150 g " + DH + " (30 g in the dough)", "3 sprays olive oil", WHEY_W(30)],
        ["Knead flours, methi, spices, 30 g dahi and salt (no oil).", "Pat 3 small dhebras; tawa with sprays, 2 min per side.", "Rest of the dahi on the side; drink the shake."]),
      dish("Savoury oats-moong khichdi + paneer", 435, 37, 8, ["40 g Quaker oats + 20 g yellow moong dal (dry)", "80 g veg: carrot, peas, tomato", `50 g ${PANEER}, cubed`, "Jeera, haldi, 3 sprays olive oil", WHEY_W(15)],
        ["Pressure-cook dal and veg with haldi, salt, 250 ml water, 2 whistles.", "Add oats, cook 3 min; jeera tadka with sprays; stir in paneer.", "Drink the shake."], true),
      dish("Moong-paneer appe", 410, 42, 6, ["50 g yellow moong dal (dry), soaked 3 h", `65 g ${HM}, grated`, "Onion, carrot, coriander, ginger-chilli, pinch eno", "4 sprays olive oil", "2 tbsp tomato chutney", `15 g ${WHEY} (½ level scoop) in 150 ml ${MK}`],
        ["Grind dal thick; mix in paneer, veg, spices, salt; add eno.", "Spray the appe pan, fill, cover 4 min, turn, 3 min (~12 appe).", "Tomato chutney on the side; drink the whey-milk."], true),
    ],
    [ // Lunch
      dish("Soya brown fried rice + paneer soup", 570, 46, 9, ["50 g brown rice (dry), cooked the night before and cooled", `50 g ${SY}`, "150 g cabbage, carrot, beans, spring onion", "Garlic, 1 tsp low-sodium soy sauce, ½ tsp vinegar, pepper", `Clear soup: 50 g ${PANEER} cubes + veg stock + ginger`, "4 sprays olive oil"],
        [SOYA_BOIL + " Chop small.", "High heat, sprays, garlic 30 s, veg 3 min, soya 2 min, rice + soy sauce + vinegar + pepper, 2 min.", "Soup: simmer ginger, veg and 300 ml water 5 min, add paneer 2 min, salt, pepper."]),
      dish("Moong burrito bowl", 550, 39, 12, ["40 g brown rice (dry, soaked 30 min)", "40 g whole green moong (dry), soaked overnight and cooked whole", `75 g ${PANEER}, grilled`, "Salsa: tomato, onion, capsicum, coriander, chilli, lemon", "150 g " + DH + ", hung 1 h, with garlic (instead of sour cream)", "2 sprays olive oil"],
        ["Pressure-cook moong 1 whistle with jeera, chilli, salt (keep whole).", "Brown rice: 40 g in 120 ml water, 20 min.", TAWA_PANEER, "Bowl: rice, moong, paneer, salsa, garlic curd on top."], true),
      dish("Chilli paneer + phulka", 515, 42, 8, [`100 g ${PANEER}, cubed`, "150 g capsicum + onion, cut in squares", "Garlic, green chilli, 1 tsp low-sodium soy sauce, ½ tsp vinegar, 1 tsp cornflour in 50 ml water", PHULKA(2), "4 sprays olive oil"],
        ["Tawa paneer with 2 sprays till golden (no deep frying).", "High heat, sprays, garlic + chilli 30 s, capsicum + onion 2 min.", "Add soy, vinegar, cornflour water; toss paneer in 1 min.", "2 phulkas."]),
      dish("Millet khichdi bowl + raita", 538, 38, 12, ["40 g foxtail millet + 30 g yellow moong dal (dry)", `25 g ${SY}`, "150 g veg: carrot, beans, peas, spinach", "15 g pumpkin seeds on top", "Raita: 150 g " + DH + " + cucumber", "3 sprays olive oil, jeera, haldi"],
        [SOYA_BOIL, "Pressure-cook millet, dal, veg, soya with haldi, salt and 500 ml water, 3 whistles.", "Jeera tadka; pumpkin seeds on top. Raita on the side."], true),
      dish("Soya-paneer manchurian + rice", 528, 43, 10, [`45 g ${SY}, minced + 20 g oats, ground`, `65 g ${HM}, grated`, "100 g cabbage + carrot, grated; ginger, garlic", "Sauce: garlic, chilli, 1 tsp low-sodium soy sauce, vinegar, 1 tsp cornflour", "50 g brown rice (dry, soaked 30 min)", "4 sprays olive oil"],
        [SOYA_BOIL + " Mince; mix with oats, paneer, veg, ginger, salt; make 10 balls.", "Steam the balls 10 min (not fried).", "Sauce: sprays, garlic + chilli, soy, vinegar, 150 ml water, cornflour; add balls, 2 min.", "Brown rice: 50 g in 150 ml water, 20 min."]),
      dish("Moong hummus bowl + paneer", 535, 42, 10, ["40 g yellow moong dal (dry), cooked thick", "5 g sesame (1 tsp, for tahini), garlic, lemon, jeera", `75 g ${PANEER}, grilled`, `40 g ${AT} → 2 small rotis`, "150 g salad: cucumber, tomato, onion, lettuce", "2 sprays olive oil"],
        ["Blend cooked dal with toasted sesame, garlic, lemon, jeera and salt (smooth hummus).", TAWA_PANEER, "Bowl: hummus, salad, paneer; rotis on the side."], true),
      dish("Masoor tadka + soya chilli + rice", 540, 38, 12, ["30 g masoor dal (dry)", `30 g ${SY}`, "100 g capsicum + onion, garlic, 1 tsp low-sodium soy sauce", "40 g brown rice (dry, soaked 30 min)", PHULKA(1), "100 g " + DH, "4 sprays olive oil"],
        ["Pressure-cook dal with haldi, 3 whistles; jeera-garlic tadka.", SOYA_BOIL + " Toss with capsicum, onion, garlic and soy, high heat 4 min.", "Brown rice: 40 g in 120 ml water, 20 min. 1 phulka. Dahi on the side."], true),
    ],
    [ // Snack
      dish("Soya chilli bites + apple", 225, 19, 6, [`25 g ${SY}`, "Garlic, capsicum, ½ tsp low-sodium soy sauce, chilli flakes, 2 sprays", "100 g " + DH, "1 apple"],
        [SOYA_BOIL, "High heat, sprays, garlic, soya, capsicum, soy and chilli, 3 min.", "Dahi and apple on the side."]),
      dish("Greek-style curd bowl", 200, 21, 2, ["250 g " + DH + ", hung 2 h", `15 g ${WHEY} (½ level scoop)`, "½ apple, chopped, cinnamon"],
        ["Whisk whey into the hung curd; top with apple and cinnamon."]),
      dish("Paneer-veg skewers + guava", 240, 19, 6, [`60 g ${PANEER}`, "Capsicum, onion, tomato chunks", "Tikka spice, 2 sprays", "1 guava"],
        ["Thread on skewers, sprinkle spices, air fryer 180 °C 6 min (or tawa).", "Guava on the side."]),
      dish("Sprouts-paneer chaat + guava", 260, 22, 7, ["30 g whole green moong, sprouted", `65 g ${HM}, cubed`, "Onion, tomato, cucumber, chaat masala", "1 guava"],
        ["Steam sprouts 5 min, cool. Mix with paneer, veg, chaat masala.", "Guava on the side."], true),
      dish("Trail mix + protein chaas", 260, 21, 2, ["20 g Farmley makhana", "10 g pumpkin seeds + 5 g walnuts", "1 pack Amul High Protein Buttermilk"],
        ["Dry-roast makhana and seeds 3 min with a pinch of salt and pepper. No peanuts.", "Drink the buttermilk."]),
      dish("Cocoa whey milk + walnuts", 240, 27, 2, [`250 ml ${MK}, cold`, `20 g ${WHEY} (⅔ level scoop)`, "1 tsp unsweetened cocoa", "10 g walnuts"],
        ["Shake milk, whey and cocoa 20 seconds. No sugar.", "Walnuts on the side."]),
      dish("Mini moong chilla rolls", 215, 24, 3, ["30 g yellow moong dal (dry), soaked 3 h", "Ginger, chilli, salt, 2 sprays", "100 g " + DH + " + mint", WHEY_W(15)],
        ["Grind dal into batter; make 3 small chillas, roll.", "Mint dahi dip; drink the shake."], true),
    ],
    [ // Dinner
      dish("Hakka soya stir-fry + paneer soup", 482, 46, 10, [`35 g ${SY}`, "200 g veg: cabbage, carrot, capsicum, spring onion", "Garlic, ginger, 1 tsp low-sodium soy sauce, vinegar, pepper", `Soup: 65 g ${HM} cubes + ginger + veg stock`, PHULKA(2), "4 sprays olive oil"],
        [SOYA_BOIL, "High heat, sprays, garlic-ginger 30 s, veg 3 min, soya + soy + vinegar 2 min.", "Soup: simmer 300 ml water with ginger 5 min, add paneer 1 min, salt, pepper.", "2 phulkas."]),
      dish("Thai-style paneer curry + rice", 525, 39, 8, [`100 g ${PANEER}, cubed`, "150 g veg: beans, capsicum, carrot, baby corn", "Green paste: coriander, ginger, garlic, chilli, lemongrass or lemon zest (no coconut)", `100 ml ${MK} for the curry base`, "50 g brown rice (dry, soaked 30 min)", "3 sprays olive oil"],
        ["Blend the green paste; spray kadhai, cook paste 2 min.", "Add veg + 100 ml water, 5 min; add milk on low (don't boil), paneer 2 min.", "Brown rice: 50 g in 150 ml water, 20 min."]),
      dish("Millet-moong khichdi + kadhi", 512, 43, 10, ["40 g foxtail millet + 30 g yellow moong dal (dry)", `100 g ${HM}, cubed`, "100 g veg: carrot, peas, beans", "Kadhi: 150 g " + DH + " + 10 g besan", "3 sprays olive oil, jeera, haldi"],
        ["Pressure-cook millet, dal, veg, haldi, salt, 450 ml water, 3 whistles; stir in paneer.", "Kadhi: whisk dahi, besan, 200 ml water; simmer 8 min, stirring (no sugar)."], true),
      dish("Paneer-palak wrap", 460, 40, 10, [PHULKA(2).replace("phulkas", "thin rotis"), `75 g ${PANEER}, sliced`, "100 g palak, onion, garlic", "Mint chutney", "100 g " + DH, "3 sprays olive oil"],
        ["Spray pan, garlic + onion 2 min, palak 2 min, salt.", TAWA_PANEER, "Chutney on each roti, fill with palak and paneer, roll. Dahi on the side."], true),
      dish("Dal-veg soup + paneer tikka salad", 450, 38, 9, ["30 g yellow moong dal (dry)", "150 g veg: carrot, tomato, onion, garlic", `75 g ${PANEER} for tikka (see tikka steps)`, "100 g lettuce + cucumber", PHULKA(1), "2 sprays olive oil"],
        ["Pressure-cook dal and veg with 400 ml water, salt, haldi, 3 whistles; blend smooth, pepper.", ...TIKKA_STEPS, "Toss tikka on the salad. 1 phulka."], true),
      dish("Soya keema + bajra roti", 460, 35, 14, [`40 g ${SY}, minced`, "50 g peas, onion, tomato, ginger-garlic, garam masala", "50 g bajra flour → 2 rotis", "100 g " + DH, "4 sprays olive oil"],
        [SOYA_BOIL + " Pulse 2–3 seconds into mince.", "Spray kadhai, onion → ginger-garlic → tomato + spices, soya + peas 6 min.", "Bajra rotis. Dahi on the side."]),
      dish("Paneer-mushroom pepper fry + jowar roti", 450, 35, 9, [`75 g ${PANEER}, cubed`, "150 g mushrooms + 50 g capsicum", "Garlic, black pepper, 1 tsp low-sodium soy sauce", "50 g jowar flour → 2 rotis", "100 g " + DH, "3 sprays olive oil"],
        ["High heat, sprays, garlic 30 s, mushrooms 4 min till dry, capsicum 1 min.", "Add paneer, soy, lots of pepper, 2 min.", "Jowar rotis. Dahi on the side."]),
    ],
    [ // Night
      dish("Cocoa milk", 95, 9, 1, [`250 ml ${MK}`, "1 tsp unsweetened cocoa"], ["Warm the milk, whisk in cocoa. No sugar."]),
      dish("Cardamom-cinnamon dahi", 80, 8, 0, ["200 g " + DH, "Pinch cardamom + cinnamon"], ["Stir the spices into the dahi."]),
      dish("Haldi milk + ½ scoop", 128, 19, 0, [`200 ml ${MK}`, "¼ tsp haldi + pinch of black pepper", `15 g ${WHEY} (½ level scoop)`], ["Boil milk with haldi and pepper 2 min; cool 2 min, stir in whey."]),
      dish("Jeera-pudina chaas", 80, 8, 0, ["200 g " + DH, "Mint, roasted jeera, black salt"], ["Blend dahi with 150 ml water, mint, jeera and salt."]),
      dish("Ginger milk", 85, 9, 0, [`250 ml ${MK}`, "Small piece ginger"], ["Simmer the milk with ginger 3 min, strain. No sugar."]),
      dish("Hung curd + flax", 105, 8, 2, ["200 g " + DH + ", hung 2 h", "1 tsp ground flaxseed"], ["Hang the dahi 2 h; stir in flax."]),
      dish("Cinnamon slow shake", 130, 19, 0, [`15 g ${WHEY} (½ level scoop)`, `200 ml ${MK}`, "Pinch cinnamon"], ["Shake together. Drink 30 min before bed."]),
    ],
  ],
};
// Flax at every breakfast (blood report), same as week 1.
Object.values(MENU_WEEKS).forEach((w) => w[0].forEach((o) => {
  if (!o.items.some((x) => /flax/i.test(x))) {
    o.items.push("1 tbsp (7 g) ground flaxseed"); o.steps.push("Stir in 1 tbsp ground flaxseed just before serving.");
    o.kcal += 35; o.fib += 2;
  }
}));

// Which menu week a date is in: journey weeks 1, 2, 3, 4, then repeat.
function menuWeek(k) {
  const w = Math.floor((new Date(k) - new Date(START_DATE)) / (7 * 864e5));
  return w < 0 ? 1 : (w % 4) + 1;
}
// The dishes on offer for a meal slot on a date (swaps pick from this list).
function mealOptions(i, k) {
  const w = menuWeek(k);
  return w === 1 ? MEALS[i].options : MENU_WEEKS[w][i];
}
// Default dish for a slot on a date (shared by the app and the Kitchen page).
function defaultMealIdx(i, k) {
  if (menuWeek(k) === 1) return Math.floor(new Date(k) / 864e5) % MEALS[i].options.length;
  const d = Math.floor((new Date(k) - new Date(START_DATE)) / 864e5);
  return ((d % 7) + 7) % 7;
}
// The dish for a slot on a date, given a saved swap index (ignored if it no longer fits).
function dishFor(i, k, pick) {
  const opts = mealOptions(i, k);
  return opts[pick != null && pick < opts.length ? pick : defaultMealIdx(i, k)];
}

const AVOID_FOODS = ["tofu", "rajma", "chole / kabuli chana", "roasted chana"]; // dislikes / cause bloating
// Blood report (high LDL and triglycerides): keep these out of meals and AI suggestions.
const HEALTH_AVOID = ["fried snacks (vada pav, samosa, pakoda, bhajia)", "sweets and sugar", "maida (white bread, pav, naan, pizza, biscuits)",
  "butter, ghee, cream, cheese", "coconut", "full-fat milk and dahi", "white rice in big portions", "sugary drinks and alcohol"];
// Words that trigger a warning when logged.
const WARN_FOODS = /vada|samosa|pakod|bhaji|pav|pizza|burger|maggi|noodle|biscuit|cookie|sweet|mithai|jamun|laddoo|sugar|cake|beer|alcohol|cream|cheese|butter(?!milk)|ghee|fried|chips|rajma|chole|tofu|chana/i;

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
  { item: "Amul Slim n Trim skimmed milk 500 ml (incl. 1 L for dahi + 4.5 L for home-made paneer)", qty: 16, price: 27, q: "amul slim n trim milk", group: "Dairy" },
  { item: "Amul High Protein Buttermilk", qty: 1, price: 25, q: "amul high protein buttermilk", group: "Dairy" },
  { item: "Milld High Protein Atta", qty: 1, price: 130, q: "milld high protein atta", link: LINKS.atta, group: "Pantry" },
  { item: "Tata Simply Better olive oil cooking spray", qty: 0.25, price: 400, q: "olive oil cooking spray", link: LINKS.spray, group: "Pantry" },
  { item: "Tata Sampann yellow moong dal 1 kg", qty: 0.5, price: 160, q: "tata sampann moong dal", group: "Pantry" },
  { item: "Tata Sampann besan 500 g", qty: 0.5, price: 60, q: "tata sampann besan", group: "Pantry" },
  { item: "Quaker rolled oats 1 kg", qty: 0.5, price: 199, q: "quaker oats 1kg", group: "Pantry" },
  { item: "Thick poha 500 g", qty: 0.33, price: 55, q: "thick poha", group: "Pantry" },
  { item: "Brown rice 1 kg", qty: 0.5, price: 150, q: "brown rice 1kg", group: "Pantry" },
  { item: "Farmley roasted makhana", qty: 0.5, price: 120, q: "farmley makhana", group: "Pantry" },
  { item: "Walnuts 200 g", qty: 0.4, price: 340, q: "walnuts kernels", group: "Pantry" },
  { item: "Sat Isabgol 100 g", qty: 0.25, price: 150, q: "sat isabgol", group: "Pantry" },
  { item: "Daliya (broken wheat) 500 g", qty: 0.25, price: 60, q: "daliya broken wheat", group: "Pantry" },
  { item: "Jowar flour 500 g", qty: 0.25, price: 70, q: "jowar atta", group: "Pantry" },
  { item: "Ragi flour 500 g", qty: 0.25, price: 70, q: "ragi flour", group: "Pantry" },
  { item: "Whole green moong (for sprouts) 500 g", qty: 0.25, price: 90, q: "whole green moong", group: "Pantry" },
  { item: "Masoor + toor dal 500 g each", qty: 0.25, price: 160, q: "masoor dal", group: "Pantry" },
  { item: "Chia seeds 200 g", qty: 0.25, price: 140, q: "chia seeds", group: "Pantry" },
  { item: "Flax seeds 200 g (grind a week at a time)", qty: 0.25, price: 80, q: "flax seeds", group: "Pantry" },
  { item: "Vegetables: onion, tomato, palak, capsicum, beans, cucumber, lauki, bhindi, methi, broccoli", qty: 1, price: 260, q: "fresh vegetables", group: "Fresh" },
  { item: "Fruits: 7 bananas, 4 apples, guava", qty: 1, price: 150, q: "banana", group: "Fresh" },
];
// Each menu week needs slightly different shopping (counted from that week's dishes):
// qty overrides the weekly packs above; add = extra items for that week only. Week-specific veg
// (drumstick, sarson, mushrooms…) comes out of the normal vegetable budget.
const PANEER_ITEM = GROCERY[0].item, MILK_ITEM = GROCERY[3].item, SOYA_ITEM = GROCERY[1].item;
const WEEK_GROCERY = {
  1: { qty: {}, add: [] },
  2: { qty: { [PANEER_ITEM]: 4, [MILK_ITEM]: 15 }, add: [
    { item: "Urad dal 500 g (ragi dosa, adai)", qty: 0.5, price: 90, q: "urad dal", group: "Pantry" },
    { item: "Foxtail millet 500 g (bisi bele bath, khichdi)", qty: 0.5, price: 90, q: "foxtail millet", group: "Pantry" } ] },
  3: { qty: { [PANEER_ITEM]: 3, [MILK_ITEM]: 20 }, add: [
    { item: "Matki (moth beans) 500 g, for sprouting", qty: 0.5, price: 80, q: "matki moth beans", group: "Pantry" },
    { item: "Bajra flour 500 g", qty: 0.5, price: 50, q: "bajra atta", group: "Pantry" } ] },
  4: { qty: { [MILK_ITEM]: 15, [SOYA_ITEM]: 2 }, add: [
    { item: "Low-sodium soy sauce + vinegar (last ~2 months)", qty: 0.5, price: 150, q: "low sodium soy sauce", group: "Pantry" },
    { item: "Unsweetened cocoa 100 g (lasts months)", qty: 0.25, price: 130, q: "unsweetened cocoa powder", group: "Pantry" } ] },
};
// The weekly grocery list for menu week mw (1–4).
const groceryFor = (mw) => [...GROCERY.map((g) => ({ ...g, qty: WEEK_GROCERY[mw].qty[g.item] ?? g.qty })), ...WEEK_GROCERY[mw].add];
const MONTHLY_EXTRAS = [
  { item: "Big Muscles Premium Gold Whey 1.5 kg (₹2,127, lasts ~5 weeks; monthly share shown)", price: 1750, q: "big muscles premium gold whey 1.5 kg" },
  { item: "Creatine monohydrate 250 g (AS-IT-IS or MuscleBlaze), lasts 2 months", price: 300, q: "creatine monohydrate" },
  { item: "Skin basics refill (sunscreen, face wash)", price: 380, q: "sunscreen spf 50" },
];
// One-time looks kit. Buy after the dermat visit; they may prescribe something else.
const LOOKS_KIT = [
  { item: "Sunscreen SPF 50 (Re'equil Ultra Matte or Minimalist SPF 50)", price: 550, q: "spf 50 sunscreen" },
  { item: "Gentle face wash (Cetaphil or Minimalist)", price: 350, q: "gentle face wash" },
  { item: "Light gel moisturiser (Minimalist or Neutrogena Hydro Boost)", price: 350, q: "gel moisturiser" },
  { item: "Beard trimmer with 0.5 mm steps (Philips or Mi), if you don't have one", price: 1500, q: "beard trimmer philips" },
  { item: "Running shoes with cushioning (Decathlon Kiprun or ASICS) — protects the knee", price: 3500, q: "running shoes" },
];

// Walk-to-run plan. While KNEE.rehab is on, runStage() stays on stage 1 (flat walking only).
// After the ortho clears running: move on only if the right knee is pain-free
// the day after. Pain above 3/10 during or after = go back a stage.
const RUN_PLAN = [
  { weeks: [1, 4], name: "Brisk walk", session: "40 min brisk walk on flat ground on Saturday + 10 min flat walk after each gym session" },
  { weeks: [5, 8], name: "Walk-run", session: "8 × (1 min easy jog + 2 min walk) on treadmill or track" },
  { weeks: [9, 12], name: "Longer runs", session: "6 × (3 min jog + 1 min walk)" },
  { weeks: [13, 16], name: "Continuous", session: "20 min continuous easy run (you can still talk)" },
  { weeks: [17, 22], name: "5K build", session: "Easy 25–30 min run + one 5 × 1 min faster strides" },
  { weeks: [23, 99], name: "5K runner", session: "5 km easy on Saturday; a 5K time trial on the first Saturday of each month" },
];

// Skill practice during knee rehab: no hanging from a bar (getting up/down is a jump-landing risk).
const REHAB_SKILL = { name: "Push-ups and plank (rehab)", drills: ["Incline push-ups on a bench 3×10", "Wall push-ups 3×15", "Incline plank (hands on a bench) 3×30 s"] };
// One calisthenics skill per month from day 1. Practise the drills at the end of 2 gym sessions a week.
const SKILLS = [
  { name: "10 clean push-ups", test: "10 push-ups, chest to fist height, body straight", drills: ["Incline push-ups on a bench 3×10", "Wall push-ups 3×12", "Plank 3×30 s"] },
  { name: "45 s dead hang + 5 negatives", test: "Hang 45 s, then 5 slow 5-second pull-up negatives", drills: ["Dead hang 3× max", "Scapular pull-ups 3×8", "Lat pulldown slow negatives (5 s up) 3×6"] },
  { name: "First strict pull-up", test: "1 pull-up from dead hang, chin over bar", drills: ["Band or machine-assisted pull-ups 3×6", "Negatives 3×3", "Lat pulldown heavy 3×6"] },
  { name: "20 push-ups + 5 dips", test: "20 push-ups unbroken, then 5 parallel-bar dips", drills: ["Push-ups 4×max", "Bench dips 3×10", "Assisted dip machine 3×8"] },
  { name: "3 pull-ups + 10 hanging knee raises", test: "3 pull-ups, then 10 knee raises without swinging", drills: ["Pull-up singles 5×1", "Hanging knee raises 3×10", "Hollow hold 3×20 s"] },
  { name: "10 dips + 10 s tuck L-sit", test: "10 dips, then a 10 s tuck L-sit on parallettes or dip bars", drills: ["Dips 3×max", "Tuck L-sit 5×5 s", "Hanging leg raises 3×8"] },
  { name: "5 pull-ups + 10 hanging leg raises", test: "5 pull-ups, then 10 straight-leg raises (abs month)", drills: ["Pull-ups 4×3", "Hanging leg raises 3×8", "Hollow hold 3×20 s"] },
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
const WARMUP = ["Dynamic warm-up", 1, "5 min", "Tick each move as you do it"];
const COOLDOWN = ["Cool-down stretch", 1, "6 min", "Tick each stretch as you do it"];
// [move, reps, YouTube search]. Knee-safe for the right-knee ACL sprain: no squats, lunges, kneeling or jumping.
const WARMUP_STEPS = [
  ["Arm circles", "10 forward + 10 back", "arm circles warm up"],
  ["Band pull-aparts (or arm swings)", "15", "band pull apart warm up"],
  ["Seated cat-cow (on a bench)", "10 slow", "seated cat cow stretch"],
  ["Side-lying clamshells", "12 each side", "side lying clamshell exercise"],
  ["Glute bridges", "15", "glute bridge exercise form"],
  ["Bodyweight good mornings", "10", "bodyweight good morning exercise"],
  ["Standing calf raises, holding a rack", "15", "standing calf raise bodyweight"],
  ["Warm-up set of your first exercise", "1 × 12 at half the weight", "warm up sets explained"],
];
const COOLDOWN_STEPS = [
  ["Doorway chest stretch", "30 s", "doorway chest stretch"],
  ["Seated lat stretch (on a bench, reach up and lean)", "30 s each side", "seated lat stretch"],
  ["Lying hip flexor stretch: lie at the edge of a bench, LEFT leg hangs off", "30 s", "thomas stretch hip flexor"],
  ["Lying hamstring stretch", "30 s each side", "lying hamstring stretch"],
  ["Side-lying quad stretch, LEFT leg only (skip the right)", "30 s", "side lying quad stretch"],
  ["Lying slow breathing (instead of child's pose)", "60 s", "diaphragmatic breathing lying down"],
];

// Built-in knee-safe swaps, so the app works without any AI key.
const SWAPS = {
  "Cable triceps pushdown": ["Overhead cable triceps extension 3 × 12", "Seated dumbbell triceps extension 3 × 12"],
  "Lying leg curl": ["Seated leg curl (light) 3 × 12", "Skip it today if the knee complains"],
  "Seated leg curl": ["Lying leg curl (light) 3 × 12", "Skip it today if the knee complains"],
  "Hip abduction machine": ["Side-lying clamshells 3 × 15", "Cable hip abduction, holding a rack 3 × 12"],
  "Hip adduction machine": ["Pillow squeeze between the knees 3 × 15", "Skip if it pulls at the knee"],
  "Dead bug (on a flat bench)": ["Incline plank (hands on a bench) 3 × 30 s", "Pallof press 3 × 10/side"],
  "Chest-supported dumbbell row": ["Seated cable row 3 × 10", "Machine row 3 × 12"],
  "Single-arm cable row": ["Seated cable row 3 × 10", "Machine row 3 × 12"],
  "Wide-grip seated cable row": ["Rear delt fly machine 3 × 15", "Face pull 3 × 15"],
  "Straight-arm cable pulldown": ["Lat pulldown (close grip) 3 × 10", "Machine pullover 3 × 12"],
  "Lat pulldown (close grip)": ["Lat pulldown 3 × 10", "Straight-arm cable pulldown 3 × 12"],
  "EZ-bar curl": ["Cable curl 3 × 12", "Seated dumbbell curl 3 × 12"],
  "Hammer curl + overhead triceps": ["Cable curl + rope pushdown 3 × 12", "Seated dumbbell curl 3 × 12"],
  "Incline dumbbell curl + rope pushdown": ["Cable curl + rope pushdown 3 × 12", "Seated dumbbell curl 3 × 12"],
  "Cable pull-through": ["Dumbbell Romanian deadlift 3 × 10", "45° back extension 3 × 12"],
  "45° back extension": ["Cable pull-through 3 × 15", "Hip thrust 3 × 12"],
  "Pallof press": ["Incline plank (hands on a bench) 3 × 30 s", "Dead bug (on a flat bench) 3 × 10/side"],
  "Incline side plank (forearm on a bench)": ["Pallof press 3 × 10/side", "Incline plank 3 × 30 s"],
  "Incline plank (hands on a bench)": ["Pallof press 3 × 10/side", "Dead bug (on a flat bench) 3 × 10/side"],
  "Battle ropes, seated on a bench": ["Brisk flat walk intervals 6 × 1 min", "Seated arm bike, if your gym has one"],
  "Incline machine press": ["Incline dumbbell press 3 × 10", "Machine chest press 3 × 10"],
  "Machine shoulder press": ["Seated dumbbell shoulder press 3 × 10", "Arnold press 3 × 10"],
  "Dumbbell lateral raise": ["Cable lateral raise 3 × 15", "Machine lateral raise 3 × 15"],
  "Overhead cable triceps extension": ["Cable triceps pushdown 3 × 12", "Seated dumbbell triceps extension 3 × 12"],
  "Arnold press": ["Seated dumbbell shoulder press 3 × 10", "Machine shoulder press 3 × 10"],
  "Rear delt fly machine": ["Face pull 3 × 15", "Band pull-aparts 3 × 20"],
  "Hip thrust": ["Glute bridge machine 3 × 12", "Cable pull-through 3 × 15"],
  "Weighted glute bridge": ["Glute bridge machine 3 × 12", "Cable pull-through 3 × 15"],
  "Dumbbell Romanian deadlift": ["Cable pull-through 3 × 15", "Glute bridge machine 3 × 12"],
  "Machine chest press": ["Dumbbell bench press 3 × 10", "Push-ups 3 × max"],
  "Dumbbell bench press": ["Machine chest press 3 × 10", "Push-ups 3 × max"],
  "Incline dumbbell press": ["Incline machine press 3 × 10", "Low-to-high cable fly 3 × 12"],
  "Lat pulldown": ["Assisted pull-up 3 × 8", "Single-arm cable pulldown 3 × 12/side"],
  "Seated cable row": ["Chest-supported dumbbell row 3 × 10", "Machine row 3 × 12"],
  "Seated dumbbell shoulder press": ["Machine shoulder press 3 × 10", "Arnold press 3 × 10"],
  "Cable lateral raise": ["Dumbbell lateral raise 3 × 15", "Machine lateral raise 3 × 15"],
  "Face pull": ["Rear delt fly machine 3 × 15", "Band pull-aparts 3 × 20"],
  "Dumbbell curl": ["Cable curl 3 × 12", "Hammer curl 3 × 12"],
  "Farmer's carry": ["Dumbbell shrug hold 3 × 30 s", "Suitcase carry 3 × 30 m/side (flat floor)"],
}

// Natural testosterone: what actually moves it (no "booster" pills, no steroids).
const TESTOSTERONE = [
  ["Sleep 7.5–8 h", "A week of 5-hour nights can drop testosterone noticeably. The biggest lever."],
  ["Lose the fat", "Body fat converts testosterone to estrogen. Every kg lost helps, and helps the chest too."],
  ["Lift heavy compounds", "Presses, rows, pulldowns, hip thrusts and RDLs, mostly in the 6–10 rep range once form is solid."],
  ["Don't cut fat too low", "Keep 55–65 g fat a day from walnuts, pumpkin seeds, flax, dahi and paneer."],
  ["Zinc and vitamin D", "15 g pumpkin seeds a day and 15 min of morning sun. Supplement only if a blood test says you're low."],
  ["Limit alcohol", "Max 2 drinks a week; none in the 8 weeks before the abs reveal."],
  ["Keep stress down", "Walks, sunlight and sleep keep cortisol in check."],
];
const BLOOD_TEST = "Retest in mid-January 2027 (fasting 10–12 h): lipid profile (LDL, HDL, triglycerides), vitamin D, " +
  "vitamin B12, ferritin, hsCRP, fasting insulin, HbA1c, TSH, and kidney markers (BUN, creatinine). Tell the doctor you take " +
  "creatine 5 g a day: it can raise creatinine without any kidney problem. Take the October 2026 report along to compare.";
// Blood report: Orange Health Labs, 25 Oct 2026 (fasting).
const BLOOD = { date: "25 Oct 2026", ldl: 162, tg: 191, hdl: 49, tc: 249, nonHdl: 200, vldl: 38, vitD: 11.5, b12: 201,
  hscrp: 1.69, bun: 19.6, bunCreat: 29.3, glucose: 87, hba1c: 4.7, insulin: 10.4, tsh: 1.35, egfr: 130 };
const HEALTH = [
  ["Vitamin D 11.5 (deficient)", "Take D3 as prescribed, with lunch: it needs some fat in the meal to be absorbed. Plus 15 min of morning sun on the arms. Recheck after 3 months."],
  ["Cholesterol 249, LDL 162, non-HDL 200, triglycerides 191, HDL 49", "Skimmed milk and home-set low-fat dahi, olive-oil spray, brown rice, daily flax, walnuts and isabgol, nothing fried or sweet, 10k steps. Losing fat lowers triglycerides fastest."],
  ["BUN/creatinine ratio 29.3 (BUN 19.6, urea 42)", "Usually low water and/or high protein, not a kidney problem (eGFR 130 is excellent). Drink 3.5–4 L water a day and keep protein at the plan's level, not more."],
  ["Vitamin B12 201 (low-normal)", "Common for vegetarians: daily dahi and milk; ask the doctor whether to add a B12 supplement."],
  ["RDW 14.6, Mentzer index 14.9", "May point to early low iron: lemon on dal and palak, no chai or coffee within 1 hour of meals. Ferritin is on the retest list; ask the doctor before taking iron."],
  ["ALT higher than AST, hsCRP 1.69", "Both normal-range, but the pattern goes with extra body fat. Fat loss improves both; the doctor may suggest a liver ultrasound."],
  ["Good: sugar, thyroid, kidneys, liver enzymes, blood count", "Fasting glucose 87, HbA1c 4.7, insulin 10.4, TSH 1.35, eGFR 130, hemoglobin 15.6: all normal."],
  ["Right knee ACL sprain", "Physio's 4 exercises every day, Cartigen as prescribed, knee-safe gym plan. Ortho follow-up 9 Nov 2026."],
];

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
