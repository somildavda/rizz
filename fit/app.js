// Journey — local-first fitness app. All data lives in this browser's localStorage.
const KEY = "journey-v1", OLD_KEY = "milkha-mode-v1";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => d.toLocaleDateString("en-CA");
const today = () => iso(new Date());
const dayIdx = (d = new Date()) => (d.getDay() + 6) % 7; // Mon = 0 (calendar weeks)
const DAY_MS = 864e5;
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmt = (k) => new Date(k).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const zepto = (q) => `https://www.zepto.com/search?query=${encodeURIComponent(q)}`;
const blinkit = (q) => `https://blinkit.com/s/?q=${encodeURIComponent(q)}`;
const cleanName = (n) => n.replace(/\s*\(.*?\)/g, "");

// ---------- state ----------
let S = load();
function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || JSON.parse(localStorage.getItem(OLD_KEY)) || {}; } catch {}
  const profile = { ...PROFILE_DEFAULT, ...s.profile, knee: PROFILE_DEFAULT.knee };
  if (!s.v2) profile.targetDate = PROFILE_DEFAULT.targetDate; // plan restarted on 21 Oct with a new target
  return {
    v2: true, v3: true, profile,
    settings: { geminiKey: "", model: "gemini-2.5-flash", ...s.settings },
    days: s.days || {}, weights: s.weights || [], prices: s.prices || {},
    program: "athlete", treatments: s.treatments || [],
    runs: s.runs || [], skills: s.skills || {}, weekly: s.weekly || {},
  };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }
