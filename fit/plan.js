// Default plan for: 28y, 5'11", 94.5 kg, ~27% body fat, vegetarian, beginner,
// left-knee pain (no deep/loaded squats), Gold's Gym Kandivali W, 60 min sessions.
// Goal look: Farhan Akhtar in Bhaag Milkha Bhaag (lean, athletic, runner's build).

const PROFILE_DEFAULT = {
  name: "", age: 28, heightCm: 180, startWeight: 94.5, bodyFat: 27.2,
  targetDate: "2027-02-12", budget: 12000, diet: "veg",
  gym: "Gold's Gym, Kandivali West", knee: "Left knee pain — avoid deep squats",
};

// Realistic roadmap. Maintenance is ~2,850 kcal; deficits grow slowly so a beginner
// keeps strength and muscle. Expected loss ~0.6–0.8 kg/week after the first weeks.
const PHASES = [
  { name: "Foundation", start: "2026-10-20", end: "2026-11-16", fromKg: 94.5, toKg: 91.5,
    kcal: 2300, protein: 140, carbs: 270, fat: 65, steps: 8000,
    focus: "Learn every exercise with light weights. Build the daily habits. The first 1–2 kg is partly water.",
    food: "Follow the meal plan as written." },
  { name: "Fat loss", start: "2026-11-17", end: "2027-01-10", fromKg: 91.5, toKg: 86.5,
    kcal: 2150, protein: 150, carbs: 240, fat: 60, steps: 10000,
    focus: "Add weight whenever you hit the top of the rep range. Push the Thursday intervals harder.",
    food: "Swap the night milk for 200 g dahi. Max 1 cheat meal a week (Christmas/New Year included)." },
  { name: "Sharpen", start: "2027-01-11", end: "2027-02-12", fromKg: 86.5, toKg: 84,
    kcal: 2000, protein: 155, carbs: 200, fat: 55, steps: 12000,
    focus: "Keep lifting heavy, add 10 min incline walk after every session. Grooming and posture at their best for photos.",
    food: "Dinner: replace rice with extra sabzi + tofu. No cheat meals." },
  { name: "Milkha level", start: "2027-02-13", end: "2027-07-31", fromKg: 84, toKg: 78,
    kcal: 2100, protein: 150, carbs: 220, fat: 60, steps: 10000,
    focus: "Slower cut towards ~12% body fat. Add light jogging only if the left knee is pain-free.",
    food: "Take 1 week at maintenance (2,700 kcal) every 8 weeks." },
];
const DELOAD_WEEKS = [6, 12, 18, 24]; // weeks since start: same exercises, ~60% weight
const DAILY = { waterL: 3.5, sleepH: 7.5 };

