// Browser helpers for the SearchVerse APIs.
export async function api(path, method = "GET", body) {
  const r = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && typeof location !== "undefined") { location.href = "/login?next=" + encodeURIComponent(location.pathname); }
  if (!r.ok) throw new Error(d.error || "Error " + r.status);
  return d;
}
export const db = (path, method, body) => api("/api/cg/db/" + path, method, body);

export const ROLE_NAMES = { owner: "👑 Owner", admin: "🛡️ Team admin", manager: "📋 Project manager", member: "✍️ Member", viewer: "👀 Viewer" };
export const canManage = (role) => ["manager", "admin", "owner"].includes(role);
export const canRun = (role) => ["member", "manager", "admin", "owner"].includes(role);
export const when = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
export const fmt = (n) => (n == null || n === "" || Number.isNaN(n) ? "—" : Number(n).toLocaleString());
export const tone = (v) => (v == null ? "" : v >= 90 ? "good" : v >= 50 ? "mid" : "low");

// Runs `fn` over `items` with `n` at a time.
export async function pool(items, n, fn) {
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

// CSV parsing (handles quotes; comma, tab or semicolon separated).
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === "\t" || c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function downloadCsv(name, rows) {
  const text = "﻿" + rows.map((r) => r.map((v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click();
}
