// Journey Kitchen — food-only view for the person cooking. Reads the same meal plan
// (plan.js) and the same default rotation as the main app, with no personal data.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => d.toLocaleDateString("en-CA");
const DAY_MS = 864e5, START = new Date(START_DATE);
const today = () => iso(new Date());
const addDays = (k, n) => { const d = new Date(k); d.setDate(d.getDate() + n); return iso(d); };
const firstDay = () => (today() < START_DATE ? START_DATE : today());
const journeyDay = (k) => Math.floor((new Date(k) - START) / DAY_MS) + 1;
// Same rotation as the main app, so both show the same menu for a date.
const mealIdx = (i, k) => (Math.floor(new Date(k) / DAY_MS) + i * 3) % MEALS[i].options.length;
// Gym days follow the default Beginner Full Body cycle (gym on journey days 1, 3 and 5 of each 7).
const isGymDay = (k) => FULL_BODY[(((journeyDay(k) - 1) % 7) + 7) % 7].ex.length > 2;
const label = (k) => k === today() ? "Today" : k === addDays(today(), 1) ? "Tomorrow" :
  new Date(k).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });

let cur = firstDay();
function render() {
  const gym = isGymDay(cur);
  $("#view").innerHTML = `
  <div class="card pager"><button class="iconbtn" id="prev" ${cur <= firstDay() ? "disabled" : ""} aria-label="Previous day">‹</button>
    <div class="center grow"><b>${esc(label(cur))}</b><div class="sub">${new Date(cur).toLocaleDateString("en-IN", { day: "numeric", month: "long" })} · Day ${journeyDay(cur)}</div></div>
    <button class="iconbtn" id="next" aria-label="Next day">›</button></div>
  <button class="btn ghost block sm" id="copy">📋 Copy this day's menu</button>
  ${MEALS.map((slot, i) => {
    const m = slot.options[mealIdx(i, cur)], name = !gym && slot.label.startsWith("Post-gym") ? "Breakfast" : slot.label;
    return `<div class="card"><span class="eyebrow">${esc(slot.time)} · ${esc(name)}</span>
      <h2 class="h2">${esc(m.name)}</h2>
      <h3 class="h3 mt">Take</h3><ul class="bullets">${m.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <h3 class="h3 mt">Method</h3><ol class="bullets">${m.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>`;
  }).join("")}
  <div class="card"><h3 class="h3">Kitchen rules</h3><ul class="bullets">${COOK_RULES.map((x) => `<li>${esc(x)}</li>`).join("")}
    <li>Never use tofu, rajma, chole or kabuli chana.</li></ul></div>`;
}
function menuText(k) {
  const gym = isGymDay(k);
  return `Menu for ${label(k)} (${new Date(k).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})\n` + MEALS.map((slot, i) => {
    const m = slot.options[mealIdx(i, k)], name = !gym && slot.label.startsWith("Post-gym") ? "Breakfast" : slot.label;
    return `\n*${slot.time} ${name}: ${m.name}*\nTake:\n${m.items.map((x) => `- ${x}`).join("\n")}\nMethod:\n${m.steps.map((x, j) => `${j + 1}. ${x}`).join("\n")}`;
  }).join("\n");
}
document.addEventListener("click", async (e) => {
  const id = e.target.closest("button")?.id;
  if (id === "prev") { cur = addDays(cur, -1); render(); }
  if (id === "next") { cur = addDays(cur, 1); render(); }
  if (id === "copy") {
    const t = $("#toast");
    try { await navigator.clipboard.writeText(menuText(cur)); t.textContent = "Menu copied"; }
    catch { t.textContent = "Couldn't copy. Long-press the text instead."; }
    t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2000);
  }
});
render();