// Mon..Sun. Each exercise: [name, sets, reps, note]
const ATHLETE_WEEK = [
  { day: "Mon", title: "Push (chest, shoulders, triceps)", ex: [
    ["Treadmill incline walk warm-up", 1, "8 min", "Incline 6–8, speed 5"],
    ["Machine chest press", 3, "10–12", ""],
    ["Incline dumbbell press", 3, "10–12", ""],
    ["Seated dumbbell shoulder press", 3, "10–12", ""],
    ["Cable lateral raise", 3, "12–15", "Key for the Milkha shoulder width"],
    ["Cable triceps pushdown", 3, "12–15", ""],
    ["Plank", 3, "30–45 s", ""],
    ["Incline walk finisher", 1, "10 min", ""],
  ]},
  { day: "Tue", title: "Legs — knee-friendly + core", ex: [
    ["Stationary bike warm-up", 1, "8 min", "Easy on the knee"],
    ["Glute bridge / hip thrust (machine or bar)", 3, "10–12", "No knee stress"],
    ["Romanian deadlift (dumbbells)", 3, "10–12", "Hinge at hips, soft knees"],
    ["Leg press — shallow range", 3, "12–15", "Stop above 90°; skip if left knee hurts"],
    ["Lying leg curl", 3, "12–15", ""],
    ["Hip abduction machine", 3, "15", "Strengthens hips → protects knee"],
    ["Standing calf raise", 3, "15", ""],
    ["Dead bug", 3, "10/side", ""],
  ]},
  { day: "Wed", title: "Pull (back, biceps)", ex: [
    ["Rowing machine warm-up", 1, "6 min", ""],
    ["Lat pulldown", 3, "10–12", "Builds the V-taper"],
    ["Seated cable row", 3, "10–12", ""],
    ["Chest-supported dumbbell row", 3, "10–12", ""],
    ["Face pull", 3, "15", "Posture + rear delts"],
    ["Dumbbell curl", 3, "10–12", ""],
    ["Hanging knee raise", 3, "10–12", ""],
    ["Incline walk finisher", 1, "10 min", ""],
  ]},
  { day: "Thu", title: "Athlete conditioning (Milkha day)", ex: [
    ["Bike or elliptical warm-up", 1, "8 min", ""],
    ["Bike intervals", 8, "30 s hard / 90 s easy", "Low-impact on the knee"],
    ["Kettlebell swing", 3, "15", ""],
    ["Farmer's carry", 3, "40 m", ""],
    ["Pallof press", 3, "10/side", ""],
    ["Side plank", 3, "30 s/side", ""],
    ["Stretch: hip flexors, hamstrings, chest", 1, "8 min", ""],
  ]},
  { day: "Fri", title: "Upper body + arms", ex: [
    ["Treadmill incline walk warm-up", 1, "6 min", ""],
    ["Assisted pull-up machine", 3, "8–10", "Goal: first unassisted pull-up"],
    ["Dumbbell bench press", 3, "10–12", ""],
    ["Arnold press", 3, "10–12", ""],
    ["Rear delt fly machine", 3, "15", ""],
    ["Hammer curl + overhead triceps (superset)", 3, "12 each", ""],
    ["Cable crunch", 3, "15", ""],
  ]},
  { day: "Sat", title: "Active recovery", ex: [
    ["Outdoor walk or easy cycle", 1, "45–60 min", "e.g. around Mahavir Nagar / Thakur Village"],
    ["Mobility routine", 1, "15 min", ""],
  ]},
  { day: "Sun", title: "Rest", ex: [["Rest, meal prep, Zepto order", 1, "—", ""]] },
];

// ~2,200 kcal, ~150 g protein, vegetarian, home-cooked.
// Each slot has 3 options with similar calories/protein — pick any, the totals stay on plan.
const MEALS = [
  { time: "7:30 Breakfast", options: [
    { name: "Protein oats", items: "60 g oats + 250 ml toned milk + 1 scoop whey + 1 banana", kcal: 520, p: 42 },
    { name: "Besan-paneer chilla", items: "2 besan chilla with 75 g paneer stuffing + green chutney + 200 ml milk", kcal: 500, p: 36 },
    { name: "Moong dal chilla + whey", items: "2 moong dal chilla + 100 g curd + 1 scoop whey in water", kcal: 480, p: 45 },
  ]},
  { time: "1:30 Lunch", options: [
    { name: "Dal-soya thali", items: "2 roti + 1 katori dal + soya chunk sabzi (50 g dry) + salad + 100 g curd", kcal: 620, p: 45 },
    { name: "Rajma-rice bowl", items: "1 katori rajma + 1 cup rice + 100 g tofu sabzi + salad + 100 g curd", kcal: 630, p: 38 },
    { name: "Paneer bhurji thali", items: "2 roti + 100 g low-fat paneer bhurji + 1 katori dal + salad", kcal: 610, p: 42 },
  ]},
  { time: "5:00 Snack", options: [
    { name: "Tofu bhurji", items: "150 g tofu bhurji + 1 fruit", kcal: 300, p: 24 },
    { name: "Roasted chana + curd", items: "40 g roasted chana + 200 g dahi + 1 fruit", kcal: 320, p: 22 },
    { name: "Whey shake + peanuts", items: "1 scoop whey in milk + 15 g peanuts", kcal: 330, p: 33 },
  ]},
  { time: "8:30 Dinner", options: [
    { name: "Tofu tikka bowl", items: "150 g tofu tikka + 1 cup rice or 2 roti + mixed veg", kcal: 560, p: 32 },
    { name: "Soya pulao + raita", items: "50 g soya chunks in 1 cup veg pulao + 150 g raita", kcal: 550, p: 34 },
    { name: "Chana-palak + roti", items: "1.5 katori chana palak + 2 roti + 100 g curd", kcal: 560, p: 28 },
  ]},
  { time: "10:00 Night", options: [
    { name: "Dahi", items: "200 g dahi (plain)", kcal: 130, p: 8 },
    { name: "Haldi milk", items: "250 ml toned milk + haldi", kcal: 150, p: 8 },
    { name: "Hung curd bowl", items: "150 g hung curd + cinnamon", kcal: 140, p: 14 },
  ]},
];

