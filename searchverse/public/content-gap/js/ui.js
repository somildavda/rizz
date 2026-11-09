// Small UI helpers shared by the app: escaping, links, pills, score bars, the data
// table, toasts, and the client for the project database.
import { esc } from "./engine.js";
export { esc };

export var $ = function (s, el) { return (el || document).querySelector(s); };
export var $$ = function (s, el) { return Array.from((el || document).querySelectorAll(s)); };

export function link(u, label) {
  if (!u) return '<span class="muted">—</span>';
  return '<a class="u" href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(u) + '">' + esc(label || String(u).replace(/^https?:\/\/(www\.)?/, "")) + "</a>";
}
export function pill(text, tone) { return '<span class="pill ' + (tone || "") + '">' + esc(text) + "</span>"; }
export function num(n) { return n == null || n === "" ? '<span class="muted">—</span>' : Number(n).toLocaleString(); }
export function scoreBar(v, label) {
  v = Math.max(0, Math.min(100, Math.round(v || 0)));
  var tone = v >= 70 ? "good" : v >= 50 ? "mid" : "low";
  return '<div class="sbar" title="' + esc(label || "") + " " + v + '/100"><span class="sbar-l">' + esc(label || "") + '</span><span class="sbar-t"><i class="' + tone + '" style="width:' + v + '%"></i></span><b>' + v + "</b></div>";
}
export function scoreRing(v) {
  v = Math.max(0, Math.min(100, Math.round(v || 0)));
  var tone = v >= 70 ? "var(--good)" : v >= 50 ? "var(--mid)" : "var(--low)";
  return '<div class="ring" style="--v:' + v + ";--c:" + tone + '"><b>' + v + "</b><span>score</span></div>";
}

var toastTimer;
export function toast(msg, bad) {
  var t = $("#toast"); t.textContent = msg; t.className = "on" + (bad ? " bad" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = ""; }, 3500);
}

export function download(name, text, type) {
  var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type || "text/csv" })); a.download = name; a.click();
}
export function toCsv(rows) {
  return "﻿" + rows.map(function (r) { return r.map(function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
}

// Sortable, filterable, paged table with CSV export. Columns marked `opt` are hidden
// when no row has a value for them.
export function table(cols, rows, opts) {
  opts = opts || {};
  cols = cols.filter(function (c) { return !c.opt || rows.some(function (r) { var x = c.v(r); return x != null && x !== ""; }); });
  var filters = opts.filters || [];
  var PAGE = 100, st = { sort: opts.sort != null ? opts.sort : null, dir: -1, q: "", f: filters.map(function (f) { return f.initial || ""; }), page: 0 };
  var box = document.createElement("div");
  box.className = "tablebox";
  box.innerHTML = '<div class="tools"><input type="search" placeholder="🔎 Search this table…">' + filters.map(function (f, i) {
      return '<select data-f="' + i + '"><option value="">' + esc(f.label) + ": all</option>" + f.values.map(function (v) { return "<option" + (v === f.initial ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("") + "</select>"; }).join("") +
    '<span class="muted cnt"></span><span class="grow"></span><button class="btn sm ghost csv">⬇ Download CSV</button></div>' +
    '<div class="tbl"><table><thead><tr>' + cols.map(function (c, i) { return '<th data-i="' + i + '"' + (c.tip ? ' title="' + esc(c.tip) + '"' : "") + ">" + esc(c.h) + "</th>"; }).join("") + "</tr></thead><tbody></tbody></table></div>" +
    '<div class="pager"><button class="btn sm ghost prev">‹ Previous</button><span class="muted pg"></span><button class="btn sm ghost next">Next ›</button></div>';
  var tb = $("tbody", box);
  function visible() {
    var q = st.q.toLowerCase(), rs = rows.filter(function (r) {
      for (var i = 0; i < filters.length; i++) if (st.f[i] && filters[i].get(r) !== st.f[i]) return false;
      return !q || cols.some(function (c) { var x = c.v(r); return x != null && String(x).toLowerCase().indexOf(q) > -1; });
    });
    if (st.sort != null) { var c = cols[st.sort]; rs = rs.slice().sort(function (a, b) { var x = c.v(a), y = c.v(b); x = x == null ? -Infinity : x; y = y == null ? -Infinity : y; return (x > y ? 1 : x < y ? -1 : 0) * st.dir; }); }
    return rs;
  }
  function draw() {
    var rs = visible(), pages = Math.max(1, Math.ceil(rs.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    var slice = rs.slice(st.page * PAGE, st.page * PAGE + PAGE);
    $(".cnt", box).textContent = rs.length.toLocaleString() + (rs.length === 1 ? " row" : " rows");
    $(".pg", box).textContent = "Page " + (st.page + 1) + " of " + pages;
    $(".pager", box).style.display = pages > 1 ? "" : "none";
    $(".prev", box).disabled = st.page === 0; $(".next", box).disabled = st.page >= pages - 1;
    tb.innerHTML = slice.length ? slice.map(function (r) { return "<tr>" + cols.map(function (c) { return "<td" + (c.n ? ' class="n"' : "") + ">" + (c.html ? c.html(r) : esc(c.v(r))) + "</td>"; }).join("") + "</tr>"; }).join("")
      : '<tr><td colspan="' + cols.length + '" class="empty">' + esc(opts.empty || "Nothing here yet.") + "</td></tr>";
    if (opts.after) opts.after(tb);
  }
  $("input", box).oninput = function (e) { st.q = e.target.value; st.page = 0; draw(); };
  $$("select[data-f]", box).forEach(function (s) { s.onchange = function () { st.f[+s.dataset.f] = s.value; st.page = 0; draw(); }; });
  $(".prev", box).onclick = function () { st.page--; draw(); box.scrollIntoView({ block: "start" }); };
  $(".next", box).onclick = function () { st.page++; draw(); box.scrollIntoView({ block: "start" }); };
  $$("th", box).forEach(function (th) { th.onclick = function () { var i = +th.dataset.i; st.dir = st.sort === i ? -st.dir : -1; st.sort = i; st.page = 0; draw(); }; });
  $(".csv", box).onclick = function () {
    download((opts.name || "table") + ".csv", toCsv([cols.map(function (c) { return c.h; })].concat(visible().map(function (r) { return cols.map(function (c) { return c.v(r); }); }))));
  };
  draw();
  return box;
}

// ---------- project database client ----------
var WS_KEY = "cg-workspace-key";
export function workspaceKey() {
  var k = null;
  try { k = localStorage.getItem(WS_KEY); } catch (_) {}
  if (!k) {
    var a = new Uint8Array(18); crypto.getRandomValues(a);
    k = "sv-" + Array.from(a, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    try { localStorage.setItem(WS_KEY, k); } catch (_) {}
  }
  return k;
}
export function setWorkspaceKey(k) { try { localStorage.setItem(WS_KEY, k); } catch (_) {} }

export function db(path, method, body) {
  return fetch("/api/cg/db/" + path, {
    method: method || "GET",
    headers: { "X-Workspace-Key": workspaceKey(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Database error " + r.status); return j; });
  });
}

// Per-browser settings (API keys never go to the database).
export function local(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem("cg-local-" + k) || "null");
    localStorage.setItem("cg-local-" + k, JSON.stringify(v));
  } catch (_) { return null; }
}
