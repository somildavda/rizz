(function () {
  var T = window.SV_TOOLS, root = document.body.getAttribute("data-root") || "/";
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function card(t) {
    var a = h("a", "card"); a.href = root + "tools/" + t.id + "/";
    a.appendChild(h("span", "tag", t.tag)); a.appendChild(h("div", "ic", t.icon));
    a.appendChild(h("h3", null, t.name)); a.appendChild(h("p", null, t.tagline));
    a.appendChild(h("div", "go", "View module →")); return a;
  }
  document.querySelectorAll("[data-year]").forEach(function (e) { e.textContent = new Date().getFullYear(); });

  // Homepage grid (optionally excluding one tool)
  document.querySelectorAll("[data-tool-grid]").forEach(function (g) {
    var skip = g.getAttribute("data-exclude");
    T.forEach(function (t) { if (t.id !== skip) g.appendChild(card(t)); });
  });

  // Search filter on homepage
  var q = document.getElementById("q");
  if (q) q.addEventListener("input", function () {
    var v = q.value.toLowerCase();
    document.querySelectorAll("#grid .card").forEach(function (c) {
      c.style.display = c.textContent.toLowerCase().indexOf(v) > -1 ? "" : "none";
    });
  });

  // Dedicated tool page
  var id = document.body.getAttribute("data-tool");
  var t = id && T.filter(function (x) { return x.id === id; })[0];
  if (!t) return;
  document.title = t.name + " — SearchVerse";
  function set(sel, v) { document.querySelectorAll(sel).forEach(function (e) { e.textContent = v; }); }
  set("[data-f=icon]", t.icon); set("[data-f=tag]", t.tag); set("[data-f=name]", t.name);
  set("[data-f=tagline]", t.tagline); set("[data-f=desc]", t.desc); set("[data-f=note]", t.note || "");
  var fl = document.querySelector("[data-f=features]");
  t.features.forEach(function (f) { var c = h("div", "card static"); c.appendChild(h("h3", null, f[0])); c.appendChild(h("p", null, f[1])); fl.appendChild(c); });
  var sl = document.querySelector("[data-f=steps]");
  t.steps.forEach(function (s, i) { var li = h("li"); li.appendChild(h("b", null, String(i + 1))); li.appendChild(h("span", null, s)); sl.appendChild(li); });

  // Launch: embedded workspace view, or new tab where the tool forbids embedding
  var viewer = document.getElementById("viewer"), frame = document.getElementById("frame");
  document.getElementById("ext").href = t.url;
  set("#vtitle", t.name);
  document.querySelectorAll("[data-launch]").forEach(function (b) {
    if (t.newTab) { b.href = t.url; b.target = "_blank"; b.rel = "noopener"; b.textContent = "Launch ↗"; return; }
    b.href = "#launch";
  });
  function route() {
    var on = location.hash === "#launch" && !t.newTab;
    viewer.classList.toggle("on", on);
    document.documentElement.style.overflow = on ? "hidden" : "";
    if (on && !frame.getAttribute("src")) frame.src = t.url;
  }
  window.addEventListener("hashchange", route); route();
})();