// Weekly Zepto list, approximate Mumbai prices (editable in the app).
const GROCERY = [
  { item: "Tofu 200 g", qty: 4, price: 90 },
  { item: "Low-fat paneer 200 g", qty: 2, price: 95 },
  { item: "Dahi 400 g", qty: 4, price: 50 },
  { item: "Toned milk 500 ml", qty: 7, price: 28 },
  { item: "Soya chunks 200 g", qty: 1, price: 60 },
  { item: "Moong / masoor dal 500 g", qty: 1, price: 75 },
  { item: "Kabuli chana 500 g", qty: 1, price: 75 },
  { item: "Rolled oats 1 kg (lasts 2 wks)", qty: 0.5, price: 180 },
  { item: "Atta 1 kg + rice 1 kg", qty: 1, price: 110 },
  { item: "Vegetables (onion, tomato, spinach, capsicum…)", qty: 1, price: 350 },
  { item: "Fruits (banana, apple, papaya)", qty: 1, price: 200 },
  { item: "Peanut butter 500 g (lasts 2 wks)", qty: 0.5, price: 180 },
];
const MONTHLY_EXTRAS = [
  { item: "Whey protein 1 kg (~1 scoop/day)", price: 2300 },
  { item: "Creatine monohydrate 250 g (lasts ~2 months)", price: 350 },
  { item: "Grooming (sunscreen, face wash, moisturiser, beard)", price: 600 },
];

const GROOMING = {
  am: ["Gentle face wash", "Moisturiser", "Sunscreen SPF 50 (every day, even indoors)"],
  pm: ["Face wash", "Niacinamide serum (oil + marks)", "Moisturiser"],
  weekly: ["Beard: short stubble + thick moustache (Milkha style)", "Haircut: short sides, slightly longer top — every 3–4 weeks",
    "Exfoliate once a week", "Trim nails, clean eyebrows"],
  posture: ["Wall angels 2×10", "Chin tucks 2×10", "Doorway chest stretch 2×30 s", "Stand tall: ribs down, shoulders back"],
  habits: ["Sleep 7–8 h", "Water 3.5 L", "10k steps", "No phone 30 min before bed"],
};

