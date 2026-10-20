// Default plan for: 28y, 5'11", 94.5 kg, ~27% body fat, vegetarian, beginner,
// left-knee pain (no deep/loaded squats), Gold's Gym Kandivali W, 60 min sessions.
// Goal look: Farhan Akhtar in Bhaag Milkha Bhaag (lean, athletic, runner's build).

const PROFILE_DEFAULT = {
  name: "", age: 28, heightCm: 180, startWeight: 94.5, bodyFat: 27.2,
  targetDate: "2027-02-12", budget: 12000, diet: "veg",
  gym: "Gold's Gym, Kandivali West", knee: "Left knee pain — avoid deep squats",
};

// ~600 kcal/day deficit from estimated maintenance (~2,850 kcal).
const TARGETS = { kcal: 2200, protein: 150, carbs: 250, fat: 60, waterL: 3.5, steps: 10000, sleepH: 7.5 };

// Mon..Sun. Each exercise: [name, sets, reps, note]
const WEEK = [
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
const MEALS = [
  { time: "7:30 Breakfast", name: "Protein oats", items: "60 g oats + 250 ml toned milk + 1 scoop whey + 1 banana", kcal: 520, p: 42 },
  { time: "1:30 Lunch", name: "Dal-soya thali", items: "2 roti + 1 katori dal + soya chunk sabzi (50 g dry) + salad + 100 g curd", kcal: 620, p: 45 },
  { time: "5:00 Snack", name: "Tofu bhurji / paneer", items: "150 g tofu bhurji (or 75 g low-fat paneer) + 1 fruit", kcal: 300, p: 24 },
  { time: "8:30 Dinner", name: "Tofu / paneer tikka bowl", items: "150 g tofu or chana + 1 cup rice or 2 roti + mixed veg", kcal: 560, p: 32 },
  { time: "10:00 Night", name: "Curd / milk", items: "200 g dahi or 250 ml milk", kcal: 150, p: 10 },
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
