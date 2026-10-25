// Journey on Cloudflare Workers: serves the app (/), the kitchen page (/kitchen) and a tiny
// API for meal swaps (/api/menu), stored in a KV namespace bound as MENU. Only swaps
// ({date: {slot: dish}}) are stored; editing needs the EDIT_KEY secret.
// Built by build-worker.py — edit the source files, not dist/worker.js.
const FILES = __FILES__;
const BUILD = "__BUILD_ID__";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function api(request, env, path) {
  if (!env.MENU) return json({ error: "Add a KV namespace binding named MENU to this Worker." }, 503);
  if (request.method === "GET") {
    return new Response((await env.MENU.get("menu")) || "{}", { headers: JSON_HEADERS });
  }
  if (request.method === "PUT") {
    if (!env.EDIT_KEY || request.headers.get("x-edit-key") !== env.EDIT_KEY) return json({ error: "Wrong sync key." }, 401);
    const date = path.split("/")[3] || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date." }, 400);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad JSON." }, 400); }
    const picks = {};
    for (const [slot, dish] of Object.entries(body?.picks || {})) {
      if (/^\d$/.test(slot) && Number.isInteger(dish) && dish >= 0 && dish < 50) picks[slot] = dish;
    }
    const menu = JSON.parse((await env.MENU.get("menu")) || "{}");
    menu[date] = picks;
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    for (const d of Object.keys(menu)) if (d < cutoff) delete menu[d];
    await env.MENU.put("menu", JSON.stringify(menu));
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}

// ---- Daily reminders (Web Push, no payload: the service worker picks the text by time) ----
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function vapidJWT(env, aud) {
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://journey.somildavda.workers.dev" });
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return unsigned + "." + b64u(sig);
}
async function sendAll(env) {
  if (!env.MENU || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return 0;
  const subs = JSON.parse((await env.MENU.get("subs")) || "[]"), keep = [];
  let sent = 0;
  for (const sub of subs) {
    try {
      const res = await fetch(sub.endpoint, { method: "POST", headers: {
        TTL: "3600", Urgency: "high", "Content-Length": "0",
        Authorization: `vapid t=${await vapidJWT(env, new URL(sub.endpoint).origin)}, k=${env.VAPID_PUBLIC}`,
      } });
      if (res.status === 404 || res.status === 410) continue; // subscription expired
      if (res.ok) sent++;
    } catch {}
    keep.push(sub);
  }
  await env.MENU.put("subs", JSON.stringify(keep));
  return sent;
}
async function push(request, env, path) {
  if (path === "/api/push/key") return json({ key: env.VAPID_PUBLIC || null });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.MENU) return json({ error: "Add a KV namespace binding named MENU to this Worker." }, 503);
  if (!env.EDIT_KEY || request.headers.get("x-edit-key") !== env.EDIT_KEY) return json({ error: "Wrong sync key." }, 401);
  if (path === "/api/push/subscribe") {
    let sub;
    try { sub = await request.json(); } catch { return json({ error: "Bad JSON." }, 400); }
    if (!/^https:\/\//.test(sub?.endpoint || "")) return json({ error: "Bad subscription." }, 400);
    const subs = JSON.parse((await env.MENU.get("subs")) || "[]").filter((s) => s.endpoint !== sub.endpoint);
    subs.push({ endpoint: sub.endpoint });
    await env.MENU.put("subs", JSON.stringify(subs.slice(-5)));
    return json({ ok: true });
  }
  if (path === "/api/push/test") return json({ sent: await sendAll(env) });
  return json({ error: "Not found." }, 404);
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(sendAll(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path.startsWith("/api/menu")) return api(request, env, path);
    if (path.startsWith("/api/push/")) return push(request, env, path);
    if (path === "/version.json") return json({ build: BUILD });
    if (path === "/" || path === "") path = "/index.html";
    if (path === "/kitchen" || path === "/kitchen/") path = "/kitchen.html";
    const file = FILES[path];
    if (!file) return new Response("Not found", { status: 404 });
    const [type, data, isBase64] = file;
    const body = isBase64 ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : data;
    const fresh = path.endsWith(".html") || path === "/sw.js";
    return new Response(body, { headers: { "content-type": type, "cache-control": fresh ? "no-cache" : "public, max-age=300" } });
  },
};
