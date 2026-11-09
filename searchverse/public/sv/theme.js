// SearchVerse light/dark switch, shared by every page. Navy (dark) is the default; the choice is
// remembered in this browser. Load it in <head> (not deferred) so the page never flashes.
(function () {
  var KEY = "sv-theme";
  function get() { try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch (_) { return "dark"; } }
  function set(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(KEY, t); } catch (_) {}
    document.querySelectorAll(".sv-theme").forEach(function (b) { b.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode"); });
  }
  document.documentElement.setAttribute("data-theme", get());
  // Keep other tabs/frames (e.g. a tool opened inside the homepage) in step.
  addEventListener("storage", function (e) { if (e.key === KEY) document.documentElement.setAttribute("data-theme", get()); });

  function addSwitch() {
    if (document.querySelector(".sv-theme")) return;
    var slot = document.querySelector("[data-theme-slot]");
    var b = document.createElement("button");
    b.type = "button"; b.className = "sv-theme" + (slot ? "" : " float"); b.title = "Light / dark";
    b.innerHTML = '<span class="l" aria-hidden="true">☀️</span><span class="d" aria-hidden="true">🌙</span>';
    b.onclick = function () { set(get() === "dark" ? "light" : "dark"); };
    if (slot) slot.appendChild(b); else document.body.appendChild(b);
    set(get());
  }
  // Pages shown inside the homepage's tool viewer don't need their own switch.
  var framed = false; try { framed = window.self !== window.top; } catch (_) { framed = true; }
  if (!framed) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addSwitch); else addSwitch();
  }
})();
