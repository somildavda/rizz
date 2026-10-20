// Milkha Mode — local-first fitness app. All data lives in this browser's localStorage.
const KEY = "milkha-mode-v1";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toLocaleDateString("en-CA");
const dayIdx = (d = new Date()) => (d.getDay() + 6) % 7; // Mon = 0

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
  };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }
function day(d = today()) { return (S.days[d] ??= { checks: {}, food: [], sets: {} }); }

// ---------- Gemini ----------
async function gemini(prompt, { json = false, image = null } = {}) {
  const k = S.settings.geminiKey.trim();
  if (!k) throw new Error("Add your Gemini API key in Settings first.");
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.type, data: image.data } });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(S.settings.model)}:generateContent`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": k },
      body: JSON.stringify({ contents: [{ parts }],
        generationConfig: json ? { responseMimeType: "application/json" } : {} }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return json ? JSON.parse(text) : text;
}
const coachContext = () => {
  const p = S.profile;
  return `User: ${p.age}y Indian male, ${p.heightCm} cm, ${latestWeight()} kg, ~${p.bodyFat}% body fat, vegetarian (loves tofu), beginner,
${p.knee}. Trains 60 min at ${p.gym}. Goal: Farhan Akhtar's Bhaag Milkha Bhaag physique by ${p.targetDate}.
Budget ₹${p.budget}/month, orders groceries on Zepto, cooks at home. Daily target ${TARGETS.kcal} kcal, ${TARGETS.protein} g protein.`;
};
function fileToB64(file) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok({ type: file.type || "image/jpeg", data: String(r.result).split(",")[1] });
    r.onerror = bad; r.readAsDataURL(file);
  });
}

// ---------- helpers ----------
const latestWeight = () => S.weights.at(-1)?.kg ?? S.profile.startWeight;
const foodTotals = (d) => d.food.reduce((t, f) => ({ kcal: t.kcal + (+f.kcal || 0), p: t.p + (+f.p || 0),
  c: t.c + (+f.c || 0), f: t.f + (+f.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
function checkbox(id, text) {
  const on = !!day().checks[id];
  return `<label class="check ${on ? "done" : ""}"><input type="checkbox" data-check="${esc(id)}" ${on ? "checked" : ""}><span>${text}</span></label>`;
}
function weekStreak() {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (S.days[d.toLocaleDateString("en-CA")]?.checks.workout) n++;
  }
  return n;
}

// ---------- views ----------
const V = {};

V.today = () => {
  const w = WEEK[dayIdx()], d = day(), t = foodTotals(d);
  return `
  <div class="card"><div class="stats">
    <div><b>${latestWeight()}</b><span class="muted">kg</span></div>
    <div><b>${Math.round(t.kcal)}</b><span class="muted">/ ${TARGETS.kcal} kcal</span></div>
    <div><b>${Math.round(t.p)}</b><span class="muted">/ ${TARGETS.protein} g P</span></div>
    <div><b>${weekStreak()}/5</b><span class="muted">workouts (7d)</span></div>
  </div></div>
  <div class="card"><h2>Today: ${esc(w.title)}</h2>
    ${checkbox("workout", `Finish workout — <a href="#train" style="color:var(--accent)">open plan</a>`)}
    ${checkbox("protein", `Hit ${TARGETS.protein} g protein`)}
    ${checkbox("water", `Drink ${TARGETS.waterL} L water`)}
    ${checkbox("steps", `${TARGETS.steps.toLocaleString("en-IN")} steps`)}
    ${checkbox("creatine", "Creatine 5 g")}
    ${checkbox("skinAM", "Morning skin routine + sunscreen")}
    ${checkbox("posture", "Posture drills (5 min)")}
    ${checkbox("skinPM", "Night skin routine")}
    ${checkbox("sleep", `Sleep ${TARGETS.sleepH} h`)}
  </div>
  <div class="card"><h2>Today's meals</h2>
    ${MEALS.map((m, i) => checkbox("meal" + i, `<b>${esc(m.time)}</b> — ${esc(m.items)} <span class="muted">(${m.kcal} kcal, ${m.p} g P)</span>`)).join("")}
  </div>`;
};

let trainDay = dayIdx();
V.train = () => {
  const w = WEEK[trainDay], d = day();
  return `
  <div class="daytabs">${WEEK.map((x, i) => `<button class="small ${i === trainDay ? "on" : ""}" data-trainday="${i}">${x.day}</button>`).join("")}</div>
  <div class="card"><h2>${esc(w.day)} — ${esc(w.title)}</h2>
    <p class="warn">Left knee: stop any move that causes sharp pain. Pain-free range only.</p>
    ${w.ex.map(([name, sets, reps, note], i) => {
      const id = `${trainDay}-${i}`, logged = d.sets[id] || [];
      const showSets = sets > 1 && !/min|s$|m$/.test(reps);
      return `<div class="ex"><b>${esc(name)}</b> <span class="tag">${sets} × ${esc(reps)}</span>
        ${note ? `<div class="muted">${esc(note)}</div>` : ""}
        ${showSets ? `<div class="sets">${Array.from({ length: Math.min(sets, 4) }, (_, s) =>
          `<input inputmode="decimal" placeholder="kg×reps" data-set="${id}" data-s="${s}" value="${esc(logged[s] || "")}">`).join("")}</div>` : ""}
        <button class="ghost small" data-swap="${esc(name)}" style="margin-top:6px">AI swap</button>
        <pre class="ai" id="swap-${id}"></pre></div>`;
    }).join("")}
    <p style="margin-top:12px">${checkbox("workout", "Mark today's workout done")}</p>
  </div>
  <div class="card"><h3>How to progress</h3>
    <p class="muted">When you hit the top of the rep range on every set, add 2.5 kg (or the next dumbbell) next week.
    Weeks 1–2: learn form, light weights. Every 6th week: lighter "deload" week.</p></div>`;
};

V.food = () => {
  const d = day(), t = foodTotals(d);
  const weekly = GROCERY.reduce((s, g) => s + g.qty * (S.prices[g.item] ?? g.price), 0);
  const extras = MONTHLY_EXTRAS.reduce((s, g) => s + (S.prices[g.item] ?? g.price), 0);
  const monthly = Math.round(weekly * 4.33 + extras);
  return `
  <div class="card"><h2>Log food with AI</h2>
    <p class="muted">Type what you ate ("2 roti, dal, 100g paneer bhurji") or snap a photo.</p>
    <textarea id="foodText" placeholder="What did you eat?"></textarea>
    <div class="row" style="margin-top:8px">
      <input type="file" id="foodPhoto" accept="image/*" capture="environment">
      <button id="foodLog">Analyse & log</button>
    </div>
    <div id="foodMsg" class="muted"></div>
  </div>
  <div class="card"><h2>Today: ${Math.round(t.kcal)} kcal · P ${Math.round(t.p)} · C ${Math.round(t.c)} · F ${Math.round(t.f)}</h2>
    <p class="muted">Target ${TARGETS.kcal} kcal · P ${TARGETS.protein} · C ${TARGETS.carbs} · F ${TARGETS.fat}</p>
    <table>${d.food.map((f, i) => `<tr><td>${esc(f.name)}</td><td class="num">${Math.round(f.kcal)} kcal</td>
      <td class="num">${Math.round(f.p)} g P</td><td class="num"><button class="ghost small" data-delfood="${i}">✕</button></td></tr>`).join("") ||
      `<tr><td class="muted">Nothing logged yet.</td></tr>`}</table>
    <h3>Quick add from plan</h3>
    <div class="row">${MEALS.map((m, i) => `<button class="ghost small" data-addmeal="${i}">+ ${esc(m.name)}</button>`).join("")}</div>
  </div>
  <div class="card"><h2>Zepto weekly list</h2>
    <p class="muted">Tap a price to edit it to what Zepto shows. Tap 📋 to copy the search term.</p>
    <table><tr><th>Item</th><th class="num">Qty</th><th class="num">₹ each</th><th></th></tr>
    ${GROCERY.map((g) => `<tr><td>${esc(g.item)}</td><td class="num">${g.qty}</td>
      <td class="num"><input style="width:70px" inputmode="numeric" data-price="${esc(g.item)}" value="${S.prices[g.item] ?? g.price}"></td>
      <td><button class="ghost small" data-copy="${esc(g.item.replace(/\s*\(.*\)/, ""))}">📋</button></td></tr>`).join("")}
    </table>
    <h3>Monthly buys</h3>
    <table>${MONTHLY_EXTRAS.map((g) => `<tr><td>${esc(g.item)}</td>
      <td class="num"><input style="width:80px" inputmode="numeric" data-price="${esc(g.item)}" value="${S.prices[g.item] ?? g.price}"></td></tr>`).join("")}</table>
    <h3>Budget: ₹${monthly.toLocaleString("en-IN")} / ₹${S.profile.budget.toLocaleString("en-IN")} per month
      ${monthly > S.profile.budget ? `<span class="warn">— over budget</span>` : `<span style="color:var(--ok)">✓</span>`}</h3>
    <p class="muted">Groceries ≈ ₹${Math.round(weekly).toLocaleString("en-IN")}/week. Gym already paid.</p>
  </div>
  <div class="card"><h2>Ask the AI coach</h2>
    <textarea id="askText" placeholder="e.g. Give me 3 high-protein tofu recipes under ₹100"></textarea>
    <button id="askBtn" style="margin-top:8px">Ask</button><pre class="ai" id="askOut"></pre>
  </div>`;
};

V.looks = () => {
  const list = (key, arr) => arr.map((x, i) => checkbox(`${key}${i}`, esc(x))).join("");
  const derm = S.profile.derm || "";
  return `
  <div class="card"><h2>Dermatologist's routine</h2>
    <p class="muted">Paste what your dermat prescribes. Follow this over the general routine below.</p>
    <textarea id="derm" placeholder="e.g. AM: … PM: …">${esc(derm)}</textarea>
    ${derm ? derm.split("\n").filter((x) => x.trim()).map((x, i) => checkbox("derm" + i, esc(x))).join("") : ""}
  </div>
  <div class="card"><h2>Morning skin</h2>${list("gAM", GROOMING.am)}</div>
  <div class="card"><h2>Night skin</h2>${list("gPM", GROOMING.pm)}</div>
  <div class="card"><h2>Posture (Milkha stance)</h2>${list("gPos", GROOMING.posture)}</div>
  <div class="card"><h2>Weekly grooming</h2>${list("gWk", GROOMING.weekly)}</div>
  <div class="card"><h2>Habits that change your face</h2>
    <p class="muted">Losing body fat is what shows the jawline and cheekbones. Sleep and water reduce puffiness.</p>${list("gHab", GROOMING.habits)}</div>`;
};

V.progress = () => {
  const p = S.profile, w = latestWeight();
  const lbm = p.startWeight * (1 - p.bodyFat / 100);
  const weeksLeft = Math.max(0, Math.round((new Date(p.targetDate) - new Date()) / 6048e5));
  const projected = Math.max(lbm / 0.88, w - weeksLeft * 0.7).toFixed(1);
  return `
  <div class="card"><h2>Log weigh-in</h2>
    <p class="muted">Weigh every morning after the toilet, before food. Watch the weekly trend, not single days.</p>
    <div class="row"><input id="wKg" inputmode="decimal" placeholder="Weight kg">
      <input id="wWaist" inputmode="decimal" placeholder="Waist cm (at navel)">
      <button id="wSave">Save</button></div>
  </div>
  <div class="card"><h2>Trend</h2>${chart()}
    <p class="muted">Start ${p.startWeight} kg → now ${w} kg (${(w - p.startWeight).toFixed(1)} kg).
    Aim: ~0.5–0.8 kg/week. ${weeksLeft} weeks left → about <b>${projected} kg</b> by ${esc(p.targetDate)}.</p>
  </div>
  <div class="card"><h2>History</h2><table>
    ${S.weights.slice().reverse().slice(0, 30).map((x) => `<tr><td>${esc(x.date)}</td><td class="num">${x.kg} kg</td>
      <td class="num">${x.waist ? x.waist + " cm" : ""}</td></tr>`).join("") || `<tr><td class="muted">No entries yet.</td></tr>`}
  </table></div>
  <div class="card"><h2>Weekly AI review</h2>
    <p class="muted">Gemini looks at your last 14 days of weight, food and workouts and tells you what to change.</p>
    <button id="reviewBtn">Review my week</button><pre class="ai" id="reviewOut"></pre></div>`;
};

function chart() {
  const pts = S.weights.slice(-60);
  if (pts.length < 2) return `<p class="muted">Log at least 2 weigh-ins to see a chart.</p>`;
  const ys = pts.map((x) => x.kg), lo = Math.min(...ys) - 1, hi = Math.max(...ys) + 1;
  const xy = pts.map((x, i) => `${(i / (pts.length - 1)) * 300},${150 - ((x.kg - lo) / (hi - lo)) * 140}`).join(" ");
  return `<svg viewBox="0 0 300 160" preserveAspectRatio="none"><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${xy}"/>
    <text x="2" y="12" fill="var(--muted)" font-size="10">${hi.toFixed(0)}</text><text x="2" y="158" fill="var(--muted)" font-size="10">${lo.toFixed(0)}</text></svg>`;
}

V.settings = () => {
  const p = S.profile, s = S.settings;
  return `
  <div class="card"><h2>Gemini API key</h2>
    <p class="muted">Get a free key at aistudio.google.com → "Get API key". It is stored only on this device.</p>
    <input id="sKey" type="password" placeholder="Paste Gemini API key" value="${esc(s.geminiKey)}">
    <input id="sModel" style="margin-top:8px" placeholder="Model" value="${esc(s.model)}">
    <button id="sTest" class="ghost" style="margin-top:8px">Test key</button> <span id="sTestOut" class="muted"></span>
  </div>
  <div class="card"><h2>Profile</h2>
    <div class="row"><label>Age<input id="pAge" value="${p.age}"></label><label>Height cm<input id="pH" value="${p.heightCm}"></label></div>
    <div class="row"><label>Start kg<input id="pW" value="${p.startWeight}"></label><label>Body fat %<input id="pBF" value="${p.bodyFat}"></label></div>
    <div class="row"><label>Target date<input id="pDate" type="date" value="${esc(p.targetDate)}"></label>
      <label>Budget ₹/month<input id="pBud" value="${p.budget}"></label></div>
  </div>
  <button id="sSave">Save settings</button>
  <div class="card"><h2>Backup</h2>
    <p class="muted">Your data lives only in this browser. Export a backup now and then.</p>
    <div class="row"><button class="ghost" id="exp">Export</button>
      <label class="ghost" style="text-align:center">Import<input type="file" id="imp" accept="application/json" hidden></label></div>
  </div>`;
};

// ---------- render + events ----------
let tab = location.hash.slice(1) || "today";
function render() {
  if (!V[tab]) tab = "today";
  $("#view").innerHTML = V[tab]();
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const days = Math.ceil((new Date(S.profile.targetDate) - new Date()) / 864e5);
  $("#countdown").textContent = days > 0 ? `${days} days to target (${S.profile.targetDate})` : "Target date reached — set a new one in Settings";
}
window.addEventListener("hashchange", () => { tab = location.hash.slice(1); render(); });
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => { location.hash = b.dataset.tab; });

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.check) { day().checks[el.dataset.check] = el.checked; save(); render(); }
  if (el.dataset.set) { const s = (day().sets[el.dataset.set] ||= []); s[+el.dataset.s] = el.value; save(); }
  if (el.id === "derm") { S.profile.derm = el.value; save(); render(); }
  if (el.dataset.price) { S.prices[el.dataset.price] = +el.value || 0; save(); render(); }
  if (el.id === "imp" && el.files[0]) el.files[0].text().then((t) => {
    try { localStorage.setItem(KEY, JSON.stringify(JSON.parse(t))); S = load(); render(); alert("Imported."); }
    catch { alert("That file isn't a valid backup."); }
  });
});

document.addEventListener("click", async (e) => {
  const el = e.target.closest("button");
  if (!el) return;
  const d = el.dataset;
  if (d.trainday) { trainDay = +d.trainday; render(); }
  if (d.addmeal) { const m = MEALS[+d.addmeal]; day().food.push({ name: m.name, kcal: m.kcal, p: m.p, c: 0, f: 0 }); save(); render(); }
  if (d.delfood) { day().food.splice(+d.delfood, 1); save(); render(); }
  if (d.copy) { navigator.clipboard?.writeText(d.copy); el.textContent = "✓"; }
  if (d.swap) {
    const out = el.nextElementSibling; out.textContent = "Thinking…";
    try { out.textContent = await gemini(`${coachContext()}\nSuggest 2 alternatives to "${d.swap}" available in a commercial gym, safe for the left knee. One line each, with sets × reps.`); }
    catch (err) { out.textContent = err.message; }
  }
  switch (el.id) {
    case "foodLog": return logFood();
    case "askBtn": return ask($("#askText").value, $("#askOut"));
    case "reviewBtn": return ask(`Review my last 14 days and give 5 specific changes:\n${JSON.stringify(recent(14))}`, $("#reviewOut"));
    case "wSave": {
      const kg = parseFloat($("#wKg").value);
      if (!kg) return;
      S.weights = S.weights.filter((x) => x.date !== today());
      S.weights.push({ date: today(), kg, waist: parseFloat($("#wWaist").value) || null });
      save(); return render();
    }
    case "sTest": {
      $("#sTestOut").textContent = "Testing…"; S.settings.geminiKey = $("#sKey").value; S.settings.model = $("#sModel").value || "gemini-2.5-flash";
      try { await gemini("Reply with OK"); $("#sTestOut").textContent = "✓ Key works"; save(); }
      catch (err) { $("#sTestOut").textContent = err.message; }
      return;
    }
    case "sSave": {
      S.settings.geminiKey = $("#sKey").value.trim(); S.settings.model = $("#sModel").value.trim() || "gemini-2.5-flash";
      Object.assign(S.profile, { age: +$("#pAge").value, heightCm: +$("#pH").value, startWeight: +$("#pW").value,
        bodyFat: +$("#pBF").value, targetDate: $("#pDate").value, budget: +$("#pBud").value });
      save(); render(); return alert("Saved.");
    }
    case "exp": {
      const a = document.createElement("a");
      const { settings, ...rest } = S; // never export the API key
      a.href = URL.createObjectURL(new Blob([JSON.stringify(rest, null, 2)], { type: "application/json" }));
      a.download = `milkha-backup-${today()}.json`; a.click(); return;
    }
  }
});

function recent(n) {
  const out = { weights: S.weights.slice(-n), days: {} };
  for (let i = 0; i < n; i++) {
    const dt = new Date(); dt.setDate(dt.getDate() - i); const k = dt.toLocaleDateString("en-CA");
    if (S.days[k]) out.days[k] = { checks: S.days[k].checks, totals: foodTotals(S.days[k]) };
  }
  return out;
}

async function ask(q, out) {
  if (!q.trim()) return;
  out.textContent = "Thinking…";
  try { out.textContent = await gemini(`${coachContext()}\nAnswer briefly and practically (Indian vegetarian context, Zepto prices in ₹).\n\n${q}`); }
  catch (err) { out.textContent = err.message; }
}

async function logFood() {
  const text = $("#foodText").value.trim(), file = $("#foodPhoto").files[0], msg = $("#foodMsg");
  if (!text && !file) return (msg.textContent = "Type something or add a photo.");
  msg.textContent = "Analysing…";
  try {
    const image = file ? await fileToB64(file) : null;
    const r = await gemini(`Estimate nutrition for this Indian vegetarian meal using typical home-cooked portions.
${text ? "Description: " + text : "Use the photo."}
Return JSON: {"items":[{"name":string,"kcal":number,"p":number,"c":number,"f":number}]} (p/c/f in grams).`, { json: true, image });
    (r.items || []).forEach((it) => day().food.push(it));
    save(); render(); $("#foodMsg").textContent = `Logged ${r.items?.length || 0} item(s).`;
  } catch (err) { msg.textContent = err.message; }
}

render();
