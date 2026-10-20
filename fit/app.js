// Milkha Mode — local-first fitness app. All data lives in this browser's localStorage.
const KEY = "milkha-mode-v1";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => d.toLocaleDateString("en-CA");
const today = () => iso(new Date());
const dayIdx = (d = new Date()) => (d.getDay() + 6) % 7; // Mon = 0
const DAY_MS = 864e5;
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

let S = load();
function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  return {
    profile: { ...PROFILE_DEFAULT, ...s.profile },
    settings: { geminiKey: "", model: "gemini-2.5-flash", ...s.settings },
    days: s.days || {},
    weights: s.weights || [],
    prices: s.prices || {},
    program: s.program || "athlete",
    treatments: s.treatments || [],
  };
}
const program = () => PROGRAMS.find((p) => p.id === S.program) || PROGRAMS[0];
// Meals rotate by date so every day of every week is different; a hand-picked option wins.
function mealPickIdx(i, d = today()) {
  const own = S.days[d]?.mealPick?.[i];
  if (own != null) return own;
  const n = Math.floor(new Date(d) / DAY_MS);
  return (n + i * 3) % MEALS[i].options.length;
}
const meal = (i, d = today()) => MEALS[i].options[mealPickIdx(i, d)] || MEALS[i].options[0];
function applyProgram() { WEEK = program().week; }
const isGymDay = (d = new Date()) => WEEK[dayIdx(d)].ex.length > 2;

// Today's calorie target: phase base, more on gym days, less on rest days, and lower
// automatically when the gym or walk is skipped. After 9 pm an unlogged gym day counts as skipped.
function dayTargets(d = today()) {
  const ph = phase(), x = S.days[d] || { checks: {} }, c = x.checks || {}, date = new Date(d);
  const gym = isGymDay(date), reasons = [];
  let kcal = ph.kcal;
  const autoSkip = gym && !c.workout && !c.trainedLate && d === today() && new Date().getHours() >= 21;
  const skippedGym = gym && !c.workout && (c.skipGym || autoSkip);
  if (!gym) { kcal += ADJUST.restDay; reasons.push(`Rest day ${ADJUST.restDay}`); }
  else if (skippedGym) { kcal += ADJUST.skippedGym; reasons.push(`Skipped gym ${ADJUST.skippedGym}${autoSkip && !c.skipGym ? " (auto, 9 pm)" : ""}`); }
  else { kcal += ADJUST.gymDay; reasons.push(`Gym day +${ADJUST.gymDay}`); }
  if (c.skipWalk) { kcal += ADJUST.skippedWalk; reasons.push(`Missed walk ${ADJUST.skippedWalk}`); }
  const diff = kcal - ph.kcal; // protein stays fixed; carbs absorb the change
  return { kcal, protein: ph.protein, fat: ph.fat, carbs: Math.max(100, ph.carbs + Math.round(diff / 4)),
    reasons, gym, skippedGym, autoSkip: autoSkip && !c.skipGym };
}
applyProgram();
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

// ---------- phases ----------
const START = new Date(PHASES[0].start);
const phaseIndex = (d = new Date()) => {
  const k = iso(d), i = PHASES.findIndex((p) => k >= p.start && k <= p.end);
  return i >= 0 ? i : k < PHASES[0].start ? 0 : PHASES.length - 1;
};
const phase = () => PHASES[phaseIndex()];
const weekNo = (d = new Date()) => Math.max(1, Math.floor((d - START) / (7 * DAY_MS)) + 1);
const isDeload = () => DELOAD_WEEKS.includes(weekNo());
function expectedKg(d) {
  const p = PHASES[phaseIndex(d)], a = new Date(p.start), b = new Date(p.end);
  const t = Math.min(1, Math.max(0, (d - a) / (b - a)));
  return p.fromKg + (p.toKg - p.fromKg) * t;
}
const latestWeight = () => S.weights.at(-1)?.kg ?? S.profile.startWeight;

// ---------- Gemini ----------
async function gemini(prompt, { json = false, image = null } = {}) {
  const k = S.settings.geminiKey.trim();
  if (!k) throw new Error("Add your Gemini API key in Settings (⚙️ top right) first.");
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
const coachContext = () => {
  const p = S.profile, ph = phase();
  return `User: ${p.age}y Indian male, ${p.heightCm} cm, ${latestWeight()} kg, ~${p.bodyFat}% body fat at start, vegetarian, never suggest: ${AVOID_FOODS.join(", ")}. Uses iD Fresh High Protein Paneer. Beginner lifter, gyms at ${GYM_TIME},
wants to lose chest fat and look sharper on camera (Hrithik-style grooming),
${p.knee}. Trains 60 min, ${program().days} days/week ("${program().name}" program) at ${p.gym}. Goal: Farhan Akhtar's Bhaag Milkha Bhaag physique; phase 1 deadline ${p.targetDate}.
Current phase: ${ph.name} (${ph.kcal} kcal, ${ph.protein} g protein, ${ph.steps} steps). Budget ₹${p.budget}/month, orders on Zepto, cooks at home.
${p.derm ? "Dermatologist routine: " + p.derm : ""}`;
};
function fileToB64(file) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok({ type: file.type || "image/jpeg", data: String(r.result).split(",")[1] });
    r.onerror = bad; r.readAsDataURL(file);
  });
}