// Training programs, inspired by the publicly shared principles of well-known coaches.
// These are not their official programs; all are adapted for a beginner with a sore left knee.
const UPPER_LOWER = [
  { day: "Mon", title: "Upper A (strength)", ex: [
    ["Bike warm-up", 1, "5 min", ""], ["Dumbbell bench press", 3, "6–10", "Last set close to failure"],
    ["Chest-supported row", 3, "8–12", ""], ["Seated dumbbell shoulder press", 3, "8–12", ""],
    ["Lat pulldown", 3, "10–12", ""], ["Cable lateral raise", 3, "12–15", ""], ["EZ-bar curl + pushdown (superset)", 2, "12 each", ""] ]},
  { day: "Tue", title: "Lower A (knee-friendly)", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Romanian deadlift", 3, "8–10", ""], ["Hip thrust", 3, "8–12", ""],
    ["Leg press — shallow range", 3, "12–15", "Stop above 90°"], ["Seated leg curl", 3, "10–15", ""],
    ["Standing calf raise", 3, "12–15", ""], ["Cable crunch", 3, "12–15", ""] ]},
  { day: "Wed", title: "Rest or 45-min incline walk", ex: [["Incline walk", 1, "45 min", ""], ["Mobility", 1, "10 min", ""]] },
  { day: "Thu", title: "Upper B (hypertrophy)", ex: [
    ["Rowing warm-up", 1, "5 min", ""], ["Incline machine press", 3, "10–12", ""], ["Seated cable row", 3, "10–12", ""],
    ["Assisted pull-up", 3, "8–10", ""], ["Machine fly", 2, "12–15", ""], ["Lateral raise", 3, "15–20", ""],
    ["Face pull", 2, "15", ""] ]},
  { day: "Fri", title: "Lower B + conditioning", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Dumbbell RDL", 3, "10–12", ""], ["Glute bridge (single-leg, right first)", 3, "10/side", ""],
    ["Hip abduction", 3, "15", ""], ["Lying leg curl", 3, "12", ""], ["Bike intervals", 6, "30 s hard / 90 s easy", ""] ]},
  { day: "Sat", title: "Active recovery", ex: [["Walk or easy cycle", 1, "45–60 min", ""], ["Mobility", 1, "15 min", ""]] },
  { day: "Sun", title: "Rest", ex: [["Rest, meal prep, Zepto order", 1, "—", ""]] },
];
const FULL_BODY = [
  { day: "Mon", title: "Full body A", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Machine chest press", 3, "8–12", ""], ["Lat pulldown", 3, "8–12", ""],
    ["Hip thrust", 3, "10–12", ""], ["Dumbbell shoulder press", 2, "10–12", ""], ["Plank", 3, "30–45 s", ""],
    ["Incline walk", 1, "12 min", ""] ]},
  { day: "Tue", title: "Steps day", ex: [["Walk", 1, "10k steps", ""], ["Mobility", 1, "10 min", ""]] },
  { day: "Wed", title: "Full body B", ex: [
    ["Rowing warm-up", 1, "6 min", ""], ["Romanian deadlift", 3, "8–10", ""], ["Incline dumbbell press", 3, "8–12", ""],
    ["Seated cable row", 3, "10–12", ""], ["Lateral raise", 3, "12–15", ""], ["Dead bug", 3, "10/side", ""],
    ["Bike intervals", 6, "30 s hard / 90 s easy", ""] ]},
  { day: "Thu", title: "Steps day", ex: [["Walk", 1, "10k steps", ""], ["Mobility", 1, "10 min", ""]] },
  { day: "Fri", title: "Full body C", ex: [
    ["Bike warm-up", 1, "6 min", ""], ["Leg press — shallow range", 3, "12–15", ""], ["Assisted pull-up", 3, "8–10", ""],
    ["Dumbbell bench press", 3, "8–12", ""], ["Face pull", 3, "15", ""], ["Curl + pushdown (superset)", 2, "12 each", ""],
    ["Farmer's carry", 3, "40 m", ""] ]},
  { day: "Sat", title: "Long walk", ex: [["Walk or easy cycle", 1, "60 min", ""], ["Mobility", 1, "15 min", ""]] },
  { day: "Sun", title: "Rest", ex: [["Rest, meal prep, Zepto order", 1, "—", ""]] },
];

const PROGRAMS = [
  { id: "athlete", name: "Milkha Athlete", days: 5, week: ATHLETE_WEEK,
    by: "Inspired by Samir Jaura (Farhan Akhtar's trainer for Bhaag Milkha Bhaag)",
    why: "Athlete-style: lifting plus a hard conditioning day. Closest to the lean, explosive runner look in the film." },
  { id: "upperlower", name: "Science Upper/Lower", days: 4, week: UPPER_LOWER,
    by: "Inspired by Jeff Nippard and Dr Mike Israetel's evidence-based principles",
    why: "Each muscle twice a week, close-to-failure sets, slow progression. Best for building shoulders and arms while cutting." },
  { id: "fullbody", name: "Beginner Full Body", days: 3, week: FULL_BODY,
    by: "Inspired by classic beginner full-body programming",
    why: "3 gym days + walking days. Pick this for busy or travel weeks so you never fall off the plan." },
];
let WEEK = ATHLETE_WEEK; // set from the user's chosen program at startup

// Coaches whose public advice shapes the rest of the app.
const COACHES = [
  { name: "Samir Jaura", area: "Training", note: "Farhan Akhtar's trainer for Bhaag Milkha Bhaag; functional, athlete-style training." },
  { name: "Jeff Nippard", area: "Training", note: "Evidence-based hypertrophy: progressive overload, sets near failure." },
  { name: "Dr Mike Israetel", area: "Training", note: "Volume landmarks and deloads — why the app has a deload week every 6 weeks." },
  { name: "Rujuta Diwekar", area: "Indian food", note: "Home-cooked Indian food, dahi, dal-chawal; no crash diets." },
  { name: "Ryan Fernando", area: "Nutrition", note: "Indian sports nutrition; high protein from everyday vegetarian food." },
  { name: "Andrew Huberman", area: "Recovery", note: "Morning daylight, consistent sleep — behind the sleep and steps habits." },
];