function day(d = today()) {
  const x = (S.days[d] ??= { checks: {}, food: [], sets: {} });
  x.checks ??= {}; x.food ??= []; x.sets ??= {};
  return x;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- plan maths ----------
const START = new Date(START_DATE);
const dayNo = () => Math.max(1, Math.floor((new Date(today()) - START) / DAY_MS) + 1);
const totalDays = () => Math.round((new Date(S.profile.targetDate) - START) / DAY_MS) + 1;
const weekNo = (d = new Date()) => Math.max(1, Math.floor((new Date(iso(d)) - START) / (7 * DAY_MS)) + 1);
const phaseIndex = (d = new Date()) => {
  const k = iso(d), i = PHASES.findIndex((p) => k >= p.start && k <= p.end);
  return i >= 0 ? i : k < PHASES[0].start ? 0 : PHASES.length - 1;
};
const phase = (d) => PHASES[phaseIndex(d)];
const isDeload = () => DELOAD_WEEKS.includes(weekNo());
function expectedKg(d) {
  const p = phase(d), a = new Date(p.start), b = new Date(p.end);
  return p.fromKg + (p.toKg - p.fromKg) * Math.min(1, Math.max(0, (d - a) / (b - a)));
}
const latest = () => S.weights.at(-1) || {};
const latestWeight = () => latest().kg ?? S.profile.startWeight;
const program = () => PROGRAMS[0]; // one program: Milkha Athlete (knee-safe while KNEE.rehab)
// Programs with blocks change exercises every 4 weeks (block A → B → A …).
const blockIndex = () => Math.floor(Math.max(0, (new Date(today() < START_DATE ? START_DATE : today()) - new Date(START_DATE)) / 864e5) / 28);
function applyProgram() { const p = program(); WEEK = p.blocks ? p.blocks[blockIndex() % p.blocks.length] : p.week; }
// Knee rehab stays on until Settings says the ortho cleared full training.
KNEE.rehab = !S.settings.kneeCleared;
applyProgram();
// Fixed weekly schedule: Mon/Wed/Fri gym, Tue/Thu steps, Sat walk, Sun rest (gym closed).
const cyc = (d = new Date()) => dayIdx(new Date(iso(new Date(d))));
const isGymDay = (d = new Date()) => WEEK[cyc(d)].ex.length > 2;
// Running waits for the ortho: while the knee is in rehab, stay on flat walking.
const runStage = () => KNEE.rehab ? RUN_PLAN[0] : RUN_PLAN.find((r) => weekNo() >= r.weeks[0] && weekNo() <= r.weeks[1]) || RUN_PLAN.at(-1);
// The day the plan shows by default: today, or Day 1 if the journey hasn't started yet.
const planDay = () => (today() < START_DATE ? START_DATE : today());
const addDays = (k, n) => { const d = new Date(k); d.setDate(d.getDate() + n); return iso(d); };
const dayLabel = (k) => k === today() ? "Today" : k === addDays(today(), 1) ? "Tomorrow" :
  new Date(k).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
const slotLabel = (slot, gym) => (!gym && slot.label.startsWith("Post-gym") ? "Breakfast" : slot.label);
const journeyDay = (k) => Math.floor((new Date(k) - START) / DAY_MS) + 1;
const skillIndex = () => Math.min(SKILLS.length - 1, Math.floor((dayNo() - 1) / 30));

// Exercises for a weekday, with this month's skill practice added to Mon/Wed/Fri gym days.
function exList(di) {
  const w = WEEK[di], ex = kneeSafe(w.ex);
  if (w.ex.length > 2 && [0, 2, 4].includes(di)) {
    const sk = KNEE.rehab ? REHAB_SKILL : SKILLS[skillIndex()];
    ex.splice(ex.length - 1, 0, [`Skill practice: ${sk.name}`, 1, "10 min", sk.drills.join(" · ")]);
  }
  if (w.ex.length > 2) { ex.splice(1, 0, WARMUP); ex.push(COOLDOWN); }
  return ex;
}

// Meal swaps shared with the kitchen view through the Claude page's shared store.
// Only {date: {slot: dish}} is shared; weight, workouts and everything else stay on this device.
// Two backends: inside Claude, the page's shared store; on the Cloudflare site, /api/menu.
let SHARED = {}, menuDb = null, menuApi = false;
const onSite = () => /^https?:$/.test(location.protocol) && !window.claude;
(async () => {
  try { menuDb = window.claude?.use ? await window.claude.use("db") : null; } catch { menuDb = null; }
  if (menuDb) {
    menuDb.collection("menu").onSnapshot((qs) => {
      SHARED = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()?.picks || {}]));
      render();
    }, () => {});
    return;
  }
  if (!/^https?:$/.test(location.protocol) || window.claude) return;
  try {
    const res = await fetch("/api/menu", { cache: "no-store" });
    if (res.ok) { SHARED = await res.json(); menuApi = true; render(); }
  } catch {}
})();
let pushing = Promise.resolve();
function sharePicks(d) {
  const picks = { ...(S.days[d]?.mealPick || {}) };
  if (menuDb) {
    pushing = pushing.then(() => menuDb.doc(`menu/${d}`).set({ picks })).catch(() => toast("Couldn't sync this swap to the kitchen view"));
  } else if (onSite()) {
    // On the website: always try (don't depend on the first load having worked) and say what happened.
    if (!S.settings.syncKey) return toast("Not sent to the kitchen: add your kitchen sync key in Settings (gear icon)");
    pushing = pushing.then(async () => {
      const res = await fetch(`/api/menu/${d}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Edit-Key": S.settings.syncKey },
        body: JSON.stringify({ picks }) });
      if (res.status === 401) return toast("Not sent: wrong kitchen sync key. Fix it in Settings");
      if (!res.ok) throw new Error();
      SHARED[d] = picks; menuApi = true; S.settings.lastSync = Date.now(); save();
      toast("Sent to the kitchen ✓ (her page updates within a minute)");
    }).catch(() => toast("Not sent to the kitchen: no connection. Swap again when online"));
  }
}

// Meals rotate by date so every day differs; a hand-picked option for that day wins.
function mealPickIdx(i, d = today()) {
  const own = S.days[d]?.mealPick?.[i] ?? SHARED[d]?.[i];
  if (own != null && own < mealOptions(i, d).length) return own;
  return defaultMealIdx(i, d);
}
const meal = (i, d = today()) => mealOptions(i, d)[mealPickIdx(i, d)];

// Today's calorie target: phase base, more on gym days, less on rest days, and lower
// automatically when the gym or walk is skipped. After 9 pm an unlogged gym day counts as skipped.
function dayTargets(d = today()) {
  const date = new Date(d), ph = phase(date), c = S.days[d]?.checks || {};
  const gym = isGymDay(date), reasons = [];
  let kcal = ph.kcal;
  const autoSkip = gym && !c.workout && !c.trainedLate && d === today() && new Date().getHours() >= 21;
  const skippedGym = gym && !c.workout && (c.skipGym || autoSkip);
  if (!gym) { kcal += ADJUST.restDay; reasons.push(`Rest day ${ADJUST.restDay}`); }
  else if (skippedGym) { kcal += ADJUST.skippedGym; reasons.push(`Skipped gym ${ADJUST.skippedGym}${autoSkip && !c.skipGym ? " (auto, 9 pm)" : ""}`); }
  else { kcal += ADJUST.gymDay; reasons.push(`Gym day +${ADJUST.gymDay}`); }
  if (c.skipWalk) { kcal += ADJUST.skippedWalk; reasons.push(`Missed walk ${ADJUST.skippedWalk}`); }
  return { kcal, protein: ph.protein, fat: ph.fat, carbs: Math.max(100, ph.carbs + Math.round((kcal - ph.kcal) / 4)),
    reasons, gym, skippedGym, autoSkip: autoSkip && !c.skipGym };
}

// ---------- Gemini ----------
async function gemini(prompt, { json = false, image = null } = {}) {
  const k = S.settings.geminiKey.trim();
  if (!k) throw new Error("Add your Gemini API key in Settings (gear icon, top right).");
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.type, data: image.data } });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(S.settings.model)}:generateContent`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": k },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: json ? { responseMimeType: "application/json" } : {} }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return json ? JSON.parse(text) : text;
}
// Free fallback (no key): Pollinations' public text endpoint. Text only, may be slow or down.
async function freeAI(prompt) {
  const res = await fetch("https://text.pollinations.ai/openai", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai", messages: [{ role: "user", content: prompt }] }) });
  if (!res.ok) throw new Error(`Free AI unavailable (${res.status})`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
// Inside the Claude app the page can ask Claude directly (the viewer's own account, no key).
// claude.use resolves null outside a Claude viewer, e.g. on GitHub Pages.
let sampleFn;
const getSample = async () => {
  if (sampleFn !== undefined) return sampleFn;
  try { sampleFn = window.claude?.use ? await window.claude.use("sample") : null; } catch { sampleFn = null; }
  return sampleFn;
};
const HIDE_CODES = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed", "images_unavailable"];
async function ai(prompt, opts = {}) {
  const smp = await getSample();
  if (smp) {
    try {
      const o = opts.file ? { images: opts.file } : {};
      return opts.json ? await smp.json(prompt, o) : (await smp(prompt, o)).text;
    } catch (e) {
      if (e?.code === "rate_limited") throw new Error("Too many AI requests right now. Try again in a few minutes.");
      if (!HIDE_CODES.includes(e?.code)) throw new Error("Claude couldn't answer that. Try again or rephrase.");
      // not allowed here: fall through to Gemini / the free model
    }
  }
  if (S.settings.geminiKey.trim()) return gemini(prompt, opts);
  if (opts.image) throw new Error("Photo analysis needs a Gemini key (Settings). Type the food instead.");
  try {
    const text = await freeAI(prompt);
    return opts.json ? JSON.parse(text.replace(/^[^{]*/, "").replace(/[^}]*$/, "")) : text;
  } catch (e) {
    throw new Error("The free AI didn't respond. Try again later, or add a Gemini key in Settings.");
  }
}

// ---- offline food logging ----
const NUM_WORDS = { a: 1, an: 1, one: 1, half: 0.5, two: 2, three: 3, four: 4, five: 5 };
function parseFood(text) {
  const found = [], missed = [];
  for (const raw of text.toLowerCase().split(/,|\+|\band\b|\n|&/)) {
    const part = raw.trim(); if (!part) continue;
    const food = FOODS.slice().sort((a, b) => Math.max(...b.k.map((x) => x.length)) - Math.max(...a.k.map((x) => x.length)))
      .find((f) => f.k.some((k) => part.includes(k)));
    if (!food) { missed.push(part); continue; }
    const g = part.match(/(\d+(?:\.\d+)?)\s*(g|gm|gms|grams?|ml)\b/);
    const n = part.match(/(\d+(?:\.\d+)?)/), w = part.split(/\s+/).find((x) => NUM_WORDS[x] != null);
    let m, label;
    if (g && food.per100) { m = food.per100.map((v) => (v * +g[1]) / 100); label = `${g[1]} ${g[2].startsWith("m") ? "ml" : "g"}`; }
    else {
      const qty = n ? +n[1] : w ? NUM_WORDS[w] : 1;
      const base = food.per || food.per100.map((v) => (v * parseFloat(food.unit)) / 100);
      m = base.map((v) => v * qty); label = `${qty} ${food.unit}`;
    }
    found.push({ name: `${food.k[0][0].toUpperCase() + food.k[0].slice(1)} (${label})`, kcal: Math.round(m[0]), p: Math.round(m[1]), c: Math.round(m[2]), f: Math.round(m[3]) });
  }
  return { found, missed };
}

// ---- offline weekly review ----
function localReview() {
  const r = recent(14), days = Object.entries(r.days), out = [];
  const logged = days.filter(([, d]) => d.totals.kcal > 0);
  if (logged.length) {
    const avg = (f) => Math.round(logged.reduce((a, [, d]) => a + f(d), 0) / logged.length);
    const k = avg((d) => d.totals.kcal), t = avg((d) => d.target), pr = avg((d) => d.totals.p);
    out.push(`Calories: you averaged ${k} kcal against a ${t} kcal target (${k > t + 100 ? "over, trim dinner rice/roti" : k < t - 300 ? "too low, add a whey shake so you don't lose muscle" : "on target"}).`);
    out.push(`Protein: ${pr} g a day on average; target ${phase().protein} g. ${pr < phase().protein - 15 ? "Add ½ scoop whey or 75 g High Protein Paneer." : "Good."}`);
  } else out.push("No food logged yet. Tick your meals on Today so the review has something to work with.");
  const gymDays = days.filter(([k]) => isGymDay(new Date(k))).length, done = days.filter(([, d]) => d.checks.workout).length;
  out.push(`Workouts: ${done} done${gymDays ? ` out of ${gymDays} planned` : ""} in the last 2 weeks.`);
  if (r.weights.length > 1) {
    const ch = r.weights.at(-1).kg - r.weights[0].kg;
    out.push(`Weight: ${ch > 0 ? "+" : ""}${ch.toFixed(1)} kg over ${r.weights.length} weigh-ins. Aim for −0.5 to −0.8 kg a week.`);
  }
  const bloat = {}, all = {};
  days.forEach(([, d]) => (d.meals || []).forEach((m) => { all[m] = (all[m] || 0) + 1; if (d.feel?.bloat >= 1) bloat[m] = (bloat[m] || 0) + 1; }));
  const suspects = Object.keys(bloat).filter((m) => all[m] >= 2 && bloat[m] / all[m] >= 0.6);
  if (suspects.length) out.push(`Possible bloating triggers: ${suspects.join(", ")}. Try swapping them for a week.`);
  const en = days.filter(([, d]) => d.feel?.energy);
  if (en.length >= 4) {
    const a = (arr) => arr.length ? (arr.reduce((x, [, d]) => x + d.feel.energy, 0) / arr.length).toFixed(1) : "—";
    out.push(`Energy: ${a(en.filter(([, d]) => d.checks.workout))}/5 on workout days vs ${a(en.filter(([, d]) => !d.checks.workout))}/5 on other days.`);
  }
  const sl = days.filter(([, d]) => d.checks.sleep).length;
  out.push(`Sleep target hit on ${sl} of ${days.length || 14} days. ${sl < 10 ? "Sleep is the biggest testosterone lever; protect it." : ""}`);
  return "• " + out.join("\n• ");
}

const coachContext = () => {
  const p = S.profile, ph = phase();
  return `User: ${p.age}y Indian male, ${p.heightCm} cm, ${latestWeight()} kg, ~${p.bodyFat}% body fat at start, vegetarian,
never suggest: ${AVOID_FOODS.join(", ")}; for cholesterol also avoid ${HEALTH_AVOID.join(", ")}. Uses iD Fresh High Protein Paneer. Beginner lifter, gym at ${GYM_TIME} at ${p.gym}, ${p.knee}.
Blood (${BLOOD.date}): total cholesterol ${BLOOD.tc}, LDL ${BLOOD.ldl}, non-HDL ${BLOOD.nonHdl}, triglycerides ${BLOOD.tg}, HDL ${BLOOD.hdl}, vitamin D ${BLOOD.vitD} (deficient), B12 ${BLOOD.b12},
hsCRP ${BLOOD.hscrp}, BUN/creatinine ratio ${BLOOD.bunCreat} (hydrate), glucose ${BLOOD.glucose}, HbA1c ${BLOOD.hba1c}, TSH ${BLOOD.tsh}, eGFR ${BLOOD.egfr}; on D3 and Cartigen.
${KNEE.side} knee ACL sprain in rehab (follow-up ${KNEE.followUp}): never suggest stairs, squats, lunges, kneeling, jumping or running.
Program: ${program().name}, ${program().days} days/week. Goals: V-taper, 2–4 visible abs, better chest shape (has chest fat),
sharp jawline, Hrithik-style grooming, walk-to-run, monthly calisthenics skills (this month: ${SKILLS[skillIndex()].name}).
Day ${dayNo()} of the journey; phase ${ph.name} (${ph.kcal} kcal, ${ph.protein} g protein); target ${p.targetDate}.
Budget ₹${p.budget}/month, orders on Zepto/Blinkit, cooks at home. ${p.derm ? "Dermatologist routine: " + p.derm : ""}`;
};
function fileToB64(file) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok({ type: file.type || "image/jpeg", data: String(r.result).split(",")[1] });
    r.onerror = bad; r.readAsDataURL(file);
  });
}

// ---------- UI helpers ----------
const foodTotals = (d) => d.food.reduce((t, f) => ({ kcal: t.kcal + (+f.kcal || 0), p: t.p + (+f.p || 0),
  c: t.c + (+f.c || 0), f: t.f + (+f.f || 0), fib: t.fib + (+f.fib || 0) }), { kcal: 0, p: 0, c: 0, f: 0, fib: 0 });
const tick = (id, title, sub = "", meta = "") => {
  const on = !!day().checks[id];
  return `<div class="tick ${on ? "on" : ""}" data-check="${esc(id)}" role="checkbox" aria-checked="${on}" tabindex="0"><span class="box"></span>
    <div class="t"><b>${title}</b>${sub ? `<span class="sub">${sub}</span>` : ""}</div>${meta ? `<span class="meta">${meta}</span>` : ""}</div>`;
};
const weekKey = () => `w${weekNo()}`;
const wtick = (id, title, sub = "", bucket = weekKey()) => {
  const on = !!S.weekly[bucket]?.[id];
  return `<div class="tick ${on ? "on" : ""}" data-wcheck="${esc(id)}" data-bucket="${bucket}" role="checkbox" aria-checked="${on}" tabindex="0"><span class="box"></span>
    <div class="t"><b>${esc(title)}</b>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</div></div>`;
};
const vid = (q, label = "Watch how") => `<a class="vid" href="${yt(q)}" target="_blank" rel="noopener">▶ ${label}</a>`;
const shopLinks = (g) => `<span class="shoplinks">${g.link ? `<a href="${g.link}" target="_blank" rel="noopener">Zepto ★</a>` :
  `<a href="${zepto(g.q)}" target="_blank" rel="noopener">Zepto</a>`}<a href="${blinkit(g.q)}" target="_blank" rel="noopener">Blinkit</a><a href="https://www.swiggy.com/instamart/search?custom_back=true&query=${encodeURIComponent(g.q)}" target="_blank" rel="noopener">Instamart</a></span>`;
function ring(val, max, color, unit) {
  const r = 36, c = 2 * Math.PI * r, f = Math.min(1, max ? val / max : 0);
  return `<div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--track)" stroke-width="7"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/></svg>
    <div class="v"><span>${Math.round(val)}<small>/ ${max}${unit ? " " + unit : ""}</small></span></div></div>`;
}
// The calendar week (Mon–Sun) shown on Train: the one containing the plan day.
function dateOfCyc(i) {
  const pd = new Date(planDay()); pd.setDate(pd.getDate() - dayIdx(pd) + i);
  return pd;
}
function workoutsThisWeek() {
  const mon = dateOfCyc(0);
  return WEEK.map((_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return !!S.days[iso(d)]?.checks.workout; });
}
function lastSets(name) {
  const keys = Object.keys(S.days).filter((k) => k < today()).sort().reverse();
  for (const k of keys) {
    const s = S.days[k].sets?.[name];
    if (Array.isArray(s) && s.some((x) => x && typeof x === "object" && x.kg)) return { date: k, sets: s };
  }
  return null;
}
// Warm-up / cool-down as a tickable checklist, stored on the given date.
function stepList(name, d) {
  const steps = name === WARMUP[0] ? WARMUP_STEPS : name === COOLDOWN[0] ? COOLDOWN_STEPS : null;
  if (!steps) return "";
  const key = name === WARMUP[0] ? "wu" : "cd", c = S.days[d]?.checks || {};
  const done = steps.filter((_, i) => c[key + i]).length;
  return `<div class="steps"><div class="sub">${done}/${steps.length} done</div>${steps.map(([n, r, q], i) => {
    const on = !!c[key + i];
    return `<div class="tick ${on ? "on" : ""}" data-check="${key}${i}" data-date="${d}" role="checkbox" aria-checked="${on}" tabindex="0"><span class="box"></span>
      <div class="t"><b>${esc(n)}</b><span class="sub">${esc(r)}</span></div><span class="meta">${vid(q, "Video")}</span></div>`;
  }).join("")}</div>`;
}
// ---------- progression ----------
// Rest by exercise type: big compound lifts 2:00, smaller moves 1:15, core/carries 1:00.
function restSec(name) {
  const n = name.toLowerCase();
  // Short enough that a session fits ~45 min in the gym (8:30–9:30 including travel).
  if (/plank|dead bug|crunch|knee raise|pallof|side plank|carry/.test(n)) return 45;
  if (/press|row|pulldown|pull-up|thrust|deadlift|leg press|swing/.test(n) && !/pushdown/.test(n)) return 90;
  return 60;
}
const fmtRest = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const repRange = (reps) => { const m = String(reps).match(/(\d+)(?:–(\d+))?/); return m ? [+m[1], +(m[2] || m[1])] : null; };
// Gym weights are stored in kg and shown in the chosen unit (lb by default; Settings).
const LB = 2.20462;
const lbMode = () => (S.settings.unit || "lb") === "lb";
const U = () => (lbMode() ? "lb" : "kg");
const toDisp = (kg) => (kg === "" || kg == null || isNaN(+kg) ? "" : lbMode() ? Math.round((+kg * LB) / 2.5) * 2.5 : Math.round(+kg * 4) / 4);
const fromDisp = (v) => (v === "" || isNaN(+v) ? "" : String(Math.round((lbMode() ? +v / LB : +v) * 1000) / 1000));
const wt = (kg) => `${toDisp(kg)} ${U()}`;
// "20–25 kg stack" → "45–55 lb stack" in lb mode.
const wtText = (t) => (lbMode() ? String(t).replace(/(\d+(?:\.\d+)?)(?:–(\d+(?:\.\d+)?))?\s*kg/g,
  (m, a, b) => `${Math.round((a * LB) / 2.5) * 2.5}${b ? "–" + Math.round((b * LB) / 2.5) * 2.5 : ""} lb`) : t);
const startKg = (name) => { const m = (START_WEIGHTS[name] || "").match(/(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };
// Progression step: +5 lb (+2.5 kg) on big lifts, +2.5 lb (+1.25 kg) on small cable/isolation moves.
const smallMove = (name) => /lateral|fly|face pull|pushdown|curl|rear delt|cable crunch|triceps/i.test(name);
const kgStep = (name) => (lbMode() ? (smallMove(name) ? 2.5 : 5) / LB : smallMove(name) ? 1.25 : 2.5);
const stepText = (name) => (lbMode() ? `+${smallMove(name) ? 2.5 : 5} lb` : `+${smallMove(name) ? 1.25 : 2.5} kg`);
const roundKg = (x) => (lbMode() ? (Math.round((x * LB) / 2.5) * 2.5) / LB : Math.round(x / 1.25) * 1.25);
function history(name, n = 3) {
  return Object.keys(S.days).filter((k) => k < today()).sort().reverse()
    .map((k) => ({ date: k, sets: (S.days[k].sets?.[name] || []).filter((x) => x && x.kg && x.reps) }))
    .filter((h) => h.sets.length).slice(0, n);
}
// Double progression: top of the range on every set → add weight; otherwise add reps.
function target(name, reps) {
  const range = repRange(reps);
  if (!range || isTimed(String(reps))) return null;
  const [lo, hi] = range, h = history(name, 2), deload = isDeload();
  let kg, r = lo, why;
  if (!h.length) {
    kg = startKg(name); why = kg ? "Starting weight. Last 2 reps should feel hard." : "Find a weight where the last 2 reps are hard.";
  } else {
    const last = h[0].sets, lastKg = Math.max(...last.map((x) => +x.kg)), repsDone = last.map((x) => +x.reps);
    if (repsDone.every((x) => x >= hi)) { kg = lastKg + kgStep(name); why = `You hit ${hi} reps on every set last time, so ${stepText(name)}.`; }
    else if (repsDone.some((x) => x < lo)) {
      const prevLow = h[1]?.sets.some((x) => +x.reps < lo);
      kg = prevLow ? roundKg(lastKg * 0.9) : lastKg;
      why = prevLow ? "Below the range twice in a row, so about 10% lighter." : "Below the range last time, so repeat the same weight.";
    } else { kg = lastKg; r = Math.min(hi, Math.max(...repsDone) + 1); why = `Same weight, aim for ${r} reps on each set.`; }
  }
  if (kg && deload) { kg = roundKg(kg * 0.6); why = "Deload week: 60% of your usual weight."; }
  return { kg, reps: r, range: `${lo}${hi !== lo ? "–" + hi : ""}`, why };
}
const isTimed = (reps) => /min|s$|s\/|m$|\/ |—|tab/.test(reps);
const seg = (cur, key, items) => `<div class="seg" role="tablist">${items.map(([k, l]) =>
  `<button role="tab" aria-selected="${cur === k}" class="${cur === k ? "on" : ""}" data-${key}="${k}">${l}</button>`).join("")}</div>`;

// ---------- views ----------
const V = {};

V.today = () => {
  const pd = planDay(), ph = phase(new Date(pd)), w = WEEK[cyc(new Date(pd))], d = day(), t = foodTotals(d), T = dayTargets(pd);
  const done = d.checks.workout, rest = !T.gym, feel = d.feel || {};
  const soon = S.treatments.filter((x) => !x.done && x.date >= today() && (new Date(x.date) - new Date(today())) / DAY_MS <= 3);
  const notStarted = today() < START_DATE;
  const pct = Math.min(100, Math.round((dayNo() / totalDays()) * 100));
  const habits = [
    ["water", "💧", `${DAILY.waterL} L water`], ["steps", "👟", KNEE.rehab ? "Walk as comfortable (flat, up to 8k)" : `${(ph.steps / 1000).toFixed(0)}k steps`],
    ["creatine", "⚡", "Creatine 5 g"], ["skinAM", "☀️", "AM skin + SPF"],
    ["posture", "🧍", "Posture 5 min"], ["skinPM", "🌙", "PM skin"],
    ["sleep", "😴", `Sleep ${DAILY.sleepH} h`], ["nojunk", "🥗", "No junk"],
    ["sun", "🌅", "15 min sun"], ["seeds", "🎃", "15 g pumpkin seeds + walnuts"],
    ["knee", "🦵", "Knee exercises"], ["meds", "💊", "D3 with lunch, Cartigen as prescribed"],
    ["isabgol", "🌾", "1 tsp isabgol before dinner"],
  ];
  return `
  <section class="hero">
    <div class="hero-top"><span class="eyebrow">${notStarted ? `Day 1 starts tomorrow · ${fmt(START_DATE)}` : `Day ${dayNo()} of ${totalDays()}`}</span>
      <span class="pill">${esc(ph.name)}${isDeload() ? " · deload" : ""}</span></div>
    <h2 class="hero-title">${esc(w.title)}</h2>
    <p class="hero-sub">${rest ? "Recovery day. Walk, stretch and prep meals." : `${exList(cyc(new Date(pd))).length} exercises · ~45 min · gym ${GYM_TIME}–9:30`}</p>
    <div class="row">
      ${rest ? `<a class="btn ghost grow" href="#train" data-trainseg="run">See this week's walk/run</a>` : done
        ? `<span class="pill ok big">✓ Workout done</span><button class="btn ghost" data-go="train">View</button>`
        : T.skippedGym
        ? `<span class="pill grey big">Skipped · calories lowered</span><button class="btn ghost" data-check="${T.autoSkip ? "trainedLate" : "skipGym"}">${T.autoSkip ? "I did train" : "Undo"}</button>`
        : `<button class="btn grow" data-startworkout="${cyc(new Date(pd))}">Start workout</button><button class="btn ghost" data-check="skipGym">Skip today</button>`}
    </div>
    <div class="journey-bar"><i style="width:${pct}%"></i></div>
    <div class="journey-meta"><span>${fmt(START_DATE)}</span><span>${pct}% to abs reveal</span><span>${fmt(S.profile.targetDate)}</span></div>
  </section>

  ${soon.map((x) => `<div class="card notice"><b>🩺 ${esc(x.what)}</b>
    <div class="sub">${x.date === today() ? "Today" : fmt(x.date)}${x.notes ? " · " + esc(x.notes) : ""}</div></div>`).join("")}

  <div class="card"><div class="rings">
    <div>${ring(t.kcal, T.kcal, "url(#g1)", "kcal")}<div class="lbl">Calories</div></div>
    <div>${ring(t.p, T.protein, "var(--ok)", "g")}<div class="lbl">Protein</div></div>
    <div>${ring(workoutsThisWeek().filter(Boolean).length, program().days, "var(--blue)", "")}<div class="lbl">Workouts</div></div>
  </div>
  <p class="center sub">Target ${T.kcal} kcal today · ${T.reasons.join(" · ")}</p>
  <div class="center"><button class="btn ghost sm ${d.checks.skipWalk ? "on" : ""}" data-check="skipWalk">${d.checks.skipWalk ? "✓ Missed walk (−150 kcal)" : "Missed my walk?"}</button></div>
  </div>

  ${!S.weights.some((x) => x.date === today()) ? `<div class="card"><div class="spread"><div><b>Morning weigh-in</b><div class="sub">After the toilet, before food</div></div></div>
    <div class="row mt"><input class="grow" id="qWeigh" inputmode="decimal" placeholder="kg" aria-label="Weight in kg">
      <button class="btn" id="qWeighSave">Save</button></div></div>` : ""}

  <div class="section-title"><h3>Meals</h3><a href="#food" class="link">Food →</a></div>
  <div class="card list">${mealTicks(T, pd)}</div>

  <div class="section-title"><h3>Habits</h3><span class="sub">${habits.filter(([id]) => d.checks[id]).length}/${habits.length}</span></div>
  <div class="chips">${habits.map(([id, e, label]) =>
    `<button class="chip ${d.checks[id] ? "on" : ""}" data-check="${id}"><span class="e">${e}</span><span>${label}</span></button>`).join("")}</div>

  <div class="section-title"><h3>How do you feel?</h3></div>
  <div class="card">
    <div class="feel"><span class="sub">Energy</span>${[1, 2, 3, 4, 5].map((v) =>
      `<button class="${feel.energy === v ? "on" : ""}" data-feel="energy:${v}" aria-label="Energy ${v}">${["😩", "😕", "😐", "🙂", "🔥"][v - 1]}</button>`).join("")}</div>
    <div class="feel"><span class="sub">Mood</span>${[1, 2, 3, 4, 5].map((v) =>
      `<button class="${feel.mood === v ? "on" : ""}" data-feel="mood:${v}" aria-label="Mood ${v}">${["😞", "😔", "😐", "😊", "😄"][v - 1]}</button>`).join("")}</div>
    <div class="feel"><span class="sub">Bloated</span>${["No", "A bit", "Very"].map((l, v) =>
      `<button class="wide ${feel.bloat === v ? "on" : ""}" data-feel="bloat:${v}">${l}</button>`).join("")}</div>
    <p class="sub mt0">The weekly review uses this to find what makes you feel your best.</p>
  </div>`;
};

function mealTicks(T, d = today()) {
  const rows = MEALS.map((slot, i) => {
    if (slot.gymOnly && (!T.gym || T.skippedGym)) return "";
    const m = meal(i, d), on = !!S.days[d]?.food?.some((f) => f.plan === i);
    return `<div class="tick meal ${on ? "on" : ""}" data-meal="${i}" data-date="${d}" role="checkbox" aria-checked="${on}" tabindex="0"><span class="box"></span>
      <div class="t"><span class="time">${esc(slot.time)} · ${esc(slotLabel(slot, T.gym && !T.skippedGym))}</span><b>${esc(m.name)}</b>
        <ul class="ing">${m.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <details class="how"><summary>How to cook</summary><ol>${m.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></details></div>
      <span class="meta">${m.kcal} kcal<br>${m.p} g P<br>${m.fib} g fiber<br><button class="btn ghost xs" data-cyclemeal="${i}" data-date="${d}" aria-label="Swap meal">⇄</button></span></div>`;
  }).join("");
  return rows + (!T.gym || T.skippedGym ? `<p class="sub center">Lower-calorie day: 1 phulka or ¼ cup rice less at dinner.</p>` : "");
}

// ---------- train ----------
let trainSeg = "gym", trainDay = dayIdx(new Date(planDay()));
V.train = () => seg(trainSeg, "trainseg", [["gym", "Gym"], ["run", "Walk / Run"], ["skills", "Skills"]]) +
  (trainSeg === "run" ? trainRun() : trainSeg === "skills" ? trainSkills() : trainGym());

function trainGym() {
  const tdate = iso(dateOfCyc(trainDay)), early = tdate < START_DATE, si = cyc(tdate);
  const w = early ? { title: "Before Day 1", ex: [["Your plan starts on " + fmt(START_DATE), 1, "—", ""]] } : WEEK[si];
  const ex = early ? w.ex : exList(si), wk = workoutsThisWeek(), rest = w.ex.length <= 2, pr = program();
  return `
  <div class="card"><div class="spread"><div><span class="eyebrow">Your program</span><h2 class="h2">${esc(pr.name)}</h2></div>
    <span class="pill">${pr.days} days / week</span></div>
    <p class="sub">${esc(pr.by)}</p>
    ${pr.blocks ? (() => { const b = blockIndex(), next = new Date(START_DATE); next.setDate(next.getDate() + (b + 1) * 28);
      return `<p class="small">Block ${"AB"[b % pr.blocks.length]} (weeks ${b * 4 + 1}–${b * 4 + 4}). New exercises from ${fmt(iso(next))}.</p>`; })() : ""}
    <p class="small">Mon–Fri: gym (~45 min, 8:30–9:30) · Sat: flat walk · Sun: rest (gym closed)</p>
    <p class="sub">${KNEE.rehab ? `Knee-safe version while the ${KNEE.side.toLowerCase()} knee heals. The full version switches on in Settings once your ortho clears you.` : "Full version: your ortho cleared you."}</p>
  </div>
  <div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<button class="${i === trainDay ? "on" : ""} ${iso(dateOfCyc(i)) === planDay() ? "today" : ""} ${wk[i] ? "done" : ""}"
    data-trainday="${i}"><span>${dateOfCyc(i).toLocaleDateString("en-IN", { weekday: "short" })}</span><small>${dateOfCyc(i).getDate()} ${dateOfCyc(i).toLocaleDateString("en-IN", { month: "short" })}</small></button>`).join("")}</div>
  <div class="card">
    <span class="eyebrow">Day ${journeyDay(iso(dateOfCyc(trainDay)))} · ${esc(dayLabel(iso(dateOfCyc(trainDay))))}</span>
    <h2 class="h2">${esc(w.title)}</h2>
    ${isDeload() ? `<p class="note">Deload week: same exercises at ~60% of your usual weight.</p>` : ""}
    ${!rest ? `<p class="warn small">${esc(KNEE.warn)}</p>` : ""}
    ${ex.map(([name, sets, reps, note], i) => {
      const last = lastSets(name), start = START_WEIGHTS[name], skill = name.startsWith("Skill");
      return `<div class="ex"><span class="num">${i + 1}</span><div class="grow">
        <div class="name">${esc(name)}</div>
        <div class="sub">${sets > 1 ? sets + " × " : ""}${esc(reps)}${note ? " · " + esc(note) : ""}</div>
        ${(() => {
          const t = target(name, reps), h = history(name);
          if (!t) return "";
          return `<div class="kg">${t.kg ? `Today: ${wt(t.kg)} × ${t.reps}` : `Today: × ${t.reps}`} · rest ${fmtRest(restSec(name))}</div>
            <div class="sub why">${esc(t.why)}${!h.length && start ? ` (${esc(wtText(start))})` : ""}</div>
            ${h.length ? `<div class="hist">${h.map((x) => `<span>${esc(fmt(x.date))}: ${x.sets.map((y) => `${toDisp(y.kg)}×${esc(y.reps)}`).join(", ")}</span>`).join("")}</div>` : ""}`;
        })()}
        ${stepList(name, iso(dateOfCyc(trainDay)))}
        ${!rest && !stepList(name, today()) ? `<div class="row xs-gap">${vid(skill ? SKILLS[skillIndex()].drills[0] : cleanName(name) + " proper form")}
          ${skill ? "" : `<button class="btn ghost xs" data-swap="${esc(name)}">Swap</button>`}</div><pre class="ai"></pre>` : ""}
      </div></div>`;
    }).join("")}
    ${!rest ? `<button class="btn block mt" data-startworkout="${si}">Start guided workout</button>` : ""}
    ${new Date(tdate).getDay() === 0 ? `<p class="sub">Sunday: gym closed. Rest, walk, meal prep and grocery order.</p>` : ""}
  </div>
  ${kneeCard(early ? planDay() : tdate)}
  ${KNEE.rehab ? `<div class="card notice"><h3 class="h3" style="margin:0 0 6px">🚩 Stop and call your ortho if</h3>
    <ul class="bullets">${KNEE.redFlags.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <p class="sub">Get down to the floor and back up using a bench, never by kneeling on the right knee.</p></div>` : ""}
  <div class="card"><h3 class="h3">How to progress</h3>
    <p class="sub">Weeks 1–2: use the starting weights and learn the form. After that, when every set reaches the top of the rep range,
    add 5 lb (2.5 kg) on big lifts or 2.5 lb on small cable moves. The app shows your last numbers so you always know what to beat.</p></div>`;
}

// Physio's daily knee exercises: a checklist for the given date, shown every day.
function kneeCard(d) {
  const c = S.days[d]?.checks || {}, done = KNEE_EXERCISES.filter((_, i) => c["kx" + i]).length;
  return `<div class="card"><div class="spread"><h3 class="h3" style="margin:0">🦵 Knee exercises · every day</h3><span class="sub">${done}/${KNEE_EXERCISES.length}</span></div>
    <p class="sub">From your physio for the ${KNEE.side.toLowerCase()} knee. Slow and controlled; stop if it hurts.</p>
    ${KNEE_EXERCISES.map(([n, r, q], i) => `<div class="tick ${c["kx" + i] ? "on" : ""}" data-check="kx${i}" data-date="${d}" role="checkbox" aria-checked="${!!c["kx" + i]}" tabindex="0">
      <span class="box"></span><div class="t"><b>${esc(n)}</b><span class="sub">${esc(r)}</span></div><span class="meta">${vid(q, "Video")}</span></div>`).join("")}</div>`;
}

function trainRun() {
  const st = runStage(), runs = S.runs.slice().reverse();
  return `
  <div class="card hero-lite"><span class="eyebrow">Week ${weekNo()} · ${esc(st.name)}</span>
    <h2 class="h2">${esc(st.session)}</h2>
    <p class="sub">${KNEE.rehab ? `Running is paused for the ${KNEE.side.toLowerCase()}-knee ACL sprain. Walk on flat ground only (no stairs or slopes) until the ortho clears you (follow-up ${fmt(KNEE.followUp)}).`
      : `Move to the next stage only if the ${KNEE.side.toLowerCase()} knee feels fine the day after. Pain above 3/10 means go back a stage. Run on a treadmill or track, not the road.`}</p></div>
  <div class="card"><h3 class="h3">Log a walk or run</h3>
    <div class="grid3"><label class="field">km<input id="rKm" inputmode="decimal" placeholder="3.0"></label>
      <label class="field">minutes<input id="rMin" inputmode="numeric" placeholder="30"></label>
      <label class="field">knee pain 0–10<input id="rPain" inputmode="numeric" placeholder="0"></label></div>
    <button class="btn block mt" id="rSave">Save</button></div>
  <div class="card list">${runs.slice(0, 12).map((r) => `<div class="tick static"><div class="t"><b>${esc(fmt(r.date))} · ${r.km} km</b>
    <span class="sub">${r.min} min · ${r.km && r.min ? (r.min / r.km).toFixed(1) + " min/km" : ""} · knee ${r.pain}/10</span></div>
    ${r.pain > 3 ? `<span class="pill warn">Ease off</span>` : ""}</div>`).join("") || `<div class="empty">No walks or runs logged yet.</div>`}</div>
  <div class="card"><h3 class="h3">The path to 5K</h3>
    ${RUN_PLAN.map((r) => `<div class="step ${r === st ? "now" : weekNo() > r.weeks[1] ? "past" : ""}"><span class="dot"></span>
      <div><b>Weeks ${r.weeks[0]}–${r.weeks[1] > 90 ? "on" : r.weeks[1]} · ${esc(r.name)}</b><div class="sub">${esc(r.session)}</div></div></div>`).join("")}</div>`;
}

function trainSkills() {
  const cur = skillIndex();
  if (KNEE.rehab) return `<div class="card hero-lite"><span class="eyebrow">Skills paused during knee rehab</span>
    <h2 class="h2">${esc(REHAB_SKILL.name)}</h2>
    <p class="sub">Pull-up bar and dip skills come back once your ortho clears you: getting up to the bar and dropping down is a jump-landing risk for the knee.</p>
    <ul class="drills">${REHAB_SKILL.drills.map((x) => `<li><span>${esc(x)}</span>${vid(x.replace(/\d.*$/, "") + " tutorial", "Video")}</li>`).join("")}</ul>
    <p class="sub">Practised at the end of Mon, Wed and Fri sessions.</p></div>`;
  return `
  <div class="card hero-lite"><span class="eyebrow">Month ${cur + 1} skill</span>
    <h2 class="h2">${esc(SKILLS[cur].name)}</h2>
    <p class="sub">Test: ${esc(SKILLS[cur].test)}</p>
    <ul class="drills">${SKILLS[cur].drills.map((x) => `<li><span>${esc(x)}</span>${vid(x.replace(/\d.*$/, "") + " tutorial", "Video")}</li>`).join("")}</ul>
    <p class="sub">Practise at the end of Mon, Wed and Fri sessions (it's added to those workouts).</p>
    ${S.skills[cur] ? `<span class="pill ok big">Unlocked ${esc(fmt(S.skills[cur]))}</span>` : `<button class="btn block" data-unlock="${cur}">I passed the test — unlock</button>`}
  </div>
  <div class="badges">${SKILLS.map((s, i) => {
    const from = new Date(START); from.setDate(from.getDate() + i * 30);
    const state = S.skills[i] ? "won" : i === cur ? "now" : i < cur ? "missed" : "locked";
    return `<div class="badge ${state}"><span class="medal">${S.skills[i] ? "🏅" : i === cur ? "🎯" : i < cur ? "↺" : "🔒"}</span>
      <b>${esc(s.name)}</b><span class="sub">From ${esc(fmt(iso(from)))}</span>
      ${state === "missed" ? `<button class="btn ghost xs" data-unlock="${i}">Mark passed</button>` : ""}</div>`;
  }).join("")}</div>`;
}

// ---------- guided workout overlay ----------
let WM = null, restTimer = null;
function openWorkout(di) { WM = { di, i: 0, restEnd: 0 }; renderWM(); }
function closeWorkout() { WM = null; clearInterval(restTimer); $("#overlay").innerHTML = ""; document.body.style.overflow = ""; render(); }
function renderWM() {
  if (!WM) return;
  document.body.style.overflow = "hidden";
  const list = exList(WM.di), [name, sets, reps, note] = list[WM.i], d = day();
  const timed = isTimed(String(reps)), n = timed ? 1 : sets;
  const logged = (d.sets[name] = Array.isArray(d.sets[name]) ? d.sets[name] : []);
  const last = lastSets(name), tg = target(name, reps);
  const pct = ((WM.i + 1) / list.length) * 100, isLast = WM.i === list.length - 1;
  $("#overlay").innerHTML = `<div class="overlay"><div class="inner">
    <div class="wm-top"><button class="iconbtn" id="wmClose" aria-label="Close workout">✕</button>
      <div class="journey-bar grow"><i style="width:${pct}%"></i></div><span class="sub">${WM.i + 1}/${list.length}</span></div>
    <span class="eyebrow">${esc(WEEK[WM.di].title)}</span>
    <div class="wm-name">${esc(name)}</div>
    <div class="sub">${sets > 1 ? sets + " sets × " : ""}${esc(reps)}${note ? " · " + esc(note) : ""}</div>
    ${stepList(name, today()) ? "" : `<div class="row xs-gap mt">${vid(cleanName(name) + " proper form", "Watch the form")}</div>`}
    ${tg ? `<div class="note"><b>Today: ${tg.kg ? `${wt(tg.kg)} × ${tg.reps}` : `${tg.reps} reps`}</b> · ${sets} sets · rest ${fmtRest(restSec(name))}<br><span class="sub">${esc(tg.why)}</span>
      ${last ? `<br><span class="sub">Last time: ${last.sets.filter((x) => x?.kg).map((x) => `${toDisp(x.kg)} × ${esc(x.reps)}`).join(" · ")} ${U()}</span>` : ""}</div>` : ""}
    <div class="timer" id="restBox" ${WM.restEnd > Date.now() ? "" : "hidden"}><span class="sub">Rest</span><b id="restT">0:00</b>
      <button class="btn ghost sm" id="restSkip">Skip rest</button></div>
    ${stepList(name, today()) || (timed ? "" : `<div class="sethead"><span>Set</span><span>${U()}</span><span>Reps</span><span></span></div>`) + Array.from({ length: n }, (_, s) => {
      const x = logged[s] || {}, prev = last?.sets[s] || {};
      return timed
        ? `<div class="setrow timed"><span>Done: ${esc(reps)}</span><button class="ok ${x.done ? "on" : ""}" data-setdone="${s}" aria-label="Done">✓</button></div>`
        : `<div class="setrow"><span class="sn">${s + 1}</span>
          <input inputmode="decimal" placeholder="${esc(toDisp(tg?.kg ?? prev.kg) || U())}" data-setf="kg" data-s="${s}" value="${esc(toDisp(x.kg))}" aria-label="Set ${s + 1} ${U()}">
          <input inputmode="numeric" placeholder="${esc(tg?.reps ?? prev.reps ?? "")}" data-setf="reps" data-s="${s}" value="${esc(x.reps || "")}" aria-label="Set ${s + 1} reps">
          <button class="ok ${x.done ? "on" : ""}" data-setdone="${s}" aria-label="Set ${s + 1} done">✓</button></div>`;
    }).join("")}
    ${name.startsWith("Skill") || stepList(name, today()) ? "" : `<button class="btn ghost sm mt" data-swap="${esc(name)}">Knee hurts? Swap with AI</button><pre class="ai"></pre>`}
  </div>
  <div class="wm-foot">
    <button class="btn ghost" id="wmPrev" ${WM.i === 0 ? "disabled" : ""}>Back</button>
    <button class="btn" id="wmNext">${isLast ? "Finish workout" : "Next exercise"}</button>
  </div></div>`;
  tickRest();
}
function tickRest() {
  clearInterval(restTimer);
  const upd = () => {
    const box = $("#restBox"), left = Math.max(0, Math.ceil((WM?.restEnd - Date.now()) / 1000));
    if (!box) return clearInterval(restTimer);
    box.hidden = left <= 0;
    $("#restT").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    if (left <= 0) { clearInterval(restTimer); if (WM?.restEnd) { WM.restEnd = 0; navigator.vibrate?.([200, 100, 200]); } }
  };
  upd(); restTimer = setInterval(upd, 500);
}

// ---------- food ----------
let foodSeg = "today", planOffset = 0;
V.food = () => {
  const s = seg(foodSeg, "foodseg", [["today", "Today"], ["plan", "7-day plan"], ["shop", "Shopping"]]);
  return s + (foodSeg === "plan" ? foodPlan() : foodSeg === "shop" ? foodShop() : foodToday());
};
let foodDate = null;
function cookText(k) {
  const T = dayTargets(k);
  return `Menu for ${dayLabel(k)}${/day$/.test(dayLabel(k)) ? ` (${fmt(k)})` : ""} · Day ${journeyDay(k)}\n` + MEALS.map((slot, i) => {
    if (slot.gymOnly && (!T.gym || T.skippedGym)) return "";
    const m = meal(i, k);
    return `\n*${slot.time} ${slotLabel(slot, T.gym && !T.skippedGym)}: ${m.name}*\nTake:\n` + m.items.map((x) => `- ${x}`).join("\n") +
      "\nMethod:\n" + m.steps.map((x, j) => `${j + 1}. ${x}`).join("\n");
  }).join("\n") + "\n\nKitchen rules:\n" + COOK_RULES.map((x) => `- ${x}`).join("\n") + "\n- Never use tofu, rajma, chole or kabuli chana.";
}
function foodToday() {
  const fd = foodDate || planDay(), d = day(fd), t = foodTotals(d), T = dayTargets(fd), min = today();
  const pager = `<div class="card pager"><button class="iconbtn" data-fooddate="${addDays(fd, -1)}" ${fd <= min ? "disabled" : ""} aria-label="Previous day">‹</button>
    <div class="center grow"><b>${esc(dayLabel(fd))}</b><div class="sub">${fmt(fd)}${journeyDay(fd) >= 1 ? ` · Day ${journeyDay(fd)}` : ""} · ${T.gym ? "Gym day" : "Rest day"} · ${T.kcal} kcal</div></div>
    <button class="iconbtn" data-fooddate="${addDays(fd, 1)}" aria-label="Next day">›</button></div>
    <details class="card rules"><summary>Kitchen rules for the cook</summary><ul class="bullets">${COOK_RULES.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
    ${onSite() ? `<p class="sub center">${S.settings.syncKey ? `Kitchen sync on ✓${S.settings.lastSync ? ` · last sent ${new Date(S.settings.lastSync).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : ""}`
      : `<b class="warn">Kitchen sync off:</b> add your sync key in Settings so swaps reach the kitchen page`}</p>` : ""}
    <button class="btn ghost block sm" id="copyCook" data-date="${fd}">📋 Copy ${esc(dayLabel(fd).toLowerCase())}'s menu for the cook</button>`;
  return pager + `
  <div class="card"><div class="rings four">
    <div>${ring(t.kcal, T.kcal, "url(#g1)", "")}<div class="lbl">kcal</div></div>
    <div>${ring(t.p, T.protein, "var(--ok)", "")}<div class="lbl">Protein g</div></div>
    <div>${ring(t.fib, FIBER_TARGET, "var(--blue)", "")}<div class="lbl">Fiber g</div></div>
    <div>${ring(t.c, T.carbs, "var(--warn)", "")}<div class="lbl">Carbs g</div></div>
  </div><p class="center sub">Fat ${Math.round(t.f)} / ${T.fat} g · ${T.reasons.join(" · ")}</p></div>
  <div class="section-title"><h3>${esc(dayLabel(fd))}'s meals</h3><span class="sub">Tick when eaten · ⇄ to swap</span></div>
  <div class="card list">${mealTicks(T, fd)}</div>
  <div class="card"><h3 class="h3">Ate something else?</h3>
    <textarea id="foodText" placeholder="e.g. 1 vada pav and a cutting chai at the office"></textarea>
    <div class="row mt">
      <label class="btn ghost" for="foodPhoto">📷 Photo</label><input type="file" id="foodPhoto" accept="image/*" hidden>
      <button class="btn grow" id="foodLog">Analyse with AI</button></div>
    <div id="foodMsg" class="sub"></div>
    ${d.food.filter((f) => f.plan == null).map((f) => `<div class="tick static"><div class="t"><b>${esc(f.name)}</b>
      <span class="sub">${Math.round(f.kcal)} kcal · P ${Math.round(f.p)} · C ${Math.round(f.c || 0)} · F ${Math.round(f.f || 0)}</span></div>
      <button class="btn ghost xs" data-delfood="${d.food.indexOf(f)}" aria-label="Remove">✕</button></div>`).join("")}
  </div>
  <div class="card"><h3 class="h3">Ask the coach</h3>
    <textarea id="askText" placeholder="e.g. I'm at a wedding tonight. What should I eat?"></textarea>
    <button class="btn block mt" id="askBtn">Ask</button><pre class="ai" id="askOut"></pre></div>`;
}
function foodPlan() {
  const dates = Array.from({ length: 7 }, (_, k) => addDays(planDay(), k));
  const pd = dates[planOffset], T = dayTargets(pd), gym = isGymDay(new Date(pd));
  const total = MEALS.reduce((a, slot, i) => slot.gymOnly && !gym ? a : { k: a.k + meal(i, pd).kcal, p: a.p + meal(i, pd).p, f: a.f + meal(i, pd).fib }, { k: 0, p: 0, f: 0 });
  return `
  <div class="week">${dates.map((k, i) => `<button class="${i === planOffset ? "on" : ""} ${k === today() ? "today" : ""}" data-planday="${i}">
    ${new Date(k).toLocaleDateString("en-IN", { weekday: "short" })}</button>`).join("")}</div>
  <div class="card"><div class="spread"><h2 class="h2">${esc(dayLabel(pd))}</h2>
    <span class="pill ${gym ? "" : "grey"}">${gym ? "Gym day" : "Rest day"}</span></div>
    <div class="stats"><div><b>${T.kcal}</b><span>kcal target</span></div><div><b>${total.k}</b><span>kcal planned</span></div>
      <div><b>${T.protein} g</b><span>protein target</span></div><div><b>${total.p} g</b><span>protein planned</span></div>
      <div><b>${FIBER_TARGET} g</b><span>fiber target</span></div><div><b>${total.f} g</b><span>fiber planned</span></div></div>
    <p class="note">${esc(phase(new Date(pd)).food)}</p></div>
  <p class="sub"><b>Menu week ${menuWeek(pd)} of 4: ${esc(MENU_THEMES[menuWeek(pd)])}.</b> New dishes every week, same calories and protein. Tap another option to swap it for this day. No tofu, rajma or chole. Brands are suggestions; any equivalent works.</p>
  ${MEALS.map((slot, i) => slot.gymOnly && !gym ? "" : `<div class="card list"><span class="eyebrow">${esc(slot.time)} · ${esc(slot.label)}</span>
    ${mealOptions(i, pd).map((m, j) => { const on = mealPickIdx(i, pd) === j;
      return `<div class="tick ${on ? "on" : ""}" data-pickmeal="${i}:${j}:${pd}" role="radio" aria-checked="${on}" tabindex="0"><span class="box round"></span>
        <div class="t"><b>${esc(m.name)}</b>${on ? `<ul class="ing">${m.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <details class="how"><summary>How to cook</summary><ol>${m.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></details>` : ""}</div>
        <span class="meta">${m.kcal} kcal<br>${m.p} g P<br>${m.fib} g fiber</span></div>`; }).join("")}</div>`).join("")}
  <div class="card"><h3 class="h3">Need new ideas?</h3><button class="btn ghost block" data-ask="Give me 3 new high-protein vegetarian recipes using high-protein paneer or soya for my current phase, with exact grams and macros, under ₹120 each. Nothing that bloats.">✨ 3 new paneer / soya recipes</button></div>`;
}
let shopWeek = null;
// What to buy in a given journey week: whole packs every week; fractions every few weeks.
function weekOrder(w) {
  const items = groceryFor(((w - 1) % 4) + 1).map((g) => ({ ...g, buy: g.qty >= 1 ? Math.round(g.qty) : Math.floor(w * g.qty + 1e-9) > Math.floor((w - 1) * g.qty + 1e-9) ? 1 : 0 }))
    .filter((g) => g.buy > 0);
  if ((w - 1) % 4 === 0) MONTHLY_EXTRAS.forEach((g) => items.push({ ...g, buy: 1, group: "Monthly" }));
  return items;
}
const instamart = (q) => `https://www.swiggy.com/instamart/search?custom_back=true&query=${encodeURIComponent(q)}`;
function foodShop() {
  const price = (g) => S.prices[g.item] ?? g.price;
  // Average over the 4 menu weeks (each week's dishes need slightly different shopping).
  const weekly = [1, 2, 3, 4].reduce((s, mw) => s + groceryFor(mw).reduce((a, g) => a + g.qty * price(g), 0), 0) / 4, extras = MONTHLY_EXTRAS.reduce((s, g) => s + price(g), 0);
  const monthly = weekly * 4.33 + extras, over = monthly > S.profile.budget;
  const all = [...GROCERY, ...[2, 3, 4].flatMap((mw) => WEEK_GROCERY[mw].add)], groups = [...new Set(all.map((g) => g.group))];
  const row = (g, qty = true) => `<div class="shop"><div class="grow"><b>${esc(g.item)}</b>
      <div class="sub">${qty ? `${g.qty < 1 ? `every ${Math.round(1 / g.qty)} weeks` : `× ${g.qty} / week`} · ` : ""}${shopLinks(g)}</div></div>
      <label class="price"><span>₹</span><input inputmode="numeric" data-price="${esc(g.item)}" value="${price(g)}" aria-label="Price of ${esc(g.item)}"></label></div>`;
  const w = shopWeek ?? weekNo(), order = weekOrder(w), bought = S.weekly[`shop${w}`] || {};
  const ws = new Date(START); ws.setDate(ws.getDate() + (w - 1) * 7); const we = new Date(ws); we.setDate(we.getDate() + 6);
  const cost = order.reduce((a, g) => a + g.buy * price(g), 0);
  const links = (g) => `<span class="shoplinks">${g.link ? `<a href="${g.link}" target="_blank" rel="noopener">Zepto ★</a>` :
    `<a href="${zepto(g.q)}" target="_blank" rel="noopener">Zepto</a>`}<a href="${blinkit(g.q)}" target="_blank" rel="noopener">Blinkit</a><a href="${instamart(g.q)}" target="_blank" rel="noopener">Instamart</a></span>`;
  return `
  <div class="card hero-lite"><div class="spread"><button class="iconbtn" data-shopweek="${w - 1}" ${w <= 1 ? "disabled" : ""} aria-label="Previous week">‹</button>
    <div class="center"><span class="eyebrow">Week ${w} order</span><div class="sub">${fmt(iso(ws))} – ${fmt(iso(we))}</div></div>
    <button class="iconbtn" data-shopweek="${w + 1}" aria-label="Next week">›</button></div>
    <div class="spread mt"><h2 class="big-num">${inr(cost)}</h2><span class="sub">${Object.values(bought).filter(Boolean).length}/${order.length} bought</span></div>
    <p class="sub">Order on Sunday for the week. ★ = the exact product you use. Compare the three apps' prices; they change daily.</p>
    <button class="btn ghost sm" id="copyWeek">Copy this week's list</button></div>
  <div class="card list">${order.map((g) => `<div class="tick ${bought[g.item] ? "on" : ""}" data-bought="${esc(g.item)}" data-week="${w}" role="checkbox" tabindex="0">
    <span class="box"></span><div class="t"><b>${g.buy > 1 ? g.buy + " × " : ""}${esc(g.item)}</b>${links(g)}</div>
    <span class="meta">${inr(g.buy * price(g))}</span></div>`).join("")}</div>

  <div class="section-title"><h3>Prices and budget</h3></div>
  <div class="card hero-lite"><span class="eyebrow">Monthly spend · gym already paid</span>
    <div class="spread"><h2 class="big-num">${inr(monthly)}</h2><span class="pill ${over ? "warn" : "ok"}">${over ? "Over" : "Within"} ${inr(S.profile.budget)}</span></div>
    <div class="journey-bar"><i style="width:${Math.min(100, (monthly / S.profile.budget) * 100)}%"></i></div>
    <p class="sub">Groceries ${inr(weekly)} / week · supplements and skin ${inr(extras)} / month. Dermat fees are extra.</p>
    </div>
  ${groups.map((gr) => `<div class="section-title"><h3>${esc(gr)}</h3></div><div class="card list">${all.filter((g) => g.group === gr).map((g) => row(g)).join("")}</div>`).join("")}
  <div class="section-title"><h3>Monthly buys</h3></div><div class="card list">${MONTHLY_EXTRAS.map((g) => row(g, false)).join("")}</div>
  <div class="section-title"><h3>One-time looks kit</h3><span class="sub">Not in the monthly budget</span></div>
  <div class="card list">${LOOKS_KIT.map((g) => row(g, false)).join("")}
    <p class="sub">Wait for the dermat before buying skin products; they may prescribe something different.</p></div>
  <p class="sub center">Prices are estimates. Edit them to match the app and the budget updates.</p>`;
}

// Progressive overload proof: first vs latest top weight for each lift.
function strengthGains() {
  const first = {}, last = {};
  for (const k of Object.keys(S.days).sort()) for (const [name, sets] of Object.entries(S.days[k].sets || {})) {
    const top = Math.max(0, ...(Array.isArray(sets) ? sets : []).filter((x) => x && +x.kg && +x.reps).map((x) => +x.kg));
    if (!top) continue;
    first[name] ??= { kg: top, date: k }; last[name] = { kg: top, date: k };
  }
  return Object.keys(first).map((n) => ({ name: n, from: first[n].kg, to: last[n].kg, pct: Math.round(((last[n].kg - first[n].kg) / first[n].kg) * 100) }))
    .sort((a, b) => b.pct - a.pct);
}
// Planned gym sessions done in the last 28 days (Sundays excluded; a skip counts as missed).
function consistency() {
  let planned = 0, done = 0;
  for (let i = 0; i < 28; i++) {
    const d = new Date(); d.setDate(d.getDate() - i); const k = iso(d);
    if (k < START_DATE || k > today() || d.getDay() === 0) continue;
    const c = S.days[k]?.checks || {};
    if (!isGymDay(d) && !c.skipGym) continue;
    if (k === today() && !c.workout) continue; // today isn't over yet
    planned++; if (c.workout) done++;
  }
  return planned ? { pct: Math.round((done / planned) * 100), done, planned } : null;
}

// ---------- journey (progress) ----------
V.journey = () => {
  const pi = phaseIndex(), w = latestWeight(), exp = expectedKg(new Date()), diff = w - exp, p = S.profile, L = latest();
  const ratio = L.shoulder && L.waist ? (L.shoulder / L.waist).toFixed(2) : null;
  const status = !S.weights.length ? ["grey", "Log your first weigh-in"] : diff <= 0.3 ? ["ok", "On track"] : diff <= 1.5 ? ["warn", "Slightly behind"] : ["warn", "Behind"];
  return `
  <section class="hero">
    <div class="hero-top"><span class="eyebrow">Now</span><span class="pill ${status[0]}">${status[1]}</span></div>
    <div class="spread"><div><div class="big-num">${w}<small> kg</small></div><div class="sub">Plan says ${exp.toFixed(1)} kg today</div></div>
      <div class="right"><div class="big-num ok-text">${(w - p.startWeight).toFixed(1)}<small> kg</small></div><div class="sub">since day 1</div></div></div>
    <div class="grid3 mt"><label class="field">Weight kg<input id="wKg" inputmode="decimal" placeholder="${w}"></label>
      <label class="field">Waist cm<input id="wWaist" inputmode="decimal" placeholder="at navel"></label>
      <label class="field">Shoulders cm<input id="wSh" inputmode="decimal" placeholder="widest"></label></div>
    <button class="btn block mt" id="wSave">Save today's numbers</button>
  </section>
  ${(() => {
    const c = consistency(), g = strengthGains();
    return `<div class="card"><div class="spread"><h3 class="h3" style="margin:0">Consistency · last 4 weeks</h3>
      <span class="pill ${!c ? "grey" : c.pct >= 85 ? "ok" : "warn"}">${c ? c.pct + "%" : "—"}</span></div>
      <p class="sub">${!c ? "Your first workout starts the count." : `${c.done} of ${c.planned} gym sessions done. ${c.pct >= 85 ? "This is the pace that gets results." : "Aim for 85%+: a missed day just moves to tomorrow, so get the next one in."}`}</p>
      <h3 class="h3 mt">Strength gains (progressive overload)</h3>
      ${g.length ? g.slice(0, 8).map((x) => `<div class="tick static"><div class="t"><b>${esc(x.name)}</b>
        <span class="sub">${wt(x.from)} → ${wt(x.to)}</span></div><span class="meta ${x.pct > 0 ? "ok-text" : ""}">${x.pct > 0 ? "+" : ""}${x.pct}%</span></div>`).join("")
        : `<p class="sub">Log your sets in the guided workout and your lifts will show here as they go up.</p>`}</div>`;
  })()}
  <div class="grid2">
    <div class="card stat"><span class="eyebrow">V-taper ratio</span><b>${ratio ?? "—"}</b><span class="sub">Shoulders ÷ waist. Goal 1.45+</span></div>
    <div class="card stat"><span class="eyebrow">Waist</span><b>${L.waist ? L.waist + " cm" : "—"}</b><span class="sub">Abs show around 80–84 cm</span></div>
  </div>
  <div class="card chart"><h3 class="h3">Weight vs plan</h3>${chart()}
    <div class="legend"><span><i class="you"></i>You</span><span><i class="plan"></i>Plan</span></div></div>

  <div class="section-title"><h3>Roadmap</h3><span class="sub">Week ${weekNo()}</span></div>
  <div class="card">${PHASES.map((ph, i) => `<div class="step ${i < pi ? "past" : i === pi ? "now" : ""}"><span class="dot"></span><div class="grow">
      <div class="spread"><b>${esc(ph.name)}</b><span class="sub">${fmt(ph.start)} – ${fmt(ph.end)}</span></div>
      <div class="sub">${ph.fromKg} → ${ph.toKg} kg · ${ph.kcal} kcal · ${ph.protein} g protein</div>
      ${i === pi ? `<p class="small">${esc(ph.focus)}</p>` : ""}</div></div>`).join("")}</div>

  <div class="card"><h3 class="h3">What to expect</h3>
    <p class="small">By <b>${fmt(p.targetDate)} 2027</b>: about <b>79 kg and 12–14% body fat</b>. That's when the upper 2 abs show, then 4 as you lean out further.
    Wider shoulders and lats, a flatter, squarer chest and a visible jawline come with it. Lower abs and full definition take longer and depend on genetics.
    The V-taper build phase after that adds width while you stay lean.</p></div>

  <div class="card"><h3 class="h3">Testosterone, naturally</h3>
    <p class="sub">No booster pills or steroids. These are what actually raise it, and most are already in your plan.</p>
    <ul class="bullets">${TESTOSTERONE.map(([h, t]) => `<li><b>${esc(h)}.</b> ${esc(t)}</li>`).join("")}</ul>
  </div>

  <div class="card"><h3 class="h3">Your health plan</h3>
    <p class="sub">From your ${esc(BLOOD.date)} blood report and the ortho visit. Follow your doctors first.</p>
    <ul class="bullets">${HEALTH.map(([h, t]) => `<li><b>${esc(h)}.</b> ${esc(t)}</li>`).join("")}</ul>
    <div class="list mt">${wtick("retest", "Retest blood in mid-January 2027", BLOOD_TEST, "once")}</div></div>

  <div class="card"><h3 class="h3">Weekly review</h3>
    <p class="sub">Reads your last 14 days of weight, food, workouts and how you felt. Works without a key; adds AI tips when available.</p>
    <button class="btn ghost block" id="reviewBtn">✨ Review my last 2 weeks</button><pre class="ai" id="reviewOut"></pre></div>

  <div class="card"><h3 class="h3">Coaches we follow</h3><p class="sub">Their public advice shapes the plan. These aren't their official programs.</p>
    ${COACHES.map((c) => `<div class="tick static"><div class="t"><b>${esc(c.name)}</b><span class="sub">${esc(c.note)}</span></div><span class="meta">${esc(c.area)}</span></div>`).join("")}</div>

  <div class="card list"><h3 class="h3">History</h3>${S.weights.slice().reverse().slice(0, 14).map((x) => `<div class="tick static"><div class="t"><b>${fmt(x.date)}</b></div>
    <span class="meta">${x.kg} kg${x.waist ? ` · ${x.waist} cm waist` : ""}${x.shoulder ? ` · ${x.shoulder} cm shoulders` : ""}</span></div>`).join("") || `<div class="empty">No weigh-ins yet.</div>`}</div>`;
};
function chart() {
  const W = 320, H = 180, end = new Date(S.profile.targetDate);
  const t0 = +START, t1 = Math.max(+end, ...S.weights.map((x) => +new Date(x.date)));
  const ys = [...S.weights.map((x) => x.kg), PHASES[0].fromKg, expectedKg(end)];
  const lo = Math.floor(Math.min(...ys) - 1), hi = Math.ceil(Math.max(...ys) + 1);
  const X = (t) => 30 + ((t - t0) / (t1 - t0)) * (W - 40), Y = (kg) => 10 + ((hi - kg) / (hi - lo)) * (H - 32);
  const plan = []; for (let t = t0; t <= t1; t += 7 * DAY_MS) plan.push(`${X(t).toFixed(1)},${Y(expectedKg(new Date(t))).toFixed(1)}`);
  const you = S.weights.map((x) => [X(+new Date(x.date)), Y(x.kg)]);
  const grid = [hi, Math.round((hi + lo) / 2), lo].map((v) => `<line x1="30" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>
    <text x="0" y="${Y(v) + 4}" fill="var(--muted)" font-size="10">${v}</text>`).join("");
  const nowX = Math.min(W - 10, X(Date.now()));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight compared with plan">${grid}
    <line x1="${nowX}" x2="${nowX}" y1="6" y2="${H - 22}" stroke="var(--accent)" stroke-dasharray="2 3" opacity=".6"/>
    <polyline fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 4" points="${plan.join(" ")}"/>
    ${you.length > 1 ? `<polyline fill="none" stroke="url(#g1)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${you.map((p) => p.join(",")).join(" ")}"/>` : ""}
    ${you.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === you.length - 1 ? 4.5 : 2.5}" fill="var(--accent)"/>`).join("")}
    <text x="30" y="${H - 4}" fill="var(--muted)" font-size="10">${fmt(START_DATE)}</text>
    <text x="${W - 10}" y="${H - 4}" fill="var(--muted)" font-size="10" text-anchor="end">${fmt(iso(new Date(t1)))}</text></svg>`;
}

// ---------- looks ----------
let looksSeg = "routine";
V.looks = () => seg(looksSeg, "looksseg", [["routine", "Routine"], ["sharp", "Sharp look"], ["derm", "Dermat"]]) +
  (looksSeg === "sharp" ? looksSharp() : looksSeg === "derm" ? looksDerm() : looksRoutine());
function looksRoutine() {
  const dermLines = (S.profile.derm || "").split("\n").map((x) => x.trim()).filter(Boolean);
  return `
  <div class="section-title"><h3>Every morning</h3><span class="sub">5 min</span></div>
  <div class="card list">${(dermLines.length ? dermLines.filter((x) => !/^pm/i.test(x)) : GROOMING.am).map((x, i) => tick(`am${i}`, esc(x))).join("")}</div>
  <div class="section-title"><h3>Posture · daily</h3><span class="sub">5 min, any time</span></div>
  <div class="card list">${GROOMING.posture.map(([n, r, q], i) => `<div class="tick ${day().checks["pos" + i] ? "on" : ""}" data-check="pos${i}" role="checkbox" tabindex="0">
    <span class="box"></span><div class="t"><b>${esc(n)}</b><span class="sub">${esc(r)}</span></div><span class="meta">${vid(q, "Video")}</span></div>`).join("")}</div>
  <div class="section-title"><h3>Every night</h3><span class="sub">3 min</span></div>
  <div class="card list">${(dermLines.length ? dermLines.filter((x) => /^pm/i.test(x)) : GROOMING.pm).map((x, i) => tick(`pm${i}`, esc(x))).join("") || `<div class="empty">Nothing at night in your dermat routine.</div>`}</div>
  <div class="section-title"><h3>This week</h3><span class="sub">Resets every week</span></div>
  <div class="card list">${GROOMING.weekly.map(([n, s], i) => wtick(`wk${i}`, n, s)).join("")}
    ${wtick("hair", "Haircut (every 3–4 weeks)", "Show the barber the note in Sharp look")}</div>
  ${dermLines.length ? `<p class="sub center">Using your dermatologist's routine. Lines starting with “PM” go to the night list.</p>` : ""}`;
}
function looksSharp() {
  const plain = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  return `
  <div class="card hero-lite"><span class="eyebrow">Your to-do</span><h2 class="h2">What you need to do</h2>
    <div class="list">
      ${wtick("todoDerm", "Book the dermatologist", "Add the date in the Dermat tab so it shows on Today", "once")}
      ${wtick("todoBarber", "Barber visit with the note below", "Every 3–4 weeks")}
      ${wtick("todoKit", "Buy the looks kit after the dermat visit", "Food → Shopping → One-time looks kit", "once")}
      ${wtick("todoPhotos", "Take Sunday progress photos", "Front, side, back in the same spot")}
    </div></div>
  <div class="card"><h3 class="h3">Note for your barber</h3><p class="quote">${esc(BARBER_NOTE)}</p>
    <div class="row xs-gap"><button class="btn ghost sm" id="copyBarber">Copy note</button>${vid("textured crop taper fade men", "Haircut ideas")}${vid("short stubble beard line up tutorial", "Beard line-up")}</div></div>
  <div class="card"><h3 class="h3">Sharp face, Hrithik-style</h3><ul class="bullets">${plain(SHARP_LOOK)}</ul></div>
  <div class="card"><h3 class="h3">Chest fat plan</h3><ul class="bullets">${plain(CHEST_PLAN)}</ul>
    <p class="sub">Your program already has incline press, cable fly, rows and face pulls for this.</p></div>
  <div class="card"><h3 class="h3">Look leaner on camera</h3><ul class="bullets">${plain(CAMERA_TIPS)}</ul></div>`;
}
function looksDerm() {
  const tr = S.treatments.slice().sort((a, b) => a.date.localeCompare(b.date));
  return `
  <div class="card"><h3 class="h3">Appointments and treatments</h3>
    <p class="sub">Add each visit or session (consult, peel, laser, follow-up). It shows on Today 3 days before.</p>
    <div class="grid2"><input id="trDate" type="date" value="${today()}" aria-label="Date"><input id="trWhat" placeholder="e.g. Dermat consult" aria-label="What"></div>
    <input id="trNotes" class="mt" placeholder="Notes, e.g. no gym sweat for 24 h after" aria-label="Notes">
    <button class="btn block mt" id="trAdd">Add</button>
    ${tr.map((x) => `<div class="tick ${x.done ? "on" : ""}" data-trdone="${esc(x.id)}" role="checkbox" tabindex="0"><span class="box"></span>
      <div class="t"><b>${esc(x.what)}</b><span class="sub">${fmt(x.date)}${x.notes ? " · " + esc(x.notes) : ""}</span></div>
      <button class="btn ghost xs" data-trdel="${esc(x.id)}" aria-label="Delete">✕</button></div>`).join("") || `<div class="empty">No appointments yet.</div>`}</div>
  <div class="card"><h3 class="h3">Your dermatologist's routine</h3>
    <p class="sub">Type what they prescribe, one step per line, starting with AM or PM. It replaces the default skin routine.</p>
    <textarea id="derm" placeholder="AM: Face wash&#10;AM: Sunscreen SPF 50&#10;PM: Tretinoin 0.025%, pea size">${esc(S.profile.derm || "")}</textarea>
    <button class="btn block mt" id="dermSave">Save routine</button></div>
  <div class="card"><h3 class="h3">Questions to ask</h3><ul class="bullets">
    <li>Is my skin oily, dry or combination? Which face wash, moisturiser and sunscreen?</li>
    <li>Treatment plan for marks, tan or acne, and how many sessions?</li>
    <li>Can I train or sweat the day after a peel or laser?</li>
    <li>Is the puffiness under my nipples fat or gland (gynecomastia)?</li>
    <li>Do I need anything for hair fall? Any issue with whey or creatine?</li></ul></div>`;
}

// ---------- kitchen (food only, for the person cooking) ----------
let kitchenDate = null;
V.kitchen = () => {
  const k = kitchenDate || planDay(), T = dayTargets(k);
  return `
  <div class="card pager"><button class="iconbtn" data-kitchendate="${addDays(k, -1)}" ${k <= today() ? "disabled" : ""} aria-label="Previous day">‹</button>
    <div class="center grow"><b>${esc(dayLabel(k))}</b><div class="sub">${fmt(k)}${journeyDay(k) >= 1 ? ` · Day ${journeyDay(k)}` : ""}</div></div>
    <button class="iconbtn" data-kitchendate="${addDays(k, 1)}" aria-label="Next day">›</button></div>
  <button class="btn ghost block sm" id="copyCook" data-date="${k}">📋 Copy this day's menu</button>
  ${MEALS.map((slot, i) => {
    if (slot.gymOnly && (!T.gym || T.skippedGym)) return "";
    const m = meal(i, k);
    return `<div class="card"><span class="eyebrow">${esc(slot.time)} · ${esc(slotLabel(slot, T.gym && !T.skippedGym))}</span>
      <h2 class="h2">${esc(m.name)}</h2>
      <h3 class="h3 mt">Take</h3><ul class="bullets">${m.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <h3 class="h3 mt">Method</h3><ol class="bullets">${m.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>`;
  }).join("")}
  <div class="card"><h3 class="h3">Kitchen rules</h3><ul class="bullets">${COOK_RULES.map((x) => `<li>${esc(x)}</li>`).join("")}
    <li>Never use tofu, rajma, chole or kabuli chana.</li></ul></div>`;
};

// ---------- daily reminders (iPhone: iOS 16.4+, opened from the Home Screen icon) ----------
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && !window.claude && /^https:$/.test(location.protocol);
function pushCard() {
  if (window.claude || !/^https:$/.test(location.protocol)) return "";
  const on = S.settings.reminders === true;
  const why = !pushSupported() ? (/iPhone|iPad/.test(navigator.userAgent) && !isStandalone()
    ? "Open Journey from its Home Screen icon (Safari → Share → Add to Home Screen) to turn on reminders."
    : "This browser can't show reminders. On iPhone you need iOS 16.4 or newer.") : "";
  return `<div class="card"><h3 class="h3">Daily reminders</h3>
    <p class="sub">7:45 am: weigh-in and D3 · 7:45 pm: isabgol · 9:45 pm: knee exercises and meds.</p>
    ${why ? `<p class="small">${esc(why)}</p>` : `<div class="row"><button class="btn ${on ? "ghost" : ""}" id="pushOn">${on ? "Reminders on ✓ · Re-enable" : "Turn on reminders"}</button>
      ${on ? `<button class="btn ghost sm" id="pushTest">Send a test</button>` : ""}</div>`}</div>`;
}
const b64uToBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function enablePush() {
  if (!S.settings.syncKey) return toast("Add your kitchen sync key below first, then tap Save");
  if ((await Notification.requestPermission()) !== "granted") return toast("Notifications are off. Allow them in iPhone Settings → Notifications → Journey");
  const { key } = await (await fetch("/api/push/key")).json();
  if (!key) return toast("Reminders aren't set up on the server yet. Run deploy.sh on your Mac");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json", "X-Edit-Key": S.settings.syncKey }, body: JSON.stringify(sub) });
  if (!res.ok) return toast(res.status === 401 ? "Wrong kitchen sync key" : "Couldn't turn on reminders");
  S.settings.reminders = true; save(); render(); toast("Reminders on: 7:45 am, 7:45 pm and 9:45 pm");
}
// Red number on the Home Screen icon: today's must-dos still open.
function updateBadge() {
  if (!navigator.setAppBadge) return;
  const c = S.days[today()]?.checks || {}, open = ["knee", "meds", "isabgol", "water"].filter((k) => !c[k]).length;
  (open ? navigator.setAppBadge(open) : navigator.clearAppBadge()).catch(() => {});
}

// ---------- settings ----------
V.settings = () => {
  const p = S.profile, s = S.settings;
  return `
  <div class="card"><h3 class="h3">Gemini API key</h3>
    <p class="sub">Not needed inside the Claude app: there the AI uses your Claude account. On your own website, a free key from aistudio.google.com powers it. Stored only on this phone.</p>
    <input id="sKey" type="password" placeholder="Paste Gemini API key" value="${esc(s.geminiKey)}" aria-label="Gemini API key">
    <label class="field mt">Model<input id="sModel" value="${esc(s.model)}"></label>
    <div class="row mt"><button class="btn ghost" id="sTest">Test key</button><span id="sTestOut" class="sub grow"></span></div></div>
  ${pushCard()}
  <div class="card"><h3 class="h3">Knee</h3>
    <p class="sub">${KNEE.rehab ? `Rehab mode is on: every exercise is knee-safe. Only switch this on after your orthopedic doctor clears you for full training (follow-up ${fmt(KNEE.followUp)}).`
      : "Full training is on. Switch rehab back on if the knee hurts or swells."}</p>
    <button class="btn ${KNEE.rehab ? "ghost" : ""} block" id="kneeToggle">${KNEE.rehab ? "My ortho cleared me for full training" : "Turn knee rehab mode back on"}</button></div>
  <div class="card"><h3 class="h3">Kitchen sync key</h3>
    <p class="sub">On your own website: the password you set as EDIT_KEY in Cloudflare. It lets your meal swaps reach the kitchen page. Stored only on this phone.</p>
    <input id="sSync" type="password" placeholder="Kitchen sync key" value="${esc(s.syncKey || "")}" aria-label="Kitchen sync key"></div>
  <div class="card"><h3 class="h3">Profile</h3>
    <div class="grid2">
      <label class="field">Age<input id="pAge" inputmode="numeric" value="${p.age}"></label>
      <label class="field">Height (cm)<input id="pH" inputmode="numeric" value="${p.heightCm}"></label>
      <label class="field">Start weight (kg)<input id="pW" inputmode="decimal" value="${p.startWeight}"></label>
      <label class="field">Body fat %<input id="pBF" inputmode="decimal" value="${p.bodyFat}"></label>
      <label class="field">Abs reveal date<input id="pDate" type="date" value="${esc(p.targetDate)}"></label>
      <label class="field">Budget ₹/month<input id="pBud" inputmode="numeric" value="${p.budget}"></label>
      <label class="field">Gym weights in<select id="pUnit"><option value="lb" ${lbMode() ? "selected" : ""}>lb (pounds)</option>
        <option value="kg" ${lbMode() ? "" : "selected"}>kg</option></select></label>
    </div>
    <button class="btn block mt" id="sSave">Save</button></div>
  <div class="card"><h3 class="h3">Backup</h3>
    <p class="sub">Your data lives only in this browser. Export a backup every couple of weeks (the API key isn't included).</p>
    <div class="grid2"><button class="btn ghost" id="exp">Export</button>
      <label class="btn ghost" for="imp">Import</label><input type="file" id="imp" accept="application/json" hidden></div></div>`;
};

// ---------- render + events ----------
let tab = location.hash.slice(1) || "today";
if (tab === "plan") tab = "journey";
function render() {
  if (!V[tab]) tab = "today";
  document.body.classList.toggle("kitchen", tab === "kitchen");
  updateBadge();
  $("#view").innerHTML = V[tab]();
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.go === tab));
  const name = S.profile.name ? `, ${S.profile.name}` : "";
  const h = new Date().getHours();
  $("#greet").textContent = tab === "kitchen" ? "Kitchen" : `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}${name}`;
  $("#sub").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}
window.addEventListener("hashchange", () => {
  tab = location.hash.slice(1);
  if (WM) return closeWorkout(); // the phone's back button closes the guided workout
  render(); window.scrollTo(0, 0);
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.setf && WM) {
    const name = exList(WM.di)[WM.i][0], s = (day().sets[name] ||= []);
    const v = el.dataset.setf === "kg" ? fromDisp(el.value) : el.value;
    s[+el.dataset.s] = { ...(s[+el.dataset.s] || {}), [el.dataset.setf]: v }; save();
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.price) { S.prices[el.dataset.price] = +el.value || 0; save(); render(); }
  if (el.id === "foodPhoto" && el.files[0]) $("#foodMsg").textContent = `Photo added: ${el.files[0].name}`;
  if (el.id === "imp" && el.files[0]) el.files[0].text().then((t) => {
    try { const keep = S.settings; localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(t), v2: true, v3: true, settings: keep })); S = load(); KNEE.rehab = !S.settings.kneeCleared; applyProgram(); render(); toast("Backup imported"); }
    catch { toast("That file isn't a valid backup"); }
  });
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".tick[tabindex]")) { e.preventDefault(); e.target.click(); }
});

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("Couldn't copy. Long-press the text instead."); }
}

document.addEventListener("click", async (e) => {
  if (e.target.closest("a.vid, .shoplinks a, details")) return; // links and "How to cook" open normally
  const el = e.target.closest("button,[data-go],[data-check],[data-wcheck],[data-meal],[data-pickmeal],[data-trdone],[data-trainseg],[data-bought]");
  if (!el) return;
  const d = el.dataset;
  if (d.trainseg) { trainSeg = d.trainseg; if (el.tagName === "A") { location.hash = "train"; e.preventDefault(); } return render(); }
  if (d.go) { location.hash = d.go; return; }
  if (d.check) {
    const c = day(d.date || today()).checks; c[d.check] = !c[d.check]; save(); render(); if (WM) renderWM();
    if (d.check === "skipGym" && c.skipGym) toast("Gym skipped. Today's calories lowered by 250.");
    return;
  }
  if (d.wcheck) { const w = (S.weekly[d.bucket || weekKey()] ??= {}); w[d.wcheck] = !w[d.wcheck]; save(); return render(); }
  if (d.cyclemeal) {
    const i = +d.cyclemeal, dt = d.date || today(), x = day(dt);
    (x.mealPick ??= {})[i] = (mealPickIdx(i, dt) + 1) % mealOptions(i, dt).length;
    const at = x.food.findIndex((f) => f.plan === i);
    if (at >= 0) { const m = meal(i, dt); x.food[at] = { name: m.name, kcal: m.kcal, p: m.p, c: 0, f: 0, fib: m.fib, plan: i }; }
    save(); render(); toast(`Swapped to ${meal(i, dt).name}`);
    return sharePicks(dt); // its "sent" / "not sent" message replaces the one above
  }
  if (d.meal) {
    const i = +d.meal, dt = d.date || today(), f = day(dt).food, at = f.findIndex((x) => x.plan === i);
    if (at >= 0) f.splice(at, 1); else { const m = meal(i, dt); f.push({ name: m.name, kcal: m.kcal, p: m.p, c: 0, f: 0, fib: m.fib, plan: i }); }
    save(); return render();
  }
  if (d.pickmeal) {
    const [i, j, dt] = d.pickmeal.split(":"), x = day(dt);
    (x.mealPick ??= {})[+i] = +j; save(); sharePicks(dt); return render();
  }
  if (d.shopweek) { shopWeek = Math.max(1, +d.shopweek); return render(); }
  if (d.bought) { const b = (S.weekly[`shop${d.week}`] ??= {}); b[d.bought] = !b[d.bought]; save(); return render(); }
  if (d.fooddate) { foodDate = d.fooddate < today() ? today() : d.fooddate; return render(); }
  if (d.kitchendate) { kitchenDate = d.kitchendate < today() ? today() : d.kitchendate; return render(); }
  if (d.planday) { planOffset = +d.planday; return render(); }
  if (d.feel) { const [k, v] = d.feel.split(":"), x = day(); x.feel = { ...(x.feel || {}), [k]: +v }; save(); return render(); }
  if (d.trdone) { const t = S.treatments.find((x) => x.id === d.trdone); if (t) t.done = !t.done; save(); return render(); }
  if (d.trdel) { S.treatments = S.treatments.filter((x) => x.id !== d.trdel); save(); return render(); }
  if (d.unlock) { S.skills[+d.unlock] = today(); save(); render(); return toast("Skill unlocked 🏅"); }
  if (d.trainday) { trainDay = +d.trainday; return render(); }
  if (d.foodseg) { foodSeg = d.foodseg; return render(); }
  if (d.looksseg) { looksSeg = d.looksseg; return render(); }
  if (d.startworkout) return openWorkout(+d.startworkout);
  if (d.delfood) { day().food.splice(+d.delfood, 1); save(); return render(); }
  if (d.ask) { foodSeg = "today"; render(); $("#askText").value = d.ask; return ask(d.ask, $("#askOut")); }
  if (d.setdone && WM) {
    const [name, , reps] = exList(WM.di)[WM.i], s = (day().sets[name] ||= []), i = +d.setdone;
    s[i] = { ...(s[i] || {}), done: !s[i]?.done };
    if (s[i].done && !s[i].kg && !isTimed(String(reps))) {
      const kg = document.querySelector(`[data-setf="kg"][data-s="${i}"]`), rp = document.querySelector(`[data-setf="reps"][data-s="${i}"]`);
      s[i].kg = kg && !isNaN(+kg.placeholder) ? fromDisp(kg.placeholder) : ""; s[i].reps = rp?.placeholder || "";
      toast(`Saved ${s[i].kg ? wt(s[i].kg) + " × " : ""}${s[i].reps} reps. Type real numbers if different.`);
    }
    if (s[i].done) WM.restEnd = Date.now() + restSec(name) * 1000;
    save(); return renderWM();
  }
  if (d.swap) {
    const out = el.closest(".grow, .inner").querySelector(".ai"), local = SWAPS[d.swap];
    if (local && !el.dataset.more) { out.textContent = "Knee-safe options:\n• " + local.join("\n• "); el.dataset.more = "1"; el.textContent = "More ideas (AI)"; return; }
    out.textContent = "Thinking…";
    try { out.textContent = await ai(`${coachContext()}\nSuggest 2 alternatives to "${d.swap}" available in a commercial gym, safe for a ${KNEE.side.toLowerCase()}-knee ACL sprain (no squats, lunges, kneeling, jumping or running). One line each, with sets × reps and a beginner starting weight.`); }
    catch (err) { out.textContent = err.message; }
    return;
  }
  switch (el.id) {
    case "wmClose": return closeWorkout();
    case "wmPrev": WM.i--; WM.restEnd = 0; return renderWM();
    case "wmNext":
      if (WM.i < exList(WM.di).length - 1) { WM.i++; $(".overlay").scrollTo(0, 0); return renderWM(); }
      day().checks.workout = true; save(); closeWorkout(); location.hash = "today"; return toast("Workout complete. Great job 💪");
    case "restSkip": WM.restEnd = 0; return renderWM();
    case "foodLog": return logFood();
    case "askBtn": return ask($("#askText").value, $("#askOut"));
    case "reviewBtn": {
      const out = $("#reviewOut"), local = localReview();
      out.textContent = local + "\n\nAsking AI for more…";
      try { out.textContent = local + "\n\nAI coach:\n" + await ai(`${coachContext()}\nPlain text, no markdown, max 120 words.\n` +
        `Review my last 14 days against my phase plan. Look at energy, mood and bloating next to the meals and workouts. Give 5 short, specific changes.\n${JSON.stringify(recent(14)).slice(0, 3500)}`); }
      catch { out.textContent = local; }
      return;
    }
    case "reviewBtnOld": return ask(`Review my last 14 days against my phase plan. Look at energy, mood and bloating next to the meals and workouts, and tell me which foods and days make me feel best and which bloat me. Then give 5 specific, short changes.\n${JSON.stringify(recent(14))}`, $("#reviewOut"));
    case "copyCook": return copy(cookText(d.date), "Menu copied. Paste it in WhatsApp for the cook.");
    case "copyWeek": return copy(weekOrder(shopWeek ?? weekNo()).map((g) => `${g.buy} × ${g.item}`).join("\n"), "This week's list copied");
    case "copyBarber": return copy(BARBER_NOTE, "Barber note copied");
    case "rSave": {
      const km = parseFloat($("#rKm").value), min = parseFloat($("#rMin").value), pain = parseInt($("#rPain").value) || 0;
      if (!km && !min) return toast("Enter the distance or the minutes");
      S.runs.push({ date: today(), km: km || 0, min: min || 0, pain }); save(); render();
      return toast(pain > 3 ? "Saved. Knee pain above 3: go back a stage next time." : "Run saved");
    }
    case "qWeighSave": case "wSave": {
      const kg = parseFloat($(el.id === "wSave" ? "#wKg" : "#qWeigh").value);
      if (!kg || kg < 30 || kg > 250) return toast("Enter a valid weight");
      S.weights = S.weights.filter((x) => x.date !== today());
      S.weights.push({ date: today(), kg, waist: parseFloat($("#wWaist")?.value) || null, shoulder: parseFloat($("#wSh")?.value) || null });
      S.weights.sort((a, b) => a.date.localeCompare(b.date));
      save(); render(); return toast(`Saved ${kg} kg`);
    }
    case "pushOn": return enablePush().catch(() => toast("Couldn't turn on reminders on this device"));
    case "pushTest": {
      const res = await fetch("/api/push/test", { method: "POST", headers: { "X-Edit-Key": S.settings.syncKey || "" } }).catch(() => null);
      return toast(res?.ok ? "Test sent. It should arrive in a few seconds" : "Couldn't send a test");
    }
    case "kneeToggle": {
      if (KNEE.rehab && el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Tap again to confirm: the ortho said yes"; return; }
      S.settings.kneeCleared = KNEE.rehab; KNEE.rehab = !S.settings.kneeCleared; save(); render();
      return toast(KNEE.rehab ? "Knee rehab mode back on" : "Full training on. Go gradually and stop if it hurts");
    }
    case "trAdd": {
      const what = $("#trWhat").value.trim(), date = $("#trDate").value;
      if (!what || !date) return toast("Add a date and what it is");
      S.treatments.push({ id: Date.now().toString(36), date, what, notes: $("#trNotes").value.trim(), done: false });
      save(); render(); return toast("Appointment added");
    }
    case "dermSave": S.profile.derm = $("#derm").value; save(); looksSeg = "routine"; render(); return toast("Dermat routine saved");
    case "sTest": {
      $("#sTestOut").textContent = "Testing…";
      S.settings.geminiKey = $("#sKey").value.trim(); S.settings.model = $("#sModel").value.trim() || "gemini-2.5-flash";
      try { await gemini("Reply with OK"); $("#sTestOut").textContent = "✓ Key works"; save(); }
      catch (err) { $("#sTestOut").textContent = err.message; }
      return;
    }
    case "sSave": {
      S.settings.syncKey = $("#sSync").value.trim();
      S.settings.unit = $("#pUnit").value;
      S.settings.geminiKey = $("#sKey").value.trim(); S.settings.model = $("#sModel").value.trim() || "gemini-2.5-flash";
      Object.assign(S.profile, { age: +$("#pAge").value, heightCm: +$("#pH").value, startWeight: +$("#pW").value,
        bodyFat: +$("#pBF").value, targetDate: $("#pDate").value, budget: +$("#pBud").value });
      save(); render(); return toast("Saved");
    }
    case "exp": {
      const a = document.createElement("a"), { settings, ...rest } = S; // never export the API key
      a.href = URL.createObjectURL(new Blob([JSON.stringify(rest, null, 2)], { type: "application/json" }));
      a.download = `journey-backup-${today()}.json`; a.click(); return;
    }
  }
});

function recent(n) {
  const out = { phase: phase(), weights: S.weights.slice(-n), runs: S.runs.slice(-6), days: {} };
  for (let i = 0; i < n; i++) {
    const dt = new Date(); dt.setDate(dt.getDate() - i); const k = iso(dt);
    if (S.days[k]) out.days[k] = { checks: S.days[k].checks, totals: foodTotals(S.days[k]), target: dayTargets(k).kcal,
      feel: S.days[k].feel, meals: S.days[k].food.map((f) => f.name) };
  }
  return out;
}
async function ask(q, out) {
  if (!q.trim()) return;
  out.textContent = "Thinking…";
  try { out.textContent = await ai(`${coachContext()}\nAnswer briefly and practically (Indian vegetarian context, prices in ₹). Plain text, no markdown.\n\n${q}`); }
  catch (err) { out.textContent = err.message; }
}
async function logFood() {
  const text = $("#foodText").value.trim(), file = $("#foodPhoto").files[0], msg = $("#foodMsg"), btn = $("#foodLog");
  if (!text && !file) return (msg.textContent = "Type what you ate or add a photo.");
  if (text && !file) {
    const { found, missed } = parseFood(text);
    const warn = text.match(WARN_FOODS);
    if (found.length && !missed.length) {
      found.forEach((it) => day().food.push(it)); save(); render();
      return toast(warn ? `Logged. Heads-up: ${warn[0]} isn't in your plan (cholesterol/bloating). Balance it with the next meal.` : `Logged ${found.length} item(s)`);
    }
    if (found.length) { found.forEach((it) => day().food.push(it)); save(); }
    if (missed.length) msg.textContent = `Not in the built-in list: ${missed.join(", ")}. Asking AI…`;
    if (!missed.length) return;
  }
  msg.textContent ||= "Analysing…"; btn.disabled = true;
  try {
    const image = file ? await fileToB64(file) : null;
    const missedText = text && !file ? parseFood(text).missed.join(", ") : text;
    const r = await ai(`Estimate nutrition for this Indian vegetarian food using typical portions.
${missedText ? "Description: " + missedText : "Use the photo."}
Return JSON: {"items":[{"name":string,"kcal":number,"p":number,"c":number,"f":number}]} (p/c/f in grams).`, { json: true, image, file });
    (r.items || []).forEach((it) => day().food.push(it));
    save(); render(); toast(`Logged ${r.items?.length || 0} item(s)`);
  } catch (err) { render(); $("#foodMsg").textContent = err.message; }
}

render();

// Update check: the website build stamps BUILD (see build-worker.py) and serves /version.json.
// When they differ, a newer version is live: offer a one-tap reload that clears the offline cache.
const BUILD = "__BUILD__";
async function checkForUpdate() {
  if (BUILD.startsWith("__") || window.claude || !/^https?:$/.test(location.protocol)) return;
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    const { build } = await res.json();
    if (build && build !== BUILD && !$("#updateBar")) {
      const bar = document.createElement("div");
      bar.id = "updateBar"; bar.className = "update-bar";
      bar.innerHTML = `<span>New update available</span><button class="btn sm" id="updateNow">Reload</button>`;
      document.body.appendChild(bar);
    }
  } catch {}
}
document.addEventListener("click", async (e) => {
  if (e.target.id !== "updateNow") return;
  e.target.textContent = "Updating…";
  try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.update(); } catch {}
  location.reload();
});
checkForUpdate();
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(); });

// Installable phone app: offline cache when served from a real website (not inside Claude).
if ("serviceWorker" in navigator && location.protocol === "https:" && !window.claude) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