// ---------- helpers ----------
const foodTotals = (d) => d.food.reduce((t, f) => ({ kcal: t.kcal + (+f.kcal || 0), p: t.p + (+f.p || 0),
  c: t.c + (+f.c || 0), f: t.f + (+f.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
const tick = (id, title, meta = "", sub = "") => {
  const on = !!day().checks[id];
  return `<div class="tick ${on ? "on" : ""}" data-check="${esc(id)}"><span class="box"></span>
    <div class="t"><b>${title}</b>${sub ? `<span class="muted small">${sub}</span>` : ""}</div>${meta ? `<span class="meta">${meta}</span>` : ""}</div>`;
};
function ring(val, max, color, unit) {
  const r = 36, c = 2 * Math.PI * r, f = Math.min(1, max ? val / max : 0);
  return `<div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="8"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/></svg>
    <div class="v"><span>${Math.round(val)}<small>/ ${max} ${unit}</small></span></div></div>`;
}
function workoutsThisWeek() {
  const mon = new Date(); mon.setDate(mon.getDate() - dayIdx());
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
const isTimed = (reps) => /min|s$|s\/|m$|\/ /.test(reps);

// ---------- views ----------
const V = {};

V.today = () => {
  const ph = phase(), w = WEEK[dayIdx()], d = day(), t = foodTotals(d), T = dayTargets();
  const done = d.checks.workout, rest = !T.gym;
  const soon = S.treatments.filter((x) => !x.done && x.date >= today() &&
    (new Date(x.date) - new Date(today())) / DAY_MS <= 3);
  const feel = d.feel || {};
  const needsWeigh = !S.weights.some((x) => x.date === today());
  const habits = [
    ["water", "💧", `${DAILY.waterL} L water`], ["steps", "👟", `${(ph.steps / 1000).toFixed(0)}k steps`],
    ["creatine", "⚡", "Creatine 5 g"], ["skinAM", "🧴", "AM skin + SPF"],
    ["posture", "🧍", "Posture 5 min"], ["skinPM", "🌙", "PM skin"],
    ["sleep", "😴", `Sleep ${DAILY.sleepH} h`], ["nojunk", "🚫", "No junk today"],
  ];
  const doneHabits = habits.filter(([id]) => d.checks[id]).length;
  return `
  <div class="card hero">
    <div class="spread"><span class="pill">${esc(ph.name)} · Week ${weekNo()}</span>
      ${isDeload() ? `<span class="pill grey">Deload week</span>` : ""}</div>
    <h2 style="margin:12px 0 4px">${rest ? esc(w.title) : esc(w.title)}</h2>
    <div class="muted">${rest ? "Recovery day — walk, stretch, prep meals." : `${w.ex.length} exercises · ~60 min · gym at ${GYM_TIME}`}</div>
    <div class="row" style="margin-top:14px">
      ${rest ? "" : done
        ? `<span class="pill ok" style="padding:10px 14px">✓ Workout done</span><button class="btn ghost sm" data-go="train">View</button>`
        : T.skippedGym
        ? `<span class="pill grey" style="padding:10px 14px">Gym skipped — calories lowered</span>
           <button class="btn ghost sm" data-${T.autoSkip ? "check=\"trainedLate\"" : "check=\"skipGym\""}>${T.autoSkip ? "I did train" : "Undo"}</button>`
        : `<button class="btn grow" data-startworkout="${dayIdx()}">▶ Start workout</button><button class="btn ghost" data-check="skipGym">Skip today</button>`}
    </div>
  </div>

  ${soon.map((x) => `<div class="card" style="border-color:var(--blue)"><b>🩺 ${esc(x.what)}</b>
    <div class="muted small">${x.date === today() ? "Today" : fmt(x.date)}${x.notes ? " · " + esc(x.notes) : ""}</div></div>`).join("")}

  <div class="card"><div class="rings">
    <div>${ring(t.kcal, T.kcal, "var(--accent)", "kcal")}<div class="lbl">Calories</div></div>
    <div>${ring(t.p, T.protein, "var(--ok)", "g")}<div class="lbl">Protein</div></div>
    <div>${ring(workoutsThisWeek().filter(Boolean).length, program().days, "var(--blue)", "")}<div class="lbl">Workouts</div></div>
  </div>
  <div class="muted small" style="text-align:center;margin-top:8px">Today's target ${T.kcal} kcal · ${T.reasons.join(" · ")}</div>
  <div class="row" style="margin-top:10px;justify-content:center">
    <button class="btn ghost sm ${d.checks.skipWalk ? "on" : ""}" data-check="skipWalk">${d.checks.skipWalk ? "✓ Missed walk (−150)" : "Missed my walk?"}</button></div>
  </div>

  <div class="card"><h2 style="margin-bottom:6px">How do you feel?</h2>
    <div class="muted small">Helps find what makes you feel your best.</div>
    <div class="feel"><span class="muted small">Energy</span>${[1, 2, 3, 4, 5].map((v) =>
      `<button class="${feel.energy === v ? "on" : ""}" data-feel="energy:${v}">${["😩", "😕", "😐", "🙂", "🔥"][v - 1]}</button>`).join("")}</div>
    <div class="feel"><span class="muted small">Mood</span>${[1, 2, 3, 4, 5].map((v) =>
      `<button class="${feel.mood === v ? "on" : ""}" data-feel="mood:${v}">${["😞", "😔", "😐", "😊", "😄"][v - 1]}</button>`).join("")}</div>
    <div class="feel"><span class="muted small">Bloated?</span>
      <button class="wide ${feel.bloat === 0 ? "on" : ""}" data-feel="bloat:0">No</button>
      <button class="wide ${feel.bloat === 1 ? "on" : ""}" data-feel="bloat:1">A bit</button>
      <button class="wide ${feel.bloat === 2 ? "on" : ""}" data-feel="bloat:2">Very</button></div>
  </div>

  ${needsWeigh ? `<div class="card"><div class="spread"><div><b>Morning weigh-in</b><div class="muted small">After toilet, before food</div></div></div>
    <div class="row" style="margin-top:10px"><input class="grow" id="qWeigh" inputmode="decimal" placeholder="kg">
      <button class="btn" id="qWeighSave">Save</button></div></div>` : ""}

  <div class="section-title"><h2>Habits</h2><span class="muted">${doneHabits}/${habits.length}</span></div>
  <div class="chips">${habits.map(([id, e, label]) =>
    `<button class="chip ${d.checks[id] ? "on" : ""}" data-check="${id}"><span class="e">${e}</span><span>${label}</span></button>`).join("")}</div>

  <div class="section-title"><h2>Meals</h2><a href="#food" class="small">Log other food →</a></div>
  <div class="card" style="padding:4px 16px">
    ${MEALS.map((m, i) => (m.gymOnly && rest) || (m.gymOnly && T.skippedGym) ? "" : mealTick(i)).join("")}
  </div>
  ${!T.gym || T.skippedGym ? `<p class="muted small" style="text-align:center">Lower-calorie day: skip the pre-gym snack and have 1 roti / ½ cup rice less at dinner.</p>` : ""}
  <p class="muted small" style="text-align:center">${esc(ph.food)}</p>`;
};
function mealTick(i) {
  const m = meal(i), on = day().food.some((f) => f.plan === i);
  return `<div class="tick ${on ? "on" : ""}" data-meal="${i}"><span class="box"></span>
    <div class="t"><b>${esc(m.name)}</b><span class="muted small">${esc(m.items)}</span></div>
    <span class="meta">${esc(MEALS[i].time.split(" ")[0])}<br>${m.kcal} kcal<br>
      <button class="btn ghost sm" data-cyclemeal="${i}" aria-label="Next option" style="margin-top:4px">⇄</button></span></div>`;
}

let trainDay = dayIdx(), showProgs = false;
V.train = () => {
  const w = WEEK[trainDay], wk = workoutsThisWeek(), rest = w.ex.length <= 2;
  const pr = program();
  return `
  <div class="card"><div class="spread"><div><div class="muted small">Your program</div><h2 style="margin:2px 0 0">${esc(pr.name)}</h2></div>
    <span class="pill">${pr.days} days/week</span></div>
    <div class="muted small" style="margin-top:6px">${esc(pr.by)}</div>
    <button class="btn ghost sm" data-toggleprog style="margin-top:10px">${showProgs ? "Close" : "Change program"}</button>
    ${showProgs ? PROGRAMS.map((p) => `<div class="note-box" style="margin-top:10px">
      <div class="spread"><b>${esc(p.name)}</b><span class="muted small">${p.days} days/week</span></div>
      <div class="small" style="margin:4px 0">${esc(p.why)}</div><div class="muted small">${esc(p.by)}</div>
      ${p.id === pr.id ? `<span class="pill ok" style="margin-top:8px">✓ Current</span>`
        : `<button class="btn sm" data-program="${p.id}" style="margin-top:8px">Choose this</button>`}</div>`).join("") : ""}
  </div>
  <div class="week">${WEEK.map((x, i) => `<button class="${i === trainDay ? "on" : ""} ${i === dayIdx() ? "today" : ""} ${wk[i] ? "done" : ""}"
    data-trainday="${i}">${x.day}</button>`).join("")}</div>
  <div class="card">
    <div class="spread"><h2 style="margin:0">${esc(w.title)}</h2></div>
    ${isDeload() ? `<p class="note-box" style="margin-top:10px">Deload week: same exercises, use ~60% of your usual weight.</p>` : ""}
    ${!rest ? `<p class="warn small" style="margin:10px 0 0">Left knee: pain-free range only. Sharp pain = stop and use AI swap.</p>` : ""}
    ${w.ex.map(([name, sets, reps, note], i) => {
      const last = lastSets(name);
      return `<div class="ex"><div class="row"><span class="num">${i + 1}</span>
        <div class="grow"><div class="name">${esc(name)}</div>
        <div class="note">${sets > 1 ? sets + " × " : ""}${esc(reps)}${note ? " · " + esc(note) : ""}</div>
        ${last ? `<div class="note">Last (${esc(last.date.slice(5))}): ${last.sets.filter((x) => x?.kg).map((x) => `${esc(x.kg)}×${esc(x.reps)}`).join(", ")}</div>` : ""}
        </div></div>
        ${!rest ? `<button class="btn ghost sm" data-swap="${esc(name)}" style="margin-top:8px">↻ AI swap</button><pre class="ai"></pre>` : ""}</div>`;
    }).join("")}
    ${!rest ? `<button class="btn block" style="margin-top:14px" data-startworkout="${trainDay}">▶ Start guided workout</button>` : ""}
  </div>
  <div class="card"><h2>How to progress</h2>
    <p class="muted" style="margin:0">Weeks 1–2: learn form with light weights. After that, when every set reaches the top of the rep range,
    go up 2.5 kg (or the next dumbbell) next time. The app shows your last numbers so you always know what to beat.</p></div>`;
};

// ---------- guided workout overlay ----------
let WM = null, restTimer = null;
function openWorkout(di) { WM = { di, i: 0, restEnd: 0 }; renderWM(); }
function closeWorkout() { WM = null; clearInterval(restTimer); $("#overlay").innerHTML = ""; document.body.style.overflow = ""; render(); }
function renderWM() {
  if (!WM) return;
  document.body.style.overflow = "hidden";
  const w = WEEK[WM.di], [name, sets, reps, note] = w.ex[WM.i], d = day();
  const timed = isTimed(String(reps)), n = timed ? 1 : sets;
  const logged = (d.sets[name] = Array.isArray(d.sets[name]) ? d.sets[name] : []);
  const last = lastSets(name);
  const pct = ((WM.i + 1) / w.ex.length) * 100, isLast = WM.i === w.ex.length - 1;
  $("#overlay").innerHTML = `<div class="overlay"><div class="inner">
    <div class="wm-top"><button class="iconbtn" id="wmClose" aria-label="Close">✕</button>
      <div class="bar"><i style="width:${pct}%"></i></div><span class="muted small">${WM.i + 1}/${w.ex.length}</span></div>
    <span class="pill">${esc(w.title)}</span>
    <div class="wm-name">${esc(name)}</div>
    <div class="muted">${sets > 1 ? sets + " sets × " : ""}${esc(reps)}${note ? " · " + esc(note) : ""}</div>
    ${last ? `<div class="note-box" style="margin-top:12px">Last time: <b>${last.sets.filter((x) => x?.kg).map((x) => `${esc(x.kg)} kg × ${esc(x.reps)}`).join(" · ")}</b></div>` : ""}
    <div class="timer" id="restBox" style="${WM.restEnd > Date.now() ? "" : "display:none"}"><span class="muted small">Rest</span><b id="restT">0:00</b>
      <button class="btn ghost sm" id="restSkip">Skip rest</button></div>
    ${timed ? "" : `<div class="sethead"><span>Set</span><span>kg</span><span>Reps</span><span></span></div>`}
    ${Array.from({ length: n }, (_, s) => {
      const x = logged[s] || {}, prev = last?.sets[s] || {};
      return timed
        ? `<div class="setrow" style="grid-template-columns:1fr 46px"><span>Done ${esc(reps)}</span>
            <button class="ok ${x.done ? "on" : ""}" data-setdone="${s}">✓</button></div>`
        : `<div class="setrow"><span class="sn">${s + 1}</span>
          <input inputmode="decimal" placeholder="${esc(prev.kg || "kg")}" data-setf="kg" data-s="${s}" value="${esc(x.kg || "")}">
          <input inputmode="numeric" placeholder="${esc(prev.reps || String(reps).split("–")[0])}" data-setf="reps" data-s="${s}" value="${esc(x.reps || "")}">
          <button class="ok ${x.done ? "on" : ""}" data-setdone="${s}">✓</button></div>`;
    }).join("")}
    <button class="btn ghost sm" data-swap="${esc(name)}" style="margin-top:14px">↻ Knee hurts? AI swap</button><pre class="ai"></pre>
  </div>
  <div class="wm-foot">
    <button class="btn ghost" id="wmPrev" ${WM.i === 0 ? "disabled" : ""}>← Back</button>
    <button class="btn" id="wmNext">${isLast ? "Finish 🎉" : "Next →"}</button>
  </div></div>`;
  tickRest();
}
function tickRest() {
  clearInterval(restTimer);
  const upd = () => {
    const box = $("#restBox"), left = Math.max(0, Math.ceil((WM?.restEnd - Date.now()) / 1000));
    if (!box) return clearInterval(restTimer);
    box.style.display = left > 0 ? "" : "none";
    $("#restT").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    if (left <= 0) { clearInterval(restTimer); if (WM?.restEnd) { WM.restEnd = 0; navigator.vibrate?.([200, 100, 200]); } }
  };
  upd(); restTimer = setInterval(upd, 500);
}

// ---------- food ----------
let foodSeg = "log", planOffset = 0;
V.food = () => {
  const d = day(), t = foodTotals(d), ph = phase();
  const seg = `<div class="seg">${[["log", "Log"], ["plan", "Meal plan"], ["zepto", "Zepto list"]].map(([k, l]) =>
    `<button class="${foodSeg === k ? "on" : ""}" data-foodseg="${k}">${l}</button>`).join("")}</div>`;
  if (foodSeg === "plan") {
    const dates = Array.from({ length: 7 }, (_, k) => { const x = new Date(); x.setDate(x.getDate() + k); return iso(x); });
    const pd = dates[planOffset], T = dayTargets(pd), gym = isGymDay(new Date(pd));
    return seg + `
    <div class="week">${dates.map((k, i) => `<button class="${i === planOffset ? "on" : ""} ${i === 0 ? "today" : ""}" data-planday="${i}">
      ${new Date(k).toLocaleDateString("en-IN", { weekday: "short" })}</button>`).join("")}</div>
    <div class="card"><div class="spread"><h2 style="margin:0">${planOffset === 0 ? "Today" : fmt(pd)}</h2>
      <span class="pill ${gym ? "" : "grey"}">${gym ? "Gym day" : "Rest day"}</span></div>
      <div class="grid2" style="margin-top:10px"><div><b>${T.kcal}</b> <span class="muted">kcal</span></div><div><b>${T.protein} g</b> <span class="muted">protein</span></div>
      <div><b>${T.carbs} g</b> <span class="muted">carbs</span></div><div><b>${T.fat} g</b> <span class="muted">fat</span></div></div>
      <p class="note-box" style="margin-bottom:0">${esc(ph.food)}${gym ? "" : " Rest day: no pre-gym snack, 1 roti / ½ cup rice less at dinner."}</p></div>
    <p class="muted small">Meals change every day automatically. Tap another option to swap it for this day only.
      No tofu, rajma or chole. Inspired by Rujuta Diwekar's home-food approach and Ryan Fernando's high-protein vegetarian advice.</p>
    ${MEALS.map((slot, i) => slot.gymOnly && !gym ? "" : `<div class="card"><span class="pill grey">${esc(slot.time)}</span>
      ${slot.options.map((m, j) => { const on = mealPickIdx(i, pd) === j;
        return `<div class="tick ${on ? "on" : ""}" data-pickmeal="${i}:${j}:${pd}"><span class="box"></span>
          <div class="t"><b>${esc(m.name)}</b><span class="muted small">${esc(m.items)}</span></div>
          <span class="meta">${m.kcal} kcal<br>${m.p} g P</span></div>`; }).join("")}</div>`).join("")}
    <div class="card"><h2>Need ideas?</h2><button class="btn ghost block" data-ask="Give me 3 new high-protein vegetarian recipes using high-protein paneer or soya for my current phase, with grams and macros, under ₹120 each. Nothing that bloats.">✨ 3 new paneer/soya recipes</button></div>`;
  }

  if (foodSeg === "zepto") {
    const price = (g) => S.prices[g.item] ?? g.price;
    const weekly = GROCERY.reduce((s, g) => s + g.qty * price(g), 0);
    const extras = MONTHLY_EXTRAS.reduce((s, g) => s + price(g), 0);
    const monthly = weekly * 4.33 + extras, over = monthly > S.profile.budget;
    return seg + `
    <div class="card hero"><div class="muted small">Monthly spend (gym already paid)</div>
      <div class="spread" style="margin:4px 0 10px"><h2 style="margin:0;font-size:26px">${inr(monthly)}</h2>
        <span class="pill ${over ? "" : "ok"}">${over ? "Over" : "Within"} ${inr(S.profile.budget)}</span></div>
      <div class="bar"><i style="width:${Math.min(100, (monthly / S.profile.budget) * 100)}%;${over ? "background:var(--warn)" : ""}"></i></div>
      <div class="muted small" style="margin-top:8px">Groceries ${inr(weekly)}/week · Supplements & grooming ${inr(extras)}/month</div></div>
    <div class="card"><div class="spread"><h2 style="margin:0">Weekly order</h2><button class="btn ghost sm" id="copyAll">📋 Copy list</button></div>
      <p class="muted small">Edit a price to match Zepto. Tap an item to copy its name for search.</p>
      <table><tr><th>Item</th><th class="n">Qty</th><th class="n">₹</th></tr>
      ${GROCERY.map((g) => `<tr><td data-copy="${esc(g.item.replace(/\s*\(.*\)/, ""))}">${esc(g.item)}</td><td class="n">${g.qty}</td>
        <td class="n"><input class="price" inputmode="numeric" data-price="${esc(g.item)}" value="${price(g)}"></td></tr>`).join("")}</table></div>
    <div class="card"><h2>Monthly buys</h2><table>
      ${MONTHLY_EXTRAS.map((g) => `<tr><td data-copy="${esc(g.item.replace(/\s*\(.*\)/, ""))}">${esc(g.item)}</td>
        <td class="n"><input class="price" inputmode="numeric" data-price="${esc(g.item)}" value="${price(g)}"></td></tr>`).join("")}</table></div>`;
  }

  const T = dayTargets();
  return seg + `
  <div class="card"><div class="rings" style="grid-template-columns:repeat(4,1fr)">
    <div>${ring(t.kcal, T.kcal, "var(--accent)", "")}<div class="lbl">kcal</div></div>
    <div>${ring(t.p, T.protein, "var(--ok)", "")}<div class="lbl">Protein g</div></div>
    <div>${ring(t.c, T.carbs, "var(--blue)", "")}<div class="lbl">Carbs g</div></div>
    <div>${ring(t.f, T.fat, "var(--warn)", "")}<div class="lbl">Fat g</div></div>
  </div>
  <div class="muted small" style="text-align:center;margin-top:8px">${T.reasons.join(" · ")}</div></div>
  <div class="card"><h2>Log with AI</h2>
    <textarea id="foodText" placeholder="e.g. 2 roti, 1 katori dal, 100 g paneer bhurji"></textarea>
    <div class="row" style="margin-top:10px">
      <label class="btn ghost" style="flex:none">📷 Photo<input type="file" id="foodPhoto" accept="image/*" capture="environment" hidden></label>
      <button class="btn grow" id="foodLog">Analyse & log</button></div>
    <div id="foodMsg" class="muted small" style="margin-top:8px"></div></div>
  <div class="card" style="padding:4px 16px">
    ${d.food.map((f, i) => `<div class="tick on" style="cursor:default"><div class="t"><b style="color:var(--text)">${esc(f.name)}</b>
      <span class="muted small">${Math.round(f.kcal)} kcal · P ${Math.round(f.p)} · C ${Math.round(f.c || 0)} · F ${Math.round(f.f || 0)}</span></div>
      <button class="btn ghost sm" data-delfood="${i}" aria-label="Remove">✕</button></div>`).join("") ||
      `<div class="empty">Nothing logged yet. Tick meals on Today or log above.</div>`}</div>
  <div class="card"><h2>Ask the coach</h2>
    <textarea id="askText" placeholder="e.g. I'm at a wedding tonight, what should I eat?"></textarea>
    <button class="btn block" id="askBtn" style="margin-top:10px">Ask</button><pre class="ai" id="askOut"></pre></div>`;
};

// ---------- plan / progress ----------
V.plan = () => {
  const pi = phaseIndex(), w = latestWeight(), exp = expectedKg(new Date()), diff = w - exp;
  const p = S.profile;
  const status = !S.weights.length ? ["grey", "Log your first weigh-in"]
    : diff <= 0.3 ? ["ok", "On track"] : diff <= 1.5 ? ["", "Slightly behind"] : ["", "Behind — check food logs"];
  return `
  <div class="card hero">
    <div class="spread"><span class="muted small">Now</span><span class="pill ${status[0]}">${status[1]}</span></div>
    <div class="spread" style="margin-top:6px">
      <div><div style="font-size:30px;font-weight:800">${w} <span class="muted" style="font-size:15px">kg</span></div>
        <div class="muted small">Plan says ${exp.toFixed(1)} kg today</div></div>
      <div style="text-align:right"><div style="font-size:22px;font-weight:700;color:var(--ok)">${(w - p.startWeight).toFixed(1)} kg</div>
        <div class="muted small">since start</div></div></div>
    <div class="row" style="margin-top:12px"><input class="grow" id="wKg" inputmode="decimal" placeholder="Weight kg">
      <input class="grow" id="wWaist" inputmode="decimal" placeholder="Waist cm"><button class="btn" id="wSave">Save</button></div>
  </div>
  <div class="card chart"><h2>Weight vs plan</h2>${chart()}
    <div class="legend"><span><i style="background:var(--accent)"></i>You</span><span><i style="background:var(--muted)"></i>Plan</span></div></div>

  <div class="section-title"><h2>Roadmap</h2><span class="muted small">Week ${weekNo()}</span></div>
  <div class="card" style="padding:4px 16px">
    ${PHASES.map((ph, i) => `<div class="phase ${i < pi ? "past" : i === pi ? "now" : "future"}"><span class="dot"></span><div class="body">
      <div class="spread"><b>${i + 1}. ${esc(ph.name)}</b><span class="muted small">${fmt(ph.start)} – ${fmt(ph.end)}</span></div>
      <div class="muted small">${ph.fromKg} → ${ph.toKg} kg · ${ph.kcal} kcal · ${ph.protein} g protein</div>
      ${i === pi ? `<p class="small" style="margin:6px 0 0">${esc(ph.focus)}</p>` : ""}</div></div>`).join("")}
  </div>

  <div class="card"><h2>What's realistic</h2>
    <p class="muted" style="margin:0">By <b style="color:var(--text)">${fmt(p.targetDate)}</b>: about <b style="color:var(--text)">84 kg, ~19% body fat</b> —
    clearly leaner face, visible shoulders and arms, waist down 8–10 cm. Farhan's full Milkha look (~10–12% body fat) needs phase 4,
    around <b style="color:var(--text)">July 2027</b>. Rough weeks are normal; the trend matters.</p></div>

  <div class="card"><h2>Coaches we follow</h2>
    <p class="muted small">The plan uses their publicly shared principles (not their official programs).</p>
    ${COACHES.map((c) => `<div class="tick" style="cursor:default"><div class="t"><b>${esc(c.name)}</b>
      <span class="muted small">${esc(c.note)}</span></div><span class="meta">${esc(c.area)}</span></div>`).join("")}</div>

  <div class="card"><h2>Weekly AI review</h2>
    <p class="muted small">Gemini checks the last 14 days of weight, food and workouts and tells you what to change.</p>
    <button class="btn ghost block" id="reviewBtn">✨ Review my last 2 weeks</button><pre class="ai" id="reviewOut"></pre></div>

  <div class="card" style="padding:4px 16px">
    ${S.weights.slice().reverse().slice(0, 14).map((x) => `<div class="tick" style="cursor:default"><div class="t"><b>${fmt(x.date)}</b></div>
      <span class="meta">${x.kg} kg${x.waist ? ` · ${x.waist} cm` : ""}</span></div>`).join("") || `<div class="empty">No weigh-ins yet.</div>`}</div>`;
};
const fmt = (k) => new Date(k).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function chart() {
  const W = 320, H = 180, end = new Date(S.profile.targetDate);
  const t0 = +START, t1 = Math.max(+end, ...S.weights.map((x) => +new Date(x.date)));
  const ys = [...S.weights.map((x) => x.kg), PHASES[0].fromKg, expectedKg(end)];
  const lo = Math.floor(Math.min(...ys) - 1), hi = Math.ceil(Math.max(...ys) + 1);
  const X = (t) => 28 + ((t - t0) / (t1 - t0)) * (W - 34), Y = (kg) => 10 + ((hi - kg) / (hi - lo)) * (H - 30);
  const plan = []; for (let t = t0; t <= t1; t += 7 * DAY_MS) plan.push(`${X(t)},${Y(expectedKg(new Date(t)))}`);
  const you = S.weights.map((x) => `${X(+new Date(x.date))},${Y(x.kg)}`);
  const grid = [hi, (hi + lo) / 2, lo].map((v) => `<line x1="28" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>
    <text x="0" y="${Y(v) + 4}" fill="var(--muted)" font-size="10">${Math.round(v)}</text>`).join("");
  const nowX = X(Date.now());
  return `<svg viewBox="0 0 ${W} ${H}">${grid}
    <line x1="${nowX}" x2="${nowX}" y1="6" y2="${H - 18}" stroke="var(--accent)" stroke-dasharray="2 3" opacity=".5"/>
    <polyline fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 4" points="${plan.join(" ")}"/>
    ${you.length > 1 ? `<polyline fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" points="${you.join(" ")}"/>` : ""}
    ${you.map((pt) => `<circle cx="${pt.split(",")[0]}" cy="${pt.split(",")[1]}" r="3" fill="var(--accent)"/>`).join("")}
    <text x="28" y="${H - 2}" fill="var(--muted)" font-size="10">${fmt(PHASES[0].start)}</text>
    <text x="${W}" y="${H - 2}" fill="var(--muted)" font-size="10" text-anchor="end">${fmt(iso(new Date(t1)))}</text></svg>`;
}

// ---------- looks ----------
let looksSeg = "daily";
V.looks = () => {
  const list = (key, arr) => arr.map((x, i) => tick(`${key}${i}`, esc(x))).join("");
  const derm = S.profile.derm || "";
  const seg = `<div class="seg">${[["daily", "Daily"], ["sharp", "Sharp look"], ["weekly", "Weekly"], ["derm", "Dermat"]].map(([k, l]) =>
    `<button class="${looksSeg === k ? "on" : ""}" data-looksseg="${k}">${l}</button>`).join("")}</div>`;
  const plain = (arr) => arr.map((x) => `<div class="tick" style="cursor:default"><div class="t"><span>${esc(x)}</span></div></div>`).join("");
  if (looksSeg === "sharp") return seg + `
    <div class="card"><h2>Sharp face (Hrithik-style)</h2>${plain(SHARP_LOOK)}</div>
    <div class="card"><h2>Chest fat plan</h2>${plain(CHEST_PLAN)}
      <p class="muted small" style="margin-bottom:0">Your program already includes incline press, cable fly, rows and face pulls for this.</p></div>
    <div class="card"><h2>Look leaner on camera</h2>${plain(CAMERA_TIPS)}</div>
    <div class="card"><h2>Progress photos</h2><p class="muted small" style="margin:0">Every Sunday morning: same spot, same light, front / side / back,
      relaxed. Keep them in a hidden phone album — the mirror lies, photos don't.</p>
      ${tick("photos", "Took this week's photos")}</div>`;
  if (looksSeg === "derm") {
    const tr = S.treatments.slice().sort((a, b) => a.date.localeCompare(b.date));
    return seg + `
    <div class="card"><h2>Treatments & appointments</h2>
      <p class="muted small">Add each dermat visit or session (peel, laser, follow-up). It shows on Today 3 days before.</p>
      <div class="grid2"><input id="trDate" type="date" value="${today()}"><input id="trWhat" placeholder="e.g. Chemical peel #1"></div>
      <input id="trNotes" placeholder="Notes (e.g. no gym sweat for 24 h, avoid sun)" style="margin-top:8px">
      <button class="btn block" id="trAdd" style="margin-top:8px">Add</button>
      ${tr.map((x) => `<div class="tick ${x.done ? "on" : ""}" data-trdone="${esc(x.id)}"><span class="box"></span>
        <div class="t"><b>${esc(x.what)}</b><span class="muted small">${fmt(x.date)}${x.notes ? " · " + esc(x.notes) : ""}</span></div>
        <button class="btn ghost sm" data-trdel="${esc(x.id)}" aria-label="Delete">✕</button></div>`).join("") || `<div class="empty">No appointments yet.</div>`}
    </div>
    <div class="card"><h2>Dermatologist's routine</h2>
      <p class="muted small">Type or paste what your dermat prescribed, one step per line. It becomes your daily checklist and replaces the general skin routine.</p>
      <textarea id="derm" placeholder="AM: Face wash&#10;AM: Sunscreen SPF 50&#10;PM: Tretinoin 0.025% pea size">${esc(derm)}</textarea>
      <button class="btn block" id="dermSave" style="margin-top:10px">Save routine</button></div>
    <div class="card"><h2>Ask before using</h2><p class="muted small" style="margin:0">Questions to ask your dermat: oily or dry skin type? Anything for dark circles or acne marks?
      Which sunscreen? Is a hair-fall check (minoxidil/biotin) needed? Any reaction with whey/creatine?
      Can I train the day after a peel/laser? Is the chest puffiness fat or gland (gynecomastia)?</p></div>`;
  }
  if (looksSeg === "weekly") return seg + `
    <div class="card" style="padding:4px 16px">${list("gWk", GROOMING.weekly)}</div>
    <div class="card"><h2>The Milkha look</h2><p class="muted small" style="margin:0">Short, textured hair with a slightly longer top, sharp sideburns,
      short stubble with a thick moustache. Fitted plain tees, track jackets and an upright stance sell the athlete look more than any product.</p></div>`;
  const dermLines = derm.split("\n").map((x) => x.trim()).filter(Boolean);
  return seg + (dermLines.length
    ? `<h3>Dermat routine</h3><div class="card" style="padding:4px 16px">${list("derm", dermLines)}</div>`
    : `<h3>Morning</h3><div class="card" style="padding:4px 16px">${list("gAM", GROOMING.am)}</div>
       <h3>Night</h3><div class="card" style="padding:4px 16px">${list("gPM", GROOMING.pm)}</div>`) + `
    <h3>Posture</h3><div class="card" style="padding:4px 16px">${list("gPos", GROOMING.posture)}</div>
    <p class="muted small" style="text-align:center">Losing fat is what reveals the jawline. Sleep and water cut face puffiness.</p>`;
};

// ---------- settings ----------
V.settings = () => {
  const p = S.profile, s = S.settings;
  return `
  <div class="card"><h2>Gemini API key</h2>
    <p class="muted small">Free at <b>aistudio.google.com</b> → Get API key. Stored only on this phone.</p>
    <input id="sKey" type="password" placeholder="Paste Gemini API key" value="${esc(s.geminiKey)}">
    <label class="field" style="margin-top:10px">Model<input id="sModel" value="${esc(s.model)}"></label>
    <div class="row" style="margin-top:10px"><button class="btn ghost" id="sTest">Test key</button><span id="sTestOut" class="muted small grow"></span></div></div>
  <div class="card"><h2>Profile</h2>
    <div class="grid2">
      <label class="field">Age<input id="pAge" inputmode="numeric" value="${p.age}"></label>
      <label class="field">Height (cm)<input id="pH" inputmode="numeric" value="${p.heightCm}"></label>
      <label class="field">Start weight (kg)<input id="pW" inputmode="decimal" value="${p.startWeight}"></label>
      <label class="field">Body fat %<input id="pBF" inputmode="decimal" value="${p.bodyFat}"></label>
      <label class="field">Phase 1 target<input id="pDate" type="date" value="${esc(p.targetDate)}"></label>
      <label class="field">Budget ₹/month<input id="pBud" inputmode="numeric" value="${p.budget}"></label>
    </div>
    <button class="btn block" id="sSave" style="margin-top:14px">Save</button></div>
  <div class="card"><h2>Backup</h2>
    <p class="muted small">Data lives only on this phone. Export a backup every couple of weeks (the API key is not included).</p>
    <div class="grid2"><button class="btn ghost" id="exp">⬇ Export</button>
      <label class="btn ghost">⬆ Import<input type="file" id="imp" accept="application/json" hidden></label></div></div>`;
};

// ---------- render + events ----------
let tab = location.hash.slice(1) || "today";
function render() {
  if (!V[tab]) tab = "today";
  $("#view").innerHTML = V[tab]();
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.go === tab));
  const days = Math.ceil((new Date(S.profile.targetDate) - new Date()) / DAY_MS);
  $("#sub").textContent = `${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}` +
    (days > 0 ? ` · ${days} days to ${fmt(S.profile.targetDate)}` : "");
}
window.addEventListener("hashchange", () => {
  tab = location.hash.slice(1);
  if (WM) return closeWorkout(); // leaving the screen (e.g. phone back button) closes the guided workout
  render(); window.scrollTo(0, 0);
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.setf && WM) {
    const name = WEEK[WM.di].ex[WM.i][0], s = (day().sets[name] ||= []);
    s[+el.dataset.s] = { ...(s[+el.dataset.s] || {}), [el.dataset.setf]: el.value }; save();
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.price) { S.prices[el.dataset.price] = +el.value || 0; save(); render(); }
  if (el.id === "foodPhoto" && el.files[0]) $("#foodMsg").textContent = `Photo added: ${el.files[0].name}`;
  if (el.id === "imp" && el.files[0]) el.files[0].text().then((t) => {
    try { const keep = S.settings; localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(t), settings: keep })); S = load(); applyProgram(); render(); toast("Backup imported"); }
    catch { toast("That file isn't a valid backup"); }
  });
});

document.addEventListener("click", async (e) => {
  const el = e.target.closest("button,[data-go],[data-check],[data-meal],[data-pickmeal],[data-trdone],[data-copy]");
  if (!el) return;
  const d = el.dataset;
  if (d.go) { location.hash = d.go; return; }
  if (d.check) {
    const c = day().checks; c[d.check] = !c[d.check]; save(); render();
    if (d.check === "workout" && c.workout) toast("Workout logged 💪");
    return;
  }
  if (d.cyclemeal) {
    const i = +d.cyclemeal, x = day();
    (x.mealPick ??= {})[i] = (mealPickIdx(i) + 1) % MEALS[i].options.length;
    const at = x.food.findIndex((f) => f.plan === i);
    if (at >= 0) { const m = meal(i); x.food[at] = { name: m.name, kcal: m.kcal, p: m.p, c: 0, f: 0, plan: i }; }
    save(); render(); return toast(`Switched to ${meal(i).name}`);
  }
  if (d.pickmeal) {
    const [i, j, dt] = d.pickmeal.split(":"), x = day(dt);
    (x.mealPick ??= {})[+i] = +j; save(); render();
    return toast(`${MEALS[+i].time.replace(/^\S+\s/, "")}: ${meal(+i, dt).name}`);
  }
  if (d.planday) { planOffset = +d.planday; return render(); }
  if (d.feel) {
    const [k, v] = d.feel.split(":"), x = day(); x.feel = { ...(x.feel || {}), [k]: +v };
    save(); render(); return;
  }
  if (d.trdone) {
    const t = S.treatments.find((x) => x.id === d.trdone); if (t) t.done = !t.done; save(); return render();
  }
  if (d.trdel) { S.treatments = S.treatments.filter((x) => x.id !== d.trdel); save(); return render(); }
  if (d.toggleprog !== undefined) { showProgs = !showProgs; return render(); }
  if (d.program) {
    S.program = d.program; applyProgram(); showProgs = false; save(); render();
    return toast(`Switched to ${program().name}`);
  }
  if (d.meal) {
    const i = +d.meal, f = day().food, at = f.findIndex((x) => x.plan === i);
    if (at >= 0) f.splice(at, 1); else { const m = meal(i); f.push({ name: m.name, kcal: m.kcal, p: m.p, c: 0, f: 0, plan: i }); }
    save(); return render();
  }
  if (d.copy) { navigator.clipboard?.writeText(d.copy); return toast(`Copied “${d.copy}” — paste in Zepto`); }
  if (d.trainday) { trainDay = +d.trainday; return render(); }
  if (d.foodseg) { foodSeg = d.foodseg; return render(); }
  if (d.looksseg) { looksSeg = d.looksseg; return render(); }
  if (d.startworkout) return openWorkout(+d.startworkout);
  if (d.delfood) { day().food.splice(+d.delfood, 1); save(); return render(); }
  if (d.ask) { foodSeg = "log"; render(); $("#askText").value = d.ask; return ask(d.ask, $("#askOut")); }
  if (d.setdone && WM) {
    const name = WEEK[WM.di].ex[WM.i][0], s = (day().sets[name] ||= []), i = +d.setdone;
    s[i] = { ...(s[i] || {}), done: !s[i]?.done };
    if (s[i].done && !s[i].kg && !isTimed(String(WEEK[WM.di].ex[WM.i][2]))) {
      const inp = document.querySelector(`[data-setf="kg"][data-s="${i}"]`), rp = document.querySelector(`[data-setf="reps"][data-s="${i}"]`);
      s[i].kg = inp?.placeholder !== "kg" ? inp.placeholder : ""; s[i].reps = rp?.placeholder || "";
    }
    if (s[i].done) WM.restEnd = Date.now() + 90e3;
    save(); return renderWM();
  }
  if (d.swap) {
    const out = el.nextElementSibling; out.textContent = "Thinking…";
    try { out.textContent = await gemini(`${coachContext()}\nSuggest 2 alternatives to "${d.swap}" available in a commercial gym, safe for the left knee. One line each, with sets × reps.`); }
    catch (err) { out.textContent = err.message; }
    return;
  }
  switch (el.id) {
    case "wmClose": return closeWorkout();
    case "wmPrev": WM.i--; WM.restEnd = 0; return renderWM();
    case "wmNext":
      if (WM.i < WEEK[WM.di].ex.length - 1) { WM.i++; window.scrollTo(0, 0); return renderWM(); }
      day().checks.workout = true; save(); closeWorkout(); location.hash = "today"; return toast("Workout complete 🎉 Great job!");
    case "restSkip": WM.restEnd = 0; return renderWM();
    case "foodLog": return logFood();
    case "askBtn": return ask($("#askText").value, $("#askOut"));
    case "reviewBtn": return ask(`Review my last 14 days against my phase plan. Look at my energy/mood/bloating scores next to the meals and workouts and tell me which days and foods make me feel best and which make me bloated. Then give 5 specific, short changes.\n${JSON.stringify(recent(14))}`, $("#reviewOut"));
    case "copyAll": {
      const text = GROCERY.map((g) => `${g.item.replace(/\s*\(.*\)/, "")} × ${g.qty}`).join("\n");
      navigator.clipboard?.writeText(text); return toast("Weekly list copied");
    }
    case "qWeighSave": case "wSave": {
      const kg = parseFloat($(el.id === "wSave" ? "#wKg" : "#qWeigh").value);
      if (!kg || kg < 30 || kg > 250) return toast("Enter a valid weight");
      S.weights = S.weights.filter((x) => x.date !== today());
      S.weights.push({ date: today(), kg, waist: parseFloat($("#wWaist")?.value) || null });
      S.weights.sort((a, b) => a.date.localeCompare(b.date));
      save(); render(); return toast(`Saved ${kg} kg`);
    }
    case "trAdd": {
      const what = $("#trWhat").value.trim(), date = $("#trDate").value;
      if (!what || !date) return toast("Add a date and what it is");
      S.treatments.push({ id: Date.now().toString(36), date, what, notes: $("#trNotes").value.trim(), done: false });
      save(); render(); return toast("Appointment added");
    }
    case "dermSave": S.profile.derm = $("#derm").value; save(); looksSeg = "daily"; render(); return toast("Dermat routine saved");
    case "sTest": {
      $("#sTestOut").textContent = "Testing…";
      S.settings.geminiKey = $("#sKey").value.trim(); S.settings.model = $("#sModel").value.trim() || "gemini-2.5-flash";
      try { await gemini("Reply with OK"); $("#sTestOut").textContent = "✓ Key works"; save(); }
      catch (err) { $("#sTestOut").textContent = err.message; }
      return;
    }
    case "sSave": {
      S.settings.geminiKey = $("#sKey").value.trim(); S.settings.model = $("#sModel").value.trim() || "gemini-2.5-flash";
      Object.assign(S.profile, { age: +$("#pAge").value, heightCm: +$("#pH").value, startWeight: +$("#pW").value,
        bodyFat: +$("#pBF").value, targetDate: $("#pDate").value, budget: +$("#pBud").value });
      save(); render(); return toast("Saved");
    }
    case "exp": {
      const a = document.createElement("a"), { settings, ...rest } = S; // never export the API key
      a.href = URL.createObjectURL(new Blob([JSON.stringify(rest, null, 2)], { type: "application/json" }));
      a.download = `milkha-backup-${today()}.json`; a.click(); return;
    }
  }
});

function recent(n) {
  const out = { phase: phase(), weights: S.weights.slice(-n), days: {} };
  for (let i = 0; i < n; i++) {
    const dt = new Date(); dt.setDate(dt.getDate() - i); const k = iso(dt);
    if (S.days[k]) out.days[k] = { checks: S.days[k].checks, totals: foodTotals(S.days[k]), target: dayTargets(k).kcal,
      feel: S.days[k].feel, meals: (S.days[k].food || []).map((f) => f.name) };
  }
  return out;
}

async function ask(q, out) {
  if (!q.trim()) return;
  out.textContent = "Thinking…";
  try { out.textContent = await gemini(`${coachContext()}\nAnswer briefly and practically (Indian vegetarian context, Zepto prices in ₹). Plain text, no markdown.\n\n${q}`); }
  catch (err) { out.textContent = err.message; }
}

async function logFood() {
  const text = $("#foodText").value.trim(), file = $("#foodPhoto").files[0], msg = $("#foodMsg"), btn = $("#foodLog");
  if (!text && !file) return (msg.textContent = "Type something or add a photo.");
  msg.textContent = "Analysing…"; btn.disabled = true;
  try {
    const image = file ? await fileToB64(file) : null;
    const r = await gemini(`Estimate nutrition for this Indian vegetarian meal using typical home-cooked portions.
${text ? "Description: " + text : "Use the photo."}
Return JSON: {"items":[{"name":string,"kcal":number,"p":number,"c":number,"f":number}]} (p/c/f in grams).`, { json: true, image });
    (r.items || []).forEach((it) => day().food.push(it));
    save(); render(); toast(`Logged ${r.items?.length || 0} item(s)`);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
}

render();
